const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '../logs');
const logFile = path.join(logDir, 'importaciones.log');

// Asegurar que la carpeta de logs exista
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * Registra un mensaje de información en consola y en el archivo de logs.
 * @param {string} message - Mensaje a registrar.
 */
function info(message) {
  const timestamp = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const logMessage = `[${timestamp}] INFO: ${message}`;
  
  // Imprimir en consola del servidor
  console.log(message);
  
  // Guardar de forma persistente en el archivo
  try {
    fs.appendFileSync(logFile, logMessage + '\n', 'utf8');
  } catch (err) {
    console.error('Error al escribir en el archivo de log:', err);
  }
}

/**
 * Registra un mensaje de error en consola y en el archivo de logs.
 * @param {string} message - Mensaje de contexto del error.
 * @param {Error|any} errDetails - Objeto de error o detalles.
 */
function error(message, errDetails) {
  const timestamp = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  let logMessage = `[${timestamp}] ERROR: ${message}`;
  if (errDetails) {
    logMessage += ` - ${errDetails.stack || errDetails}`;
  }
  
  // Imprimir en consola del servidor
  console.error(message, errDetails || '');
  
  // Guardar de forma persistente en el archivo
  try {
    fs.appendFileSync(logFile, logMessage + '\n', 'utf8');
  } catch (err) {
    console.error('Error al escribir en el archivo de log:', err);
  }
}

module.exports = {
  info,
  error
};
