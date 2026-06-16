const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'musictracker.db');
const db = new Database(dbPath, { verbose: console.log });

// Habilitar claves foráneas
db.pragma('foreign_keys = ON');

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image TEXT,
    images TEXT,
    genres TEXT,
    popularity INTEGER DEFAULT 100,
    status TEXT DEFAULT 'Siguiendo',
    notes TEXT DEFAULT '',
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Asegurar compatibilidad para bases de datos existentes añadiendo la columna images
try {
  db.exec('ALTER TABLE artists ADD COLUMN images TEXT;');
} catch (e) {
  // Ignorar si la columna ya existe
}

db.exec(`
  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    artist_id TEXT NOT NULL,
    title TEXT NOT NULL,
    cover_image TEXT,
    user_rating REAL DEFAULT 0,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    album_id TEXT NOT NULL,
    title TEXT NOT NULL,
    duration_ms INTEGER,
    track_number INTEGER NOT NULL,
    is_favorite INTEGER DEFAULT 0,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
  );
`);

module.exports = db;
