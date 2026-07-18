# Aporte del socio en la compra (Opción B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que comprar un carro con socio funcione: la CxP de compra es por el precio total y se salda con el aporte del socio (movimientos entra+sale por una cuenta tuya, neto $0) más tu parte, de modo que la CxP llegue a PAID y puedas avanzar de etapa; y que `participation` se calcule bien para que el socio se reconozca al vender.

**Architecture:** El cambio de dinero vive en `purchaseService`: la CxP se crea por `purchasePrice`; una función registra el aporte del socio (INCOME socio→cuenta + EXPENSE cuenta→proveedor + PayablePayment) y luego tus pagos; el status se calcula contra `purchasePrice`. El frontend deriva `participation` reactivamente y envía la cuenta del aporte. Sin socio → comportamiento idéntico al actual.

**Tech Stack:** Node.js + Express + Prisma + PostgreSQL (backend, CommonJS); React 18 + Vite (frontend). Tests: `node:test` (backend), Playwright (e2e).

## Global Constraints

- Backend CommonJS; moneda COP entera.
- CxP de compra: `totalAmount = purchasePrice` (NO `myOwedAmount`). Descripción `Compra vehículo {placa}`.
- Aporte del socio ($X = `partnerContribution`) pasa por una cuenta tuya: INCOME (socio→cuenta, categoría `CAPITAL_CONTRIBUTION`) + EXPENSE (cuenta→proveedor, `VEHICLE_PURCHASE`) + `PayablePayment(X)`. Neto $0 en la cuenta.
- Tu parte ($P−X): EXPENSE desde tu cuenta como hoy, + `PayablePayment`.
- CxP `paidAmount = X + Σ(tus pagos)`; `status = paidAmount >= purchasePrice ? 'PAID' : 'PARTIAL'`.
- Socio 100%: X = P, tu parte $0 → CxP PAID solo con el par del socio.
- Sin socio (`partnerContribution` 0/null): idéntico al comportamiento actual (regresión cero).
- Guard de sobre-pago: `X + Σ(tus pagos) > purchasePrice + 0.0001` → `AppError(400)`.
- Requiere la cuenta del aporte (`payment.partnerAccountId`) cuando `partnerContribution > 0`; si falta → `AppError(400)`.
- `participation` (frontend) se deriva de `(precio − aporte)/precio` acotado a [0,1], reactivo a AMBOS.
- Fuera de alcance: devolución del capital del socio al vender; aporte en varias cuentas/pagos.

---

## File Structure

- `backend/src/services/purchaseService.js` — CxP total + `applyPurchasePayments` extendido con el aporte del socio; wiring en `createVehicleWithPurchase` y `confirmPurchase`.
- `backend/src/middleware/validation.js` — `payment.partnerAccountId` en los schemas de compra (create + confirm).
- `backend/src/services/__tests__/purchaseService.test.js` — nuevo, con stub de `tx`.
- `frontend/src/components/vehicles/VehicleFormModal.jsx` — `participation` reactiva + enviar `partnerAccountId` + UI "Aporte del socio: $X · Tu parte: $(P−X)".
- `tests/e2e/treasury/socio-compra.spec.ts` — flujo de compra con socio + avance de etapa + venta.

---

## Task 1: Backend — CxP por precio total + aporte del socio

**Files:**
- Modify: `backend/src/services/purchaseService.js` (`applyPurchasePayments` ~51-107; `createVehicleWithPurchase` ~120-205; `confirmPurchase` ~353-430)
- Modify: `backend/src/middleware/validation.js` (schemas `vehiclePurchase` create + confirm: agregar `partnerAccountId`)
- Test: `backend/src/services/__tests__/purchaseService.test.js` (nuevo)

**Interfaces:**
- Consumes: `computeAccountBalance(tx, accountId)`, `normalizePayments(paymentData)` (ya existen).
- Produces: `applyPurchasePayments(tx, { payable, payments, vehicle, thirdPartyId, date, userId, totalDue, partnerContribution, partnerAccountId, socioThirdPartyId })` → `{ totalPaid, transactions, warnings }`, donde crea el par del socio (si `partnerContribution > 0`) y los pagos propios, y actualiza `paidAmount/status` de la CxP contra `totalDue`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/src/services/__tests__/purchaseService.test.js`. Stub de `tx` que capture `payable.create/update`, `transaction.create`, `payablePayment.create`, y `computeAccountBalance` (vía `tx.transaction.findMany`/`tx.account.findUnique` — replicar lo mínimo que `computeAccountBalance` lee; si es complejo, exportar `applyPurchasePayments` y pasar un stub de `tx` que devuelva balance suficiente). Casos:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyPurchasePayments } = require('../purchaseService');

// Stub mínimo de tx: balance alto, captura writes.
const mkTx = () => {
  const created = { transactions: [], payablePayments: [], payableUpdate: null };
  return {
    _created: created,
    account: { findUnique: async ({ where }) => ({ id: where.id, name: 'Caja', isActive: true }) },
    transaction: {
      findMany: async () => [],           // balance base 0…
      aggregate: async () => ({ _sum: { amount: 0 } }),
      create: async ({ data }) => { const t = { id: `tx${created.transactions.length+1}`, ...data }; created.transactions.push(t); return t; },
    },
    payablePayment: { create: async ({ data }) => { created.payablePayments.push(data); return data; } },
    payable: { update: async ({ data }) => { created.payableUpdate = data; return data; } },
  };
};

const vehicle = { id: 'v1', plate: 'ABC123', partnerId: 'socio-ext' };

test('aporte socio externo: par INCOME+EXPENSE + pago propio → CxP PAID contra precio total', async () => {
  const tx = mkTx();
  const payable = { id: 'cxp1' };
  const out = await applyPurchasePayments(tx, {
    payable, vehicle, userId: 'u1', date: null,
    thirdPartyId: 'prov1',            // proveedor
    totalDue: 20_000_000,
    partnerContribution: 8_000_000, partnerAccountId: 'accA', socioThirdPartyId: 'socio-ext',
    payments: [{ accountId: 'accB', amount: 12_000_000, method: 'CASH' }],
  });
  // 3 transacciones: INCOME aporte, EXPENSE aporte, EXPENSE tu parte
  const cats = tx._created.transactions.map(t => `${t.type}:${t.category}`);
  assert.deepEqual(cats.sort(), ['EXPENSE:VEHICLE_PURCHASE','EXPENSE:VEHICLE_PURCHASE','INCOME:CAPITAL_CONTRIBUTION'].sort());
  // aporte INCOME a accA por 8M, con thirdParty socio
  const income = tx._created.transactions.find(t => t.type === 'INCOME');
  assert.equal(income.accountId, 'accA'); assert.equal(income.amount, 8_000_000); assert.equal(income.thirdPartyId, 'socio-ext');
  // PayablePayments suman 20M
  assert.equal(tx._created.payablePayments.reduce((s,p)=>s+p.amount,0), 20_000_000);
  assert.equal(tx._created.payableUpdate.paidAmount, 20_000_000);
  assert.equal(tx._created.payableUpdate.status, 'PAID');
  assert.equal(out.totalPaid, 20_000_000);
});

test('socio 100%: sin pago propio, solo el par del socio → PAID', async () => {
  const tx = mkTx();
  const out = await applyPurchasePayments(tx, {
    payable: { id: 'cxp2' }, vehicle, userId: 'u1', date: null, thirdPartyId: 'prov1',
    totalDue: 20_000_000,
    partnerContribution: 20_000_000, partnerAccountId: 'accA', socioThirdPartyId: 'socio-inv',
    payments: [],
  });
  assert.equal(tx._created.payableUpdate.status, 'PAID');
  assert.equal(out.totalPaid, 20_000_000);
});

test('sin socio: comportamiento actual (solo pagos propios, status contra totalDue)', async () => {
  const tx = mkTx();
  await applyPurchasePayments(tx, {
    payable: { id: 'cxp3' }, vehicle: { id: 'v', plate: 'X', partnerId: null }, userId: 'u1', date: null,
    thirdPartyId: 'prov1', totalDue: 20_000_000,
    partnerContribution: 0, partnerAccountId: null, socioThirdPartyId: null,
    payments: [{ accountId: 'accB', amount: 20_000_000 }],
  });
  assert.equal(tx._created.transactions.filter(t=>t.type==='INCOME').length, 0);
  assert.equal(tx._created.payableUpdate.status, 'PAID');
});

test('sobre-pago (aporte + pagos > precio) → 400', async () => {
  const tx = mkTx();
  await assert.rejects(
    applyPurchasePayments(tx, {
      payable: { id: 'c' }, vehicle, userId: 'u1', date: null, thirdPartyId: 'p',
      totalDue: 20_000_000, partnerContribution: 15_000_000, partnerAccountId: 'accA', socioThirdPartyId: 's',
      payments: [{ accountId: 'accB', amount: 10_000_000 }],
    }),
    (e) => e.statusCode === 400,
  );
});

test('aporte > 0 sin partnerAccountId → 400', async () => {
  const tx = mkTx();
  await assert.rejects(
    applyPurchasePayments(tx, {
      payable: { id: 'c' }, vehicle, userId: 'u1', date: null, thirdPartyId: 'p',
      totalDue: 20_000_000, partnerContribution: 8_000_000, partnerAccountId: null, socioThirdPartyId: 's',
      payments: [{ accountId: 'accB', amount: 12_000_000 }],
    }),
    (e) => e.statusCode === 400,
  );
});
```

Exportar `applyPurchasePayments` en `module.exports` para el test.

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `cd backend && node --test src/services/__tests__/purchaseService.test.js`
Expected: FAIL (la firma actual no acepta `partnerContribution`/`totalDue`; no crea el par del socio).

- [ ] **Step 3: Implementar**

Reescribir `applyPurchasePayments` para aceptar `totalDue`, `partnerContribution`, `partnerAccountId`, `socioThirdPartyId`:

```javascript
async function applyPurchasePayments(tx, {
  payable, payments, vehicle, thirdPartyId, date, userId,
  totalDue, partnerContribution = 0, partnerAccountId = null, socioThirdPartyId = null,
}) {
  const partnerAmt = Number(partnerContribution || 0);
  const owedByMe = payments || [];
  if (owedByMe.length === 0 && partnerAmt <= 0) {
    return { totalPaid: 0, transactions: [], warnings: [] };
  }
  const myTotal = owedByMe.reduce((s, p) => s + p.amount, 0);
  const totalPaid = myTotal + partnerAmt;
  if (totalPaid > Number(totalDue) + 0.0001) {
    throw new AppError(`El total (aporte socio ${partnerAmt} + tus pagos ${myTotal}) excede el precio de compra (${totalDue})`, 400);
  }
  if (partnerAmt > 0 && !partnerAccountId) {
    throw new AppError('Selecciona la cuenta por la que entra el aporte del socio', 400);
  }

  const transactions = [];
  const warnings = [];
  const paymentDate = new Date();
  const methodLabel = { CASH: ' (efectivo)', TRANSFER: ' (transferencia)' };

  // Aporte del socio: entra (INCOME) y sale al proveedor (EXPENSE), neto $0.
  if (partnerAmt > 0) {
    const incomeTx = await tx.transaction.create({ data: {
      accountId: partnerAccountId, type: 'INCOME', category: 'CAPITAL_CONTRIBUTION', amount: partnerAmt,
      description: `Aporte socio compra ${vehicle.plate}`, date: paymentDate,
      vehicleId: vehicle.id, thirdPartyId: socioThirdPartyId || null, createdBy: userId,
    }});
    transactions.push(incomeTx);
    const outTx = await tx.transaction.create({ data: {
      accountId: partnerAccountId, type: 'EXPENSE', category: 'VEHICLE_PURCHASE', amount: partnerAmt,
      description: `Pago compra ${vehicle.plate} (aporte socio)`, date: paymentDate,
      vehicleId: vehicle.id, thirdPartyId: thirdPartyId || null, createdBy: userId,
    }});
    transactions.push(outTx);
    await tx.payablePayment.create({ data: { payableId: payable.id, transactionId: outTx.id, amount: partnerAmt } });
  }

  // Tus pagos (como hoy).
  for (const p of owedByMe) {
    const info = await computeAccountBalance(tx, p.accountId);
    if (!info) throw new AppError('La cuenta seleccionada no existe', 400);
    if (info.balance - p.amount < 0) {
      warnings.push({ type: 'NEGATIVE_BALANCE', message: `La cuenta "${info.account.name}" quedará con saldo negativo después de este pago`, accountId: p.accountId, currentBalance: info.balance, newBalance: info.balance - p.amount });
    }
    const transaction = await tx.transaction.create({ data: {
      accountId: p.accountId, type: 'EXPENSE', category: 'VEHICLE_PURCHASE', amount: p.amount,
      description: `Pago compra ${vehicle.plate}${methodLabel[p.method] || ''}`, date: paymentDate,
      vehicleId: vehicle.id, thirdPartyId: thirdPartyId || null, createdBy: userId,
    }});
    await tx.payablePayment.create({ data: { payableId: payable.id, transactionId: transaction.id, amount: p.amount } });
    transactions.push(transaction);
  }

  await tx.payable.update({
    where: { id: payable.id },
    data: { paidAmount: totalPaid, status: totalPaid >= Number(totalDue) ? 'PAID' : 'PARTIAL' },
  });
  return { totalPaid, transactions, warnings };
}
```

En `createVehicleWithPurchase` y `confirmPurchase`:
- Crear la CxP con `totalAmount: purchasePrice` (no `myOwedAmount`) y descripción `Compra vehículo ${plate}` (sin "(mi parte)").
- Llamar `applyPurchasePayments(tx, { payable, payments, vehicle, thirdPartyId: supplierId/paymentData.thirdPartyId, date, userId, totalDue: purchasePrice, partnerContribution: partnerAmount, partnerAccountId: paymentData?.partnerAccountId, socioThirdPartyId: vehicleData.partnerId })`.
- Quitar `myOwedAmount` del cálculo de la CxP (ya no aplica); `participation`/`partnerContribution` del vehículo se guardan igual.

En `validation.js` (schemas de create + confirm), en el objeto `payment`, agregar: `partnerAccountId: Joi.string().allow(null)`.

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `cd backend && node --test src/`
Expected: PASS (incluye el nuevo archivo; sin regresión en el resto).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/purchaseService.js backend/src/middleware/validation.js backend/src/services/__tests__/purchaseService.test.js
git commit -m "feat: CxP de compra por precio total + aporte del socio (entra+sale por tu cuenta, neto 0) → CxP PAID"
```

---

## Task 2: Frontend — participation reactiva + cuenta del aporte + UI

**Files:**
- Modify: `frontend/src/components/vehicles/VehicleFormModal.jsx`

**Interfaces:**
- Consumes: el backend de Task 1 (envía `payment.partnerAccountId`).

- [ ] **Step 1: `participation` reactiva (fix bug 1).** Hoy `participation` solo se recalcula en `onPartnerContributionChange` (~169-180). Hacerla derivada de `purchasePrice` + `partnerContribution` de forma reactiva: en el submit, computar `participationDecimal = purchasePrice > 0 ? Math.max(0, Math.min(1, (purchasePrice − partnerContribution) / purchasePrice)) : 1` a partir de los valores actuales (no de un `f.participation` que puede estar viejo). Quitar la dependencia de `f.participation` como estado suelto (o recalcularlo también cuando cambie `purchasePrice`, p. ej. con un `useEffect` sobre `[f.purchasePrice, f.partnerContribution]`). Verificar: con aporte = precio → `participation = 0`.

- [ ] **Step 2: Enviar `partnerAccountId`.** En el payload `payment` (submit, ~283/321), agregar `partnerAccountId` = la cuenta por la que entra el aporte del socio. Por defecto la cuenta de efectivo (`cashAccountId`) o la primera cuenta activa; permitir elegirla si ya hay selector de cuentas de pago. Solo se envía cuando hay socio con aporte > 0.

- [ ] **Step 3: UI clara.** En la sección de socio, mostrar `Aporte del socio: $X · Tu parte: $(P−X)` usando `myCapital`/`suggestedPercent` ya derivados. Cuando el socio aporta 100%, dejar claro que tu parte es $0 y que el aporte del socio salda la compra (no un "$0 a pagar" sin contexto). Añadir data-testids `vehicle-form-partner-contribution` y `vehicle-form-my-part` para el e2e.

- [ ] **Step 4: Build**
Run: `cd frontend && npm run build`
Expected: OK.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/vehicles/VehicleFormModal.jsx
git commit -m "fix(ui): participation reactiva + envía cuenta del aporte del socio + UI de aporte/tu parte"
```

---

## Task 3: E2E — compra con socio → CxP PAID → avanzar → vender

**Files:**
- Create: `tests/e2e/treasury/socio-compra.spec.ts`

**Interfaces:**
- Consumes: el flujo completo compra-con-socio.

- [ ] **Step 1: Escribir el e2e.** Con la app + DB de test (`migrate reset` limpio):
  - **Socio externo 40%:** comprar un carro (precio 20M) con socio externo aportando 8M por una cuenta; verificar por API: CxP `PAYABLE` `totalAmount 20M`, `status PAID`; transacciones INCOME `CAPITAL_CONTRIBUTION` 8M (a nombre del socio) + EXPENSE 8M (aporte) + EXPENSE 12M (tu parte); la cuenta del aporte queda con neto 0 por el aporte. Avanzar de etapa (COMPRADO → ALISTAMIENTO) → **200 OK** (ya no se atasca).
  - **Socio inversionista 100%:** comprar (precio 20M) con inversionista aportando 20M; CxP PAID; tu parte 0; avanzar OK. Luego **vender** y verificar que el socio se reconoce (se crea `PARTNER_SHARE`) — esto valida el fix de `participation`.
  - **Sin socio:** comprar normal → CxP PAID como hoy (regresión).
  Deterministas; seguir los helpers/patrones existentes.

- [ ] **Step 2: Ejecutar**
Run: `npx playwright test tests/e2e/treasury/socio-compra.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**
```bash
git add tests/e2e/treasury/socio-compra.spec.ts tests/helpers
git commit -m "test(e2e): compra con socio → CxP PAID + avance de etapa + venta reconoce al socio"
```

---

## Self-Review (cobertura del spec)

- §2 CxP total + aporte del socio (par INCOME+EXPENSE) + status vs precio → Task 1 ✔
- §2 casos externo/100%/sin-socio/parcial → Task 1 (unit) + Task 3 (e2e) ✔
- §3 fix participation reactiva → Task 2 ✔
- §4 backend (CxP total, helper, validation `partnerAccountId`) → Task 1 ✔
- §5 frontend (participation, cuenta del aporte, UI) → Task 2 ✔
- §6 fuera de alcance → ninguna task toca capital-return / múltiples cuentas ✔
- §7 tests → Task 1 unit + Task 3 e2e ✔
- Bug 2 (CxP $0 PENDING atascada) → resuelto por Task 1 (CxP total + PAID) ✔

**Nota de ejecución:** Task 1 es el cambio de dinero (mayor riesgo); ejecutarla verde (con los cuadres y el path sin-socio idéntico) antes del frontend/e2e.
