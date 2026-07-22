# Cuentas dedicadas por socio (FASE A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada socio (tercero tipo PARTNER) tiene una cuenta dedicada (tipo `SOCIO`, ligada a su tercero, activable/transferible, creada automáticamente), y el aporte del socio al comprar un carro sale directamente de esa cuenta (reemplaza el par INGRESO+EGRESO por tu cuenta de la Opción B).

**Architecture:** Nuevo `AccountType SOCIO` + `Account.thirdPartyId`. `thirdPartyService` crea la cuenta del socio al marcar un tercero como PARTNER (idempotente) + backfill en migración. `purchaseService.applyPurchasePayments` resuelve la cuenta `SOCIO` del socio por `partnerId` y hace UN egreso desde ella. Frontend deja de enviar `partnerAccountId` y muestra de qué cuenta sale.

**Tech Stack:** Node.js + Express + Prisma + PostgreSQL (backend, CommonJS); React 18 + Vite (frontend). Tests: `node:test` (backend), Playwright (e2e).

## Global Constraints

- Backend CommonJS; moneda COP entera.
- `AccountType` += `SOCIO`. `Account` += `thirdPartyId String?` (FK a ThirdParty, `onDelete: SetNull`, indexado).
- Una cuenta `SOCIO` por socio; nombre por defecto `Cuenta Socio — {name}`, `initialBalance 0`, `isActive true`.
- Auto-creación idempotente cuando un `ThirdParty` es/pasa a tipo `PARTNER` (en `thirdPartyService.create`/`update`) + backfill en migración para los PARTNER existentes.
- Compra con socio: el aporte ($X = `partnerContribution`) sale como UN `EXPENSE` desde la cuenta `SOCIO` del socio (resuelta por `type='SOCIO'`, `thirdPartyId=socioThirdPartyId`, `isActive=true`) hacia el proveedor (categoría `VEHICLE_PURCHASE`) + `PayablePayment(X)` contra la CxP de precio total. Se ELIMINA el par INCOME+EXPENSE y el `partnerAccountId`.
- Socio sin cuenta `SOCIO` activa → `AppError(400)` accionable.
- Saldo insuficiente → warning `NEGATIVE_BALANCE` (no bloqueante, como el flujo actual).
- Tu parte ($P−X) sin cambios. Path sin-socio sin cambios.
- Fuera de alcance (FASE B): ganancias (`PARTNER_SHARE`)/comisiones que ENTRAN a la cuenta del socio.

---

## File Structure

- `backend/prisma/schema.prisma` — enum `AccountType` (+`SOCIO`), `Account.thirdPartyId` + relación + índice.
- `backend/prisma/migrations/<ts1>_account_type_socio/migration.sql` — `ADD VALUE` + `ADD COLUMN` + FK + index.
- `backend/prisma/migrations/<ts2>_backfill_socio_accounts/migration.sql` — backfill idempotente.
- `backend/src/services/thirdPartyService.js` — `ensureSocioAccount` + hook en create/update.
- `backend/src/services/purchaseService.js` — rama del socio en `applyPurchasePayments` (egreso desde cuenta SOCIO).
- `backend/src/middleware/validation.js` — quitar `payment.partnerAccountId` de los schemas de compra.
- `backend/src/services/__tests__/thirdPartyService.test.js` — auto-creación (extender el existente).
- `backend/src/services/__tests__/purchaseService.test.js` — aporte desde cuenta SOCIO (extender).
- `frontend/src/pages/treasury/AccountsPage.jsx` (o donde vivan las cuentas) — mostrar cuentas SOCIO.
- `frontend/src/components/vehicles/VehicleFormModal.jsx` — quitar `partnerAccountId`, mostrar cuenta del socio.
- `tests/e2e/treasury/cuentas-socio.spec.ts` — flujo completo.

---

## Task 1: Esquema + migración + backfill

**Files:**
- Modify: `backend/prisma/schema.prisma` (enum `AccountType`, model `Account`, model `ThirdParty` reverse-rel)
- Create: `backend/prisma/migrations/20260718120000_account_type_socio/migration.sql`
- Create: `backend/prisma/migrations/20260718120100_backfill_socio_accounts/migration.sql`

**Interfaces:**
- Produces: `AccountType.SOCIO`; `Account.thirdPartyId` (String?, FK).

- [ ] **Step 1: Editar el schema**

En `enum AccountType` agregar `SOCIO`. En `model Account` agregar el campo + relación:
```prisma
enum AccountType {
  CASH
  BANK
  BUDGET
  SOCIO
}
```
En `model Account` (después de `isActive`):
```prisma
  thirdPartyId   String?
  thirdParty     ThirdParty? @relation("SocioAccount", fields: [thirdPartyId], references: [id], onDelete: SetNull)
```
Y `@@index([thirdPartyId])` junto a los otros índices/`@@map`. En `model ThirdParty` agregar la reverse-rel:
```prisma
  socioAccounts  Account[]  @relation("SocioAccount")
```

- [ ] **Step 2: Migración 1 (enum + columna)**

`backend/prisma/migrations/20260718120000_account_type_socio/migration.sql`:
```sql
-- Tipo de cuenta dedicada al socio, ligada a su tercero.
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'SOCIO';
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "thirdPartyId" TEXT;
DO $$ BEGIN
  ALTER TABLE "accounts" ADD CONSTRAINT "accounts_thirdPartyId_fkey"
    FOREIGN KEY ("thirdPartyId") REFERENCES "third_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "accounts_thirdPartyId_idx" ON "accounts"("thirdPartyId");
```

- [ ] **Step 3: Migración 2 (backfill idempotente)**

`backend/prisma/migrations/20260718120100_backfill_socio_accounts/migration.sql` (separada porque usa el enum value nuevo):
```sql
-- Crea la cuenta SOCIO para cada tercero PARTNER que aún no tenga una. Idempotente.
INSERT INTO "accounts" ("id", "name", "type", "initialBalance", "isActive", "thirdPartyId", "createdAt", "updatedAt")
SELECT 'socio-acct-' || tp."id", 'Cuenta Socio — ' || tp."name", 'SOCIO', 0, true, tp."id", NOW(), NOW()
FROM "third_parties" tp
WHERE tp."type" = 'PARTNER'
  AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."thirdPartyId" = tp."id" AND a."type" = 'SOCIO');
```

- [ ] **Step 4: Regenerar cliente y validar**

Run: `cd backend && npx prisma generate && npx prisma validate`
Expected: "Generated Prisma Client" y "schema ... is valid".

- [ ] **Step 5: Commit**
```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260718120000_account_type_socio/ backend/prisma/migrations/20260718120100_backfill_socio_accounts/
git commit -m "feat(db): AccountType SOCIO + Account.thirdPartyId + backfill de cuentas de socios"
```

---

## Task 2: Auto-creación de la cuenta del socio

**Files:**
- Modify: `backend/src/services/thirdPartyService.js`
- Test: `backend/src/services/__tests__/thirdPartyService.test.js` (extender)

**Interfaces:**
- Produces: `ensureSocioAccount(prismaOrTx, thirdParty)` → crea una cuenta `SOCIO` (`thirdPartyId`, nombre `Cuenta Socio — {name}`) si `thirdParty.type === 'PARTNER'` y no existe ya una `SOCIO` para ese tercero. Idempotente. Devuelve la cuenta (creada o existente) o `null` si no aplica.

- [ ] **Step 1: Test que falla**

En `backend/src/services/__tests__/thirdPartyService.test.js` (usa el patrón de stub existente o un stub mínimo de prisma):
```javascript
const { ensureSocioAccount } = require('../thirdPartyService');

const mkPrisma = (existing = null) => {
  const created = [];
  return {
    _created: created,
    account: {
      findFirst: async () => existing,
      create: async ({ data }) => { const a = { id: 'acc1', ...data }; created.push(a); return a; },
    },
  };
};

test('ensureSocioAccount: tercero PARTNER sin cuenta → crea cuenta SOCIO', async () => {
  const p = mkPrisma(null);
  const out = await ensureSocioAccount(p, { id: 'tp1', name: 'Mamá', type: 'PARTNER' });
  assert.equal(out.type, 'SOCIO');
  assert.equal(out.thirdPartyId, 'tp1');
  assert.equal(out.name, 'Cuenta Socio — Mamá');
  assert.equal(p._created.length, 1);
});

test('ensureSocioAccount: tercero PARTNER con cuenta existente → no duplica', async () => {
  const p = mkPrisma({ id: 'accX', type: 'SOCIO', thirdPartyId: 'tp1' });
  const out = await ensureSocioAccount(p, { id: 'tp1', name: 'Mamá', type: 'PARTNER' });
  assert.equal(out.id, 'accX');
  assert.equal(p._created.length, 0);
});

test('ensureSocioAccount: tercero no-PARTNER → no crea (null)', async () => {
  const p = mkPrisma(null);
  const out = await ensureSocioAccount(p, { id: 'tp2', name: 'Cliente', type: 'CLIENT' });
  assert.equal(out, null);
  assert.equal(p._created.length, 0);
});
```

- [ ] **Step 2: Ejecutar y ver fallar**
Run: `cd backend && node --test src/services/__tests__/thirdPartyService.test.js`
Expected: FAIL — `ensureSocioAccount is not a function`.

- [ ] **Step 3: Implementar**

En `thirdPartyService.js`:
```javascript
async function ensureSocioAccount(prismaOrTx, thirdParty) {
  if (!thirdParty || thirdParty.type !== 'PARTNER') return null;
  const existing = await prismaOrTx.account.findFirst({
    where: { type: 'SOCIO', thirdPartyId: thirdParty.id },
  });
  if (existing) return existing;
  return prismaOrTx.account.create({
    data: {
      name: `Cuenta Socio — ${thirdParty.name}`,
      type: 'SOCIO',
      initialBalance: 0,
      isActive: true,
      thirdPartyId: thirdParty.id,
    },
  });
}
```
En `create(data)`: tras crear el tercero, si `type === 'PARTNER'`, `await ensureSocioAccount(prisma, created)`. En `update(id, data)`: tras actualizar, si el resultado es `type === 'PARTNER'`, `await ensureSocioAccount(prisma, updated)`. Exportar `ensureSocioAccount`.

- [ ] **Step 4: Ejecutar y ver pasar**
Run: `cd backend && node --test src/`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/src/services/thirdPartyService.js backend/src/services/__tests__/thirdPartyService.test.js
git commit -m "feat: crea automáticamente la cuenta SOCIO al marcar un tercero como Socio (idempotente)"
```

---

## Task 3: Aporte de compra desde la cuenta del socio

**Files:**
- Modify: `backend/src/services/purchaseService.js` (`applyPurchasePayments` rama del socio; quitar `partnerAccountId`)
- Modify: `backend/src/middleware/validation.js` (quitar `payment.partnerAccountId` de los 2 schemas de compra)
- Test: `backend/src/services/__tests__/purchaseService.test.js` (actualizar los casos de socio)

**Interfaces:**
- Consumes: `computeAccountBalance` (existe); `AppError`.
- Produces: `applyPurchasePayments(tx, { payable, payments, vehicle, thirdPartyId, date, userId, totalDue, partnerContribution, socioThirdPartyId })` — la rama del socio resuelve la cuenta `SOCIO` por `socioThirdPartyId` y hace UN `EXPENSE` desde ella (sin `partnerAccountId`, sin INCOME).

- [ ] **Step 1: Actualizar los tests (RED)**

En `purchaseService.test.js`, el stub de `tx` debe soportar `account.findFirst` (devolver la cuenta SOCIO). Reemplazar los casos de socio: el aporte ahora es UN `EXPENSE` desde la cuenta SOCIO (no INCOME+EXPENSE), y añadir el caso "socio sin cuenta activa → 400":
```javascript
// mkTx extendido: account.findFirst devuelve la cuenta SOCIO (o null si se pide "sin cuenta")
const mkTx = (socioAccount = { id: 'accSocio', type: 'SOCIO' }) => {
  const created = { transactions: [], payablePayments: [], payableUpdate: null };
  return { _created: created,
    account: {
      findUnique: async ({ where }) => ({ id: where.id, name: 'Caja', isActive: true }),
      findFirst: async () => socioAccount,
    },
    transaction: { findMany: async () => [], aggregate: async () => ({ _sum: { amount: 0 } }),
      create: async ({ data }) => { const t = { id: `tx${created.transactions.length+1}`, ...data }; created.transactions.push(t); return t; } },
    payablePayment: { create: async ({ data }) => { created.payablePayments.push(data); return data; } },
    payable: { update: async ({ data }) => { created.payableUpdate = data; return data; } },
  };
};

test('aporte socio: UN egreso desde la cuenta SOCIO (no INCOME+EXPENSE) + tu parte → PAID', async () => {
  const tx = mkTx();
  await applyPurchasePayments(tx, {
    payable: { id: 'c' }, vehicle: { id: 'v', plate: 'ABC', partnerId: 'socio1' }, userId: 'u', date: null,
    thirdPartyId: 'prov', totalDue: 20_000_000,
    partnerContribution: 8_000_000, socioThirdPartyId: 'socio1',
    payments: [{ accountId: 'accB', amount: 12_000_000 }],
  });
  const socioTx = tx._created.transactions.filter(t => t.accountId === 'accSocio');
  assert.equal(socioTx.length, 1);            // solo UN egreso, no INCOME+EXPENSE
  assert.equal(socioTx[0].type, 'EXPENSE');
  assert.equal(socioTx[0].amount, 8_000_000);
  assert.equal(tx._created.transactions.filter(t => t.type === 'INCOME').length, 0);
  assert.equal(tx._created.payableUpdate.status, 'PAID');
});

test('socio 100%: UN egreso 20M desde la cuenta SOCIO → PAID', async () => {
  const tx = mkTx();
  await applyPurchasePayments(tx, {
    payable: { id: 'c' }, vehicle: { id: 'v', plate: 'ABC', partnerId: 'socio1' }, userId: 'u', date: null,
    thirdPartyId: 'prov', totalDue: 20_000_000, partnerContribution: 20_000_000, socioThirdPartyId: 'socio1',
    payments: [],
  });
  assert.equal(tx._created.transactions.filter(t => t.accountId === 'accSocio' && t.type === 'EXPENSE')[0].amount, 20_000_000);
  assert.equal(tx._created.payableUpdate.status, 'PAID');
});

test('socio sin cuenta SOCIO activa → 400', async () => {
  const tx = mkTx(null); // findFirst devuelve null
  await assert.rejects(
    applyPurchasePayments(tx, {
      payable: { id: 'c' }, vehicle: { id: 'v', plate: 'ABC', partnerId: 'socio1' }, userId: 'u', date: null,
      thirdPartyId: 'prov', totalDue: 20_000_000, partnerContribution: 8_000_000, socioThirdPartyId: 'socio1',
      payments: [{ accountId: 'accB', amount: 12_000_000 }],
    }),
    (e) => e.statusCode === 400,
  );
});

test('sin socio: comportamiento actual (solo tus pagos, sin cuenta SOCIO)', async () => {
  const tx = mkTx();
  await applyPurchasePayments(tx, {
    payable: { id: 'c' }, vehicle: { id: 'v', plate: 'X', partnerId: null }, userId: 'u', date: null,
    thirdPartyId: 'prov', totalDue: 20_000_000, partnerContribution: 0, socioThirdPartyId: null,
    payments: [{ accountId: 'accB', amount: 20_000_000 }],
  });
  assert.equal(tx._created.transactions.filter(t => t.accountId === 'accSocio').length, 0);
  assert.equal(tx._created.payableUpdate.status, 'PAID');
});
```
(Eliminar el test viejo "aporte > 0 sin partnerAccountId → 400" y el que verificaba el par INCOME+EXPENSE.)

- [ ] **Step 2: Ejecutar y ver fallar**
Run: `cd backend && node --test src/services/__tests__/purchaseService.test.js`
Expected: FAIL (aún hace INCOME+EXPENSE por `partnerAccountId`).

- [ ] **Step 3: Implementar**

En `applyPurchasePayments`, reemplazar la rama del socio (`if (partnerAmt > 0) { … INCOME … EXPENSE … }`) y quitar la guarda de `partnerAccountId`:
```javascript
if (partnerAmt > 0) {
  const socioAccount = await tx.account.findFirst({
    where: { type: 'SOCIO', thirdPartyId: socioThirdPartyId, isActive: true },
  });
  if (!socioAccount) {
    throw new AppError('El socio no tiene una cuenta activa; créala o actívala en Cuentas', 400);
  }
  const info = await computeAccountBalance(tx, socioAccount.id);
  if (info && info.balance - partnerAmt < 0) {
    warnings.push({ type: 'NEGATIVE_BALANCE', message: `La cuenta "${info.account.name}" quedará con saldo negativo después del aporte`, accountId: socioAccount.id, currentBalance: info.balance, newBalance: info.balance - partnerAmt });
  }
  const outTx = await tx.transaction.create({ data: {
    accountId: socioAccount.id, type: 'EXPENSE', category: 'VEHICLE_PURCHASE', amount: partnerAmt,
    description: `Pago compra ${vehicle.plate} (aporte socio)`, date: paymentDate,
    vehicleId: vehicle.id, thirdPartyId: thirdPartyId || null, createdBy: userId,
  }});
  transactions.push(outTx);
  await tx.payablePayment.create({ data: { payableId: payable.id, transactionId: outTx.id, amount: partnerAmt } });
}
```
Quitar `partnerAccountId` de la firma (parámetro) y de los dos call sites (`createVehicleWithPurchase`, `confirmPurchase`). Quitar el `if (partnerAmt > 0 && !partnerAccountId) throw…`. Mantener `socioThirdPartyId` (ya se pasa como `vehicle.partnerId`).

En `validation.js`: quitar `partnerAccountId: Joi.string().allow(null),` de los dos schemas `payment` de compra.

- [ ] **Step 4: Ejecutar y ver pasar**
Run: `cd backend && node --test src/`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/src/services/purchaseService.js backend/src/middleware/validation.js backend/src/services/__tests__/purchaseService.test.js
git commit -m "feat: el aporte del socio en la compra sale de su cuenta SOCIO (un egreso) — reemplaza el par neto 0"
```

---

## Task 4: Frontend — cuentas SOCIO + compra sin partnerAccountId

**Files:**
- Modify: `frontend/src/pages/treasury/AccountsPage.jsx` (o el componente de cuentas — grep `AccountType`/`CASH`/`BANK`)
- Modify: `frontend/src/components/vehicles/VehicleFormModal.jsx`

**Interfaces:**
- Consumes: cuentas con `type='SOCIO'` y `thirdParty`/nombre; backend de Task 3 (ya no espera `partnerAccountId`).

- [ ] **Step 1: Cuentas SOCIO visibles.** En la pantalla de Cuentas, incluir el tipo `SOCIO` en el listado/labels (etiqueta "Socio", mostrar el nombre de la cuenta que ya trae el socio). Permitir activar/desactivar y transferir (los flujos existentes ya operan por `accountId`; solo asegurar que las SOCIO no se filtren fuera). Si hay un mapa de labels/colores por tipo (como en ThirdPartySelector), agregar `SOCIO`.

- [ ] **Step 2: Compra sin `partnerAccountId`.** En `VehicleFormModal`, quitar el envío de `partnerAccountId` en ambos `paymentPayload` (Task 2 de la feature anterior lo agregó). En la sección de socio, mostrar "El aporte del socio sale de su cuenta: Cuenta Socio — {nombre}" (el nombre se puede tomar del tercero seleccionado o de un fetch de su cuenta SOCIO). Mantener "Aporte del socio: $X · Tu parte: $(P−X)".

- [ ] **Step 3: Build**
Run: `cd frontend && npm run build`
Expected: OK.

- [ ] **Step 4: Commit**
```bash
git add frontend/src
git commit -m "feat(ui): cuentas SOCIO visibles + compra usa la cuenta del socio (sin partnerAccountId)"
```

---

## Task 5: E2E

**Files:**
- Create: `tests/e2e/treasury/cuentas-socio.spec.ts`

**Interfaces:**
- Consumes: el flujo completo (marcar socio → cuenta → compra → transferencia).

- [ ] **Step 1: Escribir el e2e** (app + DB de test, `migrate reset` limpio):
  - Crear/editar un tercero a tipo **Socio (PARTNER)** → verificar por API que aparece su cuenta `SOCIO` (`GET /treasury/accounts` incluye una con `type='SOCIO'`, `thirdPartyId` = ese tercero, nombre `Cuenta Socio — …`).
  - Depositar en la cuenta del socio (transfer o saldo inicial) para que tenga fondos.
  - Comprar un carro (precio 20M) con ese socio aportando 8M → verificar que el egreso del aporte sale de la cuenta `SOCIO` (transacción EXPENSE en esa cuenta por 8M), CxP `PAYABLE` `PAID`, avanzar de etapa 200 OK.
  - Socio 100% (aporta 20M desde su cuenta) → CxP PAID, avanzar OK.
  - Transferir desde la cuenta del socio a otra cuenta → 200 OK (valida que las SOCIO permiten transferencias).
  - Socio sin cuenta activa (desactivar la cuenta y comprar) → 400 accionable.
  Deterministas; seguir helpers/patrones existentes.

- [ ] **Step 2: Ejecutar**
Run (con `migrate reset` limpio): `npx playwright test tests/e2e/treasury/cuentas-socio.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**
```bash
git add tests/e2e/treasury/cuentas-socio.spec.ts tests/helpers
git commit -m "test(e2e): cuentas dedicadas por socio + aporte de compra desde su cuenta"
```

---

## Self-Review (cobertura del spec)

- §2 nuevo tipo + link → Task 1 ✔
- §2 creación automática + backfill → Task 2 (auto) + Task 1 (backfill) ✔
- §2 aporte desde cuenta del socio (reemplaza Op. B) + resolución + 400 + warning → Task 3 ✔
- §3 backend (schema, ensureSocioAccount, applyPurchasePayments, validation) → Tasks 1-3 ✔
- §4 frontend (cuentas SOCIO, compra sin partnerAccountId) → Task 4 ✔
- §5 fuera de alcance (FASE B) → ninguna task toca PARTNER_SHARE/comisión entrando a la cuenta ✔
- §6 tests → Tasks 2-3 unit + Task 5 e2e ✔

**Nota de ejecución:** Task 3 revisa el flujo de compra recién cambiado (Opción B → egreso desde cuenta SOCIO); ejecutarla verde antes del frontend/e2e. Requiere Task 1 (enum/columna) y que exista al menos una cuenta SOCIO (auto/​backfill de Task 2/1) para el e2e.
