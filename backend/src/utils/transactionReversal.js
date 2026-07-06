// ═══════════════════════════════════════════════════════════════
// Util — Reverso de movimientos manuales (lógica pura, sin Prisma)
//
// Un movimiento es reversable solo si es manual: sin entidad ligada,
// no es a su vez un reverso, y no fue reversado antes. El reverso crea
// un movimiento compensatorio (tipo invertido) — nunca borra.
// ═══════════════════════════════════════════════════════════════

const LINKED_FIELDS = ['expenseId', 'loanId', 'loanPaymentId', 'debtId', 'transferId'];
const MANUAL_REVERSAL = 'MANUAL_REVERSAL';

/**
 * @param {{ type:string, expenseId?:string, loanId?:string, loanPaymentId?:string,
 *   debtId?:string, transferId?:string, reversesTransactionId?:string,
 *   hasPayablePayment:boolean, alreadyReversed:boolean }} tx
 * @returns {{ status:number, message:string } | null}
 */
function getReversibilityError(tx) {
  if (tx.reversesTransactionId) {
    return { status: 400, message: 'Un reverso o ajuste no se puede reversar.' };
  }
  if (tx.alreadyReversed) {
    return { status: 409, message: 'Este movimiento ya fue reversado.' };
  }
  if (tx.hasPayablePayment || LINKED_FIELDS.some((f) => tx[f])) {
    return {
      status: 403,
      message: 'Este movimiento proviene de otra operación (gasto, préstamo, pago o transferencia) y no se puede reversar directamente.',
    };
  }
  if (tx.type !== 'INCOME' && tx.type !== 'EXPENSE') {
    return { status: 403, message: 'Solo se pueden reversar ingresos o egresos manuales.' };
  }
  return null;
}

const FLIP = { INCOME: 'EXPENSE', EXPENSE: 'INCOME', TRANSFER_IN: 'TRANSFER_OUT', TRANSFER_OUT: 'TRANSFER_IN' };

function flipType(type) {
  const flipped = FLIP[type];
  if (!flipped) throw new Error(`flipType: tipo no reversable: ${type}`);
  return flipped;
}

/**
 * Construye el `data` del movimiento compensatorio.
 * @param {{ id:string, accountId:string, type:string, amount:any, vehicleId?:string, thirdPartyId?:string }} original
 * @param {string} userId
 * @param {string} reason
 * @param {string} [category=MANUAL_REVERSAL]
 */
function buildReversalData(original, userId, reason, category = MANUAL_REVERSAL) {
  const flippedType = flipType(original.type);
  const ref = `#${String(original.id).slice(-6)}`;
  return {
    accountId: original.accountId,
    type: flippedType,
    category,
    amount: original.amount,
    description: `Reverso de ${ref} — ${reason}`,
    reversesTransactionId: original.id,
    vehicleId: original.vehicleId ?? null,
    thirdPartyId: original.thirdPartyId ?? null,
    createdBy: userId,
  };
}

function buildReversalDataMany(sources, userId, reason, category = MANUAL_REVERSAL) {
  return sources.map((s) => buildReversalData(s, userId, reason, category));
}

module.exports = { LINKED_FIELDS, MANUAL_REVERSAL, getReversibilityError, buildReversalData, buildReversalDataMany, flipType };
