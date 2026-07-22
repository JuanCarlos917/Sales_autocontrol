# Widget "Socios: pendientes" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un widget en Tesorería y Dashboard que muestra, por vehículo, la ganancia de socio por pagar (CxP `PARTNER_SHARE`) y la comisión de socio por cobrar (CxC "Comisión socio venta"), con acción de pagar/cobrar en el mismo widget.

**Architecture:** Un endpoint backend dedicado (`GET /api/payables/socio-pending`) que arma dos buckets desde las CxP/CxC pendientes. Un componente frontend autocontenido (`SocioPendingWidget`) que hace su propio fetch, se auto-oculta si no hay pendientes, y abre el `PaymentModal` existente al tocar una fila (con el enrutamiento a cuenta socio de FASE B para la ganancia). Se monta en dos páginas.

**Tech Stack:** Node.js + Express + Prisma (CommonJS backend); React + Vite (frontend, ES Modules); node:test (unit backend); Playwright (E2E, API-driven).

## Global Constraints

- Backend CommonJS (`require`/`module.exports`); frontend ES Modules (`import`).
- Moneda COP en enteros (sin decimales).
- Ruta `GET /socio-pending` en `backend/src/routes/payables.js` **debe ir antes de `/:id`** (junto a `/summary`/`/upcoming`). Handler llama al service y responde `res.json(result)` — **sin envelope `{success,data}`**, sin controller.
- Pendiente = `status` en `['PENDING','PARTIAL']`.
- Ganancia = CxP `type: 'PARTNER_SHARE'`. Comisión = CxC `type: 'RECEIVABLE'` con `description` que empieza por `'Comisión socio venta'` (constante `SOCIO_COMMISSION_PREFIX`). La CxC de venta ("Venta vehículo …") NO entra.
- El widget devuelve `null` si ambos buckets están vacíos (se comporta como notificación).
- Errores de pago en el frontend: `alert(err.response?.data?.error || 'Error al procesar el pago')` + mantener modal abierto (mismo patrón que `PayablesList`).

---

### Task 1: Backend — `getSocioPending()` service + ruta + unit test

**Files:**
- Modify: `backend/src/services/payableService.js` (agregar constante, función y export)
- Modify: `backend/src/routes/payables.js` (agregar ruta antes de `/:id`)
- Test: `backend/src/services/__tests__/payableService.socioPending.test.js`

**Interfaces:**
- Produces: `payableService.getSocioPending() -> Promise<{ profit: Bucket, commission: Bucket }>` donde `Bucket = { total:number, count:number, items: Item[] }` e `Item = { id, vehicleId, vehicle:{id,plate,brand,model}|null, thirdParty:{id,name}|null, totalAmount:number, paidAmount:number, pending:number }`.
- Produces: `GET /api/payables/socio-pending` → `res.json(result)` con ese objeto.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/payableService.socioPending.test.js`:

```js
'use strict';
// getSocioPending — pendientes de socio: ganancia por pagar (PARTNER_SHARE) y
// comisión por cobrar (RECEIVABLE con prefijo "Comisión socio venta"). Mismo
// patrón de reemplazo del módulo `../../config/database` que saleService.cancel.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let rows; // fixtures fijados por test

const startsWith = (value, filter) =>
  typeof filter?.startsWith === 'string' && (value || '').startsWith(filter.startsWith);
const statusMatch = (value, filter) =>
  filter && Array.isArray(filter.in) ? filter.in.includes(value) : value === filter;

const fakePrisma = {
  payable: {
    findMany: async ({ where }) =>
      rows.filter(
        (p) =>
          p.type === where.type &&
          statusMatch(p.status, where.status) &&
          (where.description ? startsWith(p.description, where.description) : true),
      ),
  },
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const payableService = require('../payableService');

const mkRow = (over) => ({
  id: 'p', type: 'PARTNER_SHARE', status: 'PENDING',
  totalAmount: 1_000_000, paidAmount: 0, vehicleId: 'v1',
  vehicle: { id: 'v1', plate: 'ABC', brand: 'Mazda', model: '3' },
  thirdParty: { id: 'tp', name: 'Mamá' }, description: 'Ganancia socio venta ABC',
  ...over,
});

test('separa ganancia (PARTNER_SHARE) y comisión (RECEIVABLE prefijo socio) en dos buckets', async () => {
  rows = [
    mkRow({ id: 'g1', type: 'PARTNER_SHARE', totalAmount: 6_400_000, paidAmount: 0 }),
    mkRow({ id: 'c1', type: 'RECEIVABLE', description: 'Comisión socio venta ABC', totalAmount: 1_000_000, paidAmount: 0 }),
  ];
  const out = await payableService.getSocioPending();
  assert.equal(out.profit.count, 1);
  assert.equal(out.profit.items[0].id, 'g1');
  assert.equal(out.profit.total, 6_400_000);
  assert.equal(out.commission.count, 1);
  assert.equal(out.commission.items[0].id, 'c1');
  assert.equal(out.commission.total, 1_000_000);
});

test('excluye la CxC de venta ("Venta vehículo") del bucket de comisión', async () => {
  rows = [
    mkRow({ id: 'sale', type: 'RECEIVABLE', description: 'Venta vehículo ABC', totalAmount: 5_000_000, paidAmount: 0 }),
    mkRow({ id: 'c1', type: 'RECEIVABLE', description: 'Comisión socio venta ABC', totalAmount: 1_000_000, paidAmount: 0 }),
  ];
  const out = await payableService.getSocioPending();
  assert.equal(out.commission.count, 1);
  assert.equal(out.commission.items[0].id, 'c1');
});

test('pending = totalAmount - paidAmount; total = suma de pendings', async () => {
  rows = [
    mkRow({ id: 'g1', type: 'PARTNER_SHARE', totalAmount: 6_400_000, paidAmount: 400_000 }),
    mkRow({ id: 'g2', type: 'PARTNER_SHARE', totalAmount: 2_000_000, paidAmount: 0 }),
  ];
  const out = await payableService.getSocioPending();
  assert.equal(out.profit.items[0].pending, 6_000_000);
  assert.equal(out.profit.total, 8_000_000);
});

test('buckets vacíos → { total:0, count:0, items:[] }', async () => {
  rows = [];
  const out = await payableService.getSocioPending();
  assert.deepEqual(out.profit, { total: 0, count: 0, items: [] });
  assert.deepEqual(out.commission, { total: 0, count: 0, items: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/__tests__/payableService.socioPending.test.js`
Expected: FAIL — `payableService.getSocioPending is not a function`.

- [ ] **Step 3: Write the service**

In `backend/src/services/payableService.js`, add the constant near the top (after the existing top-level consts, e.g. after `PAYABLE_AUDIT_FIELDS`):

```js
// Prefijo de la CxC de comisión que el socio adeuda al fondo. Distingue esta
// RECEIVABLE de la CxC de venta ("Venta vehículo …"), igual que isSaleReceivable.
const SOCIO_COMMISSION_PREFIX = 'Comisión socio venta';
```

Add the function (place it near `getSummary`, before `module.exports`):

```js
/**
 * Pendientes de socio: ganancia por pagar (PARTNER_SHARE) y comisión por
 * cobrar (RECEIVABLE "Comisión socio venta"), agrupadas por vehículo.
 */
const getSocioPending = async () => {
  const PENDING = { in: ['PENDING', 'PARTIAL'] };
  const include = {
    vehicle: { select: { id: true, plate: true, brand: true, model: true } },
    thirdParty: { select: { id: true, name: true } },
  };

  const [profitRows, commissionRows] = await Promise.all([
    prisma.payable.findMany({
      where: { type: 'PARTNER_SHARE', status: PENDING },
      include,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payable.findMany({
      where: {
        type: 'RECEIVABLE',
        status: PENDING,
        description: { startsWith: SOCIO_COMMISSION_PREFIX },
      },
      include,
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const toBucket = (payables) => {
    const items = payables.map((p) => {
      const totalAmount = parseFloat(p.totalAmount);
      const paidAmount = parseFloat(p.paidAmount);
      return {
        id: p.id,
        vehicleId: p.vehicleId,
        vehicle: p.vehicle,
        thirdParty: p.thirdParty,
        totalAmount,
        paidAmount,
        pending: totalAmount - paidAmount,
      };
    });
    return {
      total: items.reduce((sum, it) => sum + it.pending, 0),
      count: items.length,
      items,
    };
  };

  return { profit: toBucket(profitRows), commission: toBucket(commissionRows) };
};
```

Add `getSocioPending` to `module.exports` (the object currently ends with `getSummary,\n  getUpcoming\n};`):

```js
module.exports = {
  getAll,
  getById,
  create,
  addPayment,
  cancel,
  getSummary,
  getUpcoming,
  getSocioPending,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/services/__tests__/payableService.socioPending.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Add the route**

In `backend/src/routes/payables.js`, add this handler immediately AFTER the `GET /upcoming` handler and BEFORE the `GET /` handler (so it never gets captured by `/:id`):

```js
/**
 * GET /api/payables/socio-pending
 * Pendientes de socio: ganancia por pagar (PARTNER_SHARE) y comisión por cobrar.
 */
router.get('/socio-pending', async (req, res, next) => {
  try {
    const result = await payableService.getSocioPending();
    res.json(result);
  } catch (error) { next(error); }
});
```

- [ ] **Step 6: Verify the route resolves (no test harness for routes; smoke via node)**

Run (from `backend/`): `node -e "const r=require('./src/routes/payables'); const layer=r.stack.find(l=>l.route&&l.route.path==='/socio-pending'); console.log(layer?'route registered OK':'ROUTE MISSING')"`
Expected: prints `route registered OK`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/payableService.js backend/src/routes/payables.js backend/src/services/__tests__/payableService.socioPending.test.js
git commit -m "feat: endpoint /payables/socio-pending (ganancia por pagar + comisión por cobrar de socio)"
```

---

### Task 2: Frontend — API client, `SocioPendingWidget`, export y montaje

**Files:**
- Modify: `frontend/src/lib/payablesApi.js` (método `getSocioPending`)
- Create: `frontend/src/components/treasury/SocioPendingWidget.jsx`
- Modify: `frontend/src/components/treasury/index.js` (export)
- Modify: `frontend/src/pages/treasury/TreasuryPage.jsx` (montaje)
- Modify: `frontend/src/pages/DashboardPage.jsx` (montaje)

**Interfaces:**
- Consumes: `GET /api/payables/socio-pending` (Task 1) → `response.data = { profit, commission }`.
- Consumes: `PaymentModal` (prop `thirdPartyId` para el enrutamiento a cuenta socio de FASE B) y `payablesApi.addPayment`.
- Produces: `SocioPendingWidget` (export default) — sin props; autocontenido.

- [ ] **Step 1: Add the API client method**

In `frontend/src/lib/payablesApi.js`, add to the `payablesApi` object (after `getUpcoming`):

```js
  // Pendientes de socio: ganancia por pagar + comisión por cobrar
  getSocioPending: () => api.get('/payables/socio-pending'),
```

- [ ] **Step 2: Create the widget**

Create `frontend/src/components/treasury/SocioPendingWidget.jsx`:

```jsx
// ═══════════════════════════════════════════════════════════════
// SocioPendingWidget — Pendientes de socio (notificación)
// Ganancia por pagar (PARTNER_SHARE) y comisión por cobrar (RECEIVABLE socio).
// Autocontenido: hace su propio fetch; se auto-oculta si no hay pendientes.
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowDownLeft, Car, Users } from 'lucide-react';
import { formatCurrency } from '@/lib/constants';
import { payablesApi } from '@/lib/payablesApi';
import PaymentModal from './PaymentModal';

const MAX_ROWS = 5;

export default function SocioPendingWidget() {
  const [data, setData] = useState(null); // { profit, commission } | null
  const [selected, setSelected] = useState(null); // { item, kind } | null
  const [processing, setProcessing] = useState(false);
  const navigate = useNavigate();

  const reload = async () => {
    try {
      const res = await payablesApi.getSocioPending();
      setData(res.data);
    } catch (err) {
      console.error('Error loading socio pending:', err);
      // No romper la vista: se mantiene el último dato (o null → no se muestra).
    }
  };

  useEffect(() => {
    reload();
  }, []);

  if (!data) return null;
  const { profit, commission } = data;
  if (profit.count === 0 && commission.count === 0) return null;

  const isExpense = selected?.kind === 'profit';

  const handleSubmit = async (paymentData) => {
    if (!selected) return;
    setProcessing(true);
    try {
      await payablesApi.addPayment(selected.item.id, paymentData);
      setSelected(null);
      await reload();
    } catch (err) {
      console.error('Error processing socio payment:', err);
      alert(err.response?.data?.error || 'Error al procesar el pago');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="card p-5" data-testid="socio-pending-widget">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-5 h-5" />
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Socios: pendientes</h3>
      </div>

      {profit.count > 0 && (
        <Section
          title="Ganancia por pagar"
          icon={<ArrowUpRight className="w-4 h-4 text-red-400" />}
          bucket={profit}
          accent="red"
          onRow={(item) => setSelected({ item, kind: 'profit' })}
          navigate={navigate}
        />
      )}

      {commission.count > 0 && (
        <div className={profit.count > 0 ? 'mt-5' : ''}>
          <Section
            title="Comisión por cobrar"
            icon={<ArrowDownLeft className="w-4 h-4 text-green-400" />}
            bucket={commission}
            accent="green"
            onRow={(item) => setSelected({ item, kind: 'commission' })}
            navigate={navigate}
          />
        </div>
      )}

      {selected && (
        <PaymentModal
          isOpen={!!selected}
          onClose={() => setSelected(null)}
          onSubmit={handleSubmit}
          title={isExpense ? 'Pagar ganancia socio' : 'Cobrar comisión socio'}
          type={isExpense ? 'expense' : 'income'}
          totalAmount={selected.item.totalAmount}
          paidAmount={selected.item.paidAmount}
          defaultDescription={
            isExpense
              ? `Ganancia socio ${selected.item.vehicle?.plate || ''}`.trim()
              : `Comisión socio ${selected.item.vehicle?.plate || ''}`.trim()
          }
          thirdPartyId={isExpense ? selected.item.thirdParty?.id : null}
          loading={processing}
        />
      )}
    </div>
  );
}

function Section({ title, icon, bucket, accent, onRow, navigate }) {
  const totalColor = accent === 'red' ? 'text-red-400' : 'text-green-400';
  const rows = bucket.items.slice(0, MAX_ROWS);
  const extra = bucket.items.length - rows.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#8B949E]">
          {icon}
          <span>{title}</span>
        </div>
        <span className={`text-sm font-mono font-semibold ${totalColor}`}>
          {formatCurrency(bucket.total)}
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((item) => (
          <div
            key={item.id}
            onClick={() => onRow(item)}
            className="flex items-center justify-between text-xs p-2 bg-surface-hover rounded-lg cursor-pointer border border-transparent hover:border-border transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[#E6EDF3] truncate flex items-center gap-1">
                <Car className="w-3.5 h-3.5 text-[#8B949E]" />
                <span className="font-mono">{item.vehicle?.plate || 'Sin placa'}</span>
              </div>
              <div className="text-[#6E7681] truncate">
                {item.vehicle && <span>{item.vehicle.brand} {item.vehicle.model} · </span>}
                {item.thirdParty?.name || 'Socio'}
              </div>
            </div>
            <div className={`font-mono font-semibold ml-2 ${totalColor}`}>
              {formatCurrency(item.pending)}
            </div>
          </div>
        ))}
        {extra > 0 && (
          <div className="text-xs text-[#6E7681] text-center pt-1">+{extra} más…</div>
        )}
      </div>
    </div>
  );
}
```

(`navigate` se deja como prop de `Section` por consistencia futura aunque el clic abra el modal; no se usa para navegar en esta fase — quítalo si prefieres, es inocuo. NOTA para el implementador: si tu linter marca `navigate` sin uso, elimina el parámetro `navigate` de `Section` y de las dos invocaciones, y el import `useNavigate`/`navigate` del componente.)

- [ ] **Step 3: Export the widget**

In `frontend/src/components/treasury/index.js`, add under the "Dashboard components" group:

```js
export { default as SocioPendingWidget } from './SocioPendingWidget';
```

- [ ] **Step 4: Mount in TreasuryPage**

In `frontend/src/pages/treasury/TreasuryPage.jsx`:
- Add `SocioPendingWidget` to the existing import from `@/components/treasury` (the line importing `BalanceCard, ReceivablesWidget, PayablesWidgetCxP, CashFlowChart, LoansSummaryCards`).
- Render it immediately AFTER the CxC/CxP grid (`</div>` that closes `{/* Seccion 2 y 3: CxC y CxP */}`) and before `{/* Seccion Prestamos ... */}`:

```jsx
      {/* Pendientes de socio (se auto-oculta si no hay) */}
      <SocioPendingWidget />
```

- [ ] **Step 5: Mount in DashboardPage**

In `frontend/src/pages/DashboardPage.jsx`:
- Add the import near the other component imports: `import { SocioPendingWidget } from '@/components/treasury';`
- Render it immediately AFTER the `{(commSummary || investorSummary) && ( ... )}` block and before the `<div className="grid md:grid-cols-2 gap-4">` (Pipeline):

```jsx
      <SocioPendingWidget />
```

- [ ] **Step 6: Build**

Run: `cd frontend && npm run build`
Expected: build OK, sin errores de sintaxis/imports.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/payablesApi.js frontend/src/components/treasury/SocioPendingWidget.jsx frontend/src/components/treasury/index.js frontend/src/pages/treasury/TreasuryPage.jsx frontend/src/pages/DashboardPage.jsx
git commit -m "feat: SocioPendingWidget en Tesorería y Dashboard (pagar ganancia / cobrar comisión de socio)"
```

---

### Task 3: E2E — el endpoint refleja pagos/cobros de socio

**Files:**
- Modify: `tests/helpers/api.ts` (helper `apiGetSocioPending`)
- Modify: `tests/e2e/treasury/socio.spec.ts` (añadir un test; reutiliza `buyVehicleWithSocio`/`sellSocioVehicleCash`)

**Interfaces:**
- Consumes: `GET /api/payables/socio-pending`, helpers existentes de `../../helpers/api`, `TEST_SEED_IDS` (`.partner`, `.accountCash`).

- [ ] **Step 1: Add the helper**

In `tests/helpers/api.ts`, add (near `apiListPayables`):

```ts
export interface SocioPendingItem {
  id: string;
  vehicleId: string | null;
  vehicle: { id: string; plate: string; brand: string; model: string } | null;
  thirdParty: { id: string; name: string } | null;
  totalAmount: number;
  paidAmount: number;
  pending: number;
}
export interface SocioPendingBucket { total: number; count: number; items: SocioPendingItem[] }
export async function apiGetSocioPending(
  token: string,
): Promise<{ profit: SocioPendingBucket; commission: SocioPendingBucket }> {
  return getJson('/payables/socio-pending', token);
}
```

- [ ] **Step 2: Write the test**

In `tests/e2e/treasury/socio.spec.ts`, add `apiGetSocioPending` and `apiListPayables` to the imports if not already present, then add this test near the other `PARTNER_SHARE` payment tests:

```ts
  test('widget socio: el endpoint /socio-pending refleja pagar la ganancia y cobrar la comisión', async () => {
    const token = await apiPinLogin();
    const v = await buyVehicleWithSocio(token, plate('SPW'), {
      partnerId: TEST_SEED_IDS.partner,
      participation: 0.6,
    });
    await sellSocioVehicleCash(token, v.id);

    // Ambos buckets listan este vehículo.
    const before = await apiGetSocioPending(token);
    const gRow = before.profit.items.find((it) => it.vehicleId === v.id);
    const cRow = before.commission.items.find((it) => it.vehicleId === v.id);
    expect(gRow).toBeTruthy();
    expect(cRow).toBeTruthy();
    expect(gRow!.pending).toBeGreaterThan(0);
    expect(cRow!.pending).toBeGreaterThan(0);

    // Pagar la ganancia (PARTNER_SHARE) → sale del bucket de ganancia.
    const payG = await apiRequestRaw('POST', `/payables/${gRow!.id}/payments`, token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: gRow!.pending,
      description: 'Pago ganancia socio (widget)',
    });
    expect(payG.status).toBe(201);

    const afterG = await apiGetSocioPending(token);
    expect(afterG.profit.items.some((it) => it.vehicleId === v.id)).toBe(false);
    // La comisión sigue pendiente.
    expect(afterG.commission.items.some((it) => it.vehicleId === v.id)).toBe(true);

    // Cobrar la comisión (RECEIVABLE) → sale del bucket de comisión.
    const payC = await apiRequestRaw('POST', `/payables/${cRow!.id}/payments`, token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: cRow!.pending,
      description: 'Cobro comisión socio (widget)',
    });
    expect(payC.status).toBe(201);

    const afterC = await apiGetSocioPending(token);
    expect(afterC.commission.items.some((it) => it.vehicleId === v.id)).toBe(false);
  });
```

- [ ] **Step 3: Run the test**

Run (from repo ROOT — el `webServer` de Playwright arranca backend+frontend y `globalSetup` siembra la DB):
`npm run test:e2e -- tests/e2e/treasury/socio.spec.ts -g "widget socio"`
Expected: PASS.

- [ ] **Step 4: Run the full socio spec (regresión)**

Run: `npm run test:e2e -- tests/e2e/treasury/socio.spec.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/api.ts tests/e2e/treasury/socio.spec.ts
git commit -m "test(e2e): /socio-pending refleja pagar ganancia y cobrar comisión de socio"
```

---

## Self-Review

**1. Spec coverage:**
- §2 alcance (PARTNER_SHARE + RECEIVABLE prefijo socio; excluye venta/PROFIT_SHARE) → Task 1 (where + test de exclusión "Venta vehículo").
- §3 endpoint sin envelope, antes de `/:id` → Task 1 Steps 5-6 (+ smoke de registro).
- §4 widget autocontenido, se oculta si vacío, dos secciones, PaymentModal con thirdPartyId para ganancia / income para comisión, montaje en dos páginas → Task 2.
- §5 errores (alert en pago, console en fetch) → Task 2 widget (`handleSubmit`/`reload`).
- §6 tests unit (4 casos) + E2E (lista y desaparece de cada bucket) → Task 1 + Task 3.
- §7 archivos → cubiertos en las tres tareas.

**2. Placeholder scan:** sin TBD/TODO. La nota sobre `navigate` sin uso en `Section` es una instrucción condicional real para el implementador (evita un warning de linter), no un placeholder de lógica.

**3. Type consistency:** el contrato `{ profit, commission }` con `Bucket={total,count,items}` e `Item={id,vehicleId,vehicle,thirdParty,totalAmount,paidAmount,pending}` es idéntico en Task 1 (service), Task 2 (widget consume `res.data.profit/commission`, `item.id/pending/totalAmount/paidAmount/vehicle/thirdParty`) y Task 3 (`SocioPendingItem`/`SocioPendingBucket`). `PaymentModal` recibe `type`/`totalAmount`/`paidAmount`/`thirdPartyId`/`defaultDescription`/`loading`/`onSubmit`/`isOpen`/`onClose`/`title` — todas props existentes del componente (thirdPartyId añadida en FASE B).
