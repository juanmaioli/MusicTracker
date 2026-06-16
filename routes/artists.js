const express = require('express');
const router = express.Router();
const db = require('../db');
const lastfm = require('../services/lastfm');
const imageDownloader = require('../services/imageDownloader');

// Buscar artistas en Last.fm
router.get('/search', async (req, res) => {
  const query = req.query.q || '';
  let results = [];
  if (query.trim() !== '') {
    results = await lastfm.searchArtists(query);
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
  const artistId = req.params.id; // El id es el slug de Last.fm

  // Verificar si ya existe
  const exists = db.prepare('SELECT id FROM artists WHERE id = ?').get(artistId);
  if (exists) {
    return res.redirect(`/artists/${artistId}`);
  }

  try {
    // 1. Obtener detalles del artista y biografía
    const artistData = await lastfm.getArtistDetail(artistId);
    
    // Descargar imagen de artista de forma local
    const localArtistImage = await imageDownloader.saveArtistImage(artistData.image, artistId);
    if (localArtistImage) {
      artistData.image = localArtistImage;
    }

    // Descargar imágenes adicionales de la galería del artista
    const localArtistImages = await imageDownloader.saveArtistGallery(artistData.images, artistId);
    artistData.localImages = localArtistImages;

    // 2. Obtener álbumes
    const albumsData = await lastfm.getArtistAlbums(artistId);

    // 3. Obtener canciones de cada álbum (secuencialmente con un leve delay)
    const albumsWithTracks = [];
    for (const album of albumsData) {
      const tracks = await lastfm.getAlbumTracks(artistId, album.id);
      
      // Descargar portada de álbum de forma local
      const localAlbumCover = await imageDownloader.saveAlbumImage(album.cover_image, artistId, album.id);
      if (localAlbumCover) {
        album.cover_image = localAlbumCover;
      }

      albumsWithTracks.push({ album, tracks });
      // Espera de 300ms entre álbumes
      await lastfm.sleep(300);
    }

    // 4. Inserción transaccional en SQLite
    const insertArtist = db.prepare(`
      INSERT INTO artists (id, name, image, images, genres, notes, popularity)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAlbum = db.prepare(`
      INSERT INTO albums (id, artist_id, title, cover_image, release_year)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertTrack = db.prepare(`
      INSERT INTO tracks (id, album_id, title, duration_ms, track_number)
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
        artist.popularity
      );

      for (const item of data) {
        const { album, tracks } = item;
        insertAlbum.run(
          album.id,
          artist.id,
          album.title,
          album.cover_image,
          album.release_year
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

    res.redirect(`/artists/${artistId}`);
  } catch (error) {
    console.error('Error al importar artista de Last.fm:', error);
    res.status(500).render('error', { message: 'Ocurrió un error al importar el artista y su discografía desde Last.fm.', title: 'Error' });
  }
});

// Actualizar estado de seguimiento
router.post('/:id/status', (req, res) => {
  const artistId = req.params.id;
  const { status } = req.body;

  const validStatuses = ['Siguiendo', 'En pausa', 'Interés'];
  if (!validStatuses.includes(status)) {
    return res.status(400).send('Estado no válido');
  }

  db.prepare('UPDATE artists SET status = ? WHERE id = ?').run(status, artistId);
  res.redirect(`/artists/${artistId}`);
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

module.exports = router;
