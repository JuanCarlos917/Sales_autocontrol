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
const { dayKeyBogota } = require('../utils/dates');

const MAX_PARTICIPANTS = 5;
const OWNER_ID = 'owner-self';
const DEFAULT_TEAM_KEY = 'commission_default_team';
const SUM_TOLERANCE = 0.001;

const COMMISSION_CONFIG_KEYS = [
  'commission_share_pct',
  'reinvest_share_pct',
  'tax_share_pct',
  'default_captador_pct',
  'default_cerrador_pct',
  'reinvest_account_id',
  'tax_reserve_account_id',
  'commission_gross_pct',
  'reinvest_pct',
  'tax_pct',
];
const INVESTOR_TEAM_KEY = 'investor_team';

/**
 * Lee Settings por key y devuelve un objeto {key: numericOrString}.
 * Falla si falta alguna key esperada (señal de migración no aplicada).
 * La key commission_default_team es opcional (parse defensivo, JSON corrupto → null + warn).
 */
async function loadCommissionConfig(prismaOrTx) {
  const rows = await prismaOrTx.setting.findMany({
    where: { key: { in: [...COMMISSION_CONFIG_KEYS, DEFAULT_TEAM_KEY, INVESTOR_TEAM_KEY] } },
  });
  const cfg = {};
  rows.forEach(r => { cfg[r.key] = r.value; });
  const missing = COMMISSION_CONFIG_KEYS.filter(k => !(k in cfg));
  if (missing.length > 0) {
    throw new AppError(`Settings de comisiones faltantes: ${missing.join(', ')}`, 500);
  }
  let defaultTeam = null;
  if (cfg[DEFAULT_TEAM_KEY]) {
    try {
      const parsed = JSON.parse(cfg[DEFAULT_TEAM_KEY]);
      if (Array.isArray(parsed) && parsed.length > 0) defaultTeam = parsed;
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[commissionService] commission_default_team corrupto; se ignora (fallback legacy)');
    }
  }
  let investorTeam = [];
  if (cfg[INVESTOR_TEAM_KEY]) {
    try {
      const parsed = JSON.parse(cfg[INVESTOR_TEAM_KEY]);
      if (Array.isArray(parsed)) investorTeam = parsed;
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[commissionService] investor_team corrupto; se ignora (fallback [])');
    }
  }
  return {
    // Legacy pool config (consumido por calculatePools/saleService — NO tocar
    // hasta que Task 4 rewire el flujo de venta a la cascada nueva).
    commissionPct:        Number(cfg.commission_share_pct),
    reinvestPct:          Number(cfg.reinvest_share_pct),
    taxPct:               Number(cfg.tax_share_pct),
    defaultCaptadorPct:   Number(cfg.default_captador_pct),
    defaultCerradorPct:   Number(cfg.default_cerrador_pct),
    reinvestAccountId:    cfg.reinvest_account_id,
    taxReserveAccountId:  cfg.tax_reserve_account_id,
    defaultTeam,
    sellerTeam:           defaultTeam,
    investorTeam,
    // Config de la cascada ganancia vs comisión (calculateSaleDistribution,
    // Task 4). Deliberadamente separada de los campos legacy de arriba para
    // no repointear el flujo de venta actual antes de que esté migrado.
    distributionCfg: {
      commissionGrossPct: Number(cfg.commission_gross_pct),
      reinvestPct:         Number(cfg.reinvest_pct),
      taxPct:              Number(cfg.tax_pct),
    },
  };
}

/**
 * Resuelve la lista FINAL de participantes de una venta (siempre suma 100):
 * 1. `saleParticipants` explícitos (edición por venta): máx 5, suma ≤ 100,
 *    sin duplicados, sin owner-self, sharePct > 0, terceros existentes.
 * 2. Sin explícitos → equipo default de Settings (cfg.defaultTeam), mismas
 *    reglas; si un tercero fue borrado, error accionable.
 * 3. Sin equipo → fallback legacy: owner-self captador+cerrador con los %
 *    default (comportamiento pre-equipo, intacto).
 * En 1 y 2, el resto (100 − suma) genera la fila del dueño (OWNER_ID, OTHER).
 */
async function ensureOwnerExists(prismaOrTx) {
  const owner = await prismaOrTx.thirdParty.findUnique({
    where: { id: OWNER_ID },
    select: { id: true },
  });
  if (!owner) {
    throw new AppError(
      'Tercero default "owner-self" no encontrado. ¿Falta correr la migración de comisiones?',
      500
    );
  }
}

async function resolveParticipants(prismaOrTx, saleParticipants, cfg) {
  const explicit = Array.isArray(saleParticipants) && saleParticipants.length > 0;
  const team = explicit ? saleParticipants : (cfg?.defaultTeam || null);

  if (!team) {
    // Fallback legacy — igual que antes del equipo de reparto.
    await ensureOwnerExists(prismaOrTx);
    const captadorPct = cfg?.defaultCaptadorPct ?? 30;
    const cerradorPct = cfg?.defaultCerradorPct ?? 70;
    return [
      { thirdPartyId: OWNER_ID, role: 'CAPTADOR', sharePct: captadorPct },
      { thirdPartyId: OWNER_ID, role: 'CERRADOR', sharePct: cerradorPct },
    ];
  }

  const source = explicit ? 'participants' : 'el equipo de reparto';
  if (team.length > MAX_PARTICIPANTS) {
    throw new AppError(`Máximo ${MAX_PARTICIPANTS} personas en ${source} (sin contar al dueño)`, 400);
  }
  if (team.some((p) => p.thirdPartyId === OWNER_ID)) {
    throw new AppError('El dueño no va en las filas del reparto: su parte es el resto automático', 400);
  }
  if (team.some((p) => !(Number(p.sharePct) > 0))) {
    throw new AppError('Cada participante debe tener un porcentaje mayor a 0', 400);
  }
  const ids = team.map((p) => p.thirdPartyId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError('Hay participantes repetidos en el reparto', 400);
  }
  const sum = team.reduce((acc, p) => acc + Number(p.sharePct), 0);
  if (sum > 100 + SUM_TOLERANCE) {
    throw new AppError(`Los porcentajes del reparto suman ${sum} (máximo 100)`, 400);
  }

  const found = await prismaOrTx.thirdParty.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const foundIds = new Set(found.map((f) => f.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new AppError(
      explicit
        ? `Terceros no encontrados: ${missing.join(', ')}`
        : `El equipo de reparto referencia terceros que ya no existen (${missing.join(', ')}); actualízalo en Configuración`,
      400
    );
  }

  const resolved = team.map((p) => ({
    thirdPartyId: p.thirdPartyId,
    role: p.role,
    sharePct: Math.round(Number(p.sharePct) * 100) / 100,
  }));
  const roundedSum = resolved.reduce((acc, p) => acc + p.sharePct, 0);
  const remainder = Math.round((100 - roundedSum) * 100) / 100;
  if (remainder > SUM_TOLERANCE) {
    // El resto va al dueño (owner-self). Verificamos que el centinela exista
    // ANTES de devolverlo: si fue borrado, saleService crearía la CxP de
    // comisión con un thirdPartyId inválido y reventaría con FK (P2003) → 500
    // genérico. Preferimos un error accionable aquí.
    await ensureOwnerExists(prismaOrTx);
    resolved.push({ thirdPartyId: OWNER_ID, role: 'OTHER', sharePct: remainder });
  }
  return resolved;
}

/**
 * Resuelve la lista de VENDEDORES para la cascada ganancia vs comisión
 * (`calculateSaleDistribution`). A diferencia de `resolveParticipants`, NO
 * genera fila de "resto al dueño": si no suman 100 exacto, es un error del
 * usuario. Sin vendedores → [] (venta sin comisión, todo el gross profit
 * pasa a repartirse entre inversionistas).
 */
async function resolveSellers(prismaOrTx, saleParticipants, cfg) {
  const explicit = Array.isArray(saleParticipants) && saleParticipants.length > 0;
  const team = explicit ? saleParticipants : (cfg?.sellerTeam || null);
  if (!team || team.length === 0) return []; // venta sin vendedor → sin comisión

  if (team.length > MAX_PARTICIPANTS) throw new AppError(`Máximo ${MAX_PARTICIPANTS} vendedores`, 400);
  if (team.some((p) => p.thirdPartyId === OWNER_ID)) throw new AppError('El dueño no comisiona', 400);
  if (team.some((p) => !(Number(p.sharePct) > 0))) throw new AppError('Cada vendedor debe tener % > 0', 400);
  const ids = team.map((p) => p.thirdPartyId);
  if (new Set(ids).size !== ids.length) throw new AppError('Vendedores repetidos', 400);
  const sum = Math.round(team.reduce((s, p) => s + Number(p.sharePct), 0) * 100) / 100;
  if (sum !== 100) throw new AppError(`Los % de vendedores deben sumar 100 (suman ${sum})`, 400);

  const found = await prismaOrTx.thirdParty.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const foundIds = new Set(found.map((f) => f.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length > 0) throw new AppError(`Vendedores no encontrados: ${missing.join(', ')}`, 400);

  return team.map((p) => ({
    thirdPartyId: p.thirdPartyId, role: p.role || 'OTHER',
    sharePct: Math.round(Number(p.sharePct) * 100) / 100,
  }));
}

/**
 * Resuelve la lista de INVERSIONISTAS para la cascada ganancia vs comisión.
 * Sin equipo configurado → fallback owner-self 100% (comportamiento pre-equipo).
 * Con equipo → debe sumar 100 exacto y todos los terceros deben existir.
 */
async function resolveInvestors(prismaOrTx, cfg) {
  const team = Array.isArray(cfg?.investorTeam) ? cfg.investorTeam : [];
  if (team.length === 0) {
    await ensureOwnerExists(prismaOrTx);
    return [{ thirdPartyId: OWNER_ID, role: 'INVESTOR', sharePct: 100 }];
  }
  if (team.some((p) => !(Number(p.sharePct) > 0))) throw new AppError('Cada inversionista debe tener % > 0', 400);
  const ids = team.map((p) => p.thirdPartyId);
  if (new Set(ids).size !== ids.length) throw new AppError('Inversionistas repetidos en el equipo', 400);
  const sum = Math.round(team.reduce((s, p) => s + Number(p.sharePct), 0) * 100) / 100;
  if (sum !== 100) throw new AppError(`Los % de capital deben sumar 100 (suman ${sum})`, 400);

  const found = await prismaOrTx.thirdParty.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const foundIds = new Set(found.map((f) => f.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new AppError(`El equipo de inversionistas referencia terceros que ya no existen (${missing.join(', ')}); actualízalo en Configuración`, 400);
  }
  if (ids.includes(OWNER_ID)) await ensureOwnerExists(prismaOrTx);
  return team.map((p) => ({
    thirdPartyId: p.thirdPartyId, role: 'INVESTOR',
    sharePct: Math.round(Number(p.sharePct) * 100) / 100,
  }));
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
  // Excluye COMISION legacy (igual que calculateCommissionBase) para que la
  // identidad venta − costo − gastos = ganancia cuadre en la cascada.
  const directExpenses = expenses
    .filter((e) => e.category !== 'COMISION')
    .reduce((s, e) => s + Number(e.amount || 0), 0);
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
 * payableType: PayableType a agregar (default 'COMMISSION'; investorService
 * reutiliza esto con 'PROFIT_SHARE' — mismo armado, distinto tipo de CxP).
 */
async function listByVehicle(prismaOrTx, { status = 'all', payableType = 'COMMISSION' } = {}) {
  const payables = await prismaOrTx.payable.findMany({
    where: { type: payableType, vehicleId: { not: null } },
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

/**
 * Armado puro de la métrica por persona (testeable sin DB).
 * Agrega comisiones por thirdParty, calcula totales pagados/pendientes,
 * cuenta vehículos únicos por persona, y ordena por pendiente descendente.
 */
function buildPersonSummary(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.thirdPartyId)) {
      byId.set(r.thirdPartyId, {
        thirdParty: { id: r.thirdPartyId, name: r.thirdPartyName },
        totalPaid: 0,
        totalPending: 0,
        vehicleIds: new Set(),
      });
    }
    const acc = byId.get(r.thirdPartyId);
    acc.totalPaid += Number(r.paidAmount || 0);
    if (r.status === 'PENDING' || r.status === 'PARTIAL') {
      acc.totalPending += Number(r.totalAmount || 0) - Number(r.paidAmount || 0);
    }
    acc.vehicleIds.add(r.vehicleId);
  }
  return [...byId.values()]
    .map(({ vehicleIds, ...rest }) => ({ ...rest, salesCount: vehicleIds.size }))
    .sort((a, b) => b.totalPending - a.totalPending);
}

/**
 * Agregados de comisiones para Dashboard + sección "Por persona".
 * Retorna: pendingTotal, paidThisMonth (zona Bogotá), byPerson ordenado por pendiente.
 * payableType: PayableType a agregar (default 'COMMISSION'; investorService
 * reutiliza esto con 'PROFIT_SHARE' para el reporte de ganancia por inversionista).
 */
async function getSummary(prismaOrTx, { payableType = 'COMMISSION' } = {}) {
  const payables = await prismaOrTx.payable.findMany({
    where: { type: payableType, vehicleId: { not: null } },
    select: {
      thirdPartyId: true,
      vehicleId: true,
      status: true,
      totalAmount: true,
      paidAmount: true,
      thirdParty: { select: { name: true } },
    },
  });
  const rows = payables.map((p) => ({
    thirdPartyId: p.thirdPartyId,
    thirdPartyName: p.thirdParty?.name || '—',
    vehicleId: p.vehicleId,
    status: p.status,
    totalAmount: p.totalAmount,
    paidAmount: p.paidAmount,
  }));
  const byPerson = buildPersonSummary(rows);
  const pendingTotal = byPerson.reduce((s, p) => s + p.totalPending, 0);

  // Pagado este mes: pagos de CxP COMMISSION desde el día 1 en zona Bogotá.
  const todayKey = dayKeyBogota(new Date()); // YYYY-MM-DD
  const monthStart = new Date(`${todayKey.slice(0, 7)}-01T00:00:00-05:00`);
  const paidAgg = await prismaOrTx.payablePayment.aggregate({
    _sum: { amount: true },
    where: {
      createdAt: { gte: monthStart },
      payable: { type: payableType },
    },
  });

  return {
    pendingTotal,
    paidThisMonth: parseFloat(paidAgg._sum.amount || 0),
    byPerson,
  };
}

module.exports = {
  loadCommissionConfig,
  resolveParticipants,
  resolveSellers,
  resolveInvestors,
  calculatePools,
  calculateCashRatio,
  calculateCommissionBase, // re-export for convenience
  buildCommissionVehicleItem,
  listByVehicle,
  buildPersonSummary,
  getSummary,
  COMMISSION_CONFIG_KEYS,
  MAX_PARTICIPANTS,
};
