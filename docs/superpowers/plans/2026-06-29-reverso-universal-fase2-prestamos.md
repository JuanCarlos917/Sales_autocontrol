# Reverso Universal — Fase 2: Préstamos (backend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reversar préstamos vía storno — un pago individual o el préstamo completo en cascada — generando asientos compensatorios, recalculando saldos/cuotas y registrando auditoría, con endpoints admin.

**Architecture:** Reutiliza el motor de la Fase 1. Se le extrae `applyReversalInTx(tx, …)` para poder componer el reverso dentro de la misma transacción Prisma en la que el dominio recalcula cuotas y agregados (no se pueden anidar `$transaction`). La matemática de recálculo vive en un helper puro `utils/loanReversal.js`. El servicio `loanService` orquesta; rutas nuevas exponen `POST /loan-payments/:id/reverse` y `POST /loans/:id/reverse`.

**Tech Stack:** Node.js + Express + Prisma + PostgreSQL (CommonJS). Tests: `node:test` (`npm test`) para lógica pura; Playwright e2e (DB `autocontrol_test`) para los flujos de API.

## Global Constraints

- Backend **CommonJS** (`require`). `prisma = require('../config/database')`; `{ AppError } = require('../middleware/errorHandler')`.
- Moneda COP, montos `Decimal(15,2)` en DB; en JS se opera con `parseFloat`.
- Reverso: solo rol **ADMIN**; **motivo obligatorio ≥10 caracteres** (reutilizar `schemas.treasuryDestructive`, ya existente).
- **Inmutabilidad / storno**: reversar NUNCA borra ni edita el original; crea compensatorio (tipo invertido) enlazado por `reversesTransactionId`, categoría `LOAN_REVERSAL`. El préstamo reversado por completo usa `status = CANCELLED`; un pago reversado se marca con `reversedAt/reversedBy/reverseReason`.
- Auditoría: una entrada `TreasuryAuditLog` con `action: 'REVERSE'` por operación — `entityType: 'LOAN_PAYMENT'` (pago) o `'LOAN'` (cascada).
- Atomicidad: compensatorios + recálculo de cuotas + update del préstamo + marca de reverso ocurren en **una** `prisma.$transaction`.
- Backstop anti-doble-reverso: índice único parcial `loan_reversal_unique` → `P2002` se mapea a `409` con el mensaje `ALREADY_REVERSED`.
- Categoría/enum `LOAN_REVERSAL`, campos y entidades de audit ya existen (Fase 1). Migración aditiva aplicada a dev (`migrate dev`) **y** test (`migrate deploy` con `DATABASE_URL` de `autocontrol_test`).

---

## File Structure

- **Modify** `backend/src/services/reversalEngine.js` — extraer `applyReversalInTx(tx, …)`; `applyReversal` lo envuelve. Exportar ambos.
- **Modify** `backend/src/services/__tests__/reversalEngine.test.js` — test del nuevo `applyReversalInTx`.
- **Modify** `backend/prisma/schema.prisma` — `LoanPayment` += `reversedAt/reversedBy/reverseReason`.
- **Create** `backend/prisma/migrations/<ts>_loan_reversal/migration.sql` — campos + índice parcial `loan_reversal_unique`.
- **Create** `backend/src/utils/loanReversal.js` — `recomputeLoanFromPayments` (puro).
- **Create** `backend/src/utils/__tests__/loanReversal.test.js` — unit.
- **Modify** `backend/src/services/loanService.js` — métodos `reversePayment`, `reverseLoan` + imports.
- **Modify** `backend/src/controllers/loanController.js` — `reversePayment`, `reverseLoan`.
- **Modify** `backend/src/routes/loans.js` — `POST /:id/reverse`.
- **Create** `backend/src/routes/loanPayments.js` — `POST /:id/reverse`.
- **Modify** `backend/src/routes/index.js` — montar `/loan-payments`.
- **Modify** `tests/helpers/api.ts` — `payments` en interface `Loan` + helpers `apiReverseLoanPaymentRaw`, `apiReverseLoanRaw`.
- **Create** `tests/e2e/treasury/loan-reverse-api.spec.ts` — e2e de ambos endpoints.

---

## Task 1: Motor — extraer `applyReversalInTx`

**Files:**
- Modify: `backend/src/services/reversalEngine.js`
- Modify: `backend/src/services/__tests__/reversalEngine.test.js`

**Interfaces:**
- Consumes: `buildReversalDataMany`, `writeTreasuryAudit`, `AppError`, `prisma`.
- Produces:
  - `applyReversalInTx(tx, { sources, reason, userId, category, auditEntityType, auditEntityId, include }): Promise<Transaction[]>` — crea compensatorios + 1 audit `REVERSE` usando el `tx` dado; NO abre transacción ni mapea P2002.
  - `applyReversal({ …, client = prisma })` — envuelve `applyReversalInTx` en `client.$transaction` + mapea `P2002 → AppError(ALREADY_REVERSED, 409)`. Firma externa sin cambios.
  - `ALREADY_REVERSED` (sin cambios).

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `backend/src/services/__tests__/reversalEngine.test.js`:

```js
const { applyReversalInTx } = require('../reversalEngine');

test('applyReversalInTx: crea compensatorios y 1 audit usando el tx dado, sin abrir transacción', async () => {
  let n = 0;
  const auditCalls = [];
  const tx = {
    transaction: { create: async ({ data }) => ({ id: 'comp-' + (++n), ...data }) },
    treasuryAuditLog: { create: async ({ data }) => { auditCalls.push(data); return data; } },
  };
  const sources = [
    { id: 's1', accountId: 'a1', type: 'INCOME', amount: '100', vehicleId: null, thirdPartyId: null },
    { id: 's2', accountId: 'a1', type: 'INCOME', amount: '50',  vehicleId: null, thirdPartyId: null },
  ];
  const out = await applyReversalInTx(tx, {
    sources, reason: 'reverso de prueba xyz', userId: 'u1',
    category: 'LOAN_REVERSAL', auditEntityType: 'LOAN_PAYMENT', auditEntityId: 'pay-1',
  });
  assert.equal(out.length, 2);
  assert.equal(n, 2);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, 'REVERSE');
  assert.equal(auditCalls[0].entityType, 'LOAN_PAYMENT');
  assert.equal(auditCalls[0].entityId, 'pay-1');
  assert.ok(out.every((c) => c.category === 'LOAN_REVERSAL'));
});

test('applyReversalInTx: sources vacío lanza AppError 400 sin crear', async () => {
  let created = false;
  const tx = { transaction: { create: async () => { created = true; } }, treasuryAuditLog: { create: async () => {} } };
  await assert.rejects(
    () => applyReversalInTx(tx, { sources: [], reason: 'x'.repeat(10), userId: 'u', category: 'LOAN_REVERSAL', auditEntityType: 'LOAN', auditEntityId: 'l1' }),
    (err) => { assert.equal(err.statusCode, 400); return true; },
  );
  assert.equal(created, false);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test src/services/__tests__/reversalEngine.test.js`
Expected: FAIL — `applyReversalInTx is not a function`.

- [ ] **Step 3: Refactorizar `reversalEngine.js`**

Reemplazar el cuerpo del módulo (debajo de los `require` y la constante `ALREADY_REVERSED`) por:

```js
/**
 * Núcleo del reverso DENTRO de una transacción ya abierta: crea los
 * compensatorios + 1 audit REVERSE con el `tx` provisto. No abre transacción
 * ni mapea P2002 — eso lo hace el caller (applyReversal o un servicio de
 * dominio que compone más mutaciones en la misma tx).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Object}  params
 * @param {Array}   params.sources          transacciones origen
 * @param {string}  params.reason
 * @param {string}  params.userId
 * @param {string}  params.category          categoría del compensatorio
 * @param {string}  params.auditEntityType
 * @param {string}  params.auditEntityId
 * @param {Object} [params.include]          include Prisma opcional
 * @returns {Promise<Array>} compensatorios creados
 */
async function applyReversalInTx(tx, { sources, reason, userId, category, auditEntityType, auditEntityId, include }) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new AppError('No hay movimientos para reversar.', 400);
  }
  const dataList = buildReversalDataMany(sources, userId, reason, category);
  const compensating = [];
  for (const data of dataList) {
    compensating.push(await tx.transaction.create({ data, include }));
  }
  await writeTreasuryAudit(tx, {
    entityType: auditEntityType,
    entityId: auditEntityId,
    userId,
    action: 'REVERSE',
    after: { compensatingIds: compensating.map((c) => c.id), count: compensating.length },
    reason,
  });
  return compensating;
}

/**
 * Reverso atómico autónomo: abre su propia transacción y mapea el índice
 * único parcial (P2002) → 409. Para dominios que solo crean compensatorios.
 *
 * @param {Object}  params  (ver applyReversalInTx)
 * @param {Object} [params.client]  cliente Prisma; default el módulo (útil en tests)
 */
async function applyReversal({ sources, reason, userId, category, auditEntityType, auditEntityId, include, client = prisma }) {
  try {
    return await client.$transaction((tx) =>
      applyReversalInTx(tx, { sources, reason, userId, category, auditEntityType, auditEntityId, include }),
    );
  } catch (err) {
    if (err.code === 'P2002') throw new AppError(ALREADY_REVERSED, 409);
    throw err;
  }
}

module.exports = { applyReversal, applyReversalInTx, ALREADY_REVERSED };
```

(Mantener intactos los `require` del tope y `const ALREADY_REVERSED = 'Esta operación ya fue reversada.';`.)

- [ ] **Step 4: Correr el archivo de tests del motor y luego la suite completa**

Run: `cd backend && node --test src/services/__tests__/reversalEngine.test.js`
Expected: PASS (los 5 previos + 2 nuevos = 7).

Run: `cd backend && npm test 2>&1 | grep -E "# (tests|pass|fail)"`
Expected: `# fail 0` (87 tests: 85 previos + 2 nuevos).

- [ ] **Step 5: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add backend/src/services/reversalEngine.js backend/src/services/__tests__/reversalEngine.test.js
git commit -m "refactor(reversal): extraer applyReversalInTx para componer en transacciones de dominio"
```

---

## Task 2: Migración — campos de reverso de pago + índice parcial

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `LoanPayment`)
- Create: `backend/prisma/migrations/<ts>_loan_reversal/migration.sql`

**Interfaces:**
- Produces: columnas `LoanPayment.reversedAt DateTime?`, `reversedBy String?`, `reverseReason String?`; índice único parcial `loan_reversal_unique` en `transactions(reversesTransactionId) WHERE category = 'LOAN_REVERSAL'`.

- [ ] **Step 1: Editar `schema.prisma`**

En `model LoanPayment`, después de `notes String?`, añadir:

```prisma
  reversedAt    DateTime?
  reversedBy    String?
  reverseReason String?
```

- [ ] **Step 2: Generar la migración (solo campos) sin aplicar aún**

Run:
```bash
cd backend && npx prisma migrate dev --name loan_reversal --create-only
```
Expected: crea `prisma/migrations/<ts>_loan_reversal/migration.sql` con los `ADD COLUMN`, sin aplicar.

- [ ] **Step 3: Añadir el índice parcial a la migración generada**

Editar el `migration.sql` recién creado y **añadir al final**:

```sql
-- Índice único parcial: un solo reverso (LOAN_REVERSAL) por transacción original.
-- No afecta otras categorías porque el WHERE las excluye.
CREATE UNIQUE INDEX "loan_reversal_unique"
  ON "transactions" ("reversesTransactionId")
  WHERE "category" = 'LOAN_REVERSAL';
```

- [ ] **Step 4: Aplicar a dev y test**

Run:
```bash
cd backend && npx prisma migrate dev
```
Expected: aplica `<ts>_loan_reversal`, regenera el client.

Run:
```bash
cd backend && DATABASE_URL='postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test' npx prisma migrate deploy
```
Expected: `Applied … loan_reversal`.

- [ ] **Step 5: Verificar columnas e índice en dev**

Run:
```bash
cd backend && psql "postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_db" -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='loan_payments' AND column_name LIKE 'revers%' ORDER BY 1; SELECT indexname FROM pg_indexes WHERE indexname='loan_reversal_unique';"
```
Expected: `reverseReason`, `reversedAt`, `reversedBy`, y `loan_reversal_unique`.

- [ ] **Step 6: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): campos de reverso en loan_payments + índice parcial loan_reversal_unique"
```

---

## Task 3: Lógica pura — `recomputeLoanFromPayments`

**Files:**
- Create: `backend/src/utils/loanReversal.js`
- Create: `backend/src/utils/__tests__/loanReversal.test.js`

**Interfaces:**
- Produces:
  - `tierStatus(target: number, paid: number): 'PENDING'|'PARTIAL'|'PAID'`.
  - `recomputeLoanFromPayments(loan, survivingPayments)` → `{ paidAmount, interestReceived, extraReceived, status, installmentUpdates: [{ id, paidAmount, status }] }`. Recalcula desde cero los agregados del préstamo y la distribución de capital sobre las cuotas (en orden de secuencia), a partir de SOLO los pagos no reversados. Puro: no toca Prisma.
    - `loan`: `{ principalAmount, interestAmount, installments: [{ id, sequence, plannedAmount }] }`.
    - `survivingPayments`: `[{ principalAmount, interestPortion, extraAmount }]`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/src/utils/__tests__/loanReversal.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tierStatus, recomputeLoanFromPayments } = require('../loanReversal');

const loan = {
  principalAmount: '1000',
  interestAmount: '0',
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

test('recompute sin pagos vivos: todo en cero, cuotas PENDING', () => {
  const r = recomputeLoanFromPayments(loan, []);
  assert.equal(r.paidAmount, 0);
  assert.equal(r.interestReceived, 0);
  assert.equal(r.extraReceived, 0);
  assert.equal(r.status, 'PENDING');
  assert.deepEqual(r.installmentUpdates, [
    { id: 'i1', paidAmount: 0, status: 'PENDING' },
    { id: 'i2', paidAmount: 0, status: 'PENDING' },
  ]);
});

test('recompute con un pago parcial de 500: 1ª cuota PAID, 2ª PENDING, préstamo PARTIAL', () => {
  const r = recomputeLoanFromPayments(loan, [
    { principalAmount: '500', interestPortion: '0', extraAmount: '0' },
  ]);
  assert.equal(r.paidAmount, 500);
  assert.equal(r.status, 'PARTIAL');
  assert.deepEqual(r.installmentUpdates, [
    { id: 'i1', paidAmount: 500, status: 'PAID' },
    { id: 'i2', paidAmount: 0, status: 'PENDING' },
  ]);
});

test('recompute con pagos que cubren todo: préstamo PAID, cuotas PAID, suma interés/extra', () => {
  const r = recomputeLoanFromPayments(loan, [
    { principalAmount: '600', interestPortion: '0', extraAmount: '10' },
    { principalAmount: '400', interestPortion: '0', extraAmount: '5' },
  ]);
  assert.equal(r.paidAmount, 1000);
  assert.equal(r.extraReceived, 15);
  assert.equal(r.status, 'PAID');
  assert.deepEqual(r.installmentUpdates, [
    { id: 'i1', paidAmount: 500, status: 'PAID' },
    { id: 'i2', paidAmount: 500, status: 'PAID' },
  ]);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test src/utils/__tests__/loanReversal.test.js`
Expected: FAIL — `Cannot find module '../loanReversal'`.

- [ ] **Step 3: Implementar `loanReversal.js`**

Crear `backend/src/utils/loanReversal.js`:

```js
// ═══════════════════════════════════════════════════════════════
// Util — Recálculo de préstamo tras un reverso (lógica pura).
//
// Reversar un pago no "deshace" en sitio: recalcula los agregados del
// préstamo y la distribución de capital sobre las cuotas DESDE CERO, usando
// solo los pagos que sobreviven (no reversados). Determinístico, sin drift.
// ═══════════════════════════════════════════════════════════════

function tierStatus(target, paid) {
  if (paid <= 0) return 'PENDING';
  if (paid >= target) return 'PAID';
  return 'PARTIAL';
}

function recomputeLoanFromPayments(loan, survivingPayments) {
  const principal = parseFloat(loan.principalAmount);
  const interest = parseFloat(loan.interestAmount);
  const totalToRepay = principal + interest;

  const paidAmount = survivingPayments.reduce((s, p) => s + parseFloat(p.principalAmount), 0);
  const interestReceived = survivingPayments.reduce((s, p) => s + parseFloat(p.interestPortion), 0);
  const extraReceived = survivingPayments.reduce((s, p) => s + parseFloat(p.extraAmount), 0);
  const status = tierStatus(totalToRepay, paidAmount);

  // Re-aplica el capital total pagado sobre las cuotas en orden de secuencia.
  let remaining = paidAmount;
  const ordered = [...loan.installments].sort((a, b) => a.sequence - b.sequence);
  const installmentUpdates = ordered.map((inst) => {
    const planned = parseFloat(inst.plannedAmount);
    const applied = Math.max(0, Math.min(planned, remaining));
    remaining -= applied;
    return { id: inst.id, paidAmount: applied, status: tierStatus(planned, applied) };
  });

  return { paidAmount, interestReceived, extraReceived, status, installmentUpdates };
}

module.exports = { tierStatus, recomputeLoanFromPayments };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test src/utils/__tests__/loanReversal.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add backend/src/utils/loanReversal.js backend/src/utils/__tests__/loanReversal.test.js
git commit -m "feat(loans): recomputeLoanFromPayments (recálculo puro tras reverso)"
```

---

## Task 4: Reverso de pago individual (servicio + endpoint + e2e)

**Files:**
- Modify: `backend/src/services/loanService.js` (imports + método `reversePayment`)
- Modify: `backend/src/controllers/loanController.js`
- Create: `backend/src/routes/loanPayments.js`
- Modify: `backend/src/routes/index.js`
- Modify: `tests/helpers/api.ts`
- Create: `tests/e2e/treasury/loan-reverse-api.spec.ts`

**Interfaces:**
- Consumes: `applyReversalInTx`, `ALREADY_REVERSED` (Task 1); `recomputeLoanFromPayments` (Task 3); `schemas.treasuryDestructive`.
- Produces: `loanService.reversePayment(paymentId, reason, userId): Promise<Loan>`; ruta `POST /api/loan-payments/:id/reverse` (ADMIN, motivo ≥10).

- [ ] **Step 1: Imports en `loanService.js`**

Debajo de `const { calcLoanInterest, splitLoanPayment, splitFinalPayment } = require('../utils/financial');` añadir:

```js
const { applyReversalInTx, ALREADY_REVERSED } = require('./reversalEngine');
const { recomputeLoanFromPayments } = require('../utils/loanReversal');
```

- [ ] **Step 2: Método `reversePayment` en la clase `LoanService`**

Añadir después de `cancel(loanId)`:

```js
  async reversePayment(paymentId, reason, userId) {
    const payment = await prisma.loanPayment.findUnique({
      where: { id: paymentId },
      include: {
        transactions: true,
        loan: {
          include: {
            installments: { orderBy: { sequence: 'asc' } },
            payments: true,
          },
        },
      },
    });
    if (!payment) throw new AppError('Pago de préstamo no encontrado', 404);
    if (payment.reversedAt) throw new AppError('Este pago ya fue reversado.', 409);

    const loan = payment.loan;
    if (loan.status === 'CANCELLED') {
      throw new AppError('El préstamo ya fue reversado por completo.', 400);
    }

    const sources = payment.transactions;
    const surviving = loan.payments.filter((p) => p.id !== paymentId && !p.reversedAt);
    const recompute = recomputeLoanFromPayments(loan, surviving);

    try {
      const result = await prisma.$transaction(async (tx) => {
        await applyReversalInTx(tx, {
          sources,
          reason,
          userId,
          category: 'LOAN_REVERSAL',
          auditEntityType: 'LOAN_PAYMENT',
          auditEntityId: paymentId,
        });
        await tx.loanPayment.update({
          where: { id: paymentId },
          data: { reversedAt: new Date(), reversedBy: userId, reverseReason: reason },
        });
        for (const u of recompute.installmentUpdates) {
          await tx.loanInstallment.update({
            where: { id: u.id },
            data: { paidAmount: u.paidAmount, status: u.status },
          });
        }
        return tx.loan.update({
          where: { id: loan.id },
          data: {
            paidAmount: recompute.paidAmount,
            interestReceived: recompute.interestReceived,
            extraReceived: recompute.extraReceived,
            status: recompute.status,
          },
          include: LOAN_INCLUDE,
        });
      });
      return annotateOverdue(result);
    } catch (err) {
      if (err.code === 'P2002') throw new AppError(ALREADY_REVERSED, 409);
      throw err;
    }
  }
```

- [ ] **Step 3: Controlador `reversePayment` en `loanController.js`**

Añadir antes de `module.exports`:

```js
const reversePayment = async (req, res, next) => {
  try {
    const result = await loanService.reversePayment(req.params.id, req.body.reason, req.user.id);
    res.status(201).json(result);
  } catch (err) { next(err); }
};
```

Y actualizar el export para incluir `reversePayment`:

```js
module.exports = { create, list, findById, addPayment, cancel, reversePayment };
```

- [ ] **Step 4: Ruta nueva `loanPayments.js`**

Crear `backend/src/routes/loanPayments.js` (replicando cómo `routes/treasury.js` importa `authorize`, `validate`, `schemas`):

```js
const { Router } = require('express');
const ctrl = require('../controllers/loanController');
const { authorize } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = Router();

router.post('/:id/reverse', authorize('ADMIN'), validate(schemas.treasuryDestructive), ctrl.reversePayment);

module.exports = router;
```

Montar en `backend/src/routes/index.js`, después de la línea `router.use('/loans', require('./loans'));`:

```js
router.use('/loan-payments', require('./loanPayments'));
```

- [ ] **Step 5: Helpers e2e en `tests/helpers/api.ts`**

En la interface `Loan`, añadir el campo `payments` después de `installments: Array<…>,`:

```ts
  payments: Array<{
    id: string;
    principalAmount: string | number;
    extraAmount: string | number;
    reversedAt: string | null;
  }>;
```

Y añadir, junto a `apiAddLoanPayment`, dos helpers raw:

```ts
export async function apiReverseLoanPaymentRaw(
  token: string,
  paymentId: string,
  reason: string,
): Promise<{ status: number; body: { error?: string } }> {
  return apiRequestRaw('POST', `/loan-payments/${paymentId}/reverse`, token, { reason });
}

export async function apiReverseLoanRaw(
  token: string,
  loanId: string,
  reason: string,
): Promise<{ status: number; body: { error?: string } }> {
  return apiRequestRaw('POST', `/loans/${loanId}/reverse`, token, { reason });
}
```

- [ ] **Step 6: Escribir el e2e (reverso de pago) que falla**

Crear `tests/e2e/treasury/loan-reverse-api.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetAccount,
  apiCreateLoan,
  apiGetLoan,
  apiAddLoanPayment,
  apiReverseLoanPaymentRaw,
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

test.describe('Tesorería — reverso de pagos de préstamo (API)', () => {
  test('reversar un pago restaura saldo del préstamo y de la cuenta + crea compensatorio', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(2);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 1_000_000,
      interestRate: 0,
      installments: [
        { sequence: 1, dueDate: due[0], plannedAmount: 500_000 },
        { sequence: 2, dueDate: due[1], plannedAmount: 500_000 },
      ],
    });

    await apiAddLoanPayment(token, loan.id, {
      accountId: TEST_SEED_IDS.accountCash,
      principalAmount: 500_000,
    });

    const afterPay = await apiGetLoan(token, loan.id);
    expect(parseFloat(String(afterPay.paidAmount))).toBe(500_000);
    const paymentId = afterPay.payments[0].id;
    const cashAfterPay = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));

    const res = await apiReverseLoanPaymentRaw(token, paymentId, 'pago duplicado, corregir');
    expect(res.status).toBe(201);

    const afterReverse = await apiGetLoan(token, loan.id);
    expect(parseFloat(String(afterReverse.paidAmount))).toBe(0);
    expect(afterReverse.status).toBe('PENDING');
    expect(afterReverse.payments[0].reversedAt).not.toBeNull();
    expect(afterReverse.installments[0].status).toBe('PENDING');

    // El pago era INCOME a caja; su reverso es EXPENSE → la caja baja en 500k.
    const cashAfterReverse = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    expect(cashAfterReverse).toBe(cashAfterPay - 500_000);
  });

  test('doble reverso del mismo pago → 409', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(1);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 300_000,
      interestRate: 0,
      installments: [{ sequence: 1, dueDate: due[0], plannedAmount: 300_000 }],
    });
    await apiAddLoanPayment(token, loan.id, { accountId: TEST_SEED_IDS.accountCash, principalAmount: 100_000 });
    const paymentId = (await apiGetLoan(token, loan.id)).payments[0].id;

    expect((await apiReverseLoanPaymentRaw(token, paymentId, 'corrección de monto')).status).toBe(201);
    const second = await apiReverseLoanPaymentRaw(token, paymentId, 'corrección de monto');
    expect(second.status).toBe(409);
  });

  test('motivo corto (<10) → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(1);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 200_000,
      interestRate: 0,
      installments: [{ sequence: 1, dueDate: due[0], plannedAmount: 200_000 }],
    });
    await apiAddLoanPayment(token, loan.id, { accountId: TEST_SEED_IDS.accountCash, principalAmount: 100_000 });
    const paymentId = (await apiGetLoan(token, loan.id)).payments[0].id;
    expect((await apiReverseLoanPaymentRaw(token, paymentId, 'corto')).status).toBe(400);
  });

  test('pago inexistente → 404', async ({ page }) => {
    const token = await loginAsAdmin(page);
    expect((await apiReverseLoanPaymentRaw(token, 'noexiste', 'motivo suficiente largo')).status).toBe(404);
  });
});
```

- [ ] **Step 7: Correr unit + e2e**

Run: `cd backend && npm test 2>&1 | grep -E "# (tests|pass|fail)"`
Expected: `# fail 0`.

Liberar puertos y correr el e2e (Playwright administra sus servidores contra `autocontrol_test`):
```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
lsof -tiTCP:4000 -sTCP:LISTEN | xargs -r kill 2>/dev/null
lsof -tiTCP:5173 -sTCP:LISTEN | xargs -r kill 2>/dev/null
sleep 2
npx playwright test tests/e2e/treasury/loan-reverse-api.spec.ts --project=chromium 2>&1 | tail -15
```
Expected: `4 passed`.

- [ ] **Step 8: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add backend/src/services/loanService.js backend/src/controllers/loanController.js backend/src/routes/loanPayments.js backend/src/routes/index.js tests/helpers/api.ts tests/e2e/treasury/loan-reverse-api.spec.ts
git commit -m "feat(loans): reverso de pago individual (POST /loan-payments/:id/reverse)"
```

---

## Task 5: Reverso de préstamo completo en cascada (servicio + endpoint + e2e)

**Files:**
- Modify: `backend/src/services/loanService.js` (método `reverseLoan`)
- Modify: `backend/src/controllers/loanController.js`
- Modify: `backend/src/routes/loans.js`
- Modify: `tests/e2e/treasury/loan-reverse-api.spec.ts` (describe nuevo)

**Interfaces:**
- Consumes: `applyReversalInTx`, `ALREADY_REVERSED`; `apiReverseLoanRaw` (Task 4).
- Produces: `loanService.reverseLoan(loanId, reason, userId): Promise<Loan>`; ruta `POST /api/loans/:id/reverse` (ADMIN, motivo ≥10).

- [ ] **Step 1: Método `reverseLoan` en `LoanService`**

Añadir después de `reversePayment`:

```js
  async reverseLoan(loanId, reason, userId) {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        installments: true,
        payments: { where: { reversedAt: null }, include: { transactions: true } },
        transactions: { where: { category: 'LOAN_DISBURSEMENT', reversesTransactionId: null } },
      },
    });
    if (!loan) throw new AppError('Préstamo no encontrado', 404);
    if (loan.status === 'CANCELLED') throw new AppError('El préstamo ya fue reversado.', 409);

    const disbursementTxns = loan.transactions;
    const paymentTxns = loan.payments.flatMap((p) => p.transactions);
    const sources = [...disbursementTxns, ...paymentTxns];
    if (sources.length === 0) {
      throw new AppError('El préstamo no tiene movimientos para reversar.', 400);
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        await applyReversalInTx(tx, {
          sources,
          reason,
          userId,
          category: 'LOAN_REVERSAL',
          auditEntityType: 'LOAN',
          auditEntityId: loanId,
        });
        const now = new Date();
        for (const p of loan.payments) {
          await tx.loanPayment.update({
            where: { id: p.id },
            data: { reversedAt: now, reversedBy: userId, reverseReason: reason },
          });
        }
        for (const inst of loan.installments) {
          await tx.loanInstallment.update({
            where: { id: inst.id },
            data: { paidAmount: 0, status: 'PENDING' },
          });
        }
        return tx.loan.update({
          where: { id: loanId },
          data: { paidAmount: 0, interestReceived: 0, extraReceived: 0, status: 'CANCELLED' },
          include: LOAN_INCLUDE,
        });
      });
      return annotateOverdue(result);
    } catch (err) {
      if (err.code === 'P2002') throw new AppError(ALREADY_REVERSED, 409);
      throw err;
    }
  }
```

- [ ] **Step 2: Controlador `reverseLoan`**

En `loanController.js`, añadir antes de `module.exports`:

```js
const reverseLoan = async (req, res, next) => {
  try {
    const result = await loanService.reverseLoan(req.params.id, req.body.reason, req.user.id);
    res.status(201).json(result);
  } catch (err) { next(err); }
};
```

Actualizar el export:

```js
module.exports = { create, list, findById, addPayment, cancel, reversePayment, reverseLoan };
```

- [ ] **Step 3: Ruta en `loans.js`**

`backend/src/routes/loans.js` importa hoy `validate, schemas` y `ctrl`. Añadir también `authorize` al require de middleware/auth si no está, y registrar la ruta después de `router.post('/:id/cancel', ctrl.cancel);`:

```js
router.post('/:id/reverse', authorize('ADMIN'), validate(schemas.treasuryDestructive), ctrl.reverseLoan);
```

(Si `loans.js` no importa `authorize`, añadir `const { authorize } = require('../middleware/auth');` al tope, igual que en `routes/treasury.js`.)

- [ ] **Step 4: Escribir el e2e (cascada) que falla**

Añadir al final de `tests/e2e/treasury/loan-reverse-api.spec.ts`, importando `apiReverseLoanRaw` (añadir al import existente):

```ts
test.describe('Tesorería — reverso de préstamo completo (cascada, API)', () => {
  test('anular préstamo con pago compensa desembolso + pago y restaura la caja', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(2);
    const cashBefore = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));

    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 1_000_000,
      interestRate: 0,
      installments: [
        { sequence: 1, dueDate: due[0], plannedAmount: 500_000 },
        { sequence: 2, dueDate: due[1], plannedAmount: 500_000 },
      ],
    });
    await apiAddLoanPayment(token, loan.id, { accountId: TEST_SEED_IDS.accountCash, principalAmount: 400_000 });

    const res = await apiReverseLoanRaw(token, loan.id, 'préstamo cargado por error');
    expect(res.status).toBe(201);

    const after = await apiGetLoan(token, loan.id);
    expect(after.status).toBe('CANCELLED');
    expect(parseFloat(String(after.paidAmount))).toBe(0);
    expect(after.payments.every((p) => p.reversedAt !== null)).toBe(true);
    expect(after.installments.every((i) => i.status === 'PENDING')).toBe(true);

    // Desembolso (-1M) + pago (+400k) revertidos → la caja vuelve a su saldo inicial.
    const cashAfter = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    expect(cashAfter).toBe(cashBefore);
  });

  test('doble anulación del mismo préstamo → 409', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(1);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 200_000,
      interestRate: 0,
      installments: [{ sequence: 1, dueDate: due[0], plannedAmount: 200_000 }],
    });
    expect((await apiReverseLoanRaw(token, loan.id, 'cargado por error')).status).toBe(201);
    expect((await apiReverseLoanRaw(token, loan.id, 'cargado por error')).status).toBe(409);
  });

  test('reversar un pago de un préstamo ya anulado → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const due = isoDueDates(1);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 200_000,
      interestRate: 0,
      installments: [{ sequence: 1, dueDate: due[0], plannedAmount: 200_000 }],
    });
    await apiAddLoanPayment(token, loan.id, { accountId: TEST_SEED_IDS.accountCash, principalAmount: 100_000 });
    const paymentId = (await apiGetLoan(token, loan.id)).payments[0].id;
    expect((await apiReverseLoanRaw(token, loan.id, 'cargado por error')).status).toBe(201);
    expect((await apiReverseLoanPaymentRaw(token, paymentId, 'corrección tardía')).status).toBe(400);
  });
});
```

- [ ] **Step 5: Correr e2e completo del archivo**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
lsof -tiTCP:4000 -sTCP:LISTEN | xargs -r kill 2>/dev/null
lsof -tiTCP:5173 -sTCP:LISTEN | xargs -r kill 2>/dev/null
sleep 2
npx playwright test tests/e2e/treasury/loan-reverse-api.spec.ts --project=chromium 2>&1 | tail -15
```
Expected: `7 passed` (4 de pago + 3 de cascada).

- [ ] **Step 6: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add backend/src/services/loanService.js backend/src/controllers/loanController.js backend/src/routes/loans.js tests/e2e/treasury/loan-reverse-api.spec.ts
git commit -m "feat(loans): reverso de préstamo completo en cascada (POST /loans/:id/reverse)"
```

---

## Definition of Done (Fase 2 backend)

- [ ] Motor expone `applyReversalInTx`; `applyReversal` lo envuelve (sin cambio externo).
- [ ] Migración `loan_reversal` (campos + índice parcial) aplicada en dev y test.
- [ ] `recomputeLoanFromPayments` cubierto por unit tests.
- [ ] `POST /loan-payments/:id/reverse` y `POST /loans/:id/reverse` operativos (ADMIN, motivo ≥10), atómicos, con audit `REVERSE` y backstop `P2002 → 409`.
- [ ] `npm test` verde; `loan-reverse-api.spec.ts` 7/7.

## Notas / Fuera de alcance

- **UI (Fase 2b):** botón `<ReverseAction>` + badge "Reversado" en la pantalla de préstamos y la lista de pagos — plan aparte. Esta fase deja el backend usable por API.
- **`cancel` heredado:** `POST /loans/:id/cancel` (solo PENDING, NO compensa el desembolso) queda intacto para no romper consumidores. Bajo la política de storno es contablemente incompleto; evaluar reemplazarlo por `reverse` en Fase 2b/6. No tocar en esta fase.
- **`tierStatus`** duplica la lógica de `recomputeLoanStatus`/`recomputeInstallmentStatus` de `loanService.js` (3 líneas). Se acepta para no arriesgar un refactor de los exports existentes; consolidar es candidato de Fase 6.
