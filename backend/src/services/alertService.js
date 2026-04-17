// ═══════════════════════════════════════════════════════════════
// Alert Service — Servicio para generar alertas del sistema
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');

const ALERT_TYPES = {
  NEGATIVE_BALANCE: 'negative_balance',
  CXP_OVERDUE: 'cxp_overdue',
  CXC_OVERDUE_30: 'cxc_overdue_30',
  VEHICLE_STALE_90: 'vehicle_stale_90',
  VEHICLE_STALE_60: 'vehicle_stale_60',
  LOW_BALANCE: 'low_balance',
};

class AlertService {
  /**
   * Obtener todas las alertas activas del sistema
   */
  async getAllAlerts() {
    const alerts = [];

    const [
      negativeBalanceAlerts,
      cxpOverdueAlerts,
      cxcOverdueAlerts,
      staleVehicleAlerts,
      lowBalanceAlerts,
    ] = await Promise.all([
      this.checkNegativeBalances(),
      this.checkOverdueCxP(),
      this.checkOverdueCxC(),
      this.checkStaleVehicles(),
      this.checkLowBalance(),
    ]);

    alerts.push(...negativeBalanceAlerts);
    alerts.push(...cxpOverdueAlerts);
    alerts.push(...cxcOverdueAlerts);
    alerts.push(...staleVehicleAlerts);
    alerts.push(...lowBalanceAlerts);

    // Ordenar por severidad (error > warning > info)
    const severityOrder = { error: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => severityOrder[a.type] - severityOrder[b.type]);

    return alerts;
  }

  /**
   * Obtener resumen de alertas (conteos por tipo)
   */
  async getAlertsSummary() {
    const alerts = await this.getAllAlerts();

    return {
      total: alerts.length,
      byType: {
        error: alerts.filter(a => a.type === 'error').length,
        warning: alerts.filter(a => a.type === 'warning').length,
        info: alerts.filter(a => a.type === 'info').length,
      },
      byCategory: {
        balance: alerts.filter(a => a.category === 'balance').length,
        payables: alerts.filter(a => a.category === 'payables').length,
        vehicles: alerts.filter(a => a.category === 'vehicles').length,
      },
    };
  }

  /**
   * Verificar cuentas con saldo negativo
   */
  async checkNegativeBalances() {
    const accounts = await prisma.account.findMany({
      where: {
        isActive: true,
        currentBalance: { lt: 0 },
      },
      select: { id: true, name: true, type: true, currentBalance: true },
    });

    return accounts.map(account => ({
      id: `${ALERT_TYPES.NEGATIVE_BALANCE}_${account.id}`,
      type: 'error',
      category: 'balance',
      alertType: ALERT_TYPES.NEGATIVE_BALANCE,
      title: 'Saldo negativo',
      message: `La cuenta "${account.name}" tiene saldo negativo`,
      details: [`Saldo actual: $${Math.abs(parseFloat(account.currentBalance)).toLocaleString('es-CO')}`],
      entityId: account.id,
      entityType: 'account',
      data: account,
    }));
  }

  /**
   * Verificar saldo bajo (< umbral configurable)
   */
  async checkLowBalance(threshold = 1000000) {
    const totalBalance = await prisma.account.aggregate({
      where: { isActive: true },
      _sum: { currentBalance: true },
    });

    const total = parseFloat(totalBalance._sum?.currentBalance || 0);

    if (total > 0 && total < threshold) {
      return [{
        id: ALERT_TYPES.LOW_BALANCE,
        type: 'warning',
        category: 'balance',
        alertType: ALERT_TYPES.LOW_BALANCE,
        title: 'Saldo bajo',
        message: 'El saldo total disponible es bajo',
        details: [
          `Saldo actual: $${total.toLocaleString('es-CO')}`,
          `Umbral: $${threshold.toLocaleString('es-CO')}`,
        ],
        data: { total, threshold },
      }];
    }

    return [];
  }

  /**
   * Verificar CxP vencidas
   */
  async checkOverdueCxP() {
    const now = new Date();

    const overdueCxP = await prisma.payable.findMany({
      where: {
        type: 'PAYABLE',
        status: { in: ['PENDING', 'PARTIAL'] },
        dueDate: { lt: now },
      },
      include: {
        vehicle: { select: { id: true, plate: true } },
        thirdParty: { select: { id: true, name: true } },
      },
    });

    if (overdueCxP.length === 0) return [];

    const totalPending = overdueCxP.reduce((sum, p) => {
      return sum + parseFloat(p.totalAmount) - parseFloat(p.paidAmount);
    }, 0);

    const details = overdueCxP.slice(0, 5).map(p => {
      const pending = parseFloat(p.totalAmount) - parseFloat(p.paidAmount);
      const daysOverdue = Math.floor((now - new Date(p.dueDate)) / (1000 * 60 * 60 * 24));
      const ref = p.vehicle?.plate || p.thirdParty?.name || p.description || 'Sin referencia';
      return `${ref}: $${pending.toLocaleString('es-CO')} (${daysOverdue} dias vencido)`;
    });

    if (overdueCxP.length > 5) {
      details.push(`... y ${overdueCxP.length - 5} mas`);
    }

    return [{
      id: ALERT_TYPES.CXP_OVERDUE,
      type: 'error',
      category: 'payables',
      alertType: ALERT_TYPES.CXP_OVERDUE,
      title: `${overdueCxP.length} cuenta${overdueCxP.length > 1 ? 's' : ''} por pagar vencida${overdueCxP.length > 1 ? 's' : ''}`,
      message: `Total pendiente: $${totalPending.toLocaleString('es-CO')}`,
      details,
      data: { count: overdueCxP.length, total: totalPending, items: overdueCxP },
    }];
  }

  /**
   * Verificar CxC vencidas > 30 dias
   */
  async checkOverdueCxC() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const overdueCxC = await prisma.payable.findMany({
      where: {
        type: 'RECEIVABLE',
        status: { in: ['PENDING', 'PARTIAL'] },
        dueDate: { lt: thirtyDaysAgo },
      },
      include: {
        vehicle: { select: { id: true, plate: true } },
        thirdParty: { select: { id: true, name: true } },
      },
    });

    if (overdueCxC.length === 0) return [];

    const totalPending = overdueCxC.reduce((sum, p) => {
      return sum + parseFloat(p.totalAmount) - parseFloat(p.paidAmount);
    }, 0);

    const details = overdueCxC.slice(0, 5).map(p => {
      const pending = parseFloat(p.totalAmount) - parseFloat(p.paidAmount);
      const daysOverdue = Math.floor((now - new Date(p.dueDate)) / (1000 * 60 * 60 * 24));
      const ref = p.vehicle?.plate || p.thirdParty?.name || p.description || 'Sin referencia';
      return `${ref}: $${pending.toLocaleString('es-CO')} (${daysOverdue} dias sin cobrar)`;
    });

    if (overdueCxC.length > 5) {
      details.push(`... y ${overdueCxC.length - 5} mas`);
    }

    return [{
      id: ALERT_TYPES.CXC_OVERDUE_30,
      type: 'warning',
      category: 'payables',
      alertType: ALERT_TYPES.CXC_OVERDUE_30,
      title: `${overdueCxC.length} cuenta${overdueCxC.length > 1 ? 's' : ''} por cobrar con mas de 30 dias`,
      message: `Total pendiente: $${totalPending.toLocaleString('es-CO')}`,
      details,
      data: { count: overdueCxC.length, total: totalPending, items: overdueCxC },
    }];
  }

  /**
   * Verificar vehiculos > 90 dias sin vender (y > 60 dias como warning)
   */
  async checkStaleVehicles() {
    const now = new Date();
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Vehiculos no vendidos
    const activeVehicles = await prisma.vehicle.findMany({
      where: {
        stage: { not: 'VENDIDO' },
        purchaseDate: { not: null },
      },
      select: {
        id: true,
        plate: true,
        brand: true,
        model: true,
        purchaseDate: true,
        purchasePrice: true,
        stage: true,
      },
    });

    const alerts = [];

    // > 90 dias (error)
    const stale90 = activeVehicles.filter(v => new Date(v.purchaseDate) < ninetyDaysAgo);
    if (stale90.length > 0) {
      const totalValue = stale90.reduce((sum, v) => sum + parseFloat(v.purchasePrice || 0), 0);
      const details = stale90.slice(0, 5).map(v => {
        const days = Math.floor((now - new Date(v.purchaseDate)) / (1000 * 60 * 60 * 24));
        return `${v.plate || 'Sin placa'} (${v.brand} ${v.model}): ${days} dias`;
      });

      if (stale90.length > 5) {
        details.push(`... y ${stale90.length - 5} mas`);
      }

      alerts.push({
        id: ALERT_TYPES.VEHICLE_STALE_90,
        type: 'error',
        category: 'vehicles',
        alertType: ALERT_TYPES.VEHICLE_STALE_90,
        title: `${stale90.length} vehiculo${stale90.length > 1 ? 's' : ''} con mas de 90 dias sin vender`,
        message: `Capital inmovilizado: $${totalValue.toLocaleString('es-CO')}`,
        details,
        data: { count: stale90.length, total: totalValue, vehicles: stale90 },
      });
    }

    // 60-90 dias (warning)
    const stale60 = activeVehicles.filter(v => {
      const purchaseDate = new Date(v.purchaseDate);
      return purchaseDate >= ninetyDaysAgo && purchaseDate < sixtyDaysAgo;
    });

    if (stale60.length > 0) {
      const totalValue = stale60.reduce((sum, v) => sum + parseFloat(v.purchasePrice || 0), 0);
      const details = stale60.slice(0, 5).map(v => {
        const days = Math.floor((now - new Date(v.purchaseDate)) / (1000 * 60 * 60 * 24));
        return `${v.plate || 'Sin placa'} (${v.brand} ${v.model}): ${days} dias`;
      });

      if (stale60.length > 5) {
        details.push(`... y ${stale60.length - 5} mas`);
      }

      alerts.push({
        id: ALERT_TYPES.VEHICLE_STALE_60,
        type: 'warning',
        category: 'vehicles',
        alertType: ALERT_TYPES.VEHICLE_STALE_60,
        title: `${stale60.length} vehiculo${stale60.length > 1 ? 's' : ''} con 60-90 dias sin vender`,
        message: `Capital en riesgo: $${totalValue.toLocaleString('es-CO')}`,
        details,
        data: { count: stale60.length, total: totalValue, vehicles: stale60 },
      });
    }

    return alerts;
  }
}

module.exports = new AlertService();
