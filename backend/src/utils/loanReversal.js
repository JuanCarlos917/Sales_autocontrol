// ═══════════════════════════════════════════════════════════════
// Util — Recálculo de préstamo tras un reverso (lógica pura).
//
// Reversar un pago no "deshace" en sitio: recalcula los agregados del
// préstamo y la distribución de capital sobre las cuotas DESDE CERO, usando
// solo los pagos que sobreviven (no reversados). Determinístico, sin drift.
// ═══════════════════════════════════════════════════════════════

function tierStatus(target, paid) {
  if (paid <= 0) return 'PENDING';
  if (paid >= target) return 'PAID';
  return 'PARTIAL';
}

function recomputeLoanFromPayments(loan, survivingPayments) {
  const principal = parseFloat(loan.principalAmount);
  const interest = parseFloat(loan.interestAmount);
  const totalToRepay = principal + interest;

  const paidAmount = survivingPayments.reduce((s, p) => s + parseFloat(p.principalAmount), 0);
  // interestReceived summed from survivors' stored interestPortion by design: mirrors
  // the LOAN_INTEREST_INCOME entries that were recorded at payment time (which the
  // compensating reversal entries undo). Do not re-split from scratch here.
  const interestReceived = survivingPayments.reduce((s, p) => s + parseFloat(p.interestPortion), 0);
  const extraReceived = survivingPayments.reduce((s, p) => s + parseFloat(p.extraAmount), 0);
  const status = tierStatus(totalToRepay, paidAmount);

  // Re-aplica el capital total pagado sobre las cuotas en orden de secuencia.
  let remaining = paidAmount;
  const ordered = [...loan.installments].sort((a, b) => a.sequence - b.sequence);
  const installmentUpdates = ordered.map((inst) => {
    const planned = parseFloat(inst.plannedAmount);
    const applied = Math.max(0, Math.min(planned, remaining));
    remaining -= applied;
    return { id: inst.id, paidAmount: applied, status: tierStatus(planned, applied) };
  });

  return { paidAmount, interestReceived, extraReceived, status, installmentUpdates };
}

module.exports = { tierStatus, recomputeLoanFromPayments };
