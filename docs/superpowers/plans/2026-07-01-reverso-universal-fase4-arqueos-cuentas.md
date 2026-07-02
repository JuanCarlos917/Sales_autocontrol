# Reverso Universal — Fase 4: Arqueos + Cuentas (backend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reversar arqueos (anular el registro) y cuentas (desactivar) vía audit log, sin mover plata, con endpoints admin.

**Architecture:** A diferencia de préstamos/créditos, estos dominios NO generan asientos compensatorios (no mueven plata) → no usan el motor `reversalEngine`, solo `writeTreasuryAudit` directo dentro de una `prisma.$transaction`. Un arqueo se **anula** marcando `voidedAt/voidedBy/voidReason` (campos ya creados en Fase 1) + audit `CASH_COUNT.REVERSE`. Una cuenta se **desactiva** (`isActive=false`) + audit `ACCOUNT.REVERSE`, bloqueada si tiene saldo≠0 o movimientos. **Sin migración** (los campos y las entidades/acciones de audit ya existen de Fase 1).

**Tech Stack:** Node.js + Express + Prisma + PostgreSQL (CommonJS). Tests: Playwright e2e (DB `autocontrol_test`). Estos servicios son DB-bound y se prueban por e2e (consistente con el repo: `accountService`/`cashCountService` no tienen unit tests).

## Global Constraints

- Backend **CommonJS**. `prisma = require('../config/database')`; `{ AppError } = require('../middleware/errorHandler')`; `{ writeTreasuryAudit, snapshotEntity } = require('../utils/treasuryAudit')`.
- Reverso: solo **ADMIN**; **motivo ≥10** (`schemas.treasuryDestructive`).
- **No mueven plata**: reversar un arqueo o desactivar una cuenta NO crea transacciones. El audit `TreasuryAuditLog` con `action: 'REVERSE'` es el único rastro; `entityType: 'CASH_COUNT'` (arqueo) o `'ACCOUNT'` (cuenta).
- Ambos endpoints devuelven **200** (mutación de estado, no creación de recurso) — a diferencia de los reversos de préstamo/crédito que devuelven 201 porque crean compensatorios.
- Arqueo anulado queda **visible** (no se borra); se marca `voidedAt`. `getLastByAccount` deja de devolver arqueos anulados (un arqueo anulado no es el último conteo válido).
- Cuenta: desactivar bloqueado si `Math.abs(saldo) > 0.001` o si tiene ≥1 transacción. El `DELETE /accounts/:id` existente (hard-delete sin audit) se **mantiene** intacto (fuera de alcance).
- Sin cambios de schema: `CashCount.voidedAt/voidedBy/voidReason`, entidades audit `CASH_COUNT`/`ACCOUNT` y acción `REVERSE` ya existen (Fase 1).

---

## File Structure

- **Modify** `backend/src/services/cashCountService.js` — import audit; método `reverse`; filtro `voidedAt: null` en `getLastByAccount`.
- **Modify** `backend/src/controllers/cashCountController.js` — `reverse`.
- **Modify** `backend/src/services/accountService.js` — método `reverseAccount`.
- **Modify** `backend/src/controllers/accountController.js` — `reverse`.
- **Modify** `backend/src/routes/treasury.js` — `POST /cash-counts/:id/reverse` y `POST /accounts/:id/reverse`.
- **Modify** `tests/helpers/api.ts` — `isActive` en interface `Account`; interface `CashCount`; helpers `apiCreateAccount`, `apiReverseAccountRaw`, `apiCreateCashCount`, `apiReverseCashCountRaw`.
- **Create** `tests/e2e/treasury/cashcount-reverse-api.spec.ts`.
- **Create** `tests/e2e/treasury/account-reverse-api.spec.ts`.

---

## Task 1: Anular arqueo (servicio + endpoint + e2e)

**Files:**
- Modify: `backend/src/services/cashCountService.js`
- Modify: `backend/src/controllers/cashCountController.js`
- Modify: `backend/src/routes/treasury.js`
- Modify: `tests/helpers/api.ts`
- Create: `tests/e2e/treasury/cashcount-reverse-api.spec.ts`

**Interfaces:**
- Consumes: `writeTreasuryAudit`; `schemas.treasuryDestructive`; `authorize`.
- Produces: `cashCountService.reverse(id, reason, userId): Promise<CashCount>` (anula: setea `voidedAt/voidedBy/voidReason` + audit `CASH_COUNT.REVERSE`); ruta `POST /api/treasury/cash-counts/:id/reverse` (ADMIN, motivo ≥10, 200).

- [ ] **Step 1: Import del audit helper en `cashCountService.js`**

Debajo de `const accountService = require('./accountService');` añadir:

```js
const { writeTreasuryAudit } = require('../utils/treasuryAudit');
```

- [ ] **Step 2: Método `reverse` en la clase `CashCountService`**

Añadir después de `getLastByAccount(accountId)`:

```js
  async reverse(id, reason, userId) {
    const cashCount = await prisma.cashCount.findUnique({ where: { id } });
    if (!cashCount) throw new AppError('Arqueo no encontrado', 404);
    if (cashCount.voidedAt) throw new AppError('Este arqueo ya fue anulado.', 409);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.cashCount.update({
        where: { id },
        data: { voidedAt: new Date(), voidedBy: userId, voidReason: reason },
        include: { account: { select: { id: true, name: true, type: true } } },
      });
      await writeTreasuryAudit(tx, {
        entityType: 'CASH_COUNT',
        entityId: id,
        userId,
        action: 'REVERSE',
        before: { voidedAt: null, difference: cashCount.difference.toString() },
        after: { voidedAt: updated.voidedAt.toISOString(), voidReason: reason },
        reason,
      });
      return updated;
    });
  }
```

- [ ] **Step 3: Filtrar arqueos anulados en `getLastByAccount`**

En `getLastByAccount`, cambiar el `where` de `{ accountId }` a `{ accountId, voidedAt: null }`:

```js
  async getLastByAccount(accountId) {
    return prisma.cashCount.findFirst({
      where: { accountId, voidedAt: null },
      orderBy: { date: 'desc' },
      include: {
        account: { select: { id: true, name: true, type: true } },
      },
    });
  }
```

- [ ] **Step 4: Controlador `reverse` en `cashCountController.js`**

Leer el controlador para conocer el estilo, luego añadir antes de `module.exports` una función `reverse` que devuelve **200**:

```js
const reverse = async (req, res, next) => {
  try {
    res.json(await cashCountService.reverse(req.params.id, req.body.reason, req.user.id));
  } catch (err) { next(err); }
};
```

Añadir `reverse` al `module.exports` (mantener los existentes).

- [ ] **Step 5: Ruta en `treasury.js`**

`treasury.js` ya importa `authorize`, `validate`, `schemas`. Después de `router.post('/cash-counts', validate(schemas.cashCount), cashCountCtrl.create);` añadir:

```js
router.post('/cash-counts/:id/reverse', authorize('ADMIN'), validate(schemas.treasuryDestructive), cashCountCtrl.reverse);
```

- [ ] **Step 6: Helpers e2e en `tests/helpers/api.ts`**

Añadir (junto a la sección de treasury/transactions raw):

```ts
export interface CashCount {
  id: string;
  voidedAt: string | null;
  difference: string | number;
  countedBalance: string | number;
  expectedBalance: string | number;
}

export async function apiCreateCashCount(
  token: string,
  data: { accountId: string; countedBalance: number; notes?: string },
): Promise<CashCount> {
  return postJson('/treasury/cash-counts', data, token);
}

export async function apiReverseCashCountRaw(
  token: string,
  id: string,
  reason: string,
): Promise<{ status: number; body: { error?: string; voidedAt?: string | null } }> {
  return apiRequestRaw('POST', `/treasury/cash-counts/${id}/reverse`, token, { reason });
}
```

- [ ] **Step 7: Escribir el e2e que falla**

Crear `tests/e2e/treasury/cashcount-reverse-api.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateCashCount, apiReverseCashCountRaw } from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — anular arqueo (API)', () => {
  test('anular un arqueo lo marca voided y no vuelve a anularse', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const cc = await apiCreateCashCount(token, {
      accountId: TEST_SEED_IDS.accountCash,
      countedBalance: 1_234_567,
      notes: 'arqueo de prueba',
    });
    expect(cc.voidedAt).toBeNull();

    const res = await apiReverseCashCountRaw(token, cc.id, 'conteo erróneo, se recontará');
    expect(res.status).toBe(200);
    expect(res.body.voidedAt).not.toBeNull();

    // Doble anulación → 409
    const second = await apiReverseCashCountRaw(token, cc.id, 'conteo erróneo, se recontará');
    expect(second.status).toBe(409);
  });

  test('motivo corto (<10) → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const cc = await apiCreateCashCount(token, { accountId: TEST_SEED_IDS.accountCash, countedBalance: 500_000 });
    expect((await apiReverseCashCountRaw(token, cc.id, 'corto')).status).toBe(400);
  });

  test('arqueo inexistente → 404', async ({ page }) => {
    const token = await loginAsAdmin(page);
    expect((await apiReverseCashCountRaw(token, 'noexiste', 'motivo suficiente largo')).status).toBe(404);
  });
});
```

- [ ] **Step 8: Correr unit + e2e**

Run: `cd backend && npm test 2>&1 | grep -E "# (tests|pass|fail)"`
Expected: `# fail 0` (sin regresión).

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
lsof -tiTCP:4000 -sTCP:LISTEN | xargs -r kill 2>/dev/null
lsof -tiTCP:5173 -sTCP:LISTEN | xargs -r kill 2>/dev/null
sleep 2
npx playwright test tests/e2e/treasury/cashcount-reverse-api.spec.ts --project=chromium 2>&1 | tail -12
```
Expected: `3 passed`.

- [ ] **Step 9: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add backend/src/services/cashCountService.js backend/src/controllers/cashCountController.js backend/src/routes/treasury.js tests/helpers/api.ts tests/e2e/treasury/cashcount-reverse-api.spec.ts
git commit -m "feat(treasury): anular arqueo (POST /cash-counts/:id/reverse) + audit CASH_COUNT.REVERSE"
```

---

## Task 2: Desactivar cuenta (servicio + endpoint + e2e)

**Files:**
- Modify: `backend/src/services/accountService.js`
- Modify: `backend/src/controllers/accountController.js`
- Modify: `backend/src/routes/treasury.js`
- Modify: `tests/helpers/api.ts`
- Create: `tests/e2e/treasury/account-reverse-api.spec.ts`

**Interfaces:**
- Consumes: `writeTreasuryAudit`, `snapshotEntity`, `ACCOUNT_AUDIT_FIELDS` (ya en `accountService.js`); `schemas.treasuryDestructive`; `authorize`.
- Produces: `accountService.reverseAccount(id, reason, userId): Promise<Account>` (desactiva: `isActive=false` + audit `ACCOUNT.REVERSE`, bloquea saldo≠0 o con movimientos); ruta `POST /api/treasury/accounts/:id/reverse` (ADMIN, motivo ≥10, 200).

- [ ] **Step 1: Método `reverseAccount` en la clase `AccountService`**

Añadir después de `delete(id)`:

```js
  async reverseAccount(id, reason, userId) {
    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing) throw new AppError('Cuenta no encontrada', 404);
    if (!existing.isActive) throw new AppError('La cuenta ya está desactivada.', 409);

    const balance = await this.calculateBalance(id);
    if (Math.abs(balance) > 0.001) {
      throw new AppError('No se puede desactivar una cuenta con saldo distinto de cero.', 403);
    }
    const transactionCount = await prisma.transaction.count({ where: { accountId: id } });
    if (transactionCount > 0) {
      throw new AppError('No se puede desactivar una cuenta con movimientos.', 403);
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.account.update({ where: { id }, data: { isActive: false } });
      await writeTreasuryAudit(tx, {
        entityType: 'ACCOUNT',
        entityId: id,
        userId,
        action: 'REVERSE',
        before: snapshotEntity(existing, ACCOUNT_AUDIT_FIELDS),
        after: snapshotEntity(updated, ACCOUNT_AUDIT_FIELDS),
        reason,
      });
      return { ...updated, currentBalance: 0 };
    });
  }
```

- [ ] **Step 2: Controlador `reverse` en `accountController.js`**

Añadir antes de `module.exports` una función `reverse` que devuelve **200**:

```js
const reverse = async (req, res, next) => {
  try {
    res.json(await accountService.reverseAccount(req.params.id, req.body.reason, req.user.id));
  } catch (err) { next(err); }
};
```

Actualizar el export para incluir `reverse` (mantener `getAll, getOne, create, update, remove, getTotalBalance`):

```js
module.exports = { getAll, getOne, create, update, remove, getTotalBalance, reverse };
```

- [ ] **Step 3: Ruta en `treasury.js`**

Después de `router.delete('/accounts/:id', accountCtrl.remove);` añadir:

```js
router.post('/accounts/:id/reverse', authorize('ADMIN'), validate(schemas.treasuryDestructive), accountCtrl.reverse);
```

- [ ] **Step 4: Helpers e2e en `tests/helpers/api.ts`**

En la interface `Account`, asegurar que incluye `isActive: boolean;` (añadirlo si falta). Y añadir dos helpers:

```ts
export async function apiCreateAccount(
  token: string,
  data: { name: string; type: 'CASH' | 'BANK'; initialBalance?: number },
): Promise<Account> {
  return postJson('/treasury/accounts', data, token);
}

export async function apiReverseAccountRaw(
  token: string,
  id: string,
  reason: string,
): Promise<{ status: number; body: { error?: string; isActive?: boolean } }> {
  return apiRequestRaw('POST', `/treasury/accounts/${id}/reverse`, token, { reason });
}
```

- [ ] **Step 5: Escribir el e2e que falla**

Crear `tests/e2e/treasury/account-reverse-api.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import { apiCreateAccount, apiGetAccount, apiReverseAccountRaw } from '../../helpers/api';

test.describe('Tesorería — desactivar cuenta (API)', () => {
  test('desactivar una cuenta vacía la marca inactiva y no se repite', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const acc = await apiCreateAccount(token, { name: 'Cuenta vacía a desactivar', type: 'BANK' });

    const res = await apiReverseAccountRaw(token, acc.id, 'cuenta creada por error');
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);

    const fetched = await apiGetAccount(token, acc.id);
    expect(fetched.isActive).toBe(false);

    // Doble desactivación → 409
    expect((await apiReverseAccountRaw(token, acc.id, 'cuenta creada por error')).status).toBe(409);
  });

  test('cuenta con movimientos/saldo no se puede desactivar → 403', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const acc = await apiCreateAccount(token, {
      name: 'Cuenta con saldo inicial',
      type: 'CASH',
      initialBalance: 5_000_000,
    });
    const res = await apiReverseAccountRaw(token, acc.id, 'intento con saldo');
    expect(res.status).toBe(403);
  });

  test('motivo corto (<10) → 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const acc = await apiCreateAccount(token, { name: 'Cuenta motivo corto', type: 'BANK' });
    expect((await apiReverseAccountRaw(token, acc.id, 'corto')).status).toBe(400);
  });

  test('cuenta inexistente → 404', async ({ page }) => {
    const token = await loginAsAdmin(page);
    expect((await apiReverseAccountRaw(token, 'noexiste', 'motivo suficiente largo')).status).toBe(404);
  });
});
```

- [ ] **Step 6: Correr unit + e2e**

Run: `cd backend && npm test 2>&1 | grep -E "# (tests|pass|fail)"`
Expected: `# fail 0`.

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
lsof -tiTCP:4000 -sTCP:LISTEN | xargs -r kill 2>/dev/null
lsof -tiTCP:5173 -sTCP:LISTEN | xargs -r kill 2>/dev/null
sleep 2
npx playwright test tests/e2e/treasury/account-reverse-api.spec.ts --project=chromium 2>&1 | tail -12
```
Expected: `4 passed`.

- [ ] **Step 7: Commit**

```bash
cd /Users/JuanGomez/Documents/DocumentsMac/Sales_Cars/APP/autocontrol-project
git add backend/src/services/accountService.js backend/src/controllers/accountController.js backend/src/routes/treasury.js tests/helpers/api.ts tests/e2e/treasury/account-reverse-api.spec.ts
git commit -m "feat(treasury): desactivar cuenta (POST /accounts/:id/reverse) + audit ACCOUNT.REVERSE"
```

---

## Definition of Done (Fase 4 backend)

- [ ] `POST /treasury/cash-counts/:id/reverse` anula el arqueo (voided + audit `CASH_COUNT.REVERSE`), 409 en doble, 400 motivo<10, 404 inexistente; `getLastByAccount` ignora anulados.
- [ ] `POST /treasury/accounts/:id/reverse` desactiva (isActive=false + audit `ACCOUNT.REVERSE`), 403 si saldo≠0/movimientos, 409 si ya inactiva, 400 motivo<10, 404 inexistente.
- [ ] Ambos ADMIN-only, atómicos, devuelven 200, sin crear transacciones.
- [ ] `npm test` verde; `cashcount-reverse-api.spec.ts` 3/3 y `account-reverse-api.spec.ts` 4/4.

## Notas / Fuera de alcance

- **UI:** badge "Anulado"/"Inactiva" + botón — fase de UI posterior. Backend usable por API.
- **`DELETE /accounts/:id`** (hard-delete sin audit, solo sin movimientos) se mantiene intacto; el nuevo `reverse` es la vía auditable y preferida para desactivar.
- Estos reversos devuelven **200** (mutación de estado) vs 201 de préstamos/créditos (crean compensatorios) — distinción deliberada.
