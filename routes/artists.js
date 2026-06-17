const express = require('express');
const router = express.Router();
const db = require('../db');
const lastfm = require('../services/lastfm');
const imageDownloader = require('../services/imageDownloader');
const musicbrainz = require('../services/musicbrainz');

// Buscar artistas en Last.fm
router.get('/search', async (req, res) => {
  const query = req.query.q || '';
  const isAjax = req.query.ajax === '1';
  let results = [];
  if (query.trim() !== '') {
    results = await lastfm.searchArtists(query);
  }
  if (isAjax) {
    return res.json({ query, results });
  }
  res.render('search', { query, results, title: 'Buscar Artistas' });
});

// Detalle del artista (desde SQLite)
router.get('/:id', (req, res) => {
  const artistId = req.params.id;

  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(artistId);
  if (!artist) {
    return res.status(404).render('error', { message: 'Artista no encontrado en la base de datos local.', title: 'Error' });
  }

  // Parsear géneros e imágenes de la galería
  artist.genresList = artist.genres ? JSON.parse(artist.genres) : [];
  artist.imagesList = artist.images ? JSON.parse(artist.images) : [];

  // Obtener álbumes ordenados por año ascendente (dejando nulos al final)
  const albums = db.prepare('SELECT * FROM albums WHERE artist_id = ? ORDER BY release_year IS NULL, release_year ASC').all(artistId);

  // Obtener tracks de los álbumes
  for (const album of albums) {
    album.tracks = db.prepare('SELECT * FROM tracks WHERE album_id = ? ORDER BY track_number ASC').all(album.id);
  }

  res.render('artist', { artist, albums, title: artist.name });
});

// Agregar artista completo de Last.fm a SQLite
router.post('/add/:id', async (req, res) => {
  req.setTimeout(180000); // 3 minutos para prevenir timeouts en descargas de galerías grandes
  const artistId = req.params.id; // El id es el slug de Last.fm

  console.log(`[Importador] Iniciando importación del artista slug: "${artistId}"`);

  // Verificar si ya existe
  const exists = db.prepare('SELECT id FROM artists WHERE id = ?').get(artistId);
  if (exists) {
    console.log(`[Importador] El artista slug "${artistId}" ya existe en SQLite. Redirigiendo...`);
    return res.redirect(`/artists/${artistId}`);
  }

  try {
    // 1. Obtener detalles del artista y biografía
    console.log(`[Importador] Buscando metadatos y biografía en Last.fm para slug "${artistId}"...`);
    const artistData = await lastfm.getArtistDetail(artistId);
    console.log(`[Importador] Artista encontrado: "${artistData.name}". Descargando imagen principal y galería...`);
    
    // Descargar imagen de artista de forma local
    const localArtistImage = await imageDownloader.saveArtistImage(artistData.image, artistId);
    if (localArtistImage) {
      artistData.image = localArtistImage;
    }

    // Descargar imágenes adicionales de la galería del artista
    const localArtistImages = await imageDownloader.saveArtistGallery(artistData.images, artistId);
    artistData.localImages = localArtistImages;
    console.log(`[Importador] Fotos descargadas para "${artistData.name}". Galería local cuenta con ${localArtistImages.length} imágenes.`);

    // 2. Obtener álbumes y canciones desde MusicBrainz
    console.log(`[Importador] Solicitando discografía y tracks a MusicBrainz para "${artistData.name}"...`);
    const mbData = await musicbrainz.getArtistAlbumsAndTracks(artistData.name);

    // 3. Descargar portadas y estructurar datos
    console.log(`[Importador] MusicBrainz retornó ${mbData.length} lanzamientos aptos. Descargando portadas locales...`);
    const albumsWithTracks = [];
    for (const item of mbData) {
      const { album, tracks } = item;
      
      // Descargar portada de álbum de forma local si existe url, de lo contrario setear 'NO_COVER'
      const localAlbumCover = album.cover_image ? await imageDownloader.saveAlbumImage(album.cover_image, artistId, album.id) : null;
      album.cover_image = localAlbumCover || 'NO_COVER';
      console.log(`[Importador] Procesado álbum: "${album.title}" (Cover: ${album.cover_image})`);

      albumsWithTracks.push({ album, tracks });
    }

    // 4. Inserción transaccional en SQLite
    console.log(`[Importador] Guardando datos de "${artistData.name}" en SQLite transaccionalmente...`);
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
        artist.biography, // Guardamos la biografía completa scrapeada en la columna de notas o biografía
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
    console.log(`[Importador] Inserción finalizada con éxito. Artista "${artistData.name}" y sus álbumes agregados.`);

    res.redirect(`/artists/${artistId}`);
  } catch (error) {
    console.error('Error al importar artista de Last.fm:', error);
    res.status(500).render('error', { message: 'Ocurrió un error al importar el artista y su discografía desde Last.fm.', title: 'Error' });
  }
});

// Sincronizar/Actualizar sólo los álbumes del artista desde Last.fm y MusicBrainz
router.post('/:id/sync-albums', async (req, res) => {
  req.setTimeout(180000); // 3 minutos para prevenir timeouts en descargas de galerías grandes
  const artistId = req.params.id;

  // 1. Verificar si el artista existe
  const artist = db.prepare('SELECT name FROM artists WHERE id = ?').get(artistId);
  if (!artist) {
    return res.status(404).render('error', { message: 'Artista no encontrado en la base de datos local.', title: 'Error' });
  }

  console.log(`[Sincronizador] Sincronizando álbumes para artista: "${artist.name}" (ID: ${artistId})`);

  try {
    // 2. Obtener álbumes nuevos y canciones desde MusicBrainz
    console.log(`[Sincronizador] Obteniendo discografía desde MusicBrainz para "${artist.name}"...`);
    const mbData = await musicbrainz.getArtistAlbumsAndTracks(artist.name);
    console.log(`[Sincronizador] MusicBrainz retornó ${mbData.length} álbumes candidatos.`);

    // 3. Procesar álbumes
    const albumsWithTracks = [];
    for (const item of mbData) {
      const { album, tracks } = item;

      // Verificar si ya existe en la DB
      const existingAlbum = db.prepare('SELECT id, cover_image, release_year, user_rating FROM albums WHERE id = ?').get(album.id);

      if (!existingAlbum) {
        // Si no existe, descargar portada
        console.log(`[Sincronizador] Nuevo álbum detectado: "${album.title}". Descargando portada...`);
        const localAlbumCover = album.cover_image ? await imageDownloader.saveAlbumImage(album.cover_image, artistId, album.id) : null;
        album.cover_image = localAlbumCover || 'NO_COVER';
        album.isNew = true;

        albumsWithTracks.push({ album, tracks });
      } else {
        // Si ya existe, actualizar metadatos vacíos o sin calificar
        console.log(`[Sincronizador] Álbum existente en base local: "${album.title}". Evaluando actualizaciones de portada o rating...`);
        let updatedCover = existingAlbum.cover_image;
        // Solo intentar si es nulo, vacío, o si antes no tenía cover_image (NO_COVER significa que ya se intentó y falló)
        if ((!existingAlbum.cover_image || existingAlbum.cover_image === '') && album.cover_image) {
          const savedCover = await imageDownloader.saveAlbumImage(album.cover_image, artistId, album.id);
          updatedCover = savedCover || 'NO_COVER';
        }

        const finalRating = (existingAlbum.user_rating === 0 || existingAlbum.user_rating === null) && album.user_rating > 0 ? album.user_rating : existingAlbum.user_rating;

        albumsWithTracks.push({
          album: {
            ...album,
            cover_image: updatedCover,
            release_year: existingAlbum.release_year || album.release_year,
            user_rating: finalRating,
            isNew: false
          },
          tracks: null // No modificamos tracks si ya existe
        });
      }
    }

    // 5. Inserción transaccional
    console.log(`[Sincronizador] Guardando cambios de sincronización en SQLite...`);
    const insertAlbum = db.prepare(`
      INSERT OR IGNORE INTO albums (id, artist_id, title, cover_image, release_year, user_rating)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const updateAlbum = db.prepare(`
      UPDATE albums SET release_year = ?, cover_image = ?, user_rating = ? WHERE id = ?
    `);

    const insertTrack = db.prepare(`
      INSERT OR IGNORE INTO tracks (id, album_id, title, duration_ms, track_number)
      VALUES (?, ?, ?, ?, ?)
    `);

    const syncAlbumsTransaction = db.transaction((data) => {
      for (const item of data) {
        const { album, tracks } = item;
        if (album.isNew) {
          insertAlbum.run(
            album.id,
            artistId,
            album.title,
            album.cover_image,
            album.release_year,
            album.user_rating
          );

          if (tracks) {
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
        } else {
          updateAlbum.run(
            album.release_year,
            album.cover_image,
            album.user_rating,
            album.id
          );
        }
      }
    });

    syncAlbumsTransaction(albumsWithTracks);
    console.log(`[Sincronizador] Sincronización finalizada correctamente para "${artist.name}".`);

    res.redirect(`/artists/${artistId}`);
  } catch (error) {
    console.error('Error al sincronizar álbumes:', error);
    res.status(500).render('error', { message: 'Ocurrió un error al sincronizar la discografía del artista.', title: 'Error' });
  }
});

// Eliminar un álbum individual sin calificación de un artista
router.post('/:id/albums/:albumId/delete', (req, res) => {
  const { id, albumId } = req.params;

  try {
    // 1. Obtener la portada del álbum para borrarla físicamente del disco
    const album = db.prepare('SELECT cover_image FROM albums WHERE id = ? AND artist_id = ?').get(albumId, id);
    
    if (album && album.cover_image) {
      imageDownloader.deleteImage(album.cover_image);
    }

    // 2. Eliminar el álbum en la DB (el borrado en cascada se encarga de las canciones)
    db.prepare('DELETE FROM albums WHERE id = ? AND artist_id = ?').run(albumId, id);

    res.json({ success: true, albumId });
  } catch (error) {
    console.error('Error al borrar álbum individual:', error);
    res.status(500).json({ success: false, error: 'Ocurrió un error al intentar borrar el álbum.' });
  }
});



// Actualizar notas personales
router.post('/:id/notes', (req, res) => {
  const artistId = req.params.id;
  const { notes } = req.body;

  db.prepare('UPDATE artists SET notes = ? WHERE id = ?').run(notes || '', artistId);
  res.redirect(`/artists/${artistId}`);
});

// Eliminar artista de SQLite (borrado en cascada)
router.post('/:id/delete', (req, res) => {
  const artistId = req.params.id;

  try {
    // 1. Obtener las rutas de imágenes antes de borrar de la base de datos
    const artist = db.prepare('SELECT image, images FROM artists WHERE id = ?').get(artistId);
    const albums = db.prepare('SELECT cover_image FROM albums WHERE artist_id = ?').all(artistId);

    // 2. Eliminar de la base de datos (ON DELETE CASCADE se encarga de álbumes y tracks en DB)
    db.prepare('DELETE FROM artists WHERE id = ?').run(artistId);

    // 3. Eliminar archivos de imagen locales físicamente
    if (artist && artist.image) {
      imageDownloader.deleteImage(artist.image);
    }
    
    // Eliminar imágenes de la galería del artista
    if (artist && artist.images) {
      try {
        const gallery = JSON.parse(artist.images);
        if (Array.isArray(gallery)) {
          for (const img of gallery) {
            imageDownloader.deleteImage(img);
          }
        }
      } catch (err) {
        console.error('Error al parsear galería para borrado físico:', err);
      }
    }

    for (const album of albums) {
      if (album.cover_image) {
        imageDownloader.deleteImage(album.cover_image);
      }
    }
  } catch (error) {
    console.error('Error al eliminar imágenes asociadas al artista:', error);
  }

  res.redirect('/');
});

// Importación batch asíncrona de un artista por nombre
router.post('/batch-add', async (req, res) => {
  req.setTimeout(180000); // 3 minutos para prevenir timeouts en descargas de galerías grandes
  const { name } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ success: false, error: 'Nombre de artista vacío' });
  }

  console.log(`[Batch] Iniciando búsqueda e importación en lote para: "${name}"`);

  try {
    // 1. Buscar en Last.fm
    console.log(`[Batch] Buscando en Last.fm el artista: "${name}"...`);
    const searchResults = await lastfm.searchArtists(name);
    if (!searchResults || searchResults.length === 0) {
      console.log(`[Batch] No se encontró a "${name}" en Last.fm.`);
      return res.status(404).json({ success: false, error: `No se encontró a "${name}" en Last.fm` });
    }

    const foundArtist = searchResults[0];
    const artistId = foundArtist.id;
    console.log(`[Batch] Mejor coincidencia encontrada: "${foundArtist.name}" (Slug: "${artistId}")`);

    // 2. Verificar si ya existe en SQLite
    const exists = db.prepare('SELECT id FROM artists WHERE id = ?').get(artistId);
    if (exists) {
      console.log(`[Batch] El artista "${foundArtist.name}" (Slug: "${artistId}") ya existe en la base de datos local.`);
      return res.json({ success: true, alreadyExists: true, name: foundArtist.name, id: artistId });
    }

    // 3. Importar artista completo (lógica idéntica a /add/:id)
    console.log(`[Batch] Importando metadatos detallados de "${foundArtist.name}"...`);
    const artistData = await lastfm.getArtistDetail(artistId);
    
    // Descargar imagen principal
    console.log(`[Batch] Descargando imagen principal de "${artistData.name}"...`);
    const localArtistImage = await imageDownloader.saveArtistImage(artistData.image, artistId);
    if (localArtistImage) {
      artistData.image = localArtistImage;
    }

    // Descargar galería
    console.log(`[Batch] Descargando galería de fotos de "${artistData.name}"...`);
    const localArtistImages = await imageDownloader.saveArtistGallery(artistData.images, artistId);
    artistData.localImages = localArtistImages;
    console.log(`[Batch] Galería de "${artistData.name}" guardada. Total imágenes descargadas: ${localArtistImages.length}`);

    // Descargar álbumes y canciones desde MusicBrainz
    console.log(`[Batch] Solicitando discografía e información de tracks a MusicBrainz para "${artistData.name}"...`);
    const mbData = await musicbrainz.getArtistAlbumsAndTracks(artistData.name);
    console.log(`[Batch] MusicBrainz retornó ${mbData.length} lanzamientos/álbumes.`);

    // Descargar portadas y estructurar datos
    console.log(`[Batch] Descargando portadas locales para los álbumes de "${artistData.name}"...`);
    const albumsWithTracks = [];
    for (const item of mbData) {
      const { album, tracks } = item;
      
      // Descargar portada de álbum de forma local si existe url, de lo contrario setear 'NO_COVER'
      const localAlbumCover = album.cover_image ? await imageDownloader.saveAlbumImage(album.cover_image, artistId, album.id) : null;
      album.cover_image = localAlbumCover || 'NO_COVER';
      console.log(`[Batch] Procesado álbum: "${album.title}" (Cover: ${album.cover_image})`);

      albumsWithTracks.push({ album, tracks });
    }

    // Guardar en SQLite transaccionalmente
    console.log(`[Batch] Guardando de forma transaccional a "${artistData.name}" y su discografía en SQLite...`);
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
    console.log(`[Batch] Importación en lote finalizada con éxito para "${artistData.name}".`);

    res.json({ success: true, name: artistData.name, id: artistId });
  } catch (err) {
    console.error(`[Batch] Error en importación batch de "${name}":`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
