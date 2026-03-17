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
 * Calcula todas las métricas financieras de un vehículo
 * @param {Object} vehicle - Vehículo con sus expenses cargados
 * @param {number} fixedMonthly - Gasto fijo mensual del negocio
 * @returns {Object} Métricas calculadas
 */
function calculateVehicleMetrics(vehicle, fixedMonthly = 800000) {
  const expenses = vehicle.expenses || [];

  // Totales por categoría
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

  // Días en inventario
  const isSold = vehicle.stage === 'VENDIDO';
  const daysInInventory = daysBetween(vehicle.purchaseDate, isSold ? vehicle.saleDate : null);

  // Gastos fijos prorrateados
  const fixedProrated = (daysInInventory / 30) * fixedMonthly;

  // Costos
  const purchasePrice = Number(vehicle.purchasePrice || 0);
  const realCost = purchasePrice + totalExpenses;
  const realCostWithFixed = realCost + fixedProrated;

  // Ganancia (solo si vendido)
  const salePrice = Number(vehicle.salePrice || 0);
  const netProfit = isSold ? salePrice - realCostWithFixed : null;
  const roi = isSold && realCostWithFixed > 0 ? netProfit / realCostWithFixed : null;
  const participation = Number(vehicle.participation || 1);
  const myProfit = netProfit !== null ? netProfit * participation : null;

  // Descuento de negociación
  const listedPrice = Number(vehicle.listedPrice || 0);
  const listedDiscount = isSold && listedPrice > 0
    ? (listedPrice - salePrice) / listedPrice
    : null;

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

module.exports = { daysBetween, calculateVehicleMetrics, projectProfit };
