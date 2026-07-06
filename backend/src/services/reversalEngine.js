// ═══════════════════════════════════════════════════════════════
// Reversal Engine — orquesta el storno de una operación.
//
// Recibe las Transaction fuente, crea sus compensatorias (tipo
// invertido) y escribe UN audit REVERSE, todo atómico. Cada dominio
// (movimientos, préstamos, créditos…) solo decide qué fuentes pasar.
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { buildReversalDataMany } = require('../utils/transactionReversal');
const { writeTreasuryAudit } = require('../utils/treasuryAudit');

const ALREADY_REVERSED = 'Esta operación ya fue reversada.';

/**
 * Núcleo del reverso DENTRO de una transacción ya abierta: crea los
 * compensatorios + 1 audit REVERSE con el `tx` provisto. No abre transacción
 * ni mapea P2002 — eso lo hace el caller (applyReversal o un servicio de
 * dominio que compone más mutaciones en la misma tx).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Object}  params
 * @param {Array}   params.sources          transacciones origen
 * @param {string}  params.reason
 * @param {string}  params.userId
 * @param {string}  params.category          categoría del compensatorio
 * @param {string}  params.auditEntityType
 * @param {string}  params.auditEntityId
 * @param {Object} [params.include]          include Prisma opcional
 * @returns {Promise<Array>} compensatorios creados
 */
async function applyReversalInTx(tx, { sources, reason, userId, category, auditEntityType, auditEntityId, include }) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new AppError('No hay movimientos para reversar.', 400);
  }
  const dataList = buildReversalDataMany(sources, userId, reason, category);
  const compensating = [];
  for (const data of dataList) {
    compensating.push(await tx.transaction.create({ data, include }));
  }
  await writeTreasuryAudit(tx, {
    entityType: auditEntityType,
    entityId: auditEntityId,
    userId,
    action: 'REVERSE',
    after: { compensatingIds: compensating.map((c) => c.id), count: compensating.length },
    reason,
  });
  return compensating;
}

/**
 * Reverso atómico autónomo: abre su propia transacción y mapea el índice
 * único parcial (P2002) → 409. Para dominios que solo crean compensatorios.
 *
 * @param {Object}  params  (ver applyReversalInTx)
 * @param {Object} [params.client]  cliente Prisma; default el módulo (útil en tests)
 */
async function applyReversal({ sources, reason, userId, category, auditEntityType, auditEntityId, include, client = prisma }) {
  try {
    return await client.$transaction((tx) =>
      applyReversalInTx(tx, { sources, reason, userId, category, auditEntityType, auditEntityId, include }),
    );
  } catch (err) {
    if (err.code === 'P2002') throw new AppError(ALREADY_REVERSED, 409);
    throw err;
  }
}

module.exports = { applyReversal, applyReversalInTx, ALREADY_REVERSED };
