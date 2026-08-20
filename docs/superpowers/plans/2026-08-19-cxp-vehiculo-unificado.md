# CxP unificadas en el vehículo + sync de gasto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pagar una CxP ligada a un gasto deja el gasto en "pagado", y el tab Tesorería del vehículo muestra todas las CxP del vehículo con botón de pago (misma función que "Ver todas").

**Architecture:** Backend — `payableService.addPayment` sincroniza `expense.paid` cuando la CxP ligada a un gasto queda `PAID` (forward-only). Frontend — el tab Tesorería de `VehicleDetailPage` reemplaza las cards bespoke de CxP (compra + socio-ganancia) por el componente existente `PayablesList` alimentado con todas las CxP del vehículo (`type != RECEIVABLE`); conserva la CxC de venta, la card socio-comisión (cobrar) y los movimientos.

**Tech Stack:** Backend Node/Express + Prisma (CommonJS), tests con `node --test`. Frontend React 18 + Vite. E2E Playwright (root).

## Global Constraints

- Backend: CommonJS (`require`). Moneda COP sin decimales. Validación con Joi (no aplica aquí).
- Frontend: ES Modules. Alias `@` → `frontend/src`. Idioma UI: Español (Colombia).
- Sync del gasto es **forward-only**: `expense.paid = (newStatus === 'PAID')`. Nada de reverso.
- La lista unificada incluye **todas** las CxP del vehículo con `type !== 'RECEIVABLE'` (PAYABLE de compra, PAYABLE de gasto, PARTNER_SHARE, COMMISSION, PROFIT_SHARE, CAPITAL_RETURN, COMMISSION_RETURN).
- Conservar intactas: card "Venta (CxC)" (`paymentStatus.sale`), card "Socio — Comisión que debe" (`partnerCommissionPayable`, RECEIVABLE), lista de movimientos.
- `VIEWER` no puede pagar: sin botones de pago.
- Sin migración de base de datos.

---

### Task 1: Backend — sync `expense.paid` en `addPayment`

**Files:**
- Test: `backend/src/services/__tests__/payableService.addPayment.expenseSync.test.js` (crear)
- Modify: `backend/src/services/payableService.js` (función `addPayment`, dentro de la `$transaction`, tras `tx.payable.update`)

**Interfaces:**
- Consumes: `payableService.addPayment(payableId, { accountId, amount, date }, userId)` (ya existe).
- Produces: mismo retorno `{ payable, transaction, payment }`; efecto nuevo: si `payable.expenseId`, actualiza `expense.paid`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/src/services/__tests__/payableService.addPayment.expenseSync.test.js` (mismo patrón de reemplazo de módulos que `payableService.addPayment.socio.test.js`, añadiendo un mock de `tx.expense.update`):

```js
'use strict';
// addPayment — sincroniza expense.paid cuando la CxP está ligada a un gasto.
// Mismo patrón de stubs que payableService.addPayment.socio.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

let ctx;                 // { payable } fijado por test
const created = [];      // transacciones creadas
let expenseUpdate = null; // { where, data } de tx.expense.update

const tx = {
  payable: {
    findUnique: async () => ctx.payable,
    update: async ({ data }) => ({ ...ctx.payable, ...data, payments: [] }),
  },
  account: { findFirst: async () => null },
  transaction: {
    create: async ({ data }) => {
      const row = { id: `tx-${created.length + 1}`, ...data };
      created.push(row);
      return row;
    },
  },
  payablePayment: { create: async ({ data }) => ({ id: 'pp-1', ...data }) },
  expense: {
    update: async ({ where, data }) => {
      expenseUpdate = { where, data };
      return { id: where.id, ...data };
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
  expenseUpdate = null;
  ctx = {
    payable: {
      id: 'pay-1', type: 'PAYABLE', status: 'PENDING',
      totalAmount: 500_000, paidAmount: 0, vehicleId: 'veh-1',
      thirdPartyId: null, expenseId: 'exp-1', description: 'Gasto MECANICA - ABC',
      vehicle: { id: 'veh-1', plate: 'ABC' }, thirdParty: null,
    },
    ...over,
  };
}

test('pago total de CxP ligada a gasto → expense.paid = true', async () => {
  resetCtx();
  await payableService.addPayment(
    'pay-1', { accountId: 'acc-empresa', amount: 500_000, date: '2026-08-19' }, 'user-1',
  );
  assert.ok(expenseUpdate, 'debió actualizar el gasto');
  assert.equal(expenseUpdate.where.id, 'exp-1');
  assert.equal(expenseUpdate.data.paid, true);
});

test('pago parcial de CxP ligada a gasto → expense.paid = false', async () => {
  resetCtx();
  await payableService.addPayment(
    'pay-1', { accountId: 'acc-empresa', amount: 200_000, date: '2026-08-19' }, 'user-1',
  );
  assert.ok(expenseUpdate, 'debió actualizar el gasto (parcial)');
  assert.equal(expenseUpdate.data.paid, false);
});

test('CxP sin expenseId (p.ej. compra) → no toca ningún gasto', async () => {
  resetCtx({ payable: {
    id: 'pay-2', type: 'PAYABLE', status: 'PENDING',
    totalAmount: 500_000, paidAmount: 0, vehicleId: 'veh-1',
    thirdPartyId: null, expenseId: null, description: 'Compra ABC',
    vehicle: { id: 'veh-1', plate: 'ABC' }, thirdParty: null,
  } });
  await payableService.addPayment(
    'pay-2', { accountId: 'acc-empresa', amount: 500_000, date: '2026-08-19' }, 'user-1',
  );
  assert.equal(expenseUpdate, null, 'no debió tocar ningún gasto');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && node --test src/services/__tests__/payableService.addPayment.expenseSync.test.js`
Expected: FALLA — los dos primeros tests fallan porque `addPayment` aún no llama `tx.expense.update` (`expenseUpdate` queda `null`).

- [ ] **Step 3: Implementar el sync en `addPayment`**

En `backend/src/services/payableService.js`, dentro de la `$transaction` de `addPayment`, **justo después** del bloque `// 3. Actualizar la CxC/CxP` que hace `const updatedPayable = await tx.payable.update({ ... })` (y antes de `writeTreasuryAudit`), añadir:

```js
    // 3b. Si la CxP proviene de un gasto, sincronizar su estado "pagado".
    // Forward-only: al completar el pago el gasto queda pagado; parcial lo deja
    // pendiente. Espeja expenseService.payExpense para dar consistencia sin
    // importar por qué vía se pague (Ver todas o el tab del vehículo).
    if (payable.expenseId) {
      await tx.expense.update({
        where: { id: payable.expenseId },
        data: { paid: newStatus === 'PAID', updatedBy: userId },
      });
    }
```

(`newStatus` y `payable` ya están en scope; `payable.expenseId` es un campo escalar que devuelve el `findUnique`.)

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && node --test src/services/__tests__/payableService.addPayment.expenseSync.test.js`
Expected: PASA — 3/3.

- [ ] **Step 5: Correr el test de regresión de addPayment (socio) para asegurar que el guard no rompe nada**

Run: `cd backend && node --test src/services/__tests__/payableService.addPayment.socio.test.js`
Expected: PASA (esos payables no tienen `expenseId`, así que el nuevo bloque es no-op; el mock `tx` de ese archivo no necesita `expense`).

- [ ] **Step 6: Commit**

```bash
git -C "$WT" add backend/src/services/payableService.js backend/src/services/__tests__/payableService.addPayment.expenseSync.test.js
git -C "$WT" commit -m "fix(payables): al pagar una CxP de gasto, marcar el gasto como pagado"
```

(`$WT` = ruta del worktree; ver nota de aislamiento en cada dispatch.)

---

### Task 2: Frontend — lista unificada de CxP en el tab Tesorería

**Files:**
- Modify: `frontend/src/components/treasury/PayablesList.jsx` (añadir data-testids en fila y botón pagar)
- Modify: `frontend/src/pages/VehicleDetailPage.jsx` (estado + carga + reemplazo de cards + handler + conteo)

**Interfaces:**
- Consumes: `PayablesList` (default export, props `{ payables, type, onPayment, loading }`), `payablesApi.getAll({ vehicleId })`, `payablesApi.addPayment(id, data)`.
- Produces: en el tab `tesoreria`, un `<PayablesList>` con las CxP del vehículo; data-testids `payable-row-<id>` y `payable-pay-<id>`.

- [ ] **Step 1: Añadir data-testids a `PayablesList` (vista completa)**

En `frontend/src/components/treasury/PayablesList.jsx`, en la vista completa (tabla), la fila `<tr key={p.id} ...>` y el botón de pago. Añadir a la fila el atributo:

```jsx
                  data-testid={`payable-row-${p.id}`}
```

y al `<button onClick={() => handleOpenPayment(p)} ...>` de la columna Acciones:

```jsx
                        data-testid={`payable-pay-${p.id}`}
```

(No tocar la vista `compact`.)

- [ ] **Step 2: Importar `PayablesList` y agregar estado de CxP del vehículo**

En `frontend/src/pages/VehicleDetailPage.jsx`:

Añadir el import (junto a los otros de treasury, p.ej. tras la línea que importa desde `@/components/treasury`):

```jsx
import { PayablesList } from '@/components/treasury';
```

Añadir estado (junto a los demás `useState`, cerca de `const [paymentStatus, setPaymentStatus] = useState(null);`):

```jsx
  const [vehiclePayables, setVehiclePayables] = useState([]);
  const [loadingVehiclePayables, setLoadingVehiclePayables] = useState(true);
```

Añadir la función de carga (junto a `loadPaymentStatus` / `loadPartnerPayables`):

```jsx
  const loadVehiclePayables = async () => {
    try {
      const { data } = await payablesApi.getAll({ vehicleId: id });
      setVehiclePayables(data || []);
    } catch (err) {
      console.error('Error loading vehicle payables:', err);
    } finally {
      setLoadingVehiclePayables(false);
    }
  };
```

- [ ] **Step 3: Cargar las CxP en el efecto inicial y en `reloadAll`**

En el `useEffect(() => { ... }, [id])` que llama `loadVehicle(); loadVehicleTransactions(); ...`, añadir la línea:

```jsx
    loadVehiclePayables();
```

Y en `reloadAll` (el que hace `loadVehicle(); loadVehicleTransactions(); loadPaymentStatus(); ...`), añadir también:

```jsx
    loadVehiclePayables();
```

- [ ] **Step 4: Derivar la lista de CxP y ajustar el conteo del tab**

Justo antes de `const treasuryCount = ...` (donde ya se calculan `expenses`, `docs`, `portals`), añadir:

```jsx
  // CxP del vehículo (pagar): todo lo que no es cuenta por cobrar.
  const cxpDelVehiculo = vehiclePayables.filter((p) => p.type !== 'RECEIVABLE');
```

Y reemplazar el cálculo de `treasuryCount`:

```jsx
  const treasuryCount = vehicleTransactions.length
    + (paymentStatus?.purchase ? 1 : 0)
    + (paymentStatus?.sale ? 1 : 0);
```

por:

```jsx
  const treasuryCount = vehicleTransactions.length
    + cxpDelVehiculo.length
    + (paymentStatus?.sale ? 1 : 0);
```

- [ ] **Step 5: Agregar el handler de pago**

Junto a `handlePaymentSubmit` (que ya llama `payablesApi.addPayment`), añadir:

```jsx
  // Pago de una CxP del vehículo desde la lista unificada. PayablesList maneja
  // su propio modal; aquí solo persistimos y recargamos (incl. el vehículo, para
  // refrescar el estado de gastos ahora que el backend sincroniza expense.paid).
  const handlePayVehiclePayable = async (payableId, paymentData) => {
    await payablesApi.addPayment(payableId, paymentData);
    reloadAll();
  };
```

- [ ] **Step 6: Insertar `PayablesList` al inicio del tab y quitar las cards de CxP bespoke**

En el bloque `{tab === 'tesoreria' && ( <div className="space-y-6"> ... )}`:

(a) Insertar, como **primer** hijo del `<div className="space-y-6">`:

```jsx
          {/* CxP del vehículo (pagar) — lista unificada con misma función que "Ver todas" */}
          <PayablesList
            type="PAYABLE"
            payables={cxpDelVehiculo}
            loading={loadingVehiclePayables}
            onPayment={isViewer ? undefined : handlePayVehiclePayable}
          />
```

(b) En el grid "Estado de Pagos CxC/CxP", **eliminar** el sub-bloque `{paymentStatus.purchase && ( ...Compra (CxP)... )}` completo (la card cuyo botón es `data-testid="vehicle-pay-purchase"`), y cambiar la condición del contenedor de:

```jsx
          {paymentStatus && (paymentStatus.purchase || paymentStatus.sale) && (
```

a:

```jsx
          {paymentStatus?.sale && (
```

dejando dentro **solo** la card "Venta (CxC)" (`{paymentStatus.sale && ( ... )}` puede quedar tal cual, ya que la condición externa ya garantiza `sale`).

(c) En el grid "Socio", **eliminar** el sub-bloque `{partnerSharePayable && ( ...Socio — Ganancia... )}` completo (card `data-testid="vehicle-partner-share-card"`), y cambiar la condición del contenedor de:

```jsx
          {(partnerSharePayable || partnerCommissionPayable) && (
```

a:

```jsx
          {partnerCommissionPayable && (
```

dejando dentro **solo** la card "Socio — Comisión que debe". No tocar la lista de movimientos ni el resto del tab.

- [ ] **Step 7: Verificar build**

Run: `cd frontend && npm run build`
Expected: build sin errores. (No debe quedar referencia a `openPaymentForPayable(paymentStatus.purchase, ...)` ni a la card de socio-ganancia; `partnerSharePayable` puede seguir en el estado sin renderizarse.)

- [ ] **Step 8: Commit**

```bash
git -C "$WT" add frontend/src/components/treasury/PayablesList.jsx frontend/src/pages/VehicleDetailPage.jsx
git -C "$WT" commit -m "feat(vehicle): CxP del vehículo unificadas en el tab Tesorería con pago"
```

---

### Task 3: E2E — viewer readonly + sync de gasto al pagar

**Files:**
- Modify: `tests/e2e/vehicles/viewer-readonly-pipeline.spec.ts` (migrar testids removidos)
- Create: `tests/e2e/vehicles/vehicle-payables-expense-sync.spec.ts`

**Interfaces:**
- Consumes: helpers `loginAsAdmin`, `apiCreateVehicle`, `apiRegisterSale`/`apiRequestRaw`, `TEST_SEED_IDS`; testids `payable-pay-<id>`, `payment-modal-account`, `payment-modal-submit`, `vehicle-tab-tesoreria`, `vehicle-tab-gastos`.

- [ ] **Step 1: Migrar `viewer-readonly-pipeline.spec.ts` a la nueva estructura**

Abrir `tests/e2e/vehicles/viewer-readonly-pipeline.spec.ts`. Donde el ADMIN verifica que puede pagar la CxP de compra:

Reemplazar:
```ts
    await expect(page.getByTestId('vehicle-pay-purchase')).toBeVisible({ timeout: 10_000 });
```
por (la CxP de compra ahora es una fila de la lista con su botón de pago):
```ts
    await expect(page.locator('[data-testid^="payable-pay-"]').first()).toBeVisible({ timeout: 10_000 });
```

Y donde el VIEWER verifica que NO puede pagar:
```ts
    await expect(page.getByTestId('vehicle-pay-purchase')).toHaveCount(0);
```
por:
```ts
    await expect(page.locator('[data-testid^="payable-pay-"]')).toHaveCount(0);
```

(No cambiar el resto del test; el vehículo de ese test crea la CxP de compra vía `payment: { thirdPartyId, dueDate: null }`, que sigue apareciendo en la lista.)

- [ ] **Step 2: Correr el test migrado**

Run: `npm run test:e2e -- vehicles/viewer-readonly-pipeline.spec.ts`
Expected: PASA. (El entorno de Playwright levanta backend+frontend automáticamente.)

- [ ] **Step 3: Escribir el e2e de sync gasto↔CxP**

Crear `tests/e2e/vehicles/vehicle-payables-expense-sync.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateVehicle, apiRequestRaw } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Vehículo — CxP de gasto: pago sincroniza el estado del gasto', () => {
  test('gasto pendiente → pagar su CxP desde el tab → gasto queda pagado', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const plate = `EXP${Date.now().toString().slice(-6)}`;
    const v = await apiCreateVehicle(token, {
      plate,
      stage: 'COMPRADO',
      negotiatedValue: 20_000_000,
      purchasePrice: 20_000_000,
      listedPrice: 30_000_000,
      supplierId: TEST_SEED_IDS.supplier,
    });

    // Gasto con tesorería, PENDIENTE → crea Expense(paid=false) + CxP(PENDING) ligada.
    const created = await apiRequestRaw('POST', '/expenses/with-treasury', token, {
      vehicleId: v.id,
      category: 'MECANICA',
      amount: 500_000,
      description: 'Reparación motor',
      accountId: TEST_SEED_IDS.accountCash,
      isPaid: false,
      dueDate: null,
    });
    expect(created.status).toBe(201);
    const payableId = created.body.payable.id as string;
    const expenseId = created.body.expense.id as string;

    // Abrir el vehículo en el tab Tesorería y pagar la CxP del gasto desde la lista.
    await page.goto(`/vehicles/${v.id}?tab=tesoreria`);
    const payBtn = page.getByTestId(`payable-pay-${payableId}`);
    await expect(payBtn).toBeVisible({ timeout: 10_000 });
    await payBtn.click();

    // Modal de pago: elegir cuenta y registrar (el monto viene precargado al total).
    await page.getByTestId('payment-modal-account').selectOption(TEST_SEED_IDS.accountCash);
    await page.getByTestId('payment-modal-submit').click();

    // La CxP desaparece del botón de pago (queda PAID) y el gasto queda pagado en API.
    await expect(page.getByTestId(`payable-pay-${payableId}`)).toHaveCount(0, { timeout: 10_000 });

    const expenses = await apiRequestRaw('GET', '/expenses', token);
    const exp = (expenses.body as Array<{ id: string; paid: boolean }>).find((e) => e.id === expenseId);
    expect(exp?.paid).toBe(true);
  });
});
```

- [ ] **Step 4: Correr el nuevo e2e**

Run: `npm run test:e2e -- vehicles/vehicle-payables-expense-sync.spec.ts`
Expected: PASA (1 test). (El `PaymentModal` precarga el monto al pendiente —
`PayablesList` le pasa `totalAmount`/`paidAmount`— por eso basta elegir cuenta y
enviar; no hay que llenar el monto.)

- [ ] **Step 5: Commit**

```bash
git -C "$WT" add tests/e2e/vehicles/viewer-readonly-pipeline.spec.ts tests/e2e/vehicles/vehicle-payables-expense-sync.spec.ts
git -C "$WT" commit -m "test(e2e): CxP del vehículo unificadas + sync de gasto al pagar"
```

---

## Verificación final

- [ ] `cd backend && node --test src/services/__tests__/payableService.addPayment.expenseSync.test.js` — 3/3.
- [ ] `cd backend && node --test src/services/__tests__/payableService.addPayment.socio.test.js` — sin regresión.
- [ ] `cd frontend && npm run build` — build sin errores.
- [ ] `npm run test:e2e -- vehicles/viewer-readonly-pipeline.spec.ts vehicles/vehicle-payables-expense-sync.spec.ts` — en verde.
- [ ] Revisión manual: abrir un vehículo con CxP de gasto pendiente → tab Tesorería muestra la lista unificada con todas las CxP y botón Pagar → pagar → la CxP queda pagada y, en la pestaña Gastos, el gasto pasa a "pagado". La CxC de venta, la card socio-comisión y los movimientos siguen intactos.
