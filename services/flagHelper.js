const fs = require('fs');
const path = require('path');

// Función helper para resolver la ruta de la bandera de un país/lugar
function getFlagPath(locationStr) {
  if (!locationStr) return null;
  const cleanStr = locationStr.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9\s,]/g, '');

  const termMap = {
    'russia': 'federacionrusa',
    'rusia': 'federacionrusa',
    'federacion rusa': 'federacionrusa',
    'russian federation': 'federacionrusa',
    'united kingdom': 'reinounido',
    'reino unido': 'reinounido',
    'england': 'reinounido',
    'inglaterra': 'reinounido',
    'london': 'reinounido',
    'uk': 'reinounido',
    'scotland': 'escocia',
    'wales': 'gales',
    'ireland': 'irlanda',
    'united states': 'estadosunidos',
    'estados unidos': 'estadosunidos',
    'usa': 'estadosunidos',
    'u.s.a.': 'estadosunidos',
    'ee.uu.': 'estadosunidos',
    'eeuu': 'estadosunidos',
    'us': 'estadosunidos',
    'germany': 'alemania',
    'spain': 'espana',
    'españa': 'espana',
    'france': 'francia',
    'sweden': 'suecia',
    'norway': 'noruega',
    'finland': 'finlandia',
    'denmark': 'dinamarca',
    'belgium': 'belgica',
    'netherlands': 'paisesbajos',
    'holland': 'paisesbajos',
    'brazil': 'brasil',
    'japan': 'japon',
    'canada': 'canada',
    'australia': 'australia',
    'new zealand': 'nuevazelandia',
    'italy': 'italia',
    'italia': 'italia',
    'china': 'china',
    'bosnia': 'bosniaherzegovina',
    'herzegovina': 'bosniaherzegovina',
    'bosnia y herzegovina': 'bosniaherzegovina',
    'bosnia and herzegovina': 'bosniaherzegovina',
    'switzerland': 'suiza',
    'puerto rico': 'puertorico',
    'egypt': 'egipto',
    'egipto': 'egipto',
    'philippines': 'filipinas',
    'filipinas': 'filipinas'
  };

  for (const [key, val] of Object.entries(termMap)) {
    const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const isShort = key.length <= 3;
    const regex = new RegExp(isShort ? '\\b' + escapedKey + '\\b' : escapedKey);
    if (regex.test(cleanStr)) {
      const flagPath = `/images/Banderas/${val}.png`;
      if (fs.existsSync(path.join(process.cwd(), 'public', flagPath))) {
        return flagPath;
      }
    }
  }

  const parts = cleanStr.split(',').map(p => p.trim().replace(/\s+/g, ''));
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (!part) continue;
    const flagPath = `/images/Banderas/${part}.png`;
    if (fs.existsSync(path.join(process.cwd(), 'public', flagPath))) {
      return flagPath;
    }
  }

  const words = cleanStr.replace(/,/g, ' ').split(/\s+/).map(w => w.trim());
  for (const word of words) {
    if (word.length < 3) continue;
    const flagPath = `/images/Banderas/${word}.png`;
    if (fs.existsSync(path.join(process.cwd(), 'public', flagPath))) {
      return flagPath;
    }
  }
  return null;
}

module.exports = {
  getFlagPath
};
