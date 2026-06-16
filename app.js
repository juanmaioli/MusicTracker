require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db'); // Asegura conexión SQLite y creación de tablas

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Express y EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware para favicon emoji global
app.use((req, res, next) => {
  res.locals.faviconEmoji = '🎵';
  next();
});

// Importar rutas
const indexRoutes = require('./routes/index');
const artistsRoutes = require('./routes/artists');
const albumsRoutes = require('./routes/albums');
const tracksRoutes = require('./routes/tracks');

// Cargar rutas
app.use('/', indexRoutes);
app.use('/artists', artistsRoutes);
app.use('/albums', albumsRoutes);
app.use('/tracks', tracksRoutes);

// Manejo 404
app.use((req, res, next) => {
  res.status(404).render('error', { 
    title: '404 - No Encontrado', 
    message: 'La página que estás buscando no existe.' 
  });
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { 
    title: 'Error Interno', 
    message: 'Ocurrió un error en el servidor.' 
  });
});

app.listen(PORT, () => {
  console.log(`Servidor de MusicTracker corriendo en http://localhost:${PORT}`);
});
