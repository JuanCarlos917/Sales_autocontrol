// ═══════════════════════════════════════════════════════════════
// Service — Treasury Reports (Reportes de Tesorería)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const accountService = require('./accountService');
const { dayKeyBogota } = require('../utils/dates');

class TreasuryReportService {
  /**
   * Dashboard principal de tesorería
   */
  async getDashboard() {
    const accounts = await accountService.findAll({ isActive: true });
    // Total de tesorería SIN las cuentas SOCIO (capital del socio, no de la empresa).
    const totalBalance = accounts
      .filter((acc) => acc.type !== 'SOCIO')
      .reduce((sum, acc) => sum + parseFloat(acc.currentBalance), 0);

    // Resumen del mes actual
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Suma en la DB por tipo, solo flujo real (las transferencias internas no
    // son ingreso ni egreso) — antes traía todas las filas del mes y sumaba
    // en JS, con un cálculo intermedio que se descartaba (🟡 #9 / ⚪ #17).
    const sums = await prisma.transaction.groupBy({
      by: ['type'],
      _sum: { amount: true },
      where: {
        date: { gte: startOfMonth, lte: endOfMonth },
        type: { in: ['INCOME', 'EXPENSE'] },
        // Excluir capital del socio: sus cuentas no son flujo de la empresa.
        account: { type: { not: 'SOCIO' } },
      },
    });
    const realIncome = parseFloat(sums.find((s) => s.type === 'INCOME')?._sum.amount || 0);
    const realExpense = parseFloat(sums.find((s) => s.type === 'EXPENSE')?._sum.amount || 0);

    return {
      totalBalance,
      accounts: accounts.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currentBalance: parseFloat(a.currentBalance),
      })),
      month: {
        income: realIncome,
        expense: realExpense,
        netFlow: realIncome - realExpense,
      },
    };
  }

  /**
   * Flujo de caja por período (diario, semanal, mensual)
   */
  async getCashFlow({ startDate, endDate, period = 'week', groupBy = 'day' } = {}) {
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    const now = new Date();

    // Determinar rango segun periodo
    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else if (period === 'week') {
      start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
    } else if (period === 'month') {
      start = new Date(now);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
    } else if (period === 'quarter') {
      start = new Date(now);
      start.setDate(start.getDate() - 89);
      start.setHours(0, 0, 0, 0);
      end = new Date(now);
      end.setHours(23, 59, 59, 999);
    } else {
      start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      end = new Date();
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        date: { gte: start, lte: end },
        type: { in: ['INCOME', 'EXPENSE'] },
        account: { type: { not: 'SOCIO' } },
      },
      select: { type: true, amount: true, date: true },
      orderBy: { date: 'asc' },
    });

    // Crear estructura de dias
    const daily = [];
    const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    for (let i = 0; i < daysDiff; i++) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      // Bucket por día en zona Bogotá (🟡 #13): la noche colombiana pertenece
      // a SU día, no al siguiente UTC.
      const dateKey = dayKeyBogota(date);
      const dayOfWeek = date.getDay();

      daily.push({
        date: dateKey,
        label: dayNames[dayOfWeek],
        income: 0,
        expense: 0,
      });
    }

    // Poblar con transacciones (misma clave de día Bogotá que la estructura)
    for (const tx of transactions) {
      const dateKey = dayKeyBogota(tx.date);
      const dayEntry = daily.find(d => d.date === dateKey);
      if (dayEntry) {
        const amount = parseFloat(tx.amount);
        if (tx.type === 'INCOME') dayEntry.income += amount;
        else dayEntry.expense += amount;
      }
    }

    // Totales
    let totalIncome = 0;
    let totalExpense = 0;
    for (const day of daily) {
      totalIncome += day.income;
      totalExpense += day.expense;
    }

    return {
      daily,
      totals: {
        income: totalIncome,
        expense: totalExpense,
        netFlow: totalIncome - totalExpense,
      },
      period: { start: start.toISOString(), end: end.toISOString() },
    };
  }

  /**
   * Proyección de flujo de caja
   */
  async getCashFlowProjection() {
    // Saldo actual
    const totalBalance = await accountService.getTotalBalance();

    // Ingresos proyectados: vehículos disponibles para venta (PUBLICADO, DISPONIBLE)
    const vehiclesForSale = await prisma.vehicle.findMany({
      where: { stage: { in: ['PUBLICADO', 'DISPONIBLE'] } },
      select: { id: true, plate: true, salePrice: true, listedPrice: true, stage: true },
    });

    const projectedIncome = vehiclesForSale.reduce((sum, v) => {
      const price = parseFloat(v.salePrice || v.listedPrice || 0);
      return sum + price;
    }, 0);

    // Egresos proyectados: gastos fijos mensuales
    const fixedSetting = await prisma.setting.findUnique({ where: { key: 'fixedMonthly' } });
    const fixedMonthly = fixedSetting ? parseFloat(fixedSetting.value) : 800000;

    // Gastos pendientes de pago
    const unpaidExpenses = await prisma.expense.aggregate({
      where: { paid: false },
      _sum: { amount: true },
    });
    const pendingExpenses = parseFloat(unpaidExpenses._sum?.amount || 0);

    // Vehículos en negociación (compras pendientes)
    const vehiclesNegociando = await prisma.vehicle.findMany({
      where: { stage: 'NEGOCIANDO' },
      select: { id: true, plate: true, purchasePrice: true },
    });

    const projectedPurchases = vehiclesNegociando.reduce((sum, v) => {
      return sum + parseFloat(v.purchasePrice || 0);
    }, 0);

    return {
      currentBalance: totalBalance,
      projected: {
        income: {
          vehiclesSales: projectedIncome,
          vehiclesCount: vehiclesForSale.length,
          vehicles: vehiclesForSale,
        },
        expenses: {
          fixedMonthly,
          pendingExpenses,
          pendingPurchases: projectedPurchases,
          purchasesCount: vehiclesNegociando.length,
          total: fixedMonthly + pendingExpenses + projectedPurchases,
        },
      },
      projectedBalance: totalBalance + projectedIncome - (fixedMonthly + pendingExpenses + projectedPurchases),
    };
  }

  /**
   * Movimientos por vehículo con resumen
   */
  async getVehicleTransactions(vehicleId) {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, plate: true, brand: true, model: true, purchasePrice: true, salePrice: true },
    });

    if (!vehicle) return null;

    const transactions = await prisma.transaction.findMany({
      where: { vehicleId },
      include: { account: { select: { name: true } } },
      orderBy: { date: 'desc' },
    });

    let totalPaid = 0;
    let totalReceived = 0;
    for (const tx of transactions) {
      const amount = parseFloat(tx.amount);
      if (tx.type === 'EXPENSE') totalPaid += amount;
      else if (tx.type === 'INCOME') totalReceived += amount;
    }

    return {
      vehicle,
      transactions,
      summary: {
        totalPaid,
        totalReceived,
        netResult: totalReceived - totalPaid,
      },
    };
  }

  getDateKey(date, groupBy) {
    const d = new Date(date);
    switch (groupBy) {
      case 'day':
        return d.toISOString().split('T')[0];
      case 'week':
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        return weekStart.toISOString().split('T')[0];
      case 'month':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      default:
        return d.toISOString().split('T')[0];
    }
  }
}

module.exports = new TreasuryReportService();
