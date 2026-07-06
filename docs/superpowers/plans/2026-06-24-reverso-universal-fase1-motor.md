# Reverso Universal — Fase 1: Motor + Schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el motor de reverso compartido y los cambios de schema base, migrando el reverso de movimientos existente para usarlo sin cambiar su comportamiento observable.

**Architecture:** La lógica pura de compensación vive en `utils/transactionReversal.js` (sin Prisma, unit-testeable). La orquestación atómica (Prisma `$transaction` + audit log) vive en un módulo nuevo `services/reversalEngine.js`. Cada dominio (movimientos hoy; préstamos/créditos/etc. en fases siguientes) solo aporta "qué transacciones componen la operación" y llama al motor. El audit usa la tabla polimórfica `treasury_audit_logs` ya existente con la acción nueva `REVERSE`.

**Tech Stack:** Node.js + Express + Prisma + PostgreSQL. Tests con `node:test` (`npm test` → `node --test src/`) + Playwright e2e (DB `autocontrol_test`).

## Global Constraints

- Backend en **CommonJS** (`require`), no ES Modules.
- Moneda COP, **sin decimales** en UI; en DB `Decimal(15,2)`.
- Reverso: solo rol **ADMIN**, **motivo obligatorio ≥10 caracteres** (schema Joi `treasuryDestructive` ya existente).
- **Inmutabilidad**: reversar NUNCA borra ni edita el original; crea asiento compensatorio enlazado por `reversesTransactionId`. No introducir endpoints DELETE.
- `prisma = require('../config/database')`; `{ AppError } = require('../middleware/errorHandler')`.
- Migraciones: invocar la skill `database-migrations` antes de generar. Aplicar a la DB de dev (`migrate dev`) **y** a la de test (`migrate deploy` con `DATABASE_URL` de `autocontrol_test`).

---

## File Structure

- **Modify** `backend/prisma/schema.prisma` — enums `TreasuryAuditEntity`, `TreasuryAuditAction`, `TransactionCategory`; modelo `CashCount` (campos de anulación).
- **Create** `backend/prisma/migrations/<ts>_reversal_phase1/migration.sql` — generada por Prisma.
- **Modify** `backend/src/utils/treasuryAudit.js` — `VALID_ENTITIES`, `VALID_ACTIONS`.
- **Modify** `backend/src/utils/transactionReversal.js` — `flipType`, `buildReversalData` (param `category`), `buildReversalDataMany`.
- **Create** `backend/src/services/reversalEngine.js` — orquestador `applyReversal`.
- **Modify** `backend/src/services/transactionService.js:reverse` — usar el motor.
- **Modify** `backend/src/utils/__tests__/transactionReversal.test.js` — tests nuevos.
- **Create** `backend/src/utils/__tests__/treasuryAudit.reverse.test.js` — test de validadores nuevos (o ampliar `treasuryAudit.test.js`).

---

## Task 1: Migración de schema (enums + campos de anulación de arqueo)

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<ts>_reversal_phase1/migration.sql` (generada)

**Interfaces:**
- Produces: valores de enum `TransactionCategory.LOAN_REVERSAL`, `TransactionCategory.DEBT_REVERSAL`; `TreasuryAuditAction.REVERSE`; `TreasuryAuditEntity.LOAN | LOAN_PAYMENT | DEBT_PAYMENT | CASH_COUNT`; columnas `CashCount.voidedAt | voidedBy | voidReason`.

- [ ] **Step 1: Editar enums en `schema.prisma`**

En `enum TreasuryAuditEntity` añadir las líneas que falten (dejar `DEBT` que ya existe):

```prisma
enum TreasuryAuditEntity {
  TRANSACTION
  TRANSFER
  ACCOUNT
  PAYABLE
  PAYABLE_PAYMENT
  DEBT
  LOAN
  LOAN_PAYMENT
  DEBT_PAYMENT
  CASH_COUNT
}
```

En `enum TreasuryAuditAction` añadir `REVERSE`:

```prisma
enum TreasuryAuditAction {
  CREATE
  UPDATE
  DELETE
  CANCEL
  PAYMENT
  REVERSE
}
```

En `enum TransactionCategory` añadir al final, antes del cierre `}`:

```prisma
  LOAN_REVERSAL
  DEBT_REVERSAL
```

- [ ] **Step 2: Añadir campos de anulación a `CashCount`**

En `model CashCount`, después de `notes String?`, añadir:

```prisma
  voidedAt   DateTime?
  voidedBy   String?
  voidReason String?
```

- [ ] **Step 3: Generar y aplicar la migración en dev**

Run:
```bash
cd backend && npx prisma migrate dev --name reversal_phase1
```
Expected: crea `prisma/migrations/<ts>_reversal_phase1/`, aplica sin error, regenera el client. (Postgres ejecuta `ALTER TYPE ... ADD VALUE` para los enums y `ALTER TABLE cash_counts ADD COLUMN` para los 3 campos.)

- [ ] **Step 4: Aplicar la migración a la DB de test**

Run:
```bash
cd backend && DATABASE_URL='postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test' npx prisma migrate deploy
```
Expected: `Applied ... reversal_phase1`. La DB `autocontrol_test` queda al día para los e2e.

- [ ] **Step 5: Verificar que los valores de enum existen en el client**

Run:
```bash
cd backend && node -e "const {TransactionCategory,TreasuryAuditAction,TreasuryAuditEntity}=require('@prisma/client'); console.log(TransactionCategory.LOAN_REVERSAL, TransactionCategory.DEBT_REVERSAL, TreasuryAuditAction.REVERSE, TreasuryAuditEntity.CASH_COUNT, TreasuryAuditEntity.LOAN)"
```
Expected: `LOAN_REVERSAL DEBT_REVERSAL REVERSE CASH_COUNT LOAN`

- [ ] **Step 6: Commit**

```bash
cd backend && git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): enums de reverso + campos de anulación de arqueo (fase 1)"
```

---

## Task 2: Ampliar validadores del audit helper

**Files:**
- Modify: `backend/src/utils/treasuryAudit.js:VALID_ENTITIES,VALID_ACTIONS`
- Create: `backend/src/utils/__tests__/treasuryAudit.reverse.test.js`

**Interfaces:**
- Consumes: `writeTreasuryAudit`, `VALID_ENTITIES`, `VALID_ACTIONS` de `treasuryAudit.js`.
- Produces: `writeTreasuryAudit` acepta `action: 'REVERSE'` y `entityType: 'LOAN' | 'LOAN_PAYMENT' | 'DEBT_PAYMENT' | 'CASH_COUNT'`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/src/utils/__tests__/treasuryAudit.reverse.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { writeTreasuryAudit, VALID_ENTITIES, VALID_ACTIONS } = require('../treasuryAudit');

test('VALID_ACTIONS incluye REVERSE', () => {
  assert.ok(VALID_ACTIONS.includes('REVERSE'));
});

test('VALID_ENTITIES incluye LOAN, LOAN_PAYMENT, DEBT_PAYMENT, CASH_COUNT', () => {
  for (const e of ['LOAN', 'LOAN_PAYMENT', 'DEBT_PAYMENT', 'CASH_COUNT']) {
    assert.ok(VALID_ENTITIES.includes(e), `falta ${e}`);
  }
});

test('writeTreasuryAudit acepta REVERSE sobre LOAN sin lanzar', async () => {
  const calls = [];
  const fakeTx = { treasuryAuditLog: { create: async ({ data }) => { calls.push(data); return data; } } };
  await writeTreasuryAudit(fakeTx, {
    entityType: 'LOAN', entityId: 'loan-1', userId: 'u-1', action: 'REVERSE', reason: 'doble cobro corregido',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'REVERSE');
  assert.equal(calls[0].entityType, 'LOAN');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && node --test src/utils/__tests__/treasuryAudit.reverse.test.js`
Expected: FAIL — `REVERSE`/`LOAN` no están en las listas, `writeTreasuryAudit` lanza `action inválida` / `entityType inválido`.

- [ ] **Step 3: Implementar — ampliar las constantes**

En `backend/src/utils/treasuryAudit.js` reemplazar las dos líneas de constantes:

```js
const VALID_ENTITIES = ['TRANSACTION', 'TRANSFER', 'ACCOUNT', 'DEBT', 'PAYABLE', 'PAYABLE_PAYMENT', 'LOAN', 'LOAN_PAYMENT', 'DEBT_PAYMENT', 'CASH_COUNT'];
const VALID_ACTIONS  = ['CREATE', 'UPDATE', 'DELETE', 'CANCEL', 'PAYMENT', 'REVERSE'];
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && node --test src/utils/__tests__/treasuryAudit.reverse.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/utils/treasuryAudit.js src/utils/__tests__/treasuryAudit.reverse.test.js
git commit -m "feat(audit): soportar acción REVERSE y entidades LOAN/CASH_COUNT"
```

---

## Task 3: Lógica pura — `flipType`, `category` y `buildReversalDataMany`

**Files:**
- Modify: `backend/src/utils/transactionReversal.js`
- Modify: `backend/src/utils/__tests__/transactionReversal.test.js`

**Interfaces:**
- Consumes: `buildReversalData`, `MANUAL_REVERSAL` (ya existentes).
- Produces:
  - `flipType(type: string): string` — `INCOME↔EXPENSE`, `TRANSFER_IN↔TRANSFER_OUT`; lanza para otros.
  - `buildReversalData(original, userId, reason, category = MANUAL_REVERSAL)` — ahora acepta `category`.
  - `buildReversalDataMany(sources: object[], userId, reason, category = MANUAL_REVERSAL): object[]` — un compensatorio por fuente.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `backend/src/utils/__tests__/transactionReversal.test.js`:

```js
const { flipType, buildReversalDataMany } = require('../transactionReversal');

test('flipType invierte los cuatro tipos', () => {
  assert.equal(flipType('INCOME'), 'EXPENSE');
  assert.equal(flipType('EXPENSE'), 'INCOME');
  assert.equal(flipType('TRANSFER_IN'), 'TRANSFER_OUT');
  assert.equal(flipType('TRANSFER_OUT'), 'TRANSFER_IN');
});

test('flipType lanza para tipo no reversable', () => {
  assert.throws(() => flipType('OTRO'), /no reversable/);
});

test('buildReversalData usa la categoría dada', () => {
  const original = { id: 'tx-abc123', accountId: 'acc-1', type: 'EXPENSE', amount: '1000', vehicleId: null, thirdPartyId: null };
  const data = buildReversalData(original, 'u-1', 'motivo suficiente', 'LOAN_REVERSAL');
  assert.equal(data.category, 'LOAN_REVERSAL');
  assert.equal(data.type, 'INCOME');
  assert.equal(data.reversesTransactionId, 'tx-abc123');
});

test('buildReversalData por defecto es MANUAL_REVERSAL', () => {
  const original = { id: 'tx-1', accountId: 'acc-1', type: 'INCOME', amount: '1000', vehicleId: null, thirdPartyId: null };
  assert.equal(buildReversalData(original, 'u-1', 'motivo suficiente').category, MANUAL_REVERSAL);
});

test('buildReversalDataMany genera un compensatorio por fuente', () => {
  const sources = [
    { id: 'a', accountId: 'acc-1', type: 'EXPENSE', amount: '500', vehicleId: null, thirdPartyId: null },
    { id: 'b', accountId: 'acc-1', type: 'INCOME', amount: '300', vehicleId: null, thirdPartyId: null },
  ];
  const out = buildReversalDataMany(sources, 'u-1', 'anulación completa', 'LOAN_REVERSAL');
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'INCOME');
  assert.equal(out[1].type, 'EXPENSE');
  assert.ok(out.every((d) => d.category === 'LOAN_REVERSAL'));
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && node --test src/utils/__tests__/transactionReversal.test.js`
Expected: FAIL — `flipType is not a function` / `buildReversalDataMany is not a function`.

- [ ] **Step 3: Implementar en `transactionReversal.js`**

Sustituir la función `buildReversalData` por esta versión y añadir `flipType` + `buildReversalDataMany` antes del `module.exports`:

```js
const FLIP = { INCOME: 'EXPENSE', EXPENSE: 'INCOME', TRANSFER_IN: 'TRANSFER_OUT', TRANSFER_OUT: 'TRANSFER_IN' };

function flipType(type) {
  const flipped = FLIP[type];
  if (!flipped) throw new Error(`flipType: tipo no reversable: ${type}`);
  return flipped;
}

function buildReversalData(original, userId, reason, category = MANUAL_REVERSAL) {
  const flippedType = flipType(original.type);
  const ref = `#${String(original.id).slice(-6)}`;
  return {
    accountId: original.accountId,
    type: flippedType,
    category,
    amount: original.amount,
    description: `Reverso de ${ref} — ${reason}`,
    reversesTransactionId: original.id,
    vehicleId: original.vehicleId ?? null,
    thirdPartyId: original.thirdPartyId ?? null,
    createdBy: userId,
  };
}

function buildReversalDataMany(sources, userId, reason, category = MANUAL_REVERSAL) {
  return sources.map((s) => buildReversalData(s, userId, reason, category));
}
```

Actualizar el export:

```js
module.exports = { LINKED_FIELDS, MANUAL_REVERSAL, getReversibilityError, buildReversalData, buildReversalDataMany, flipType };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && node --test src/utils/__tests__/transactionReversal.test.js`
Expected: PASS (todos, incluidos los previos sin cambios).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/utils/transactionReversal.js src/utils/__tests__/transactionReversal.test.js
git commit -m "feat(reversal): flipType, categoría parametrizable y buildReversalDataMany"
```

---

## Task 4: Motor `reversalEngine.applyReversal` + migrar el reverso de movimientos

**Files:**
- Create: `backend/src/services/reversalEngine.js`
- Modify: `backend/src/services/transactionService.js` (método `reverse` + import)

**Interfaces:**
- Consumes: `buildReversalDataMany` (Task 3); `writeTreasuryAudit` (Task 2); `prisma`, `AppError`.
- Produces:
  - `applyReversal({ sources, reason, userId, category, auditEntityType, auditEntityId, include }): Promise<Transaction[]>` — crea los compensatorios + 1 audit `REVERSE` de forma atómica; mapea `P2002` → `AppError(409)`.
  - `ALREADY_REVERSED: string` (mensaje 409).

- [ ] **Step 1: Crear el motor `reversalEngine.js`**

Crear `backend/src/services/reversalEngine.js`:

```js
// ═══════════════════════════════════════════════════════════════
// Reversal Engine — orquesta el storno de una operación.
//
// Recibe las Transaction fuente, crea sus compensatorias (tipo
// invertido) y escribe UN audit REVERSE, todo atómico. Cada dominio
// (movimientos, préstamos, créditos…) solo decide qué fuentes pasar.
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { buildReversalDataMany } = require('../utils/transactionReversal');
const { writeTreasuryAudit } = require('../utils/treasuryAudit');

const ALREADY_REVERSED = 'Esta operación ya fue reversada.';

async function applyReversal({ sources, reason, userId, category, auditEntityType, auditEntityId, include }) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new AppError('No hay movimientos para reversar.', 400);
  }
  const dataList = buildReversalDataMany(sources, userId, reason, category);
  try {
    return await prisma.$transaction(async (tx) => {
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
    });
  } catch (err) {
    // Backstop a nivel DB: el índice único parcial dispara P2002 si dos
    // requests concurrentes pasan el pre-check y compiten por insertar.
    if (err.code === 'P2002') throw new AppError(ALREADY_REVERSED, 409);
    throw err;
  }
}

module.exports = { applyReversal, ALREADY_REVERSED };
```

- [ ] **Step 2: Migrar `transactionService.reverse` al motor**

En `backend/src/services/transactionService.js`, añadir el import junto a los demás (después de la línea de `treasuryAudit`):

```js
const { applyReversal } = require('./reversalEngine');
```

Reemplazar el bloque `try { return await prisma.$transaction(... } catch ...}` del método `reverse` por:

```js
    const [compensating] = await applyReversal({
      sources: [original],
      reason,
      userId,
      category: 'MANUAL_REVERSAL',
      auditEntityType: 'TRANSACTION',
      auditEntityId: original.id,
      include: TRANSACTION_INCLUDE,
    });
    return compensating;
```

(El `findUnique`, el `getReversibilityError` y el `throw` de validación quedan **igual**; `buildReversalData` ya no se usa directo en este método pero sigue importado para nada — eliminar `buildReversalData` del import de la línea 8 si queda sin uso.)

- [ ] **Step 3: Correr toda la suite unitaria**

Run: `cd backend && npm test 2>&1 | tail -5`
Expected: `# pass 75+` `# fail 0` (los 72 previos + los nuevos de Tasks 2–3).

- [ ] **Step 4: Verificar el reverso de movimientos end-to-end (sin regresión)**

Levantar nada manualmente — Playwright administra sus servidores. Asegurar que los puertos 4000/5173 estén libres, luego:

Run:
```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
lsof -tiTCP:4000 -sTCP:LISTEN | xargs -r kill 2>/dev/null
lsof -tiTCP:5173 -sTCP:LISTEN | xargs -r kill 2>/dev/null
sleep 2
npx playwright test tests/e2e/treasury/transaction-reverse-ui.spec.ts tests/e2e/treasury/transaction-reverse-api.spec.ts --project=chromium 2>&1 | tail -15
```
Expected: `8 passed`. Confirma que migrar al motor no cambió el comportamiento observable (categoría `MANUAL_REVERSAL`, badge, 409 doble reverso, 403/404/400 de guardas).

- [ ] **Step 5: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add backend/src/services/reversalEngine.js backend/src/services/transactionService.js
git commit -m "feat(reversal): motor applyReversal y migración del reverso de movimientos"
```

---

## Definition of Done (Fase 1)

- [ ] Migración aplicada en dev y test; enums y campos de arqueo disponibles en el client.
- [ ] `treasuryAudit` acepta `REVERSE` + entidades nuevas (unit).
- [ ] `flipType` / `buildReversalData(category)` / `buildReversalDataMany` cubiertos por unit tests.
- [ ] `reversalEngine.applyReversal` en uso por el reverso de movimientos.
- [ ] `npm test` verde; e2e de reverso de movimientos verde (8/8) sin regresión.

---

## Roadmap (fases siguientes — cada una con su propio plan)

Estas fases consumen el motor de la Fase 1. Cada una es entregable y testeable por sí sola; se planifican individualmente al cerrar la anterior.

- **Fase 2 — Préstamos:** índices únicos parciales `loan_reversal_unique`; `getLoanReversibility`; endpoints `POST /loan-payments/:id/reverse` (individual) y `POST /loans/:id/reverse` (cascada, categoría `LOAN_REVERSAL`); recálculo de `paidAmount`/`status`; UI `<ReverseAction>` en préstamos; e2e.
- **Fase 3 — Créditos:** espejo de Fase 2 sobre `Debt`/`DebtPayment` con `DEBT_REVERSAL`.
- **Fase 4 — Arqueos y Cuentas:** `POST /treasury/cash-counts/:id/reverse` (anula registro: `voidedAt/By/Reason` + audit `CASH_COUNT.REVERSE`); `POST /treasury/accounts/:id/reverse` (desactiva `isActive=false`, bloquea si saldo≠0 o tiene movimientos, audit `ACCOUNT.REVERSE`); e2e.
- **Fase 5 — Pantalla central de Auditoría:** extender `GET /treasury/audit` con filtros (`entityType`, `action`, `userId`, rango fechas, paginación); página `AuditLogPage` + filtros; e2e.
- **Fase 6 — Unificación:** migrar gasto/transferencia al motor; componentes compartidos `<ReverseAction>` / `<ReversedBadge>` en todas las listas; e2e de cobertura cruzada.
