# Créditos / financiaciones del negocio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modelar las deudas/financiaciones del negocio (`Debt`) con cronograma de cuotas, donde cada pago es un egreso trazable contra el saldo de la deuda, más una herramienta de reconciliación para enlazar egresos históricos mal categorizados.

**Architecture:** Entidad dedicada `Debt`/`DebtInstallment`/`DebtPayment` (espejo del lado pasivo de `Loan`). Los pagos son `Transaction` tipo EXPENSE categoría `DEBT_PAYMENT`, sin vehículo, enlazadas vía `debtId`/`debtPaymentId`. El origen del crédito NO genera movimiento de caja (financió un activo). La reconciliación reclasifica egresos históricos (sin tocar montos) y los enlaza a la deuda. Auditoría vía `treasury_audit_logs` (entidad nueva `DEBT`). La cobertura conductual la da el e2e Playwright (igual que `Loan`).

**Tech Stack:** Node.js + Express + Prisma + PostgreSQL (backend CommonJS), React 18 + Vite + Tailwind (frontend), `node:test` (unit), Playwright (e2e). COP enteros.

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `backend/prisma/schema.prisma` | Modificar | Modelos `Debt`/`DebtInstallment`/`DebtPayment`, enum `DebtStatus`, FKs en `Transaction`, valores de enum |
| `backend/prisma/migrations/.../migration.sql` | Crear (vía prisma) | DDL de las tablas/enum nuevos |
| `backend/src/utils/treasuryAudit.js` | Modificar | Agregar `DEBT` a `VALID_ENTITIES` |
| `backend/src/utils/__tests__/treasuryAudit.test.js` | Modificar | Contrato `VALID_ENTITIES` incluye `DEBT` |
| `backend/src/middleware/validation.js` | Modificar | Schemas Joi `debtCreate`/`debtPayment`/`debtReconcile` |
| `backend/src/services/debtService.js` | Crear | create/list/findById/cancel/addPayment/reconcile/reconcileCandidates |
| `backend/src/controllers/debtController.js` | Crear | Controladores delgados |
| `backend/src/routes/debts.js` | Crear | Rutas REST |
| `backend/src/routes/index.js` | Modificar | Montar `/debts` |
| `frontend/src/lib/treasuryApi.js` | Modificar | `debtsApi` |
| `frontend/src/pages/treasury/DebtsPage.jsx` | Crear | Listado de créditos |
| `frontend/src/components/treasury/NewDebtModal.jsx` | Crear | Alta con cronograma |
| `frontend/src/components/treasury/DebtPaymentModal.jsx` | Crear | Pago de cuota |
| `frontend/src/components/treasury/DebtReconcileModal.jsx` | Crear | Enlazar egresos históricos |
| `frontend/src/components/treasury/index.js` | Modificar | Exports |
| `frontend/src/App.jsx` | Modificar | Ruta `treasury/debts` |
| `frontend/src/pages/treasury/TreasuryPage.jsx` | Modificar | Link a Créditos |
| `tests/helpers/api.ts` | Modificar | Helpers e2e de debts |
| `tests/e2e/treasury/debt-tracking.spec.ts` | Crear | E2E crear/pagar/reconciliar |

---

## Task 1: Esquema Prisma + migración

**Files:**
- Modify: `backend/prisma/schema.prisma` (modelos nuevos; `model Transaction` FKs; `enum TransactionCategory`; `enum TreasuryAuditEntity`)
- Create: `backend/prisma/migrations/<timestamp>_add_debt_tracking/migration.sql`

- [ ] **Step 1: Agregar modelos y enum `DebtStatus`**

En `backend/prisma/schema.prisma`, después del bloque `model LoanPayment { ... }` (antes de `enum LoanStatus`), agregar:

```prisma
model Debt {
  id               String     @id @default(cuid())
  name             String
  lender           String?
  assetDescription String?
  totalAmount      Decimal    @db.Decimal(15, 2)
  paidAmount       Decimal    @default(0) @db.Decimal(15, 2)
  status           DebtStatus @default(PENDING)
  startDate        DateTime   @default(now())
  notes            String?
  createdBy        String
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt

  installments DebtInstallment[]
  payments     DebtPayment[]
  transactions Transaction[]

  @@index([status])
  @@map("debts")
}

model DebtInstallment {
  id            String            @id @default(cuid())
  debtId        String
  sequence      Int
  dueDate       DateTime
  plannedAmount Decimal           @db.Decimal(15, 2)
  paidAmount    Decimal           @default(0) @db.Decimal(15, 2)
  status        InstallmentStatus @default(PENDING)

  debt Debt @relation(fields: [debtId], references: [id], onDelete: Cascade)

  @@unique([debtId, sequence])
  @@index([dueDate])
  @@map("debt_installments")
}

model DebtPayment {
  id        String   @id @default(cuid())
  debtId    String
  accountId String
  amount    Decimal  @db.Decimal(15, 2)
  date      DateTime @default(now())
  notes     String?
  createdBy String
  createdAt DateTime @default(now())

  debt         Debt          @relation(fields: [debtId], references: [id], onDelete: Cascade)
  account      Account       @relation("DebtPaymentAccount", fields: [accountId], references: [id])
  transactions Transaction[]

  @@index([debtId])
  @@map("debt_payments")
}

enum DebtStatus {
  PENDING
  PARTIAL
  PAID
  CANCELLED
}
```

- [ ] **Step 2: Agregar FKs a `model Transaction`**

Dentro de `model Transaction`, después de las líneas `loanPaymentId String?` / `loanPayment LoanPayment? ...`, agregar:

```prisma
  debtId        String?
  debt          Debt?        @relation(fields: [debtId], references: [id])
  debtPaymentId String?
  debtPayment   DebtPayment? @relation(fields: [debtPaymentId], references: [id])
```

Y en los `@@index` de `Transaction`, agregar:

```prisma
  @@index([debtId])
  @@index([debtPaymentId])
```

- [ ] **Step 3: Agregar relación inversa en `model Account`**

`DebtPayment` usa la relación nombrada `"DebtPaymentAccount"` hacia `Account`. Dentro de `model Account`, agregar el campo inverso (junto a las otras relaciones de pagos/transacciones del modelo):

```prisma
  debtPayments DebtPayment[] @relation("DebtPaymentAccount")
```

- [ ] **Step 4: Agregar valores a enums existentes**

- En `enum TransactionCategory`, después de `LOAN_INTEREST_INCOME`, agregar: `DEBT_PAYMENT`
- En `enum TreasuryAuditEntity`, después de `PAYABLE_PAYMENT`, agregar: `DEBT`

- [ ] **Step 5: Generar la migración**

Run: `cd backend && npx prisma migrate dev --name add_debt_tracking --create-only`
Expected: crea `backend/prisma/migrations/<timestamp>_add_debt_tracking/migration.sql`.

Si el entorno no tiene TTY y `--create-only` falla, generar el SQL con diff y crear el archivo manualmente:
```
cd backend && npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "$DATABASE_URL" --script
```
y guardar la salida en `prisma/migrations/<timestamp>_add_debt_tracking/migration.sql` (con timestamp `date +%Y%m%d%H%M%S`).

- [ ] **Step 6: Aplicar la migración**

Run: `cd backend && npx prisma migrate dev`
Expected: aplica y regenera el client. Si no hay TTY, usar `npx prisma migrate deploy && npx prisma generate`.

- [ ] **Step 7: Verificar el client**

Run: `cd backend && node -e "const p=require('./src/config/database'); console.log(typeof p.debt, typeof p.debtPayment)"`
Expected: imprime `object object` (los modelos existen en el client).

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(treasury): schema y migración para deudas/créditos del negocio"
```

---

## Task 2: Audit — entidad `DEBT`

**Files:**
- Modify: `backend/src/utils/treasuryAudit.js:16`
- Modify: `backend/src/utils/__tests__/treasuryAudit.test.js` (test del contrato)

- [ ] **Step 1: Actualizar el test del contrato (RED)**

En `backend/src/utils/__tests__/treasuryAudit.test.js`, en el test `'VALID_ENTITIES / VALID_ACTIONS coinciden con el contrato del audit'`, reemplazar el array esperado de entidades:

```js
  assert.deepEqual(
    VALID_ENTITIES.slice().sort(),
    ['ACCOUNT', 'DEBT', 'PAYABLE', 'PAYABLE_PAYMENT', 'TRANSACTION', 'TRANSFER'],
  );
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && node --test src/utils/__tests__/treasuryAudit.test.js`
Expected: FAIL (el array actual no incluye `DEBT`).

- [ ] **Step 3: Agregar `DEBT` a `VALID_ENTITIES`**

En `backend/src/utils/treasuryAudit.js` línea 16, reemplazar:

```js
const VALID_ENTITIES = ['TRANSACTION', 'TRANSFER', 'ACCOUNT', 'PAYABLE', 'PAYABLE_PAYMENT', 'DEBT'];
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && node --test src/utils/__tests__/treasuryAudit.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/treasuryAudit.js backend/src/utils/__tests__/treasuryAudit.test.js
git commit -m "feat(treasury): habilitar audit log para entidad DEBT"
```

---

## Task 3: Validación Joi

**Files:**
- Modify: `backend/src/middleware/validation.js` (agregar schemas y registrarlos en `module.exports.schemas`)

- [ ] **Step 1: Definir los schemas de deuda**

En `backend/src/middleware/validation.js`, después del bloque `// ── Loan Schemas ──` (tras `loanPaymentSchema`), agregar:

```js
// ── Debt Schemas (créditos/financiaciones del negocio) ──
const debtInstallmentSchema = Joi.object({
  sequence: Joi.number().integer().positive().required(),
  dueDate: Joi.date().required(),
  plannedAmount: Joi.number().integer().positive().required(),
});

const debtCreateSchema = Joi.object({
  name: Joi.string().max(120).required().messages({ 'any.required': 'Nombre del crédito es requerido' }),
  lender: Joi.string().max(120).allow('', null),
  assetDescription: Joi.string().max(200).allow('', null),
  startDate: Joi.date().allow(null),
  notes: Joi.string().max(2000).allow('', null),
  installments: Joi.array().items(debtInstallmentSchema).min(1).required(),
});

const debtPaymentSchema = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'Cuenta origen es requerida' }),
  amount: Joi.number().integer().positive().required(),
  date: Joi.date().allow(null),
  notes: Joi.string().max(500).allow('', null),
});

const debtReconcileSchema = Joi.object({
  transactionIds: Joi.array().items(Joi.string()).min(1).required(),
});
```

- [ ] **Step 2: Registrar en el mapa de schemas exportado**

En `backend/src/middleware/validation.js`, dentro del objeto que exporta los schemas (donde están `loanCreate: loanCreateSchema, loanPayment: loanPaymentSchema`), agregar:

```js
    debtCreate: debtCreateSchema,
    debtPayment: debtPaymentSchema,
    debtReconcile: debtReconcileSchema,
```

- [ ] **Step 3: Verificar carga**

Run: `cd backend && node -e "const {schemas}=require('./src/middleware/validation'); console.log(!!schemas.debtCreate, !!schemas.debtPayment, !!schemas.debtReconcile)"`
Expected: `true true true`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/middleware/validation.js
git commit -m "feat(treasury): schemas de validación para deudas"
```

---

## Task 4: `debtService` — create / list / findById / cancel

**Files:**
- Create: `backend/src/services/debtService.js`

- [ ] **Step 1: Crear el servicio con create/list/findById/cancel**

Crear `backend/src/services/debtService.js`:

```js
// ═══════════════════════════════════════════════════════════════
// Service — Debts (créditos/financiaciones del negocio, lado pasivo)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const accountService = require('./accountService');
const { writeTreasuryAudit, snapshotEntity } = require('../utils/treasuryAudit');

const DEBT_INCLUDE = {
  installments: { orderBy: { sequence: 'asc' } },
  payments: {
    orderBy: { date: 'desc' },
    include: { account: { select: { id: true, name: true } } },
  },
};

const DEBT_SNAPSHOT_FIELDS = ['name', 'lender', 'totalAmount', 'paidAmount', 'status'];

function recomputeDebtStatus(total, paid) {
  const t = parseFloat(total);
  const q = parseFloat(paid);
  if (q <= 0) return 'PENDING';
  if (q >= t) return 'PAID';
  return 'PARTIAL';
}

function recomputeInstallmentStatus(planned, paid) {
  const p = parseFloat(planned);
  const q = parseFloat(paid);
  if (q <= 0) return 'PENDING';
  if (q >= p) return 'PAID';
  return 'PARTIAL';
}

function annotateOverdue(debt) {
  if (debt.status === 'PAID' || debt.status === 'CANCELLED') {
    return { ...debt, isOverdue: false };
  }
  const now = new Date();
  const isOverdue = debt.installments.some(
    (i) => i.status !== 'PAID' && new Date(i.dueDate) < now,
  );
  return { ...debt, isOverdue };
}

class DebtService {
  async create({ name, lender, assetDescription, startDate, notes, installments }, userId) {
    const sequences = installments.map((i) => i.sequence).sort((a, b) => a - b);
    for (let i = 0; i < sequences.length; i++) {
      if (sequences[i] !== i + 1) {
        throw new AppError('Las secuencias de cuotas deben ser 1..N sin huecos ni duplicados', 400);
      }
    }

    const totalAmount = installments.reduce((s, i) => s + parseFloat(i.plannedAmount), 0);

    const result = await prisma.$transaction(async (tx) => {
      const debt = await tx.debt.create({
        data: {
          name,
          lender: lender || null,
          assetDescription: assetDescription || null,
          totalAmount,
          startDate: startDate ? new Date(startDate) : new Date(),
          notes: notes || null,
          createdBy: userId,
          installments: {
            create: installments.map((i) => ({
              sequence: i.sequence,
              dueDate: new Date(i.dueDate),
              plannedAmount: parseFloat(i.plannedAmount),
            })),
          },
        },
        include: DEBT_INCLUDE,
      });

      await writeTreasuryAudit(tx, {
        entityType: 'DEBT',
        entityId: debt.id,
        userId,
        action: 'CREATE',
        after: snapshotEntity(debt, DEBT_SNAPSHOT_FIELDS),
      });

      return debt;
    });

    return annotateOverdue(result);
  }

  async list({ status } = {}) {
    const where = {};
    if (status) where.status = status;
    const debts = await prisma.debt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: DEBT_INCLUDE,
    });
    return debts.map(annotateOverdue);
  }

  async findById(id) {
    const debt = await prisma.debt.findUnique({ where: { id }, include: DEBT_INCLUDE });
    if (!debt) throw new AppError('Crédito no encontrado', 404);
    return annotateOverdue(debt);
  }

  async cancel(debtId, userId) {
    const debt = await prisma.debt.findUnique({ where: { id: debtId } });
    if (!debt) throw new AppError('Crédito no encontrado', 404);
    if (debt.status !== 'PENDING') {
      throw new AppError('Solo se pueden cancelar créditos sin pagos (status PENDING)', 400);
    }
    const updated = await prisma.$transaction(async (tx) => {
      const d = await tx.debt.update({
        where: { id: debtId },
        data: { status: 'CANCELLED' },
        include: DEBT_INCLUDE,
      });
      await writeTreasuryAudit(tx, {
        entityType: 'DEBT', entityId: debtId, userId, action: 'CANCEL',
        before: snapshotEntity(debt, DEBT_SNAPSHOT_FIELDS),
      });
      return d;
    });
    return annotateOverdue(updated);
  }
}

module.exports = new DebtService();
module.exports.recomputeDebtStatus = recomputeDebtStatus;
module.exports.recomputeInstallmentStatus = recomputeInstallmentStatus;
module.exports.annotateOverdue = annotateOverdue;
module.exports.DEBT_INCLUDE = DEBT_INCLUDE;
```

- [ ] **Step 2: Verificar carga del módulo**

Run: `cd backend && node -e "const s=require('./src/services/debtService'); console.log(s.recomputeDebtStatus(11000000,11000000), s.recomputeDebtStatus(0,0), s.recomputeDebtStatus(11000000,5000000))"`
Expected: `PAID PENDING PARTIAL`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/debtService.js
git commit -m "feat(treasury): debtService create/list/findById/cancel"
```

---

## Task 5: `debtService.addPayment`

**Files:**
- Modify: `backend/src/services/debtService.js` (agregar método `addPayment` dentro de la clase, antes de `cancel`)

- [ ] **Step 1: Implementar `addPayment`**

En `backend/src/services/debtService.js`, dentro de `class DebtService`, agregar el método (antes de `cancel`):

```js
  async addPayment(debtId, { accountId, amount, date, notes }, userId) {
    const pay = parseFloat(amount);
    if (pay <= 0) throw new AppError('El pago debe ser mayor a 0', 400);

    const debt = await prisma.debt.findUnique({
      where: { id: debtId },
      include: { installments: { orderBy: { sequence: 'asc' } } },
    });
    if (!debt) throw new AppError('Crédito no encontrado', 404);
    if (debt.status === 'CANCELLED') throw new AppError('Crédito cancelado', 400);
    if (debt.status === 'PAID') throw new AppError('Crédito ya está totalmente pagado', 400);

    const remaining = parseFloat(debt.totalAmount) - parseFloat(debt.paidAmount);
    if (pay > remaining + 0.001) {
      throw new AppError(`El monto (${pay}) excede el saldo pendiente (${remaining})`, 400);
    }

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || !account.isActive) throw new AppError('Cuenta origen no encontrada o inactiva', 404);

    const balance = await accountService.calculateBalance(accountId);
    if (balance < pay) {
      throw new AppError(`Saldo insuficiente en la cuenta origen (saldo: ${balance}, requerido: ${pay})`, 400);
    }

    // Imputación FIFO a cuotas pendientes
    let rest = pay;
    const installmentUpdates = [];
    for (const inst of debt.installments) {
      if (rest <= 0) break;
      const owed = parseFloat(inst.plannedAmount) - parseFloat(inst.paidAmount);
      if (owed <= 0) continue;
      const apply = Math.min(owed, rest);
      const newPaid = parseFloat(inst.paidAmount) + apply;
      installmentUpdates.push({ id: inst.id, newPaid, newStatus: recomputeInstallmentStatus(inst.plannedAmount, newPaid) });
      rest -= apply;
    }

    const newPaidAmount = parseFloat(debt.paidAmount) + pay;
    const newStatus = recomputeDebtStatus(debt.totalAmount, newPaidAmount);

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.debtPayment.create({
        data: {
          debtId,
          accountId,
          amount: pay,
          date: new Date(), // fecha de contabilización = instante de registro
          notes: notes || null,
          createdBy: userId,
        },
      });

      await tx.transaction.create({
        data: {
          accountId,
          type: 'EXPENSE',
          category: 'DEBT_PAYMENT',
          amount: pay,
          description: `Pago crédito: ${debt.name}`,
          date: new Date(),
          debtId,
          debtPaymentId: payment.id,
          createdBy: userId,
        },
      });

      for (const u of installmentUpdates) {
        await tx.debtInstallment.update({
          where: { id: u.id },
          data: { paidAmount: u.newPaid, status: u.newStatus },
        });
      }

      const updatedDebt = await tx.debt.update({
        where: { id: debtId },
        data: { paidAmount: newPaidAmount, status: newStatus },
        include: DEBT_INCLUDE,
      });

      await writeTreasuryAudit(tx, {
        entityType: 'DEBT', entityId: debtId, userId, action: 'PAYMENT',
        before: { paidAmount: debt.paidAmount.toString(), status: debt.status },
        after: { paidAmount: String(newPaidAmount), status: newStatus, debtPaymentId: payment.id },
      });

      return updatedDebt;
    });

    return annotateOverdue(result);
  }
```

- [ ] **Step 2: Verificar carga del módulo**

Run: `cd backend && node -e "require('./src/services/debtService')"`
Expected: sin errores. (La verificación funcional ocurre en el e2e, Task 10.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/debtService.js
git commit -m "feat(treasury): debtService addPayment (egreso DEBT_PAYMENT + FIFO)"
```

---

## Task 6: `debtService` — reconciliación de egresos históricos

**Files:**
- Modify: `backend/src/services/debtService.js` (agregar `reconcileCandidates` y `reconcile`)

- [ ] **Step 1: Implementar `reconcileCandidates` y `reconcile`**

En `backend/src/services/debtService.js`, dentro de `class DebtService`, agregar (antes de `cancel`):

```js
  // Egresos históricos candidatos a enlazar: transacciones EXPENSE
  // que no estén ya enlazadas a una deuda. Filtro opcional por texto.
  async reconcileCandidates({ search } = {}) {
    const where = { type: 'EXPENSE', debtId: null };
    if (search) where.description = { contains: search, mode: 'insensitive' };
    return prisma.transaction.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 200,
      select: {
        id: true, date: true, amount: true, description: true, category: true,
        accountId: true, vehicleId: true, expenseId: true,
        account: { select: { id: true, name: true } },
      },
    });
  }

  // Enlaza egresos existentes a la deuda SIN crear movimiento de caja nuevo
  // ni alterar montos. Reclasifica la transacción a DEBT_PAYMENT, la desliga
  // del vehículo, y soft-deletea el Expense de origen (sin reversa de caja).
  async reconcile(debtId, { transactionIds }, userId) {
    const debt = await prisma.debt.findUnique({
      where: { id: debtId },
      include: { installments: { orderBy: { sequence: 'asc' } } },
    });
    if (!debt) throw new AppError('Crédito no encontrado', 404);
    if (debt.status === 'CANCELLED') throw new AppError('Crédito cancelado', 400);

    const txs = await prisma.transaction.findMany({ where: { id: { in: transactionIds } } });
    if (txs.length !== transactionIds.length) {
      throw new AppError('Alguna transacción no existe', 404);
    }
    for (const t of txs) {
      if (t.type !== 'EXPENSE') throw new AppError(`La transacción ${t.id} no es un egreso`, 400);
      if (t.debtId) throw new AppError(`La transacción ${t.id} ya está enlazada a una deuda`, 400);
    }

    const sumLink = txs.reduce((s, t) => s + parseFloat(t.amount), 0);
    const remaining = parseFloat(debt.totalAmount) - parseFloat(debt.paidAmount);
    if (sumLink > remaining + 0.001) {
      throw new AppError(`Lo reconciliado (${sumLink}) excede el saldo pendiente (${remaining})`, 400);
    }

    // Estado mutable en memoria para imputación FIFO acumulada
    const instState = debt.installments.map((i) => ({
      id: i.id, planned: parseFloat(i.plannedAmount), paid: parseFloat(i.paidAmount),
    }));
    let runningPaid = parseFloat(debt.paidAmount);

    const result = await prisma.$transaction(async (tx) => {
      for (const t of txs) {
        const amt = parseFloat(t.amount);

        const payment = await tx.debtPayment.create({
          data: {
            debtId, accountId: t.accountId, amount: amt,
            date: t.date, notes: 'Reconciliación de egreso histórico', createdBy: userId,
          },
        });

        const before = { category: t.category, vehicleId: t.vehicleId, expenseId: t.expenseId, debtId: t.debtId };
        await tx.transaction.update({
          where: { id: t.id },
          data: {
            category: 'DEBT_PAYMENT',
            vehicleId: null,
            expenseId: null,
            debtId,
            debtPaymentId: payment.id,
          },
        });
        await writeTreasuryAudit(tx, {
          entityType: 'TRANSACTION', entityId: t.id, userId, action: 'UPDATE',
          before,
          after: { category: 'DEBT_PAYMENT', vehicleId: null, expenseId: null, debtId, debtPaymentId: payment.id },
          reason: `Reconciliación a crédito ${debtId}`,
        });

        // Soft-delete del Expense de origen (sin reversa de caja)
        if (t.expenseId) {
          await tx.expense.update({
            where: { id: t.expenseId },
            data: { deletedAt: new Date(), deletedBy: userId },
          });
        }

        // Imputación FIFO acumulada
        let rest = amt;
        for (const s of instState) {
          if (rest <= 0) break;
          const owed = s.planned - s.paid;
          if (owed <= 0) continue;
          const apply = Math.min(owed, rest);
          s.paid += apply;
          rest -= apply;
          await tx.debtInstallment.update({
            where: { id: s.id },
            data: { paidAmount: s.paid, status: recomputeInstallmentStatus(s.planned, s.paid) },
          });
        }
        runningPaid += amt;

        await writeTreasuryAudit(tx, {
          entityType: 'DEBT', entityId: debtId, userId, action: 'PAYMENT',
          after: { reconciledTransactionId: t.id, amount: String(amt), debtPaymentId: payment.id },
        });
      }

      const updatedDebt = await tx.debt.update({
        where: { id: debtId },
        data: { paidAmount: runningPaid, status: recomputeDebtStatus(debt.totalAmount, runningPaid) },
        include: DEBT_INCLUDE,
      });
      return updatedDebt;
    });

    return annotateOverdue(result);
  }
```

- [ ] **Step 2: Verificar carga del módulo**

Run: `cd backend && node -e "require('./src/services/debtService')"`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/debtService.js
git commit -m "feat(treasury): debtService reconcile + reconcileCandidates"
```

---

## Task 7: Controller + rutas + montaje

**Files:**
- Create: `backend/src/controllers/debtController.js`
- Create: `backend/src/routes/debts.js`
- Modify: `backend/src/routes/index.js:28` (montar `/debts`)

- [ ] **Step 1: Crear el controller**

Crear `backend/src/controllers/debtController.js`:

```js
const debtService = require('../services/debtService');

const create = async (req, res, next) => {
  try { res.status(201).json(await debtService.create(req.body, req.user.id)); }
  catch (err) { next(err); }
};

const list = async (req, res, next) => {
  try { res.json(await debtService.list({ status: req.query.status || undefined })); }
  catch (err) { next(err); }
};

const findById = async (req, res, next) => {
  try { res.json(await debtService.findById(req.params.id)); }
  catch (err) { next(err); }
};

const addPayment = async (req, res, next) => {
  try { res.status(201).json(await debtService.addPayment(req.params.id, req.body, req.user.id)); }
  catch (err) { next(err); }
};

const reconcileCandidates = async (req, res, next) => {
  try { res.json(await debtService.reconcileCandidates({ search: req.query.search || undefined })); }
  catch (err) { next(err); }
};

const reconcile = async (req, res, next) => {
  try { res.status(201).json(await debtService.reconcile(req.params.id, req.body, req.user.id)); }
  catch (err) { next(err); }
};

const cancel = async (req, res, next) => {
  try { res.json(await debtService.cancel(req.params.id, req.user.id)); }
  catch (err) { next(err); }
};

module.exports = { create, list, findById, addPayment, reconcileCandidates, reconcile, cancel };
```

- [ ] **Step 2: Crear las rutas**

Crear `backend/src/routes/debts.js`:

```js
const express = require('express');
const ctrl = require('../controllers/debtController');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();

router.get('/', ctrl.list);
router.get('/reconcile-candidates', ctrl.reconcileCandidates);
router.get('/:id', ctrl.findById);
router.post('/', validate(schemas.debtCreate), ctrl.create);
router.post('/:id/payments', validate(schemas.debtPayment), ctrl.addPayment);
router.post('/:id/reconcile', validate(schemas.debtReconcile), ctrl.reconcile);
router.post('/:id/cancel', ctrl.cancel);

module.exports = router;
```

> Nota: `/reconcile-candidates` se declara antes que `/:id` para que no lo capture la ruta param.

- [ ] **Step 3: Montar en el router principal**

En `backend/src/routes/index.js`, después de la línea `router.use('/loans', require('./loans'));` (línea 28), agregar:

```js
router.use('/debts', require('./debts'));
```

- [ ] **Step 4: Verificar que el server carga**

Run: `cd backend && node -e "require('./src/routes/index')"`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/debtController.js backend/src/routes/debts.js backend/src/routes/index.js
git commit -m "feat(treasury): endpoints REST de deudas/créditos"
```

---

## Task 8: Frontend — API client + página + ruta + link

**Files:**
- Modify: `frontend/src/lib/treasuryApi.js` (tras `loansApi`)
- Create: `frontend/src/pages/treasury/DebtsPage.jsx`
- Modify: `frontend/src/App.jsx` (import + ruta)
- Modify: `frontend/src/pages/treasury/TreasuryPage.jsx` (link a Créditos)

- [ ] **Step 1: Agregar `debtsApi`**

En `frontend/src/lib/treasuryApi.js`, después del objeto `loansApi` (que termina con `cancel: (id) => api.post(\`/loans/${id}/cancel\`),` y su `};`), agregar:

```js
export const debtsApi = {
  getAll: (params) => api.get('/debts', { params }),
  getById: (id) => api.get(`/debts/${id}`),
  create: (data) => api.post('/debts', data),
  addPayment: (id, data) => api.post(`/debts/${id}/payments`, data),
  reconcileCandidates: (params) => api.get('/debts/reconcile-candidates', { params }),
  reconcile: (id, data) => api.post(`/debts/${id}/reconcile`, data),
  cancel: (id) => api.post(`/debts/${id}/cancel`),
};
```

- [ ] **Step 2: Crear `DebtsPage.jsx`**

Crear `frontend/src/pages/treasury/DebtsPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { debtsApi } from '@/lib/treasuryApi';
import { formatCurrency, formatDate } from '@/lib/constants';
import { NewDebtModal, DebtPaymentModal, DebtReconcileModal } from '@/components/treasury';

const STATUS_LABEL = { PENDING: 'Pendiente', PARTIAL: 'Parcial', PAID: 'Pagado', CANCELLED: 'Cancelado' };
const STATUS_COLOR = {
  PENDING: 'bg-amber-500/20 text-amber-400',
  PARTIAL: 'bg-sky-500/20 text-sky-400',
  PAID: 'bg-green-500/20 text-green-400',
  CANCELLED: 'bg-[#6E7681]/20 text-[#6E7681]',
};

export default function DebtsPage() {
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [paying, setPaying] = useState(null);
  const [reconciling, setReconciling] = useState(null);

  const reload = async () => {
    setLoading(true);
    try { const { data } = await debtsApi.getAll(); setDebts(data); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const totals = {
    owed: debts.reduce((s, d) => s + parseFloat(d.totalAmount), 0),
    paid: debts.reduce((s, d) => s + parseFloat(d.paidAmount), 0),
  };
  totals.pending = totals.owed - totals.paid;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/treasury" className="text-[#6E7681] hover:text-accent transition-colors">← Tesorería</Link>
          <h2 className="text-xl font-bold text-[#E6EDF3] mt-2">Créditos / financiaciones</h2>
          <p className="text-sm text-[#6E7681] mt-1">Deudas del negocio con cronograma de cuotas</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right"><div className="text-[#6E7681]">Debido</div><div className="font-mono font-bold text-[#E6EDF3]">{formatCurrency(totals.owed)}</div></div>
          <div className="text-right"><div className="text-[#6E7681]">Pagado</div><div className="font-mono font-bold text-green-400">{formatCurrency(totals.paid)}</div></div>
          <div className="text-right"><div className="text-[#6E7681]">Pendiente</div><div className="font-mono font-bold text-amber-400">{formatCurrency(totals.pending)}</div></div>
          <button onClick={() => setShowNew(true)} className="btn-primary" data-testid="debts-create-button">+ Nuevo crédito</button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-[#6E7681]">Cargando...</div>
      ) : debts.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-4">🏦</div>
          <h3 className="text-lg font-semibold text-[#E6EDF3] mb-2">Sin créditos</h3>
          <p className="text-sm text-[#6E7681]">Creá uno con el botón de arriba.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {debts.map((debt) => {
            const pending = parseFloat(debt.totalAmount) - parseFloat(debt.paidAmount);
            const next = debt.installments?.find((i) => i.status !== 'PAID');
            return (
              <div key={debt.id} className={`card p-4 ${debt.isOverdue ? 'border-red-500/40' : ''}`} data-testid={`debt-card-${debt.id}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-base font-semibold text-[#E6EDF3]">{debt.name}</div>
                    <div className="text-xs text-[#6E7681]">{debt.lender || debt.assetDescription || 'Crédito'}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLOR[debt.status]}`}>{STATUS_LABEL[debt.status]}</span>
                </div>
                <div className="flex justify-between items-end mb-3">
                  <div><div className="text-xs text-[#6E7681]">Pendiente</div><div className="text-xl font-mono font-bold text-amber-400">{formatCurrency(pending)}</div></div>
                  <div className="text-right text-xs text-[#6E7681]">de {formatCurrency(debt.totalAmount)}</div>
                </div>
                {next && (
                  <div className={`text-xs mb-3 ${debt.isOverdue ? 'text-red-400' : 'text-[#6E7681]'}`}>
                    📅 Próxima cuota #{next.sequence}: {formatDate(next.dueDate)} ({formatCurrency(next.plannedAmount)})
                  </div>
                )}
                <div className="flex gap-2 pt-3 border-t border-border">
                  {debt.status !== 'PAID' && debt.status !== 'CANCELLED' && (
                    <button onClick={() => setPaying(debt)} className="flex-1 py-2 rounded-lg text-xs font-semibold bg-green-500/20 text-green-400 hover:bg-green-500/30" data-testid={`debt-card-${debt.id}-pay-button`}>💸 Pagar cuota</button>
                  )}
                  <button onClick={() => setReconciling(debt)} className="flex-1 py-2 rounded-lg text-xs font-semibold bg-sky-500/20 text-sky-400 hover:bg-sky-500/30" data-testid={`debt-card-${debt.id}-reconcile-button`}>🔗 Reconciliar</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewDebtModal isOpen={showNew} onClose={() => setShowNew(false)} onCreated={reload} />
      <DebtPaymentModal isOpen={!!paying} debt={paying} onClose={() => setPaying(null)} onPaid={reload} />
      <DebtReconcileModal isOpen={!!reconciling} debt={reconciling} onClose={() => setReconciling(null)} onDone={reload} />
    </div>
  );
}
```

- [ ] **Step 3: Registrar la ruta**

En `frontend/src/App.jsx`: agregar el import junto a los otros de treasury (tras `import LoansPage from '@/pages/treasury/LoansPage';`):

```jsx
import DebtsPage from '@/pages/treasury/DebtsPage';
```

Y la ruta, después de `<Route path="treasury/loans" element={<LoansPage />} />`:

```jsx
          <Route path="treasury/debts" element={<DebtsPage />} />
```

- [ ] **Step 4: Link desde el landing de Tesorería**

En `frontend/src/pages/treasury/TreasuryPage.jsx`, localizar el bloque/listado de enlaces de navegación a sub-secciones (donde está el link a `/treasury/loans`, "Préstamos") y agregar un enlace análogo a `/treasury/debts` con etiqueta "Créditos". Copiar la estructura del item de Préstamos (mismo componente/clases), cambiando `to="/treasury/debts"`, el ícono a `🏦` y el texto a "Créditos".

- [ ] **Step 5: Verificar build**

Run: `cd frontend && npm run build`
Expected: build exitoso (los componentes `NewDebtModal`/`DebtPaymentModal`/`DebtReconcileModal` se crean en la Task 9; si la build corre antes, este paso fallará por import faltante — ejecutar este Step DESPUÉS de la Task 9, o crear stubs temporales. Recomendado: completar Task 9 y luego correr la build).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/treasuryApi.js frontend/src/pages/treasury/DebtsPage.jsx frontend/src/App.jsx frontend/src/pages/treasury/TreasuryPage.jsx
git commit -m "feat(treasury): debtsApi + DebtsPage + ruta y link"
```

---

## Task 9: Frontend — modales (alta, pago, reconciliación)

**Files:**
- Create: `frontend/src/components/treasury/NewDebtModal.jsx`
- Create: `frontend/src/components/treasury/DebtPaymentModal.jsx`
- Create: `frontend/src/components/treasury/DebtReconcileModal.jsx`
- Modify: `frontend/src/components/treasury/index.js` (exports)

- [ ] **Step 1: Crear `NewDebtModal.jsx`**

Crear `frontend/src/components/treasury/NewDebtModal.jsx`:

```jsx
import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/shared/Modal';
import { debtsApi } from '@/lib/treasuryApi';
import { formatCurrency, getLocalDateString } from '@/lib/constants';

const FREQUENCIES = [
  { id: 'MONTHLY', label: 'Mensual', addMonths: 1 },
  { id: 'BIWEEKLY', label: 'Quincenal', addDays: 15 },
  { id: 'WEEKLY', label: 'Semanal', addDays: 7 },
];

function addInterval(date, freq) {
  const d = new Date(date);
  if (freq.addMonths) d.setMonth(d.getMonth() + freq.addMonths);
  else if (freq.addDays) d.setDate(d.getDate() + freq.addDays);
  return d.toISOString().slice(0, 10);
}

function generateInstallments(total, count, frequencyId, firstDate) {
  const freq = FREQUENCIES.find((f) => f.id === frequencyId) || FREQUENCIES[0];
  const t = parseFloat(total) || 0;
  const n = Math.max(1, parseInt(count, 10) || 1);
  const base = Math.floor(t / n);
  const remainder = t - base * n;
  const out = [];
  let date = firstDate || getLocalDateString();
  for (let i = 0; i < n; i++) {
    const planned = i === n - 1 ? base + remainder : base;
    out.push({ sequence: i + 1, dueDate: date, plannedAmount: planned });
    date = addInterval(date, freq);
  }
  return out;
}

export default function NewDebtModal({ isOpen, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [assetDescription, setAssetDescription] = useState('');
  const [total, setTotal] = useState('');
  const [count, setCount] = useState(1);
  const [frequency, setFrequency] = useState('MONTHLY');
  const [firstDate, setFirstDate] = useState(getLocalDateString());
  const [installments, setInstallments] = useState([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(''); setLender(''); setAssetDescription(''); setTotal('');
    setCount(1); setFrequency('MONTHLY'); setFirstDate(getLocalDateString());
    setInstallments([]); setNotes(''); setError(null);
  }, [isOpen]);

  const totalSchedule = useMemo(
    () => installments.reduce((s, i) => s + (parseFloat(i.plannedAmount) || 0), 0),
    [installments],
  );
  const sumOk = installments.length > 0 && Math.abs(totalSchedule - (parseFloat(total) || 0)) < 0.01;

  const handleGenerate = () => setInstallments(generateInstallments(total, count, frequency, firstDate));
  const updateInstallment = (idx, key, value) =>
    setInstallments((prev) => prev.map((i, n) => (n === idx ? { ...i, [key]: value } : i)));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Ingresá un nombre para el crédito.');
    if (!sumOk) return setError('La suma de las cuotas debe coincidir con el total a pagar.');
    setLoading(true);
    try {
      await debtsApi.create({
        name,
        lender: lender || null,
        assetDescription: assetDescription || null,
        notes: notes || null,
        installments: installments.map((i) => ({
          sequence: i.sequence, dueDate: i.dueDate, plannedAmount: parseFloat(i.plannedAmount),
        })),
      });
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear el crédito');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo crédito" width="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Nombre *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input w-full" required data-testid="debt-form-name" />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Acreedor</label>
            <input type="text" value={lender} onChange={(e) => setLender(e.target.value)} className="input w-full" placeholder="Banco / financiera" />
          </div>
        </div>

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Activo financiado</label>
          <input type="text" value={assetDescription} onChange={(e) => setAssetDescription(e.target.value)} className="input w-full" placeholder="Opcional" />
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Total a pagar *</label>
            <input type="number" value={total} onChange={(e) => setTotal(e.target.value)} className="input w-full" min="1" required data-testid="debt-form-total" />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1"># Cuotas</label>
            <input type="number" value={count} onChange={(e) => setCount(e.target.value)} className="input w-full" min="1" data-testid="debt-form-installments-count" />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Frecuencia</label>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="input w-full" data-testid="debt-form-frequency">
              {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Primera fecha</label>
            <input type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} className="input w-full" data-testid="debt-form-first-date" />
          </div>
        </div>

        <button type="button" onClick={handleGenerate} className="btn-ghost text-sm" data-testid="debt-form-generate">Generar cronograma</button>

        {installments.length > 0 && (
          <div className="border border-border rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[#8B949E]">Suma cuotas:</span>
              <span className={sumOk ? 'text-green-400' : 'text-red-400'}>{formatCurrency(totalSchedule)}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-[#8B949E] text-xs"><tr><th className="text-left py-1">#</th><th className="text-left py-1">Fecha</th><th className="text-right py-1">Monto</th></tr></thead>
              <tbody>
                {installments.map((i, idx) => (
                  <tr key={i.sequence} className="border-t border-border">
                    <td className="py-1">{i.sequence}</td>
                    <td><input type="date" value={i.dueDate} onChange={(e) => updateInstallment(idx, 'dueDate', e.target.value)} className="input w-full text-sm" /></td>
                    <td><input type="number" value={i.plannedAmount} onChange={(e) => updateInstallment(idx, 'plannedAmount', e.target.value)} className="input w-full text-sm text-right" min="0" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Notas</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="input w-full" placeholder="Opcional" />
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={loading}>Cancelar</button>
          <button type="submit" className="btn-primary flex-1" disabled={loading || !sumOk} data-testid="debt-form-submit">{loading ? 'Creando...' : 'Crear crédito'}</button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Crear `DebtPaymentModal.jsx`**

Crear `frontend/src/components/treasury/DebtPaymentModal.jsx`:

```jsx
import { useEffect, useState } from 'react';
import Modal from '@/components/shared/Modal';
import { accountsApi, debtsApi } from '@/lib/treasuryApi';
import { formatCurrency, getLocalDateString } from '@/lib/constants';

export default function DebtPaymentModal({ isOpen, onClose, onPaid, debt }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getLocalDateString());
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const remaining = debt ? parseFloat(debt.totalAmount) - parseFloat(debt.paidAmount) : 0;
  const nextInst = debt?.installments?.find((i) => i.status !== 'PAID');
  const nextOwed = nextInst ? Math.max(0, parseFloat(nextInst.plannedAmount) - parseFloat(nextInst.paidAmount)) : 0;

  useEffect(() => {
    if (!isOpen) return;
    setError(null); setNotes(''); setDate(getLocalDateString());
    setAmount(nextOwed > 0 ? String(nextOwed) : String(remaining));
    accountsApi.getAll().then((res) => {
      const active = res.data.filter((a) => a.isActive);
      setAccounts(active);
      setAccountId((curr) => curr || active[0]?.id || '');
    });
  }, [isOpen, debt]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await debtsApi.addPayment(debt.id, { accountId, amount: parseFloat(amount || 0), date: date || null, notes: notes || null });
      onPaid?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar el pago');
    } finally {
      setLoading(false);
    }
  };

  if (!debt) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Pago de crédito: ${debt.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-surface-hover rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-[#8B949E]">Saldo pendiente:</span><span className="text-amber-400 font-semibold">{formatCurrency(remaining)}</span></div>
          {nextInst && (
            <div className="flex justify-between"><span className="text-[#8B949E]">Próxima cuota (#{nextInst.sequence}):</span><span>{formatCurrency(nextOwed)} • vence {new Date(nextInst.dueDate).toLocaleDateString('es-CO')}</span></div>
          )}
        </div>

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Cuenta origen *</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input w-full" required data-testid="debt-payment-account">
            <option value="">Seleccionar</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Monto</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input w-full" min="0" data-testid="debt-payment-amount" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-sm text-[#8B949E] mb-1">Fecha</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input w-full" /></div>
          <div><label className="block text-sm text-[#8B949E] mb-1">Notas</label><input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="input w-full" placeholder="Opcional" /></div>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={loading}>Cancelar</button>
          <button type="submit" className="btn-primary flex-1" disabled={loading} data-testid="debt-payment-submit">{loading ? 'Procesando...' : 'Registrar pago'}</button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 3: Crear `DebtReconcileModal.jsx`**

Crear `frontend/src/components/treasury/DebtReconcileModal.jsx`:

```jsx
import { useEffect, useState } from 'react';
import Modal from '@/components/shared/Modal';
import { debtsApi } from '@/lib/treasuryApi';
import { formatCurrency, formatDate } from '@/lib/constants';

export default function DebtReconcileModal({ isOpen, onClose, onDone, debt }) {
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelected({}); setSearch(''); setError(null);
    debtsApi.reconcileCandidates().then((res) => setCandidates(res.data));
  }, [isOpen]);

  const doSearch = async () => {
    const res = await debtsApi.reconcileCandidates({ search: search || undefined });
    setCandidates(res.data);
  };

  const toggle = (id) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const selectedTotal = candidates.filter((c) => selected[c.id]).reduce((s, c) => s + parseFloat(c.amount), 0);

  const handleSubmit = async () => {
    if (selectedIds.length === 0) return setError('Seleccioná al menos un egreso.');
    setError(null);
    setLoading(true);
    try {
      await debtsApi.reconcile(debt.id, { transactionIds: selectedIds });
      onDone?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al reconciliar');
    } finally {
      setLoading(false);
    }
  };

  if (!debt) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Reconciliar egresos → ${debt.name}`} width="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-[#8B949E]">Seleccioná los egresos históricos que correspondan a cuotas de este crédito. Se enlazan sin mover plata y se reclasifican como pago del crédito.</p>

        <div className="flex gap-2">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} className="input flex-1" placeholder="Buscar por descripción (ej. pago cuota)" data-testid="debt-reconcile-search" />
          <button type="button" onClick={doSearch} className="btn-ghost">Buscar</button>
        </div>

        <div className="border border-border rounded-lg max-h-80 overflow-y-auto divide-y divide-border">
          {candidates.length === 0 ? (
            <div className="p-4 text-sm text-[#6E7681] text-center">Sin egresos candidatos.</div>
          ) : candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-3 p-3 text-sm cursor-pointer hover:bg-surface-hover" data-testid={`debt-reconcile-row-${c.id}`}>
              <input type="checkbox" checked={!!selected[c.id]} onChange={() => toggle(c.id)} />
              <span className="flex-1">{c.description || 'Egreso'} <span className="text-[#6E7681]">· {c.account?.name} · {formatDate(c.date)}</span></span>
              <span className="font-mono">{formatCurrency(c.amount)}</span>
            </label>
          ))}
        </div>

        <div className="flex justify-between text-sm"><span className="text-[#8B949E]">Seleccionado:</span><span className="font-mono text-[#E6EDF3]">{formatCurrency(selectedTotal)}</span></div>

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={loading}>Cancelar</button>
          <button type="button" onClick={handleSubmit} className="btn-primary flex-1" disabled={loading || selectedIds.length === 0} data-testid="debt-reconcile-submit">{loading ? 'Enlazando...' : 'Enlazar seleccionados'}</button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Exportar los modales**

En `frontend/src/components/treasury/index.js`, después de la sección `// Loans`, agregar:

```js
// Debts
export { default as NewDebtModal } from './NewDebtModal';
export { default as DebtPaymentModal } from './DebtPaymentModal';
export { default as DebtReconcileModal } from './DebtReconcileModal';
```

- [ ] **Step 5: Verificar build (incluye Task 8)**

Run: `cd frontend && npm run build`
Expected: build exitoso (ya existen DebtsPage + los 3 modales + las rutas).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/treasury/NewDebtModal.jsx frontend/src/components/treasury/DebtPaymentModal.jsx frontend/src/components/treasury/DebtReconcileModal.jsx frontend/src/components/treasury/index.js
git commit -m "feat(treasury): modales de alta, pago y reconciliación de créditos"
```

---

## Task 10: E2E — crear, pagar y reconciliar

**Files:**
- Modify: `tests/helpers/api.ts` (helpers de debts)
- Create: `tests/e2e/treasury/debt-tracking.spec.ts`
- Reference: `tests/e2e/treasury/loans.spec.ts`, `tests/global-setup.ts` (`TEST_SEED_IDS`), `tests/helpers/db.ts`

- [ ] **Step 1: Aplicar la migración a la DB de test**

`fullResetAndSeed` solo trunca; no migra. Aplicar la migración nueva a `autocontrol_test`:

```
cd backend && DATABASE_URL='postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test' npx prisma migrate deploy
```
Expected: aplica `add_debt_tracking`. Si falla la conexión, reportar BLOCKED.

- [ ] **Step 2: Agregar helpers de API en `tests/helpers/api.ts`**

En `tests/helpers/api.ts`, después de los helpers de loans, agregar:

```ts
export interface DebtInstallmentInput {
  sequence: number;
  dueDate: string;
  plannedAmount: number;
}

export interface DebtCreateInput {
  name: string;
  lender?: string | null;
  assetDescription?: string | null;
  notes?: string | null;
  installments: DebtInstallmentInput[];
}

export interface Debt {
  id: string;
  name: string;
  totalAmount: string | number;
  paidAmount: string | number;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  installments: Array<{ id: string; sequence: number; plannedAmount: string | number; paidAmount: string | number; status: string; dueDate: string }>;
  isOverdue: boolean;
}

export async function apiCreateDebt(token: string, data: DebtCreateInput): Promise<Debt> {
  return postJson('/debts', data, token);
}

export async function apiGetDebt(token: string, id: string): Promise<Debt> {
  return getJson(`/debts/${id}`, token);
}

export async function apiAddDebtPayment(
  token: string,
  debtId: string,
  data: { accountId: string; amount: number; date?: string | null; notes?: string | null },
): Promise<Debt> {
  return postJson(`/debts/${debtId}/payments`, data, token);
}

export async function apiReconcileDebt(token: string, debtId: string, transactionIds: string[]): Promise<Debt> {
  return postJson(`/debts/${debtId}/reconcile`, { transactionIds }, token);
}

export async function apiListTransactions(token: string, params = ''): Promise<Array<Record<string, unknown>>> {
  const res = await getJson<{ transactions?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(`/treasury/transactions${params}`, token);
  return Array.isArray(res) ? res : (res.transactions ?? []);
}
```

> Antes de escribir, abrir `tests/helpers/api.ts` y confirmar los nombres reales de los helpers HTTP (`postJson`/`getJson`) y reusarlos; si difieren, ajustar las llamadas. `apiListTransactions` puede ya existir — si es así, no duplicarlo.

- [ ] **Step 3: Crear el spec E2E**

Crear `tests/e2e/treasury/debt-tracking.spec.ts`:

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetAccount, apiCreateDebt, apiAddDebtPayment,
  apiReconcileDebt, apiCreateExpense, apiCreateVehicle, apiListTransactions,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

// La lista de transacciones se filtra en JS (robusto ante los filtros del endpoint).
test.describe('Tesorería — créditos/deudas del negocio', () => {
  test('crear crédito, total = suma de cuotas, sin movimiento de caja al crear', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const cashBefore = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));

    const debt = await apiCreateDebt(token, {
      name: 'Crédito Hilux',
      lender: 'Banco X',
      installments: [
        { sequence: 1, dueDate: today, plannedAmount: 2_000_000 },
        { sequence: 2, dueDate: today, plannedAmount: 2_000_000 },
      ],
    });
    expect(parseFloat(String(debt.totalAmount))).toBe(4_000_000);
    expect(debt.status).toBe('PENDING');

    // Crear el crédito NO mueve caja
    const cashAfter = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance));
    expect(cashAfter).toBe(cashBefore);
  });

  test('pagar una cuota genera egreso DEBT_PAYMENT sin vehículo y baja el saldo', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    const debt = await apiCreateDebt(token, {
      name: 'Crédito local',
      installments: [
        { sequence: 1, dueDate: today, plannedAmount: 1_000_000 },
        { sequence: 2, dueDate: today, plannedAmount: 1_000_000 },
      ],
    });

    const bankBefore = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance));
    const updated = await apiAddDebtPayment(token, debt.id, { accountId: TEST_SEED_IDS.accountBank, amount: 1_000_000 });
    const bankAfter = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance));

    expect(bankBefore - bankAfter).toBe(1_000_000);
    expect(parseFloat(String(updated.paidAmount))).toBe(1_000_000);
    expect(updated.status).toBe('PARTIAL');

    const txs = await apiListTransactions(token);
    const mine = txs.filter((t) => t.debtId === debt.id && t.category === 'DEBT_PAYMENT');
    expect(mine.length).toBe(1);
    expect(mine[0].vehicleId ?? null).toBeNull();
    expect(mine[0].type).toBe('EXPENSE');
  });

  test('reconciliar un egreso histórico baja el saldo sin nuevo movimiento de caja', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);

    // Vehículo de apoyo + egreso "histórico" mal categorizado contra él
    const plate = `DBT${Date.now().toString().slice(-5)}`;
    const vehicle = await apiCreateVehicle(token, { plate, brand: 'Toyota', model: 'Hilux', stage: 'COMPRADO' });
    await apiCreateExpense(token, {
      vehicleId: vehicle.id,
      accountId: TEST_SEED_IDS.accountBank,
      category: 'OTRO',
      amount: 1_500_000,
      description: 'pago cuota credito historico',
    });

    const debt = await apiCreateDebt(token, {
      name: 'Crédito a reconciliar',
      installments: [{ sequence: 1, dueDate: today, plannedAmount: 1_500_000 }],
    });

    const bankBefore = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance));

    // Encontrar la transacción del egreso histórico (filtro en JS)
    const candidates = await apiListTransactions(token);
    const histTx = candidates.find(
      (t) => typeof t.description === 'string' && t.description.includes('pago cuota credito historico'),
    );
    expect(histTx).toBeTruthy();

    const updated = await apiReconcileDebt(token, debt.id, [histTx!.id as string]);
    const bankAfter = parseFloat(String((await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance));

    // Reconciliar NO mueve caja de nuevo
    expect(bankAfter).toBe(bankBefore);
    expect(parseFloat(String(updated.paidAmount))).toBe(1_500_000);
    expect(updated.status).toBe('PAID');
  });
});
```

> Notas para el implementador:
> - `apiCreateVehicle(token, { plate, brand, model, stage })` ya existe y devuelve `{ id, plate }`; `apiCreateExpense` existe y acepta `category: 'OTRO'`. Reusarlos tal cual.
> - El gasto de vehículo genera una `Transaction` con `category: 'VEHICLE_EXPENSE'`, `type: 'EXPENSE'`, `vehicleId` y `expenseId` seteados → la reconciliación la reclasifica a `DEBT_PAYMENT`, limpia `vehicleId`/`expenseId` y soft-deletea el `Expense`.
> - `apiListTransactions(token)` se llama sin filtro y se filtra en JS. Confirmar que el endpoint `/treasury/transactions` devuelve los campos `debtId`, `category`, `type`, `vehicleId`, `description`, `id`; si la lista viene paginada/envuelta, `apiListTransactions` ya desenvuelve `{ transactions }`.

- [ ] **Step 4: Correr el spec nuevo**

Run: `npx playwright test tests/e2e/treasury/debt-tracking.spec.ts`
Expected: 3 passed.

- [ ] **Step 5: Correr la suite de tesorería (regresión)**

Run: `npx playwright test tests/e2e/treasury/`
Expected: todo verde (préstamos y demás sin cambios).

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/api.ts tests/e2e/treasury/debt-tracking.spec.ts
git commit -m "test(treasury): e2e de créditos — crear, pagar y reconciliar"
```

---

## Verificación final

- [ ] **Unit:** `cd backend && node --test src/` → todo verde.
- [ ] **Build frontend:** `cd frontend && npm run build` → exitoso.
- [ ] **E2E:** `npx playwright test tests/e2e/treasury/` → todo verde.
- [ ] Invocar `verification-loop` (build + lint + tests + security) antes de marcar completo, según CLAUDE.md.
