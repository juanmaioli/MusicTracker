const axios = require('axios');
const cheerio = require('cheerio');

// Cabeceras de navegador completas para emular un cliente real y evitar errores 406 en Last.fm
const browserHeaders = {
  'authority': 'www.last.fm',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
  'cache-control': 'max-age=0',
  'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const http = axios.create({
  headers: browserHeaders
});

// Helper para delay entre peticiones (respetar la carga del sitio)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper para convertir cualquier URL de imagen de Last.fm a su tamaño/formato original sin recortar
function convertToOriginalImage(url) {
  if (!url) return null;
  return url.replace(/\/(avatar70s|avatar170s|174s|300x300|500x500|64s|64)\//i, '/ar0/');
}

// 1. Buscar artistas en Last.fm
async function searchArtists(query) {
  try {
    const url = `https://www.last.fm/es/search/artists?q=${encodeURIComponent(query)}`;
    const { data: html } = await http.get(url);
    const $ = cheerio.load(html);
    const results = [];

    $('.artist-results .artist-result').each((i, el) => {
      if (i >= 10) return; // Retornar máximo 10
      const name = $(el).find('.artist-result-heading a').text().trim();
      const href = $(el).find('.artist-result-heading a').attr('href');
      const slug = href ? href.split('/es/music/')[1] : null;
      let image = $(el).find('.artist-result-image img').attr('src');
      
      // Convertir imagen al formato original sin recortar
      image = convertToOriginalImage(image);

      if (name && slug) {
        results.push({
          id: slug, // El slug actúa como ID único local
          name,
          image: image || null,
          genres: [],
          popularity: 100 // Last.fm no da score de popularidad directo en búsqueda
        });
      }
    });

    return results;
  } catch (error) {
    console.error(`Error de búsqueda scrapeando Last.fm para "${query}":`, error.message);
    return [];
  }
}

// 2. Obtener detalles y biografía del artista
async function getArtistDetail(artistSlug) {
  try {
    // Primero, la bio completa desde +wiki
    const wikiUrl = `https://www.last.fm/es/music/${artistSlug}/+wiki`;
    const { data: wikiHtml } = await http.get(wikiUrl);
    const $wiki = cheerio.load(wikiHtml);

    let fullBio = $wiki('.wiki-content').text().trim() || $wiki('.wiki-page-content').text().trim();
    
    // Si no la encuentra, intentar con la biografía corta del perfil principal
    if (!fullBio) {
      const artistUrl = `https://www.last.fm/es/music/${artistSlug}`;
      const { data: mainHtml } = await http.get(artistUrl);
      const $main = cheerio.load(mainHtml);
      fullBio = $main('.wiki-block-inner').text().trim() || 'Sin biografía disponible.';
    }

    // Limpiar texto de la bio (Last.fm suele poner publicidad o copyright al final)
    if (fullBio.includes('Descripción aportada por el usuario')) {
      fullBio = fullBio.split('Descripción aportada por el usuario')[0].trim();
    }

    // Extraer tags/géneros del perfil del artista en la página principal
    const genres = [];
    const images = [];
    try {
      const artistUrl = `https://www.last.fm/es/music/${artistSlug}`;
      const { data: mainHtml } = await http.get(artistUrl);
      const $main = cheerio.load(mainHtml);
      
      $main('.tags .tag a').each((_, el) => {
        const tag = $main(el).text().trim();
        if (tag && !genres.includes(tag)) {
          genres.push(tag);
        }
      });

      // Intentar obtener todas las imágenes desde la sección de galería /+images
      try {
        const imagesUrl = `https://www.last.fm/es/music/${artistSlug}/+images`;
        const { data: imagesHtml } = await http.get(imagesUrl);
        const $images = cheerio.load(imagesHtml);
        
        $images('.image-list-item-wrapper img').each((_, el) => {
          let src = $images(el).attr('src');
          if (src) {
            src = convertToOriginalImage(src);
            if (src && !images.includes(src)) {
              images.push(src);
            }
          }
        });

        // Fallback si no encuentra wrapper común
        if (images.length === 0) {
          $images('.image-list img').each((_, el) => {
            let src = $images(el).attr('src');
            if (src) {
              src = convertToOriginalImage(src);
              if (src && !images.includes(src)) {
                images.push(src);
              }
            }
          });
        }
      } catch (galleryErr) {
        console.log('Error al acceder a la galería /+images, usando fallback lateral:', galleryErr.message);
      }

      // Fallback final: si la galería dio 0 imágenes, extraer de la barra lateral de la página principal
      if (images.length === 0) {
        $main('.sidebar-image-list-image').each((_, el) => {
          let src = $main(el).attr('src');
          if (src) {
            src = convertToOriginalImage(src);
            if (src && !images.includes(src)) {
              images.push(src);
            }
          }
        });
      }
    } catch (e) {
      console.log('No se pudieron extraer géneros o imágenes del artista.');
    }

    // Para la imagen grande, usamos el avatar y lo ampliamos a 500x500
    // (Buscamos la imagen del artista en la búsqueda si no viene en el wiki)
    let imageUrl = null;
    try {
      const searchUrl = `https://www.last.fm/es/search/artists?q=${artistSlug}`;
      const { data: searchHtml } = await http.get(searchUrl);
      const $search = cheerio.load(searchHtml);
      const rawImg = $search('.artist-results .artist-result-image img').first().attr('src');
      imageUrl = convertToOriginalImage(rawImg);
    } catch (e) {
      console.log('No se pudo resolver imagen grande del artista.');
    }

    // Si aún no hay imagen, intentamos con og:image
    if (!imageUrl) {
      imageUrl = $wiki('meta[property="og:image"]').attr('content') || null;
    }

    return {
      id: artistSlug,
      name: decodeURIComponent(artistSlug).replace(/\+/g, ' '),
      image: imageUrl,
      images: images,
      genres: genres.slice(0, 5),
      biography: fullBio,
      popularity: 100
    };
  } catch (error) {
    console.error(`Error obteniendo detalles del artista ${artistSlug}:`, error.message);
    throw error;
  }
}

// 3. Obtener álbumes de un artista
async function getArtistAlbums(artistSlug) {
  try {
    const url = `https://www.last.fm/es/music/${artistSlug}/+albums`;
    const { data: html } = await http.get(url);
    const $ = cheerio.load(html);
    const albums = [];
    const seenSlugs = new Set();

    $('.resource-list--release-list li').each((i, el) => {
      if (albums.length >= 10) return; // Limitar a los 10 primeros por rendimiento y cuotas de scraping

      // Buscar el link
      let href = null;
      $(el).find('a').each((_, aEl) => {
        const h = $(aEl).attr('href');
        if (h && h.includes(`/es/music/${artistSlug}/`) && !h.includes('/+')) {
          href = h;
        }
      });

      if (href) {
        const albumSlug = decodeURIComponent(href.split(`/es/music/${artistSlug}/`)[1] || href.split('/').pop());
        const title = $(el).find('.link-block-target').text().trim() || albumSlug.replace(/\+/g, ' ');
        let cover = $(el).find('.cover-art img').attr('src') || $(el).find('img').attr('src');

        // Extraer texto auxiliar de fecha y buscar el año de lanzamiento (4 dígitos)
        const auxText = $(el).find('.resource-list--release-list-item-aux-text').not('.resource-list--release-list-item-listeners').text().trim();
        const match = auxText.match(/\b(19\d\d|20\d\d)\b/);
        const releaseYear = match ? parseInt(match[1]) : null;

        // Obtener portada del álbum en su formato y tamaño original
        cover = convertToOriginalImage(cover);

        if (albumSlug && !seenSlugs.has(albumSlug) && albumSlug !== '+albums') {
          seenSlugs.add(albumSlug);
          albums.push({
            id: albumSlug, // El slug actúa como ID
            title,
            cover_image: cover || null,
            release_year: releaseYear
          });
        }
      }
    });

    return albums;
  } catch (error) {
    console.error(`Error scrapeando álbumes del artista ${artistSlug}:`, error.message);
    return [];
  }
}

// 4. Obtener canciones de un álbum
async function getAlbumTracks(artistSlug, albumSlug) {
  try {
    const url = `https://www.last.fm/es/music/${artistSlug}/${albumSlug}`;
    const { data: html } = await http.get(url);
    const $ = cheerio.load(html);
    const tracks = [];

    $('.chartlist .chartlist-row').each((i, el) => {
      const title = $(el).find('.chartlist-name a').text().trim() || $(el).find('.chartlist-name').text().trim();
      const durationStr = $(el).find('.chartlist-duration').text().trim();
      const trackNumber = parseInt($(el).find('.chartlist-index').text().trim()) || (i + 1);

      // Convertir mm:ss a duration_ms
      let durationMs = 0;
      if (durationStr) {
        const parts = durationStr.split(':');
        if (parts.length === 2) {
          const minutes = parseInt(parts[0]);
          const seconds = parseInt(parts[1]);
          durationMs = (minutes * 60 + seconds) * 1000;
        }
      }

      if (title) {
        tracks.push({
          id: `${artistSlug}_${albumSlug}_${trackNumber}`, // ID compuesto para evitar duplicados en SQLite
          title,
          duration_ms: durationMs,
          track_number: trackNumber
        });
      }
    });

    return tracks;
  } catch (error) {
    console.error(`Error scrapeando tracks del álbum ${albumSlug} de ${artistSlug}:`, error.message);
    return [];
  }
}

// 5. Obtener calificaciones de álbumes de MusicBrainz por lote
async function getMusicBrainzRatings(artistName) {
  const ratingsMap = {};
  try {
    // 1. Buscar el ID del artista en MusicBrainz
    const searchUrl = `https://musicbrainz.org/ws/2/artist?query="${encodeURIComponent(artistName)}"&fmt=json`;
    const { data: artistData } = await http.get(searchUrl, {
      headers: { 'User-Agent': 'MusicTracker/1.3.0 ( juanmaioli@gmail.com )' }
    });

    const artists = artistData.artists;
    if (!artists || artists.length === 0) {
      return ratingsMap;
    }

    const artistId = artists[0].id;

    // Respetar el Rate Limit de 1 req/sec de MusicBrainz
    await sleep(1000);

    // 2. Obtener todos los release-groups del artista con ratings
    const rgUrl = `https://musicbrainz.org/ws/2/release-group?artist=${artistId}&limit=100&inc=ratings&fmt=json`;
    const { data: rgData } = await http.get(rgUrl, {
      headers: { 'User-Agent': 'MusicTracker/1.3.0 ( juanmaioli@gmail.com )' }
    });

    const releaseGroups = rgData['release-groups'] || [];
    
    // Función auxiliar interna para normalizar nombres
    const cleanName = (str) => {
      if (!str) return '';
      return str.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    releaseGroups.forEach(rg => {
      if (rg.title && rg.rating && rg.rating.value !== null) {
        const cleanedTitle = cleanName(rg.title);
        ratingsMap[cleanedTitle] = rg.rating.value;
      }
    });

  } catch (error) {
    console.error(`Error obteniendo ratings de MusicBrainz para "${artistName}":`, error.message);
  }
  return ratingsMap;
}

module.exports = {
  searchArtists,
  getArtistDetail,
  getArtistAlbums,
  getAlbumTracks,
  getMusicBrainzRatings,
  sleep
};

