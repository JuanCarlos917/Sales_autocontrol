// ═══════════════════════════════════════════════════════════════
// Config — Validación de seguridad para producción
// Exige secretos/credenciales fuertes vía variables de entorno.
// No incrusta ningún valor por defecto (para no tener credenciales en el código):
// la regla es "deben estar definidos y ser suficientemente fuertes".
// ═══════════════════════════════════════════════════════════════

const MIN_SECRET_LENGTH = 32;
const MIN_ADMIN_PASSWORD_LENGTH = 8;
const MIN_ADMIN_PIN_LENGTH = 6;

/**
 * Devuelve la lista de problemas de configuración (vacía si todo OK).
 * Lee de un objeto de entorno (por defecto process.env). No lanza.
 */
function findInsecureConfig(env = process.env) {
  const problems = [];
  const jwtSecret = env.JWT_SECRET;
  const jwtRefresh = env.JWT_REFRESH_SECRET;
  const adminPassword = env.ADMIN_PASSWORD;
  const adminPin = env.ADMIN_PIN;

  if (!jwtSecret || jwtSecret.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_SECRET ausente o de menos de ${MIN_SECRET_LENGTH} caracteres`);
  }
  if (!jwtRefresh || jwtRefresh.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_REFRESH_SECRET ausente o de menos de ${MIN_SECRET_LENGTH} caracteres`);
  }
  if (jwtSecret && jwtRefresh && jwtSecret === jwtRefresh) {
    problems.push('JWT_SECRET y JWT_REFRESH_SECRET deben ser distintos');
  }
  if (!adminPassword || adminPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
    problems.push(`ADMIN_PASSWORD ausente o de menos de ${MIN_ADMIN_PASSWORD_LENGTH} caracteres`);
  }
  if (!adminPin || adminPin.length < MIN_ADMIN_PIN_LENGTH) {
    problems.push(`ADMIN_PIN ausente o de menos de ${MIN_ADMIN_PIN_LENGTH} dígitos`);
  }

  return problems;
}

/**
 * En producción, lanza si la configuración es insegura. En otros entornos no hace nada.
 */
function assertSecureConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const problems = findInsecureConfig(env);
  if (problems.length > 0) {
    throw new Error(
      'Configuración insegura para producción:\n  - ' +
        problems.join('\n  - ') +
        '\nDefine estas variables de entorno antes de iniciar el servidor.'
    );
  }
}

module.exports = {
  findInsecureConfig,
  assertSecureConfig,
  MIN_SECRET_LENGTH,
  MIN_ADMIN_PASSWORD_LENGTH,
  MIN_ADMIN_PIN_LENGTH,
};
