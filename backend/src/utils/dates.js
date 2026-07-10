// ═══════════════════════════════════════════════════════════════
// Util — Fechas en zona horaria del negocio (Colombia).
//
// Bucketizar por UTC desplaza los movimientos de la noche colombiana
// (19:00-23:59) al día siguiente en los reportes (auditoría 🟡 #13).
// Todo agrupamiento "por día" de cara al usuario usa esta zona.
// ═══════════════════════════════════════════════════════════════

const BUSINESS_TIMEZONE = 'America/Bogota';

// formatToParts es determinista: el formato de toLocaleDateString varía con
// la versión de ICU (en-CA dejó de garantizar YYYY-MM-DD).
const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Clave de día (YYYY-MM-DD) del instante dado en la zona del negocio.
 * @param {Date|string|number} date
 * @returns {string}
 */
function dayKeyBogota(date) {
  const parts = DAY_FORMATTER.formatToParts(new Date(date));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

module.exports = { dayKeyBogota, BUSINESS_TIMEZONE };
