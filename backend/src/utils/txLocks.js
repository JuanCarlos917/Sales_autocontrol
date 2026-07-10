// ═══════════════════════════════════════════════════════════════
// Util — Row locks para operaciones de dinero (anti-TOCTOU).
//
// Toda operación que valida un estado (saldo, paidAmount) y luego escribe
// DEBE tomar el lock de la fila padre DENTRO de la $transaction y releer
// ahí. Dos operaciones concurrentes sobre la misma cuenta/entidad quedan
// serializadas por Postgres (la segunda espera el commit de la primera y,
// en READ COMMITTED, sus lecturas posteriores ven ese commit).
//
// Orden de locks (anti-deadlock): entidad padre primero (loan/debt/payable),
// cuenta después. Nunca al revés.
// ═══════════════════════════════════════════════════════════════

// Whitelist de tablas (nombre físico de @@map) — el id va parametrizado.
const TABLES = {
  account: 'accounts',
  loan: 'loans',
  debt: 'debts',
  payable: 'payables',
};

/**
 * Bloquea la fila FOR UPDATE dentro de la transacción dada.
 * No falla si la fila no existe (SELECT vacío): la validación de existencia
 * es responsabilidad del caller al releer.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {'account'|'loan'|'debt'|'payable'} entity
 * @param {string} id
 */
async function lockRow(tx, entity, id) {
  const table = TABLES[entity];
  if (!table) throw new Error(`lockRow: entidad no soportada: ${entity}`);
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
}

module.exports = { lockRow };
