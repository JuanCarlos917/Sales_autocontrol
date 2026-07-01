# Reverso Universal — Fase 3: Créditos (backend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reversar créditos (deudas) vía storno — un pago individual o el crédito completo en cascada — generando asientos compensatorios, recalculando saldos/cuotas y registrando auditoría, con endpoints admin; bloqueando el reverso de pagos reconciliados.

**Architecture:** Espejo de la Fase 2 (préstamos) sobre `Debt`/`DebtPayment`, reutilizando el motor `applyReversalInTx(tx, …)` ya existente. Diferencias del dominio: crear un crédito NO genera transacción (es un pasivo) → la cascada solo compensa pagos, no hay desembolso; un pago de crédito es un `EXPENSE` (egreso) cuyo reverso es `INCOME`; existe `reconcile` que liga egresos históricos reales, cuyo reverso-storno se **bloquea** (inflaría el saldo con plata realmente gastada).

**Tech Stack:** Node.js + Express + Prisma + PostgreSQL (CommonJS). Tests: `node:test` (`npm test`) para lógica pura; Playwright e2e (DB `autocontrol_test`).

## Global Constraints

- Backend **CommonJS**. `prisma = require('../config/database')`; `{ AppError } = require('../middleware/errorHandler')`.
- Moneda COP, `Decimal(15,2)`; en JS `parseFloat`.
- Reverso: solo **ADMIN**; **motivo ≥10** (`schemas.treasuryDestructive`).
- **Storno**: nunca borra/edita el original; compensatorio (tipo invertido) enlazado por `reversesTransactionId`, categoría `DEBT_REVERSAL`. Crédito reversado completo usa `status = CANCELLED`; pago reversado marcado con `reversedAt/reversedBy/reverseReason`.
- Auditoría: una entrada `TreasuryAuditLog` `action: 'REVERSE'` por operación — `entityType: 'DEBT_PAYMENT'` (pago) o `'DEBT'` (cascada).
- Atomicidad: compensatorios + recálculo + marcas en **una** `prisma.$transaction`. **TOCTOU hardening**: las fuentes y la lista de pagos volátil se releen DENTRO de la `$transaction` vía `tx` (las cuotas estáticas pueden venir de la lectura externa).
- Backstop: índice único parcial `debt_reversal_unique` → `P2002` se mapea a `409` con `ALREADY_REVERSED` (importado del motor).
- **Pagos reconciliados NO se reversan** (storno inflaría un egreso real). Se detectan con la columna nueva `DebtPayment.reconciled` (puesta en `true` por `reconcile()`).
- El `cancel` de crédito existente se **mantiene** (audita, no compensa nada porque crear un crédito no mueve plata) — a diferencia del `cancel` de préstamos que sí se eliminó.
- Migración aditiva aplicada a dev (`migrate dev`) **y** test (`migrate deploy` con `DATABASE_URL` de `autocontrol_test`).

---

## File Structure

- **Modify** `backend/prisma/schema.prisma` — `DebtPayment` += `reversedAt/reversedBy/reverseReason` + `reconciled Boolean @default(false)`.
- **Create** `backend/prisma/migrations/<ts>_debt_reversal/migration.sql` — campos + índice parcial `debt_reversal_unique`.
- **Create** `backend/src/utils/debtReversal.js` — `recomputeDebtFromPayments` (puro).
- **Create** `backend/src/utils/__tests__/debtReversal.test.js` — unit.
- **Modify** `backend/src/services/debtService.js` — imports + `reverseDebtPayment`, `reverseDebt`; `reconcile()` marca `reconciled: true`.
- **Modify** `backend/src/controllers/debtController.js` — `reverseDebtPayment`, `reverseDebt`.
- **Modify** `backend/src/routes/debts.js` — `POST /:id/reverse`.
- **Create** `backend/src/routes/debtPayments.js` — `POST /:id/reverse`.
- **Modify** `backend/src/routes/index.js` — montar `/debt-payments`.
- **Modify** `tests/helpers/api.ts` — `payments` en interface `Debt` + helpers `apiReverseDebtPaymentRaw`, `apiReverseDebtRaw`.
- **Create** `tests/e2e/treasury/debt-reverse-api.spec.ts` — e2e de ambos endpoints.

---

## Task 1: Migración — campos de reverso + flag reconciled + índice parcial

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `DebtPayment`)
- Create: `backend/prisma/migrations/<ts>_debt_reversal/migration.sql`

**Interfaces:**
- Produces: columnas `DebtPayment.reversedAt DateTime?`, `reversedBy String?`, `reverseReason String?`, `reconciled Boolean @default(false)`; índice único parcial `debt_reversal_unique` en `transactions(reversesTransactionId) WHERE category = 'DEBT_REVERSAL'`.

- [ ] **Step 1: Editar `schema.prisma`**

En `model DebtPayment`, después de `notes String?`, añadir:

```prisma
  reversedAt    DateTime?
  reversedBy    String?
  reverseReason String?
  reconciled    Boolean   @default(false)
```

- [ ] **Step 2: Generar la migración sin aplicar**

Run:
```bash
cd backend && npx prisma migrate dev --name debt_reversal --create-only
```
Expected: crea `prisma/migrations/<ts>_debt_reversal/migration.sql` con `ADD COLUMN` para los 4 campos, sin aplicar.

- [ ] **Step 3: Añadir el índice parcial a la migración generada**

Editar el `migration.sql` recién creado y **añadir al final**:

```sql
-- Índice único parcial: un solo reverso (DEBT_REVERSAL) por transacción original.
CREATE UNIQUE INDEX "debt_reversal_unique"
  ON "transactions" ("reversesTransactionId")
  WHERE "category" = 'DEBT_REVERSAL';
```

- [ ] **Step 4: Aplicar a dev y test**

Run:
```bash
cd backend && npx prisma migrate dev
```
Expected: aplica `<ts>_debt_reversal`, regenera el client.

Run:
```bash
cd backend && DATABASE_URL='postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test' npx prisma migrate deploy
```
Expected: `Applied … debt_reversal`.

- [ ] **Step 5: Verificar columnas e índice en dev**

Run:
```bash
cd backend && psql "postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_db" -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='debt_payments' AND (column_name LIKE 'revers%' OR column_name='reconciled') ORDER BY 1; SELECT indexname FROM pg_indexes WHERE indexname='debt_reversal_unique';"
```
Expected: `reconciled`, `reverseReason`, `reversedAt`, `reversedBy`, y `debt_reversal_unique`.

- [ ] **Step 6: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): campos de reverso + flag reconciled en debt_payments + índice parcial debt_reversal_unique"
```

---

## Task 2: Lógica pura — `recomputeDebtFromPayments`

**Files:**
- Create: `backend/src/utils/debtReversal.js`
- Create: `backend/src/utils/__tests__/debtReversal.test.js`

**Interfaces:**
- Produces:
  - `tierStatus(target: number, paid: number): 'PENDING'|'PARTIAL'|'PAID'`.
  - `recomputeDebtFromPayments(debt, survivingPayments)` → `{ paidAmount, status, installmentUpdates: [{ id, paidAmount, status }] }`. Recalcula desde cero a partir de SOLO los pagos no reversados. Puro.
    - `debt`: `{ totalAmount, installments: [{ id, sequence, plannedAmount }] }`.
    - `survivingPayments`: `[{ amount }]`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/src/utils/__tests__/debtReversal.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tierStatus, recomputeDebtFromPayments } = require('../debtReversal');

const debt = {
  totalAmount: '1000',
  installments: [
    { id: 'i1', sequence: 1, plannedAmount: '500' },
    { id: 'i2', sequence: 2, plannedAmount: '500' },
  ],
};

test('tierStatus: 0→PENDING, parcial→PARTIAL, completo→PAID', () => {
  assert.equal(tierStatus(500, 0), 'PENDING');
  assert.equal(tierStatus(500, 200), 'PARTIAL');
  assert.equal(tierStatus(500, 500), 'PAID');
});

test('recompute sin pagos vivos: cero, cuotas PENDING', () => {
  const r = recomputeDebtFromPayments(debt, []);
  assert.equal(r.paidAmount, 0);
  assert.equal(r.status, 'PENDING');
  assert.deepEqual(r.installmentUpdates, [
    { id: 'i1', paidAmount: 0, status: 'PENDING' },
    { id: 'i2', paidAmount: 0, status: 'PENDING' },
  ]);
});

test('recompute con un pago de 500: 1ª cuota PAID, 2ª PENDING, crédito PARTIAL', () => {
  const r = recomputeDebtFromPayments(debt, [{ amount: '500' }]);
  assert.equal(r.paidAmount, 500);
  assert.equal(r.status, 'PARTIAL');
  assert.deepEqual(r.installmentUpdates, [
    { id: 'i1', paidAmount: 500, status: 'PAID' },
    { id: 'i2', paidAmount: 0, status: 'PENDING' },
  ]);
});

test('recompute con pagos que cubren todo: crédito PAID, cuotas PAID', () => {
  const r = recomputeDebtFromPayments(debt, [{ amount: '600' }, { amount: '400' }]);
  assert.equal(r.paidAmount, 1000);
  assert.equal(r.status, 'PAID');
  assert.deepEqual(r.installmentUpdates, [
    { id: 'i1', paidAmount: 500, status: 'PAID' },
    { id: 'i2', paidAmount: 500, status: 'PAID' },
  ]);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test src/utils/__tests__/debtReversal.test.js`
Expected: FAIL — `Cannot find module '../debtReversal'`.

- [ ] **Step 3: Implementar `debtReversal.js`**

Crear `backend/src/utils/debtReversal.js`:

```js
// ═══════════════════════════════════════════════════════════════
// Util — Recálculo de crédito tras un reverso (lógica pura).
//
// Reversar un pago recalcula agregados y distribución FIFO sobre cuotas
// DESDE CERO usando solo los pagos que sobreviven (no reversados).
// Determinístico, sin drift. Los créditos no manejan interés.
// ═══════════════════════════════════════════════════════════════

function tierStatus(target, paid) {
  if (paid <= 0) return 'PENDING';
  if (paid >= target) return 'PAID';
  return 'PARTIAL';
}

function recomputeDebtFromPayments(debt, survivingPayments) {
  const total = parseFloat(debt.totalAmount);
  const paidAmount = survivingPayments.reduce((s, p) => s + parseFloat(p.amount), 0);
  const status = tierStatus(total, paidAmount);

  let remaining = paidAmount;
  const ordered = [...debt.installments].sort((a, b) => a.sequence - b.sequence);
  const installmentUpdates = ordered.map((inst) => {
    const planned = parseFloat(inst.plannedAmount);
    const applied = Math.max(0, Math.min(planned, remaining));
    remaining -= applied;
    return { id: inst.id, paidAmount: applied, status: tierStatus(planned, applied) };
  });

  return { paidAmount, status, installmentUpdates };
}

module.exports = { tierStatus, recomputeDebtFromPayments };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test src/utils/__tests__/debtReversal.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add backend/src/utils/debtReversal.js backend/src/utils/__tests__/debtReversal.test.js
git commit -m "feat(debts): recomputeDebtFromPayments (recálculo puro tras reverso)"
```

---

## Task 3: Reverso de pago individual (servicio + endpoint + e2e) + bloqueo de reconciliados

**Files:**
- Modify: `backend/src/services/debtService.js` (imports + `reverseDebtPayment` + `reconcile()` marca `reconciled`)
- Modify: `backend/src/controllers/debtController.js`
- Create: `backend/src/routes/debtPayments.js`
- Modify: `backend/src/routes/index.js`
- Modify: `tests/helpers/api.ts`
- Create: `tests/e2e/treasury/debt-reverse-api.spec.ts`

**Interfaces:**
- Consumes: `applyReversalInTx`, `ALREADY_REVERSED` (motor); `recomputeDebtFromPayments` (Task 2); `schemas.treasuryDestructive`.
- Produces: `debtService.reverseDebtPayment(paymentId, reason, userId): Promise<Debt>`; ruta `POST /api/debt-payments/:id/reverse` (ADMIN, motivo ≥10).

- [ ] **Step 1: Imports en `debtService.js`**

Debajo de `const { writeTreasuryAudit, snapshotEntity } = require('../utils/treasuryAudit');` añadir:

```js
const { applyReversalInTx, ALREADY_REVERSED } = require('./reversalEngine');
const { recomputeDebtFromPayments } = require('../utils/debtReversal');
```

- [ ] **Step 2: Marcar `reconciled: true` en `reconcile()`**

En `debtService.reconcile`, en el `tx.debtPayment.create({ data: { … } })` (el que tiene `notes: 'Reconciliación de egreso histórico'`), añadir `reconciled: true` al objeto `data`:

```js
        const payment = await tx.debtPayment.create({
          data: {
            debtId, accountId: t.accountId, amount: amt,
            date: t.date, notes: 'Reconciliación de egreso histórico', createdBy: userId,
            reconciled: true,
          },
        });
```

- [ ] **Step 3: Método `reverseDebtPayment` en la clase `DebtService`**

Añadir después de `cancel(debtId, userId)`:

```js
  async reverseDebtPayment(paymentId, reason, userId) {
    const payment = await prisma.debtPayment.findUnique({
      where: { id: paymentId },
      include: {
        transactions: true,
        debt: { include: { installments: { orderBy: { sequence: 'asc' } } } },
      },
    });
    if (!payment) throw new AppError('Pago de crédito no encontrado', 404);
    if (payment.reversedAt) throw new AppError('Este pago ya fue reversado.', 409);
    if (payment.reconciled) {
      throw new AppError('Este pago proviene de una reconciliación de un egreso histórico; no se puede reversar como storno.', 400);
    }
    const debt = payment.debt;
    if (debt.status === 'CANCELLED') {
      throw new AppError('El crédito ya fue reversado por completo.', 400);
    }

    const sources = payment.transactions; // inmutables una vez creadas
    try {
      const result = await prisma.$transaction(async (tx) => {
        const freshPayments = await tx.debtPayment.findMany({ where: { debtId: debt.id } });
        const surviving = freshPayments.filter((p) => p.id !== paymentId && !p.reversedAt);
        const recompute = recomputeDebtFromPayments(debt, surviving);

        await applyReversalInTx(tx, {
          sources,
          reason,
          userId,
          category: 'DEBT_REVERSAL',
          auditEntityType: 'DEBT_PAYMENT',
          auditEntityId: paymentId,
        });
        await tx.debtPayment.update({
          where: { id: paymentId },
          data: { reversedAt: new Date(), reversedBy: userId, reverseReason: reason },
        });
        for (const u of recompute.installmentUpdates) {
          await tx.debtInstallment.update({
            where: { id: u.id },
            data: { paidAmount: u.paidAmount, status: u.status },
          });
        }
        return tx.debt.update({
          where: { id: debt.id },
          data: { paidAmount: recompute.paidAmount, status: recompute.status },
          include: DEBT_INCLUDE,
        });
      });
      return annotateOverdue(result);
    } catch (err) {
      if (err.code === 'P2002') throw new AppError(ALREADY_REVERSED, 409);
      throw err;
    }
  }
```

- [ ] **Step 4: Controlador `reverseDebtPayment` en `debtController.js`**

Añadir antes de `module.exports`:

```js
const reverseDebtPayment = async (req, res, next) => {
  try {
    res.status(201).json(await debtService.reverseDebtPayment(req.params.id, req.body.reason, req.user.id));
  } catch (err) { next(err); }
};
```

Y actualizar el export para incluir `reverseDebtPayment` (mantener los existentes):

```js
module.exports = { create, list, findById, addPayment, reconcileCandidates, reconcile, cancel, reverseDebtPayment };
```

- [ ] **Step 5: Ruta nueva `debtPayments.js`**

Crear `backend/src/routes/debtPayments.js` (replicando `routes/loanPayments.js`):

```js
const { Router } = require('express');
const ctrl = require('../controllers/debtController');
const { authorize } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = Router();

router.post('/:id/reverse', authorize('ADMIN'), validate(schemas.treasuryDestructive), ctrl.reverseDebtPayment);

module.exports = router;
```

Montar en `backend/src/routes/index.js`, después de `router.use('/debts', require('./debts'));`:

```js
router.use('/debt-payments', require('./debtPayments'));
```

- [ ] **Step 6: Helpers e2e en `tests/helpers/api.ts`**

En la interface `Debt`, añadir el campo `payments` después de la línea de `installments: Array<…>,`:

```ts
  payments: Array<{ id: string; amount: string | number; reversedAt: string | null }>;
```

Y añadir, junto a `apiAddDebtPayment`, dos helpers raw:

```ts
export async function apiReverseDebtPaymentRaw(
  token: string,
  paymentId: string,
  reason: string,
): Promise<{ status: number; body: { error?: string } }> {
  return apiRequestRaw('POST', `/debt-payments/${paymentId}/reverse`, token, { reason });
}

export async function apiReverseDebtRaw(
  token: string,
  debtId: string,
  reason: string,
): Promise<{ status: number; body: { error?: string } }> {
  return apiRequestRaw('POST', `/debts/${debtId}/reverse`, token, { reason });
}
```

- [ ] **Step 7: Escribir el e2e (reverso de pago) que falla**

Crear `tests/e2e/treasury/debt-reverse-api.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetAccount,
  apiCreateDebt,
  apiGetDebt,
  apiAddDebtPayment,
  apiReconcileDebt,
  apiCreateTreasuryExpense,
  apiReverseDebtPaymentRaw,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

function isoDueDates(n: number): string[] {
  const out: string[] = [];
  const base = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(base);
    d.setMonth(d.getMonth() + i);
    out.push(d.toISOString());
  }
  return out;
}

async function createDebt2x500(token: string) {
  const due = isoDueDates(2);
  return apiCreateDebt(token, {
    name: 'Crédito de prueba',
    installments: [
      { sequence: 1, dueDate: due[0], plannedAmount: 500_000 },
      { sequence: 2, dueDate: due[1], plannedAmount: 500_000 },
    ],
  });
}

test.describe('Tesorería — reverso de pagos de crédito (API)', () => {
  test('reversar un pago restaura el saldo del crédito y devuelve la plata a la cuenta', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const debt = await createDebt2x500(token);

    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 500_000 });
    const afterPay = await apiGetDebt(token, debt.id);
    expect(parseFloat(String(afterPay.paidAmount))).toBe(500_000);
    const paymentId = afterPay.payments[0].id;
    const cashAfterPay = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));

    const res = await apiReverseDebtPaymentRaw(token, paymentId, 'pago duplicado, corregir');
    expect(res.status).toBe(201);

    const afterReverse = await apiGetDebt(token, debt.id);
    expect(parseFloat(String(afterReverse.paidAmount))).toBe(0);
    expect(afterReverse.status).toBe('PENDING');
    expect(afterReverse.payments[0].reversedAt).not.toBeNull();
    expect(afterReverse.installments[0].status).toBe('PENDING');

    // El pago era EXPENSE (egreso); su reverso es INCOME → la caja sube en 500k.
    const cashAfterReverse = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    expect(cashAfterReverse).toBe(cashAfterPay + 500_000);
  });

  test('doble reverso del mismo pago → 409', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const debt = await createDebt2x500(token);
    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 200_000 });
    const paymentId = (await apiGetDebt(token, debt.id)).payments[0].id;

    expect((await apiReverseDebtPaymentRaw(token, paymentId, 'corrección de monto')).status).toBe(201);
    expect((await apiReverseDebtPaymentRaw(token, paymentId, 'corrección de monto')).status).toBe(409);
  });

  test('motivo corto (<10) → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const debt = await createDebt2x500(token);
    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 100_000 });
    const paymentId = (await apiGetDebt(token, debt.id)).payments[0].id;
    expect((await apiReverseDebtPaymentRaw(token, paymentId, 'corto')).status).toBe(400);
  });

  test('pago inexistente → 404', async ({ page }) => {
    const token = await loginAsAdmin(page);
    expect((await apiReverseDebtPaymentRaw(token, 'noexiste', 'motivo suficiente largo')).status).toBe(404);
  });

  test('un pago reconciliado NO se puede reversar → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const debt = await createDebt2x500(token);

    // Crear un egreso histórico y reconciliarlo al crédito.
    const expenseTx = await apiCreateTreasuryExpense(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 300_000,
      description: 'egreso histórico a reconciliar',
    });
    await apiReconcileDebt(token, debt.id, [expenseTx.id]);

    const reconciledPaymentId = (await apiGetDebt(token, debt.id)).payments[0].id;
    const res = await apiReverseDebtPaymentRaw(token, reconciledPaymentId, 'intento de reverso reconciliado');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 8: Correr unit + e2e**

Run: `cd backend && npm test 2>&1 | grep -E "# (tests|pass|fail)"`
Expected: `# fail 0`.

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
lsof -tiTCP:4000 -sTCP:LISTEN | xargs -r kill 2>/dev/null
lsof -tiTCP:5173 -sTCP:LISTEN | xargs -r kill 2>/dev/null
sleep 2
npx playwright test tests/e2e/treasury/debt-reverse-api.spec.ts --project=chromium 2>&1 | tail -15
```
Expected: `5 passed`.

- [ ] **Step 9: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add backend/src/services/debtService.js backend/src/controllers/debtController.js backend/src/routes/debtPayments.js backend/src/routes/index.js tests/helpers/api.ts tests/e2e/treasury/debt-reverse-api.spec.ts
git commit -m "feat(debts): reverso de pago individual (POST /debt-payments/:id/reverse) + bloqueo de reconciliados"
```

---

## Task 4: Reverso de crédito completo en cascada (servicio + endpoint + e2e)

**Files:**
- Modify: `backend/src/services/debtService.js` (método `reverseDebt`)
- Modify: `backend/src/controllers/debtController.js`
- Modify: `backend/src/routes/debts.js`
- Modify: `tests/e2e/treasury/debt-reverse-api.spec.ts` (describe nuevo)

**Interfaces:**
- Consumes: `applyReversalInTx`, `ALREADY_REVERSED`; `apiReverseDebtRaw` (Task 3).
- Produces: `debtService.reverseDebt(debtId, reason, userId): Promise<Debt>`; ruta `POST /api/debts/:id/reverse` (ADMIN, motivo ≥10).

- [ ] **Step 1: Método `reverseDebt` en `DebtService`**

Añadir después de `reverseDebtPayment`:

```js
  async reverseDebt(debtId, reason, userId) {
    const debt = await prisma.debt.findUnique({
      where: { id: debtId },
      include: { installments: true },
    });
    if (!debt) throw new AppError('Crédito no encontrado', 404);
    if (debt.status === 'CANCELLED') throw new AppError('El crédito ya fue reversado.', 409);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const livePayments = await tx.debtPayment.findMany({
          where: { debtId, reversedAt: null },
          include: { transactions: true },
        });
        if (livePayments.some((p) => p.reconciled)) {
          throw new AppError('Este crédito tiene pagos reconciliados; gestiona esos egresos por separado, no se puede anular en cascada.', 400);
        }
        const sources = livePayments.flatMap((p) => p.transactions);
        if (sources.length === 0) {
          throw new AppError('El crédito no tiene movimientos para reversar.', 400);
        }

        await applyReversalInTx(tx, {
          sources,
          reason,
          userId,
          category: 'DEBT_REVERSAL',
          auditEntityType: 'DEBT',
          auditEntityId: debtId,
        });
        const now = new Date();
        for (const p of livePayments) {
          await tx.debtPayment.update({
            where: { id: p.id },
            data: { reversedAt: now, reversedBy: userId, reverseReason: reason },
          });
        }
        for (const inst of debt.installments) {
          await tx.debtInstallment.update({
            where: { id: inst.id },
            data: { paidAmount: 0, status: 'PENDING' },
          });
        }
        return tx.debt.update({
          where: { id: debtId },
          data: { paidAmount: 0, status: 'CANCELLED' },
          include: DEBT_INCLUDE,
        });
      });
      return annotateOverdue(result);
    } catch (err) {
      if (err.code === 'P2002') throw new AppError(ALREADY_REVERSED, 409);
      throw err;
    }
  }
```

- [ ] **Step 2: Controlador `reverseDebt`**

En `debtController.js`, añadir antes de `module.exports`:

```js
const reverseDebt = async (req, res, next) => {
  try {
    res.status(201).json(await debtService.reverseDebt(req.params.id, req.body.reason, req.user.id));
  } catch (err) { next(err); }
};
```

Actualizar el export:

```js
module.exports = { create, list, findById, addPayment, reconcileCandidates, reconcile, cancel, reverseDebtPayment, reverseDebt };
```

- [ ] **Step 3: Ruta en `debts.js`**

`backend/src/routes/debts.js`: añadir `authorize` al require de `../middleware/auth` si no está (igual que `routes/treasury.js`), y registrar después de `router.post('/:id/cancel', ctrl.cancel);`:

```js
router.post('/:id/reverse', authorize('ADMIN'), validate(schemas.treasuryDestructive), ctrl.reverseDebt);
```

- [ ] **Step 4: Escribir el e2e (cascada) que falla**

Añadir al final de `tests/e2e/treasury/debt-reverse-api.spec.ts`, importando `apiReverseDebtRaw` (añadir al import existente):

```ts
test.describe('Tesorería — reverso de crédito completo (cascada, API)', () => {
  test('anular crédito con pagos compensa todos los pagos y restaura la caja', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const cashBefore = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    const debt = await createDebt2x500(token);

    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 400_000 });
    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 100_000 });

    const res = await apiReverseDebtRaw(token, debt.id, 'crédito cargado por error');
    expect(res.status).toBe(201);

    const after = await apiGetDebt(token, debt.id);
    expect(after.status).toBe('CANCELLED');
    expect(parseFloat(String(after.paidAmount))).toBe(0);
    expect(after.payments.every((p) => p.reversedAt !== null)).toBe(true);
    expect(after.installments.every((i) => i.status === 'PENDING')).toBe(true);

    // Crear el crédito no mueve plata; reversar los 2 pagos (egresos) devuelve todo → caja vuelve al inicio.
    const cashAfter = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    expect(cashAfter).toBe(cashBefore);
  });

  test('doble anulación del mismo crédito → 409', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const debt = await createDebt2x500(token);
    await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountCash, amount: 200_000 });
    expect((await apiReverseDebtRaw(token, debt.id, 'cargado por error')).status).toBe(201);
    expect((await apiReverseDebtRaw(token, debt.id, 'cargado por error')).status).toBe(409);
  });

  test('anular en cascada un crédito con pago reconciliado → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const debt = await createDebt2x500(token);
    const expenseTx = await apiCreateTreasuryExpense(token, {
      accountId: TEST_SEED_IDS.accountCash,
      amount: 200_000,
      description: 'egreso histórico a reconciliar (cascada)',
    });
    await apiReconcileDebt(token, debt.id, [expenseTx.id]);
    const res = await apiReverseDebtRaw(token, debt.id, 'intento anular con reconciliado');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 5: Correr e2e completo del archivo**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
lsof -tiTCP:4000 -sTCP:LISTEN | xargs -r kill 2>/dev/null
lsof -tiTCP:5173 -sTCP:LISTEN | xargs -r kill 2>/dev/null
sleep 2
npx playwright test tests/e2e/treasury/debt-reverse-api.spec.ts --project=chromium 2>&1 | tail -15
```
Expected: `8 passed` (5 de pago + 3 de cascada).

- [ ] **Step 6: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add backend/src/services/debtService.js backend/src/controllers/debtController.js backend/src/routes/debts.js tests/e2e/treasury/debt-reverse-api.spec.ts
git commit -m "feat(debts): reverso de crédito completo en cascada (POST /debts/:id/reverse)"
```

---

## Definition of Done (Fase 3 backend)

- [ ] Migración `debt_reversal` (campos + flag `reconciled` + índice parcial) aplicada en dev y test.
- [ ] `recomputeDebtFromPayments` cubierto por unit tests.
- [ ] `POST /debt-payments/:id/reverse` y `POST /debts/:id/reverse` operativos (ADMIN, motivo ≥10), atómicos, con audit `REVERSE`, TOCTOU hardening y backstop `P2002 → 409`.
- [ ] Pagos reconciliados bloqueados (400) tanto en reverso individual como en cascada.
- [ ] `npm test` verde; `debt-reverse-api.spec.ts` 8/8.

## Notas / Fuera de alcance

- **UI (Fase 2b/posterior):** botón `<ReverseAction>` + badge en créditos — plan aparte; esta fase deja el backend usable por API.
- **`cancel` de crédito** se mantiene: audita y no compensa nada (crear un crédito no mueve plata), a diferencia del `cancel` de préstamos que se eliminó.
- **Reverso de reconciliaciones (un-reconcile):** fuera de alcance. Reversar un pago reconciliado se bloquea (400) porque su transacción es un egreso real histórico; "des-reconciliar" es una operación distinta para una fase futura si se necesita.
- **`tierStatus`** se duplica en `loanReversal.js`/`debtReversal.js`/los services — candidato de consolidación en Fase 6.
