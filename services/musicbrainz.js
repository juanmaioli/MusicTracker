const https = require('https');
const path = require('path');

// Reutilizar el User-Agent y rate limits recomendados por MusicBrainz
const USER_AGENT = 'MusicTracker/1.3.0 ( juanmaioli@gmail.com )';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': USER_AGENT
      }
    };
    https.get(url, options, (res) => {
      // Manejar redirecciones si se presentan (por ejemplo, en Cover Art Archive)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return getJSON(res.headers.location).then(resolve).catch(reject);
      }
      
      if (res.statusCode !== 200) {
        return reject(new Error(`MusicBrainz HTTP ${res.statusCode} en ${url}`));
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Obtiene los álbumes principales (máximo 10) y sus canciones directamente de MusicBrainz.
 * @param {string} artistName Nombre del artista.
 * @returns {Promise<Array>} Listado de álbumes con sus pistas estructuradas.
 */
async function getArtistAlbumsAndTracks(artistName) {
  try {
    // 1. Buscar el ID del artista (MBID)
    const searchUrl = `https://musicbrainz.org/ws/2/artist?query="${encodeURIComponent(artistName)}"&fmt=json`;
    const searchData = await getJSON(searchUrl);
    const artists = searchData.artists || [];
    if (artists.length === 0) {
      console.warn(`No se encontró el artista "${artistName}" en MusicBrainz.`);
      return [];
    }
    const artistId = artists[0].id;
    console.log(`MusicBrainz: Artista encontrado "${artistName}" con MBID: ${artistId}`);

    // Respetar Rate Limit de 1 req/sec
    await sleep(1000);

    // 2. Obtener todos los release-groups del artista (límite aumentado a 100)
    const rgUrl = `https://musicbrainz.org/ws/2/release-group?artist=${artistId}&limit=100&inc=ratings&fmt=json`;
    const rgData = await getJSON(rgUrl);
    const releaseGroups = rgData['release-groups'] || [];

    // Filtrar álbumes de estudio y directos (descartar compilaciones, remixes, demos, etc.) sin límite
    const filteredGroups = releaseGroups
      .filter(rg => {
        if (rg['primary-type'] !== 'Album') return false;
        
        const secondary = rg['secondary-types'] || [];
        if (secondary.length === 0) return true; // Álbum de estudio convencional
        
        // Permitir si es en vivo (Live) pero descartar compilaciones, remixes, etc.
        const hasLive = secondary.includes('Live');
        const hasExclusions = secondary.some(t => 
          ['Compilation', 'Remix', 'Demo', 'DJ-mix', 'Mixtape/Street', 'Interview', 'Spokenword', 'Audiobook', 'Audio drama'].includes(t)
        );
        
        return hasLive && !hasExclusions;
      })
      .sort((a, b) => {
        const dateA = a['first-release-date'] || '9999';
        const dateB = b['first-release-date'] || '9999';
        return dateA.localeCompare(dateB);
      });

    const albumsWithTracks = [];

    // 3. Para cada álbum seleccionado, traer canciones de forma secuencial
    for (const rg of filteredGroups) {
      await sleep(1000); // Respetar Rate Limit de 1 req/sec de MusicBrainz
      console.log(`MusicBrainz: Consultando canciones del álbum "${rg.title}" (${rg.id})...`);
      
      const releaseUrl = `https://musicbrainz.org/ws/2/release?release-group=${rg.id}&inc=recordings&fmt=json`;
      let tracks = [];
      let coverImage = null;
      let releaseYear = null;

      if (rg['first-release-date']) {
        releaseYear = parseInt(rg['first-release-date'].substring(0, 4)) || null;
      }

      try {
        const releaseData = await getJSON(releaseUrl);
        const releases = releaseData.releases || [];
        
        // Buscar un release oficial que contenga grabaciones
        const officialRelease = releases.find(r => r.status === 'Official' && r.media?.[0]?.tracks?.length > 0) || releases.find(r => r.media?.[0]?.tracks?.length > 0);
        
        if (officialRelease) {
          const media = officialRelease.media[0];
          tracks = (media.tracks || []).map(t => {
            return {
              id: `${rg.id}_${t.number}`, // ID único compuesto
              title: t.title,
              duration_ms: t.length || 0,
              track_number: parseInt(t.number) || 1
            };
          });
        }
      } catch (trackError) {
        console.error(`Error descargando tracks del álbum ${rg.title}:`, trackError.message);
      }

      // Evaluar la regla de importación con excepción para álbumes sin calificar pero con más de 7 temas
      const hasRating = rg.rating && rg.rating.value !== null && rg.rating.value !== undefined;
      const hasMoreThanSevenTracks = tracks.length > 7;

      if (hasRating || hasMoreThanSevenTracks) {
        // La URL de portada de Cover Art Archive basada en el release-group id
        coverImage = `https://coverartarchive.org/release-group/${rg.id}/front`;

        albumsWithTracks.push({
          album: {
            id: rg.id, // El MBID del release-group actúa como id de álbum
            title: rg.title,
            cover_image: coverImage,
            release_year: releaseYear,
            user_rating: hasRating ? rg.rating.value : 0
          },
          tracks
        });
      } else {
        console.log(`MusicBrainz: Omitiendo álbum "${rg.title}" por no estar calificado y poseer solo ${tracks.length} temas (7 o menos).`);
      }
    }

    return albumsWithTracks;
  } catch (error) {
    console.error(`Error integrando MusicBrainz para el artista "${artistName}":`, error.message);
    return [];
  }
}

module.exports = {
  getArtistAlbumsAndTracks
};
