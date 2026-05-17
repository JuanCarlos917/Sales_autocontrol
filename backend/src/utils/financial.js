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
function calculateVehicleMetrics(vehicle, fixedMonthly = 800000) {
  const expenses = vehicle.expenses || [];

  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const repairs = expenses
    .filter(e => ['MECANICA', 'ESTETICA'].includes(e.category))
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const commissions = expenses
    .filter(e => e.category === 'COMISION')
    .reduce((sum, e) => sum + Number(e.amount), 0);

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
    netProfit = referencePrice - realCostWithFixed;
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
    commissions,
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

module.exports = { daysBetween, calculateVehicleMetrics, projectProfit, calculateParticipation };
