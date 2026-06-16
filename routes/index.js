const express = require('express');
const router = express.Router();
const db = require('../db');

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
    ORDER BY a.added_at DESC
  `).all();

  artists.forEach(a => {
    a.genresList = a.genres ? JSON.parse(a.genres).slice(0, 3) : [];
  });

  res.render('index', {
    totalArtists,
    totalAlbums,
    totalFavorites,
    avgAlbumRating,
    chartGenres,
    artists,
    title: 'Dashboard'
  });
});

module.exports = router;
