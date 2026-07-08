# Ganancia del Negocio con Cruce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar la ganancia de un negocio con cruce (trade-in) una sola vez en el pipeline — en el último eslabón vendido de la cadena — con mensaje de diferimiento en los demás eslabones, y aclarar los KPIs del dashboard.

**Architecture:** Helper puro `calculateDealMetrics` en `backend/src/utils/financial.js` (única fuente de verdad financiera del proyecto). `vehicleService` resuelve la cadena de cruces con las relaciones existentes (`sourceVehicleId`/`tradeInsReceived`) y anexa `deal`/`profitDeferredTo` a las metrics. El frontend solo pinta. Cero migraciones.

**Tech Stack:** Node/Express/Prisma (CommonJS), node:test para unit, React 18 + Vite (ESM), Playwright para e2e.

**Spec:** `docs/superpowers/specs/2026-07-07-ganancia-negocio-cruce-design.md`

## Global Constraints

- Backend CommonJS (`require`), frontend ES Modules (`import`).
- UI en español (Colombia); código/variables en inglés.
- Moneda COP sin decimales (`formatCurrency` existente).
- Cálculos financieros SOLO en `backend/src/utils/financial.js`.
- Copys exactos de la card: label diferido `Ganancia`, texto `↪ en cruce <placa>`; label vitrina `Ganancia del negocio (<placas unidas con " + ">)`.
- Subtítulos dashboard: `después de fijos y comisiones` (Ganancia Neta) y `según participación` (Mi Ganancia Total).
- Antes del merge: suite backend completa (`cd backend && npm test`) + build frontend + e2e nuevos. No solo el test enfocado.

---

### Task 1: Helper puro `calculateDealMetrics` (TDD)

**Files:**
- Modify: `backend/src/utils/financial.js` (agregar función + export en `module.exports`, línea ~252)
- Test: `backend/src/utils/__tests__/financial.test.js` (agregar bloque al final)

**Interfaces:**
- Produces: `calculateDealMetrics(chain)` donde `chain` = array de `{ id, plate, stage, salePrice, purchasePrice, saleDate, expenses: [{ amount, deletedAt }] }` en orden de linaje (origen primero). Devuelve `{ directProfit: number (redondeado), chainPlates: string[], closed: boolean, showcaseVehicleId: string|null }`. `showcaseVehicleId` solo es no-null cuando `closed === true` (mayor `saleDate`; empate → mayor `id` como string).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `backend/src/utils/__tests__/financial.test.js`:

```js
// ── calculateDealMetrics (ganancia del negocio con cruce) ────
const { calculateDealMetrics } = require('../financial');

const mkVehicle = (over = {}) => ({
  id: 'v1', plate: 'AAA111', stage: 'VENDIDO',
  salePrice: 0, purchasePrice: 0, saleDate: '2026-06-01',
  expenses: [], ...over,
});

test('deal: vehículo único vendido — directa propia y vitrina él mismo', () => {
  const chain = [mkVehicle({ salePrice: 40_000_000, purchasePrice: 30_000_000, expenses: [{ amount: 1_000_000 }] })];
  const d = calculateDealMetrics(chain);
  assert.equal(d.directProfit, 9_000_000);
  assert.equal(d.closed, true);
  assert.equal(d.showcaseVehicleId, 'v1');
  assert.deepEqual(d.chainPlates, ['AAA111']);
});

test('deal: cadena viva (cruce sin vender) — closed false y sin vitrina', () => {
  const chain = [
    mkVehicle({ id: 'src', plate: 'FJT326', salePrice: 57_500_000, purchasePrice: 50_000_000 }),
    mkVehicle({ id: 'ti', plate: 'PZD94H', stage: 'DISPONIBLE', purchasePrice: 17_500_000, saleDate: null }),
  ];
  const d = calculateDealMetrics(chain);
  assert.equal(d.closed, false);
  assert.equal(d.showcaseVehicleId, null);
});

test('deal: cadena cerrada de 2 — caso real Vitara + moto = 2.623.500', () => {
  const chain = [
    mkVehicle({
      id: 'src', plate: 'FJT326', salePrice: 57_500_000, purchasePrice: 50_000_000,
      saleDate: '2026-06-01', expenses: [{ amount: 2_454_000 }],
    }),
    mkVehicle({
      id: 'ti', plate: 'PZD94H', salePrice: 15_390_000, purchasePrice: 17_500_000,
      saleDate: '2026-06-27', expenses: [{ amount: 262_500 }, { amount: 50_000 }],
    }),
  ];
  const d = calculateDealMetrics(chain);
  assert.equal(d.directProfit, 2_623_500);
  assert.equal(d.closed, true);
  assert.equal(d.showcaseVehicleId, 'ti');
  assert.deepEqual(d.chainPlates, ['FJT326', 'PZD94H']);
});

test('deal: cadena de 3 — suma total y vitrina en el último vendido', () => {
  const chain = [
    mkVehicle({ id: 'a', plate: 'A', salePrice: 10, purchasePrice: 5, saleDate: '2026-01-01' }),
    mkVehicle({ id: 'b', plate: 'B', salePrice: 8, purchasePrice: 6, saleDate: '2026-02-01' }),
    mkVehicle({ id: 'c', plate: 'C', salePrice: 3, purchasePrice: 4, saleDate: '2026-03-01' }),
  ];
  const d = calculateDealMetrics(chain);
  assert.equal(d.directProfit, 6);
  assert.equal(d.showcaseVehicleId, 'c');
});

test('deal: empate de saleDate — vitrina por id mayor (string)', () => {
  const chain = [
    mkVehicle({ id: 'a', plate: 'A', saleDate: '2026-03-01' }),
    mkVehicle({ id: 'b', plate: 'B', saleDate: '2026-03-01' }),
  ];
  const d = calculateDealMetrics(chain);
  assert.equal(d.showcaseVehicleId, 'b');
});

test('deal: gastos soft-deleted no cuentan', () => {
  const chain = [mkVehicle({
    salePrice: 10_000_000, purchasePrice: 8_000_000,
    expenses: [{ amount: 500_000 }, { amount: 999_999, deletedAt: '2026-06-01T00:00:00Z' }],
  })];
  assert.equal(calculateDealMetrics(chain).directProfit, 1_500_000);
});

test('deal: cadena vacía — cerrada false, sin vitrina, directa 0', () => {
  const d = calculateDealMetrics([]);
  assert.equal(d.closed, false);
  assert.equal(d.showcaseVehicleId, null);
  assert.equal(d.directProfit, 0);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: FAIL — `calculateDealMetrics is not a function`.

- [ ] **Step 3: Implementación mínima**

En `backend/src/utils/financial.js`, antes de `module.exports` (después de `splitFinalPayment`):

```js
/**
 * Métricas del "negocio" de una cadena de cruces (trade-in).
 * `chain` viene en orden de linaje (origen primero) con:
 *   { id, plate, stage, salePrice, purchasePrice, saleDate, expenses: [{ amount, deletedAt }] }
 * Ganancia DIRECTA: venta − compra − gastos directos (sin fijos prorrateados
 * ni comisiones — decisión de producto: eso vive en el detalle del vehículo).
 * La vitrina (showcase) es el eslabón que muestra la ganancia en el pipeline:
 * el último vendido (mayor saleDate; empate → mayor id) y solo existe con la
 * cadena cerrada (todos VENDIDO).
 */
function calculateDealMetrics(chain) {
  const members = chain || [];
  const closed = members.length > 0 && members.every((m) => m.stage === 'VENDIDO');

  const directProfit = members.reduce((sum, m) => {
    const expenses = (m.expenses || [])
      .filter((e) => !e.deletedAt)
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    return sum + Number(m.salePrice || 0) - Number(m.purchasePrice || 0) - expenses;
  }, 0);

  let showcaseVehicleId = null;
  if (closed) {
    const showcase = members.reduce((best, m) => {
      if (!best) return m;
      const a = new Date(m.saleDate || 0).getTime();
      const b = new Date(best.saleDate || 0).getTime();
      if (a !== b) return a > b ? m : best;
      return String(m.id) > String(best.id) ? m : best;
    }, null);
    showcaseVehicleId = showcase.id;
  }

  return {
    directProfit: Math.round(directProfit),
    chainPlates: members.map((m) => m.plate),
    closed,
    showcaseVehicleId,
  };
}
```

Y en `module.exports` agregar `calculateDealMetrics`:

```js
module.exports = { daysBetween, calculateVehicleMetrics, projectProfit, calculateParticipation, calculateCommissionBase, roundCop, calcLoanInterest, splitLoanPayment, splitFinalPayment, calculateDealMetrics };
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: PASS (los 7 nuevos + los preexistentes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/financial.js backend/src/utils/__tests__/financial.test.js
git commit -m "feat(financial): calculateDealMetrics — ganancia directa del negocio con cruce"
```

---

### Task 2: Enriquecer metrics en `vehicleService` (deal / profitDeferredTo)

**Files:**
- Modify: `backend/src/services/vehicleService.js` (helpers a nivel de módulo cerca de `settleTradeInPurchase` ~línea 89; cablear en `findAll` ~línea 127 y `findById` ~línea 160)

**Interfaces:**
- Consumes: `calculateDealMetrics(chain)` de Task 1.
- Produces: en las respuestas de `GET /vehicles` y `GET /vehicles/:id`, `metrics` puede traer:
  - `deal: { directProfit: number, chainPlates: string[] }` — SOLO en el eslabón vitrina de una cadena cerrada (≥2 miembros).
  - `profitDeferredTo: { id: string, plate: string, closed: boolean, directProfit: number|null }` — en los demás eslabones VENDIDO de la cadena; apunta a la vitrina si cerrada, o al primer eslabón no vendido si viva. `directProfit` no-null solo si `closed`.
  - Vehículos sin cruces: ninguno de los dos campos (el frontend no cambia nada).

- [ ] **Step 1: Agregar helpers de cadena**

En `backend/src/services/vehicleService.js`, importar el helper (línea 7 ya trae otros de financial):

```js
const { calculateVehicleMetrics, calculateParticipation, calculateDealMetrics } = require('../utils/financial');
```

Después de `settleTradeInPurchase` (~línea 103), agregar:

```js
// ── Cadena de cruces (deal) ─────────────────────────────────────
// Selección mínima para calcular la ganancia directa de un eslabón.
const DEAL_CHAIN_SELECT = {
  id: true, plate: true, stage: true, salePrice: true, purchasePrice: true,
  saleDate: true, sourceVehicleId: true,
  expenses: { select: { amount: true, deletedAt: true } },
  tradeInsReceived: { select: { id: true } },
};

function toChainNode(v) {
  return {
    id: v.id, plate: v.plate, stage: v.stage,
    salePrice: v.salePrice, purchasePrice: v.purchasePrice,
    saleDate: v.saleDate, sourceVehicleId: v.sourceVehicleId,
    expenses: (v.expenses || []).map((e) => ({ amount: e.amount, deletedAt: e.deletedAt })),
    tradeInIds: (v.tradeInsReceived || []).map((t) => t.id),
  };
}

// Cierra transitivamente el grafo de cruces: sube por sourceVehicleId y baja
// por tradeInsReceived, trayendo de la DB los eslabones que no vinieron en la
// lista original. Cap defensivo de profundidad 10 (spec).
async function loadDealChainNodes(vehicles) {
  const known = new Map(vehicles.map((v) => [v.id, toChainNode(v)]));
  for (let depth = 0; depth < 10; depth++) {
    const missing = new Set();
    for (const node of known.values()) {
      if (node.sourceVehicleId && !known.has(node.sourceVehicleId)) missing.add(node.sourceVehicleId);
      for (const tid of node.tradeInIds) if (!known.has(tid)) missing.add(tid);
    }
    if (missing.size === 0) break;
    const rows = await prisma.vehicle.findMany({
      where: { id: { in: [...missing] } },
      select: DEAL_CHAIN_SELECT,
    });
    if (rows.length === 0) break; // referencias rotas (SetNull/borrados)
    for (const r of rows) known.set(r.id, toChainNode(r));
  }
  return known;
}

// Miembros de la cadena en orden de linaje: raíz primero, DFS por cruces.
function chainMembersFor(rootId, known) {
  const out = [];
  const walk = (id) => {
    const node = known.get(id);
    if (!node || out.includes(node)) return;
    out.push(node);
    for (const tid of node.tradeInIds) walk(tid);
  };
  walk(rootId);
  return out;
}

// Anexa deal/profitDeferredTo a las metrics de los vehículos que pertenecen
// a una cadena de cruces (≥2 eslabones). Los demás pasan intactos.
async function enrichWithDealMetrics(vehicles) {
  const involved = vehicles.some(
    (v) => v.sourceVehicleId || (v.tradeInsReceived || []).length > 0,
  );
  if (!involved) return vehicles;

  const known = await loadDealChainNodes(vehicles);
  const rootOf = (id) => {
    let cur = known.get(id);
    let guard = 0;
    while (cur && cur.sourceVehicleId && known.has(cur.sourceVehicleId) && guard++ < 10) {
      cur = known.get(cur.sourceVehicleId);
    }
    return cur ? cur.id : id;
  };

  const dealByRoot = new Map();
  return vehicles.map((v) => {
    if (!v.sourceVehicleId && (v.tradeInsReceived || []).length === 0) return v;
    const rootId = rootOf(v.id);
    if (!dealByRoot.has(rootId)) {
      const members = chainMembersFor(rootId, known);
      dealByRoot.set(
        rootId,
        members.length >= 2 ? { members, deal: calculateDealMetrics(members) } : null,
      );
    }
    const entry = dealByRoot.get(rootId);
    if (!entry || v.stage !== 'VENDIDO') return v;

    const { members, deal } = entry;
    if (deal.closed && deal.showcaseVehicleId === v.id) {
      return {
        ...v,
        metrics: { ...v.metrics, deal: { directProfit: deal.directProfit, chainPlates: deal.chainPlates } },
      };
    }
    const target = deal.closed
      ? members.find((m) => m.id === deal.showcaseVehicleId)
      : members.find((m) => m.stage !== 'VENDIDO');
    if (!target || target.id === v.id) return v;
    return {
      ...v,
      metrics: {
        ...v.metrics,
        profitDeferredTo: {
          id: target.id,
          plate: target.plate,
          closed: deal.closed,
          directProfit: deal.closed ? deal.directProfit : null,
        },
      },
    };
  });
}
```

- [ ] **Step 2: Cablear en `findAll` y `findById`**

En `findAll` (~línea 127), reemplazar:

```js
    return vehicles.map(v => ({
      ...v,
      metrics: calculateVehicleMetrics(v, fixedMonthly),
    }));
```

por:

```js
    const withMetrics = vehicles.map(v => ({
      ...v,
      metrics: calculateVehicleMetrics(v, fixedMonthly),
    }));
    return enrichWithDealMetrics(withMetrics);
```

En `findById` (~línea 160), reemplazar la línea de retorno que arma metrics:

```js
    return {
      ...vehicle,
      metrics: calculateVehicleMetrics(vehicle, fixedMonthly, commissionPayables),
    };
```

por:

```js
    const [enriched] = await enrichWithDealMetrics([
      { ...vehicle, metrics: calculateVehicleMetrics(vehicle, fixedMonthly, commissionPayables) },
    ]);
    return enriched;
```

(Los otros retornos de `findById`-like en `update`/`moveStage` quedan intactos: la card se alimenta de `findAll` y el detalle de `findById`; tras una mutación el frontend recarga.)

- [ ] **Step 3: Correr la suite backend completa**

Run: `cd backend && npm test`
Expected: PASS total (los tests de financial + resto de la suite). Este task no tiene unit test propio porque toca Prisma; su comportamiento observable se cubre con el e2e de Task 5.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/vehicleService.js
git commit -m "feat(vehicles): metrics.deal y metrics.profitDeferredTo por cadena de cruces"
```

---

### Task 3: Card del Kanban — tres ramas para VENDIDO

**Files:**
- Modify: `frontend/src/pages/KanbanPage.jsx` (bloque VENDIDO, líneas ~450-456)

**Interfaces:**
- Consumes: `m.deal { directProfit, chainPlates }` y `m.profitDeferredTo { id, plate }` de Task 2 (via `useApp().vehicles` → `v.metrics`). `navigate` de react-router ya existe en el componente.

- [ ] **Step 1: Reemplazar el bloque de ganancia**

En `frontend/src/pages/KanbanPage.jsx`, reemplazar:

```jsx
                        {v.stage === 'VENDIDO' ? (
                          <div className="text-right">
                            <div className="text-[#6E7681]">Ganancia</div>
                            <div className={`font-mono font-bold ${m.netProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]'}`}>
                              {formatCurrency(m.netProfit)}
                            </div>
                          </div>
                        ) : m.daysInInventory > 0 ? (
```

por:

```jsx
                        {v.stage === 'VENDIDO' ? (
                          <div className="text-right">
                            {m.profitDeferredTo ? (
                              <>
                                <div className="text-[#6E7681]">Ganancia</div>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); navigate(`/vehicles/${m.profitDeferredTo.id}`); }}
                                  className="font-semibold text-[#BC8CFF] hover:underline"
                                  data-testid={`deal-deferred-${v.plate}`}
                                >
                                  ↪ en cruce {m.profitDeferredTo.plate}
                                </button>
                              </>
                            ) : m.deal ? (
                              <>
                                <div className="text-[#6E7681]">Ganancia del negocio ({m.deal.chainPlates.join(' + ')})</div>
                                <div
                                  className={`font-mono font-bold ${m.deal.directProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]'}`}
                                  data-testid={`deal-profit-${v.plate}`}
                                >
                                  {formatCurrency(m.deal.directProfit)}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="text-[#6E7681]">Ganancia</div>
                                <div className={`font-mono font-bold ${m.netProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]'}`}>
                                  {formatCurrency(m.netProfit)}
                                </div>
                              </>
                            )}
                          </div>
                        ) : m.daysInInventory > 0 ? (
```

- [ ] **Step 2: Build de verificación**

Run: `cd frontend && npm run build`
Expected: build OK sin warnings de sintaxis.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/KanbanPage.jsx
git commit -m "feat(ui): card kanban muestra ganancia del negocio en la vitrina y difiere en el resto de la cadena"
```

---

### Task 4: Dashboard con subtítulos + línea de negocio en el detalle

**Files:**
- Modify: `frontend/src/pages/DashboardPage.jsx` (array `kpiCards` línea ~26 y su render línea ~58)
- Modify: `frontend/src/pages/VehicleDetailPage.jsx` (bloques de cruce, líneas ~305-340)

**Interfaces:**
- Consumes: `vehicle.metrics.deal` / `vehicle.metrics.profitDeferredTo` (Task 2) en el detalle. Dashboard no consume datos nuevos.

- [ ] **Step 1: Subtítulos en KPIs del dashboard**

En `frontend/src/pages/DashboardPage.jsx`, en `kpiCards`, reemplazar las dos entradas de ganancia:

```jsx
    { label: 'Ganancia Neta', value: formatCurrency(kpis.totalProfit), color: kpis.totalProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]' },
    { label: 'Mi Ganancia Total', value: formatCurrency(kpis.totalMyProfit), color: 'text-[#BC8CFF]' },
```

por:

```jsx
    { label: 'Ganancia Neta', sub: 'después de fijos y comisiones', value: formatCurrency(kpis.totalProfit), color: kpis.totalProfit >= 0 ? 'text-[#3FB950]' : 'text-[#F85149]' },
    { label: 'Mi Ganancia Total', sub: 'según participación', value: formatCurrency(kpis.totalMyProfit), color: 'text-[#BC8CFF]' },
```

Y en el render (map de `kpiCards`), reemplazar:

```jsx
          <div key={i} className="kpi-card">
            <div className="text-[11px] text-[#6E7681] uppercase tracking-wider">{k.label}</div>
            <div className={`text-xl font-bold font-mono mt-1.5 ${k.color}`}>{k.value}</div>
          </div>
```

por:

```jsx
          <div key={i} className="kpi-card">
            <div className="text-[11px] text-[#6E7681] uppercase tracking-wider">{k.label}</div>
            <div className={`text-xl font-bold font-mono mt-1.5 ${k.color}`}>{k.value}</div>
            {k.sub && <div className="text-[10px] text-[#6E7681] mt-0.5">{k.sub}</div>}
          </div>
```

- [ ] **Step 2: Línea "Ganancia del negocio completo" en el detalle**

En `frontend/src/pages/VehicleDetailPage.jsx`, dentro del botón `vehicle-cruce-source-link` (bloque `vehicle.fromTradeIn && vehicle.sourceVehicle`), después del `<div className="text-sm text-[#E6EDF3] mt-0.5">…</div>` existente, agregar:

```jsx
            {(vehicle.metrics?.deal || vehicle.metrics?.profitDeferredTo?.closed) && (
              <div className="text-sm font-mono font-bold mt-1 text-[#E6EDF3]" data-testid="vehicle-deal-profit">
                Ganancia del negocio completo: {formatCurrency(vehicle.metrics?.deal?.directProfit ?? vehicle.metrics.profitDeferredTo.directProfit)}
              </div>
            )}
```

Y en el bloque `vehicle.tradeInsReceived?.length > 0`, inmediatamente después del `.map()` de los botones (dentro del `<div className="mt-3 space-y-2">`), agregar el mismo indicador una sola vez:

```jsx
            {(vehicle.metrics?.deal || vehicle.metrics?.profitDeferredTo?.closed) && (
              <div className="text-sm font-mono font-bold px-3 text-[#E6EDF3]" data-testid="vehicle-deal-profit">
                Ganancia del negocio completo: {formatCurrency(vehicle.metrics?.deal?.directProfit ?? vehicle.metrics.profitDeferredTo.directProfit)}
              </div>
            )}
```

(Nota: los dos bloques son mutuamente excluyentes en un mismo vehículo salvo eslabones intermedios de cadenas de 3 — ahí el `data-testid` duplicado no rompe nada porque los e2e usan `.first()` o el testid de card.)

- [ ] **Step 3: Build de verificación**

Run: `cd frontend && npm run build`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/DashboardPage.jsx frontend/src/pages/VehicleDetailPage.jsx
git commit -m "feat(ui): subtítulos aclaratorios en KPIs y ganancia del negocio completo en el detalle"
```

---

### Task 5: E2E Playwright + verificación final

**Files:**
- Create: `tests/e2e/vehicles/trade-in-deal-profit.spec.ts`

**Interfaces:**
- Consumes: helpers existentes `apiCreateVehicle`, `apiRegisterSale`, `apiMoveStage` (`tests/helpers/api.ts`), `loginAsAdmin`, `TEST_SEED_IDS`; testids `vehicle-card-<plate>`, `deal-deferred-<plate>`, `deal-profit-<plate>` (Task 3).

- [ ] **Step 1: Escribir el spec**

Crear `tests/e2e/vehicles/trade-in-deal-profit.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiRegisterSale, apiMoveStage } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

function plate(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

// Vende un origen (compra 30M, venta 40M) recibiendo un cruce valorado en 15M.
async function sellSourceWithTradeIn(token: string, tradeInPlate: string) {
  const source = await apiCreateVehicle(token, {
    plate: plate('DLS'),
    stage: 'COMPRADO',
    negotiatedValue: 30_000_000,
    purchasePrice: 30_000_000,
    listedPrice: 40_000_000,
    supplierId: TEST_SEED_IDS.supplier,
  });
  const res = await apiRegisterSale(token, source.id, {
    salePrice: 40_000_000,
    paymentType: 'MIXED',
    buyerId: TEST_SEED_IDS.buyer,
    cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 25_000_000 },
    tradeIn: { plate: tradeInPlate, value: 15_000_000, brand: 'Mazda', model: '3', year: 2019 },
  });
  return { source, tradeInId: res.newVehicle!.id };
}

test.describe('Pipeline — ganancia del negocio con cruce', () => {
  test('cadena viva: el origen difiere la ganancia al cruce', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const tiPlate = plate('TIA');
    const { source } = await sellSourceWithTradeIn(token, tiPlate);

    await page.goto('/');
    const card = page.getByTestId(`vehicle-card-${source.plate}`);
    await expect(card).toBeVisible();
    await expect(page.getByTestId(`deal-deferred-${source.plate}`)).toContainText(tiPlate);
  });

  test('cadena cerrada: la vitrina muestra la directa y el origen sigue diferido', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const tiPlate = plate('TIB');
    const { source, tradeInId } = await sellSourceWithTradeIn(token, tiPlate);

    // El cruce nace en NEGOCIANDO: confirmarlo como compra (saldada por cruce) y venderlo.
    await apiMoveStage(token, tradeInId, 'COMPRADO');
    await apiRegisterSale(token, tradeInId, {
      salePrice: 12_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 12_000_000 },
    });

    await page.goto('/');
    // Directa del negocio: (40M − 30M) + (12M − 15M) = 7.000.000
    const showcase = page.getByTestId(`deal-profit-${tiPlate}`);
    await expect(showcase).toBeVisible();
    await expect(showcase).toContainText('7.000.000');
    // El origen NO muestra número: mantiene el diferimiento permanente.
    await expect(page.getByTestId(`deal-deferred-${source.plate}`)).toBeVisible();
    await expect(page.getByTestId(`deal-profit-${source.plate}`)).toHaveCount(0);
  });
});
```

Nota: el KanbanPage es la ruta raíz (`<Route index>` en `frontend/src/App.jsx:58`), por eso `page.goto('/')`. Si `apiMoveStage` a COMPRADO exige otro paso para cruces, replicar la secuencia de `trade-in-source-link.spec.ts` (que ya mueve un cruce a COMPRADO sin fricción).

- [ ] **Step 2: Correr los e2e nuevos**

Run: `npx playwright test tests/e2e/vehicles/trade-in-deal-profit.spec.ts --reporter=list`
Expected: 2 passed.

- [ ] **Step 3: Verificación completa (regla del proyecto)**

Run: `cd backend && npm test`
Expected: suite completa PASS.

Run: `cd frontend && npm run build`
Expected: build OK.

Run: `npx playwright test tests/e2e/vehicles/ --reporter=list`
Expected: sin regresiones en los specs de vehículos (incluye trade-in-source-link).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/vehicles/trade-in-deal-profit.spec.ts
git commit -m "test(e2e): ganancia del negocio con cruce en pipeline (diferido + vitrina)"
```

---

## Self-Review (hecha al escribir)

- **Cobertura del spec:** reglas 1-4 del pipeline → Tasks 2-3; casos borde (cadena viva, cerrada, 3 eslabones, multi-cruce por empate, soft-deleted, cadena rota vía `rows.length === 0`) → Tasks 1-2; dashboard subtítulos → Task 4; detalle → Task 4; unit + e2e → Tasks 1 y 5. El "paso operativo" de la comisión queda explícitamente FUERA de este plan (es un procedimiento en producción sin código, documentado en el spec).
- **Placeholders:** ninguno; todo step con código completo y comandos con expected.
- **Consistencia de tipos:** `calculateDealMetrics` (Task 1) consumido con la misma firma en Task 2; campos `deal`/`profitDeferredTo` de Task 2 consumidos con los mismos nombres en Tasks 3-4; testids de Task 3 usados en Task 5.
