// ═══════════════════════════════════════════════════════════════
// buildPaymentTransactions — decide los asientos de tesorería de un
// pago de CxC/CxP. Puro (no toca la DB): el caller crea las
// transacciones y liga el PayablePayment al índice `paymentTransactionIndex`.
//
// FASE B: si la CxP no es RECEIVABLE y el tercero tiene cuenta SOCIO
// activa, el pago es EGRESO (cuenta empresa elegida) + INGRESO (cuenta
// socio), preservando la categoría (PARTNER_SHARE/COMMISSION) en ambos.
// ═══════════════════════════════════════════════════════════════

const { AppError } = require('../middleware/errorHandler');

function buildPaymentTransactions({
  transactionType,
  transactionCategory,
  accountId,
  socioAccount,
  isReceivable,
  paymentAmount,
  description,
  payableDescription,
  date,
  vehicleId,
  thirdPartyId,
  userId,
}) {
  const baseDesc =
    description || `Pago ${isReceivable ? 'recibido' : 'realizado'}: ${payableDescription || ''}`;

  const routed = !isReceivable && socioAccount != null;

  if (!routed) {
    return {
      entries: [
        {
          accountId,
          type: transactionType,
          category: transactionCategory,
          amount: paymentAmount,
          description: baseDesc,
          date,
          vehicleId,
          thirdPartyId,
          createdBy: userId,
        },
      ],
      paymentTransactionIndex: 0,
    };
  }

  if (accountId === socioAccount.id) {
    throw new AppError('La cuenta origen no puede ser la cuenta del socio destino.', 400);
  }

  const egreso = {
    accountId,
    type: 'EXPENSE',
    category: transactionCategory,
    amount: paymentAmount,
    description: baseDesc,
    date,
    vehicleId,
    thirdPartyId,
    createdBy: userId,
  };
  const ingreso = {
    accountId: socioAccount.id,
    type: 'INCOME',
    category: transactionCategory,
    amount: paymentAmount,
    description: `Entrada a cuenta socio — ${baseDesc}`,
    date,
    vehicleId,
    thirdPartyId,
    createdBy: userId,
  };

  return { entries: [egreso, ingreso], paymentTransactionIndex: 0 };
}

module.exports = { buildPaymentTransactions };
