// ═══════════════════════════════════════════════════════════════
// Service — Dashboard (Métricas agregadas)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { calculateVehicleMetrics, projectProfit } = require('../utils/financial');
const accountService = require('./accountService');

class DashboardService {
  async getOverview(userId) {
    const fixedSetting = await prisma.setting.findUnique({ where: { key: 'fixedMonthly' } });
    const alertSetting = await prisma.setting.findUnique({ where: { key: 'alertDays' } });
    const marginSetting = await prisma.setting.findUnique({ where: { key: 'targetMarginDefault' } });
    const fixedMonthly = fixedSetting ? parseFloat(fixedSetting.value) : 800000;
    const alertDays = alertSetting ? parseInt(alertSetting.value) : 15;
    const targetMarginDefault = marginSetting ? parseFloat(marginSetting.value) : 0.15;

    const vehicles = await prisma.vehicle.findMany({
      where: { userId },
      include: { expenses: true },
    });

    const all = vehicles.map(v => ({
      vehicle: v,
      metrics: calculateVehicleMetrics(v, fixedMonthly, [], targetMarginDefault),
    }));

    const sold = all.filter(x => x.vehicle.stage === 'VENDIDO');
    const active = all.filter(x => x.vehicle.stage !== 'VENDIDO');

    // KPIs
    const totalInvested = active.reduce((s, x) => s + x.metrics.realCost, 0);
    const totalRevenue = sold.reduce((s, x) => s + Number(x.vehicle.salePrice || 0), 0);
    const totalProfit = sold.reduce((s, x) => s + (x.metrics.netProfit || 0), 0);
    const totalMyProfit = sold.reduce((s, x) => s + (x.metrics.myProfit || 0), 0);
    const avgDays = sold.length ? Math.round(sold.reduce((s, x) => s + x.metrics.daysInInventory, 0) / sold.length) : 0;
    const avgROI = sold.length ? sold.reduce((s, x) => s + (x.metrics.roi || 0), 0) / sold.length : 0;

    const totalExpenses = vehicles.reduce((s, v) => s + v.expenses.reduce((es, e) => es + Number(e.amount), 0), 0);

    // Pipeline distribution
    const stages = ['NEGOCIANDO', 'COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE', 'VENDIDO'];
    const pipeline = stages.map(stage => ({
      stage,
      count: vehicles.filter(v => v.stage === stage).length,
    }));

    // Expense breakdown by category
    const allExpenses = await prisma.expense.findMany({ where: { vehicle: { userId } } });
    const expensesByCategory = {};
    allExpenses.forEach(e => {
      if (!expensesByCategory[e.category]) expensesByCategory[e.category] = 0;
      expensesByCategory[e.category] += Number(e.amount);
    });

    // Alerts
    const alerts = active
      .filter(x => x.metrics.daysInInventory >= alertDays)
      .map(x => ({
        vehicleId: x.vehicle.id,
        plate: x.vehicle.plate,
        days: x.metrics.daysInInventory,
        level: x.metrics.daysInInventory >= alertDays * 2 ? 'critical' : 'warning',
      }))
      .sort((a, b) => b.days - a.days);

    // Saldo total de tesorería
    const treasuryBalance = await accountService.getTotalBalance();

    return {
      kpis: {
        totalInvested,
        totalRevenue,
        totalProfit,
        totalMyProfit,
        avgDays,
        avgROI,
        totalExpenses,
        totalVehicles: vehicles.length,
        soldCount: sold.length,
        activeCount: active.length,
        treasuryBalance,
      },
      pipeline,
      expensesByCategory,
      alerts,
    };
  }

  async getProjection(params) {
    const fixedSetting = await prisma.setting.findUnique({ where: { key: 'fixedMonthly' } });
    const fixedMonthly = fixedSetting ? parseFloat(fixedSetting.value) : 800000;
    return projectProfit({ ...params, fixedMonthly });
  }

  async getPipelineTarget(userId) {
    const ACTIVE_STAGES = ['COMPRADO', 'ALISTAMIENTO', 'PUBLICADO', 'DISPONIBLE'];
    const fixedSetting = await prisma.setting.findUnique({ where: { key: 'fixedMonthly' } });
    const marginSetting = await prisma.setting.findUnique({ where: { key: 'targetMarginDefault' } });
    const fixedMonthly = fixedSetting ? parseFloat(fixedSetting.value) : 800000;
    const targetMarginDefault = marginSetting ? parseFloat(marginSetting.value) : 0.15;

    const vehicles = await prisma.vehicle.findMany({
      where: { userId, stage: { in: ACTIVE_STAGES } },
      include: { expenses: true },
    });

    const acc = {
      vehicleCount: vehicles.length,
      sumTargetPrice: 0,
      sumTargetProfit: 0,
      sumRealCost: 0,
      sumListed: 0,
      statusCounts: { MEETS: 0, PROFIT: 0, BELOW: 0, unknown: 0 },
    };

    for (const v of vehicles) {
      const m = calculateVehicleMetrics(v, fixedMonthly, [], targetMarginDefault);
      acc.sumTargetPrice += m.targetPrice;
      acc.sumTargetProfit += m.targetProfit;
      acc.sumRealCost += m.realCostWithFixed;
      acc.sumListed += Number(v.listedPrice || 0);
      const key = m.targetStatus || 'unknown';
      acc.statusCounts[key] += 1;
    }

    acc.pipelineGap = acc.sumListed - acc.sumTargetPrice;
    return acc;
  }
}

module.exports = new DashboardService();
