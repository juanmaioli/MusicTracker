# 🚀 Guía de Variantes: Películas y Música
[Documentación de TMDB API](https://developer.themoviedb.org/docs) | [Documentación de MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)

Este documento detalla los requisitos, modelos de datos y arquitecturas recomendadas para desarrollar variantes de **ShowTracker** orientadas a películas (**MovieTracker**) y música (**MusicTracker**), reutilizando la pila tecnológica actual (Node.js, Express, SQLite, Bootstrap 5.3 y Chart.js).

---

### 1. 🎬 Variante: Películas (MovieTracker)
Esta variante simplifica la estructura al eliminar la jerarquía de temporadas y episodios, enfocándose en la película como unidad atómica de visualización.

#### Esquema de Base de Datos (SQLite)
```sql
-- Tabla principal de películas
CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    release_date TEXT,
    runtime INTEGER, -- Duración en minutos
    image TEXT, -- Ruta local al póster
    background TEXT, -- Ruta local al fondo
    status TEXT, -- Released, Post Production, Rumored
    overview TEXT,
    user_rating REAL DEFAULT 0, -- Calificación del usuario (0-5★)
    watched INTEGER DEFAULT 0, -- 0: No vista, 1: Vista
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Elenco (Cast)
CREATE TABLE IF NOT EXISTS movie_cast (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_id INTEGER NOT NULL,
    actor_name TEXT NOT NULL,
    character_name TEXT,
    image TEXT,
    sort_order INTEGER,
    FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
);
```

#### Integración de API Recomendada
*   **Proveedor:** [TheMovieDB (TMDB) API v3](https://developer.themoviedb.org/docs).
*   **Endpoints Clave:**
    *   Búsqueda: `GET /search/movie?query={busqueda}&language=es-AR`
    *   Detalles: `GET /movie/{id}?language=es-AR&append_to_response=credits,images`
*   **Descarga de Imágenes:** Mapear los paths de TMDB (`poster_path`, `backdrop_path`) y descargarlos en lotes a `public/img/posters/` y `public/img/backgrounds/`.

#### Estadísticas a Adaptar (Chart.js)
*   **Métrica Principal:** Tiempo total de reproducción (suma de `runtime` de películas con `watched = 1`).
*   **Gráfico de Distribución:** Películas vistas por género (gráfico de dona).
*   **Gráfico de Calificaciones:** Historial de puntuaciones de 0 a 5 estrellas (gráfico de barras).

---

### 2. 🎵 Variante: Música (MusicTracker)
Esta variante reemplaza la estructura de Series/Temporadas/Episodios por una jerarquía de Artistas/Álbumes/Canciones.

#### Esquema de Base de Datos (SQLite)
```sql
-- Tabla de Artistas
CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY, -- ID de MusicBrainz (UUID) o Spotify
    name TEXT NOT NULL,
    image TEXT,
    genres TEXT,
    overview TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Álbumes (Equivalente a Series)
CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    artist_id TEXT NOT NULL,
    title TEXT NOT NULL,
    release_year INTEGER,
    cover_image TEXT,
    type TEXT, -- Studio, Live, EP, Compilation
    user_rating REAL DEFAULT 0, -- Calificación (0-5★)
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

-- Tabla de Canciones / Tracks (Equivalente a Episodios)
CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    album_id TEXT NOT NULL,
    title TEXT NOT NULL,
    track_number INTEGER NOT NULL,
    duration_ms INTEGER,
    listened INTEGER DEFAULT 0, -- 0: No escuchada, 1: Escuchada
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);
```

#### Integración de API Recomendada
*   **Proveedor Metadata:** [MusicBrainz API XML/JSON](https://musicbrainz.org/doc/MusicBrainz_API).
*   **Proveedor Portadas (Covers):** [Cover Art Archive API](https://coverartarchive.org/) (gratuita, integrada con IDs de MusicBrainz).
*   **Proveedor Alternativo Completo (Recomendado):** [Spotify Web API](https://developer.spotify.com/documentation/web-api) (requiere autenticación OAuth, provee metadata, previews y portadas de alta calidad).
*   **Endpoints Clave (Spotify):**
    *   Búsqueda: `GET /v1/search?q={busqueda}&type=album,artist`
    *   Álbum y canciones: `GET /v1/albums/{id}`

#### Estadísticas a Adaptar (Chart.js)
*   **Métrica Principal:** Tiempo total escuchado (suma de `duration_ms` de tracks con `listened = 1` convertido a horas).
*   **Gráfico de Distribución:** Álbumes por tipo o género musical (gráfico de dona).
*   **Gráfico de Calificaciones:** Puntuaciones dadas a los álbumes (gráfico de barras).

---

### 3. 🛠️ Tabla Comparativa de Abstracciones

| Entidad ShowTracker | Variante Películas | Variante Música |
| :--- | :--- | :--- |
| **Series** | `movies` | `albums` (o `artists` como contenedor superior) |
| **Seasons** | *No aplica* | *No aplica* (agrupado por álbumes) |
| **Episodes** | *No aplica* (estado `watched` directo en la película) | `tracks` (estado `listened` por canción) |
| **Cast** | `movie_cast` | *No aplica* / Integrantes de banda |
| **Score Promedio** | Directo en `user_rating` | Promedio de `user_rating` de álbumes del artista |

---

## 👤 Autor
* **Juan Gabriel Maioli**
