const express = require('express');
const router = express.Router();
const db = require('../db');

// Calificar un álbum (0-5 estrellas)
router.post('/:id/rate', (req, res) => {
  const albumId = req.params.id;
  const rating = parseFloat(req.body.rating);

  if (isNaN(rating) || rating < 0 || rating > 5) {
    return res.status(400).json({ error: 'La calificación debe ser un número entre 0 y 5' });
  }

  db.prepare('UPDATE albums SET user_rating = ? WHERE id = ?').run(rating, albumId);
  
  const album = db.prepare('SELECT artist_id FROM albums WHERE id = ?').get(albumId);
  
  if (req.xhr || req.headers.accept.indexOf('json') > -1) {
    return res.json({ success: true, rating });
  }

  res.redirect(`/artists/${encodeURIComponent(album.artist_id)}`);
});

module.exports = router;
