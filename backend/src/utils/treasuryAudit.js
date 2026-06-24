// ═══════════════════════════════════════════════════════════════
// Treasury Audit Helper — escribe a la tabla treasury_audit_logs
//
// Patrón polimórfico (entityType + entityId) para cubrir Transaction,
// Transfer, Account, Payable, PayablePayment con una sola tabla.
//
// Diseño:
//  - Pasar `tx` (cliente Prisma dentro de transacción) cuando la mutación
//    debe ser atómica con el audit. Pasar `prisma` cuando no.
//  - `before` / `after` deben ser plain objects serializables (no incluir
//    relaciones cargadas, solo campos escalares relevantes).
//  - `reason` es texto libre del usuario; si la acción lo requiere
//    (DELETE / CANCEL), el caller debe validarlo antes de invocar.
// ═══════════════════════════════════════════════════════════════

const VALID_ENTITIES = ['TRANSACTION', 'TRANSFER', 'ACCOUNT', 'DEBT', 'PAYABLE', 'PAYABLE_PAYMENT', 'LOAN', 'LOAN_PAYMENT', 'DEBT_PAYMENT', 'CASH_COUNT'];
const VALID_ACTIONS  = ['CREATE', 'UPDATE', 'DELETE', 'CANCEL', 'PAYMENT', 'REVERSE'];

/**
 * Escribe una entrada en treasury_audit_logs.
 *
 * @param {PrismaClient|TransactionClient} prismaOrTx
 * @param {Object}  params
 * @param {string}  params.entityType - uno de: TRANSACTION | TRANSFER | ACCOUNT | PAYABLE | PAYABLE_PAYMENT
 * @param {string}  params.entityId   - id de la entidad afectada
 * @param {string}  params.userId     - id del usuario autor del cambio
 * @param {string}  params.action     - uno de: CREATE | UPDATE | DELETE | CANCEL | PAYMENT
 * @param {Object?} params.before     - snapshot pre-mutación (omitir en CREATE)
 * @param {Object?} params.after      - snapshot post-mutación (omitir en DELETE/CANCEL)
 * @param {string?} params.reason     - motivo del cambio (texto libre)
 * @returns {Promise<TreasuryAuditLog>}
 */
async function writeTreasuryAudit(prismaOrTx, { entityType, entityId, userId, action, before, after, reason }) {
  if (!VALID_ENTITIES.includes(entityType)) {
    throw new Error(`writeTreasuryAudit: entityType inválido: ${entityType}`);
  }
  if (!VALID_ACTIONS.includes(action)) {
    throw new Error(`writeTreasuryAudit: action inválida: ${action}`);
  }
  if (!entityId) throw new Error('writeTreasuryAudit: entityId requerido');
  if (!userId)   throw new Error('writeTreasuryAudit: userId requerido');

  const data = { entityType, entityId, userId, action };
  if (before !== undefined && before !== null) data.before = before;
  if (after  !== undefined && after  !== null) data.after  = after;
  if (reason) data.reason = reason;

  return prismaOrTx.treasuryAuditLog.create({ data });
}

/**
 * Toma una entidad cargada de Prisma y devuelve un snapshot limpio
 * (solo campos escalares, sin relaciones, con Decimales en string).
 * Útil para before/after.
 */
function snapshotEntity(entity, fields) {
  const out = {};
  for (const f of fields) {
    const v = entity[f];
    if (v === undefined) continue;
    if (v instanceof Date) out[f] = v.toISOString();
    else if (v?.toString && typeof v === 'object' && v.constructor?.name === 'Decimal') out[f] = v.toString();
    else out[f] = v;
  }
  return out;
}

module.exports = { writeTreasuryAudit, snapshotEntity, VALID_ENTITIES, VALID_ACTIONS };
