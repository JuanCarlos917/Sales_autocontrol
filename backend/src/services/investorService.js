// ═══════════════════════════════════════════════════════════════
// Investor Service — Reporte por persona de ganancia (Payable PROFIT_SHARE)
//
// getSummary reutiliza la agregación genérica de commissionService (ya
// parametrizada por PayableType) con payableType: 'PROFIT_SHARE'.
//
// listByVehicle NO reutiliza commissionService.listByVehicle: la cascada de
// ganancia (buildInvestorVehicleItem) necesita datos que la comisión no
// carga — la suma de CxP COMMISSION del vehículo (deducción del pool de
// inversionistas) — así que arma su propia query. Comparte con
// commissionService solo lo verdaderamente común: loadCommissionConfig (ids
// de cuentas budget) y el armado puro del item (buildInvestorVehicleItem).
//
// addPayment reutiliza el flujo genérico de payableService.addPayment para
// registrar pagos — el mismo mecanismo (Transaction + PayablePayment +
// treasuryAudit) que usan las comisiones, sin reimplementarlo.
// ═══════════════════════════════════════════════════════════════

const commissionService = require('./commissionService');
const payableService = require('./payableService');
const { AppError } = require('../middleware/errorHandler');

const PAYABLE_TYPE = 'PROFIT_SHARE';

/**
 * Agregados de ganancia por inversionista para Dashboard + sección "Por persona".
 * Mismo shape que commissionService.getSummary: { pendingTotal, paidThisMonth, byPerson }.
 */
async function getSummary(prismaOrTx) {
  return commissionService.getSummary(prismaOrTx, { payableType: PAYABLE_TYPE });
}

/**
 * Lista items de GANANCIA agrupados por vehículo vendido, pendientes primero.
 * status: 'pending' | 'paid' | 'all' (default all).
 * Para cada vehículo con CxP PROFIT_SHARE, carga también la suma de CxP
 * COMMISSION (deducción del pool antes de repartir a inversionistas) y las
 * reservas de reinversión/impuestos (bucketTransfers, misma fuente que usa
 * commissionService), y arma el item con buildInvestorVehicleItem.
 */
async function listByVehicle(prismaOrTx, { status = 'all' } = {}) {
  const payables = await prismaOrTx.payable.findMany({
    where: { type: PAYABLE_TYPE, vehicleId: { not: null } },
    include: {
      vehicle: { include: { expenses: true } },
      thirdParty: { select: { id: true, name: true } },
      saleParticipant: { select: { role: true, sharePct: true } },
      payments: {
        include: { transaction: { select: { date: true, account: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  const byVehicle = new Map();
  for (const p of payables) {
    if (!byVehicle.has(p.vehicleId)) byVehicle.set(p.vehicleId, { vehicle: p.vehicle, payables: [] });
    byVehicle.get(p.vehicleId).payables.push(p);
  }
  const vehicleIds = [...byVehicle.keys()];
  if (vehicleIds.length === 0) return [];

  // Suma de CxP COMMISSION por vehículo — deducción antes del pool de inversionistas.
  const commissionSums = await prismaOrTx.payable.groupBy({
    by: ['vehicleId'],
    where: { type: 'COMMISSION', vehicleId: { in: vehicleIds } },
    _sum: { totalAmount: true },
  });
  const commissionByVehicle = new Map(
    commissionSums.map((r) => [r.vehicleId, Number(r._sum.totalAmount || 0)]),
  );

  // Transfers de bolsillos (reinvest/tax) — misma fuente que commissionService.listByVehicle.
  let bucketByVehicle = new Map();
  try {
    const cfg = await commissionService.loadCommissionConfig(prismaOrTx);
    const bucketTxns = await prismaOrTx.transaction.findMany({
      where: {
        type: 'TRANSFER_IN',
        vehicleId: { in: vehicleIds },
        accountId: { in: [cfg.reinvestAccountId, cfg.taxReserveAccountId] },
      },
      select: { vehicleId: true, accountId: true, amount: true },
    });
    for (const t of bucketTxns) {
      if (!bucketByVehicle.has(t.vehicleId)) bucketByVehicle.set(t.vehicleId, []);
      bucketByVehicle.get(t.vehicleId).push({
        bucket: t.accountId === cfg.reinvestAccountId ? 'reinvest' : 'tax',
        amount: t.amount,
      });
    }
  } catch (err) {
    // Solo el caso "settings de comisiones no configuradas" degrada a buckets null;
    // cualquier otro error (DB caída, Prisma, red) debe propagarse.
    if (err instanceof AppError && err.message.startsWith('Settings de comisiones faltantes')) {
      bucketByVehicle = new Map();
    } else {
      throw err;
    }
  }

  const items = [...byVehicle.values()].map(({ vehicle, payables: ps }) =>
    commissionService.buildInvestorVehicleItem({
      vehicle,
      payables: ps,
      commissionPayableSum: commissionByVehicle.get(vehicle.id) || 0,
      bucketTransfers: bucketByVehicle.get(vehicle.id) || [],
    }),
  );

  const filtered = status === 'pending'
    ? items.filter((i) => i.hasPending)
    : status === 'paid'
      ? items.filter((i) => !i.hasPending)
      : items;

  return filtered.sort((a, b) => {
    if (a.hasPending !== b.hasPending) return a.hasPending ? -1 : 1;
    return new Date(b.vehicle.saleDate || 0) - new Date(a.vehicle.saleDate || 0);
  });
}

/**
 * Registra un pago contra una CxP PROFIT_SHARE. Delega en payableService.addPayment
 * (agnóstico al PayableType): valida cuenta activa, bloquea filas payable+account
 * dentro de una transacción, verifica saldo, crea Transaction + PayablePayment,
 * actualiza paidAmount/status del payable y escribe treasuryAudit.
 */
async function addPayment(payableId, paymentData, userId) {
  return payableService.addPayment(payableId, paymentData, userId);
}

module.exports = {
  getSummary,
  listByVehicle,
  addPayment,
  PAYABLE_TYPE,
};
