const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'musictracker.db');
const db = new Database(dbPath);

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

// Asegurar compatibilidad para bases de datos existentes añadiendo la columna metadata
try {
  db.exec('ALTER TABLE artists ADD COLUMN metadata TEXT;');
} catch (e) {
  // Ignorar si la columna ya existe
}

db.exec(`
  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    artist_id TEXT NOT NULL,
    title TEXT NOT NULL,
    cover_image TEXT,
    release_year INTEGER,
    user_rating REAL DEFAULT 0,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
  );
`);

// Asegurar compatibilidad para bases de datos existentes añadiendo la columna release_year
try {
  db.exec('ALTER TABLE albums ADD COLUMN release_year INTEGER;');
} catch (e) {
  // Ignorar si la columna ya existe
}

db.exec(`

  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    album_id TEXT NOT NULL,
    title TEXT NOT NULL,
    duration_ms INTEGER,
    track_number INTEGER NOT NULL,
    is_favorite INTEGER DEFAULT 0,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS import_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    total_items INTEGER NOT NULL DEFAULT 0,
    completed_items INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS import_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    processed_at DATETIME,
    FOREIGN KEY (job_id) REFERENCES import_jobs(id) ON DELETE CASCADE
  );
`);

module.exports = db;
