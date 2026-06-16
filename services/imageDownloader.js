const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ARTISTS_DIR = path.join(__dirname, '..', 'public', 'images', 'artists');
const ALBUMS_DIR = path.join(__dirname, '..', 'public', 'images', 'albums');

// Asegurar que existan los directorios
function ensureDirectories() {
  if (!fs.existsSync(ARTISTS_DIR)) {
    fs.mkdirSync(ARTISTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(ALBUMS_DIR)) {
    fs.mkdirSync(ALBUMS_DIR, { recursive: true });
  }
}

/**
 * Descarga una imagen desde una URL y la guarda en la ruta física local.
 */
async function downloadImage(url, destPath) {
  if (!url) return null;
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destPath);
      response.data.pipe(writer);
      writer.on('finish', () => resolve(true));
      writer.on('error', (err) => {
        writer.close();
        reject(err);
      });
    });
  } catch (error) {
    console.error(`Error descargando imagen desde ${url}:`, error.message);
    return null;
  }
}

/**
 * Descarga y guarda la imagen de un artista de forma local.
 * Retorna la ruta web relativa a la carpeta public o null.
 */
async function saveArtistImage(url, artistSlug) {
  if (!url) return null;
  ensureDirectories();
  
  // Extraer extensión de la url limpia (sin queries de tamaño)
  let cleanUrl = url.split('?')[0];
  let ext = path.extname(cleanUrl) || '.jpg';
  // Si la extensión es inválida o no es común, forzar .jpg
  if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext.toLowerCase())) {
    ext = '.jpg';
  }
  
  // Limpiar slug para archivo
  const safeSlug = artistSlug.replace(/[^a-zA-Z0-9-_]/g, '_');
  const filename = `${safeSlug}${ext}`;
  const destPath = path.join(ARTISTS_DIR, filename);
  
  const success = await downloadImage(url, destPath);
  return success ? `/images/artists/${filename}` : null;
}

/**
 * Descarga y guarda la imagen de un álbum de forma local.
 * Retorna la ruta web relativa a la carpeta public o null.
 */
async function saveAlbumImage(url, artistSlug, albumSlug) {
  if (!url) return null;
  ensureDirectories();
  
  let cleanUrl = url.split('?')[0];
  let ext = path.extname(cleanUrl) || '.jpg';
  if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext.toLowerCase())) {
    ext = '.jpg';
  }
  
  const safeArtistSlug = artistSlug.replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeAlbumSlug = albumSlug.replace(/[^a-zA-Z0-9-_]/g, '_');
  const filename = `${safeArtistSlug}_${safeAlbumSlug}${ext}`;
  const destPath = path.join(ALBUMS_DIR, filename);
  
  const success = await downloadImage(url, destPath);
  return success ? `/images/albums/${filename}` : null;
}

/**
 * Descarga y guarda múltiples fotos de galería de un artista.
 * Retorna un array con las rutas locales exitosas.
 */
async function saveArtistGallery(urls, artistSlug) {
  if (!urls || !Array.isArray(urls) || urls.length === 0) return [];
  ensureDirectories();

  const localPaths = [];
  const safeSlug = artistSlug.replace(/[^a-zA-Z0-9-_]/g, '_');

  for (let idx = 0; idx < urls.length; idx++) {
    const url = urls[idx];
    let cleanUrl = url.split('?')[0];
    let ext = path.extname(cleanUrl) || '.jpg';
    if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext.toLowerCase())) {
      ext = '.jpg';
    }

    const filename = `${safeSlug}_gallery_${idx}${ext}`;
    const destPath = path.join(ARTISTS_DIR, filename);

    const success = await downloadImage(url, destPath);
    if (success) {
      localPaths.push(`/images/artists/${filename}`);
    }
    // Breve delay de 50ms para no saturar al descargar muchas fotos seguidas
    await new Promise(r => setTimeout(r, 50));
  }

  return localPaths;
}

/**
 * Elimina un archivo de imagen física si existe localmente.
 * Recibe una ruta relativa de la forma '/images/artists/filename.ext'
 */
function deleteImage(relativePath) {
  if (!relativePath) return;
  // Solo borrar si es una ruta local que empieza con /images/
  if (!relativePath.startsWith('/images/')) return;
  
  const fullPath = path.join(__dirname, '..', 'public', relativePath);
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (error) {
    console.error(`Error al eliminar imagen física en ${fullPath}:`, error.message);
  }
}

module.exports = {
  saveArtistImage,
  saveAlbumImage,
  saveArtistGallery,
  deleteImage
};
