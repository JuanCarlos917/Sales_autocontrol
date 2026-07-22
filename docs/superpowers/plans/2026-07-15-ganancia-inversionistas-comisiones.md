# Ganancia (inversionistas) vs Comisión (vendedores) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar en el sistema el rubro **ganancia** (rendimiento a inversionistas: Tú/mamá/papá, reparto por % de capital) del rubro **comisión** (pago a vendedores, % de la ganancia bruta), ambos como CxP pagables por carro con estado de cuenta y auditoría por persona.

**Architecture:** Extender la infra de comisiones simétricamente. Sin tablas nuevas: `SaleParticipant` + `Payable` sirven para ambos rubros (rol `INVESTOR` + tipo `PROFIT_SHARE` nuevos). El cálculo se centraliza en una función pura `calculateSaleDistribution` en `financial.js`; la resolución de personas y persistencia viven en los services; el reporte por persona se generaliza por `PayableType`.

**Tech Stack:** Node.js + Express + Prisma + PostgreSQL (backend, CommonJS); React 18 + Vite + Tailwind (frontend). Tests: `node:test` (backend), Playwright (e2e).

## Global Constraints

- Backend en CommonJS (`require`), no ES Modules.
- Moneda COP sin decimales; redondeo con `roundCop`.
- Todos los cálculos financieros centralizados en `backend/src/utils/financial.js`.
- Validación con Joi en endpoints (schemas en `middleware/validation.js`).
- UI en español (Colombia); código en inglés.
- Porcentajes editables desde Settings — nada hardcodeado. Defaults: comisión `10`, reinversión `30`, impuestos `10`; capital inversionistas `50/25/25`.
- Cascada: `grossProfit = salePrice − costoCompra − gastos`; `commissionPool = (hay vendedores) ? 10%×grossProfit : 0`; `afterCommission = grossProfit − commissionPool`; `reinvest = 30%×afterCommission`; `tax = 10%×afterCommission`; `profitToDistribute = afterCommission − reinvest − tax`.
- `skip` cuando `grossProfit ≤ 0`: no se crea comisión, reservas ni ganancia.
- Sentinel `owner-self` protegido (no borrable) — ver `assertThirdPartyDeletable`.
- Ventas históricas NO se tocan; el modelo nuevo aplica solo a ventas futuras.

---

## File Structure

- `backend/prisma/schema.prisma` — enums `PayableType` (+`PROFIT_SHARE`), `ParticipantRole` (+`INVESTOR`).
- `backend/prisma/migrations/<ts>_ganancia_inversionistas/migration.sql` — `ALTER TYPE` + seed settings.
- `backend/src/utils/financial.js` — `calculateSaleDistribution` (pura).
- `backend/src/services/commissionService.js` — `loadCommissionConfig` (keys nuevos), `resolveSellers`, `resolveInvestors`; generalizar `buildPersonSummary`/`getSummary`/`listByVehicle` por tipo.
- `backend/src/services/investorService.js` — nuevo: estado de cuenta y pago de `PROFIT_SHARE`.
- `backend/src/services/saleService.js` — reescribir paso 5 de `registerSale`; extender reverso.
- `backend/src/controllers/investorController.js` + `backend/src/routes/investors.js` + `routes/index.js`.
- `backend/src/controllers/settingsController.js` + `backend/src/middleware/validation.js` — `investor_team` + pct nuevos.
- `frontend/src/api/*` — cliente `investorsApi`.
- `frontend/src/pages/treasury/InvestorsPage.jsx` — espejo de `CommissionsPage.jsx`.
- `frontend/src/pages/treasury/SettingsPage` (donde viva la config) — sección "Equipo de inversionistas" + pct.
- `frontend/src/pages/**/Dashboard*` — card de ganancia pendiente.
- `tests/e2e/*` — flujo venta → inversionistas.

---

## Task 1: Esquema + migración (enums y settings nuevos)

**Files:**
- Modify: `backend/prisma/schema.prisma` (enums `PayableType`, `ParticipantRole`)
- Create: `backend/prisma/migrations/20260715193000_ganancia_inversionistas/migration.sql`

**Interfaces:**
- Produces: valor de enum `PayableType.PROFIT_SHARE`, `ParticipantRole.INVESTOR`; settings `commission_gross_pct`, `reinvest_pct`, `tax_pct`, `investor_team`.

- [ ] **Step 1: Editar enums en el schema**

En `PayableType` agregar `PROFIT_SHARE`; en `ParticipantRole` agregar `INVESTOR`:

```prisma
enum PayableType {
  RECEIVABLE
  PAYABLE
  COMMISSION
  PROFIT_SHARE
}

enum ParticipantRole {
  CAPTADOR
  CERRADOR
  OTHER
  INVESTOR
}
```

- [ ] **Step 2: Escribir la migración SQL**

`ALTER TYPE ... ADD VALUE` no corre dentro de una transacción con otros statements en algunas versiones de Postgres; por eso los `ADD VALUE` van con `IF NOT EXISTS` y el seed va aparte.

```sql
-- Enums nuevos (idempotente)
ALTER TYPE "PayableType" ADD VALUE IF NOT EXISTS 'PROFIT_SHARE';
ALTER TYPE "ParticipantRole" ADD VALUE IF NOT EXISTS 'INVESTOR';

-- Settings nuevos (idempotente). Los porcentajes son editables desde la UI.
INSERT INTO "settings" ("id", "key", "value") VALUES
  ('set-commission-gross-pct', 'commission_gross_pct', '10'),
  ('set-reinvest-pct',         'reinvest_pct',         '30'),
  ('set-tax-pct',              'tax_pct',              '10'),
  ('set-investor-team',        'investor_team',        '[]')
ON CONFLICT ("key") DO NOTHING;
```

- [ ] **Step 3: Regenerar el cliente Prisma**

Run: `cd backend && npx prisma generate`
Expected: "Generated Prisma Client" sin errores.

- [ ] **Step 4: Verificar que la migración parsea y el schema es válido**

Run: `cd backend && npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid"

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260715193000_ganancia_inversionistas/
git commit -m "feat(db): enums PROFIT_SHARE/INVESTOR y settings de ganancia editables"
```

---

## Task 2: Cálculo puro `calculateSaleDistribution`

**Files:**
- Modify: `backend/src/utils/financial.js`
- Test: `backend/src/utils/__tests__/financial.test.js`

**Interfaces:**
- Consumes: `roundCop(n)` (ya existe en `financial.js`).
- Produces:
  `calculateSaleDistribution(vehicle, cfg, { sellers, investors })` →
  `{ grossProfit, skip, commissionPool, afterCommission, reinvestAmount, taxAmount, profitToDistribute, sellerRows, investorRows }`
  donde `cfg = { commissionGrossPct, reinvestPct, taxPct }`,
  `sellers = [{ thirdPartyId, role, sharePct }]` (suman 100 o vacío),
  `investors = [{ thirdPartyId, role:'INVESTOR', sharePct }]` (suman 100),
  y `sellerRows`/`investorRows` = misma forma + `amount` (entero COP), reconciliados para sumar exacto el pool.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `backend/src/utils/__tests__/financial.test.js`:

```javascript
const { calculateSaleDistribution } = require('../financial');

const distVehicle = { salePrice: 20_000_000, purchasePrice: 15_000_000, fromTradeIn: false, expenses: [] };
const distCfg = { commissionGrossPct: 10, reinvestPct: 30, taxPct: 10 };
const oneSeller = [{ thirdPartyId: 'hermano', role: 'CERRADOR', sharePct: 100 }];
const team = [
  { thirdPartyId: 'owner-self', role: 'INVESTOR', sharePct: 50 },
  { thirdPartyId: 'mama', role: 'INVESTOR', sharePct: 25 },
  { thirdPartyId: 'papa', role: 'INVESTOR', sharePct: 25 },
];

test('dist: cascada completa con comisión + reservas + reparto por capital', () => {
  const d = calculateSaleDistribution(distVehicle, distCfg, { sellers: oneSeller, investors: team });
  assert.equal(d.skip, false);
  assert.equal(d.grossProfit, 5_000_000);
  assert.equal(d.commissionPool, 500_000);
  assert.equal(d.afterCommission, 4_500_000);
  assert.equal(d.reinvestAmount, 1_350_000);
  assert.equal(d.taxAmount, 450_000);
  assert.equal(d.profitToDistribute, 2_700_000);
  assert.equal(d.sellerRows[0].amount, 500_000);
  assert.equal(d.investorRows.find((r) => r.thirdPartyId === 'owner-self').amount, 1_350_000);
  assert.equal(d.investorRows.find((r) => r.thirdPartyId === 'mama').amount, 675_000);
  assert.equal(d.investorRows.reduce((s, r) => s + r.amount, 0), 2_700_000);
});

test('dist: sin vendedores → commissionPool 0, todo a reservas + inversionistas', () => {
  const d = calculateSaleDistribution(distVehicle, distCfg, { sellers: [], investors: team });
  assert.equal(d.commissionPool, 0);
  assert.equal(d.sellerRows.length, 0);
  assert.equal(d.afterCommission, 5_000_000);
  assert.equal(d.reinvestAmount, 1_500_000);
  assert.equal(d.taxAmount, 500_000);
  assert.equal(d.profitToDistribute, 3_000_000);
  assert.equal(d.investorRows.reduce((s, r) => s + r.amount, 0), 3_000_000);
});

test('dist: grossProfit <= 0 → skip sin filas', () => {
  const d = calculateSaleDistribution(
    { salePrice: 10_000_000, purchasePrice: 12_000_000, expenses: [] }, distCfg,
    { sellers: oneSeller, investors: team },
  );
  assert.equal(d.skip, true);
  assert.equal(d.commissionPool, 0);
  assert.equal(d.sellerRows.length, 0);
  assert.equal(d.investorRows.length, 0);
});

test('dist: redondeo — el reparto de inversionistas cuadra exacto con el sobrante a owner-self', () => {
  // profitToDistribute que no divide parejo por 3
  const d = calculateSaleDistribution(
    { salePrice: 20_000_001, purchasePrice: 15_000_000, expenses: [] }, distCfg,
    { sellers: [], investors: team },
  );
  assert.equal(d.investorRows.reduce((s, r) => s + r.amount, 0), d.profitToDistribute);
});

test('dist: fromTradeIn usa negotiatedValue como costo', () => {
  const d = calculateSaleDistribution(
    { salePrice: 20_000_000, fromTradeIn: true, negotiatedValue: 15_000_000, expenses: [] },
    distCfg, { sellers: [], investors: team },
  );
  assert.equal(d.grossProfit, 5_000_000);
});
```

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: FAIL — `calculateSaleDistribution is not a function`.

- [ ] **Step 3: Implementar `calculateSaleDistribution`**

Agregar en `backend/src/utils/financial.js` (antes de `module.exports`) y exportarla:

```javascript
/**
 * Cascada de distribución de una venta (fuente única de verdad).
 * Recibe vendedores e inversionistas YA resueltos (con sharePct que suman 100).
 * Devuelve montos enteros COP; cada bloque (comisión/ganancia) suma exacto.
 */
function calculateSaleDistribution(vehicle, cfg, { sellers = [], investors = [] } = {}) {
  const expenses = (vehicle.expenses || []).filter((e) => !e.deletedAt);
  const directExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const salePrice = Number(vehicle.salePrice || 0);
  const purchaseCost = vehicle.fromTradeIn
    ? Number(vehicle.negotiatedValue || vehicle.purchasePrice || 0)
    : Number(vehicle.purchasePrice || 0);

  const grossProfit = salePrice - purchaseCost - directExpenses;
  const empty = { grossProfit, skip: true, commissionPool: 0, afterCommission: 0,
    reinvestAmount: 0, taxAmount: 0, profitToDistribute: 0, sellerRows: [], investorRows: [] };
  if (grossProfit <= 0) return empty;

  const hasSellers = Array.isArray(sellers) && sellers.length > 0;
  const commissionPool = hasSellers ? roundCop((Number(cfg.commissionGrossPct) / 100) * grossProfit) : 0;
  const afterCommission = grossProfit - commissionPool;
  const reinvestAmount = roundCop((Number(cfg.reinvestPct) / 100) * afterCommission);
  const taxAmount = roundCop((Number(cfg.taxPct) / 100) * afterCommission);
  const profitToDistribute = afterCommission - reinvestAmount - taxAmount;

  // Reparte `pool` entre `rows` por sharePct; el sobrante de redondeo va a la fila `anchorId`
  // (o a la primera fila si no está), garantizando Σ amount === pool.
  const split = (rows, pool, anchorId) => {
    if (!rows || rows.length === 0) return [];
    const out = rows.map((r) => ({ ...r, amount: roundCop((Number(r.sharePct) / 100) * pool) }));
    const diff = pool - out.reduce((s, r) => s + r.amount, 0);
    if (diff !== 0) {
      const idx = Math.max(0, out.findIndex((r) => r.thirdPartyId === anchorId));
      out[idx] = { ...out[idx], amount: out[idx].amount + diff };
    }
    return out;
  };

  return {
    grossProfit, skip: false, commissionPool, afterCommission,
    reinvestAmount, taxAmount, profitToDistribute,
    sellerRows: split(sellers, commissionPool, sellers[0]?.thirdPartyId),
    investorRows: split(investors, profitToDistribute, 'owner-self'),
  };
}
```

Y en el `module.exports` agregar `calculateSaleDistribution`.

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `cd backend && node --test src/utils/__tests__/financial.test.js`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/financial.js backend/src/utils/__tests__/financial.test.js
git commit -m "feat: calculateSaleDistribution — cascada comisión/reservas/ganancia (pura, TDD)"
```

---

## Task 3: Config nueva + `resolveSellers` + `resolveInvestors`

**Files:**
- Modify: `backend/src/services/commissionService.js`
- Test: `backend/src/services/__tests__/commissionService.test.js`

**Interfaces:**
- Consumes: `ensureOwnerExists(tx)`, `OWNER_ID`, `MAX_PARTICIPANTS` (ya en el módulo).
- Produces:
  - `loadCommissionConfig(tx)` extendido → agrega `commissionGrossPct, reinvestPct, taxPct, investorTeam` (además de `reinvestAccountId, taxReserveAccountId, sellerTeam`).
  - `resolveSellers(tx, saleParticipants, cfg)` → `[{ thirdPartyId, role, sharePct }]` (suman 100) o `[]` si no hay vendedores.
  - `resolveInvestors(tx, cfg)` → `[{ thirdPartyId, role:'INVESTOR', sharePct }]` (suman 100; fallback `owner-self` 100).

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `backend/src/services/__tests__/commissionService.test.js`:

```javascript
const { resolveSellers, resolveInvestors } = require('../commissionService');

const CFG_DIST = { investorTeam: [
  { thirdPartyId: 'owner-self', sharePct: 50 },
  { thirdPartyId: 'mama', sharePct: 25 },
  { thirdPartyId: 'papa', sharePct: 25 },
] };

test('resolveSellers: un vendedor debe sumar 100', async () => {
  const out = await resolveSellers(mkTx(), [{ thirdPartyId: 'a', role: 'CERRADOR', sharePct: 100 }], {});
  assert.equal(out.length, 1);
  assert.equal(out[0].sharePct, 100);
});

test('resolveSellers: sin vendedores → []', async () => {
  const out = await resolveSellers(mkTx(), [], {});
  assert.deepEqual(out, []);
});

test('resolveSellers: no suman 100 → 400', async () => {
  await assert.rejects(
    resolveSellers(mkTx(), [{ thirdPartyId: 'a', role: 'OTHER', sharePct: 60 }], {}),
    (e) => e instanceof AppError && e.statusCode === 400,
  );
});

test('resolveInvestors: team válido → filas INVESTOR que suman 100', async () => {
  const out = await resolveInvestors(mkTx(), CFG_DIST);
  assert.equal(out.length, 3);
  assert.ok(out.every((r) => r.role === 'INVESTOR'));
  assert.equal(out.reduce((s, r) => s + r.sharePct, 0), 100);
});

test('resolveInvestors: sin team → fallback owner-self 100', async () => {
  const out = await resolveInvestors(mkTx(), { investorTeam: [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].thirdPartyId, 'owner-self');
  assert.equal(out[0].sharePct, 100);
});

test('resolveInvestors: team con owner-self borrado → error (ensureOwnerExists)', async () => {
  await assert.rejects(
    resolveInvestors(mkTx(['owner-self']), CFG_DIST),
    (e) => e instanceof AppError && /owner-self/.test(e.message),
  );
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `cd backend && node --test src/services/__tests__/commissionService.test.js`
Expected: FAIL — `resolveSellers`/`resolveInvestors` no existen.

- [ ] **Step 3: Implementar en `commissionService.js`**

Extender `loadCommissionConfig` para leer los keys nuevos (agregar a `COMMISSION_CONFIG_KEYS` los que sean obligatorios `commission_gross_pct`, `reinvest_pct`, `tax_pct`; `investor_team` opcional con parse defensivo como `commission_default_team`) y mapear:

```javascript
// dentro del return de loadCommissionConfig, agregar:
commissionGrossPct: Number(cfg.commission_gross_pct),
reinvestPct:        Number(cfg.reinvest_pct),
taxPct:             Number(cfg.tax_pct),
investorTeam,       // parse defensivo de cfg.investor_team, [] si inválido
```

Agregar las funciones (usa los helpers de validación ya existentes; `ensureOwnerExists` ya está):

```javascript
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
```

Exportar `resolveSellers`, `resolveInvestors` en `module.exports`. Nota: `cfg.sellerTeam` = el `commission_default_team` mapeado (renombrar en el return de `loadCommissionConfig` para claridad, o exponer ambos).

- [ ] **Step 4: Ejecutar y verificar que pasan**

Run: `cd backend && node --test src/services/__tests__/commissionService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/commissionService.js backend/src/services/__tests__/commissionService.test.js
git commit -m "feat: resolveSellers (suman 100, sin resto al dueño) y resolveInvestors (team + fallback owner-self)"
```

---

## Task 4: Integrar en `saleService.registerSale`

**Files:**
- Modify: `backend/src/services/saleService.js` (paso 5, líneas ~207-348)
- Test: `backend/src/services/__tests__/saleService.dist.test.js` (nuevo, con stub de `tx`)

**Interfaces:**
- Consumes: `calculateSaleDistribution` (Task 2), `loadCommissionConfig`/`resolveSellers`/`resolveInvestors` (Task 3).
- Produces: en el resultado de `registerSale`, `summary.commission` y `summary.profit` con los rows persistidos.

- [ ] **Step 1: Escribir el test de integración que falla**

Crear `backend/src/services/__tests__/saleService.dist.test.js`. Usa un stub de `tx` que capture los `payable.create` por tipo. (Reutiliza el patrón de stub de `commissionService.test.js`, ampliado con `payable.create`, `saleParticipant.create`, `transfer.create`, `transaction.create`, `vehicle.update`, `payablePayment.create`.) Aserciones clave:

```javascript
// tras registerSale de una venta 20M/costo 15M, 1 vendedor 100%, team 50/25/25:
assert.equal(created.payablesByType.COMMISSION.length, 1);
assert.equal(created.payablesByType.PROFIT_SHARE.length, 3);
assert.equal(sum(created.payablesByType.PROFIT_SHARE, 'totalAmount'), 2_700_000);
assert.equal(created.payablesByType.COMMISSION[0].totalAmount, 500_000);
```

(El plan de ejecución detalla el stub completo; sigue exactamente el `mkTx` existente ampliándolo — no inventes API de Prisma nueva.)

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd backend && node --test src/services/__tests__/saleService.dist.test.js`
Expected: FAIL (aún crea el modelo viejo 60/30/10 con owner-self remainder).

- [ ] **Step 3: Reescribir el paso 5 de `registerSale`**

Reemplazar el bloque de comisiones (desde `// ─── Paso 5` hasta el cierre del `if (!skip)`) por:

```javascript
// ─── Paso 5: Distribución — comisión (vendedores) y ganancia (inversionistas) ───
const cfg = await commissionService.loadCommissionConfig(tx);
const sellers = await commissionService.resolveSellers(tx, saleData.participants, cfg);
const investors = await commissionService.resolveInvestors(tx, cfg);
const dist = calculateSaleDistribution(vehicle /* con salePrice/expenses cargados */, cfg, { sellers, investors });

let distributionSummary = null;
if (!dist.skip) {
  const mkPayable = async (type, row, label) => {
    const payable = await tx.payable.create({ data: {
      type, status: 'PENDING', totalAmount: row.amount, paidAmount: 0,
      description: `${label} venta ${vehicle.plate} — ${row.role}`,
      vehicleId, thirdPartyId: row.thirdPartyId, createdBy: userId,
    }});
    await tx.saleParticipant.create({ data: {
      vehicleId, thirdPartyId: row.thirdPartyId, role: row.role,
      sharePct: row.sharePct, amount: row.amount, payableId: payable.id,
    }});
    return payable;
  };
  for (const r of dist.sellerRows)   await mkPayable('COMMISSION', r, 'Comisión');
  for (const r of dist.investorRows) await mkPayable('PROFIT_SHARE', r, 'Ganancia');

  // Reservas: transfers a budget-reinvest / budget-tax proporcionales al efectivo recibido.
  // (Reutilizar createBucketTransfer existente; base = dist.reinvestAmount / dist.taxAmount
  //  en vez de pools 60/30/10. Mantener el cashRatio actual.)
  // ... (conservar la lógica de createBucketTransfer, cambiando los montos)

  distributionSummary = {
    grossProfit: dist.grossProfit, commissionPool: dist.commissionPool,
    reinvestAmount: dist.reinvestAmount, taxAmount: dist.taxAmount,
    profitToDistribute: dist.profitToDistribute,
    sellers: dist.sellerRows, investors: dist.investorRows,
  };
}
```

Importar `calculateSaleDistribution` arriba (`const { calculateSaleDistribution } = require('../utils/financial')`). Reemplazar el uso de `calculateCommissionBase` por `dist`. Incluir `distributionSummary` en el `summary` retornado.

- [ ] **Step 4: Ejecutar todos los tests del backend**

Run: `cd backend && node --test src/`
Expected: PASS (incluye el nuevo test de distribución y los previos).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/saleService.js backend/src/services/__tests__/saleService.dist.test.js
git commit -m "feat: registerSale crea CxP COMMISSION + PROFIT_SHARE + reservas con la cascada nueva"
```

---

## Task 5: Reverso de venta cubre `PROFIT_SHARE`

**Files:**
- Modify: `backend/src/services/saleService.js` (`cancelSale`) y/o `backend/src/services/reversalEngine.js`
- Test: `backend/src/services/__tests__/saleService.dist.test.js` (añadir caso de reverso)

**Interfaces:**
- Consumes: las CxP creadas en Task 4.

- [ ] **Step 1: Test que falla** — tras cancelar/revertir una venta, las CxP `PROFIT_SHARE` quedan `CANCELLED` (o eliminadas según el patrón que ya use `COMMISSION`), sin CxP huérfanas.

- [ ] **Step 2: Ejecutar y ver fallar.**
Run: `cd backend && node --test src/services/__tests__/saleService.dist.test.js`

- [ ] **Step 3: Extender el reverso** para incluir `type: 'PROFIT_SHARE'` donde hoy maneja `'COMMISSION'` (mismo tratamiento).

- [ ] **Step 4: Ejecutar y ver pasar.**
Run: `cd backend && node --test src/`

- [ ] **Step 5: Commit**
```bash
git add backend/src/services/saleService.js backend/src/services/reversalEngine.js backend/src/services/__tests__/saleService.dist.test.js
git commit -m "fix: el reverso de venta también anula las CxP PROFIT_SHARE"
```

---

## Task 6: Reporte por persona generalizado + `investorService`

**Files:**
- Modify: `backend/src/services/commissionService.js` (parametrizar `buildPersonSummary`/`getSummary`/`listByVehicle` por `PayableType`)
- Create: `backend/src/services/investorService.js`
- Test: `backend/src/services/__tests__/investorService.test.js`

**Interfaces:**
- Produces: `investorService.getSummary(tx)`, `investorService.listByVehicle(tx, {status})`, `investorService.addPayment(vehicleId|payableId, data, userId)` (mismo contrato que comisiones, tipo `PROFIT_SHARE`).

- [ ] **Step 1: Tests que fallan** — `getSummary` agrega solo `PROFIT_SHARE`; `byPerson` ordenado por pendiente; un pago baja el pendiente. (Espejo de los tests de `commissionService`.)

- [ ] **Step 2: Ejecutar y ver fallar.**
Run: `cd backend && node --test src/services/__tests__/investorService.test.js`

- [ ] **Step 3: Implementar.** Generalizar en `commissionService` las funciones de agregación para recibir `payableType` (default `COMMISSION`, retro-compatible) y que `investorService` las reutilice con `PROFIT_SHARE`. `addPayment` reutiliza el flujo `PayablePayment` existente.

- [ ] **Step 4: Ejecutar y ver pasar.**
Run: `cd backend && node --test src/`

- [ ] **Step 5: Commit**
```bash
git add backend/src/services/commissionService.js backend/src/services/investorService.js backend/src/services/__tests__/investorService.test.js
git commit -m "feat: reporte por persona generalizado por tipo + investorService (PROFIT_SHARE)"
```

---

## Task 7: API de inversionistas

**Files:**
- Create: `backend/src/controllers/investorController.js`, `backend/src/routes/investors.js`
- Modify: `backend/src/routes/index.js` (`router.use('/investors', require('./investors'))`)
- Modify: `backend/src/middleware/validation.js` (schema de pago, espejo del de comisiones)

**Interfaces:**
- Produces: `GET /api/investors` (por vehículo), `GET /api/investors/summary`, `POST /api/investors/:vehicleId/pay` (o `/:payableId/pay`) — mismo contrato que `/api/commissions`.

- [ ] **Step 1..N (espejo exacto de `commissionController.js` + `routes/commissions.js`):** copiar la estructura, cambiando el service por `investorService`. Añadir test de integración de las rutas si el proyecto los tiene para comisiones; si no, verificación manual vía `curl` documentada. Commit al final:
```bash
git add backend/src/controllers/investorController.js backend/src/routes/investors.js backend/src/routes/index.js backend/src/middleware/validation.js
git commit -m "feat: API /api/investors (estado de cuenta y pago de ganancia)"
```

---

## Task 8: Settings — `investor_team` + porcentajes editables

**Files:**
- Modify: `backend/src/controllers/settingsController.js` (validación `investor_team` — sin duplicados, suman 100, terceros existentes; y los pct nuevos)
- Modify: `backend/src/middleware/validation.js` (schema Joi de settings)
- Test: `backend/src/services/__tests__/settingsController.*` si existe patrón; si no, añadir test unitario de la validación de `investor_team`.

**Interfaces:**
- Consumes: patrón de validación de `commission_default_team` ya presente (`settingsController.js:126-129`).
- Produces: settings `commission_gross_pct`, `reinvest_pct`, `tax_pct`, `investor_team` persistidos y validados.

- [ ] **Step 1: Test que falla** — `investor_team` con % que no suman 100 → 400; con `owner-self` permitido (a diferencia de vendedores, aquí SÍ va el dueño); terceros inexistentes → 400.
- [ ] **Step 2: Ejecutar y ver fallar.**
- [ ] **Step 3: Implementar la validación** (espejo del bloque de `commission_default_team`, pero permitiendo `owner-self` y exigiendo suma 100).
- [ ] **Step 4: Ejecutar y ver pasar.**
Run: `cd backend && node --test src/`
- [ ] **Step 5: Commit**
```bash
git add backend/src/controllers/settingsController.js backend/src/middleware/validation.js
git commit -m "feat: settings de ganancia (investor_team + pct editables) con validación"
```

---

## Task 9: Frontend — página Inversionistas, settings y dashboard

**Files:**
- Create: `frontend/src/pages/treasury/InvestorsPage.jsx` (espejo de `CommissionsPage.jsx`)
- Modify: cliente API (`frontend/src/api/…`) — agregar `investorsApi` (espejo de `commissionsApi`)
- Modify: router del frontend — ruta `/treasury/investors`
- Modify: pantalla de Settings — sección "Equipo de inversionistas" (selector de terceros + %, valida suma 100) y campos de % (comisión/reinversión/impuestos)
- Modify: Dashboard — card "Ganancia pendiente a inversionistas" + por persona

**Interfaces:**
- Consumes: `GET /api/investors`, `/summary`, `POST .../pay`, `PUT /api/settings`.

- [ ] **Step 1: `investorsApi`** — espejo de `commissionsApi` apuntando a `/investors`.
- [ ] **Step 2: `InvestorsPage.jsx`** — copiar `CommissionsPage.jsx`, cambiar labels a "Ganancia / Inversionistas", el api y los textos (rol `INVESTOR`).
- [ ] **Step 3: Ruta** en el router + item de menú en Tesorería.
- [ ] **Step 4: Settings** — sección equipo de inversionistas (reutilizar `CommissionSplitEditor.jsx` como base, permitiendo `owner-self` y exigiendo suma 100) + inputs de los 3 %.
- [ ] **Step 5: Dashboard card** de ganancia pendiente (espejo de la card de comisiones).
- [ ] **Step 6: Build**
Run: `cd frontend && npm run build`
Expected: build OK.
- [ ] **Step 7: Commit**
```bash
git add frontend/src
git commit -m "feat(ui): página Inversionistas, settings de equipo y card de dashboard"
```

---

## Task 10: E2E

**Files:**
- Create/Modify: `tests/e2e/investors.spec.ts` (o donde vivan los e2e; hay `playwright.config.ts` en la raíz)

**Interfaces:**
- Consumes: el flujo completo de venta + inversionistas.

- [ ] **Step 1: Escribir el e2e** — registrar una venta con vendedor + ganancia; verificar que aparece en Comisiones y en Inversionistas; pagar a un inversionista y ver el pendiente bajar; ver el estado de cuenta por persona.
- [ ] **Step 2: Ejecutar**
Run: `npx playwright test tests/e2e/investors.spec.ts`
Expected: PASS.
- [ ] **Step 3: Commit**
```bash
git add tests/e2e/investors.spec.ts
git commit -m "test(e2e): flujo de venta → comisión + ganancia a inversionistas"
```

---

## Self-Review (cobertura del spec)

- §2 cascada → Task 2 (`calculateSaleDistribution`) ✔
- §4 esquema (enums) → Task 1 ✔
- §5 cálculo puro → Task 2 ✔
- §6 resolveSellers/resolveInvestors (fallback + ensureOwnerExists) → Task 3 ✔
- §7 flujo de venta → Task 4; reverso → Task 5 ✔
- §8 settings editables → Task 1 (seed) + Task 8 (validación/UI) ✔
- §9 rendición de cuentas (servicios/API/UI/dashboard) → Tasks 6, 7, 9 ✔
- §10 migración → Task 1 ✔
- §11 histórico intacto → no hay task que toque ventas viejas ✔
- §12 tests → cada task trae sus tests + Task 10 e2e ✔

**Nota de ejecución:** el paso 5 de `registerSale` y el reverso son las zonas de mayor riesgo (flujo recién estabilizado en prod). Ejecutar Tasks 2-3 (puro + resolución) completamente verdes antes de tocar `saleService` en Task 4.
```
