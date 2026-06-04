# Comisiones y bolsillos — Fase 1 (Infraestructura) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the infrastructure that automatically splits each sale's profit into three configurable buckets (commissions / reinvestment / tax reserve), moves cash-proportional reserves to dedicated treasury accounts, and creates one accounts-payable record per participating seller — all without touching the existing sale UI.

**Architecture:** API-first. New `SaleParticipant` table links a `Vehicle` to N `ThirdParty` records with role + percentage. The existing `Payable` model gains a new `COMMISSION` type. Two new `Account` records with new type `BUDGET` hold the reinvestment and tax reserves. `saleService.registerSale` is extended to create participants + payables + transfers atomically inside the existing `prisma.$transaction`. Configuration lives in the existing `Setting` key-value table.

**Tech Stack:** Prisma 4, PostgreSQL, Express, Joi validation, React 18, Playwright e2e. Backend uses CommonJS (`require`); frontend uses ES modules (`import`). Money in COP (no decimals at the UI layer; Decimal(15,2) in DB).

**Spec reference:** `docs/superpowers/specs/2026-06-04-commissions-phase-1-design.md`

---

## File map

**Create:**

- `backend/prisma/migrations/20260604120000_commissions_phase_1/migration.sql` — schema + seeds
- `backend/src/services/commissionService.js` — commission calculation + bucket distribution logic (kept separate from saleService so saleService stays focused)
- `tests/e2e/sales/commissions.spec.ts` — 8 e2e tests
- `frontend/src/lib/settingsApi.js` — frontend client for commission-config endpoint (or extend existing if present)

**Modify:**

- `backend/prisma/schema.prisma` — enum values, SaleParticipant model, Vehicle relations
- `backend/src/utils/financial.js` — add `calculateCommissionBase`
- `backend/src/utils/__tests__/financial.test.js` — unit tests for the new function
- `backend/src/services/saleService.js` — call commissionService inside the transaction; extend cancelSale guards
- `backend/src/controllers/settingsController.js` — add `getCommissionConfig`, `updateCommissionConfig` handlers with validation
- `backend/src/routes/settings.js` — wire the two new routes
- `backend/src/middleware/validation.js` — add `participants[]` to `vehicleSaleSchema`; add `commissionConfigSchema`
- `frontend/src/pages/SettingsPage.jsx` — new "Comisiones y bolsillos" card
- `frontend/src/pages/treasury/AccountsPage.jsx` — show BUDGET-type accounts in their own section
- `tests/helpers/api.ts` — new API helpers for participants, commission config, account queries
- `tests/helpers/db.ts` — extend seed if needed to expose the "Dueño / Yo" id

---

## Task 1: Prisma schema + migration with seeds

**Files:**
- Modify: `backend/prisma/schema.prisma` (add enum values, model, relations)
- Create: `backend/prisma/migrations/20260604120000_commissions_phase_1/migration.sql`

- [ ] **Step 1: Update Prisma schema — enum values and SaleParticipant model**

Edit `backend/prisma/schema.prisma`. Find `enum AccountType` and add `BUDGET`:

```prisma
enum AccountType {
  CASH
  BANK
  BUDGET
}
```

Find `enum PayableType` and add `COMMISSION`:

```prisma
enum PayableType {
  PAYABLE
  RECEIVABLE
  COMMISSION
}
```

Add new enum near the other enums:

```prisma
enum ParticipantRole {
  CAPTADOR
  CERRADOR
  OTHER
}
```

Add the new model after the `Payable` model:

```prisma
model SaleParticipant {
  id           String          @id @default(cuid())
  vehicleId    String
  vehicle      Vehicle         @relation(fields: [vehicleId], references: [id], onDelete: Cascade)
  thirdPartyId String
  thirdParty   ThirdParty      @relation(fields: [thirdPartyId], references: [id])
  role         ParticipantRole
  sharePct     Decimal         @db.Decimal(5, 2)
  amount       Decimal         @db.Decimal(15, 2)
  payableId    String?         @unique
  payable      Payable?        @relation(fields: [payableId], references: [id])
  createdAt    DateTime        @default(now())

  @@index([vehicleId])
  @@index([thirdPartyId])
  @@map("sale_participants")
}
```

Find the `model Vehicle` block and add the inverse relation among the existing relations:

```prisma
  saleParticipants SaleParticipant[]
```

Find the `model ThirdParty` block and add:

```prisma
  saleParticipants SaleParticipant[]
```

Find the `model Payable` block and add:

```prisma
  saleParticipant SaleParticipant?
```

- [ ] **Step 2: Create the migration SQL file**

Create `backend/prisma/migrations/20260604120000_commissions_phase_1/migration.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════
-- Comisiones y bolsillos — Fase 1
--
-- Agrega los enums BUDGET, COMMISSION, ParticipantRole y la tabla
-- sale_participants. Siembra dos cuentas BUDGET (Fondo Reinversión,
-- Reserva Impuestos), un tercero EMPLOYEE "Dueño / Yo" y los 7
-- Settings con valores default (60/30/10, 30/70).
-- ═══════════════════════════════════════════════════════════════

-- 1) Enum values
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'BUDGET';
ALTER TYPE "PayableType" ADD VALUE IF NOT EXISTS 'COMMISSION';

-- 2) New enum
CREATE TYPE "ParticipantRole" AS ENUM ('CAPTADOR', 'CERRADOR', 'OTHER');

-- 3) New table sale_participants
CREATE TABLE "sale_participants" (
  "id"           TEXT NOT NULL,
  "vehicleId"    TEXT NOT NULL,
  "thirdPartyId" TEXT NOT NULL,
  "role"         "ParticipantRole" NOT NULL,
  "sharePct"     DECIMAL(5, 2) NOT NULL,
  "amount"       DECIMAL(15, 2) NOT NULL,
  "payableId"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sale_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sale_participants_payableId_key" ON "sale_participants"("payableId");
CREATE INDEX "sale_participants_vehicleId_idx" ON "sale_participants"("vehicleId");
CREATE INDEX "sale_participants_thirdPartyId_idx" ON "sale_participants"("thirdPartyId");

ALTER TABLE "sale_participants"
  ADD CONSTRAINT "sale_participants_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_participants"
  ADD CONSTRAINT "sale_participants_thirdPartyId_fkey"
  FOREIGN KEY ("thirdPartyId") REFERENCES "third_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_participants"
  ADD CONSTRAINT "sale_participants_payableId_fkey"
  FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Seed BUDGET accounts (idempotent)
INSERT INTO "accounts" ("id", "name", "type", "initialBalance", "isActive", "createdAt", "updatedAt")
VALUES
  ('budget-reinvest', 'Fondo Reinversión', 'BUDGET', 0, true, NOW(), NOW()),
  ('budget-tax',      'Reserva Impuestos', 'BUDGET', 0, true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 5) Seed ThirdParty "Dueño / Yo" used as default participant when API caller doesn't pass participants[]
INSERT INTO "third_parties" ("id", "name", "type", "isActive", "createdAt", "updatedAt")
VALUES ('owner-self', 'Dueño / Yo', 'EMPLOYEE', true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 6) Seed default settings (idempotent)
INSERT INTO "settings" ("id", "key", "value")
VALUES
  ('set-commission-pct',  'commission_share_pct',   '60'),
  ('set-reinvest-pct',    'reinvest_share_pct',     '30'),
  ('set-tax-pct',         'tax_share_pct',          '10'),
  ('set-captador-pct',    'default_captador_pct',   '30'),
  ('set-cerrador-pct',    'default_cerrador_pct',   '70'),
  ('set-reinvest-acc',    'reinvest_account_id',    'budget-reinvest'),
  ('set-tax-acc',         'tax_reserve_account_id', 'budget-tax')
ON CONFLICT ("key") DO NOTHING;
```

- [ ] **Step 3: Apply the migration to the local test DB**

Run:

```bash
cd backend && DATABASE_URL="postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test" npx prisma migrate deploy
```

Expected output: `Applying migration 20260604120000_commissions_phase_1` followed by `All migrations have been successfully applied.`

- [ ] **Step 4: Regenerate the Prisma client**

Run:

```bash
cd backend && DATABASE_URL="postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test" npx prisma generate
```

Expected output: `Generated Prisma Client (v4.16.2)`.

- [ ] **Step 5: Verify seeds applied**

Run:

```bash
psql "postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test" -c "SELECT key, value FROM settings WHERE key LIKE '%pct' OR key LIKE '%account_id';"
psql "postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test" -c "SELECT id, name, type FROM accounts WHERE type = 'BUDGET';"
psql "postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test" -c "SELECT id, name FROM third_parties WHERE id = 'owner-self';"
```

Expected: 7 settings rows, 2 BUDGET accounts, 1 "Dueño / Yo" third party.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260604120000_commissions_phase_1
git commit -m "feat(commissions): schema + migration for phase 1 infrastructure

Adds AccountType.BUDGET, PayableType.COMMISSION, ParticipantRole enum
and sale_participants table with self-reseeding settings (60/30/10
and 30/70 defaults) plus two BUDGET accounts and the default-fallback
ThirdParty 'Dueño / Yo'."
```

---

## Task 2: calculateCommissionBase utility function

**Files:**
- Modify: `backend/src/utils/financial.js`
- Modify: `backend/src/utils/__tests__/financial.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/utils/__tests__/financial.test.js` after the existing imports and tests (don't replace anything):

```javascript
const {
  calculateCommissionBase,
} = require('../financial');

// ── calculateCommissionBase ─────────────────────────────────
test('calculateCommissionBase: vehículo sin socio, ganancia positiva', () => {
  const v = {
    salePrice: 40_000_000,
    purchasePrice: 30_000_000,
    expenses: [
      { category: 'MECANICA', amount: 500_000 },
      { category: 'ESTETICA', amount: 500_000 },
    ],
    participation: 1,
    fromTradeIn: false,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.grossProfitGlobal, 9_000_000);
  assert.equal(r.commissionBase, 9_000_000);
  assert.equal(r.skip, false);
});

test('calculateCommissionBase: vehículo con socio 50%, base = mi parte', () => {
  const v = {
    salePrice: 40_000_000,
    purchasePrice: 30_000_000,
    expenses: [{ category: 'MECANICA', amount: 1_000_000 }],
    participation: 0.5,
    fromTradeIn: false,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.grossProfitGlobal, 9_000_000);
  assert.equal(r.commissionBase, 4_500_000);
  assert.equal(r.skip, false);
});

test('calculateCommissionBase: pérdida → skip true, base 0', () => {
  const v = {
    salePrice: 25_000_000,
    purchasePrice: 30_000_000,
    expenses: [],
    participation: 1,
    fromTradeIn: false,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.commissionBase, 0);
  assert.equal(r.skip, true);
});

test('calculateCommissionBase: fromTradeIn usa negotiatedValue como purchasePrice', () => {
  const v = {
    salePrice: 25_000_000,
    purchasePrice: null,
    negotiatedValue: 17_500_000,
    expenses: [],
    participation: 1,
    fromTradeIn: true,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.grossProfitGlobal, 7_500_000);
  assert.equal(r.commissionBase, 7_500_000);
  assert.equal(r.skip, false);
});

test('calculateCommissionBase: expenses categoría COMISION quedan excluidos', () => {
  const v = {
    salePrice: 40_000_000,
    purchasePrice: 30_000_000,
    expenses: [
      { category: 'MECANICA', amount: 500_000 },
      { category: 'COMISION', amount: 2_000_000 }, // legacy, no debe restar
    ],
    participation: 1,
    fromTradeIn: false,
  };
  const r = calculateCommissionBase(v);
  assert.equal(r.grossProfitGlobal, 9_500_000);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd backend && node --test src/utils/__tests__/financial.test.js 2>&1 | tail -20
```

Expected: 5 new tests fail with `TypeError: calculateCommissionBase is not a function` or similar import error.

- [ ] **Step 3: Implement calculateCommissionBase**

Edit `backend/src/utils/financial.js`. After the `projectProfit` function (which is the last function before `module.exports`), add:

```javascript
/**
 * Calcula la base sobre la que se aplica el reparto 60/30/10 de comisiones.
 *
 * Base = (salePrice - purchasePrice - gastos directos NO-COMISION) × participación
 *
 * - No descuenta gastos fijos mensuales prorrateados (esa es la elección
 *   explícita: comisiones se calculan sobre ganancia bruta, no neta).
 * - Excluye expenses con category='COMISION' (legacy: antes las comisiones
 *   se modelaban como expense del vehículo).
 * - Para vehículos fromTradeIn=true (sin purchasePrice todavía o saldado por el cruce),
 *   usa negotiatedValue como costo base.
 * - Multiplica por participation para que con socio la base sea "mi parte".
 * - Si el resultado es ≤ 0, devuelve skip=true.
 */
function calculateCommissionBase(vehicle) {
  const expenses = vehicle.expenses || [];
  const directExpenses = expenses
    .filter(e => e.category !== 'COMISION')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const salePrice = Number(vehicle.salePrice || 0);
  const purchasePrice = vehicle.fromTradeIn
    ? Number(vehicle.negotiatedValue || vehicle.purchasePrice || 0)
    : Number(vehicle.purchasePrice || 0);

  const grossProfitGlobal = salePrice - purchasePrice - directExpenses;
  const participation = Number(vehicle.participation || 1);
  const commissionBase = grossProfitGlobal * participation;

  return {
    grossProfitGlobal,
    commissionBase,
    skip: commissionBase <= 0,
  };
}
```

Update the `module.exports` line at the bottom:

```javascript
module.exports = { daysBetween, calculateVehicleMetrics, projectProfit, calculateParticipation, calculateCommissionBase };
```

- [ ] **Step 4: Run tests, verify they pass**

Run:

```bash
cd backend && node --test src/utils/__tests__/financial.test.js 2>&1 | tail -10
```

Expected: all tests pass, including the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/financial.js backend/src/utils/__tests__/financial.test.js
git commit -m "feat(commissions): calculateCommissionBase utility

Pure function that returns the base over which the 60/30/10 split
is applied, handling partner share (× participation), trade-in cost
basis (uses negotiatedValue), legacy COMISION expense exclusion, and
the loss case (skip=true when base ≤ 0)."
```

---

## Task 3: GET /settings/commission-config endpoint

**Files:**
- Modify: `backend/src/controllers/settingsController.js`
- Modify: `backend/src/routes/settings.js`
- Create test in `tests/e2e/sales/commissions.spec.ts` (first file creation)
- Modify: `tests/helpers/api.ts` (add helpers)

- [ ] **Step 1: Add api helper for commission config**

Append to `tests/helpers/api.ts` after the existing exports:

```typescript
export interface CommissionConfig {
  commission_share_pct: string;
  reinvest_share_pct: string;
  tax_share_pct: string;
  default_captador_pct: string;
  default_cerrador_pct: string;
  reinvest_account_id: string;
  tax_reserve_account_id: string;
  reinvest_account?: { id: string; name: string; type: string };
  tax_reserve_account?: { id: string; name: string; type: string };
}

export async function apiGetCommissionConfig(token: string): Promise<CommissionConfig> {
  return getJson('/settings/commission-config', token);
}

export async function apiUpdateCommissionConfig(
  token: string,
  body: Record<string, string | number>,
): Promise<{ status: number; body: { error?: string; data?: CommissionConfig } }> {
  return apiRequestRaw('PUT', '/settings/commission-config', token, body);
}
```

- [ ] **Step 2: Create the e2e test file with the first failing test**

Create `tests/e2e/sales/commissions.spec.ts`:

```typescript
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetCommissionConfig,
  apiUpdateCommissionConfig,
} from '../../helpers/api';

test.describe('Comisiones — configuración global', () => {
  test('GET /settings/commission-config devuelve los 7 valores con cuentas hidratadas', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const cfg = await apiGetCommissionConfig(token);

    expect(cfg.commission_share_pct).toBe('60');
    expect(cfg.reinvest_share_pct).toBe('30');
    expect(cfg.tax_share_pct).toBe('10');
    expect(cfg.default_captador_pct).toBe('30');
    expect(cfg.default_cerrador_pct).toBe('70');
    expect(cfg.reinvest_account_id).toBe('budget-reinvest');
    expect(cfg.tax_reserve_account_id).toBe('budget-tax');
    expect(cfg.reinvest_account?.type).toBe('BUDGET');
    expect(cfg.tax_reserve_account?.type).toBe('BUDGET');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project && npx playwright test tests/e2e/sales/commissions.spec.ts --reporter=list 2>&1 | tail -10
```

Expected: test fails with 404 (route doesn't exist yet).

- [ ] **Step 4: Implement the controller**

Append to `backend/src/controllers/settingsController.js` before `module.exports`:

```javascript
const COMMISSION_CONFIG_KEYS = [
  'commission_share_pct',
  'reinvest_share_pct',
  'tax_share_pct',
  'default_captador_pct',
  'default_cerrador_pct',
  'reinvest_account_id',
  'tax_reserve_account_id',
];

const getCommissionConfig = async (req, res, next) => {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: COMMISSION_CONFIG_KEYS } },
    });
    const result = {};
    rows.forEach(r => { result[r.key] = r.value; });

    // Hidratar las cuentas BUDGET para mostrar nombre/tipo en la UI
    const accountIds = [result.reinvest_account_id, result.tax_reserve_account_id].filter(Boolean);
    if (accountIds.length > 0) {
      const accounts = await prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, name: true, type: true },
      });
      const byId = Object.fromEntries(accounts.map(a => [a.id, a]));
      result.reinvest_account = byId[result.reinvest_account_id] || null;
      result.tax_reserve_account = byId[result.tax_reserve_account_id] || null;
    }

    res.json(result);
  } catch (err) { next(err); }
};
```

Update the `module.exports` at the bottom of the same file to include the new function:

```javascript
module.exports = { getAll, update, getCommissionConfig };
```

- [ ] **Step 5: Wire the route**

Edit `backend/src/routes/settings.js`. After the existing routes, add:

```javascript
router.get('/commission-config', ctrl.getCommissionConfig);
```

The file should look like:

```javascript
const { Router } = require('express');
const ctrl = require('../controllers/settingsController');
const { authorize } = require('../middleware/auth');

const router = Router();

router.use(authorize('ADMIN'));

router.get('/', ctrl.getAll);
router.put('/', ctrl.update);
router.get('/commission-config', ctrl.getCommissionConfig);

module.exports = router;
```

- [ ] **Step 6: Run the test, verify it passes**

Run:

```bash
npx playwright test tests/e2e/sales/commissions.spec.ts --reporter=list 2>&1 | tail -5
```

Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/settingsController.js backend/src/routes/settings.js tests/helpers/api.ts tests/e2e/sales/commissions.spec.ts
git commit -m "feat(commissions): GET /settings/commission-config endpoint

Returns the 7 commission-related settings plus the hydrated BUDGET
accounts (name + type) for the reinvestment and tax-reserve targets."
```

---

## Task 4: PUT /settings/commission-config with validation

**Files:**
- Modify: `backend/src/middleware/validation.js`
- Modify: `backend/src/controllers/settingsController.js`
- Modify: `backend/src/routes/settings.js`
- Modify: `tests/e2e/sales/commissions.spec.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/e2e/sales/commissions.spec.ts` inside the existing `describe`:

```typescript
  test('PUT /settings/commission-config valida que los 3 bolsillos sumen 100', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const res = await apiUpdateCommissionConfig(token, {
      commission_share_pct: 50,
      reinvest_share_pct: 30,
      tax_share_pct: 10,  // suma 90, debe fallar
      default_captador_pct: 30,
      default_cerrador_pct: 70,
      reinvest_account_id: 'budget-reinvest',
      tax_reserve_account_id: 'budget-tax',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sum|100|bolsillos/i);
  });

  test('PUT /settings/commission-config valida que captador+cerrador sumen 100', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const res = await apiUpdateCommissionConfig(token, {
      commission_share_pct: 60,
      reinvest_share_pct: 30,
      tax_share_pct: 10,
      default_captador_pct: 40,
      default_cerrador_pct: 50,  // suma 90, debe fallar
      reinvest_account_id: 'budget-reinvest',
      tax_reserve_account_id: 'budget-tax',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/default.*100|captador.*cerrador/i);
  });

  test('PUT /settings/commission-config valida que las cuentas sean BUDGET', async ({ page }) => {
    const token = await loginAsAdmin(page);
    // 'test-acc-cash' is a CASH account from the seed
    const res = await apiUpdateCommissionConfig(token, {
      commission_share_pct: 60,
      reinvest_share_pct: 30,
      tax_share_pct: 10,
      default_captador_pct: 30,
      default_cerrador_pct: 70,
      reinvest_account_id: 'test-acc-cash',  // no es BUDGET
      tax_reserve_account_id: 'budget-tax',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/BUDGET|tipo.*cuenta/i);
  });

  test('PUT /settings/commission-config con payload válido actualiza y retorna 200', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const res = await apiUpdateCommissionConfig(token, {
      commission_share_pct: 55,
      reinvest_share_pct: 35,
      tax_share_pct: 10,
      default_captador_pct: 30,
      default_cerrador_pct: 70,
      reinvest_account_id: 'budget-reinvest',
      tax_reserve_account_id: 'budget-tax',
    });
    expect(res.status).toBe(200);
    const after = await apiGetCommissionConfig(token);
    expect(after.commission_share_pct).toBe('55');
    expect(after.reinvest_share_pct).toBe('35');
    // Restaurar defaults para no afectar otros tests
    await apiUpdateCommissionConfig(token, {
      commission_share_pct: 60,
      reinvest_share_pct: 30,
      tax_share_pct: 10,
      default_captador_pct: 30,
      default_cerrador_pct: 70,
      reinvest_account_id: 'budget-reinvest',
      tax_reserve_account_id: 'budget-tax',
    });
  });
```

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
npx playwright test tests/e2e/sales/commissions.spec.ts --reporter=list 2>&1 | tail -10
```

Expected: the 4 new tests fail with 404 (route doesn't exist).

- [ ] **Step 3: Add Joi schema for the config**

Edit `backend/src/middleware/validation.js`. Before the existing `module.exports`, add:

```javascript
const commissionConfigSchema = Joi.object({
  commission_share_pct:   Joi.number().min(0).max(100).required(),
  reinvest_share_pct:     Joi.number().min(0).max(100).required(),
  tax_share_pct:          Joi.number().min(0).max(100).required(),
  default_captador_pct:   Joi.number().min(0).max(100).required(),
  default_cerrador_pct:   Joi.number().min(0).max(100).required(),
  reinvest_account_id:    Joi.string().required(),
  tax_reserve_account_id: Joi.string().required(),
}).custom((value, helpers) => {
  const bucketSum = value.commission_share_pct + value.reinvest_share_pct + value.tax_share_pct;
  if (Math.abs(bucketSum - 100) > 0.001) {
    return helpers.error('any.invalid', { message: 'Los tres bolsillos deben sumar 100' });
  }
  const splitSum = value.default_captador_pct + value.default_cerrador_pct;
  if (Math.abs(splitSum - 100) > 0.001) {
    return helpers.error('any.invalid', { message: 'default captador + cerrador deben sumar 100' });
  }
  return value;
}, 'commission-config-sums').messages({
  'any.invalid': '{{#message}}',
});
```

Find the exported schemas object at the bottom (`const schemas = { ... }` or similar) and add `commissionConfig: commissionConfigSchema` to it.

- [ ] **Step 4: Implement the controller**

Append to `backend/src/controllers/settingsController.js` (before `module.exports`):

```javascript
const updateCommissionConfig = async (req, res, next) => {
  try {
    const data = req.body;

    // Validar que las cuentas existen y son tipo BUDGET
    const accounts = await prisma.account.findMany({
      where: { id: { in: [data.reinvest_account_id, data.tax_reserve_account_id] } },
      select: { id: true, type: true, isActive: true },
    });
    const byId = Object.fromEntries(accounts.map(a => [a.id, a]));
    const reinv = byId[data.reinvest_account_id];
    const tax = byId[data.tax_reserve_account_id];
    if (!reinv || reinv.type !== 'BUDGET' || !reinv.isActive) {
      return res.status(400).json({ error: 'reinvest_account_id debe apuntar a una cuenta BUDGET activa' });
    }
    if (!tax || tax.type !== 'BUDGET' || !tax.isActive) {
      return res.status(400).json({ error: 'tax_reserve_account_id debe apuntar a una cuenta BUDGET activa' });
    }

    const entries = Object.entries(data);
    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        })
      )
    );
    res.json({ message: 'Configuración de comisiones actualizada' });
  } catch (err) { next(err); }
};
```

Update `module.exports`:

```javascript
module.exports = { getAll, update, getCommissionConfig, updateCommissionConfig };
```

- [ ] **Step 5: Wire the route with validation**

Edit `backend/src/routes/settings.js`. Add the import and the route:

```javascript
const { Router } = require('express');
const ctrl = require('../controllers/settingsController');
const { authorize } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = Router();

router.use(authorize('ADMIN'));

router.get('/', ctrl.getAll);
router.put('/', ctrl.update);
router.get('/commission-config', ctrl.getCommissionConfig);
router.put('/commission-config', validate(schemas.commissionConfig), ctrl.updateCommissionConfig);

module.exports = router;
```

(If `validate` and `schemas` are imported differently in this codebase, follow the existing import pattern from `backend/src/routes/vehicles.js` line 1-2.)

- [ ] **Step 6: Run tests, verify they pass**

Run:

```bash
npx playwright test tests/e2e/sales/commissions.spec.ts --reporter=list 2>&1 | tail -10
```

Expected: 5 passed (1 GET + 4 PUT cases).

- [ ] **Step 7: Commit**

```bash
git add backend/src/middleware/validation.js backend/src/controllers/settingsController.js backend/src/routes/settings.js tests/e2e/sales/commissions.spec.ts
git commit -m "feat(commissions): PUT /settings/commission-config with validation

Joi schema enforces the two sum-to-100 constraints (buckets and
default split). Controller additionally verifies that the two account
IDs point to active BUDGET accounts. Admin-only via the existing
authorize middleware on the router."
```

---

## Task 5: commissionService — bucket math and participant resolution

**Files:**
- Create: `backend/src/services/commissionService.js`

This task introduces the pure-logic module that saleService will call. No saleService changes yet — we want this module unit-testable on its own.

- [ ] **Step 1: Create the service with the public surface**

Create `backend/src/services/commissionService.js`:

```javascript
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
 * - Si no viene, devuelve el default: el ThirdParty "owner-self" como CERRADOR 100%.
 *
 * Devuelve [{ thirdPartyId, role, sharePct }].
 */
async function resolveParticipants(prismaOrTx, saleParticipants) {
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

  // Default: owner-self como CERRADOR 100%
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
  return [{ thirdPartyId: 'owner-self', role: 'CERRADOR', sharePct: 100 }];
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

module.exports = {
  loadCommissionConfig,
  resolveParticipants,
  calculatePools,
  calculateCashRatio,
  calculateCommissionBase, // re-export for convenience
  COMMISSION_CONFIG_KEYS,
};
```

- [ ] **Step 2: No tests for this task**

The functions are pure and small; they get exercised heavily by the e2e tests in Task 6+. Skipping a dedicated unit test layer here is a deliberate YAGNI — if any function grows complex we add tests then.

- [ ] **Step 3: Verify nothing breaks**

Run:

```bash
cd backend && node --test src/utils/__tests__/financial.test.js 2>&1 | tail -5
```

Expected: same number of tests passing as before; this task didn't change behavior.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/commissionService.js
git commit -m "feat(commissions): commissionService with pure helpers

Stateless module with loadCommissionConfig, resolveParticipants,
calculatePools, calculateCashRatio. Used by saleService in the next
task to keep that service focused on orchestration."
```

---

## Task 6: saleService — happy path: cash sale generates payables + transfers

**Files:**
- Modify: `backend/src/services/saleService.js`
- Modify: `backend/src/middleware/validation.js` (extend vehicleSaleSchema)
- Modify: `tests/helpers/api.ts` (add commission-related types)
- Modify: `tests/e2e/sales/commissions.spec.ts`

- [ ] **Step 1: Extend the test helpers**

Edit `tests/helpers/api.ts`. Find the `RegisterSalePayload` interface and add:

```typescript
  participants?: Array<{
    thirdPartyId: string;
    role: 'CAPTADOR' | 'CERRADOR' | 'OTHER';
    sharePct: number;
  }>;
```

Find the `RegisterSaleResult` interface and replace the `summary` field with:

```typescript
  summary: {
    salePrice: number;
    totalReceived: number;
    pendingAmount: number;
    tradeInValue: number;
    commissionBase?: number;
    commissionPool?: number;
    reinvestPool?: number;
    taxPool?: number;
    cashRatioApplied?: number;
    participants?: Array<{
      id: string;
      thirdPartyId: string;
      role: string;
      sharePct: number;
      amount: number;
      payableId: string;
    }>;
    transfers?: Array<{
      id: string;
      accountIdFrom: string;
      accountIdTo: string;
      amount: number;
      description: string;
    }>;
  };
```

- [ ] **Step 2: Write the failing happy-path test**

Append to `tests/e2e/sales/commissions.spec.ts` inside the describe block:

```typescript
  test('venta 100% cash con default participant: crea CxP COMMISSION y 2 Transfers', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `CSH${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
    });

    // Profit = 30M - 20M = 10M (sin gastos directos, sin socio)
    expect(res.summary.commissionBase).toBe(10_000_000);
    expect(res.summary.commissionPool).toBe(6_000_000);   // 60%
    expect(res.summary.reinvestPool).toBe(3_000_000);     // 30%
    expect(res.summary.taxPool).toBe(1_000_000);          // 10%
    expect(res.summary.cashRatioApplied).toBe(1);         // 100% cash

    // Default: 1 participant (owner-self) con 100% del pool
    expect(res.summary.participants).toHaveLength(1);
    expect(res.summary.participants![0].thirdPartyId).toBe('owner-self');
    expect(res.summary.participants![0].role).toBe('CERRADOR');
    expect(res.summary.participants![0].amount).toBe(6_000_000);

    // 2 Transfers: reinvest 3M y tax 1M
    expect(res.summary.transfers).toHaveLength(2);
    const reinvest = res.summary.transfers!.find(t => t.accountIdTo === 'budget-reinvest');
    const tax = res.summary.transfers!.find(t => t.accountIdTo === 'budget-tax');
    expect(reinvest?.amount).toBe(3_000_000);
    expect(tax?.amount).toBe(1_000_000);
  });
```

Also add imports at the top of the file if not present:

```typescript
import { apiCreateVehicle, apiRegisterSale } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';
```

- [ ] **Step 3: Confirm the test fails**

Run:

```bash
npx playwright test tests/e2e/sales/commissions.spec.ts --reporter=list 2>&1 | tail -10
```

Expected: the new test fails — `res.summary.commissionBase` is undefined (saleService doesn't return it yet).

- [ ] **Step 4: Extend vehicleSaleSchema to accept participants[]**

Edit `backend/src/middleware/validation.js`. Find `vehicleSaleSchema` and add inside the `.object({ ... })`:

```javascript
  participants: Joi.array().items(Joi.object({
    thirdPartyId: Joi.string().required(),
    role: Joi.string().valid('CAPTADOR', 'CERRADOR', 'OTHER').required(),
    sharePct: Joi.number().min(0).max(100).required(),
  })).optional(),
```

- [ ] **Step 5: Extend saleService.registerSale**

Edit `backend/src/services/saleService.js`. At the top of the file (with the other requires) add:

```javascript
const commissionService = require('./commissionService');
const { calculateCommissionBase } = require('../utils/financial');
```

Find the `registerSale` function. Inside it, before the `return { vehicle: updatedVehicle, ... }` at the end of the transaction block, add this new step 5:

```javascript
    // ─── Paso 5: Comisiones y bolsillos ─────────────────────────────
    // Calcula la base, resuelve participantes, crea CxP COMMISSION por
    // participante y Transfers proporcionales al efectivo recibido.
    let commissionSummary = null;
    const vehicleForBase = {
      salePrice: salePriceNum,
      purchasePrice: vehicle.purchasePrice,
      negotiatedValue: vehicle.negotiatedValue,
      fromTradeIn: vehicle.fromTradeIn,
      participation: vehicle.participation,
      expenses: vehicle.expenses,
    };
    const { grossProfitGlobal, commissionBase, skip } = calculateCommissionBase(vehicleForBase);

    if (!skip) {
      const cfg = await commissionService.loadCommissionConfig(tx);
      const pools = commissionService.calculatePools(commissionBase, cfg);
      const resolved = await commissionService.resolveParticipants(tx, saleData.participants);

      // 5a. Crear SaleParticipant + Payable COMMISSION por cada uno
      const participantResults = [];
      for (const p of resolved) {
        const amount = pools.commissionPool * (p.sharePct / 100);
        const payable = await tx.payable.create({
          data: {
            type: 'COMMISSION',
            status: 'PENDING',
            totalAmount: amount,
            paidAmount: 0,
            description: `Comisión venta ${vehicle.plate} — ${p.role}`,
            vehicleId,
            thirdPartyId: p.thirdPartyId,
            createdBy: userId,
          },
        });
        const sp = await tx.saleParticipant.create({
          data: {
            vehicleId,
            thirdPartyId: p.thirdPartyId,
            role: p.role,
            sharePct: p.sharePct,
            amount,
            payableId: payable.id,
          },
        });
        participantResults.push({
          id: sp.id,
          thirdPartyId: p.thirdPartyId,
          role: p.role,
          sharePct: p.sharePct,
          amount,
          payableId: payable.id,
        });
      }

      // 5b. Transfers proporcionales al efectivo recibido
      const tradeInValue = tradeIn?.value ? parseFloat(tradeIn.value) : 0;
      const cashReceived = totalReceived - tradeInValue;
      const cashRatio = commissionService.calculateCashRatio(totalReceived, cashReceived);
      const transferResults = [];
      if (cashReceived > 0 && moneyPayments.length > 0) {
        const fromAccountId = moneyPayments[0].accountId;
        const reinvestAmt = pools.reinvestPool * cashRatio;
        const taxAmt = pools.taxPool * cashRatio;
        if (reinvestAmt > 0) {
          const t = await tx.transfer.create({
            data: {
              accountIdFrom: fromAccountId,
              accountIdTo: cfg.reinvestAccountId,
              amount: reinvestAmt,
              description: `Reinversión venta ${vehicle.plate}`,
              createdBy: userId,
            },
          });
          transferResults.push({
            id: t.id,
            accountIdFrom: fromAccountId,
            accountIdTo: cfg.reinvestAccountId,
            amount: Number(t.amount),
            description: t.description,
          });
        }
        if (taxAmt > 0) {
          const t = await tx.transfer.create({
            data: {
              accountIdFrom: fromAccountId,
              accountIdTo: cfg.taxReserveAccountId,
              amount: taxAmt,
              description: `Impuestos venta ${vehicle.plate}`,
              createdBy: userId,
            },
          });
          transferResults.push({
            id: t.id,
            accountIdFrom: fromAccountId,
            accountIdTo: cfg.taxReserveAccountId,
            amount: Number(t.amount),
            description: t.description,
          });
        }
      }

      commissionSummary = {
        commissionBase,
        commissionPool: pools.commissionPool,
        reinvestPool: pools.reinvestPool,
        taxPool: pools.taxPool,
        cashRatioApplied: cashRatio,
        participants: participantResults,
        transfers: transferResults,
      };
    }
```

Now find the return statement at the end of the transaction (the one that builds `summary`). Extend it to merge in the commission summary:

```javascript
    return {
      vehicle: updatedVehicle,
      transactions,
      newVehicle,
      receivable,
      summary: {
        salePrice: salePriceNum,
        totalReceived,
        pendingAmount: pendingAmount > 0 ? pendingAmount : 0,
        tradeInValue: tradeIn?.value || 0,
        ...(commissionSummary || {}),
      }
    };
```

Note: this requires `Transfer` model to exist with fields `accountIdFrom`, `accountIdTo`, `amount`, `description`, `createdBy`. If your schema uses different field names (e.g., `fromAccountId` / `toAccountId`), adapt the field names — check `backend/prisma/schema.prisma` and grep for `model Transfer` to confirm before running.

- [ ] **Step 6: Run the test, verify it passes**

Run:

```bash
npx playwright test tests/e2e/sales/commissions.spec.ts -g "venta 100% cash" --reporter=list 2>&1 | tail -10
```

Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/saleService.js backend/src/middleware/validation.js tests/helpers/api.ts tests/e2e/sales/commissions.spec.ts
git commit -m "feat(commissions): saleService creates payables + transfers on cash sales

Inside the existing registerSale transaction, after the receivable
step, we now: calculate the commission base, resolve participants
(default = owner-self), create one COMMISSION Payable per participant
linked to a SaleParticipant row, and create the two Transfers
(reinvest + tax) proportional to the cash portion received."
```

---

## Task 7: saleService — non-cash sales: trade-in only and mixed

**Files:**
- Modify: `tests/e2e/sales/commissions.spec.ts`

No production-code changes — Task 6's logic already handles the cashRatio. We're adding test coverage.

- [ ] **Step 1: Write failing tests for non-cash variants**

Append to the describe block in `tests/e2e/sales/commissions.spec.ts`:

```typescript
  test('venta 100% cruce: crea CxP COMMISSION pero 0 transfers', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `CRU${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'TRADE_IN',
      buyerId: TEST_SEED_IDS.buyer,
      tradeIn: { plate: `RCV${Date.now().toString().slice(-6)}`, value: 30_000_000 },
    });

    expect(res.summary.commissionBase).toBe(10_000_000);
    expect(res.summary.cashRatioApplied).toBe(0);
    expect(res.summary.participants).toHaveLength(1);
    expect(res.summary.participants![0].amount).toBe(6_000_000); // CxP igual se causa
    expect(res.summary.transfers).toHaveLength(0);                // sin caja, sin transfer
  });

  test('venta mixed (cash + cruce): transfers proporcionales al cash', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `MIX${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    // Total: 30M (15M cash + 15M cruce) → cashRatio = 0.5
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'MIXED',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayments: [{ accountId: TEST_SEED_IDS.accountCash, amount: 15_000_000, method: 'CASH' }],
      tradeIn: { plate: `RCM${Date.now().toString().slice(-6)}`, value: 15_000_000 },
    });

    expect(res.summary.commissionBase).toBe(10_000_000);
    expect(res.summary.cashRatioApplied).toBeCloseTo(0.5, 5);
    expect(res.summary.transfers).toHaveLength(2);
    const reinvest = res.summary.transfers!.find(t => t.accountIdTo === 'budget-reinvest');
    const tax = res.summary.transfers!.find(t => t.accountIdTo === 'budget-tax');
    expect(reinvest?.amount).toBeCloseTo(1_500_000, 0);  // 3M × 0.5
    expect(tax?.amount).toBeCloseTo(500_000, 0);          // 1M × 0.5
  });
```

- [ ] **Step 2: Run, verify they pass**

Run:

```bash
npx playwright test tests/e2e/sales/commissions.spec.ts -g "cruce|mixed" --reporter=list 2>&1 | tail -10
```

Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/sales/commissions.spec.ts
git commit -m "test(commissions): cover trade-in and mixed sales

Trade-in only: COMMISSION payables created, zero transfers.
Mixed: transfers scaled by cashRatio."
```

---

## Task 8: saleService — loss handling

**Files:**
- Modify: `tests/e2e/sales/commissions.spec.ts`

No production changes — `calculateCommissionBase` already returns `skip: true` on loss, and saleService respects it. Test only.

- [ ] **Step 1: Write the failing test**

Append:

```typescript
  test('venta con pérdida: cero CxP, cero transfers, sin participants', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `LOSS${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 30_000_000,
      purchasePrice: 30_000_000,
      listedPrice: 25_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 25_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 25_000_000 },
    });

    expect(res.summary.commissionBase).toBeUndefined();
    expect(res.summary.participants).toBeUndefined();
    expect(res.summary.transfers).toBeUndefined();
  });
```

- [ ] **Step 2: Run, verify it passes**

Run:

```bash
npx playwright test tests/e2e/sales/commissions.spec.ts -g "p[eé]rdida" --reporter=list 2>&1 | tail -5
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/sales/commissions.spec.ts
git commit -m "test(commissions): cover loss case (commissionBase <= 0)"
```

---

## Task 9: saleService — custom participants and partner adjustment

**Files:**
- Modify: `tests/e2e/sales/commissions.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
  test('venta con participants[] custom: respeta split y valida suma 100', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `CST${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [
        { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
        { thirdPartyId: 'owner-self',           role: 'CERRADOR', sharePct: 70 },
      ],
    });
    expect(res.summary.participants).toHaveLength(2);
    const captador = res.summary.participants!.find(p => p.role === 'CAPTADOR');
    const cerrador = res.summary.participants!.find(p => p.role === 'CERRADOR');
    expect(captador?.amount).toBeCloseTo(1_800_000, 0); // 6M × 0.30
    expect(cerrador?.amount).toBeCloseTo(4_200_000, 0); // 6M × 0.70
  });

  test('participants[] con suma ≠ 100 devuelve 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `BAD${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    const res = await apiRequestRaw('POST', `/vehicles/${v.id}/sell`, token, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
      participants: [
        { thirdPartyId: TEST_SEED_IDS.employee, role: 'CAPTADOR', sharePct: 30 },
        { thirdPartyId: 'owner-self',           role: 'CERRADOR', sharePct: 50 }, // suma 80
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sumar 100|sharePct/i);
  });

  test('venta con socio 50%: base de comisión es mi parte (gross × 0.5)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `PRT${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
      partnerId: TEST_SEED_IDS.partner ?? TEST_SEED_IDS.supplier, // si no hay seed partner, reusar
      participation: 0.5,
    });
    const res = await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
    });
    // Gross profit global = 10M, mi parte = 10M × 0.5 = 5M
    expect(res.summary.commissionBase).toBe(5_000_000);
    expect(res.summary.commissionPool).toBe(3_000_000); // 60% de 5M
  });
```

Add import at top of file if not already there:

```typescript
import { apiRequestRaw } from '../../helpers/api';
```

- [ ] **Step 2: Confirm the partner test reference — check VehicleInput supports partnerId/participation**

Run:

```bash
grep -n "partnerId\|participation" /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project/tests/helpers/api.ts | head -5
```

If `VehicleInput` doesn't include `partnerId` and `participation`, extend it. Find the interface and add:

```typescript
  partnerId?: string;
  participation?: number;
```

If the seed doesn't include a partner third-party, either add one in `tests/helpers/db.ts` `seedAccountsAndParties` (as a 4th INSERT) and a `TEST_SEED_IDS.partner` constant, OR skip the participation field in the API call and force it via direct DB update before registerSale. Simplest: extend the seed. Edit `tests/global-setup.ts`:

```typescript
export const TEST_SEED_IDS = {
  accountCash: 'test-acc-cash',
  accountBank: 'test-acc-bank',
  supplier: 'test-tp-supplier',
  buyer: 'test-tp-buyer',
  employee: 'test-tp-employee',
  partner: 'test-tp-partner',
} as const;
```

And in `tests/helpers/db.ts` `seedAccountsAndParties`:

```typescript
  await client.query(
    `INSERT INTO third_parties (id, name, type, "isActive", "createdAt", "updatedAt")
     VALUES
       ($1, 'Proveedor Test', 'SUPPLIER', true, NOW(), NOW()),
       ($2, 'Cliente Test',   'CLIENT',   true, NOW(), NOW()),
       ($3, 'Empleado Test',  'EMPLOYEE', true, NOW(), NOW()),
       ($4, 'Socio Test',     'PARTNER',  true, NOW(), NOW())`,
    [TEST_SEED_IDS.supplier, TEST_SEED_IDS.buyer, TEST_SEED_IDS.employee, TEST_SEED_IDS.partner],
  );
```

- [ ] **Step 3: Run tests, verify they pass**

Run:

```bash
npx playwright test tests/e2e/sales/commissions.spec.ts -g "custom|≠ 100|socio" --reporter=list 2>&1 | tail -10
```

Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/sales/commissions.spec.ts tests/helpers/api.ts tests/global-setup.ts tests/helpers/db.ts
git commit -m "test(commissions): cover custom participants and partner-share

Custom participants[] respected with proportional pool split.
Sum-validation rejects bad payloads with 400.
Partner-share scenario verifies myProfit-based base."
```

---

## Task 10: cancelSale extension — block when commission payables or budget transfers exist

**Files:**
- Modify: `backend/src/services/saleService.js`
- Modify: `tests/e2e/sales/commissions.spec.ts`

- [ ] **Step 1: Write the failing test**

Append:

```typescript
  test('cancelSale bloqueado si hay Payables COMMISSION', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `CNX${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'CASH',
      buyerId: TEST_SEED_IDS.buyer,
      cashPayment: { accountId: TEST_SEED_IDS.accountCash, amount: 30_000_000 },
    });

    const res = await apiRequestRaw('POST', `/vehicles/${v.id}/cancel-sale`, token);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/comisi[oó]n|transferenc/i);
  });
```

- [ ] **Step 2: Confirm it fails (cancelSale today would throw a different message about transactions)**

Run:

```bash
npx playwright test tests/e2e/sales/commissions.spec.ts -g "cancelSale bloqueado" --reporter=list 2>&1 | tail -5
```

Expected: the test fails because the cancel returns 400 with the *existing* "transacciones registradas" error message instead of the commission one (since the cash transaction is created in step 2 of the saleService, it triggers the existing guard first). That's actually fine for the user — the cancel is blocked. But the test asserts the new message, so let's tighten the guard to also fire for cruce-only sales where no transactions exist.

Refine the test to use a trade-in-only sale (no cash transactions, so the existing guard doesn't fire, but the new commission guard does):

```typescript
  test('cancelSale bloqueado si hay Payables COMMISSION (incluso sin transacciones de caja)', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const v = await apiCreateVehicle(token, {
      plate: `CNX${Date.now().toString().slice(-6)}`,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });
    await apiRegisterSale(token, v.id, {
      salePrice: 30_000_000,
      paymentType: 'TRADE_IN',
      buyerId: TEST_SEED_IDS.buyer,
      tradeIn: { plate: `RXC${Date.now().toString().slice(-6)}`, value: 30_000_000 },
    });

    const res = await apiRequestRaw('POST', `/vehicles/${v.id}/cancel-sale`, token);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/comisi[oó]n/i);
  });
```

Run again. Expected: still fails — cancelSale doesn't yet check COMMISSION payables.

- [ ] **Step 3: Extend cancelSale**

Edit `backend/src/services/saleService.js`. Find the `cancelSale` function. After the existing `saleTransactions` check, add:

```javascript
  // Verificar si hay Payables COMMISSION asociadas
  const commissionPayables = await prisma.payable.findMany({
    where: { vehicleId, type: 'COMMISSION' },
  });
  if (commissionPayables.length > 0) {
    throw new AppError(
      'No se puede cancelar la venta porque hay comisiones devengadas. ' +
      'Anula o paga las CxP de comisión primero.',
      400
    );
  }

  // Verificar si hay Transfers asociadas a cuentas BUDGET (reinversión / impuestos)
  const cfg = await prisma.setting.findMany({
    where: { key: { in: ['reinvest_account_id', 'tax_reserve_account_id'] } },
  });
  const budgetAccountIds = cfg.map(s => s.value).filter(Boolean);
  if (budgetAccountIds.length > 0) {
    const budgetTransfers = await prisma.transfer.findMany({
      where: {
        accountIdTo: { in: budgetAccountIds },
        description: { contains: vehicle.plate },
      },
    });
    if (budgetTransfers.length > 0) {
      throw new AppError(
        'No se puede cancelar la venta porque hay transferencias a fondos de reinversión / impuestos. ' +
        'Reversa esas transferencias primero.',
        400
      );
    }
  }
```

- [ ] **Step 4: Run, verify it passes**

Run:

```bash
npx playwright test tests/e2e/sales/commissions.spec.ts -g "cancelSale bloqueado" --reporter=list 2>&1 | tail -5
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/saleService.js tests/e2e/sales/commissions.spec.ts
git commit -m "feat(commissions): cancelSale rejects when COMMISSION CxP or BUDGET transfers exist

Prevents leaving orphaned commission payables or transfers when a
sale is cancelled. The user must reverse those manually before
calling cancelSale."
```

---

## Task 11: UI — Accounts page shows BUDGET in its own section

**Files:**
- Modify: `frontend/src/pages/treasury/AccountsPage.jsx`

- [ ] **Step 1: Read the current AccountsPage to find the rendering pattern**

Run:

```bash
sed -n '1,60p' /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project/frontend/src/pages/treasury/AccountsPage.jsx
```

Look at how it iterates over accounts and renders them — find the loop that maps over the accounts array.

- [ ] **Step 2: Split the render into three sections**

Edit `frontend/src/pages/treasury/AccountsPage.jsx`. Replace the single accounts map with three filtered sections. The structure should look like (adapt to the existing render skeleton):

```jsx
const cashAccounts   = accounts.filter(a => a.type === 'CASH');
const bankAccounts   = accounts.filter(a => a.type === 'BANK');
const budgetAccounts = accounts.filter(a => a.type === 'BUDGET');

// In the render:
<div className="space-y-6">
  {cashAccounts.length > 0 && (
    <div>
      <h3 className="text-sm font-semibold text-[#8B949E] mb-2">💵 Efectivo</h3>
      {/* existing card render for each cashAccount */}
    </div>
  )}
  {bankAccounts.length > 0 && (
    <div>
      <h3 className="text-sm font-semibold text-[#8B949E] mb-2">🏦 Bancos</h3>
      {/* existing card render for each bankAccount */}
    </div>
  )}
  {budgetAccounts.length > 0 && (
    <div>
      <h3 className="text-sm font-semibold text-[#BC8CFF] mb-2">🎯 Fondos / Reservas</h3>
      <p className="text-[11px] text-[#6E7681] mb-2">
        Estas cuentas no son operativas: guardan los aportes automáticos de cada venta (reinversión, impuestos).
      </p>
      {/* existing card render for each budgetAccount */}
    </div>
  )}
</div>
```

The exact JSX structure depends on the existing render — preserve the per-card markup, only group by type.

- [ ] **Step 3: Manual verification (no e2e test needed for visual grouping)**

Run the frontend dev server briefly to sanity-check the page renders without errors:

```bash
cd frontend && npm run dev &
DEV_PID=$!
sleep 8
curl -s http://localhost:5173 > /dev/null && echo "FRONTEND OK"
kill $DEV_PID 2>/dev/null
```

Expected: `FRONTEND OK`.

Or visit `http://localhost:5173/treasury/accounts` in the browser and confirm the new "Fondos / Reservas" section appears with the two BUDGET accounts.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/treasury/AccountsPage.jsx
git commit -m "feat(commissions): accounts page groups BUDGET accounts separately

CASH, BANK, BUDGET each get their own labelled section so users
don't confuse the reinvest/tax reserves with operative accounts."
```

---

## Task 12: UI — SettingsPage gets "Comisiones y bolsillos" card

**Files:**
- Modify: `frontend/src/pages/SettingsPage.jsx`

- [ ] **Step 1: Add the commission config card to SettingsPage**

Edit `frontend/src/pages/SettingsPage.jsx`. After the existing "Configuración del Negocio" card, before the password change card, add a new card. Also add the API call at the top.

At the top of the component, alongside other useState:

```jsx
import { useEffect, useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/shared/FormFields';
import api from '@/lib/api'; // existing axios instance — verify the import path

// ... inside the component:
const [commCfg, setCommCfg] = useState(null);
const [commError, setCommError] = useState('');
const [commSuccess, setCommSuccess] = useState(false);

useEffect(() => {
  api.get('/settings/commission-config').then(r => setCommCfg(r.data)).catch(() => {});
}, []);

const handleSaveCommissions = async () => {
  setCommError(''); setCommSuccess(false);
  const bucketSum = Number(commCfg.commission_share_pct) + Number(commCfg.reinvest_share_pct) + Number(commCfg.tax_share_pct);
  if (Math.abs(bucketSum - 100) > 0.001) { setCommError('Los tres bolsillos deben sumar 100'); return; }
  const splitSum = Number(commCfg.default_captador_pct) + Number(commCfg.default_cerrador_pct);
  if (Math.abs(splitSum - 100) > 0.001) { setCommError('Captador + cerrador deben sumar 100'); return; }
  try {
    await api.put('/settings/commission-config', commCfg);
    setCommSuccess(true);
  } catch (err) {
    setCommError(err.response?.data?.error || 'Error al guardar');
  }
};
```

Then in the JSX, after the existing first card:

```jsx
{commCfg && (
  <div className="card" data-testid="settings-commissions-card">
    <div className="card-title">Comisiones y bolsillos</div>
    <p className="text-xs text-[#6E7681] mb-3">
      Cómo se reparte la ganancia bruta de cada venta. Los tres porcentajes deben sumar 100.
    </p>
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Input label="Comisiones %" type="number" value={commCfg.commission_share_pct}
          onChange={e => setCommCfg({ ...commCfg, commission_share_pct: e.target.value })}
          data-testid="settings-commission-pct" />
        <Input label="Reinversión %" type="number" value={commCfg.reinvest_share_pct}
          onChange={e => setCommCfg({ ...commCfg, reinvest_share_pct: e.target.value })}
          data-testid="settings-reinvest-pct" />
        <Input label="Impuestos %" type="number" value={commCfg.tax_share_pct}
          onChange={e => setCommCfg({ ...commCfg, tax_share_pct: e.target.value })}
          data-testid="settings-tax-pct" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Captador % (default)" type="number" value={commCfg.default_captador_pct}
          onChange={e => setCommCfg({ ...commCfg, default_captador_pct: e.target.value })}
          data-testid="settings-captador-pct" />
        <Input label="Cerrador % (default)" type="number" value={commCfg.default_cerrador_pct}
          onChange={e => setCommCfg({ ...commCfg, default_cerrador_pct: e.target.value })}
          data-testid="settings-cerrador-pct" />
      </div>
      <div className="text-xs text-[#8B949E]">
        Fondo Reinversión: <span className="text-[#E6EDF3] font-mono">{commCfg.reinvest_account?.name || commCfg.reinvest_account_id}</span>
        {' · '}
        Reserva Impuestos: <span className="text-[#E6EDF3] font-mono">{commCfg.tax_reserve_account?.name || commCfg.tax_reserve_account_id}</span>
      </div>
      {commError && <div className="text-[12px] text-red-400">{commError}</div>}
      {commSuccess && <div className="text-[12px] text-green-400">Guardado.</div>}
      <button onClick={handleSaveCommissions} className="btn-primary" data-testid="settings-save-commissions">
        Guardar configuración de comisiones
      </button>
    </div>
  </div>
)}
```

Note: verify the import path for the axios instance. Find it with `grep -n "from '@/lib/api'" /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project/frontend/src/pages/*.jsx`. Use the same import used by other pages.

- [ ] **Step 2: Add an e2e test for the page**

Append to `tests/e2e/sales/commissions.spec.ts`:

```typescript
  test('SettingsPage muestra y guarda comisiones (ADMIN)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/settings');
    await expect(page.getByTestId('settings-commissions-card')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('settings-commission-pct')).toHaveValue('60');
    await page.getByTestId('settings-commission-pct').fill('55');
    await page.getByTestId('settings-reinvest-pct').fill('35');
    await page.getByTestId('settings-save-commissions').click();
    await expect(page.getByText('Guardado.')).toBeVisible({ timeout: 5_000 });

    // Restaurar defaults
    await page.getByTestId('settings-commission-pct').fill('60');
    await page.getByTestId('settings-reinvest-pct').fill('30');
    await page.getByTestId('settings-save-commissions').click();
  });
```

- [ ] **Step 3: Run the test**

Run:

```bash
npx playwright test tests/e2e/sales/commissions.spec.ts -g "SettingsPage muestra" --reporter=list 2>&1 | tail -10
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SettingsPage.jsx tests/e2e/sales/commissions.spec.ts
git commit -m "feat(commissions): SettingsPage card to configure buckets and split

Admin-only. Validates the two sum-to-100 constraints client-side
before posting. Shows the linked BUDGET account names for context."
```

---

## Task 13: Final regression + PR

- [ ] **Step 1: Full e2e suite green**

Run:

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project && npx playwright test --reporter=list 2>&1 | tail -10
```

Expected: all tests pass (existing + new). If something pre-existing fails, fix before continuing.

- [ ] **Step 2: Full backend unit tests green**

Run:

```bash
cd backend && node --test src/utils/__tests__/financial.test.js 2>&1 | tail -10
```

Expected: all unit tests pass.

- [ ] **Step 3: Push and open PR**

```bash
git push origin dev
gh pr create --base main --head dev --title "feat(commissions): Phase 1 — infrastructure for buckets and seller payables" --body "$(cat <<'EOF'
## Summary

Implements Phase 1 of the commission system per the design in
\`docs/superpowers/specs/2026-06-04-commissions-phase-1-design.md\`.

Each registered sale (with positive commission base) now:
1. Splits gross profit into three configurable buckets (commissions
   60% / reinvest 30% / tax 10% by default).
2. Creates one COMMISSION Payable per participant (default: the seeded
   \"Dueño / Yo\" ThirdParty unless \`participants[]\` is provided).
3. Transfers cash-proportional amounts to two dedicated BUDGET-type
   treasury accounts (Fondo Reinversión and Reserva Impuestos).

Vehicles with partner use \"my profit\" (gross × participation) as the
base. Loss sales (base ≤ 0) skip everything. Cancelling a sale is now
blocked if commission payables or budget transfers exist.

Settings management is exposed via \`GET/PUT /settings/commission-config\`
(admin-only) and a new card in SettingsPage. Account list groups the
new BUDGET accounts in their own section.

## What's NOT in this PR

- Participants picker UI inside the sale modal (Phase 2)
- Projection dashboard (Phase 3)
- Goals + leaderboard + historical reports (Phase 4)

## Migration

A single Prisma migration adds three enum values, the
\`sale_participants\` table, two BUDGET accounts, the default-fallback
ThirdParty, and the seven Settings rows.

No backfill of historical sales is performed (deliberate — see spec).

## Test plan

- [x] Local: 13+ new E2E tests in \`tests/e2e/sales/commissions.spec.ts\`
- [x] Local: 5 new unit tests for \`calculateCommissionBase\`
- [x] Local: full suite green
- [ ] Production: \`git pull && ./scripts/deploy.sh\` runs the migration
- [ ] Production: open Settings → Comisiones y bolsillos → verify defaults loaded
- [ ] Production: verify Treasury → Accounts shows the new Fondos/Reservas section
- [ ] Production: register a small test sale and confirm CxP + transfers appear

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Mark plan complete**

The plan is done when:
- All tasks above show ✅
- PR is opened and assigned for review
- No pending checkpoints from previous tasks remain unresolved

---

## Implementation notes for the engineer

- **Order matters.** Tasks 1–10 are backend-only; Tasks 11–12 are frontend. The backend tasks have hard dependencies (Task 5 depends on Task 1's schema; Task 6 depends on Task 5's service; etc.). Don't reorder unless you fully understand the deps.
- **TDD discipline.** Every task with a code change has the test step first. Don't skip running the failing test before writing the implementation — confirming the RED state catches setup bugs early.
- **Don't refactor `saleService.registerSale` in this PR.** It's already 100+ lines and Task 6 adds another ~80. After this PR ships, a follow-up PR can extract the commission step into a dedicated function. Doing both in this PR is too much churn.
- **Money math.** All amounts are `Decimal(15,2)` in DB. JavaScript multiplies them as Numbers, which loses precision for very large amounts. For the COP range we're dealing with (max ~100M per sale), `Number` is safe. Don't introduce a Decimal library — it's overkill for this scope.
- **Idempotent migration.** All `INSERT` statements in the migration use `ON CONFLICT DO NOTHING`, so re-running the migration in a dev DB that already has the seeds doesn't break anything.
- **Stripping unknown fields.** The Joi schema for `vehicleSaleSchema` uses `stripUnknown: true` globally. If you add `participants[]` validation, make sure the schema entry uses `Joi.array().items(Joi.object({...}))` rather than `Joi.any()` — otherwise the array contents won't be validated.
