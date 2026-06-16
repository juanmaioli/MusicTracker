const express = require('express');
const router = express.Router();
const db = require('../db');

// Alternar el estado de favorito de una canción (is_favorite: 1 o 0)
router.post('/:id/favorite', (req, res) => {
  const trackId = req.params.id;

  const track = db.prepare('SELECT is_favorite, album_id FROM tracks WHERE id = ?').get(trackId);
  if (!track) {
    return res.status(404).json({ error: 'Canción no encontrada' });
  }

  const newFavoriteState = track.is_favorite === 1 ? 0 : 1;
  db.prepare('UPDATE tracks SET is_favorite = ? WHERE id = ?').run(newFavoriteState, trackId);

  if (req.xhr || req.headers.accept.indexOf('json') > -1) {
    return res.json({ success: true, is_favorite: newFavoriteState });
  }

  const album = db.prepare('SELECT artist_id FROM albums WHERE id = ?').get(track.album_id);
  res.redirect(`/artists/${album.artist_id}`);
});

module.exports = router;
