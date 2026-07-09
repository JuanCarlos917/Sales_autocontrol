// ═══════════════════════════════════════════════════════════════
// Commission Service — Cálculo de bolsillos y participantes
//
// Stateless helpers que toman una "operación de venta" y devuelven
// los objetos que saleService debe persistir (SaleParticipant, Payable
// COMMISSION, Transfer). NO toca la DB directamente; recibe lo que
// necesita y devuelve plain objects.
// ═══════════════════════════════════════════════════════════════

const { calculateCommissionBase } = require('../utils/financial');
const { AppError } = require('../middleware/errorHandler');

const COMMISSION_CONFIG_KEYS = [
  'commission_share_pct',
  'reinvest_share_pct',
  'tax_share_pct',
  'default_captador_pct',
  'default_cerrador_pct',
  'reinvest_account_id',
  'tax_reserve_account_id',
];

/**
 * Lee Settings por key y devuelve un objeto {key: numericOrString}.
 * Falla si falta alguna key esperada (señal de migración no aplicada).
 */
async function loadCommissionConfig(prismaOrTx) {
  const rows = await prismaOrTx.setting.findMany({
    where: { key: { in: COMMISSION_CONFIG_KEYS } },
  });
  const cfg = {};
  rows.forEach(r => { cfg[r.key] = r.value; });
  const missing = COMMISSION_CONFIG_KEYS.filter(k => !(k in cfg));
  if (missing.length > 0) {
    throw new AppError(`Settings de comisiones faltantes: ${missing.join(', ')}`, 500);
  }
  return {
    commissionPct:        Number(cfg.commission_share_pct),
    reinvestPct:          Number(cfg.reinvest_share_pct),
    taxPct:               Number(cfg.tax_share_pct),
    defaultCaptadorPct:   Number(cfg.default_captador_pct),
    defaultCerradorPct:   Number(cfg.default_cerrador_pct),
    reinvestAccountId:    cfg.reinvest_account_id,
    taxReserveAccountId:  cfg.tax_reserve_account_id,
  };
}

/**
 * Resuelve la lista de participantes para una venta:
 * - Si saleData.participants viene, valida que sume 100 y que cada thirdPartyId exista.
 * - Si no viene, devuelve 2 participantes default desde Settings:
 *     - "owner-self" como CAPTADOR con default_captador_pct
 *     - "owner-self" como CERRADOR con default_cerrador_pct
 *   Hasta que la UI permita reasignar (Fase 2), ambos roles van al dueño con sus
 *   % configurados — pero como CxPs separadas: son pagos diferentes por rol.
 *
 * Devuelve [{ thirdPartyId, role, sharePct }].
 */
async function resolveParticipants(prismaOrTx, saleParticipants, cfg) {
  if (Array.isArray(saleParticipants) && saleParticipants.length > 0) {
    const sum = saleParticipants.reduce((acc, p) => acc + Number(p.sharePct || 0), 0);
    if (Math.abs(sum - 100) > 0.001) {
      throw new AppError(`participants[].sharePct debe sumar 100 (recibido: ${sum})`, 400);
    }
    const ids = saleParticipants.map(p => p.thirdPartyId);
    const found = await prismaOrTx.thirdParty.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const foundIds = new Set(found.map(f => f.id));
    const missing = ids.filter(id => !foundIds.has(id));
    if (missing.length > 0) {
      throw new AppError(`Terceros no encontrados: ${missing.join(', ')}`, 400);
    }
    return saleParticipants.map(p => ({
      thirdPartyId: p.thirdPartyId,
      role: p.role,
      sharePct: Number(p.sharePct),
    }));
  }

  // Default: 2 CxPs separadas (captador + cerrador) desde Settings.
  const owner = await prismaOrTx.thirdParty.findUnique({
    where: { id: 'owner-self' },
    select: { id: true },
  });
  if (!owner) {
    throw new AppError(
      'Tercero default "owner-self" no encontrado. ¿Falta correr la migración de comisiones?',
      500
    );
  }
  const captadorPct = cfg?.defaultCaptadorPct ?? 30;
  const cerradorPct = cfg?.defaultCerradorPct ?? 70;
  return [
    { thirdPartyId: 'owner-self', role: 'CAPTADOR', sharePct: captadorPct },
    { thirdPartyId: 'owner-self', role: 'CERRADOR', sharePct: cerradorPct },
  ];
}

/**
 * Calcula los tres "pools" (montos absolutos) a partir de la base de comisión.
 */
function calculatePools(commissionBase, cfg) {
  return {
    commissionPool: commissionBase * (cfg.commissionPct / 100),
    reinvestPool:   commissionBase * (cfg.reinvestPct / 100),
    taxPool:        commissionBase * (cfg.taxPct / 100),
  };
}

/**
 * Calcula el ratio de efectivo recibido vs total (incluye cruce y CxC).
 */
function calculateCashRatio(totalReceived, cashReceived) {
  if (totalReceived <= 0) return 0;
  return cashReceived / totalReceived;
}

const ROLE_ORDER = { CAPTADOR: 0, CERRADOR: 1, OTHER: 2 };

/**
 * Arma el item de comisión de UN vehículo desde datos ya cargados (puro, sin DB).
 * - cascade: recalculada con calculateCommissionBase (mismo helper de la venta);
 *   commissionPool = Σ totalAmount de las CxP (persistido — inmune a cambios
 *   posteriores de settings).
 * - roles: uno por Payable COMMISSION; sharePct del SaleParticipant o derivado
 *   de montos (total/pool) para data legacy sin participante.
 * - buckets: montos informativos de reinversión/impuestos; null si no hay.
 */
function buildCommissionVehicleItem({ vehicle, payables, bucketTransfers }) {
  const { grossProfitGlobal, commissionBase } = calculateCommissionBase(vehicle);
  const expenses = (vehicle.expenses || []).filter((e) => !e.deletedAt);
  const directExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const purchaseCost = vehicle.fromTradeIn
    ? Number(vehicle.negotiatedValue || vehicle.purchasePrice || 0)
    : Number(vehicle.purchasePrice || 0);
  const commissionPool = payables.reduce((s, p) => s + Number(p.totalAmount || 0), 0);

  const roles = payables.map((p) => {
    const total = Number(p.totalAmount || 0);
    const paid = Number(p.paidAmount || 0);
    const sharePct = p.saleParticipant
      ? Number(p.saleParticipant.sharePct)
      : (commissionPool > 0 ? Math.round((total / commissionPool) * 100) : 0);
    return {
      role: p.saleParticipant?.role || 'OTHER',
      thirdParty: { id: p.thirdParty?.id || null, name: p.thirdParty?.name || '—' },
      sharePct,
      total,
      paid,
      pending: total - paid,
      status: p.status,
      payableId: p.id,
      payments: (p.payments || []).map((pp) => ({
        date: pp.transaction?.date || null,
        amount: Number(pp.amount),
        accountName: pp.transaction?.account?.name || '—',
      })),
    };
  }).sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));

  let buckets = null;
  if (Array.isArray(bucketTransfers) && bucketTransfers.length > 0) {
    buckets = { reinvest: 0, tax: 0 };
    for (const t of bucketTransfers) {
      if (t.bucket === 'reinvest') buckets.reinvest += Number(t.amount || 0);
      if (t.bucket === 'tax') buckets.tax += Number(t.amount || 0);
    }
  }

  return {
    vehicle: {
      id: vehicle.id, plate: vehicle.plate, brand: vehicle.brand,
      model: vehicle.model, saleDate: vehicle.saleDate, salePrice: Number(vehicle.salePrice || 0),
    },
    cascade: {
      salePrice: Number(vehicle.salePrice || 0),
      purchaseCost,
      directExpenses,
      grossProfit: grossProfitGlobal,
      participation: Number(vehicle.participation || 1),
      commissionBase,
      commissionPool,
    },
    roles,
    buckets,
    hasPending: roles.some((r) => r.status === 'PENDING' || r.status === 'PARTIAL'),
  };
}

/**
 * Lista items de comisión agrupados por vehículo vendido, pendientes primero.
 * status: 'pending' | 'paid' | 'all' (default all).
 */
async function listByVehicle(prismaOrTx, { status = 'all' } = {}) {
  const payables = await prismaOrTx.payable.findMany({
    where: { type: 'COMMISSION', vehicleId: { not: null } },
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

  // Agrupar por vehículo
  const byVehicle = new Map();
  for (const p of payables) {
    if (!byVehicle.has(p.vehicleId)) byVehicle.set(p.vehicleId, { vehicle: p.vehicle, payables: [] });
    byVehicle.get(p.vehicleId).payables.push(p);
  }

  // Transfers de bolsillos: TRANSFER_IN a las cuentas budget con vehicleId
  let bucketByVehicle = new Map();
  try {
    const cfg = await loadCommissionConfig(prismaOrTx);
    const bucketTxns = await prismaOrTx.transaction.findMany({
      where: {
        type: 'TRANSFER_IN',
        vehicleId: { in: [...byVehicle.keys()] },
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
  } catch {
    bucketByVehicle = new Map(); // settings faltantes: buckets informativos en null
  }

  const items = [...byVehicle.values()].map(({ vehicle, payables: ps }) =>
    buildCommissionVehicleItem({ vehicle, payables: ps, bucketTransfers: bucketByVehicle.get(vehicle.id) || [] }),
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

module.exports = {
  loadCommissionConfig,
  resolveParticipants,
  calculatePools,
  calculateCashRatio,
  calculateCommissionBase, // re-export for convenience
  buildCommissionVehicleItem,
  listByVehicle,
  COMMISSION_CONFIG_KEYS,
};
