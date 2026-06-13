// ═══════════════════════════════════════════════════════════════
// Utils — Cálculos Financieros del Negocio
// ═══════════════════════════════════════════════════════════════

/**
 * Calcula días entre dos fechas (o hasta hoy si no hay fecha final)
 */
function daysBetween(startDate, endDate = null) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  return Math.max(0, Math.floor((end - start) / 86400000));
}

/**
 * Calcula todas las métricas financieras de un vehículo, incluyendo
 * la ganancia proyectada/real y la distribución con socio si aplica.
 *
 * Reglas:
 *  - Si el vehículo está VENDIDO: ganancia real con salePrice.
 *  - Si NO está vendido y tiene listedPrice: ganancia proyectada (flag isProjected=true).
 *  - Con socio (participation < 1):
 *     · partnerAssumesExpenses=true  → socio asume su parte de gastos (pro-rata sobre ganancia neta).
 *     · partnerAssumesExpenses=false → yo asumo 100% de gastos; socio recibe su % sobre ganancia bruta (salePrice - purchasePrice).
 */
function calculateVehicleMetrics(vehicle, fixedMonthly = 800000, commissionPayables = []) {
  const expenses = vehicle.expenses || [];

  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const repairs = expenses
    .filter(e => ['MECANICA', 'ESTETICA'].includes(e.category))
    .reduce((sum, e) => sum + Number(e.amount), 0);

  // Comisiones: ya no se modelan como Expense con categoría COMISION (eliminada).
  // Se computan desde los Payable type=COMMISSION asociados al vehículo, que vienen
  // del flujo de venta (un Payable por participante: captador, cerrador).
  // El total es informativo; lo PAGADO es lo que efectivamente descuenta del netProfit
  // (un Payable PENDING todavía no salió de tesorería).
  const commissionTotal = commissionPayables.reduce((sum, p) => sum + Number(p.totalAmount || 0), 0);
  const commissionPaid = commissionPayables.reduce((sum, p) => sum + Number(p.paidAmount || 0), 0);
  const commissionPending = commissionTotal - commissionPaid;
  const sumByRole = (role) => commissionPayables
    .filter(p => (p.saleParticipant?.role || p.role) === role)
    .reduce((sum, p) => sum + Number(p.totalAmount || 0), 0);
  const commissionCaptador = sumByRole('CAPTADOR');
  const commissionCerrador = sumByRole('CERRADOR');

  const taxes = expenses
    .filter(e => ['IMPUESTOS', 'TRAMITE'].includes(e.category))
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const unpaidExpenses = expenses
    .filter(e => !e.paid)
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const isSold = vehicle.stage === 'VENDIDO';
  const daysInInventory = daysBetween(vehicle.purchaseDate, isSold ? vehicle.saleDate : null);
  const fixedProrated = (daysInInventory / 30) * fixedMonthly;

  const purchasePrice = Number(vehicle.purchasePrice || 0);
  const realCost = purchasePrice + totalExpenses;
  const realCostWithFixed = realCost + fixedProrated;

  const salePrice = Number(vehicle.salePrice || 0);
  const listedPrice = Number(vehicle.listedPrice || 0);

  // Precio de referencia para el cálculo de ganancia
  // (salePrice si vendido; listedPrice como proyección si no)
  const referencePrice = isSold ? salePrice : listedPrice;
  const hasProfitData = purchasePrice > 0 && referencePrice > 0;

  const participation = Number(vehicle.participation || 1);
  const partnerShare = 1 - participation;
  const partnerAssumesExpenses = vehicle.partnerAssumesExpenses !== false; // default true

  let netProfit = null;
  let myProfit = null;
  let partnerProfit = null;
  let roi = null;

  if (hasProfitData) {
    // netProfit descuenta solo la comisión PAGADA (el pendiente todavía no salió de caja).
    netProfit = referencePrice - realCostWithFixed - commissionPaid;
    roi = realCostWithFixed > 0 ? netProfit / realCostWithFixed : 0;

    if (partnerShare > 0 && !partnerAssumesExpenses) {
      // Yo asumo 100% de los gastos; socio recibe % sobre ganancia bruta (venta - compra)
      const grossProfit = referencePrice - purchasePrice;
      partnerProfit = grossProfit * partnerShare;
      myProfit = netProfit - partnerProfit;
    } else {
      // Pro-rata: socio y yo repartimos ganancia neta según participación
      myProfit = netProfit * participation;
      partnerProfit = netProfit * partnerShare;
    }
  }

  const listedDiscount = isSold && listedPrice > 0
    ? (listedPrice - salePrice) / listedPrice
    : null;

  // Inversión efectiva propia (lo que puse de mi bolsillo)
  const partnerContribution = Number(vehicle.partnerContribution || 0);
  const myCapital = Math.max(0, purchasePrice - partnerContribution);

  return {
    totalExpenses,
    repairs,
    commissions: commissionTotal,         // alias retro-compatible
    commissionTotal,
    commissionPaid,
    commissionPending,
    commissionCaptador,
    commissionCerrador,
    taxes,
    unpaidExpenses,
    daysInInventory,
    fixedProrated: Math.round(fixedProrated),
    realCost,
    realCostWithFixed: Math.round(realCostWithFixed),
    netProfit: netProfit !== null ? Math.round(netProfit) : null,
    roi,
    myProfit: myProfit !== null ? Math.round(myProfit) : null,
    partnerProfit: partnerProfit !== null ? Math.round(partnerProfit) : null,
    isProjectedProfit: hasProfitData && !isSold,
    partnerShare,
    partnerContribution,
    myCapital,
    listedDiscount,
    expenseCount: expenses.length,
  };
}

/**
 * Proyecta la ganancia de un negocio hipotético
 */
function projectProfit({ purchasePrice, estimatedExpenses, salePrice, estimatedDays, participation = 1, fixedMonthly = 800000 }) {
  const fixedProrated = (estimatedDays / 30) * fixedMonthly;
  const totalCost = purchasePrice + estimatedExpenses + fixedProrated;
  const netProfit = salePrice - totalCost;
  const roi = totalCost > 0 ? netProfit / totalCost : 0;
  const myProfit = netProfit * participation;

  return {
    totalCost: Math.round(totalCost),
    fixedProrated: Math.round(fixedProrated),
    netProfit: Math.round(netProfit),
    roi,
    myProfit: Math.round(myProfit),
  };
}

/**
 * Calcula la participación (0-1) del dueño principal dados el precio y el aporte del socio
 */
function calculateParticipation(purchasePrice, partnerContribution) {
  const price = Number(purchasePrice || 0);
  const partner = Number(partnerContribution || 0);
  if (price <= 0) return 1;
  if (partner <= 0) return 1;
  if (partner >= price) return 0;
  return (price - partner) / price;
}

/**
 * Calcula la base sobre la que se aplica el reparto 60/30/10 de comisiones.
 *
 * Base = (salePrice - purchasePrice - gastos directos NO-COMISION) × participación
 *
 * - No descuenta gastos fijos mensuales prorrateados (esa es la elección
 *   explícita: comisiones se calculan sobre ganancia bruta, no neta).
 * - Excluye expenses con category='COMISION' (legacy: antes las comisiones
 *   se modelaban como expense del vehículo).
 * - Para vehículos fromTradeIn=true (sin purchasePrice todavía o saldado por el cruce),
 *   usa negotiatedValue como costo base.
 * - Multiplica por participation para que con socio la base sea "mi parte".
 * - Si el resultado es ≤ 0, devuelve skip=true.
 */
function calculateCommissionBase(vehicle) {
  const expenses = vehicle.expenses || [];
  // La categoría COMISION fue eliminada del enum; el filtro queda como guard
  // defensivo por si llega data legacy desde una caller que no pasó por la DB.
  const directExpenses = expenses
    .filter(e => e.category !== 'COMISION')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const salePrice = Number(vehicle.salePrice || 0);
  const purchasePrice = vehicle.fromTradeIn
    ? Number(vehicle.negotiatedValue || vehicle.purchasePrice || 0)
    : Number(vehicle.purchasePrice || 0);

  // Sin base de costo (vehículo vendido sin precio de compra registrado, o
  // cruce sin valor negociado), no hay forma de calcular ganancia real.
  // Evitamos cobrar comisión sobre el salePrice completo tratándolo como skip.
  if (purchasePrice <= 0) {
    return { grossProfitGlobal: 0, commissionBase: 0, skip: true };
  }

  const grossProfitGlobal = salePrice - purchasePrice - directExpenses;
  const participation = Number(vehicle.participation || 1);
  const rawBase = grossProfitGlobal * participation;
  const skip = rawBase <= 0;
  const commissionBase = skip ? 0 : rawBase;

  return {
    grossProfitGlobal,
    commissionBase,
    skip,
  };
}

// ── Préstamos: interés y reparto de pagos ────────────────────
// COP no maneja decimales: todo monto se redondea a entero.
function roundCop(n) {
  return Math.round(parseFloat(n) || 0);
}

// Interés fijo único sobre el principal (congelado al crear el préstamo).
function calcLoanInterest(principal, ratePct) {
  const p = parseFloat(principal) || 0;
  const r = parseFloat(ratePct) || 0;
  return roundCop((p * r) / 100);
}

// Reparte un abono entre capital recuperado e interés ganado,
// proporcional al peso del interés sobre el total a devolver.
// Garantiza capitalPortion + interestPortion === amount.
function splitLoanPayment(amount, interestAmount, totalToRepay) {
  const a = roundCop(amount);
  const interest = parseFloat(interestAmount) || 0;
  const total = parseFloat(totalToRepay) || 0;
  if (total <= 0 || interest <= 0) {
    return { capitalPortion: a, interestPortion: 0 };
  }
  const interestPortion = roundCop((a * interest) / total);
  return { capitalPortion: a - interestPortion, interestPortion };
}

// Reparto del pago que SALDA el préstamo: el interés cubre el remanente
// pendiente, pero acotado al propio abono. Garantiza interestPortion ∈ [0, pago]
// y capitalPortion >= 0, y que el split sume EXACTAMENTE el pago (el ledger
// cuadra con la caja recibida aun en casos límite de redondeo).
function splitFinalPayment(payment, remainingInterest) {
  const p = roundCop(payment);
  const interestPortion = Math.min(p, Math.max(0, roundCop(remainingInterest)));
  return { capitalPortion: p - interestPortion, interestPortion };
}

module.exports = { daysBetween, calculateVehicleMetrics, projectProfit, calculateParticipation, calculateCommissionBase, roundCop, calcLoanInterest, splitLoanPayment, splitFinalPayment };
