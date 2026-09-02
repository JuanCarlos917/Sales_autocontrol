// ═══════════════════════════════════════════════════════════════
// Utils — Settings de métricas de vehículo (fixedMonthly, targetMarginDefault)
// ═══════════════════════════════════════════════════════════════
//
// Centraliza el patrón `setting.findUnique` × 2 (fixedMonthly + targetMarginDefault)
// que se repetía en cada punto de vehicleService y dashboardService que llama a
// calculateVehicleMetrics. Un solo findMany por request en vez de dos findUnique,
// y un único lugar donde vive el fallback de cada setting (DEFAULT_TARGET_MARGIN
// para el margen; ver financial.js).

const prisma = require('../config/database');
const { DEFAULT_TARGET_MARGIN } = require('./financial');

const FIXED_MONTHLY_DEFAULT = 800000;

const METRICS_SETTING_KEYS = ['fixedMonthly', 'targetMarginDefault'];

async function getMetricsSettings() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: METRICS_SETTING_KEYS } },
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return {
    fixedMonthly: byKey.fixedMonthly != null ? parseFloat(byKey.fixedMonthly) : FIXED_MONTHLY_DEFAULT,
    targetMarginDefault: byKey.targetMarginDefault != null ? parseFloat(byKey.targetMarginDefault) : DEFAULT_TARGET_MARGIN,
  };
}

module.exports = { getMetricsSettings, FIXED_MONTHLY_DEFAULT };
