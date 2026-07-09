# Comisiones Fase 2 — Página dedicada + participantes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página `/treasury/commissions` con la cascada contable de comisión por carro vendido y pago por rol, más selector opcional de captador/cerrador en el modal de venta.

**Architecture:** `GET /api/commissions` agrega lo ya persistido (Payable COMMISSION + SaleParticipant + transfers de bolsillos) y recalcula la cascada con `calculateCommissionBase` (financial.js). El armado del item por vehículo es un helper puro unit-testeable en `commissionService`. El pago reutiliza `POST /payables/:id/payments` + `PaymentModal`. El selector de venta manda `participants` que `saleService` ya soporta. Cero migraciones.

**Tech Stack:** Node/Express/Prisma (CommonJS), node:test, React 18 + Vite (ESM), Playwright.

**Spec:** `docs/superpowers/specs/2026-07-09-comisiones-fase2-pagina-participantes-design.md`

## Global Constraints

- Backend CommonJS (`require`); frontend ES Modules (`import`).
- UI en español (Colombia); código en inglés. COP sin decimales via `formatCurrency`.
- Matemática financiera SOLO en `backend/src/utils/financial.js` (ya existe; no duplicar en front).
- La pestaña Comisiones de `PayablesPage` NO se toca.
- `saleService`, `payableService` y `PaymentModal` NO se modifican.
- Descripciones/labels exactos: página "Comisiones"; card muestra `Venta / − Costo / − Gastos / = Ganancia / Base comisión / Bolsillo comisión`; roles `Captador`/`Cerrador`; sección colapsada del modal de venta: `Comisión — Captador/Cerrador (default: tú)`.
- Antes del merge: suite backend completa (`cd backend && npm test`) + build frontend + e2e nuevos.

---

### Task 1: Backend — helper puro + `GET /api/commissions` (TDD)

**Files:**
- Modify: `backend/src/services/commissionService.js` (agregar `buildCommissionVehicleItem` puro + `listByVehicle(prismaOrTx, {status})` + exports)
- Create: `backend/src/controllers/commissionController.js`
- Create: `backend/src/routes/commissions.js`
- Modify: `backend/src/routes/index.js` (montar `/commissions`)
- Test: `backend/src/services/__tests__/commissionService.test.js` (nuevo)

**Interfaces:**
- Consumes: `calculateCommissionBase(vehicle)` de `../utils/financial` (ya re-exportado por commissionService); `COMMISSION_CONFIG_KEYS`/`loadCommissionConfig(prismaOrTx)` existentes.
- Produces:
  - `buildCommissionVehicleItem({ vehicle, payables, bucketTransfers })` → `{ vehicle:{id,plate,brand,model,saleDate,salePrice}, cascade:{salePrice,purchaseCost,directExpenses,grossProfit,participation,commissionBase,commissionPool}, roles:[{role,thirdParty:{id,name},sharePct,total,paid,pending,status,payableId,payments:[{date,amount,accountName}]}], buckets:{reinvest,tax}|null, hasPending:boolean }`
  - `listByVehicle(prismaOrTx, { status:'pending'|'paid'|'all' })` → `Array<item>` ordenado pendientes primero (saleDate desc) y luego pagadas (saleDate desc).
  - HTTP: `GET /api/commissions?status=all` → `res.json(items)`.

- [ ] **Step 1: Escribir tests del helper puro (RED)**

Crear `backend/src/services/__tests__/commissionService.test.js`:

```js
// Unit tests del armado puro de items de comisión por vehículo.
// Runner: node:test (Node 18+), sin DB.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCommissionVehicleItem } = require('../commissionService');

const vehicle = {
  id: 'v1', plate: 'FJT326', brand: 'Suzuki', model: 'Vitara',
  saleDate: '2026-06-01T00:00:00Z', salePrice: 57_500_000,
  purchasePrice: 50_000_000, negotiatedValue: null, fromTradeIn: false,
  participation: 1,
  expenses: [{ amount: 2_454_000, category: 'MECANICA', deletedAt: null }],
};

const mkPayable = (over = {}) => ({
  id: 'pay-1', status: 'PENDING', totalAmount: 908_280, paidAmount: 0,
  thirdParty: { id: 'owner-self', name: 'Juan' },
  saleParticipant: { role: 'CAPTADOR', sharePct: 30 },
  payments: [],
  ...over,
});

test('item: cascada desde calculateCommissionBase + pool desde payables', () => {
  const payables = [
    mkPayable(),
    mkPayable({ id: 'pay-2', totalAmount: 2_119_320, saleParticipant: { role: 'CERRADOR', sharePct: 70 } }),
  ];
  const item = buildCommissionVehicleItem({ vehicle, payables, bucketTransfers: [] });
  assert.equal(item.vehicle.plate, 'FJT326');
  assert.equal(item.cascade.grossProfit, 5_046_000);
  assert.equal(item.cascade.commissionBase, 5_046_000);
  assert.equal(item.cascade.commissionPool, 3_027_600); // suma de payables (persistido)
  assert.equal(item.cascade.purchaseCost, 50_000_000);
  assert.equal(item.cascade.directExpenses, 2_454_000);
  assert.equal(item.roles.length, 2);
  assert.equal(item.hasPending, true);
});

test('item: rol con pagos — paid/pending/status y payments aplanados', () => {
  const payables = [mkPayable({
    status: 'PARTIAL', paidAmount: 400_000,
    payments: [{ amount: 400_000, transaction: { date: '2026-06-05T00:00:00Z', account: { name: 'Efectivo' } } }],
  })];
  const item = buildCommissionVehicleItem({ vehicle, payables, bucketTransfers: [] });
  const rol = item.roles[0];
  assert.equal(rol.paid, 400_000);
  assert.equal(rol.pending, 508_280);
  assert.equal(rol.status, 'PARTIAL');
  assert.deepEqual(rol.payments, [{ date: '2026-06-05T00:00:00Z', amount: 400_000, accountName: 'Efectivo' }]);
});

test('item: todos pagados — hasPending false; cancelada no cuenta como pendiente', () => {
  const payables = [
    mkPayable({ status: 'PAID', paidAmount: 908_280 }),
    mkPayable({ id: 'pay-2', status: 'CANCELLED' }),
  ];
  const item = buildCommissionVehicleItem({ vehicle, payables, bucketTransfers: [] });
  assert.equal(item.hasPending, false);
});

test('item: buckets desde transfers; null si no hay', () => {
  const withB = buildCommissionVehicleItem({
    vehicle, payables: [mkPayable()],
    bucketTransfers: [
      { bucket: 'reinvest', amount: 1_513_800 },
      { bucket: 'tax', amount: 504_600 },
    ],
  });
  assert.deepEqual(withB.buckets, { reinvest: 1_513_800, tax: 504_600 });
  const noB = buildCommissionVehicleItem({ vehicle, payables: [mkPayable()], bucketTransfers: [] });
  assert.equal(noB.buckets, null);
});

test('item: sharePct derivable aunque falte saleParticipant (dato legacy)', () => {
  const payables = [
    mkPayable({ saleParticipant: null }),
    mkPayable({ id: 'pay-2', totalAmount: 2_119_320, saleParticipant: null }),
  ];
  const item = buildCommissionVehicleItem({ vehicle, payables, bucketTransfers: [] });
  // 908280 / 3027600 = 30% (derivado de montos reales)
  assert.equal(item.roles[0].sharePct, 30);
  assert.equal(item.roles[0].role, 'OTHER');
});
```

- [ ] **Step 2: Correr y verificar RED**

Run: `cd backend && node --test src/services/__tests__/commissionService.test.js`
Expected: FAIL — `buildCommissionVehicleItem is not a function`.

- [ ] **Step 3: Implementar helper puro + listByVehicle**

En `backend/src/services/commissionService.js`, después de `calculateCashRatio` y antes de `module.exports`:

```js
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
```

Y extender el export:

```js
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
```

- [ ] **Step 4: Verificar GREEN**

Run: `cd backend && node --test src/services/__tests__/commissionService.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Controller + ruta + mount**

Crear `backend/src/controllers/commissionController.js`:

```js
// ═══════════════════════════════════════════════════════════════
// Controller — Commissions (comisiones por vehículo vendido)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const commissionService = require('../services/commissionService');

const list = async (req, res, next) => {
  try {
    const { status } = req.query;
    const items = await commissionService.listByVehicle(prisma, { status });
    res.json(items);
  } catch (err) { next(err); }
};

module.exports = { list };
```

Crear `backend/src/routes/commissions.js`:

```js
const { Router } = require('express');
const ctrl = require('../controllers/commissionController');

const router = Router();

router.get('/', ctrl.list);

module.exports = router;
```

En `backend/src/routes/index.js`, junto a los demás mounts (después de la línea `router.use('/payables', require('./payables'));`):

```js
router.use('/commissions', require('./commissions'));
```

- [ ] **Step 6: Suite backend completa**

Run: `cd backend && npm test`
Expected: PASS total, sin regresiones.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/commissionService.js backend/src/services/__tests__/commissionService.test.js backend/src/controllers/commissionController.js backend/src/routes/commissions.js backend/src/routes/index.js
git commit -m "feat(commissions): GET /api/commissions — items por vehículo con cascada y roles"
```

---

### Task 2: Frontend — CommissionsPage + ruta + acceso

**Files:**
- Create: `frontend/src/pages/treasury/CommissionsPage.jsx`
- Modify: `frontend/src/lib/payablesApi.js` (agregar `commissionsApi`)
- Modify: `frontend/src/App.jsx` (ruta `/treasury/commissions`, junto a las demás de treasury ~línea 63)
- Modify: `frontend/src/pages/treasury/TreasuryPage.jsx` (Link "Comisiones" junto a los botones del header, ~línea 134)

**Interfaces:**
- Consumes: `GET /api/commissions` (Task 1); `PaymentModal` existente (`@/components/treasury`, props: isOpen,onClose,onSubmit,title,type,totalAmount,paidAmount,defaultDescription,loading); `payablesApi.addPayment(id, data)` existente; `formatCurrency`,`formatDate` de `@/lib/constants`.
- Produces: testids para Task 4: `commissions-page`, `commission-card-<plate>`, `commission-role-<plate>-<ROLE>` (fila), `commission-pay-<plate>-<ROLE>` (botón), `commission-role-status-<plate>-<ROLE>`, `commissions-kpi-pending`, `commissions-paid-section`.

- [ ] **Step 1: Cliente API**

En `frontend/src/lib/payablesApi.js`, después del objeto `payablesApi`:

```js
// ── Comisiones por vehículo vendido ──
export const commissionsApi = {
  getAll: (params = {}) => api.get('/commissions', { params }),
};
```

- [ ] **Step 2: Página**

Crear `frontend/src/pages/treasury/CommissionsPage.jsx`:

```jsx
// ═══════════════════════════════════════════════════════════════
// Commissions Page — comisiones por carro vendido (cascada + pago por rol)
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { commissionsApi, payablesApi } from '@/lib/payablesApi';
import { formatCurrency, formatDate } from '@/lib/constants';
import { PaymentModal } from '@/components/treasury';
import { Briefcase, ChevronDown, ChevronRight } from 'lucide-react';

const ROLE_LABEL = { CAPTADOR: 'Captador', CERRADOR: 'Cerrador', OTHER: 'Otro' };
const STATUS_BADGE = {
  PENDING: 'bg-amber-500/20 text-amber-400',
  PARTIAL: 'bg-sky-500/20 text-sky-400',
  PAID: 'bg-green-500/20 text-green-400',
  CANCELLED: 'bg-[#6E7681]/20 text-[#6E7681] line-through',
};
const STATUS_LABEL = { PENDING: 'Pendiente', PARTIAL: 'Parcial', PAID: 'Pagado', CANCELLED: 'Cancelada' };

function CascadeRow({ label, value, negative, bold }) {
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-semibold text-[#E6EDF3] border-t border-border pt-1 mt-1' : 'text-[#8B949E]'}`}>
      <span>{label}</span>
      <span className="font-mono">{negative ? '− ' : ''}{formatCurrency(value)}</span>
    </div>
  );
}

function CommissionCard({ item, onPay }) {
  const { vehicle, cascade, roles, buckets } = item;
  const pct = cascade.commissionBase > 0 ? Math.round((cascade.commissionPool / cascade.commissionBase) * 100) : 0;
  return (
    <div className="card p-4 space-y-3" data-testid={`commission-card-${vehicle.plate}`}>
      <div className="flex justify-between items-start">
        <div>
          <span className="plate-text">{vehicle.plate}</span>
          <span className="text-sm text-[#8B949E] ml-2">{vehicle.brand} {vehicle.model}</span>
        </div>
        <span className="text-xs text-[#6E7681]">vendida {formatDate(vehicle.saleDate)}</span>
      </div>

      {/* Cascada contable */}
      <div className="bg-[#161B22] rounded-lg p-3">
        <CascadeRow label="Venta" value={cascade.salePrice} />
        <CascadeRow label="Costo" value={cascade.purchaseCost} negative />
        <CascadeRow label="Gastos" value={cascade.directExpenses} negative />
        <CascadeRow label="Ganancia" value={cascade.grossProfit} bold />
        <CascadeRow label={`Base comisión (×${Math.round(cascade.participation * 100)}% part.)`} value={cascade.commissionBase} />
        <CascadeRow label={`Bolsillo comisión (${pct}%)`} value={cascade.commissionPool} bold />
        {buckets && (
          <div className="text-[11px] text-[#6E7681] mt-1.5">
            · Reinversión {formatCurrency(buckets.reinvest)} · Impuestos {formatCurrency(buckets.tax)} <span className="text-green-500">✓ auto</span>
          </div>
        )}
      </div>

      {/* Roles */}
      <div className="space-y-2">
        {roles.map((r) => (
          <div
            key={r.payableId}
            className="flex items-center justify-between gap-2 text-sm border-t border-border/50 pt-2"
            data-testid={`commission-role-${vehicle.plate}-${r.role}`}
          >
            <div className="min-w-0">
              <span className="font-semibold text-[#E6EDF3]">{ROLE_LABEL[r.role] || r.role}</span>
              <span className="text-[#8B949E] ml-1.5">{r.thirdParty.name} ({r.sharePct}%)</span>
              {r.payments.length > 0 && (
                <div className="text-[11px] text-[#6E7681]">
                  {r.payments.map((p, i) => (
                    <span key={i}>{formatCurrency(p.amount)} · {p.accountName} · {formatDate(p.date)}{i < r.payments.length - 1 ? ' — ' : ''}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[#E6EDF3]">{formatCurrency(r.total)}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_BADGE[r.status]}`}
                data-testid={`commission-role-status-${vehicle.plate}-${r.role}`}
              >
                {STATUS_LABEL[r.status] || r.status}
              </span>
              {(r.status === 'PENDING' || r.status === 'PARTIAL') && (
                <button
                  type="button"
                  onClick={() => onPay(item, r)}
                  className="btn-primary text-xs px-2.5 py-1"
                  data-testid={`commission-pay-${vehicle.plate}-${r.role}`}
                >
                  Pagar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CommissionsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPaid, setShowPaid] = useState(false);
  const [paying, setPaying] = useState(null); // { item, role }
  const [processing, setProcessing] = useState(false);

  const load = async () => {
    try {
      const { data } = await commissionsApi.getAll();
      setItems(data || []);
    } catch (err) {
      console.error('Error loading commissions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handlePaymentSubmit = async (paymentData) => {
    setProcessing(true);
    try {
      await payablesApi.addPayment(paying.role.payableId, paymentData);
      setPaying(null);
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'Error al registrar el pago');
    } finally {
      setProcessing(false);
    }
  };

  const pending = items.filter((i) => i.hasPending);
  const paid = items.filter((i) => !i.hasPending);
  const totalPending = pending.reduce(
    (s, i) => s + i.roles.reduce((rs, r) => rs + (r.status === 'CANCELLED' ? 0 : r.pending), 0), 0,
  );
  const pendingByRole = (role) => pending.reduce(
    (s, i) => s + i.roles.filter((r) => r.role === role && r.status !== 'CANCELLED').reduce((rs, r) => rs + r.pending, 0), 0,
  );

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-[#8B949E]">Cargando...</div></div>;
  }

  return (
    <div className="space-y-6" data-testid="commissions-page">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-[#E6EDF3] inline-flex items-center gap-2">
          <Briefcase className="w-5 h-5" /> Comisiones
        </h2>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="text-xs text-[#6E7681]">Pendiente por pagar</div>
          <div className="text-lg font-mono font-bold text-amber-400 mt-1" data-testid="commissions-kpi-pending">
            {formatCurrency(totalPending)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[#6E7681]">Captador pendiente</div>
          <div className="text-lg font-mono font-bold text-[#BC8CFF] mt-1">{formatCurrency(pendingByRole('CAPTADOR'))}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[#6E7681]">Cerrador pendiente</div>
          <div className="text-lg font-mono font-bold text-[#BC8CFF] mt-1">{formatCurrency(pendingByRole('CERRADOR'))}</div>
        </div>
      </div>

      {/* Pendientes */}
      {pending.length === 0 ? (
        <div className="card p-8 text-center text-[#8B949E]">No hay comisiones pendientes</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {pending.map((item) => (
            <CommissionCard key={item.vehicle.id} item={item} onPay={(it, r) => setPaying({ item: it, role: r })} />
          ))}
        </div>
      )}

      {/* Historial pagadas (colapsado) */}
      {paid.length > 0 && (
        <section data-testid="commissions-paid-section">
          <button
            type="button"
            onClick={() => setShowPaid((s) => !s)}
            className="w-full flex items-center gap-2 text-sm font-semibold text-[#8B949E] hover:text-[#E6EDF3]"
          >
            {showPaid ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Pagadas ({paid.length})
          </button>
          {showPaid && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
              {paid.map((item) => (
                <CommissionCard key={item.vehicle.id} item={item} onPay={(it, r) => setPaying({ item: it, role: r })} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Pago por rol → flujo existente de CxP */}
      {paying && (
        <PaymentModal
          isOpen={!!paying}
          onClose={() => setPaying(null)}
          onSubmit={handlePaymentSubmit}
          title={`Pagar comisión ${ROLE_LABEL[paying.role.role] || paying.role.role} — ${paying.item.vehicle.plate}`}
          type="expense"
          totalAmount={paying.role.total}
          paidAmount={paying.role.paid}
          defaultDescription={`Comisión venta ${paying.item.vehicle.plate} — ${paying.role.role}`}
          loading={processing}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Ruta + acceso**

En `frontend/src/App.jsx`: importar `CommissionsPage` junto a los demás imports de treasury y agregar (junto a `treasury/payables`):

```jsx
import CommissionsPage from '@/pages/treasury/CommissionsPage';
```
```jsx
          <Route path="treasury/commissions" element={<CommissionsPage />} />
```

En `frontend/src/pages/treasury/TreasuryPage.jsx`, junto a los Links del header (después del Link a `/treasury/third-parties`):

```jsx
          <Link to="/treasury/commissions" className="btn-ghost text-sm" data-testid="treasury-commissions-link">
            Comisiones
          </Link>
```

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/treasury/CommissionsPage.jsx frontend/src/lib/payablesApi.js frontend/src/App.jsx frontend/src/pages/treasury/TreasuryPage.jsx
git commit -m "feat(ui): página de comisiones por carro vendido — cascada + pago por rol"
```

---

### Task 3: Selector opcional de participantes en SalePaymentModal

**Files:**
- Modify: `frontend/src/components/treasury/SalePaymentModal.jsx`

**Interfaces:**
- Consumes: `api.get('/settings/commission-config')` (existente; devuelve `default_captador_pct`/`default_cerrador_pct` como strings); `ThirdPartySelector` (`@/components/shared/ThirdPartySelector`, props: value,onChange,label,placeholder — sin filterType para listar todos los terceros).
- Produces: si el usuario tocó la sección, `saleData.participants = [{thirdPartyId, role:'CAPTADOR', sharePct}, {thirdPartyId, role:'CERRADOR', sharePct}]`; si no, el payload NO incluye `participants` (default backend intacto). Testids para Task 4: `sale-commission-toggle`, `sale-captador-pct`, `sale-cerrador-pct` (los selectores de tercero usan los testids internos de ThirdPartySelector).

- [ ] **Step 1: Estado + carga de defaults**

En `SalePaymentModal.jsx`, agregar imports:

```jsx
import api from '@/lib/api';
import { ChevronDown, ChevronRight } from 'lucide-react';
```

(`AlertTriangle` ya está importado de lucide.)

Agregar estado después de `const [form, setForm] = useState({...})`:

```jsx
  // Comisión: sección opcional. touched=false → el payload no manda participants.
  const [commissionOpen, setCommissionOpen] = useState(false);
  const [commissionTouched, setCommissionTouched] = useState(false);
  const [commission, setCommission] = useState({
    captadorId: 'owner-self', captadorPct: 30,
    cerradorId: 'owner-self', cerradorPct: 70,
  });
```

En `loadData()`, después de cargar cuentas:

```jsx
      const cfgRes = await api.get('/settings/commission-config').catch(() => null);
      if (cfgRes?.data) {
        setCommission(c => ({
          ...c,
          captadorPct: Number(cfgRes.data.default_captador_pct) || 30,
          cerradorPct: Number(cfgRes.data.default_cerrador_pct) || 70,
        }));
      }
```

En `resetForm()`, al final:

```jsx
    setCommissionOpen(false);
    setCommissionTouched(false);
```

- [ ] **Step 2: Validación + payload**

En `handleSubmit`, dentro del bloque de validaciones (junto a los demás `newErrors`):

```jsx
    const pctSum = Number(commission.captadorPct) + Number(commission.cerradorPct);
    if (commissionTouched && Math.abs(pctSum - 100) > 0.001) {
      newErrors.commission = `Captador + Cerrador deben sumar 100% (va en ${pctSum}%)`;
    }
    if (commissionTouched && (!commission.captadorId || !commission.cerradorId)) {
      newErrors.commission = 'Selecciona captador y cerrador';
    }
```

Después de construir `saleData` (antes de `await onSubmit(saleData)`):

```jsx
    // Participantes de comisión: solo si el usuario tocó la sección.
    if (commissionTouched) {
      saleData.participants = [
        { thirdPartyId: commission.captadorId, role: 'CAPTADOR', sharePct: Number(commission.captadorPct) },
        { thirdPartyId: commission.cerradorId, role: 'CERRADOR', sharePct: Number(commission.cerradorPct) },
      ];
    }
```

- [ ] **Step 3: UI colapsada**

En el form del paso 2, después del bloque de Financiamiento/CxC y antes de los botones:

```jsx
          {/* Comisión: captador/cerrador (opcional, default: tú) */}
          <div className="border border-border rounded-lg p-3">
            <button
              type="button"
              onClick={() => setCommissionOpen(o => !o)}
              className="w-full flex items-center gap-2 text-sm font-semibold text-[#8B949E] hover:text-[#E6EDF3]"
              data-testid="sale-commission-toggle"
            >
              {commissionOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Comisión — Captador/Cerrador (default: tú)
            </button>
            {commissionOpen && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div className="col-span-2">
                    <ThirdPartySelector
                      value={commission.captadorId}
                      onChange={(id) => { setCommission(c => ({ ...c, captadorId: id })); setCommissionTouched(true); }}
                      label="Captador"
                      placeholder="Seleccionar..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#8B949E] mb-1">%</label>
                    <input
                      type="number" min="0" max="100"
                      value={commission.captadorPct}
                      onChange={(e) => { setCommission(c => ({ ...c, captadorPct: e.target.value })); setCommissionTouched(true); }}
                      className="input w-full"
                      data-testid="sale-captador-pct"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div className="col-span-2">
                    <ThirdPartySelector
                      value={commission.cerradorId}
                      onChange={(id) => { setCommission(c => ({ ...c, cerradorId: id })); setCommissionTouched(true); }}
                      label="Cerrador"
                      placeholder="Seleccionar..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#8B949E] mb-1">%</label>
                    <input
                      type="number" min="0" max="100"
                      value={commission.cerradorPct}
                      onChange={(e) => { setCommission(c => ({ ...c, cerradorPct: e.target.value })); setCommissionTouched(true); }}
                      className="input w-full"
                      data-testid="sale-cerrador-pct"
                    />
                  </div>
                </div>
                {errors.commission && (
                  <p className="text-[11px] text-red-400 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errors.commission}</p>
                )}
              </div>
            )}
          </div>
```

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/treasury/SalePaymentModal.jsx
git commit -m "feat(ui): selector opcional de captador/cerrador en el modal de venta"
```

---

### Task 4: E2E + verificación final

**Files:**
- Create: `tests/e2e/treasury/commissions-page.spec.ts`
- Modify (si hace falta): `tests/helpers/api.ts` (helper `apiListCommissions`)

**Interfaces:**
- Consumes: testids de Tasks 2-3; helpers `apiPinLogin`, `apiCreateVehicle`, `apiRegisterSale`, `apiRequestRaw`, `TEST_SEED_IDS`; ruta UI `/treasury/commissions`.

- [ ] **Step 1: Helper + spec**

En `tests/helpers/api.ts` (junto a los helpers de payables/commissions existentes):

```ts
export async function apiListCommissions(token: string): Promise<Array<{
  vehicle: { id: string; plate: string };
  cascade: { grossProfit: number; commissionPool: number };
  roles: Array<{ role: string; sharePct: number; total: number; status: string; payableId: string; thirdParty: { id: string; name: string } }>;
  hasPending: boolean;
}>> {
  return getJson('/commissions', token);
}
```

Crear `tests/e2e/treasury/commissions-page.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiRegisterSale, apiListCommissions } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

async function sellVehicle(token: string, plateStr: string, participants?: Array<{ thirdPartyId: string; role: 'CAPTADOR' | 'CERRADOR'; sharePct: number }>) {
  const v = await apiCreateVehicle(token, {
    plate: plateStr,
    stage: 'COMPRADO',
    negotiatedValue: 30_000_000,
    purchasePrice: 30_000_000,
    listedPrice: 40_000_000,
    supplierId: TEST_SEED_IDS.supplier,
  });
  await apiRegisterSale(token, v.id, {
    salePrice: 40_000_000,
    paymentType: 'CASH',
    buyerId: TEST_SEED_IDS.buyer,
    cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 40_000_000 },
    ...(participants ? { participants } : {}),
  });
  return v;
}

test.describe('Comisiones — página dedicada', () => {
  test('venta genera card con cascada y 2 roles; pagar CAPTADOR lo deja PAGADO con movimiento ligado a la placa', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const p = plate('COM');
    await sellVehicle(token, p);

    await page.goto('/treasury/commissions');
    await expect(page.getByTestId('commissions-page')).toBeVisible();
    const card = page.getByTestId(`commission-card-${p}`);
    await expect(card).toBeVisible();
    // Cascada: ganancia 10M (40M − 30M, sin gastos)
    await expect(card).toContainText('Ganancia');
    await expect(page.getByTestId(`commission-role-${p}-CAPTADOR`)).toBeVisible();
    await expect(page.getByTestId(`commission-role-${p}-CERRADOR`)).toBeVisible();

    // Pagar captador
    await page.getByTestId(`commission-pay-${p}-CAPTADOR`).click();
    await page.getByTestId('payment-modal-account').selectOption(TEST_SEED_IDS.accountCash);
    await page.getByTestId('payment-modal-submit').click();

    await expect(page.getByTestId(`commission-role-status-${p}-CAPTADOR`)).toContainText('Pagado', { timeout: 10_000 });

    // Trazabilidad: movimiento COMMISSION con placa en Movimientos
    await page.goto('/treasury/transactions');
    await expect(page.getByText(`Comisión venta ${p} — CAPTADOR`).first()).toBeVisible();
  });

  test('venta con participantes custom crea CxPs a nombre del tercero con esos %', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const p = plate('CUS');
    await sellVehicle(token, p, [
      { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 40 },
      { thirdPartyId: 'owner-self', role: 'CERRADOR', sharePct: 60 },
    ]);

    const items = await apiListCommissions(token);
    const item = items.find((i) => i.vehicle.plate === p);
    expect(item).toBeTruthy();
    const captador = item!.roles.find((r) => r.role === 'CAPTADOR');
    expect(captador?.thirdParty.id).toBe(TEST_SEED_IDS.employee);
    expect(captador?.sharePct).toBe(40);

    // Y la UI lo refleja
    await page.goto('/treasury/commissions');
    await expect(page.getByTestId(`commission-role-${p}-CAPTADOR`)).toContainText('40%');
  });
});
```

Nota: si el pago del captador dispara la advertencia de saldo del PaymentModal, no bloquea (es un warning, el submit procede). Si `selectOption` falla porque la cuenta ya viene seleccionada, es inofensivo.

- [ ] **Step 2: Correr los e2e nuevos**

Run: `npx playwright test tests/e2e/treasury/commissions-page.spec.ts --reporter=list`
Expected: 2 passed. (Playwright levanta backend+frontend; puertos 4000/5173 deben estar libres.)

- [ ] **Step 3: Verificación completa**

Run: `cd backend && npm test` → PASS total.
Run: `cd frontend && npm run build` → OK.
Run: `npx playwright test tests/e2e/sales/commissions.spec.ts tests/e2e/treasury/ --reporter=list` → sin regresiones (en particular el spec de comisiones Fase 1 y los de treasury).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/treasury/commissions-page.spec.ts tests/helpers/api.ts
git commit -m "test(e2e): página de comisiones — cascada, pago por rol y participantes custom"
```

---

## Self-Review (hecha al escribir)

- **Cobertura del spec:** endpoint+agregación → Task 1; página/KPIs/cascada/pago/historial/acceso → Task 2; selector participantes → Task 3; e2e (pagar rol + custom) + suites → Task 4. Casos borde: base≤0/pre-Fase 1 (no hay CxPs → no aparecen, cubierto por el `where type COMMISSION`), % post-cambio (pool persistido, test unit), parcial (test unit paid/pending), cancelada (test unit hasPending), buckets null (test unit + try/catch en listByVehicle), suma≠100 (validación UI Task 3 + backend existente).
- **Placeholders:** ninguno.
- **Consistencia:** `buildCommissionVehicleItem`/`listByVehicle` (Task 1) consumidos con esas firmas en Tasks 2/4; testids de Tasks 2-3 usados en Task 4; `commissionsApi.getAll` definido en Task 2 y usado allí mismo.
