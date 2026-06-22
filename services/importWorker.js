const db = require('../db');
const lastfm = require('./lastfm');
const imageDownloader = require('./imageDownloader');
const musicbrainz = require('./musicbrainz');
const logger = require('./logger');

// Función helper para remover acentos
function removeAccents(str) {
  if (!str) return '';
  return str.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, 'n');
}

async function importSingleArtist(name) {
  // 1. Revisar si el artista ya existe en la DB local por nombre normalizado
  const searchClean = removeAccents(name);
  const localArtists = db.prepare('SELECT id, name FROM artists').all();
  const localArtist = localArtists.find(a => removeAccents(a.name) === searchClean);
  if (localArtist) {
    logger.info(`[Worker] El artista "${localArtist.name}" ya existe localmente.`);
    return { success: true, alreadyExists: true, name: localArtist.name, id: localArtist.id };
  }

  // 2. Buscar en Last.fm
  logger.info(`[Worker] Buscando en Last.fm: "${name}"...`);
  const searchResults = await lastfm.searchArtists(name);
  if (!searchResults || searchResults.length === 0) {
    throw new Error(`No se encontró a "${name}" en Last.fm`);
  }

  const foundArtist = searchResults[0];
  const artistId = foundArtist.id;
  logger.info(`[Worker] Coincidencia encontrada: "${foundArtist.name}" (Slug: "${artistId}")`);

  // 3. Verificar si ya existe en SQLite (por ID resuelto)
  const exists = db.prepare('SELECT id FROM artists WHERE id = ?').get(artistId);
  if (exists) {
    logger.info(`[Worker] El artista "${foundArtist.name}" (Slug: "${artistId}") ya existe en la DB.`);
    return { success: true, alreadyExists: true, name: foundArtist.name, id: artistId };
  }

  // 4. Importar artista completo
  logger.info(`[Worker] Importando detalles de "${foundArtist.name}"...`);
  const artistData = await lastfm.getArtistDetail(artistId);
  
  // Descargar imagen principal
  const localArtistImage = await imageDownloader.saveArtistImage(artistData.image, artistId);
  if (localArtistImage) {
    artistData.image = localArtistImage;
  }

  // Descargar galería
  const localArtistImages = await imageDownloader.saveArtistGallery(artistData.images, artistId);
  artistData.localImages = localArtistImages;

  // Descargar álbumes y canciones desde MusicBrainz
  logger.info(`[Worker] Consultando discografía de "${artistData.name}" en MusicBrainz...`);
  const mbData = await musicbrainz.getArtistAlbumsAndTracks(artistData.name);

  // Descargar portadas
  const albumsWithTracks = [];
  for (const item of mbData) {
    const { album, tracks } = item;
    const localAlbumCover = album.cover_image ? await imageDownloader.saveAlbumImage(album.cover_image, artistId, album.id) : null;
    album.cover_image = localAlbumCover || 'NO_COVER';
    albumsWithTracks.push({ album, tracks });
  }

  // Guardar en SQLite transaccionalmente
  const insertArtist = db.prepare(`
    INSERT OR IGNORE INTO artists (id, name, image, images, genres, notes, popularity, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAlbum = db.prepare(`
    INSERT OR IGNORE INTO albums (id, artist_id, title, cover_image, release_year, user_rating)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertTrack = db.prepare(`
    INSERT OR IGNORE INTO tracks (id, album_id, title, duration_ms, track_number)
    VALUES (?, ?, ?, ?, ?)
  `);

  const addArtistTransaction = db.transaction((artist, data) => {
    insertArtist.run(
      artist.id,
      artist.name,
      artist.image,
      JSON.stringify(artist.localImages || []),
      JSON.stringify(artist.genres),
      artist.biography,
      artist.popularity,
      JSON.stringify(artist.metadata || {})
    );

    for (const item of data) {
      const { album, tracks } = item;
      insertAlbum.run(
        album.id,
        artist.id,
        album.title,
        album.cover_image,
        album.release_year,
        album.user_rating || 0
      );

      for (const track of tracks) {
        insertTrack.run(
          track.id,
          album.id,
          track.title,
          track.duration_ms,
          track.track_number
        );
      }
    }
  });

  addArtistTransaction(artistData, albumsWithTracks);
  logger.info(`[Worker] Importación exitosa de "${artistData.name}".`);
  
  return { success: true, name: artistData.name, id: artistId };
}

let isWorkerRunning = false;

async function runWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  try {
    while (true) {
      // 1. Buscar el primer job activo o pendiente
      let job = db.prepare(`
        SELECT * FROM import_jobs 
        WHERE status IN ('processing', 'pending') 
        ORDER BY created_at ASC LIMIT 1
      `).get();

      if (!job) {
        break;
      }

      // Si el estado es 'pending', pasarlo a 'processing'
      if (job.status === 'pending') {
        db.prepare("UPDATE import_jobs SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
        job.status = 'processing';
      }

      // 2. Buscar el primer item pendiente de este job
      const item = db.prepare(`
        SELECT * FROM import_items 
        WHERE job_id = ? AND status = 'pending' 
        ORDER BY id ASC LIMIT 1
      `).get(job.id);

      if (!item) {
        // Si no quedan items pendientes, el job está completado
        db.prepare("UPDATE import_jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
        logger.info(`[Worker] Tarea de importación ${job.id} finalizada.`);
        continue;
      }

      // 3. Procesar el item
      logger.info(`[Worker] Procesando artista "${item.artist_name}" para el Job: ${job.id}`);
      db.prepare("UPDATE import_items SET status = 'processing' WHERE id = ?").run(item.id);

      try {
        const result = await importSingleArtist(item.artist_name);
        
        db.prepare(`
          UPDATE import_items 
          SET status = 'completed', processed_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(item.id);

        db.prepare(`
          UPDATE import_jobs 
          SET completed_items = completed_items + 1, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(job.id);

        // Si ya existía localmente, no hacemos el delay
        if (!result.alreadyExists) {
          logger.info(`[Worker] Esperando 15 segundos antes de la siguiente llamada...`);
          await new Promise(resolve => setTimeout(resolve, 15000));
        }

      } catch (err) {
        logger.error(`[Worker] Error al importar "${item.artist_name}":`, err);

        db.prepare(`
          UPDATE import_items 
          SET status = 'failed', error_message = ?, processed_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(err.message, item.id);

        db.prepare(`
          UPDATE import_jobs 
          SET completed_items = completed_items + 1, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(job.id);

        await new Promise(resolve => setTimeout(resolve, 15000));
      }
    }
  } catch (err) {
    logger.error(`[Worker] Error crítico en el loop del worker:`, err);
  } finally {
    isWorkerRunning = false;
  }
}

function triggerWorker() {
  runWorker();
}

function initWorker() {
  try {
    // Recuperar items colgados
    db.prepare("UPDATE import_items SET status = 'pending' WHERE status = 'processing'").run();
    db.prepare(`
      UPDATE import_jobs 
      SET status = 'pending', updated_at = CURRENT_TIMESTAMP 
      WHERE status = 'processing'
    `).run();
    
    logger.info("[Worker] Sistema de tareas recuperado tras reinicio del servidor.");
    triggerWorker();
  } catch (e) {
    logger.error("[Worker] Error al inicializar el worker:", e);
  }
}

module.exports = {
  triggerWorker,
  initWorker
};
