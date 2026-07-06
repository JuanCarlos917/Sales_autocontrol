# Reverso de movimientos manuales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que un ADMIN reverse un movimiento de tesorería manual creando un movimiento compensatorio inmutable, con motivo obligatorio e identificador corto visible.

**Architecture:** Sigue la política de inmutabilidad vigente (no se borra: se compensa). Se agrega una categoría `MANUAL_REVERSAL`, lógica pura de reversibilidad en un util, un método de servicio que crea el compensatorio dentro de `prisma.$transaction` + audit log, un endpoint admin-only, y UI en `TransactionsPage` con botón "Reversar" + modal de motivo + badge "Reversado".

**Tech Stack:** Node.js + Express + Prisma + PostgreSQL (backend, CommonJS), React 18 + Vite + Tailwind (frontend, ESM), node:test (unit), Playwright (e2e).

## Global Constraints

- Backend en CommonJS (`require`), no ES Modules.
- Validación con Joi (schemas en `backend/src/middleware/validation.js`).
- Patrón Controller → Service → Prisma. Sin lógica de negocio en controllers.
- Moneda COP sin decimales; UI en español, código en inglés.
- Movimientos inmutables: NO reintroducir `DELETE`. El reverso crea un compensatorio, no borra.
- Motivo obligatorio mínimo 10 caracteres (reusar `schemas.treasuryDestructive`).
- Solo ADMIN ejecuta el reverso.
- Identificador corto = `#${id.slice(-6)}` (convención ya usada en `TransactionsPage.jsx:59`).
- Unit tests con node:test (`require('node:test')` + `node:assert/strict`). Se corren con `npm test` en `/backend` (`node --test src/`).
- E2E con Playwright en `tests/e2e/treasury/`. Helpers en `tests/helpers/api.ts`, auth en `tests/fixtures/auth.ts`, seed ids en `tests/global-setup.ts`, util de rol en `tests/helpers/db.ts`.

---

### Task 1: Migración — categoría `MANUAL_REVERSAL`

**Files:**
- Modify: `backend/prisma/schema.prisma` (enum `TransactionCategory`, ~líneas 360-379)
- Create: `backend/prisma/migrations/<timestamp>_add_manual_reversal_category/migration.sql` (lo genera Prisma)

**Interfaces:**
- Produces: el valor de enum `MANUAL_REVERSAL` disponible para `Transaction.category`.

- [ ] **Step 1: Agregar el valor al enum en el schema**

En `backend/prisma/schema.prisma`, dentro de `enum TransactionCategory`, agregar la última línea antes del `}`:

```prisma
enum TransactionCategory {
  VEHICLE_PURCHASE
  VEHICLE_SALE
  VEHICLE_SALE_PARTIAL
  VEHICLE_EXPENSE
  FIXED_EXPENSE
  OPERATING_EXPENSE
  COMMISSION
  CAPITAL_CONTRIBUTION
  OTHER_INCOME
  OTHER_EXPENSE
  TRANSFER
  LOAN_DISBURSEMENT
  LOAN_REPAYMENT
  LOAN_EXTRA_INCOME
  LOAN_INTEREST_INCOME
  DEBT_PAYMENT
  EXPENSE_ADJUSTMENT
  EXPENSE_REVERSAL
  MANUAL_REVERSAL
}
```

- [ ] **Step 2: Generar la migración**

Run: `cd backend && npx prisma migrate dev --name add_manual_reversal_category`
Expected: crea la carpeta de migración con `ALTER TYPE "TransactionCategory" ADD VALUE 'MANUAL_REVERSAL';`, aplica a la DB local y regenera el cliente Prisma sin errores.

- [ ] **Step 3: Verificar estado**

Run: `cd backend && npx prisma migrate status`
Expected: "Database schema is up to date!" sin migraciones pendientes.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(treasury): categoría MANUAL_REVERSAL para reverso de movimientos"
```

---

### Task 2: Lógica pura de reversibilidad (TDD)

**Files:**
- Create: `backend/src/utils/transactionReversal.js`
- Test: `backend/src/utils/__tests__/transactionReversal.test.js`

**Interfaces:**
- Produces:
  - `getReversibilityError(tx)` → `null` si es reversable, o `{ status: number, message: string }`.
    `tx` shape: `{ type, expenseId, loanId, loanPaymentId, debtId, transferId, reversesTransactionId, hasPayablePayment: boolean, alreadyReversed: boolean }`.
  - `buildReversalData(original, userId, reason)` → objeto `data` para `prisma.transaction.create` (tipo invertido, `category: 'MANUAL_REVERSAL'`, `reversesTransactionId`, `description`, `createdBy`).
  - Constantes exportadas: `LINKED_FIELDS` (array), `MANUAL_REVERSAL` (string).

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/src/utils/__tests__/transactionReversal.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getReversibilityError,
  buildReversalData,
  MANUAL_REVERSAL,
} = require('../transactionReversal');

const manualIncome = {
  type: 'INCOME',
  expenseId: null,
  loanId: null,
  loanPaymentId: null,
  debtId: null,
  transferId: null,
  reversesTransactionId: null,
  hasPayablePayment: false,
  alreadyReversed: false,
};

test('getReversibilityError: movimiento manual es reversable (null)', () => {
  assert.equal(getReversibilityError(manualIncome), null);
});

test('getReversibilityError: ligado a gasto → 403', () => {
  const err = getReversibilityError({ ...manualIncome, expenseId: 'exp1' });
  assert.equal(err.status, 403);
});

test('getReversibilityError: ligado a préstamo → 403', () => {
  const err = getReversibilityError({ ...manualIncome, loanPaymentId: 'lp1' });
  assert.equal(err.status, 403);
});

test('getReversibilityError: ligado a pago de payable → 403', () => {
  const err = getReversibilityError({ ...manualIncome, hasPayablePayment: true });
  assert.equal(err.status, 403);
});

test('getReversibilityError: ya reversado → 409', () => {
  const err = getReversibilityError({ ...manualIncome, alreadyReversed: true });
  assert.equal(err.status, 409);
});

test('getReversibilityError: es a su vez un reverso → 400', () => {
  const err = getReversibilityError({ ...manualIncome, reversesTransactionId: 'orig1' });
  assert.equal(err.status, 400);
});

test('getReversibilityError: tipo no INCOME/EXPENSE → 403', () => {
  const err = getReversibilityError({ ...manualIncome, type: 'TRANSFER_IN' });
  assert.equal(err.status, 403);
});

test('buildReversalData: invierte INCOME a EXPENSE y conserva monto/cuenta', () => {
  const original = { id: 'ckabcdef123456', accountId: 'acc1', type: 'INCOME', amount: '50000', vehicleId: null, thirdPartyId: null };
  const data = buildReversalData(original, 'user1', 'corrección de monto erróneo');
  assert.equal(data.type, 'EXPENSE');
  assert.equal(data.amount, '50000');
  assert.equal(data.accountId, 'acc1');
  assert.equal(data.category, MANUAL_REVERSAL);
  assert.equal(data.reversesTransactionId, 'ckabcdef123456');
  assert.equal(data.createdBy, 'user1');
  assert.match(data.description, /#123456/);
  assert.match(data.description, /corrección de monto erróneo/);
});

test('buildReversalData: invierte EXPENSE a INCOME', () => {
  const original = { id: 'x000001', accountId: 'acc1', type: 'EXPENSE', amount: '10000', vehicleId: null, thirdPartyId: null };
  const data = buildReversalData(original, 'user1', 'motivo suficientemente largo');
  assert.equal(data.type, 'INCOME');
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && node --test src/utils/__tests__/transactionReversal.test.js`
Expected: FAIL — `Cannot find module '../transactionReversal'`.

- [ ] **Step 3: Implementar el módulo**

Crear `backend/src/utils/transactionReversal.js`:

```javascript
// ═══════════════════════════════════════════════════════════════
// Util — Reverso de movimientos manuales (lógica pura, sin Prisma)
//
// Un movimiento es reversable solo si es manual: sin entidad ligada,
// no es a su vez un reverso, y no fue reversado antes. El reverso crea
// un movimiento compensatorio (tipo invertido) — nunca borra.
// ═══════════════════════════════════════════════════════════════

const LINKED_FIELDS = ['expenseId', 'loanId', 'loanPaymentId', 'debtId', 'transferId'];
const MANUAL_REVERSAL = 'MANUAL_REVERSAL';

/**
 * @param {{ type:string, expenseId?:string, loanId?:string, loanPaymentId?:string,
 *   debtId?:string, transferId?:string, reversesTransactionId?:string,
 *   hasPayablePayment:boolean, alreadyReversed:boolean }} tx
 * @returns {{ status:number, message:string } | null}
 */
function getReversibilityError(tx) {
  if (tx.reversesTransactionId) {
    return { status: 400, message: 'Un reverso o ajuste no se puede reversar.' };
  }
  if (tx.alreadyReversed) {
    return { status: 409, message: 'Este movimiento ya fue reversado.' };
  }
  if (tx.hasPayablePayment || LINKED_FIELDS.some((f) => tx[f])) {
    return {
      status: 403,
      message: 'Este movimiento proviene de otra operación (gasto, préstamo, pago o transferencia) y no se puede reversar directamente.',
    };
  }
  if (tx.type !== 'INCOME' && tx.type !== 'EXPENSE') {
    return { status: 403, message: 'Solo se pueden reversar ingresos o egresos manuales.' };
  }
  return null;
}

/**
 * Construye el `data` del movimiento compensatorio.
 * @param {{ id:string, accountId:string, type:string, amount:any, vehicleId?:string, thirdPartyId?:string }} original
 * @param {string} userId
 * @param {string} reason
 */
function buildReversalData(original, userId, reason) {
  const flippedType = original.type === 'INCOME' ? 'EXPENSE' : 'INCOME';
  const ref = `#${String(original.id).slice(-6)}`;
  return {
    accountId: original.accountId,
    type: flippedType,
    category: MANUAL_REVERSAL,
    amount: original.amount,
    description: `Reverso de ${ref} — ${reason}`,
    reversesTransactionId: original.id,
    vehicleId: original.vehicleId ?? null,
    thirdPartyId: original.thirdPartyId ?? null,
    createdBy: userId,
  };
}

module.exports = { LINKED_FIELDS, MANUAL_REVERSAL, getReversibilityError, buildReversalData };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd backend && node --test src/utils/__tests__/transactionReversal.test.js`
Expected: PASS — todos los tests en verde.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/transactionReversal.js backend/src/utils/__tests__/transactionReversal.test.js
git commit -m "feat(treasury): lógica pura de reversibilidad de movimientos"
```

---

### Task 3: Endpoint de reverso (service + controller + route + validación)

**Files:**
- Modify: `backend/src/services/transactionService.js` (agregar `reverse` y ampliar `TRANSACTION_INCLUDE`)
- Modify: `backend/src/controllers/transactionController.js` (agregar `reverse` + export)
- Modify: `backend/src/routes/treasury.js` (importar `authorize`, agregar ruta)
- Create: `tests/e2e/treasury/transaction-reverse-api.spec.ts`
- Modify: `tests/helpers/api.ts` (helper `apiReverseTransactionRaw`)

**Interfaces:**
- Consumes: `getReversibilityError`, `buildReversalData` de `../utils/transactionReversal`; `writeTreasuryAudit`, `snapshotEntity` de `../utils/treasuryAudit`; `schemas.treasuryDestructive`; `authorize` de `../middleware/auth`.
- Produces:
  - `transactionService.reverse(id, reason, userId)` → la `Transaction` compensatoria (con `TRANSACTION_INCLUDE`).
  - `POST /treasury/transactions/:id/reverse` (admin-only, body `{ reason }`) → 201 + compensatorio.
  - Frontend (Task 4) consume `tx.reversedBy` (array) y `tx.payablePayment` (objeto|null) agregados a `TRANSACTION_INCLUDE`.

- [ ] **Step 1: Escribir el helper de e2e y el spec de API que falla**

En `tests/helpers/api.ts`, agregar al final del archivo:

```typescript
export async function apiReverseTransactionRaw(
  token: string,
  id: string,
  body: { reason?: string },
): Promise<{ status: number; body: { error?: string; id?: string; type?: string; category?: string; reversesTransactionId?: string; amount?: string } | null }> {
  return apiRequestRaw('POST', `/treasury/transactions/${id}/reverse`, token, body);
}
```

Crear `tests/e2e/treasury/transaction-reverse-api.spec.ts`:

```typescript
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiCreateTreasuryIncome,
  apiReverseTransactionRaw,
  apiRequestRaw,
} from '../../helpers/api';
import { setUserRole } from '../../helpers/db';
import { TEST_SEED_IDS } from '../../global-setup';

const ADMIN_EMAIL = 'admin@autocontrol.co';
const VALID_REASON = 'corrección: el monto fue digitado mal';

test.describe('Tesorería — reverso de movimientos manuales (API)', () => {
  test('happy path: crea compensatorio con tipo invertido y MANUAL_REVERSAL', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 80_000,
      description: 'ingreso a reversar',
    });

    const res = await apiReverseTransactionRaw(token, income.id, { reason: VALID_REASON });
    expect(res.status).toBe(201);
    expect(res.body?.type).toBe('EXPENSE');
    expect(res.body?.category).toBe('MANUAL_REVERSAL');
    expect(res.body?.reversesTransactionId).toBe(income.id);
  });

  test('doble reverso → 409', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 70_000,
      description: 'ingreso a reversar una sola vez',
    });
    const first = await apiReverseTransactionRaw(token, income.id, { reason: VALID_REASON });
    expect(first.status).toBe(201);
    const second = await apiReverseTransactionRaw(token, income.id, { reason: VALID_REASON });
    expect(second.status).toBe(409);
  });

  test('reversar un reverso → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 60_000,
      description: 'ingreso cuyo reverso intentaremos reversar',
    });
    const rev = await apiReverseTransactionRaw(token, income.id, { reason: VALID_REASON });
    expect(rev.status).toBe(201);
    const again = await apiReverseTransactionRaw(token, rev.body!.id as string, { reason: VALID_REASON });
    expect(again.status).toBe(400);
  });

  test('id inexistente → 404', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const res = await apiReverseTransactionRaw(token, 'no-existe-id', { reason: VALID_REASON });
    expect(res.status).toBe(404);
  });

  test('motivo corto (<10) → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 50_000,
      description: 'ingreso con motivo corto',
    });
    const res = await apiReverseTransactionRaw(token, income.id, { reason: 'corto' });
    expect(res.status).toBe(400);
  });

  test('movimiento ligado a transferencia → 403', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const transferRes = await apiRequestRaw('POST', '/treasury/transfers', token, {
      fromAccountId: TEST_SEED_IDS.accountCash,
      toAccountId: TEST_SEED_IDS.accountBank,
      amount: 40_000,
      description: 'transfer para verificar 403 en reverse',
    });
    expect(transferRes.status).toBeLessThan(400);

    const listRes = await apiRequestRaw('GET', '/treasury/transactions?type=TRANSFER_OUT', token);
    const linked = (listRes.body as unknown as { transactions: Array<{ id: string; transferId: string | null }> })
      .transactions.find((t) => t.transferId);
    expect(linked).toBeTruthy();

    const res = await apiReverseTransactionRaw(token, linked!.id, { reason: VALID_REASON });
    expect(res.status).toBe(403);
  });

  test('no admin → 403', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 30_000,
      description: 'ingreso para verificar guard de rol',
    });
    try {
      await setUserRole(ADMIN_EMAIL, 'SUPERVISOR');
      const supervisorToken = await loginAsAdmin(page);
      const res = await apiReverseTransactionRaw(supervisorToken, income.id, { reason: VALID_REASON });
      expect(res.status).toBe(403);
    } finally {
      await setUserRole(ADMIN_EMAIL, 'ADMIN');
    }
  });
});
```

- [ ] **Step 2: Correr el spec para verificar que falla**

Run: `npx playwright test tests/e2e/treasury/transaction-reverse-api.spec.ts`
Expected: FAIL — el endpoint responde 404 (ruta inexistente) en el happy path.

- [ ] **Step 3: Ampliar `TRANSACTION_INCLUDE` y agregar `reverse` al service**

En `backend/src/services/transactionService.js`:

Agregar imports tras la línea 7 (`const accountService = require('./accountService');`):

```javascript
const { getReversibilityError, buildReversalData } = require('../utils/transactionReversal');
const { writeTreasuryAudit, snapshotEntity } = require('../utils/treasuryAudit');
```

Ampliar `TRANSACTION_INCLUDE` (objeto en líneas 12-19) agregando dos relaciones:

```javascript
const TRANSACTION_INCLUDE = {
  account: { select: { id: true, name: true, type: true } },
  thirdParty: { select: { id: true, name: true, type: true } },
  vehicle: { select: { id: true, plate: true, brand: true, model: true } },
  reversesTransaction: {
    select: { id: true, category: true, amount: true, date: true, accountId: true },
  },
  reversedBy: { select: { id: true } },
  payablePayment: { select: { id: true } },
};
```

Agregar el método `reverse` dentro de la clase `TransactionService`, justo después de `update` (antes de `getSummary`):

```javascript
  async reverse(id, reason, userId) {
    const original = await prisma.transaction.findUnique({
      where: { id },
      include: {
        reversedBy: { select: { id: true }, take: 1 },
        payablePayment: { select: { id: true } },
      },
    });
    if (!original) throw new AppError('Movimiento no encontrado', 404);

    const error = getReversibilityError({
      type: original.type,
      expenseId: original.expenseId,
      loanId: original.loanId,
      loanPaymentId: original.loanPaymentId,
      debtId: original.debtId,
      transferId: original.transferId,
      reversesTransactionId: original.reversesTransactionId,
      hasPayablePayment: Boolean(original.payablePayment),
      alreadyReversed: original.reversedBy.length > 0,
    });
    if (error) throw new AppError(error.message, error.status);

    const data = buildReversalData(original, userId, reason);

    return prisma.$transaction(async (tx) => {
      const compensating = await tx.transaction.create({ data, include: TRANSACTION_INCLUDE });
      await writeTreasuryAudit(tx, {
        entityType: 'TRANSACTION',
        entityId: compensating.id,
        userId,
        action: 'CREATE',
        after: snapshotEntity(compensating, ['id', 'accountId', 'type', 'category', 'amount', 'reversesTransactionId']),
        reason,
      });
      return compensating;
    });
  }
```

- [ ] **Step 4: Agregar el controller**

En `backend/src/controllers/transactionController.js`, agregar la función tras `update` y antes de `getSummary`:

```javascript
const reverse = async (req, res, next) => {
  try {
    const transaction = await transactionService.reverse(req.params.id, req.body.reason, req.user.id);
    res.status(201).json(transaction);
  } catch (err) { next(err); }
};
```

Y agregar `reverse` al `module.exports`:

```javascript
module.exports = { getAll, getOne, getByVehicle, createIncome, createExpense, update, reverse, getSummary };
```

- [ ] **Step 5: Agregar la ruta admin-only**

En `backend/src/routes/treasury.js`, cambiar el import de validation (línea 6) por:

```javascript
const { validate, schemas } = require('../middleware/validation');
const { authorize } = require('../middleware/auth');
```

Agregar la ruta inmediatamente después de la línea `router.put('/transactions/:id', ...)` (línea 59):

```javascript
router.post('/transactions/:id/reverse', authorize('ADMIN'), validate(schemas.treasuryDestructive), transactionCtrl.reverse);
```

- [ ] **Step 6: Correr el spec para verificar que pasa**

Run: `npx playwright test tests/e2e/treasury/transaction-reverse-api.spec.ts`
Expected: PASS — los 7 tests en verde.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/transactionService.js backend/src/controllers/transactionController.js backend/src/routes/treasury.js tests/e2e/treasury/transaction-reverse-api.spec.ts tests/helpers/api.ts
git commit -m "feat(treasury): endpoint admin POST /transactions/:id/reverse"
```

---

### Task 4: UI de reverso en TransactionsPage

**Files:**
- Modify: `frontend/src/lib/treasuryApi.js` (`transactionsApi.reverse`)
- Modify: `frontend/src/pages/treasury/TransactionsPage.jsx` (botón, modal, badge, columna ID)
- Create: `tests/e2e/treasury/transaction-reverse-ui.spec.ts`

**Interfaces:**
- Consumes: `transactionsApi.reverse(id, reason)` → `POST /treasury/transactions/:id/reverse`; campos `tx.reversedBy`, `tx.payablePayment`, `tx.reversesTransactionId`, `tx.expenseId`, `tx.loanId`, `tx.loanPaymentId`, `tx.debtId`, `tx.transferId` (ya presentes en la respuesta de `getAll` tras Task 3).
- Produces: testids `tx-reverse-<id>`, `reverse-modal`, `reverse-reason`, `reverse-confirm`, `reversed-badge-<id>`.

- [ ] **Step 1: Escribir el spec de UI que falla**

Crear `tests/e2e/treasury/transaction-reverse-ui.spec.ts`:

```typescript
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateTreasuryIncome } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — reverso de movimientos (UI admin)', () => {
  test('admin reversa un ingreso y aparece el badge Reversado', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const income = await apiCreateTreasuryIncome(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 150_000,
      description: 'ingreso a reversar desde UI',
    });

    await page.goto('/treasury/transactions');
    const reverseBtn = page.locator(`[data-testid="tx-reverse-${income.id}"]`);
    await expect(reverseBtn).toBeVisible({ timeout: 10_000 });
    await reverseBtn.click();

    const modal = page.locator('[data-testid="reverse-modal"]');
    await expect(modal).toBeVisible();

    const confirm = page.locator('[data-testid="reverse-confirm"]');
    await expect(confirm).toBeDisabled();

    await page.locator('[data-testid="reverse-reason"]').fill('corrección: monto digitado por error');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.locator(`[data-testid="reversed-badge-${income.id}"]`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="origin-badge-MANUAL_REVERSAL"]').first()).toBeVisible();
  });
});
```

- [ ] **Step 2: Correr el spec para verificar que falla**

Run: `npx playwright test tests/e2e/treasury/transaction-reverse-ui.spec.ts`
Expected: FAIL — no existe `[data-testid="tx-reverse-..."]`.

- [ ] **Step 3: Agregar el método al API client**

En `frontend/src/lib/treasuryApi.js`, dentro de `transactionsApi`, reemplazar el bloque de comentario de inmutabilidad (líneas 36-37) por el método más el comentario actualizado:

```javascript
export const transactionsApi = {
  getAll: (params) => api.get('/treasury/transactions', { params }),
  getOne: (id) => api.get(`/treasury/transactions/${id}`),
  getSummary: (params) => api.get('/treasury/transactions/summary', { params }),
  getByVehicle: (vehicleId) => api.get(`/treasury/transactions/vehicle/${vehicleId}`),
  createIncome: (data) => api.post('/treasury/transactions/income', data),
  createExpense: (data) => api.post('/treasury/transactions/expense', data),
  update: (id, data) => api.put(`/treasury/transactions/${id}`, data),
  // Movimientos inmutables: no hay delete. La corrección admin es el reverso,
  // que crea un movimiento compensatorio (no borra).
  reverse: (id, reason) => api.post(`/treasury/transactions/${id}/reverse`, { reason }),
};
```

- [ ] **Step 4: Agregar etiqueta y badge de MANUAL_REVERSAL**

En `frontend/src/pages/treasury/TransactionsPage.jsx`:

Agregar la etiqueta en `CATEGORY_LABELS` (tras la línea 39 `EXPENSE_REVERSAL: 'Reverso de Gasto',`):

```javascript
  EXPENSE_REVERSAL: 'Reverso de Gasto',
  MANUAL_REVERSAL: 'Reverso de Movimiento',
```

Agregar la entrada en `ORIGIN_BADGE` (tras el bloque `EXPENSE_REVERSAL` que cierra en la línea 56):

```javascript
  EXPENSE_REVERSAL: {
    label: 'Reverso',
    className: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  },
  MANUAL_REVERSAL: {
    label: 'Reverso',
    className: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  },
```

- [ ] **Step 5: Agregar estado, helper y handler de reverso**

En `TransactionsPage.jsx`, reemplazar la línea 62-63:

```javascript
  const { role } = useAuth();
  const isViewer = role === 'VIEWER';
```

por:

```javascript
  const { role } = useAuth();
  const isViewer = role === 'VIEWER';
  const isAdmin = role === 'ADMIN';
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reverseReason, setReverseReason] = useState('');

  const LINKED_FIELDS = ['expenseId', 'loanId', 'loanPaymentId', 'debtId', 'transferId'];
  const canReverse = (tx) =>
    isAdmin &&
    (tx.type === 'INCOME' || tx.type === 'EXPENSE') &&
    !tx.reversesTransactionId &&
    !tx.payablePayment &&
    !LINKED_FIELDS.some((f) => tx[f]) &&
    !(tx.reversedBy && tx.reversedBy.length > 0);

  const isReversed = (tx) => tx.reversedBy && tx.reversedBy.length > 0;

  const openReverseModal = (tx) => {
    setReverseTarget(tx);
    setReverseReason('');
  };

  const handleReverse = async () => {
    if (!reverseTarget || reverseReason.trim().length < 10) return;
    try {
      await transactionsApi.reverse(reverseTarget.id, reverseReason.trim());
      setReverseTarget(null);
      setReverseReason('');
      loadTransactions();
      loadAccounts();
    } catch (err) {
      console.error('Error reversing transaction:', err);
      alert(err.response?.data?.error || 'No se pudo reversar el movimiento');
    }
  };
```

- [ ] **Step 6: Agregar la columna de acciones, el badge "Reversado" y el modal**

En la cabecera de la tabla (tras `<th className="text-right p-3">Monto</th>` en línea 263), agregar:

```javascript
              <th className="text-right p-3">Monto</th>
              <th className="text-right p-3"></th>
```

En la celda de categoría, tras el bloque `ORIGIN_BADGE[tx.category]` (después de la línea 300 `)}`), agregar el badge de reversado dentro del mismo `<div className="flex items-center gap-2">`:

```javascript
                    {isReversed(tx) && (
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-zinc-500/15 text-zinc-300 border-zinc-500/30"
                        data-testid={`reversed-badge-${tx.id}`}
                      >
                        Reversado
                      </span>
                    )}
```

Tras la celda de Monto (después de la línea 314 `</td>` que cierra el monto), agregar la celda de acción:

```javascript
                <td className="p-3 text-right whitespace-nowrap">
                  {canReverse(tx) && (
                    <button
                      onClick={() => openReverseModal(tx)}
                      className="btn-ghost text-xs text-amber-400 hover:text-amber-300"
                      data-testid={`tx-reverse-${tx.id}`}
                    >
                      Reversar
                    </button>
                  )}
                </td>
```

Actualizar el `colSpan` del estado vacío (línea 319) de `"7"` a `"8"`.

Antes del `</div>` final del componente (tras el `</Modal>` de la línea 439), agregar el modal de reverso:

```javascript
      <Modal
        isOpen={Boolean(reverseTarget)}
        onClose={() => setReverseTarget(null)}
        title="Reversar movimiento"
      >
        {reverseTarget && (
          <div className="space-y-4" data-testid="reverse-modal">
            <p className="text-sm text-[#8B949E]">
              Se creará un movimiento compensatorio que anula{' '}
              <span className="font-mono text-[#E6EDF3]">{shortId(reverseTarget.id)}</span>{' '}
              ({getCategoryLabel(reverseTarget.category)}, {formatCurrency(reverseTarget.amount)}).
              El movimiento original no se borra.
            </p>
            <div>
              <label className="block text-sm text-[#8B949E] mb-1">Motivo * (mín 10 caracteres)</label>
              <textarea
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="input w-full"
                rows={3}
                data-testid="reverse-reason"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setReverseTarget(null)} className="btn-ghost flex-1">Cancelar</button>
              <button
                type="button"
                onClick={handleReverse}
                disabled={reverseReason.trim().length < 10}
                className="btn-primary flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                data-testid="reverse-confirm"
              >
                Reversar
              </button>
            </div>
          </div>
        )}
      </Modal>
```

- [ ] **Step 7: Correr el spec de UI para verificar que pasa**

Run: `npx playwright test tests/e2e/treasury/transaction-reverse-ui.spec.ts`
Expected: PASS.

- [ ] **Step 8: Verificar que no se rompió la regresión de inmutabilidad**

Run: `npx playwright test tests/e2e/treasury/transactions-immutable-ui.spec.ts tests/e2e/treasury/transactions-no-delete-endpoint.spec.ts`
Expected: PASS — el botón nuevo usa testid `tx-reverse-*` (no `tx-delete-*`) y el modal usa `reverse-modal` (no `reason-prompt-modal`), así que ambos specs siguen verdes.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/treasuryApi.js frontend/src/pages/treasury/TransactionsPage.jsx tests/e2e/treasury/transaction-reverse-ui.spec.ts
git commit -m "feat(treasury): UI admin para reversar movimientos manuales"
```

---

### Task 5: Verificación final

**Files:** (ninguno nuevo — corrida de verificación)

- [ ] **Step 1: Unit tests del backend**

Run: `cd backend && npm test`
Expected: PASS, incluyendo `transactionReversal.test.js`.

- [ ] **Step 2: Suite e2e de tesorería completa**

Run: `npx playwright test tests/e2e/treasury/`
Expected: PASS — specs nuevos + regresiones de inmutabilidad/adjustment.

- [ ] **Step 3: Lint del frontend**

Run: `cd frontend && npm run lint`
Expected: sin errores nuevos en `TransactionsPage.jsx` ni `treasuryApi.js`.

- [ ] **Step 4: Invocar `verification-loop`**

Seguir la skill `verification-loop` del proyecto (build + lint + tests + security) antes de marcar completo.

---

## Self-Review

**Spec coverage:**
- Qué es reversable (manual, no reverso, no reversado) → Task 2 (`getReversibilityError`) + Task 3 (service).
- Solo ADMIN → Task 3 (`authorize('ADMIN')`) + e2e "no admin → 403".
- Migración `MANUAL_REVERSAL` → Task 1.
- Endpoint + status codes (201/404/403/400/409 + 400 motivo) → Task 3 spec cubre los 7 casos.
- Movimiento compensatorio (tipo invertido, reversesTransactionId, audit) → Task 2 + Task 3.
- ID corto `#abc123` → reutilizado vía `shortId` en Task 4.
- UI: botón admin, modal motivo, badge "Reversado", badge "Reverso" del compensatorio → Task 4.
- Tests unit + e2e → Tasks 2, 3, 4, 5.
- Reporte `getSummary` correcto → garantizado por categoría `MANUAL_REVERSAL` (neutraliza netFlow); sin cambio de código necesario.

**Placeholder scan:** sin TBD/TODO; todo el código está explícito.

**Type/naming consistency:** `getReversibilityError` y `buildReversalData` usados con la misma firma en Tasks 2 y 3; testids `tx-reverse-<id>`, `reverse-modal`, `reverse-reason`, `reverse-confirm`, `reversed-badge-<id>`, `origin-badge-MANUAL_REVERSAL` consistentes entre Task 4 implementación y specs. `schemas.treasuryDestructive` confirmado existente. `authorize` exportado por `middleware/auth.js`. Email admin `admin@autocontrol.co` confirmado en `tests/helpers/db.ts`.

**Decisión de auditoría:** el audit log se escribe con `action: 'CREATE'` sobre el movimiento compensatorio (entityType TRANSACTION) con `reason`, evitando agregar un valor nuevo a `TreasuryAuditAction`. El enlace al original queda en `reversesTransactionId`.
