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

async function applyReversal({ sources, reason, userId, category, auditEntityType, auditEntityId, include }) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new AppError('No hay movimientos para reversar.', 400);
  }
  const dataList = buildReversalDataMany(sources, userId, reason, category);
  try {
    return await prisma.$transaction(async (tx) => {
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
