const express = require('express');
const router = express.Router();
const db = require('../db');
const { getFlagPath } = require('../services/flagHelper');

router.get('/', (req, res) => {
  // 1. Estadísticas básicas
  const totalArtists = db.prepare('SELECT COUNT(*) AS count FROM artists').get().count;
  const totalAlbums = db.prepare('SELECT COUNT(*) AS count FROM albums').get().count;
  const totalFavorites = db.prepare('SELECT COUNT(*) AS count FROM tracks WHERE is_favorite = 1').get().count;
  
  const avgRatingRes = db.prepare('SELECT AVG(user_rating) AS avg FROM albums WHERE user_rating > 0').get();
  const avgAlbumRating = avgRatingRes.avg ? parseFloat(avgRatingRes.avg).toFixed(1) : 'N/A';

  // 2. Gráfico de distribución de géneros
  const artistsGenres = db.prepare('SELECT genres FROM artists').all();
  const genreCounts = {};
  
  artistsGenres.forEach(row => {
    if (row.genres) {
      try {
        const genres = JSON.parse(row.genres);
        genres.forEach(g => {
          const formattedGenre = g.charAt(0).toUpperCase() + g.slice(1);
          genreCounts[formattedGenre] = (genreCounts[formattedGenre] || 0) + 1;
        });
      } catch (err) {
        console.error('Error parseando géneros:', err);
      }
    }
  });

  const sortedGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  
  const chartGenres = {
    labels: sortedGenres.map(x => x[0]),
    data: sortedGenres.map(x => x[1])
  };

  // 3. Listado de artistas seguidos con promedio de calificación
  const artists = db.prepare(`
    SELECT 
      a.*,
      COUNT(al.id) AS total_albums,
      COALESCE(AVG(CASE WHEN al.user_rating > 0 THEN al.user_rating ELSE NULL END), 0) AS avg_rating
    FROM artists a
    LEFT JOIN albums al ON a.id = al.artist_id
    GROUP BY a.id
    ORDER BY a.name COLLATE NOCASE ASC
  `).all();

  artists.forEach(a => {
    a.genresList = a.genres ? JSON.parse(a.genres).slice(0, 3) : [];
  });

  // Ordenamiento alfabético insensible a acentos y mayúsculas
  artists.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

  res.render('index', {
    totalArtists,
    totalAlbums,
    totalFavorites,
    avgAlbumRating,
    chartGenres,
    artists,
    getFlagPath,
    title: 'Dashboard'
  });
});

router.get('/stats', (req, res) => {
  try {
    // 1. Estadísticas básicas
    const totalArtists = db.prepare('SELECT COUNT(*) AS count FROM artists').get().count;
    const totalAlbums = db.prepare('SELECT COUNT(*) AS count FROM albums').get().count;
    const totalTracks = db.prepare('SELECT COUNT(*) AS count FROM tracks').get().count;
    const totalFavorites = db.prepare('SELECT COUNT(*) AS count FROM tracks WHERE is_favorite = 1').get().count;
    
    const avgRatingRes = db.prepare('SELECT AVG(user_rating) AS avg FROM albums WHERE user_rating > 0').get();
    const avgAlbumRating = avgRatingRes.avg ? parseFloat(avgRatingRes.avg).toFixed(1) : 'N/A';

    const avgTracksRes = db.prepare('SELECT AVG(track_count) AS avg FROM (SELECT COUNT(*) AS track_count FROM tracks GROUP BY album_id)').get();
    const avgTracksPerAlbum = avgTracksRes.avg ? parseFloat(avgTracksRes.avg).toFixed(1) : 'N/A';

    const durationRes = db.prepare('SELECT SUM(duration_ms) AS total FROM tracks').get();
    let totalDurationStr = '0m';
    if (durationRes.total) {
      const totalMin = Math.floor(durationRes.total / 60000);
      const hours = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      totalDurationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }

    // 2. Top 5 álbumes mejor calificados
    const topAlbums = db.prepare(`
      SELECT al.title, al.user_rating, al.release_year, ar.name AS artist_name
      FROM albums al
      JOIN artists ar ON al.artist_id = ar.id
      WHERE al.user_rating > 0
      ORDER BY al.user_rating DESC, al.title ASC
      LIMIT 5
    `).all();

    // 3. Distribución por década
    const decades = db.prepare(`
      SELECT 
        (release_year / 10 * 10) AS decade, 
        COUNT(*) AS count 
      FROM albums 
      WHERE release_year IS NOT NULL AND release_year > 0
      GROUP BY decade 
      ORDER BY decade DESC
    `).all();

    // 4. Top 5 géneros
    const artistsGenres = db.prepare('SELECT genres FROM artists').all();
    const genreCounts = {};
    artistsGenres.forEach(row => {
      if (row.genres) {
        try {
          const genres = JSON.parse(row.genres);
          genres.forEach(g => {
            const formattedGenre = g.charAt(0).toUpperCase() + g.slice(1);
            genreCounts[formattedGenre] = (genreCounts[formattedGenre] || 0) + 1;
          });
        } catch (err) {}
      }
    });
    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(entry => ({ name: entry[0], count: entry[1] }));

    // 5. Artistas sin álbumes
    const artistsWithoutAlbums = db.prepare(`
      SELECT ar.id, ar.name
      FROM artists ar
      LEFT JOIN albums al ON ar.id = al.artist_id
      WHERE al.id IS NULL
      ORDER BY ar.name COLLATE NOCASE ASC
    `).all();

    // 6. Artistas sin fotos
    const artistsWithoutPhotos = db.prepare(`
      SELECT id, name
      FROM artists
      WHERE image IS NULL OR image = ''
      ORDER BY name COLLATE NOCASE ASC
    `).all();

    res.render('stats', {
      title: 'Estadísticas',
      totalArtists,
      totalAlbums,
      totalTracks,
      totalFavorites,
      avgAlbumRating,
      avgTracksPerAlbum,
      totalDurationStr,
      topAlbums,
      decades,
      topGenres,
      artistsWithoutAlbums,
      artistsWithoutPhotos
    });
  } catch (err) {
    console.error('Error al cargar estadísticas:', err);
    res.status(500).render('error', { 
      title: 'Error Interno', 
      message: 'No se pudieron calcular las estadísticas.' 
    });
  }
});

// Ruta para descargar backup (tar.gz con base de datos e imágenes)
router.get('/stats/backup', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { execSync } = require('child_process');

  const imagesDir = path.join(__dirname, '../public/images');
  
  // Usar el directorio temporal del sistema para evitar que nodemon se reinicie
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'musictracker-backup-'));
  const tempJsonPath = path.join(tempDir, 'db_backup.json');
  const tarPath = path.join(os.tmpdir(), `musictracker-backup-${new Date().toISOString().split('T')[0]}.tar.gz`);

  try {
    // 1. Exportar datos de SQLite
    const backupData = {
      artists: db.prepare('SELECT * FROM artists').all(),
      albums: db.prepare('SELECT * FROM albums').all(),
      tracks: db.prepare('SELECT * FROM tracks').all()
    };

    // 2. Guardar JSON en la carpeta temporal
    fs.writeFileSync(tempJsonPath, JSON.stringify(backupData, null, 2));

    // 3. Copiar las carpetas de imágenes existentes a la carpeta temporal
    const albumsSource = path.join(imagesDir, 'albums');
    const artistsSource = path.join(imagesDir, 'artists');
    if (fs.existsSync(albumsSource)) {
      execSync(`cp -rf ${albumsSource} ${tempDir}/`);
    }
    if (fs.existsSync(artistsSource)) {
      execSync(`cp -rf ${artistsSource} ${tempDir}/`);
    }

    // 4. Crear el archivo tar.gz de forma síncrona en el directorio temporal
    execSync(`tar -czf ${tarPath} -C ${tempDir} .`);

    // 5. Enviar el archivo al cliente
    res.download(tarPath, path.basename(tarPath), (err) => {
      // 6. Limpiar todo lo creado en el directorio temporal tras concluir la descarga
      try {
        execSync(`rm -rf ${tempDir}`);
        if (fs.existsSync(tarPath)) {
          fs.unlinkSync(tarPath);
        }
      } catch (cleanupErr) {
        console.error('Error al limpiar archivos temporales de backup:', cleanupErr);
      }
      if (err && !res.headersSent) {
        console.error('Error durante la descarga del backup:', err);
      }
    });

  } catch (err) {
    console.error('Error al generar backup:', err);
    try {
      execSync(`rm -rf ${tempDir}`);
      if (fs.existsSync(tarPath)) {
        fs.unlinkSync(tarPath);
      }
    } catch (e) {}
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al generar la copia de seguridad' });
    }
  }
});

// Ruta para restaurar backup (tar.gz codificado en base64)
router.post('/stats/restore', (req, res) => {
  const { archive } = req.body;
  if (!archive) {
    return res.status(400).json({ success: false, error: 'No se recibió el archivo de respaldo' });
  }

  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const imagesDir = path.join(__dirname, '../public/images');
  // Usar directorio temporal del sistema para evitar que nodemon reinicie el servidor a mitad de la carga
  const restoreTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'musictracker-restore-'));
  const archivePath = path.join(restoreTempDir, 'archive.tar.gz');
  const jsonPath = path.join(restoreTempDir, 'db_backup.json');

  try {
    // 1. Guardar el archivo tar.gz en el directorio temporal
    const buffer = Buffer.from(archive, 'base64');
    fs.writeFileSync(archivePath, buffer);

    // 2. Extraer el tar.gz en el directorio temporal
    execSync(`tar -xzf ${archivePath} -C ${restoreTempDir}`);

    // 3. Validar existencia del JSON de la base de datos
    if (!fs.existsSync(jsonPath)) {
      throw new Error('El archivo de respaldo no contiene el archivo db_backup.json');
    }

    // 4. Leer y parsear los datos de la base de datos
    const backupData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (!backupData || !Array.isArray(backupData.artists) || !Array.isArray(backupData.albums) || !Array.isArray(backupData.tracks)) {
      throw new Error('El archivo db_backup.json no tiene un formato válido');
    }

    // 5. Ejecutar restauración transaccional de la base de datos
    const insertArtist = db.prepare(`
      INSERT OR REPLACE INTO artists (id, name, image, images, genres, popularity, notes, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAlbum = db.prepare(`
      INSERT OR REPLACE INTO albums (id, artist_id, title, cover_image, release_year, user_rating)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertTrack = db.prepare(`
      INSERT OR REPLACE INTO tracks (id, album_id, title, duration_ms, track_number, is_favorite)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const runRestore = db.transaction((backup) => {
      db.prepare('DELETE FROM tracks').run();
      db.prepare('DELETE FROM albums').run();
      db.prepare('DELETE FROM artists').run();

      for (const a of backup.artists) {
        insertArtist.run(a.id, a.name, a.image, a.images, a.genres, a.popularity, a.notes, a.added_at);
      }
      for (const al of backup.albums) {
        insertAlbum.run(al.id, al.artist_id, al.title, al.cover_image, al.release_year, al.user_rating);
      }
      for (const t of backup.tracks) {
        insertTrack.run(t.id, t.album_id, t.title, t.duration_ms, t.track_number, t.is_favorite);
      }
    });

    runRestore(backupData);

    // 6. Copiar las imágenes restauradas al directorio público principal (limpiando antes para evitar residuos)
    fs.mkdirSync(path.join(imagesDir, 'albums'), { recursive: true });
    fs.mkdirSync(path.join(imagesDir, 'artists'), { recursive: true });

    if (fs.existsSync(path.join(restoreTempDir, 'albums'))) {
      execSync(`rm -rf ${path.join(imagesDir, 'albums')}/*`);
      execSync(`cp -rf ${path.join(restoreTempDir, 'albums')}/* ${path.join(imagesDir, 'albums')}/ 2>/dev/null || true`);
    }
    if (fs.existsSync(path.join(restoreTempDir, 'artists'))) {
      execSync(`rm -rf ${path.join(imagesDir, 'artists')}/*`);
      execSync(`cp -rf ${path.join(restoreTempDir, 'artists')}/* ${path.join(imagesDir, 'artists')}/ 2>/dev/null || true`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error al restaurar backup:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    // 7. Limpiar temporal
    try {
      execSync(`rm -rf ${restoreTempDir}`);
    } catch (cleanErr) {
      console.error('Error al limpiar directorio temporal:', cleanErr);
    }
  }
});

// Ruta para escanear y trasladar fotos huérfanas
router.post('/stats/move-orphans', (req, res) => {
  const fs = require('fs');
  const path = require('path');

  const projectRoot = path.join(__dirname, '..');
  const artistsDir = path.join(projectRoot, 'public', 'images', 'artists');
  const albumsDir = path.join(projectRoot, 'public', 'images', 'albums');
  const huerfanasDir = path.join(projectRoot, 'huerfanas');
  const huerfanasArtists = path.join(huerfanasDir, 'artists');
  const huerfanasAlbums = path.join(huerfanasDir, 'albums');

  try {
    const dbImages = new Set();

    // 1. Obtener imágenes registradas
    const artistsRows = db.prepare('SELECT image, images FROM artists').all();
    artistsRows.forEach(row => {
      if (row.image) dbImages.add(row.image.trim());
      if (row.images) {
        try {
          const gallery = JSON.parse(row.images);
          if (Array.isArray(gallery)) {
            gallery.forEach(img => {
              if (img) dbImages.add(img.trim());
            });
          }
        } catch (e) {}
      }
    });

    const albumsRows = db.prepare('SELECT cover_image FROM albums').all();
    albumsRows.forEach(row => {
      if (row.cover_image && row.cover_image !== 'NO_COVER') {
        dbImages.add(row.cover_image.trim());
      }
    });

    // 2. Crear directorios de destino
    fs.mkdirSync(huerfanasArtists, { recursive: true });
    fs.mkdirSync(huerfanasAlbums, { recursive: true });

    let movedArtists = 0;
    let movedAlbums = 0;

    // 3. Procesar artistas
    if (fs.existsSync(artistsDir)) {
      const files = fs.readdirSync(artistsDir);
      files.forEach(filename => {
        const filePath = path.join(artistsDir, filename);
        if (fs.statSync(filePath).isFile()) {
          const dbRoute = `/images/artists/${filename}`;
          if (!dbImages.has(dbRoute)) {
            const destPath = path.join(huerfanasArtists, filename);
            fs.renameSync(filePath, destPath);
            movedArtists++;
          }
        }
      });
    }

    // 4. Procesar álbumes
    if (fs.existsSync(albumsDir)) {
      const files = fs.readdirSync(albumsDir);
      files.forEach(filename => {
        const filePath = path.join(albumsDir, filename);
        if (fs.statSync(filePath).isFile()) {
          const dbRoute = `/images/albums/${filename}`;
          if (!dbImages.has(dbRoute)) {
            const destPath = path.join(huerfanasAlbums, filename);
            fs.renameSync(filePath, destPath);
            movedAlbums++;
          }
        }
      });
    }

    // 5. Limpiar si quedaron carpetas vacías
    [huerfanasArtists, huerfanasAlbums, huerfanasDir].forEach(dirPath => {
      try {
        if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) {
          fs.rmdirSync(dirPath);
        }
      } catch (e) {}
    });

    res.json({
      success: true,
      movedArtists,
      movedAlbums,
      totalMoved: movedArtists + movedAlbums
    });

  } catch (err) {
    console.error('Error al mover fotos huérfanas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
