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
 * Orquesta el storno atómico de un conjunto de Transaction fuente.
 * Crea los compensatorios (tipo invertido) y escribe UN audit REVERSE,
 * todo dentro de una sola transacción Prisma.
 *
 * @param {Object}   params
 * @param {Object[]} params.sources          - Transactions fuente a reversar
 * @param {string}   params.reason           - Motivo del reverso (texto libre)
 * @param {string}   params.userId           - ID del usuario que ejecuta la acción
 * @param {string}   params.category         - Categoría de los compensatorios (ej. 'MANUAL_REVERSAL')
 * @param {string}   params.auditEntityType  - Tipo de entidad para el audit log (ej. 'TRANSACTION')
 * @param {string}   params.auditEntityId    - ID de la entidad principal auditada
 * @param {Object}   [params.include]        - Cláusula Prisma include para los compensatorios (opcional)
 * @param {Object}   [params.client]         - Cliente Prisma a usar; por defecto el módulo-level prisma (opcional, útil en tests)
 * @returns {Promise<Object[]>}              - Array de movimientos compensatorios creados
 */
async function applyReversal({ sources, reason, userId, category, auditEntityType, auditEntityId, include, client = prisma }) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new AppError('No hay movimientos para reversar.', 400);
  }
  const dataList = buildReversalDataMany(sources, userId, reason, category);
  try {
    return await client.$transaction(async (tx) => {
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
    });
  } catch (err) {
    // Backstop a nivel DB: el índice único parcial dispara P2002 si dos
    // requests concurrentes pasan el pre-check y compiten por insertar.
    if (err.code === 'P2002') throw new AppError(ALREADY_REVERSED, 409);
    throw err;
  }
}

module.exports = { applyReversal, ALREADY_REVERSED };
