# Comisión única por negocio con cruce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diferir TODA la distribución (comisión/reservas/ganancia) de una venta que recibe un carro en parte de pago, y liquidarla UNA sola vez al cierre del negocio (venta del carro recibido) sobre la ganancia agregada de la cadena.

**Architecture:** La venta con cruce salta el Paso 5 de `registerSale` (solo crea `CAPITAL_RETURN` parcial si hay socio inversionista 100%). La venta de un vehículo `fromTradeIn` sin nuevo cruce detecta el cierre: carga la cadena por `sourceVehicleId`, filtra eslabones sin distribución previa, y ejecuta `calculateSaleDistribution` con la ganancia agregada (`overrideGrossProfit`). El socio se resuelve desde el eslabón de la cadena que tenga `partnerId`. Reporting (comisiones/inversionistas) muestra la cascada del negocio en el vehículo de cierre.

**Tech Stack:** Node/Express/Prisma (CommonJS), tests con `node:test` + fake prisma vía require-cache, React 18 frontend, Playwright e2e en `tests/e2e/`.

**Spec:** `docs/superpowers/specs/2026-07-24-comision-unica-negocio-cruce-design.md`

## Global Constraints

- Backend CommonJS (`require`), código en inglés, UI en español (Colombia), COP sin decimales.
- Tests backend: `cd backend && npm test` (= `node --test src/`); archivo puntual: `cd backend && node --test src/path/__tests__/file.test.js`.
- E2E: specs en `tests/e2e/`, helpers en `tests/helpers/api.ts`, se corren con `npx playwright test <spec>` desde la raíz.
- Tipos de payable que MARCAN distribución previa: `COMMISSION`, `PROFIT_SHARE`, `PARTNER_SHARE`, `COMMISSION_RETURN`. `CAPITAL_RETURN` NO cuenta (puede existir el parcial del socio).
- El socio externo parcial (share < 1) conserva el flujo inmediato por venta — nunca difiere ni lidera cadena.
- No tocar el flujo de venta normal (sin cruce, sin fromTradeIn): mismos artefactos y montos que hoy (los tests existentes `saleService.dist.test.js` deben seguir verdes sin modificarse).
- Config de cascada en tests unit: `commissionGrossPct: 10, reinvestPct: 30, taxPct: 10`.

---

### Task 1: `financial.js` — `calculateChainGrossProfit` + `overrideGrossProfit`

**Files:**
- Modify: `backend/src/utils/financial.js` (función `calculateSaleDistribution`, línea ~301, y exports línea ~379)
- Test: `backend/src/utils/__tests__/financial.chain.test.js` (nuevo)

**Interfaces:**
- Produces: `calculateChainGrossProfit(members) → { salePrice, purchaseCost, directExpenses, grossProfit, plates }` donde `members` son nodos con `{ plate, salePrice, purchasePrice, negotiatedValue, fromTradeIn, expenses: [{amount, deletedAt}] }`.
- Produces: `calculateSaleDistribution(vehicle, cfg, { sellers, investors, socio, overrideGrossProfit })` — cuando `overrideGrossProfit != null` usa ese número como `grossProfit` y omite el guard `purchaseCost <= 0` del vehículo individual (la validación de base de costo de cadena la hace el caller).

- [ ] **Step 1: Escribir los tests que fallan**

```js
'use strict';
// Tests — cascada con base de cadena (negocio con cruce).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateChainGrossProfit, calculateSaleDistribution } = require('../financial');

const CFG = { commissionGrossPct: 10, reinvestPct: 30, taxPct: 10 };
const SELLERS = [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }];
const INVESTORS = [{ thirdPartyId: 'owner-self', role: 'INVESTOR', sharePct: 100 }];

test('calculateChainGrossProfit: suma eslabones; negotiatedValue como costo de fromTradeIn', () => {
  const members = [
    { plate: 'AAA111', salePrice: 50_000_000, purchasePrice: 40_000_000, fromTradeIn: false, negotiatedValue: null, expenses: [] },
    { plate: 'BBB222', salePrice: 25_000_000, purchasePrice: null, fromTradeIn: true, negotiatedValue: 20_000_000,
      expenses: [{ amount: 1_000_000, deletedAt: null }] },
  ];
  const r = calculateChainGrossProfit(members);
  assert.equal(r.salePrice, 75_000_000);
  assert.equal(r.purchaseCost, 60_000_000);
  assert.equal(r.directExpenses, 1_000_000);
  assert.equal(r.grossProfit, 14_000_000);
  assert.deepEqual(r.plates, ['AAA111', 'BBB222']);
});

test('calculateChainGrossProfit: gastos con deletedAt no cuentan; sin miembros → ceros', () => {
  const r = calculateChainGrossProfit([
    { plate: 'X', salePrice: 10, purchasePrice: 5, fromTradeIn: false,
      expenses: [{ amount: 3, deletedAt: new Date() }] },
  ]);
  assert.equal(r.grossProfit, 5);
  const empty = calculateChainGrossProfit([]);
  assert.equal(empty.grossProfit, 0);
  assert.deepEqual(empty.plates, []);
});

test('calculateSaleDistribution: overrideGrossProfit reemplaza la base del vehículo', () => {
  // Vehículo de cierre: su propia venta daría 4M, pero el negocio da 14M.
  const vehicle = { salePrice: 25_000_000, purchasePrice: null, negotiatedValue: 20_000_000,
    fromTradeIn: true, expenses: [{ amount: 1_000_000, deletedAt: null }] };
  const dist = calculateSaleDistribution(vehicle, CFG, {
    sellers: SELLERS, investors: INVESTORS, overrideGrossProfit: 14_000_000,
  });
  assert.equal(dist.skip, false);
  assert.equal(dist.grossProfit, 14_000_000);
  assert.equal(dist.commissionPool, 1_400_000);
  assert.equal(dist.afterCommission, 12_600_000);
  assert.equal(dist.reinvestAmount, 3_780_000);
  assert.equal(dist.taxAmount, 1_260_000);
  assert.equal(dist.profitToDistribute, 7_560_000);
});

test('calculateSaleDistribution: overrideGrossProfit ignora el guard purchaseCost<=0 del vehículo', () => {
  // Cierre de un cruce sin purchasePrice propio: el guard individual no aplica.
  const vehicle = { salePrice: 25_000_000, purchasePrice: null, negotiatedValue: null,
    fromTradeIn: true, expenses: [] };
  const dist = calculateSaleDistribution(vehicle, CFG, {
    sellers: SELLERS, investors: INVESTORS, overrideGrossProfit: 5_000_000,
  });
  assert.equal(dist.skip, false);
  assert.equal(dist.commissionPool, 500_000);
});

test('calculateSaleDistribution: overrideGrossProfit <= 0 → skip', () => {
  const vehicle = { salePrice: 25_000_000, purchasePrice: 20_000_000, fromTradeIn: false, expenses: [] };
  const dist = calculateSaleDistribution(vehicle, CFG, {
    sellers: SELLERS, investors: INVESTORS, overrideGrossProfit: 0,
  });
  assert.equal(dist.skip, true);
  assert.equal(dist.commissionPool, 0);
});

test('calculateSaleDistribution: sin override, comportamiento intacto (regresión)', () => {
  const vehicle = { salePrice: 25_000_000, purchasePrice: 20_000_000, fromTradeIn: false,
    expenses: [{ amount: 1_000_000, deletedAt: null }] };
  const dist = calculateSaleDistribution(vehicle, CFG, { sellers: SELLERS, investors: INVESTORS });
  assert.equal(dist.grossProfit, 4_000_000);
  assert.equal(dist.commissionPool, 400_000);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test src/utils/__tests__/financial.chain.test.js`
Expected: FAIL — `calculateChainGrossProfit is not a function`.

- [ ] **Step 3: Implementar en `financial.js`**

Agregar antes de `calculateSaleDistribution`:

```js
/**
 * Ganancia directa agregada de una cadena de cruces (cierre de negocio).
 * Mismo criterio de costo que calculateSaleDistribution: negotiatedValue
 * para eslabones fromTradeIn, purchasePrice para el resto.
 */
function calculateChainGrossProfit(members) {
  const acc = { salePrice: 0, purchaseCost: 0, directExpenses: 0, plates: [] };
  for (const m of members || []) {
    const expenses = (m.expenses || [])
      .filter((e) => !e.deletedAt)
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const cost = m.fromTradeIn
      ? Number(m.negotiatedValue || m.purchasePrice || 0)
      : Number(m.purchasePrice || 0);
    acc.salePrice += Number(m.salePrice || 0);
    acc.purchaseCost += cost;
    acc.directExpenses += expenses;
    acc.plates.push(m.plate);
  }
  return { ...acc, grossProfit: acc.salePrice - acc.purchaseCost - acc.directExpenses };
}
```

En `calculateSaleDistribution`, cambiar la firma y la base:

```js
function calculateSaleDistribution(vehicle, cfg, { sellers = [], investors = [], socio = null, overrideGrossProfit = null } = {}) {
```

y reemplazar el cálculo de `grossProfit` y los guards:

```js
  const grossProfit = overrideGrossProfit != null
    ? Number(overrideGrossProfit)
    : salePrice - purchaseCost - directExpenses;
```

```js
  // Sin base de costo (vehículo vendido sin precio de compra registrado, o
  // cruce sin valor negociado), no hay forma de calcular ganancia real:
  // evitamos tratar el salePrice completo como ganancia. Con override (cierre
  // de negocio), la validación de base de costo la hace el caller sobre la cadena.
  if (overrideGrossProfit == null && purchaseCost <= 0) return empty;
  if (grossProfit <= 0) return empty;
```

Agregar `calculateChainGrossProfit` al `module.exports`.

- [ ] **Step 4: Correr y verificar que pasan (incluye regresión)**

Run: `cd backend && node --test src/utils/__tests__/financial.chain.test.js && node --test src/utils/__tests__/financial.test.js`
Expected: PASS todos.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/financial.js backend/src/utils/__tests__/financial.chain.test.js
git commit -m "feat(financial): calculateChainGrossProfit + overrideGrossProfit en la cascada"
```

---

### Task 2: `utils/dealChain.js` — loader de cadena compartido (prismaOrTx)

**Files:**
- Create: `backend/src/utils/dealChain.js`
- Modify: `backend/src/services/vehicleService.js` (líneas ~105-157: `DEAL_CHAIN_SELECT`, `toChainNode`, `loadDealChainNodes`, `chainMembersFor`; y `enrichWithDealMetrics` ~161-176)
- Test: `backend/src/utils/__tests__/dealChain.test.js` (nuevo)

**Interfaces:**
- Consumes: nada de tasks previas.
- Produces: `loadChainMembers(prismaOrTx, vehicleId) → Promise<node[]>` en orden de linaje (raíz primero); nodos `{ id, plate, stage, salePrice, purchasePrice, negotiatedValue, fromTradeIn, saleDate, sourceVehicleId, partnerId, participation, partnerContribution, expenses, tradeInIds }`. También exporta `DEAL_CHAIN_SELECT`, `toChainNode`, `loadDealChainNodes(prismaOrTx, vehicles)`, `chainMembersFor(rootId, known)`, `rootIdFor(id, known)`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
'use strict';
// Tests — loader de cadena de cruces con prisma inyectable.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadChainMembers } = require('../dealChain');

// Nodos "de DB": A (raíz, con socio) → B (cruce de A) → C (cruce de B).
const DB = {
  'veh-a': { id: 'veh-a', plate: 'AAA111', stage: 'VENDIDO', salePrice: 50, purchasePrice: 40,
    negotiatedValue: null, fromTradeIn: false, saleDate: new Date('2026-07-01'), sourceVehicleId: null,
    partnerId: 'socio-cap', participation: 0, partnerContribution: 40,
    expenses: [], tradeInsReceived: [{ id: 'veh-b' }] },
  'veh-b': { id: 'veh-b', plate: 'BBB222', stage: 'VENDIDO', salePrice: 25, purchasePrice: null,
    negotiatedValue: 20, fromTradeIn: true, saleDate: new Date('2026-07-10'), sourceVehicleId: 'veh-a',
    partnerId: null, participation: 1, partnerContribution: null,
    expenses: [{ amount: 1, deletedAt: null }], tradeInsReceived: [{ id: 'veh-c' }] },
  'veh-c': { id: 'veh-c', plate: 'CCC333', stage: 'DISPONIBLE', salePrice: null, purchasePrice: null,
    negotiatedValue: 8, fromTradeIn: true, saleDate: null, sourceVehicleId: 'veh-b',
    partnerId: null, participation: 1, partnerContribution: null,
    expenses: [], tradeInsReceived: [] },
};

const fakePrisma = {
  vehicle: {
    findMany: async ({ where }) => {
      const ids = where.id?.in ?? [where.id];
      return ids.map((id) => DB[id]).filter(Boolean);
    },
  },
};

test('loadChainMembers: desde el último eslabón devuelve la cadena completa raíz-primero', async () => {
  const members = await loadChainMembers(fakePrisma, 'veh-c');
  assert.deepEqual(members.map((m) => m.id), ['veh-a', 'veh-b', 'veh-c']);
  // Campos de socio y cruce presentes en los nodos.
  assert.equal(members[0].partnerId, 'socio-cap');
  assert.equal(members[0].partnerContribution, 40);
  assert.equal(members[1].fromTradeIn, true);
  assert.equal(members[1].negotiatedValue, 20);
  assert.deepEqual(members[0].tradeInIds, ['veh-b']);
});

test('loadChainMembers: desde un eslabón intermedio devuelve la misma cadena', async () => {
  const members = await loadChainMembers(fakePrisma, 'veh-b');
  assert.deepEqual(members.map((m) => m.id), ['veh-a', 'veh-b', 'veh-c']);
});

test('loadChainMembers: id inexistente → []', async () => {
  assert.deepEqual(await loadChainMembers(fakePrisma, 'nope'), []);
});

test('loadChainMembers: referencia rota (sourceVehicleId borrado) no revienta', async () => {
  const broken = {
    vehicle: {
      findMany: async ({ where }) => {
        const ids = where.id?.in ?? [where.id];
        // 'veh-x' apunta a un source que ya no existe.
        const rows = { 'veh-x': { id: 'veh-x', plate: 'XXX000', stage: 'VENDIDO', salePrice: 10,
          purchasePrice: 5, negotiatedValue: null, fromTradeIn: true, saleDate: null,
          sourceVehicleId: 'gone', partnerId: null, participation: 1, partnerContribution: null,
          expenses: [], tradeInsReceived: [] } };
        return ids.map((id) => rows[id]).filter(Boolean);
      },
    },
  };
  const members = await loadChainMembers(broken, 'veh-x');
  assert.deepEqual(members.map((m) => m.id), ['veh-x']);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test src/utils/__tests__/dealChain.test.js`
Expected: FAIL — `Cannot find module '../dealChain'`.

- [ ] **Step 3: Crear `backend/src/utils/dealChain.js`**

Mover la lógica de `vehicleService.js` (líneas ~105-157) parametrizando prisma, y extender el select con los campos de socio/cruce:

```js
// ═══════════════════════════════════════════════════════════════
// Deal chain — carga y recorrido de cadenas de cruces.
// Compartido entre vehicleService (métricas de vitrina del pipeline)
// y saleService/commissionService (cierre del negocio con cruce).
// Todas las funciones aceptan prisma o un tx de $transaction.
// ═══════════════════════════════════════════════════════════════

const MAX_CHAIN_DEPTH = 10;

// Selección mínima para calcular ganancia directa de un eslabón + resolver
// el socio de la cadena al cierre (partnerId/participation/partnerContribution).
const DEAL_CHAIN_SELECT = {
  id: true, plate: true, stage: true, salePrice: true, purchasePrice: true,
  negotiatedValue: true, fromTradeIn: true, saleDate: true, sourceVehicleId: true,
  partnerId: true, participation: true, partnerContribution: true,
  expenses: { select: { amount: true, deletedAt: true } },
  tradeInsReceived: { select: { id: true } },
};

function toChainNode(v) {
  return {
    id: v.id, plate: v.plate, stage: v.stage,
    salePrice: v.salePrice, purchasePrice: v.purchasePrice,
    negotiatedValue: v.negotiatedValue ?? null, fromTradeIn: v.fromTradeIn ?? false,
    saleDate: v.saleDate, sourceVehicleId: v.sourceVehicleId,
    partnerId: v.partnerId ?? null,
    participation: v.participation ?? null,
    partnerContribution: v.partnerContribution ?? null,
    expenses: (v.expenses || []).map((e) => ({ amount: e.amount, deletedAt: e.deletedAt })),
    tradeInIds: (v.tradeInsReceived || []).map((t) => t.id),
  };
}

// Cierra transitivamente el grafo de cruces: sube por sourceVehicleId y baja
// por tradeInsReceived, trayendo de la DB los eslabones que no vinieron en la
// lista original. Cap defensivo de profundidad MAX_CHAIN_DEPTH.
async function loadDealChainNodes(prismaOrTx, vehicles) {
  const known = new Map(vehicles.map((v) => [v.id, toChainNode(v)]));
  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    const missing = new Set();
    for (const node of known.values()) {
      if (node.sourceVehicleId && !known.has(node.sourceVehicleId)) missing.add(node.sourceVehicleId);
      for (const tid of node.tradeInIds) if (!known.has(tid)) missing.add(tid);
    }
    if (missing.size === 0) break;
    const rows = await prismaOrTx.vehicle.findMany({
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

// Sube por sourceVehicleId hasta la raíz conocida de la cadena.
function rootIdFor(id, known) {
  let cur = known.get(id);
  let guard = 0;
  while (cur && cur.sourceVehicleId && known.has(cur.sourceVehicleId) && guard++ < MAX_CHAIN_DEPTH) {
    cur = known.get(cur.sourceVehicleId);
  }
  return cur ? cur.id : id;
}

// Cadena completa (orden de linaje) a partir de cualquier eslabón.
async function loadChainMembers(prismaOrTx, vehicleId) {
  const rows = await prismaOrTx.vehicle.findMany({
    where: { id: vehicleId },
    select: DEAL_CHAIN_SELECT,
  });
  if (rows.length === 0) return [];
  const known = await loadDealChainNodes(prismaOrTx, rows);
  return chainMembersFor(rootIdFor(vehicleId, known), known);
}

module.exports = {
  DEAL_CHAIN_SELECT, toChainNode, loadDealChainNodes,
  chainMembersFor, rootIdFor, loadChainMembers,
};
```

- [ ] **Step 4: Adoptarlo en `vehicleService.js`**

1. Agregar al require block: `const { loadDealChainNodes, chainMembersFor, rootIdFor } = require('../utils/dealChain');`
2. Borrar de `vehicleService.js` las definiciones locales: `DEAL_CHAIN_SELECT`, `toChainNode`, `loadDealChainNodes`, `chainMembersFor` (líneas ~105-157).
3. En `enrichWithDealMetrics`: cambiar `const known = await loadDealChainNodes(vehicles);` por `const known = await loadDealChainNodes(prisma, vehicles);` y reemplazar la función inline `rootOf` por `const rootOf = (id) => rootIdFor(id, known);` (borrando su cuerpo actual).

- [ ] **Step 5: Correr tests + verificar que el backend levanta**

Run: `cd backend && node --test src/utils/__tests__/dealChain.test.js && npm test`
Expected: PASS todos (la suite completa confirma que vehicleService sigue cargando).

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/dealChain.js backend/src/utils/__tests__/dealChain.test.js backend/src/services/vehicleService.js
git commit -m "refactor: extrae loader de cadena de cruces a utils/dealChain (prisma inyectable)"
```

---

### Task 3: `commissionService` — `findDistributedVehicleIds` + `resolveChainSocio`

**Files:**
- Modify: `backend/src/services/commissionService.js` (agregar tras `resolveSocio`, línea ~268; exportar)
- Test: `backend/src/services/__tests__/commissionService.chain.test.js` (nuevo)

**Interfaces:**
- Consumes: `resolveSocio(prismaOrTx, vehicle, cfg)` (existente, mismo archivo).
- Produces: `findDistributedVehicleIds(prismaOrTx, vehicleIds) → Promise<Set<string>>`; `resolveChainSocio(prismaOrTx, members, cfg) → Promise<{ thirdPartyId, share, isInvestor, vehicle } | null>` (`vehicle` = el nodo de cadena con `partnerId`); constante `DISTRIBUTION_PAYABLE_TYPES`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
'use strict';
// Tests — helpers de cadena para el cierre del negocio con cruce.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  findDistributedVehicleIds, resolveChainSocio, DISTRIBUTION_PAYABLE_TYPES,
} = require('../commissionService');

const CFG = { investorTeam: [{ thirdPartyId: 'socio-cap', sharePct: 100 }] };

function mkTx({ payableRows = [], thirdParties = ['socio-cap', 'owner-self', 'ext-socio'] } = {}) {
  const has = new Set(thirdParties);
  return {
    payable: { findMany: async () => payableRows },
    thirdParty: {
      findMany: async ({ where }) => where.id.in.filter((id) => has.has(id)).map((id) => ({ id })),
      findUnique: async ({ where }) => (has.has(where.id) ? { id: where.id } : null),
    },
  };
}

test('DISTRIBUTION_PAYABLE_TYPES: los 4 tipos, sin CAPITAL_RETURN', () => {
  assert.deepEqual(
    [...DISTRIBUTION_PAYABLE_TYPES].sort(),
    ['COMMISSION', 'COMMISSION_RETURN', 'PARTNER_SHARE', 'PROFIT_SHARE'],
  );
});

test('findDistributedVehicleIds: agrupa vehicleIds con payables de distribución', async () => {
  const tx = mkTx({ payableRows: [{ vehicleId: 'veh-a' }, { vehicleId: 'veh-a' }] });
  const set = await findDistributedVehicleIds(tx, ['veh-a', 'veh-b']);
  assert.equal(set.has('veh-a'), true);
  assert.equal(set.has('veh-b'), false);
});

test('findDistributedVehicleIds: lista vacía → Set vacío sin query', async () => {
  const tx = { payable: { findMany: async () => { throw new Error('no debe consultar'); } } };
  const set = await findDistributedVehicleIds(tx, []);
  assert.equal(set.size, 0);
});

test('resolveChainSocio: toma el primer eslabón con partnerId (socio inversionista 100%)', async () => {
  const members = [
    { id: 'veh-a', partnerId: 'socio-cap', participation: 0, partnerContribution: 40_000_000 },
    { id: 'veh-b', partnerId: null, participation: 1 },
  ];
  const socio = await resolveChainSocio(mkTx(), members, CFG);
  assert.equal(socio.thirdPartyId, 'socio-cap');
  assert.equal(socio.isInvestor, true);
  assert.equal(socio.share, 1);
  assert.equal(socio.vehicle.id, 'veh-a');
});

test('resolveChainSocio: sin partnerId en la cadena → null', async () => {
  const members = [{ id: 'veh-b', partnerId: null, participation: 1 }];
  assert.equal(await resolveChainSocio(mkTx(), members, CFG), null);
});

test('resolveChainSocio: socio externo parcial NO lidera cadena → null', async () => {
  const members = [{ id: 'veh-a', partnerId: 'ext-socio', participation: 0.6 }];
  assert.equal(await resolveChainSocio(mkTx(), members, CFG), null);
});

test('resolveChainSocio: invariante rota post-venta (AppError de resolveSocio) → null, no revienta', async () => {
  // 'ext-socio' con participation 0 → share 1 pero NO es inversionista → resolveSocio lanza AppError.
  const members = [{ id: 'veh-a', partnerId: 'ext-socio', participation: 0 }];
  assert.equal(await resolveChainSocio(mkTx(), members, CFG), null);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test src/services/__tests__/commissionService.chain.test.js`
Expected: FAIL — `findDistributedVehicleIds is not a function`.

- [ ] **Step 3: Implementar en `commissionService.js`**

Después de `resolveSocio` (línea ~268):

```js
// Tipos de CxP que marcan que un vehículo YA distribuyó su venta (comisión/
// ganancia). CAPITAL_RETURN queda fuera: el parcial del socio en una venta
// diferida por cruce no cuenta como distribución.
const DISTRIBUTION_PAYABLE_TYPES = ['COMMISSION', 'PROFIT_SHARE', 'PARTNER_SHARE', 'COMMISSION_RETURN'];

/**
 * IDs de vehículos (del subset dado) que ya tienen distribución propia.
 * Se usa al cerrar un negocio con cruce para excluir eslabones que vendieron
 * con el flujo inmediato (pre-feature o socio externo parcial).
 */
async function findDistributedVehicleIds(prismaOrTx, vehicleIds) {
  if (!Array.isArray(vehicleIds) || vehicleIds.length === 0) return new Set();
  const rows = await prismaOrTx.payable.findMany({
    where: { vehicleId: { in: vehicleIds }, type: { in: DISTRIBUTION_PAYABLE_TYPES } },
    select: { vehicleId: true },
  });
  return new Set(rows.map((r) => r.vehicleId));
}

/**
 * Socio de una cadena de cruces al cierre: el primer eslabón (orden de linaje)
 * con partnerId, resuelto con resolveSocio. Solo un socio INVERSIONISTA 100%
 * lidera la cadena; externo parcial (o invariantes rotas porque el equipo de
 * inversionistas cambió después de la venta) → null (cascada de fondo).
 * Devuelve el socio con `vehicle` = nodo de cadena dueño del partnerId.
 */
async function resolveChainSocio(prismaOrTx, members, cfg) {
  const withPartner = (members || []).find((m) => m.partnerId);
  if (!withPartner) return null;
  try {
    const socio = await resolveSocio(prismaOrTx, withPartner, cfg);
    if (!socio || !socio.isInvestor) return null;
    return { ...socio, vehicle: withPartner };
  } catch (err) {
    if (err instanceof AppError) return null;
    throw err;
  }
}
```

Agregar a `module.exports`: `findDistributedVehicleIds, resolveChainSocio, DISTRIBUTION_PAYABLE_TYPES`.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd backend && node --test src/services/__tests__/commissionService.chain.test.js && node --test src/services/__tests__/commissionService.test.js`
Expected: PASS todos.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/commissionService.js backend/src/services/__tests__/commissionService.chain.test.js
git commit -m "feat(commission): helpers de cadena — distribución previa y socio de cadena"
```

---

### Task 4: `saleService.registerSale` — rama de DIFERIMIENTO por cruce

**Files:**
- Modify: `backend/src/services/saleService.js` (Paso 5, líneas ~214-235)
- Test: `backend/src/services/__tests__/saleService.cruce.test.js` (nuevo)

**Interfaces:**
- Consumes: `commissionService.loadCommissionConfig/resolveSocio` (existentes).
- Produces: `summary.deferred: true`, `summary.reason: 'trade_in'`, `summary.deferredToPlate: <placa cruce>` cuando la venta difiere. La venta diferida NO crea COMMISSION/COMMISSION_RETURN/PROFIT_SHARE/PARTNER_SHARE ni transfers; solo `CAPITAL_RETURN` parcial (socio inversionista) = `min(efectivo cobrado, partnerContribution)`.

- [ ] **Step 1: Crear el test file con harness + tests de diferimiento (fallan)**

El harness replica el patrón de `saleService.dist.test.js` (fake prisma por require cache), ampliado con `payable.findMany/aggregate` y nodos de cadena servidos por `vehicle.findMany` (los usará también la Task 5, que agrega tests a ESTE archivo).

```js
'use strict';
// ═══════════════════════════════════════════════════════════════
// Integration tests — registerSale con cruce (diferimiento) y cierre
// de negocio (Task 5). Fake prisma por require cache, patrón de
// saleService.dist.test.js.
// ═══════════════════════════════════════════════════════════════
const { test } = require('node:test');
const assert = require('node:assert/strict');

let ctx; // { vehicle, chainNodes, priorPayables, tx, created } — por test
const fakePrisma = {
  vehicle: { findUnique: async () => ctx.vehicle },
  $transaction: async (fn) => fn(ctx.tx),
};
const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const saleService = require('../saleService');

const SETTINGS = [
  { key: 'commission_share_pct', value: '60' },
  { key: 'reinvest_share_pct', value: '30' },
  { key: 'tax_share_pct', value: '10' },
  { key: 'default_captador_pct', value: '30' },
  { key: 'default_cerrador_pct', value: '70' },
  { key: 'reinvest_account_id', value: 'budget-reinvest' },
  { key: 'tax_reserve_account_id', value: 'budget-tax' },
  { key: 'commission_gross_pct', value: '10' },
  { key: 'reinvest_pct', value: '30' },
  { key: 'tax_pct', value: '10' },
  { key: 'investor_team', value: JSON.stringify([
    { thirdPartyId: 'owner-self', role: 'INVESTOR', sharePct: 50 },
    { thirdPartyId: 'mama', role: 'INVESTOR', sharePct: 25 },
    { thirdPartyId: 'papa', role: 'INVESTOR', sharePct: 25 },
    { thirdPartyId: 'socio-cap', role: 'INVESTOR', sharePct: 0.0001 }, // pertenece al equipo → isInvestor
  ]) },
];
// Nota: resolveInvestors exige suma 100 SOLO cuando reparte PROFIT_SHARE; para
// que el equipo valga, usar en los tests de fondo un team que sume 100:
const FUND_SETTINGS = SETTINGS.map((s) => s.key === 'investor_team'
  ? { ...s, value: JSON.stringify([
      { thirdPartyId: 'owner-self', role: 'INVESTOR', sharePct: 50 },
      { thirdPartyId: 'mama', role: 'INVESTOR', sharePct: 25 },
      { thirdPartyId: 'papa', role: 'INVESTOR', sharePct: 25 },
    ]) }
  : s);
// Team con socio-cap como inversionista y suma 100 (socio 100% no reparte PROFIT_SHARE):
const SOCIO_SETTINGS = SETTINGS.map((s) => s.key === 'investor_team'
  ? { ...s, value: JSON.stringify([
      { thirdPartyId: 'owner-self', role: 'INVESTOR', sharePct: 50 },
      { thirdPartyId: 'socio-cap', role: 'INVESTOR', sharePct: 50 },
    ]) }
  : s);

const EXISTING_TP = ['hermano', 'owner-self', 'mama', 'papa', 'buyer-1', 'socio-cap', 'ext-socio'];

function makeCtx({ vehicle, chainNodes = [], priorPayables = [], settings = FUND_SETTINGS, existing = EXISTING_TP }) {
  const created = {
    payablesByType: {},
    saleParticipants: [],
    transfers: [],
    transactions: [],
    payablePayments: [],
  };
  let idn = 0;
  const nid = (p) => `${p}-${++idn}`;
  const has = new Set(existing);
  const nodesById = new Map(chainNodes.map((n) => [n.id, n]));
  const tx = {
    vehicle: {
      update: async ({ data }) => ({ ...vehicle, ...data }),
      create: async ({ data }) => ({ id: nid('veh'), ...data }),
      findMany: async ({ where }) => {
        const ids = where.id?.in ?? [where.id];
        return ids.map((id) => nodesById.get(id)).filter(Boolean);
      },
    },
    transaction: {
      create: async ({ data }) => { const r = { id: nid('txn'), ...data }; created.transactions.push(r); return r; },
    },
    payable: {
      create: async ({ data }) => {
        const r = { id: nid('pay'), ...data };
        (created.payablesByType[data.type] || (created.payablesByType[data.type] = [])).push(r);
        return r;
      },
      findMany: async ({ where }) => priorPayables.filter((p) =>
        (where.vehicleId?.in ?? [where.vehicleId]).includes(p.vehicleId)
        && (!where.type || where.type.in.includes(p.type))),
      aggregate: async ({ where }) => {
        const sum = priorPayables
          .filter((p) => (where.vehicleId?.in ?? [where.vehicleId]).includes(p.vehicleId)
            && p.type === where.type
            && (!where.thirdPartyId || p.thirdPartyId === where.thirdPartyId))
          .reduce((s, p) => s + Number(p.totalAmount), 0);
        return { _sum: { totalAmount: sum } };
      },
    },
    payablePayment: {
      create: async ({ data }) => { created.payablePayments.push(data); return data; },
    },
    saleParticipant: {
      create: async ({ data }) => { const r = { id: nid('sp'), ...data }; created.saleParticipants.push(r); return r; },
    },
    transfer: {
      create: async ({ data }) => { const r = { id: nid('tr'), ...data }; created.transfers.push(r); return r; },
    },
    setting: { findMany: async () => settings },
    thirdParty: {
      findMany: async ({ where }) => where.id.in.filter((id) => has.has(id)).map((id) => ({ id })),
      findUnique: async ({ where }) => (has.has(where.id) ? { id: where.id } : null),
      update: async ({ data }) => data,
    },
  };
  return { vehicle, chainNodes, priorPayables, tx, created };
}

const count = (created, type) => (created.payablesByType[type] || []).length;

// ── Vehículo base del fondo (sin socio) ─────────────────────────
const FUND_VEHICLE = {
  id: 'veh-a', plate: 'AAA111', stage: 'DISPONIBLE', userId: 'user-1',
  purchasePrice: 40_000_000, negotiatedValue: null, fromTradeIn: false,
  participation: 1, partnerId: null, partnerContribution: null, expenses: [],
};
// Socio inversionista 100%: partnerId en investor_team, participation 0.
const SOCIO_VEHICLE = {
  ...FUND_VEHICLE, partnerId: 'socio-cap', participation: 0, partnerContribution: 40_000_000,
};

const TRADE_IN = { plate: 'BBB222', value: 20_000_000 };

test('cruce sin socio: NO crea distribución (ni COMMISSION ni PROFIT_SHARE ni transfers); summary.deferred', async () => {
  ctx = makeCtx({ vehicle: FUND_VEHICLE });
  const res = await saleService.registerSale('veh-a', {
    salePrice: 50_000_000, paymentType: 'MIXED', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 30_000_000 },
    tradeIn: TRADE_IN,
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'user-1');

  assert.equal(count(ctx.created, 'COMMISSION'), 0);
  assert.equal(count(ctx.created, 'PROFIT_SHARE'), 0);
  assert.equal(count(ctx.created, 'PARTNER_SHARE'), 0);
  assert.equal(count(ctx.created, 'COMMISSION_RETURN'), 0);
  assert.equal(count(ctx.created, 'CAPITAL_RETURN'), 0);
  assert.equal(ctx.created.transfers.length, 0);
  assert.equal(res.summary.deferred, true);
  assert.equal(res.summary.reason, 'trade_in');
  assert.equal(res.summary.deferredToPlate, 'BBB222');
  assert.ok(res.newVehicle); // el cruce sí se crea
});

test('cruce + socio inversionista 100%: solo CAPITAL_RETURN parcial = min(efectivo, capital)', async () => {
  ctx = makeCtx({ vehicle: SOCIO_VEHICLE, settings: SOCIO_SETTINGS });
  const res = await saleService.registerSale('veh-a', {
    salePrice: 50_000_000, paymentType: 'MIXED', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 30_000_000 },
    tradeIn: TRADE_IN,
  }, 'user-1');

  const caps = ctx.created.payablesByType.CAPITAL_RETURN || [];
  assert.equal(caps.length, 1);
  assert.equal(caps[0].totalAmount, 30_000_000); // min(30M efectivo, 40M capital)
  assert.equal(caps[0].thirdPartyId, 'socio-cap');
  assert.equal(count(ctx.created, 'COMMISSION'), 0);
  assert.equal(count(ctx.created, 'COMMISSION_RETURN'), 0);
  assert.equal(count(ctx.created, 'PARTNER_SHARE'), 0);
  assert.equal(res.summary.deferred, true);
});

test('cruce 100% carro (efectivo 0) + socio inversionista: sin CAPITAL_RETURN', async () => {
  ctx = makeCtx({ vehicle: SOCIO_VEHICLE, settings: SOCIO_SETTINGS });
  await saleService.registerSale('veh-a', {
    salePrice: 50_000_000, paymentType: 'TRADE_IN', buyerId: 'buyer-1',
    tradeIn: { plate: 'BBB222', value: 50_000_000 },
  }, 'user-1');
  assert.equal(count(ctx.created, 'CAPITAL_RETURN'), 0);
});

test('cruce + socio EXTERNO parcial: flujo inmediato intacto (COMMISSION + PARTNER_SHARE + CxC)', async () => {
  const extVehicle = { ...FUND_VEHICLE, partnerId: 'ext-socio', participation: 0.6, partnerContribution: null };
  ctx = makeCtx({ vehicle: extVehicle });
  const res = await saleService.registerSale('veh-a', {
    salePrice: 50_000_000, paymentType: 'MIXED', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 30_000_000 },
    tradeIn: TRADE_IN,
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'user-1');

  // gross 10M → pool 1M; socio externo 40%: PARTNER_SHARE 4M, CxC comisión 400k.
  assert.equal(count(ctx.created, 'COMMISSION'), 1);
  assert.equal((ctx.created.payablesByType.PARTNER_SHARE || [])[0].totalAmount, 4_000_000);
  const socioRec = (ctx.created.payablesByType.RECEIVABLE || []).find((p) => /Comisión socio/.test(p.description));
  assert.ok(socioRec);
  assert.equal(res.summary.deferred, undefined);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test src/services/__tests__/saleService.cruce.test.js`
Expected: FAIL — los 3 primeros tests (hoy la venta con cruce SÍ distribuye); el 4º (externo) puede pasar ya.

- [ ] **Step 3: Implementar la rama de diferimiento en `saleService.js`**

Reemplazar el bloque del Paso 5 (desde `let distributionSummary = null;` hasta `const dist = calculateSaleDistribution(...)` inclusive, líneas ~221-233) por:

```js
    let distributionSummary = null;
    const cfg = await commissionService.loadCommissionConfig(tx);
    const socioVenta = await commissionService.resolveSocio(tx, vehicle, cfg);
    const hasTradeIn = !!(tradeIn?.plate && tradeIn?.value > 0);
    // Diferimiento por cruce (spec 2026-07-24-comision-unica-negocio-cruce):
    // la venta que recibe carro en parte de pago NO distribuye nada; el negocio
    // se liquida al vender el carro recibido. El socio externo parcial conserva
    // el flujo inmediato (su participación es por vehículo, no por negocio).
    const deferDistribution = hasTradeIn && (!socioVenta || socioVenta.isInvestor);

    if (deferDistribution) {
      // Socio inversionista 100%: se le adeuda ya la parte en efectivo cobrada,
      // con tope en su capital; el resto (valor del cruce + ganancia) al cierre.
      const cashReceivedNow = totalReceived - parseFloat(tradeIn.value);
      const partnerCapital = Number(vehicle.partnerContribution || 0);
      const partialCapital = Math.min(cashReceivedNow, partnerCapital);
      if (socioVenta && partialCapital > 0) {
        await tx.payable.create({
          data: {
            type: 'CAPITAL_RETURN',
            status: 'PENDING',
            totalAmount: partialCapital,
            paidAmount: 0,
            description: `Devolución de capital socio ${vehicle.plate}`,
            vehicleId,
            thirdPartyId: socioVenta.thirdPartyId,
            createdBy: userId,
          },
        });
      }
      distributionSummary = { deferred: true, reason: 'trade_in', deferredToPlate: tradeIn.plate };
    } else {
      const vehicleForBase = {
        salePrice: salePriceNum,
        purchasePrice: vehicle.purchasePrice,
        negotiatedValue: vehicle.negotiatedValue,
        fromTradeIn: vehicle.fromTradeIn,
        expenses: vehicle.expenses,
      };
      const sellers = await commissionService.resolveSellers(tx, saleData.participants, cfg);
      const investors = await commissionService.resolveInvestors(tx, cfg);
      const socio = socioVenta;
      const dist = calculateSaleDistribution(vehicleForBase, cfg.distributionCfg, { sellers, investors, socio });
      // ... (bloque `if (!dist.skip) { ... }` existente, SIN cambios en este task,
      //      queda dentro de este else)
    }
```

Nota mecánica: el bloque `if (!dist.skip) { ... }` completo (5a, 5a-bis, 5b) y la asignación de `distributionSummary` se mueven dentro del `else` sin cambios de contenido. `return`/`summary` quedan fuera, como están.

- [ ] **Step 4: Correr y verificar**

Run: `cd backend && node --test src/services/__tests__/saleService.cruce.test.js && node --test src/services/__tests__/saleService.dist.test.js && node --test src/services/__tests__/saleService.cancel.test.js`
Expected: PASS todos (dist/cancel sin tocar).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/saleService.js backend/src/services/__tests__/saleService.cruce.test.js
git commit -m "feat(sale): venta con cruce difiere la distribución al cierre del negocio"
```

---

### Task 5: `saleService.registerSale` — rama de CIERRE de cadena

**Files:**
- Modify: `backend/src/services/saleService.js` (el `else` creado en Task 4; requires del archivo)
- Test: `backend/src/services/__tests__/saleService.cruce.test.js` (agregar tests al archivo de Task 4)

**Interfaces:**
- Consumes: `loadChainMembers` (Task 2), `calculateChainGrossProfit`/`overrideGrossProfit` (Task 1), `findDistributedVehicleIds`/`resolveChainSocio` (Task 3).
- Produces: al vender un vehículo `fromTradeIn` sin nuevo cruce, la cascada corre con la ganancia agregada de los eslabones elegibles; `summary.chain = { plates, grossProfit }`; `CAPITAL_RETURN` remanente del socio = `partnerContribution − Σ CAPITAL_RETURN previos de la cadena` (se crea aunque `dist.skip`).

- [ ] **Step 1: Agregar los tests de cierre al archivo de Task 4 (fallan)**

```js
// ── Cierre de cadena (Task 5) ───────────────────────────────────
// B (fromTradeIn de A) se vende sin nuevo cruce → liquida el negocio.
const NODE_A_SOCIO = {
  id: 'veh-a', plate: 'AAA111', stage: 'VENDIDO', salePrice: 50_000_000,
  purchasePrice: 40_000_000, negotiatedValue: null, fromTradeIn: false,
  saleDate: new Date('2026-07-01'), sourceVehicleId: null,
  partnerId: 'socio-cap', participation: 0, partnerContribution: 40_000_000,
  expenses: [], tradeInIds: [], tradeInsReceived: [{ id: 'veh-b' }],
};
const NODE_A_FUND = { ...NODE_A_SOCIO, partnerId: null, participation: 1, partnerContribution: null };
// Nodo de B "en DB dentro de la tx": ya VENDIDO con salePrice (el update del
// paso 1 de registerSale es visible dentro de la misma transacción).
const NODE_B = (salePrice) => ({
  id: 'veh-b', plate: 'BBB222', stage: 'VENDIDO', salePrice,
  purchasePrice: null, negotiatedValue: 20_000_000, fromTradeIn: true,
  saleDate: new Date('2026-07-20'), sourceVehicleId: 'veh-a',
  partnerId: null, participation: 1, partnerContribution: null,
  expenses: [{ amount: 1_000_000, deletedAt: null }], tradeInsReceived: [],
});
// Vehículo B tal como lo ve findUnique ANTES de la venta.
const VEHICLE_B = {
  id: 'veh-b', plate: 'BBB222', stage: 'DISPONIBLE', userId: 'user-1',
  purchasePrice: null, negotiatedValue: 20_000_000, fromTradeIn: true,
  sourceVehicleId: 'veh-a', participation: 1, partnerId: null, partnerContribution: null,
  expenses: [{ amount: 1_000_000, deletedAt: null }],
};

test('cierre con socio 100%: cascada sobre 14M; COMMISSION_RETURN + PARTNER_SHARE + CAPITAL_RETURN remanente', async () => {
  ctx = makeCtx({
    vehicle: VEHICLE_B,
    chainNodes: [NODE_A_SOCIO, NODE_B(25_000_000)],
    // Parcial de capital creado al vender A (rama defer).
    priorPayables: [{ vehicleId: 'veh-a', type: 'CAPITAL_RETURN', thirdPartyId: 'socio-cap', totalAmount: 30_000_000 }],
    settings: SOCIO_SETTINGS,
  });
  const res = await saleService.registerSale('veh-b', {
    salePrice: 25_000_000, paymentType: 'CASH', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 25_000_000 },
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'user-1');

  // Chain gross = (50−40−0) + (25−20−1) = 14M; pool 10% = 1.4M.
  const comm = ctx.created.payablesByType.COMMISSION || [];
  assert.equal(comm.length, 1);
  assert.equal(comm[0].totalAmount, 1_400_000);
  const commRet = ctx.created.payablesByType.COMMISSION_RETURN || [];
  assert.equal(commRet[0].totalAmount, 1_400_000);
  assert.equal(commRet[0].thirdPartyId, 'socio-cap');
  // afterCommission 12.6M − reinvest 3.78M − tax 1.26M = 7.56M al socio.
  const ps = ctx.created.payablesByType.PARTNER_SHARE || [];
  assert.equal(ps[0].totalAmount, 7_560_000);
  // Capital remanente: 40M − 30M ya adeudados = 10M.
  const caps = ctx.created.payablesByType.CAPITAL_RETURN || [];
  assert.equal(caps.length, 1);
  assert.equal(caps[0].totalAmount, 10_000_000);
  // Inversionista 100% → sin PROFIT_SHARE; reservas con cashRatio 1.
  assert.equal(count(ctx.created, 'PROFIT_SHARE'), 0);
  assert.equal(ctx.created.transfers.length, 2);
  assert.deepEqual(res.summary.chain, { plates: ['AAA111', 'BBB222'], grossProfit: 14_000_000 });
});

test('cierre compat: A ya distribuyó → base solo B (4M), cascada de fondo', async () => {
  ctx = makeCtx({
    vehicle: VEHICLE_B,
    chainNodes: [NODE_A_SOCIO, NODE_B(25_000_000)],
    priorPayables: [{ vehicleId: 'veh-a', type: 'COMMISSION', thirdPartyId: 'hermano', totalAmount: 1 }],
  });
  const res = await saleService.registerSale('veh-b', {
    salePrice: 25_000_000, paymentType: 'CASH', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 25_000_000 },
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'user-1');

  // Base 4M: pool 400k; after 3.6M; reinvest 1.08M; tax 360k; profit 2.16M (50/25/25).
  assert.equal((ctx.created.payablesByType.COMMISSION || [])[0].totalAmount, 400_000);
  const shares = (ctx.created.payablesByType.PROFIT_SHARE || []).map((p) => p.totalAmount).sort((a, b) => b - a);
  assert.deepEqual(shares, [1_080_000, 540_000, 540_000]);
  // A excluido → su socio NO lidera: sin PARTNER_SHARE ni COMMISSION_RETURN.
  assert.equal(count(ctx.created, 'PARTNER_SHARE'), 0);
  assert.equal(count(ctx.created, 'COMMISSION_RETURN'), 0);
  assert.deepEqual(res.summary.chain.plates, ['BBB222']);
});

test('cierre sin ganancia: skip de cascada pero CAPITAL_RETURN remanente sí se crea', async () => {
  // B se vende en 5M → chain = 10M + (5−20−1) = −6M.
  ctx = makeCtx({
    vehicle: VEHICLE_B,
    chainNodes: [NODE_A_SOCIO, NODE_B(5_000_000)],
    priorPayables: [{ vehicleId: 'veh-a', type: 'CAPITAL_RETURN', thirdPartyId: 'socio-cap', totalAmount: 30_000_000 }],
    settings: SOCIO_SETTINGS,
  });
  await saleService.registerSale('veh-b', {
    salePrice: 5_000_000, paymentType: 'CASH', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 5_000_000 },
  }, 'user-1');

  assert.equal(count(ctx.created, 'COMMISSION'), 0);
  assert.equal(count(ctx.created, 'COMMISSION_RETURN'), 0);
  assert.equal(count(ctx.created, 'PARTNER_SHARE'), 0);
  assert.equal(ctx.created.transfers.length, 0);
  const caps = ctx.created.payablesByType.CAPITAL_RETURN || [];
  assert.equal(caps.length, 1);
  assert.equal(caps[0].totalAmount, 10_000_000);
});

test('cierre sin socio en la cadena: cascada de fondo sobre 14M', async () => {
  ctx = makeCtx({ vehicle: VEHICLE_B, chainNodes: [NODE_A_FUND, NODE_B(25_000_000)] });
  await saleService.registerSale('veh-b', {
    salePrice: 25_000_000, paymentType: 'CASH', buyerId: 'buyer-1',
    cashPayment: { accountId: 'acc-1', amount: 25_000_000 },
    participants: [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }],
  }, 'user-1');

  assert.equal((ctx.created.payablesByType.COMMISSION || [])[0].totalAmount, 1_400_000);
  // after 12.6M − 3.78M − 1.26M = 7.56M repartidos 50/25/25.
  const shares = (ctx.created.payablesByType.PROFIT_SHARE || []).map((p) => p.totalAmount).sort((a, b) => b - a);
  assert.deepEqual(shares, [3_780_000, 1_890_000, 1_890_000]);
  assert.equal(count(ctx.created, 'PARTNER_SHARE'), 0);
  assert.equal(count(ctx.created, 'COMMISSION_RETURN'), 0);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test src/services/__tests__/saleService.cruce.test.js`
Expected: FAIL los 4 tests nuevos (hoy el cierre usa solo la base de B y no crea capital remanente).

- [ ] **Step 3: Implementar el cierre en `saleService.js`**

1. Requires del archivo (línea ~8):

```js
const { calculateSaleDistribution, calculateChainGrossProfit } = require('../utils/financial');
const { loadChainMembers } = require('../utils/dealChain');
```

2. Dentro del `else` de Task 4, reemplazar las líneas `const socio = socioVenta;` y `const dist = calculateSaleDistribution(...)` por:

```js
      // Cierre de negocio: vehículo recibido en cruce que se vende SIN nuevo
      // cruce. La cascada corre UNA vez sobre la ganancia agregada de los
      // eslabones sin distribución previa; el socio se resuelve desde la cadena.
      const isClosure = vehicle.fromTradeIn === true && !hasTradeIn;
      let socio = socioVenta;
      let chainInfo = null;
      let socioCapitalToReturn = Number(vehicle.partnerContribution || 0);
      let dist;

      if (isClosure) {
        const members = await loadChainMembers(tx, vehicleId);
        const otherIds = members.filter((m) => m.id !== vehicleId).map((m) => m.id);
        const distributed = await commissionService.findDistributedVehicleIds(tx, otherIds);
        const eligible = members.filter(
          (m) => m.id === vehicleId || (m.stage === 'VENDIDO' && !distributed.has(m.id)),
        );
        const chain = calculateChainGrossProfit(eligible);
        socio = await commissionService.resolveChainSocio(tx, eligible, cfg);
        chainInfo = { plates: chain.plates, grossProfit: chain.grossProfit };
        dist = calculateSaleDistribution(vehicleForBase, cfg.distributionCfg, {
          sellers, investors, socio,
          // Sin base de costo en la cadena no hay ganancia calculable → skip.
          overrideGrossProfit: chain.purchaseCost > 0 ? chain.grossProfit : 0,
        });
        if (socio) {
          const prior = await tx.payable.aggregate({
            _sum: { totalAmount: true },
            where: {
              vehicleId: { in: members.map((m) => m.id) },
              type: 'CAPITAL_RETURN',
              thirdPartyId: socio.thirdPartyId,
            },
          });
          socioCapitalToReturn =
            Number(socio.vehicle.partnerContribution || 0) - Number(prior._sum.totalAmount || 0);
        }
      } else {
        dist = calculateSaleDistribution(vehicleForBase, cfg.distributionCfg, { sellers, investors, socio });
      }
```

3. En el bloque `if (!dist.skip) { ... }` existente, **eliminar** el sub-bloque de devolución de capital:

```js
      const partnerCapital = Number(vehicle.partnerContribution || 0);
      if (socio && partnerCapital > 0) {
        await tx.payable.create({ ... CAPITAL_RETURN ... });
      }
```

y agregarlo DESPUÉS del cierre del `if (!dist.skip)` (aún dentro del `else`), generalizado:

```js
      // Devolución de capital al socio (Modelo B): en flujo normal solo con
      // utilidad (comportamiento histórico); en cierre de cadena siempre —
      // el capital del socio no depende de la ganancia del negocio.
      if (socio && socioCapitalToReturn > 0 && (isClosure || !dist.skip)) {
        await tx.payable.create({
          data: {
            type: 'CAPITAL_RETURN',
            status: 'PENDING',
            totalAmount: socioCapitalToReturn,
            paidAmount: 0,
            description: `Devolución de capital socio ${vehicle.plate}`,
            vehicleId,
            thirdPartyId: socio.thirdPartyId,
            createdBy: userId,
          },
        });
      }
      if (chainInfo) {
        if (distributionSummary) distributionSummary.chain = chainInfo;
        else distributionSummary = { chain: chainInfo, skipped: true };
      }
```

- [ ] **Step 4: Correr y verificar**

Run: `cd backend && node --test src/services/__tests__/saleService.cruce.test.js && node --test src/services/__tests__/saleService.dist.test.js && npm test`
Expected: PASS todos. Atención especial a `saleService.dist.test.js` (flujo normal intacto: el CAPITAL_RETURN normal sigue creándose solo con utilidad).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/saleService.js backend/src/services/__tests__/saleService.cruce.test.js
git commit -m "feat(sale): cierre de negocio con cruce — cascada única sobre la ganancia de la cadena"
```

---

### Task 6: Reporting — cascada del negocio en comisiones e inversionistas

**Files:**
- Modify: `backend/src/services/commissionService.js` (`buildCommissionVehicleItem` ~330, `buildInvestorVehicleItem` ~389, `listByVehicle` ~440)
- Modify: `backend/src/services/investorService.js` (`listByVehicle` ~41)
- Test: `backend/src/services/__tests__/commissionService.chain.test.js` (agregar tests de builders)

**Interfaces:**
- Consumes: `loadChainMembers` (Task 2), `calculateChainGrossProfit` (Task 1), `findDistributedVehicleIds` (Task 3).
- Produces: `buildCommissionVehicleItem({ ..., chain })` y `buildInvestorVehicleItem({ ..., chain })` — con `chain = { salePrice, purchaseCost, directExpenses, grossProfit, plates }` la cascada del item usa esos agregados y expone `cascade.chainPlates`. Helper interno compartido `resolveChainForVehicle(prismaOrTx, vehicle)` exportado de `commissionService`.

- [ ] **Step 1: Escribir tests de builders (fallan)** — agregar a `commissionService.chain.test.js`:

```js
const { buildCommissionVehicleItem, buildInvestorVehicleItem } = require('../commissionService');

const CLOSURE_VEHICLE = {
  id: 'veh-b', plate: 'BBB222', brand: 'Mazda', model: '3', saleDate: new Date('2026-07-20'),
  salePrice: 25_000_000, purchasePrice: null, negotiatedValue: 20_000_000, fromTradeIn: true,
  participation: 1, expenses: [{ amount: 1_000_000, deletedAt: null }],
};
const CHAIN = { salePrice: 75_000_000, purchaseCost: 60_000_000, directExpenses: 1_000_000,
  grossProfit: 14_000_000, plates: ['AAA111', 'BBB222'] };
const PAYABLE = { id: 'pay-1', totalAmount: 1_400_000, paidAmount: 0, status: 'PENDING',
  thirdParty: { id: 'hermano', name: 'Hermano' },
  saleParticipant: { role: 'CERRADOR', sharePct: 100 }, payments: [] };

test('buildCommissionVehicleItem con chain: cascada del negocio + chainPlates', () => {
  const item = buildCommissionVehicleItem({
    vehicle: CLOSURE_VEHICLE, payables: [PAYABLE], bucketTransfers: [], chain: CHAIN,
  });
  assert.equal(item.cascade.salePrice, 75_000_000);
  assert.equal(item.cascade.purchaseCost, 60_000_000);
  assert.equal(item.cascade.grossProfit, 14_000_000);
  assert.equal(item.cascade.commissionBase, 14_000_000);
  assert.equal(item.cascade.participation, 1);
  assert.equal(item.cascade.commissionPool, 1_400_000);
  assert.deepEqual(item.cascade.chainPlates, ['AAA111', 'BBB222']);
  assert.equal(item.roles.length, 1); // roles intactos
});

test('buildCommissionVehicleItem sin chain: comportamiento actual intacto', () => {
  const item = buildCommissionVehicleItem({
    vehicle: CLOSURE_VEHICLE, payables: [PAYABLE], bucketTransfers: [],
  });
  assert.equal(item.cascade.salePrice, 25_000_000);
  assert.equal(item.cascade.chainPlates, undefined);
});

test('buildInvestorVehicleItem con chain: cascada del negocio + chainPlates', () => {
  const item = buildInvestorVehicleItem({
    vehicle: CLOSURE_VEHICLE, payables: [{ ...PAYABLE, totalAmount: 7_560_000 }],
    commissionPayableSum: 1_400_000, bucketTransfers: [], chain: CHAIN,
  });
  assert.equal(item.cascade.grossProfit, 14_000_000);
  assert.equal(item.cascade.salePrice, 75_000_000);
  assert.deepEqual(item.cascade.chainPlates, ['AAA111', 'BBB222']);
  assert.equal(item.cascade.commissionPool, 1_400_000);
  assert.equal(item.cascade.profitToDistribute, 7_560_000);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && node --test src/services/__tests__/commissionService.chain.test.js`
Expected: FAIL los 2 tests `con chain` (cascada usa el vehículo, no la cadena).

- [ ] **Step 3: Implementar en `commissionService.js`**

1. Require arriba: `const { loadChainMembers } = require('../utils/dealChain');` y agregar `calculateChainGrossProfit` al require de `../utils/financial`.

2. `buildCommissionVehicleItem`: agregar param `chain = null`; tras calcular `commissionPool`, construir la cascada condicionalmente (reemplaza el objeto `cascade` del return):

```js
  const cascade = chain
    ? {
        // Cierre de negocio con cruce: la cascada mostrada es la del NEGOCIO
        // (eslabones agregados), la misma base con la que se creó el pool.
        salePrice: chain.salePrice,
        purchaseCost: chain.purchaseCost,
        directExpenses: chain.directExpenses,
        grossProfit: chain.grossProfit,
        participation: 1,
        commissionBase: chain.grossProfit,
        commissionPool,
        chainPlates: chain.plates,
      }
    : {
        salePrice: Number(vehicle.salePrice || 0),
        purchaseCost,
        directExpenses,
        grossProfit: grossProfitGlobal,
        participation: Number(vehicle.participation || 1),
        commissionBase,
        commissionPool,
      };
```

y usar `cascade` en el objeto retornado.

3. `buildInvestorVehicleItem`: mismo patrón — param `chain = null`; si `chain`, la cascada usa `chain.salePrice/purchaseCost/directExpenses/grossProfit` + `chainPlates: chain.plates`, conservando `commissionPool`, `reinvest`, `tax`, `profitToDistribute` calculados como hoy.

4. Nuevo helper exportado (junto a los de Task 3):

```js
/**
 * Cadena "del negocio" de un vehículo de cierre, para reporting: si el
 * vehículo es fromTradeIn y tiene eslabones anteriores VENDIDOS sin
 * distribución propia, devuelve los agregados de calculateChainGrossProfit;
 * si no, null (item normal de un solo vehículo).
 */
async function resolveChainForVehicle(prismaOrTx, vehicle) {
  if (!vehicle.fromTradeIn) return null;
  const members = await loadChainMembers(prismaOrTx, vehicle.id);
  const otherIds = members.filter((m) => m.id !== vehicle.id).map((m) => m.id);
  const distributed = await findDistributedVehicleIds(prismaOrTx, otherIds);
  const eligible = members.filter(
    (m) => m.id === vehicle.id || (m.stage === 'VENDIDO' && !distributed.has(m.id)),
  );
  if (eligible.length <= 1) return null;
  return calculateChainGrossProfit(eligible);
}
```

5. En `listByVehicle` (dentro del `map` de items, junto al cálculo de `socioInvestor`): `const chain = await resolveChainForVehicle(prismaOrTx, vehicle);` y pasar `chain` a `buildCommissionVehicleItem`.

6. Exportar `resolveChainForVehicle`.

- [ ] **Step 4: Wiring en `investorService.listByVehicle`**

Donde arma cada item con `buildInvestorVehicleItem`, agregar `const chain = await commissionService.resolveChainForVehicle(prismaOrTx, vehicle);` y pasarlo como `chain`.

- [ ] **Step 5: Correr y verificar**

Run: `cd backend && node --test src/services/__tests__/commissionService.chain.test.js && node --test src/services/__tests__/commissionService.test.js && npm test`
Expected: PASS todos.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/commissionService.js backend/src/services/investorService.js backend/src/services/__tests__/commissionService.chain.test.js
git commit -m "feat(reporting): cascada del negocio con cruce en comisiones e inversionistas"
```

---

### Task 7: Frontend — card de diferimiento + placas del negocio en cascadas

**Files:**
- Modify: `frontend/src/pages/VehicleDetailPage.jsx` (tras el card `socio-commission-card`, línea ~380)
- Modify: `frontend/src/pages/treasury/CommissionsPage.jsx` (bloque "Cascada contable", línea ~43)
- Modify: `frontend/src/pages/treasury/InvestorsPage.jsx` (bloque de cascada, línea ~45)

**Interfaces:**
- Consumes: `summary.deferred/deferredToPlate` (Task 4) vía `saleSummary`; `cascade.chainPlates` (Task 6) en los items de ambas páginas.

- [ ] **Step 1: Card de diferimiento en `VehicleDetailPage.jsx`**

Inmediatamente después del bloque `{saleSummary && saleSummary.partnerCommissionOwed > 0 && ( ... )}` agregar (mismo patrón visual; reutilizar los iconos ya importados en el archivo — si `X`/`Handshake` no están importados de `lucide-react`, agregarlos al import existente):

```jsx
      {/* Card: distribución diferida — venta con cruce (comisión única al cierre del negocio) */}
      {saleSummary?.deferred && (
        <div
          className="card mb-4 p-4 border border-[#58A6FF]/40 bg-[#58A6FF]/5 flex items-start justify-between gap-3"
          data-testid="deferred-distribution-card"
        >
          <div className="flex items-start gap-2.5">
            <Handshake className="w-4 h-4 mt-0.5 shrink-0 text-[#58A6FF]" />
            <div>
              <div className="text-sm font-semibold text-[#E6EDF3]">
                Distribución diferida al cierre del negocio
              </div>
              <div className="text-[11px] text-[#6E7681] mt-0.5">
                La comisión y la ganancia se liquidarán al vender el vehículo recibido en cruce
                {saleSummary.deferredToPlate ? ` (${saleSummary.deferredToPlate})` : ''}, si el negocio deja ganancia.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSaleSummary(null)}
            className="text-[#6E7681] hover:text-[#E6EDF3] transition-colors p-1 shrink-0"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
```

- [ ] **Step 2: Placas del negocio en `CommissionsPage.jsx`**

En `CommissionCard`, dentro de `<div className="bg-[#161B22] rounded-lg p-3">`, antes de `<CascadeRow label="Venta" ...>`:

```jsx
        {cascade.chainPlates && (
          <div className="text-[11px] text-[#6E7681] mb-1" data-testid={`commission-chain-${vehicle.plate}`}>
            Negocio en cruce: {cascade.chainPlates.join(' + ')}
          </div>
        )}
```

- [ ] **Step 3: Placas del negocio en `InvestorsPage.jsx`**

Mismo bloque antes de `<CascadeRow label="Precio de venta" ...>`:

```jsx
        {cascade.chainPlates && (
          <div className="text-[11px] text-[#6E7681] mb-1" data-testid={`investor-chain-${vehicle.plate}`}>
            Negocio en cruce: {cascade.chainPlates.join(' + ')}
          </div>
        )}
```

- [ ] **Step 4: Build del frontend**

Run: `cd frontend && npm run build`
Expected: build exitoso sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/VehicleDetailPage.jsx frontend/src/pages/treasury/CommissionsPage.jsx frontend/src/pages/treasury/InvestorsPage.jsx
git commit -m "feat(ui): card de distribución diferida + placas del negocio en cascadas"
```

---

### Task 8: E2E — negocio completo con cruce (Playwright)

**Files:**
- Create: `tests/e2e/sales/negocio-cruce.spec.ts`

**Interfaces:**
- Consumes: helpers existentes de `tests/helpers/api.ts` (`apiPinLogin`, `apiCreateVehicle`, `apiConfirmPurchase`, `apiMoveStage`, `apiRegisterSale`, `apiListPayables`, `apiRequestRaw`, `apiListAccounts`) y `TEST_SEED_IDS` de `tests/global-setup`. Seed de cascada: `commission_gross_pct=10, reinvest_pct=30, tax_pct=10` (mismo que asume `tests/e2e/treasury/investors.spec.ts`).
- Escenario y montos: los del spec (A 40M→50M con cruce 20M + 30M efectivo; B 25M; sin gastos en B ⇒ chain gross = 15M).

- [ ] **Step 1: Escribir el spec (falla contra el comportamiento actual)**

Copiar de `tests/e2e/treasury/cuentas-socio.spec.ts` los helpers locales `uniqueName`, `plate`, `createThirdParty`, `findSocioAccount` y el `BASE_COMMISSION_CFG`, y de `tests/e2e/treasury/investors.spec.ts` el patrón de setup de vendedores (participants explícitos). Estructura del spec:

```ts
import { test, expect } from '../../fixtures/test';
import {
  apiPinLogin, apiRequestRaw, apiCreateVehicle, apiConfirmPurchase, apiMoveStage,
  apiRegisterSale, apiListPayables, apiListAccounts, apiGetVehicle,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// (helpers locales copiados: uniqueName, plate, createThirdParty, findSocioAccount)

test.describe('Negocio con cruce — comisión única al cierre', () => {
  test('socio 100% + cruce: venta A difiere todo; venta B liquida el negocio', async () => {
    const token = await apiPinLogin();

    // 1. Socio capitalista con cuenta SOCIO fondeada (patrón cuentas-socio.spec).
    const socio = await createThirdParty(token, { name: uniqueName('Socio Cruce'), type: 'PARTNER' });
    //    (fondear su cuenta con 40M vía POST /treasury/transfers como en cuentas-socio.spec)

    // 2. Vehículo A del socio 100%: purchasePrice 40M, participation 0,
    //    partnerContribution 40M, partnerId socio.id → confirm purchase → DISPONIBLE.
    //    IMPORTANTE: agregar socio.id al investor_team vía el endpoint de settings
    //    que use el seed (mismo mecanismo que investors.spec.ts) para que
    //    resolveSocio lo detecte como inversionista.

    // 3. Vender A: 50M = 30M efectivo (cuenta seed) + cruce B 20M.
    const plateB = plate('CRB');
    const saleA = await apiRegisterSale(token, vehicleA.id, {
      salePrice: 50_000_000, paymentType: 'MIXED', buyerId: TEST_SEED_IDS.thirdPartyClient,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      tradeIn: { plate: plateB, value: 20_000_000 },
    });
    expect((saleA.summary as { deferred?: boolean }).deferred).toBe(true);

    // 4. Venta A NO tiene distribución; solo CAPITAL_RETURN 30M.
    const payablesA = await apiListPayables(token, { vehicleId: vehicleA.id });
    expect(payablesA.filter((p) => ['COMMISSION', 'COMMISSION_RETURN', 'PROFIT_SHARE', 'PARTNER_SHARE'].includes(p.type))).toHaveLength(0);
    const capA = payablesA.find((p) => p.type === 'CAPITAL_RETURN');
    expect(Number(capA!.totalAmount)).toBe(30_000_000);

    // 5. B (creado por el cruce, NEGOCIANDO) → COMPRADO (se salda por cruce) → DISPONIBLE.
    // 6. Vender B: 25M efectivo, con un vendedor explícito (participants 100%).
    //    Chain gross = (50−40) + (25−20) = 15M → pool 10% = 1.5M.
    // 7. Asserts sobre payables de B:
    //    COMMISSION 1.5M; COMMISSION_RETURN 1.5M (socio.id);
    //    PARTNER_SHARE = 15M×0.9 − reservas(30%+10% de 13.5M) = 8.1M;
    //    CAPITAL_RETURN remanente 10M.
    // 8. GET /treasury/commissions → item de B con cascade.chainPlates = [placaA, plateB]
    //    y cascade.grossProfit = 15M.
  });

  test('fondo sin socio + cruce: A difiere, B liquida con PROFIT_SHARE', async () => {
    // Igual sin socio: venta A (cruce) → 0 payables de distribución en A;
    // venta B → COMMISSION sobre 15M chain gross + PROFIT_SHARE al equipo,
    // verificando el invariante gross − pool − reinvest − tax = Σ PROFIT_SHARE.
  });
});
```

El ejecutor completa los pasos numerados con las llamadas reales siguiendo `cuentas-socio.spec.ts` (compra con socio, fondeo) e `investors.spec.ts` (equipo inversionista/vendedores, endpoint de settings). Los montos y asserts son los indicados arriba — no cambiarlos.

- [ ] **Step 2: Levantar entorno y correr el spec**

Run: `npx playwright test tests/e2e/sales/negocio-cruce.spec.ts`
(el entorno e2e se levanta como en el resto de la suite — `playwright.config.ts` ya define el webServer/global-setup)
Expected: PASS ambos tests.

- [ ] **Step 3: Correr la suite e2e relacionada (regresión)**

Run: `npx playwright test tests/e2e/treasury/investors.spec.ts tests/e2e/treasury/cuentas-socio.spec.ts tests/e2e/treasury/commissions-page.spec.ts tests/e2e/treasury/register-sale.spec.ts tests/e2e/sales/commissions.spec.ts`
Expected: PASS — ninguna venta de esas suites usa cruce, así que no deben cambiar.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/sales/negocio-cruce.spec.ts
git commit -m "test(e2e): negocio con cruce — diferimiento y comisión única al cierre"
```

---

### Task 9: Verificación final

- [ ] **Step 1: Suite completa backend**

Run: `cd backend && npm test`
Expected: PASS todos.

- [ ] **Step 2: Lint + build**

Run: `cd backend && npx eslint src/ 2>/dev/null; cd ../frontend && npm run build`
Expected: sin errores nuevos de lint; build exitoso.

- [ ] **Step 3: E2E completo de tesorería/ventas**

Run: `npx playwright test tests/e2e/treasury/ tests/e2e/sales/`
Expected: PASS.

- [ ] **Step 4: Commit final (si quedaron ajustes) y resumen**

```bash
git add -A && git commit -m "chore: ajustes de verificación — comisión única negocio cruce" || true
```

---

## Self-Review (ejecutada al escribir el plan)

- **Cobertura del spec:** decisiones 1-4 → Task 4; 5 y 7 → Tasks 1+5; 6 → Tasks 4+5 (parcial y remanente); 8 → Task 4 (guard `socioVenta.isInvestor`) + Task 3 (`resolveChainSocio` externo→null); compat datos viejos → Task 5 test 2; cadenas largas → recursión natural (defer se re-aplica; cubierto por diseño, sin task extra); `cancelSale` → sin cambios (guard existente); reporting/UI → Tasks 6-7; e2e → Task 8. Sin gaps.
- **Sin placeholders:** el único paso delegado es el llenado mecánico del e2e (Task 8) con patrones de dos specs existentes nombrados, con montos y asserts fijados en el plan.
- **Consistencia de tipos/nombres:** `loadChainMembers(prismaOrTx, vehicleId)`, `findDistributedVehicleIds(prismaOrTx, vehicleIds)`, `resolveChainSocio(prismaOrTx, members, cfg)` → `{ ..., vehicle }`, `calculateChainGrossProfit(members)` → `{ salePrice, purchaseCost, directExpenses, grossProfit, plates }`, `overrideGrossProfit` — usados con esos nombres en Tasks 4-6.
