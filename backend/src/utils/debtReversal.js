// ═══════════════════════════════════════════════════════════════
// Util — Recálculo de crédito tras un reverso (lógica pura).
//
// Reversar un pago recalcula agregados y distribución FIFO sobre cuotas
// DESDE CERO usando solo los pagos que sobreviven (no reversados).
// Determinístico, sin drift. Los créditos no manejan interés.
// ═══════════════════════════════════════════════════════════════

function tierStatus(target, paid) {
  if (paid <= 0) return 'PENDING';
  if (paid >= target) return 'PAID';
  return 'PARTIAL';
}

function recomputeDebtFromPayments(debt, survivingPayments) {
  const total = parseFloat(debt.totalAmount);
  const paidAmount = survivingPayments.reduce((s, p) => s + parseFloat(p.amount), 0);
  const status = tierStatus(total, paidAmount);

  let remaining = paidAmount;
  const ordered = [...debt.installments].sort((a, b) => a.sequence - b.sequence);
  const installmentUpdates = ordered.map((inst) => {
    const planned = parseFloat(inst.plannedAmount);
    const applied = Math.max(0, Math.min(planned, remaining));
    remaining -= applied;
    return { id: inst.id, paidAmount: applied, status: tierStatus(planned, applied) };
  });

  return { paidAmount, status, installmentUpdates };
}

module.exports = { tierStatus, recomputeDebtFromPayments };
