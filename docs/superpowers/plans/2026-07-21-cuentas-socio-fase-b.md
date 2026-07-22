# Cuentas de socio — FASE B: entrada de ganancias/comisiones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al pagar una CxP `PARTNER_SHARE` o `COMMISSION` a un tercero con cuenta SOCIO activa, el dinero salga de la cuenta de la empresa y entre a la cuenta del socio, preservando la categoría (`PARTNER_SHARE`/`COMMISSION`) en ambos asientos.

**Architecture:** Un helper puro (`buildPaymentTransactions`) decide los asientos (1 egreso simple, o egreso empresa + ingreso socio). `payableService.addPayment` resuelve la cuenta SOCIO del tercero y usa el helper. `treasuryReportService` excluye las cuentas SOCIO de los sumarios brutos (son capital del socio, no flujo de la empresa). El frontend muestra "Entra a: Cuenta Socio — {nombre}" y saca las cuentas SOCIO del selector de origen.

**Tech Stack:** Node.js + Express + Prisma (CommonJS backend); React + Vite (frontend); node:test (unit backend); Playwright (E2E, API-driven).

## Global Constraints

- Backend en CommonJS (`require`/`module.exports`), no ES Modules.
- Moneda COP en enteros (sin decimales).
- **Preservar categorías** `PARTNER_SHARE`/`COMMISSION` en los dos asientos del enrutamiento — NO usar `TRANSFER`/`TRANSFER_IN`/`TRANSFER_OUT`.
- Las cuentas `type: 'SOCIO'` son capital del socio: excluidas del total de tesorería (FASE A) y de los sumarios brutos de flujo.
- La regla de enrutamiento aplica sólo a CxP **no** `RECEIVABLE` cuyo tercero tenga cuenta SOCIO **activa**.
- Cuenta origen ≠ cuenta socio destino (400 si coinciden).
- Sin cambios de schema ni migraciones (se apoya en `Account.thirdPartyId` + `type: 'SOCIO'` de FASE A).
- El `PayablePayment` se liga a la transacción de **EGRESO** (la que salda la CxP).

---

### Task 1: Helper puro `buildPaymentTransactions`

**Files:**
- Create: `backend/src/services/payablePaymentEntries.js`
- Test: `backend/src/services/__tests__/payablePaymentEntries.test.js`

**Interfaces:**
- Consumes: `AppError` de `../middleware/errorHandler`.
- Produces: `buildPaymentTransactions(input) -> { entries: Array<TxData>, paymentTransactionIndex: number }`.
  - `input`: `{ transactionType: 'INCOME'|'EXPENSE', transactionCategory: string, accountId: string, socioAccount: {id:string}|null, isReceivable: boolean, paymentAmount: number, description: string|null, payableDescription: string|null, date: Date, vehicleId: string|null, thirdPartyId: string|null, userId: string }`.
  - `TxData`: `{ accountId, type, category, amount, description, date, vehicleId, thirdPartyId, createdBy }` (forma exacta que consume `tx.transaction.create({ data })`).
  - Enrutado (`!isReceivable && socioAccount != null`) → `entries = [egresoEmpresa, ingresoSocio]`, ambos con `category === transactionCategory`; lanza `AppError(400)` si `accountId === socioAccount.id`.
  - No enrutado → `entries = [único asiento]` con `type === transactionType`.
  - `paymentTransactionIndex` siempre `0` (el egreso/único asiento va primero).

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/payablePaymentEntries.test.js`:

```js
'use strict';
// buildPaymentTransactions — helper puro que decide los asientos de un pago.
// FASE B: un pago de PARTNER_SHARE/COMMISSION a un tercero con cuenta SOCIO
// activa genera EGRESO (empresa) + INGRESO (socio) con la MISMA categoría.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPaymentTransactions } = require('../payablePaymentEntries');
const { AppError } = require('../../middleware/errorHandler');

const base = (over = {}) => ({
  transactionType: 'EXPENSE',
  transactionCategory: 'PARTNER_SHARE',
  accountId: 'acc-empresa',
  socioAccount: { id: 'acc-socio' },
  isReceivable: false,
  paymentAmount: 6_400_000,
  description: null,
  payableDescription: 'Ganancia socio venta ABC123',
  date: new Date('2026-07-21T12:00:00'),
  vehicleId: 'veh-1',
  thirdPartyId: 'tp-socio',
  userId: 'user-1',
  ...over,
});

test('PARTNER_SHARE con cuenta socio → EGRESO empresa + INGRESO socio, misma categoría', () => {
  const { entries, paymentTransactionIndex } = buildPaymentTransactions(base());
  assert.equal(entries.length, 2);
  assert.equal(paymentTransactionIndex, 0);

  const [egreso, ingreso] = entries;
  assert.equal(egreso.type, 'EXPENSE');
  assert.equal(egreso.accountId, 'acc-empresa');
  assert.equal(egreso.category, 'PARTNER_SHARE');
  assert.equal(egreso.amount, 6_400_000);

  assert.equal(ingreso.type, 'INCOME');
  assert.equal(ingreso.accountId, 'acc-socio');
  assert.equal(ingreso.category, 'PARTNER_SHARE');
  assert.equal(ingreso.amount, 6_400_000);
  assert.match(ingreso.description, /cuenta socio/i);
});

test('COMMISSION con cuenta socio → categoría COMMISSION en ambos asientos', () => {
  const { entries } = buildPaymentTransactions(base({ transactionCategory: 'COMMISSION' }));
  assert.equal(entries[0].category, 'COMMISSION');
  assert.equal(entries[1].category, 'COMMISSION');
});

test('sin cuenta socio → un solo asiento (comportamiento actual)', () => {
  const { entries, paymentTransactionIndex } = buildPaymentTransactions(base({ socioAccount: null }));
  assert.equal(entries.length, 1);
  assert.equal(paymentTransactionIndex, 0);
  assert.equal(entries[0].type, 'EXPENSE');
  assert.equal(entries[0].accountId, 'acc-empresa');
});

test('RECEIVABLE nunca enruta (aunque haya cuenta socio) → un solo INGRESO a la empresa', () => {
  const { entries } = buildPaymentTransactions(base({
    isReceivable: true, transactionType: 'INCOME', transactionCategory: 'OTHER_INCOME',
  }));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, 'INCOME');
  assert.equal(entries[0].accountId, 'acc-empresa');
});

test('cuenta origen === cuenta socio destino → AppError 400', () => {
  assert.throws(
    () => buildPaymentTransactions(base({ accountId: 'acc-socio' })),
    (e) => e instanceof AppError && e.statusCode === 400 && /socio/i.test(e.message),
  );
});

test('conservación: egreso e ingreso mueven el mismo monto (neto empresa+socio = 0)', () => {
  const { entries } = buildPaymentTransactions(base());
  const delta = entries.reduce((s, e) => s + (e.type === 'INCOME' ? e.amount : -e.amount), 0);
  assert.equal(delta, 0);
});

test('description explícita se respeta y el ingreso la prefija', () => {
  const { entries } = buildPaymentTransactions(base({ description: 'Pago mano' }));
  assert.equal(entries[0].description, 'Pago mano');
  assert.equal(entries[1].description, 'Entrada a cuenta socio — Pago mano');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/__tests__/payablePaymentEntries.test.js`
Expected: FAIL — `Cannot find module '../payablePaymentEntries'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/services/payablePaymentEntries.js`:

```js
// ═══════════════════════════════════════════════════════════════
// buildPaymentTransactions — decide los asientos de tesorería de un
// pago de CxC/CxP. Puro (no toca la DB): el caller crea las
// transacciones y liga el PayablePayment al índice `paymentTransactionIndex`.
//
// FASE B: si la CxP no es RECEIVABLE y el tercero tiene cuenta SOCIO
// activa, el pago es EGRESO (cuenta empresa elegida) + INGRESO (cuenta
// socio), preservando la categoría (PARTNER_SHARE/COMMISSION) en ambos.
// ═══════════════════════════════════════════════════════════════

const { AppError } = require('../middleware/errorHandler');

function buildPaymentTransactions({
  transactionType,
  transactionCategory,
  accountId,
  socioAccount,
  isReceivable,
  paymentAmount,
  description,
  payableDescription,
  date,
  vehicleId,
  thirdPartyId,
  userId,
}) {
  const baseDesc =
    description || `Pago ${isReceivable ? 'recibido' : 'realizado'}: ${payableDescription || ''}`;

  const routed = !isReceivable && socioAccount != null;

  if (!routed) {
    return {
      entries: [
        {
          accountId,
          type: transactionType,
          category: transactionCategory,
          amount: paymentAmount,
          description: baseDesc,
          date,
          vehicleId,
          thirdPartyId,
          createdBy: userId,
        },
      ],
      paymentTransactionIndex: 0,
    };
  }

  if (accountId === socioAccount.id) {
    throw new AppError('La cuenta origen no puede ser la cuenta del socio destino.', 400);
  }

  const egreso = {
    accountId,
    type: 'EXPENSE',
    category: transactionCategory,
    amount: paymentAmount,
    description: baseDesc,
    date,
    vehicleId,
    thirdPartyId,
    createdBy: userId,
  };
  const ingreso = {
    accountId: socioAccount.id,
    type: 'INCOME',
    category: transactionCategory,
    amount: paymentAmount,
    description: `Entrada a cuenta socio — ${baseDesc}`,
    date,
    vehicleId,
    thirdPartyId,
    createdBy: userId,
  };

  return { entries: [egreso, ingreso], paymentTransactionIndex: 0 };
}

module.exports = { buildPaymentTransactions };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/services/__tests__/payablePaymentEntries.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/payablePaymentEntries.js backend/src/services/__tests__/payablePaymentEntries.test.js
git commit -m "feat: helper buildPaymentTransactions para enrutar pagos a cuenta socio (FASE B)"
```

---

### Task 2: Integrar el enrutamiento en `payableService.addPayment`

**Files:**
- Modify: `backend/src/services/payableService.js:196-236`
- Test: `backend/src/services/__tests__/payableService.addPayment.socio.test.js`

**Interfaces:**
- Consumes: `buildPaymentTransactions` de `./payablePaymentEntries` (Task 1).
- Produces: `addPayment` sin cambio de firma. Cuando enruta, crea 2 transacciones; `result.transaction` sigue siendo el **egreso** (índice `paymentTransactionIndex`), y `PayablePayment.transactionId` apunta a ese egreso.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/payableService.addPayment.socio.test.js`:

```js
'use strict';
// addPayment — enrutamiento a cuenta socio (FASE B). Mismo patrón de
// reemplazo del módulo `../../config/database` (y stubs de txLocks,
// treasuryAudit, accountService) que saleService.cancel.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let ctx; // { payable, socioAccount } fijado por test
const created = []; // transacciones creadas dentro de la tx
let paymentRow = null;

const tx = {
  payable: {
    findUnique: async () => ctx.payable,
    update: async ({ data }) => ({ ...ctx.payable, ...data, payments: [] }),
  },
  account: {
    findFirst: async ({ where }) =>
      where.type === 'SOCIO' && where.thirdPartyId === ctx.payable.thirdPartyId && where.isActive
        ? ctx.socioAccount
        : null,
  },
  transaction: {
    create: async ({ data }) => {
      const row = { id: `tx-${created.length + 1}`, ...data };
      created.push(row);
      return row;
    },
  },
  payablePayment: {
    create: async ({ data }) => {
      paymentRow = { id: 'pp-1', ...data };
      return paymentRow;
    },
  },
};

const fakePrisma = {
  account: { findUnique: async () => ({ id: 'acc-empresa', isActive: true }) },
  $transaction: async (fn) => fn(tx),
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

const locksPath = require.resolve('../../utils/txLocks');
require.cache[locksPath] = {
  id: locksPath, filename: locksPath, loaded: true,
  exports: { lockRow: async () => {} },
};

const auditPath = require.resolve('../../utils/treasuryAudit');
require.cache[auditPath] = {
  id: auditPath, filename: auditPath, loaded: true,
  exports: { writeTreasuryAudit: async () => {}, snapshotEntity: (x) => x },
};

const acctPath = require.resolve('../accountService');
require.cache[acctPath] = {
  id: acctPath, filename: acctPath, loaded: true,
  exports: { calculateBalance: async () => 1_000_000_000 },
};

const payableService = require('../payableService');

function resetCtx(over = {}) {
  created.length = 0;
  paymentRow = null;
  ctx = {
    payable: {
      id: 'pay-1', type: 'PARTNER_SHARE', status: 'PENDING',
      totalAmount: 6_400_000, paidAmount: 0, vehicleId: 'veh-1',
      thirdPartyId: 'tp-socio', description: 'Ganancia socio venta ABC',
      vehicle: { id: 'veh-1', plate: 'ABC' }, thirdParty: { id: 'tp-socio', name: 'Mamá' },
    },
    socioAccount: { id: 'acc-socio', type: 'SOCIO', thirdPartyId: 'tp-socio', isActive: true },
    ...over,
  };
}

test('PARTNER_SHARE a tercero con cuenta socio → crea egreso empresa + ingreso socio; pago liga el egreso', async () => {
  resetCtx();
  const result = await payableService.addPayment(
    'pay-1', { accountId: 'acc-empresa', amount: 6_400_000, date: '2026-07-21' }, 'user-1',
  );

  assert.equal(created.length, 2);
  const egreso = created.find((t) => t.type === 'EXPENSE');
  const ingreso = created.find((t) => t.type === 'INCOME');
  assert.equal(egreso.accountId, 'acc-empresa');
  assert.equal(egreso.category, 'PARTNER_SHARE');
  assert.equal(ingreso.accountId, 'acc-socio');
  assert.equal(ingreso.category, 'PARTNER_SHARE');
  assert.equal(ingreso.amount, 6_400_000);

  // PayablePayment liga el EGRESO (el que salda la CxP), no el ingreso.
  assert.equal(paymentRow.transactionId, egreso.id);
  assert.equal(result.transaction.type, 'EXPENSE');
});

test('tercero SIN cuenta socio → un solo egreso (sin ingreso)', async () => {
  resetCtx({ socioAccount: null });
  await payableService.addPayment(
    'pay-1', { accountId: 'acc-empresa', amount: 6_400_000, date: '2026-07-21' }, 'user-1',
  );
  assert.equal(created.length, 1);
  assert.equal(created[0].type, 'EXPENSE');
});

test('cuenta origen === cuenta socio destino → 400', async () => {
  resetCtx();
  await assert.rejects(
    () => payableService.addPayment(
      'pay-1', { accountId: 'acc-socio', amount: 6_400_000, date: '2026-07-21' }, 'user-1',
    ),
    (e) => e.statusCode === 400 && /socio/i.test(e.message),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/__tests__/payableService.addPayment.socio.test.js`
Expected: FAIL — hoy `addPayment` crea una sola transacción (`created.length === 1`), y no resuelve la cuenta socio, así que el primer test falla en `assert.equal(created.length, 2)`.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/services/payableService.js`, add the require near the top (after line 9, `const { lockRow } = require('../utils/txLocks');`):

```js
const { buildPaymentTransactions } = require('./payablePaymentEntries');
```

Then replace the block from line 214 (`// 1. Crear la transaccion de tesoreria`) through line 236 (the end of the `payablePayment.create`) with:

```js
    // Enrutamiento FASE B: si la CxP no es RECEIVABLE y el tercero tiene una
    // cuenta SOCIO activa, el pago sale de la cuenta de la empresa y entra a
    // la cuenta del socio, preservando la categoría en ambos asientos.
    const socioAccount = (!isReceivable && payable.thirdPartyId)
      ? await tx.account.findFirst({
          where: { type: 'SOCIO', thirdPartyId: payable.thirdPartyId, isActive: true },
        })
      : null;

    const { entries, paymentTransactionIndex } = buildPaymentTransactions({
      transactionType,
      transactionCategory,
      accountId,
      socioAccount,
      isReceivable,
      paymentAmount,
      description,
      payableDescription: payable.description,
      date: parseLocalDate(date),
      vehicleId: payable.vehicleId,
      thirdPartyId: payable.thirdPartyId,
      userId,
    });

    // 1. Crear la(s) transaccion(es) de tesoreria
    const createdTransactions = [];
    for (const data of entries) {
      createdTransactions.push(await tx.transaction.create({ data }));
    }
    // La transacción que salda la CxP (egreso/único asiento) liga el pago.
    const transaction = createdTransactions[paymentTransactionIndex];

    // 2. Crear el registro de pago
    const payment = await tx.payablePayment.create({
      data: {
        payableId,
        transactionId: transaction.id,
        amount: paymentAmount
      }
    });
```

(The `const transaction`/`const payment` names are unchanged, so the rest of the function — `updatedPayable`, `writeTreasuryAudit`, and `return { payable: updatedPayable, transaction, payment }` — keeps working without edits.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/services/__tests__/payableService.addPayment.socio.test.js`
Expected: PASS — 3 tests.

Also run the existing payable/sale suites to confirm no regression:

Run: `cd backend && node --test src/services/__tests__/payableService.getSummary.test.js src/services/__tests__/investorService.test.js src/services/__tests__/saleService.receivable.test.js`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/payableService.js backend/src/services/__tests__/payableService.addPayment.socio.test.js
git commit -m "feat: addPayment enruta ganancias/comisiones a la cuenta del socio (FASE B)"
```

---

### Task 3: Excluir cuentas SOCIO de los sumarios brutos de tesorería

**Files:**
- Modify: `backend/src/services/treasuryReportService.js:28-35` (getDashboard groupBy) y `:90-97` (getCashFlow findMany)
- Test: `backend/src/services/__tests__/treasuryReportService.socio.test.js`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `getDashboard().month` y `getCashFlow()` excluyen del bruto las transacciones cuya cuenta es `type: 'SOCIO'`, vía filtro Prisma `account: { type: { not: 'SOCIO' } }`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/treasuryReportService.socio.test.js`:

```js
'use strict';
// treasuryReportService — los sumarios brutos (mensual / flujo) NO deben
// contar movimientos de cuentas SOCIO (capital del socio, no flujo de la
// empresa). FASE B introduce ingresos a cuentas SOCIO al pagar ganancias.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let groupByWhere = null;
let findManyWhere = null;

const fakePrisma = {
  transaction: {
    groupBy: async ({ where }) => { groupByWhere = where; return []; },
    findMany: async ({ where }) => { findManyWhere = where; return []; },
  },
  setting: { findUnique: async () => null },
  vehicle: { findMany: async () => [] },
  expense: { aggregate: async () => ({ _sum: { amount: 0 } }) },
};

const dbPath = require.resolve('../../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePrisma };

// accountService.findAll lo usa getDashboard para totalBalance; stub simple.
const acctPath = require.resolve('../accountService');
require.cache[acctPath] = {
  id: acctPath, filename: acctPath, loaded: true,
  exports: { findAll: async () => [], getTotalBalance: async () => 0 },
};

const svc = require('../treasuryReportService');

test('getDashboard: el groupBy mensual excluye cuentas type SOCIO', async () => {
  await svc.getDashboard();
  assert.deepEqual(groupByWhere.account, { type: { not: 'SOCIO' } });
});

test('getCashFlow: el findMany del período excluye cuentas type SOCIO', async () => {
  await svc.getCashFlow({ period: 'week' });
  assert.deepEqual(findManyWhere.account, { type: { not: 'SOCIO' } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/__tests__/treasuryReportService.socio.test.js`
Expected: FAIL — hoy `where` no incluye `account`, así que `groupByWhere.account` es `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/services/treasuryReportService.js`, in `getDashboard`, update the `groupBy` `where` (currently lines 30-34) to add the account filter:

```js
      where: {
        date: { gte: startOfMonth, lte: endOfMonth },
        type: { in: ['INCOME', 'EXPENSE'] },
        // Excluir capital del socio: sus cuentas no son flujo de la empresa.
        account: { type: { not: 'SOCIO' } },
      },
```

In `getCashFlow`, update the `findMany` `where` (currently lines 91-94):

```js
      where: {
        date: { gte: start, lte: end },
        type: { in: ['INCOME', 'EXPENSE'] },
        account: { type: { not: 'SOCIO' } },
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/services/__tests__/treasuryReportService.socio.test.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/treasuryReportService.js backend/src/services/__tests__/treasuryReportService.socio.test.js
git commit -m "fix: excluir cuentas SOCIO de los sumarios brutos de tesoreria (FASE B)"
```

---

### Task 4: Frontend — "Entra a: Cuenta Socio — {nombre}" y excluir SOCIO del origen

**Files:**
- Modify: `frontend/src/components/treasury/PaymentModal.jsx`
- Modify: `frontend/src/components/treasury/PayablesList.jsx:212-226`

**Interfaces:**
- Consumes: la lista de cuentas ya cargada por `PaymentModal` (incluye `type` y `thirdPartyId` por cuenta, tal como los devuelve `accountService.findAll`).
- Produces: `PaymentModal` acepta dos props nuevas opcionales — `payableType?: string`, `thirdPartyId?: string`. Cuando `type === 'expense'`, `payableType ∈ {'PARTNER_SHARE','COMMISSION'}` y existe una cuenta `SOCIO` activa de ese `thirdPartyId`: (a) muestra la línea "Entra a: {nombre cuenta}"; (b) oculta las cuentas `SOCIO` del selector de origen.

**Nota de verificación:** el repo no tiene runner de unit tests de frontend; la cobertura automática de esta tarea es el E2E de Task 5. Además hay una verificación manual en el Step 3.

- [ ] **Step 1: Añadir props y lógica de cuenta socio destino en `PaymentModal.jsx`**

Update the component signature (lines 10-20) to accept the two new props:

```jsx
export default function PaymentModal({
  isOpen,
  onClose,
  onSubmit,
  title = 'Registrar Pago',
  type = 'expense', // 'expense' | 'income'
  totalAmount = 0,
  paidAmount = 0,
  defaultDescription = '',
  loading = false,
  payableType = null,
  thirdPartyId = null,
}) {
```

After `const isIncome = type === 'income';` (line 31), add the derived socio-destination logic:

```jsx
  // FASE B: si esta CxP es ganancia/comisión de un socio con cuenta SOCIO
  // activa, el pago entra a esa cuenta. El origen se limita a cuentas de la
  // empresa (se ocultan las SOCIO del selector).
  const routesToSocio = !isIncome && (payableType === 'PARTNER_SHARE' || payableType === 'COMMISSION');
  const socioDestAccount = routesToSocio
    ? accounts.find((a) => a.type === 'SOCIO' && a.thirdPartyId === thirdPartyId && a.isActive)
    : null;
  const originAccounts = socioDestAccount ? accounts.filter((a) => a.type !== 'SOCIO') : accounts;
```

Replace the account `<select>` options source (line 154, `{accounts.map((a) => (`) with `originAccounts`:

```jsx
            {originAccounts.map((a) => (
```

Add the info line immediately after the closing `</select>` of the Cuenta block (after line 159 `</select>`, before the closing `</div>` on line 160):

```jsx
            {socioDestAccount && (
              <p className="mt-1 text-xs text-green-400" data-testid="payment-modal-socio-dest">
                Entra a: {socioDestAccount.name}
              </p>
            )}
```

- [ ] **Step 2: Pasar las props desde `PayablesList.jsx`**

In `frontend/src/components/treasury/PayablesList.jsx`, extend the `<PaymentModal ... />` (lines 213-225) to pass the payable's type and third party:

```jsx
        <PaymentModal
          isOpen={showPaymentModal}
          onClose={() => {
            setShowPaymentModal(false);
            setSelectedPayable(null);
          }}
          onSubmit={handlePaymentSubmit}
          title={isReceivable ? 'Registrar Cobro' : 'Registrar Pago'}
          type={isReceivable ? 'income' : 'expense'}
          totalAmount={parseFloat(selectedPayable.totalAmount)}
          paidAmount={parseFloat(selectedPayable.paidAmount)}
          defaultDescription={selectedPayable.description || ''}
          payableType={selectedPayable.type}
          thirdPartyId={selectedPayable.thirdPartyId}
          loading={processingPayment}
        />
```

- [ ] **Step 3: Verify (build + manual)**

Run: `cd frontend && npm run build`
Expected: build OK, sin errores de sintaxis/imports.

Manual (con backend+frontend levantados por el usuario en sus terminales): abrir Tesorería → Cuentas por pagar → una CxP tipo "Ganancia socio" de un socio con cuenta SOCIO activa → "Registrar Pago". Esperado: bajo el selector de cuenta aparece "Entra a: Cuenta Socio — {nombre}", y el selector de origen no lista cuentas SOCIO. Para una CxP normal (proveedor) no aparece la línea y el selector no cambia.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/treasury/PaymentModal.jsx frontend/src/components/treasury/PayablesList.jsx
git commit -m "feat: modal de pago muestra destino cuenta socio y oculta SOCIO del origen (FASE B)"
```

---

### Task 5: E2E — la ganancia del socio entra a su cuenta SOCIO

**Files:**
- Modify: `tests/e2e/treasury/socio.spec.ts` (añadir un test; reutiliza `buyVehicleWithSocio`/`sellSocioVehicleCash` ya presentes)

**Interfaces:**
- Consumes: helpers de `../../helpers/api` y `TEST_SEED_IDS` (incluye `partner`, `partnerAccount` = cuenta SOCIO sembrada del partner, y `accountCash`).
- Produces: cobertura E2E del flujo completo (backend enruta + saldo de la cuenta socio sube).

- [ ] **Step 1: Ampliar los imports del spec**

In `tests/e2e/treasury/socio.spec.ts`, add the needed helpers to the existing import block (lines 2-10):

```ts
import {
  apiPinLogin,
  apiCreateVehicle,
  apiRegisterSale,
  apiListPayables,
  apiListInvestors,
  apiGetPayablesSummary,
  apiGetVehiclePaymentStatus,
  apiRequestRaw,
  apiGetAccount,
  apiListTransactions,
} from '../../helpers/api';
```

- [ ] **Step 2: Write the failing test**

Add this test at the end of the file's top-level `describe`/block (after the existing `PARTNER_SHARE` payment test, near line 175):

```ts
  test('FASE B: pagar la ganancia del socio ENTRA a su cuenta SOCIO (egreso empresa + ingreso socio)', async () => {
    const token = await apiPinLogin();
    const v = await buyVehicleWithSocio(token, plate('SOB'), {
      partnerId: TEST_SEED_IDS.partner,
      participation: 0.6,
    });
    await sellSocioVehicleCash(token, v.id);

    const payables = await apiListPayables(token, { vehicleId: v.id, type: 'PARTNER_SHARE' });
    expect(payables).toHaveLength(1);
    const partnerShare = payables[0];
    const amount = Number(partnerShare.totalAmount);

    const socioBefore = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
    const balBefore = Number(socioBefore.currentBalance);

    const pay = await apiRequestRaw('POST', `/payables/${partnerShare.id}/payments`, token, {
      accountId: TEST_SEED_IDS.accountCash, // cuenta empresa (origen ≠ cuenta socio)
      amount,
      description: 'Pago ganancia socio FASE B',
    });
    expect(pay.status).toBe(201);

    // La transacción que salda la CxP sigue siendo el EGRESO categorizado.
    const body = pay.body as { transaction?: { category?: string; type?: string } };
    expect(body.transaction?.category).toBe('PARTNER_SHARE');
    expect(body.transaction?.type).toBe('EXPENSE');

    // La cuenta SOCIO subió por el monto pagado.
    const socioAfter = await apiGetAccount(token, TEST_SEED_IDS.partnerAccount);
    expect(Number(socioAfter.currentBalance)).toBe(balBefore + amount);

    // Y existe un INGRESO a la cuenta socio con categoría PARTNER_SHARE.
    const socioTxs = await apiListTransactions(token, { accountId: TEST_SEED_IDS.partnerAccount });
    const ingreso = socioTxs.find(
      (t) => t.type === 'INCOME' && t.category === 'PARTNER_SHARE' && Number(t.amount) === amount,
    );
    expect(ingreso).toBeTruthy();
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx playwright test ../tests/e2e/treasury/socio.spec.ts -g "FASE B"`
Expected: FAIL — antes de Task 2 el saldo de la cuenta socio no cambia (`balBefore + amount` ≠ `balBefore`) y no hay ingreso. (Si Task 2 ya está mergeado, correrá en VERDE; en ese caso confirmar que el test es significativo revisando que sin Task 2 fallaría.)

> Nota: verificar el comando exacto de Playwright del repo (`npx playwright test` desde la raíz o desde `frontend/`). Ajustar el path relativo al `playwright.config` real. El resto del spec ya se ejecuta en CI, así que replicar su invocación.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx playwright test ../tests/e2e/treasury/socio.spec.ts -g "FASE B"`
Expected: PASS.

Correr el spec completo para confirmar que el test existente de pago de `PARTNER_SHARE` (que paga desde `accountCash`) sigue en verde:

Run: `npx playwright test tests/e2e/treasury/socio.spec.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/treasury/socio.spec.ts
git commit -m "test(e2e): ganancia del socio entra a su cuenta SOCIO al pagar la CxP (FASE B)"
```

---

## Self-Review

**1. Spec coverage:**
- §3 regla de enrutamiento única → Task 1 (helper) + Task 2 (resolución `findFirst` con `isActive`). RECEIVABLE intacto → Task 1 test "RECEIVABLE nunca enruta" + Task 2 (`!isReceivable`).
- §4 mecánica preserva categorías → Task 1 (misma `category` en ambos) + Task 2 (usa `transactionCategory` ya resuelto).
- §5 guards: saldo (existente, sin tocar), origen≠destino (Task 1 400 + Task 2 test), inactiva no enruta (Task 2 `isActive:true` en `findFirst`), flujo/sumarios → Task 3.
- §6 UI → Task 4.
- §7 tests unit/E2E → Tasks 1,2,3 (unit) + Task 5 (E2E).
- §9 archivos → payableService (T2), payablePaymentEntries (T1), treasuryReportService (T3), PaymentModal/PayablesList (T4), socio.spec (T5). Sin schema/migraciones. ✔
- Follow-ups §8 quedan fuera de alcance por diseño. ✔

**2. Placeholder scan:** sin TBD/TODO; todo el código está completo. La única nota abierta es "verificar el comando exacto de Playwright" en T5 Step 3 — es una verificación de entorno legítima, no un placeholder de implementación.

**3. Type consistency:** `buildPaymentTransactions` firma idéntica en T1 (definición) y T2 (uso): mismas claves (`transactionType`, `transactionCategory`, `accountId`, `socioAccount`, `isReceivable`, `paymentAmount`, `description`, `payableDescription`, `date`, `vehicleId`, `thirdPartyId`, `userId`) y mismo retorno (`{ entries, paymentTransactionIndex }`). `TxData` coincide con la forma que consume `tx.transaction.create({ data })`. Props del modal (`payableType`, `thirdPartyId`) consistentes entre PaymentModal (T4 Step 1) y PayablesList (T4 Step 2).
