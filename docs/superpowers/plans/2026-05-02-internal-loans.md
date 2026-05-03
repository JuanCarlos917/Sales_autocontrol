# Internal Loans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an internal loans feature: lend cash from a system account to a registered third party, define an editable installment schedule, and record repayments (with optional voluntary extras) — all atomic and audit-traceable from the existing transactions ledger.

**Architecture:** New domain models `Loan` + `LoanInstallment` + `LoanPayment` (kept separate from `Payable`). Backend service writes everything inside a single `prisma.$transaction`. Loan and installment statuses are written on each mutation; `OVERDUE` is computed at read-time. Frontend adds a treasury sub-page with two modals (new loan + register payment). E2E tests exercise the happy path, the extra-income flow, and the over-payment validation.

**Tech Stack:** Node 20 / Express / Prisma 5+ / PostgreSQL 16 / React 18 + Vite / TailwindCSS / Playwright. CommonJS in backend, ESM in frontend, Joi for validation.

**Spec reference:** `docs/superpowers/specs/2026-05-02-internal-loans-design.md`

---

## Sprint L.1 — Backend foundation

### Task 1: Prisma schema + migration for loan domain

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_internal_loans/migration.sql`

- [ ] **Step 1: Add `EMPLOYEE` to `ThirdPartyType` enum**

In `backend/prisma/schema.prisma`, locate `enum ThirdPartyType` and replace with:

```prisma
enum ThirdPartyType {
  CLIENT
  SUPPLIER
  PARTNER
  EMPLOYEE
  BOTH
}
```

- [ ] **Step 2: Add three loan-specific values to `TransactionCategory` enum**

Locate `enum TransactionCategory` and add at the end (preserve existing values):

```prisma
  LOAN_DISBURSEMENT
  LOAN_REPAYMENT
  LOAN_EXTRA_INCOME
```

- [ ] **Step 3: Add `LoanStatus` and `InstallmentStatus` enums**

Add after the existing enums section:

```prisma
enum LoanStatus {
  PENDING
  PARTIAL
  PAID
  CANCELLED
}

enum InstallmentStatus {
  PENDING
  PARTIAL
  PAID
}
```

- [ ] **Step 4: Add `Loan`, `LoanInstallment`, `LoanPayment` models**

Add at the end of `schema.prisma` (before any `// ===` separator block, or just at the bottom):

```prisma
model Loan {
  id               String      @id @default(cuid())
  borrowerId       String
  originAccountId  String
  principalAmount  Decimal     @db.Decimal(15, 2)
  paidAmount       Decimal     @default(0) @db.Decimal(15, 2)
  extraReceived    Decimal     @default(0) @db.Decimal(15, 2)
  status           LoanStatus  @default(PENDING)
  description      String?
  disbursementDate DateTime    @default(now())
  notes            String?
  createdBy        String
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  borrower         ThirdParty  @relation("LoanBorrower", fields: [borrowerId], references: [id])
  originAccount    Account     @relation("LoanOriginAccount", fields: [originAccountId], references: [id])
  installments     LoanInstallment[]
  payments         LoanPayment[]
  transactions     Transaction[]

  @@map("loans")
}

model LoanInstallment {
  id            String             @id @default(cuid())
  loanId        String
  sequence      Int
  dueDate       DateTime
  plannedAmount Decimal            @db.Decimal(15, 2)
  paidAmount    Decimal            @default(0) @db.Decimal(15, 2)
  status        InstallmentStatus  @default(PENDING)

  loan          Loan               @relation(fields: [loanId], references: [id], onDelete: Cascade)

  @@unique([loanId, sequence])
  @@map("loan_installments")
}

model LoanPayment {
  id              String       @id @default(cuid())
  loanId          String
  accountId       String
  principalAmount Decimal      @db.Decimal(15, 2)
  extraAmount     Decimal      @default(0) @db.Decimal(15, 2)
  date            DateTime     @default(now())
  notes           String?
  createdBy       String
  createdAt       DateTime     @default(now())

  loan            Loan         @relation(fields: [loanId], references: [id], onDelete: Cascade)
  account         Account      @relation("LoanPaymentAccount", fields: [accountId], references: [id])
  transactions    Transaction[]

  @@map("loan_payments")
}
```

- [ ] **Step 5: Add inverse relations to existing models**

In `model Account`, add to the relation block:

```prisma
  loans           Loan[]        @relation("LoanOriginAccount")
  loanPayments    LoanPayment[] @relation("LoanPaymentAccount")
```

In `model ThirdParty`, add to the relation block:

```prisma
  loansAsBorrower Loan[]        @relation("LoanBorrower")
```

In `model Transaction`, add fields and relations:

```prisma
  loanId          String?
  loan            Loan?        @relation(fields: [loanId], references: [id])
  loanPaymentId   String?
  loanPayment     LoanPayment? @relation(fields: [loanPaymentId], references: [id])
```

- [ ] **Step 6: Generate the migration SQL manually (Prisma migrate dev is interactive in our env)**

Capture a timestamp into a shell variable, then use it for the migration directory. The format is `YYYYMMDDHHMMSS`, e.g. `20260502153005`:

```bash
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "backend/prisma/migrations/${TS}_add_internal_loans"
echo "Created backend/prisma/migrations/${TS}_add_internal_loans"
```

Write `backend/prisma/migrations/<timestamp>_add_internal_loans/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "ThirdPartyType" ADD VALUE 'EMPLOYEE';

-- AlterEnum
ALTER TYPE "TransactionCategory" ADD VALUE 'LOAN_DISBURSEMENT';
ALTER TYPE "TransactionCategory" ADD VALUE 'LOAN_REPAYMENT';
ALTER TYPE "TransactionCategory" ADD VALUE 'LOAN_EXTRA_INCOME';

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID');

-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "originAccountId" TEXT NOT NULL,
    "principalAmount" DECIMAL(15,2) NOT NULL,
    "paidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "extraReceived" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "LoanStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "disbursementDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_installments" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "plannedAmount" DECIMAL(15,2) NOT NULL,
    "paidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "loan_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_payments" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "principalAmount" DECIMAL(15,2) NOT NULL,
    "extraAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loan_payments_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "loanId" TEXT;
ALTER TABLE "transactions" ADD COLUMN "loanPaymentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "loan_installments_loanId_sequence_key" ON "loan_installments"("loanId", "sequence");

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "third_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loans" ADD CONSTRAINT "loans_originAccountId_fkey" FOREIGN KEY ("originAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loanPaymentId_fkey" FOREIGN KEY ("loanPaymentId") REFERENCES "loan_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 7: Apply migration to dev DB**

```bash
cd backend && npx prisma migrate deploy
```

Expected output: `Applying migration ... add_internal_loans`.

- [ ] **Step 8: Apply migration to test DB**

```bash
cd backend && DATABASE_URL="postgresql://autocontrol:autocontrol_dev@localhost:5432/autocontrol_test" npx prisma migrate deploy
```

Expected: same migration applied.

- [ ] **Step 9: Regenerate Prisma client**

```bash
cd backend && npx prisma generate
```

- [ ] **Step 10: Verify schema in dev DB**

```bash
PGPASSWORD=autocontrol_dev psql -U autocontrol -h localhost -d autocontrol_db -c "\d loans" | head -20
PGPASSWORD=autocontrol_dev psql -U autocontrol -h localhost -d autocontrol_db -c "\d loan_installments" | head -10
PGPASSWORD=autocontrol_dev psql -U autocontrol -h localhost -d autocontrol_db -c "\d loan_payments" | head -10
PGPASSWORD=autocontrol_dev psql -U autocontrol -h localhost -d autocontrol_db -c "\dT+ \"LoanStatus\""
```

Expected: tables and enum exist.

- [ ] **Step 11: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(loans): add Prisma schema and migration for internal loans

- New tables: loans, loan_installments, loan_payments.
- New enums: LoanStatus, InstallmentStatus.
- Add EMPLOYEE to ThirdPartyType.
- Add LOAN_DISBURSEMENT / LOAN_REPAYMENT / LOAN_EXTRA_INCOME to TransactionCategory.
- New FK columns transactions.loanId / loanPaymentId for audit trail."
```

---

### Task 2: Joi validation schemas for loans

**Files:**
- Modify: `backend/src/middleware/validation.js`

- [ ] **Step 1: Add loan schemas before the `module.exports` block**

Locate the `// ── ... Schema ──` blocks. Add after the last one and before `module.exports`:

```js
// ── Loan Schemas ──
const loanInstallmentSchema = Joi.object({
  sequence: Joi.number().integer().positive().required(),
  dueDate: Joi.date().required(),
  plannedAmount: Joi.number().positive().required(),
});

const loanCreateSchema = Joi.object({
  borrowerId: Joi.string().required().messages({ 'any.required': 'Deudor es requerido' }),
  originAccountId: Joi.string().required().messages({ 'any.required': 'Cuenta origen es requerida' }),
  principalAmount: Joi.number().positive().required().messages({ 'any.required': 'Monto del préstamo es requerido' }),
  description: Joi.string().max(500).allow('', null),
  notes: Joi.string().max(2000).allow('', null),
  disbursementDate: Joi.date().allow(null),
  installments: Joi.array().items(loanInstallmentSchema).min(1).required(),
});

const loanPaymentSchema = Joi.object({
  accountId: Joi.string().required().messages({ 'any.required': 'Cuenta destino es requerida' }),
  principalAmount: Joi.number().min(0).required(),
  extraAmount: Joi.number().min(0).default(0),
  date: Joi.date().allow(null),
  notes: Joi.string().max(500).allow('', null),
}).custom((value, helpers) => {
  if ((value.principalAmount || 0) + (value.extraAmount || 0) <= 0) {
    return helpers.error('any.invalid', { message: 'El pago debe tener monto > 0 (principal o extra)' });
  }
  return value;
}, 'principal+extra > 0');
```

- [ ] **Step 2: Register schemas in the exported `schemas` object**

Inside `module.exports = { validate, schemas: { ... } }`, add:

```js
    loanCreate: loanCreateSchema,
    loanPayment: loanPaymentSchema,
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/middleware/validation.js
git commit -m "feat(loans): add Joi validation schemas for loanCreate and loanPayment"
```

---

### Task 3: `loanService` — create (disbursement)

**Files:**
- Create: `backend/src/services/loanService.js`

- [ ] **Step 1: Create the file with the create method**

```js
// ═══════════════════════════════════════════════════════════════
// Service — Loans (préstamos internos)
// ═══════════════════════════════════════════════════════════════

const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const accountService = require('./accountService');

const LOAN_INCLUDE = {
  borrower: { select: { id: true, name: true, type: true } },
  originAccount: { select: { id: true, name: true, type: true } },
  installments: { orderBy: { sequence: 'asc' } },
  payments: {
    orderBy: { date: 'desc' },
    include: { account: { select: { id: true, name: true } } },
  },
};

function recomputeLoanStatus(principal, paid) {
  const p = parseFloat(principal);
  const q = parseFloat(paid);
  if (q <= 0) return 'PENDING';
  if (q >= p) return 'PAID';
  return 'PARTIAL';
}

function recomputeInstallmentStatus(planned, paid) {
  const p = parseFloat(planned);
  const q = parseFloat(paid);
  if (q <= 0) return 'PENDING';
  if (q >= p) return 'PAID';
  return 'PARTIAL';
}

function annotateOverdue(loan) {
  if (loan.status === 'PAID' || loan.status === 'CANCELLED') {
    return { ...loan, isOverdue: false };
  }
  const now = new Date();
  const isOverdue = loan.installments.some(
    (i) => i.status !== 'PAID' && new Date(i.dueDate) < now,
  );
  return { ...loan, isOverdue };
}

class LoanService {
  async create({ borrowerId, originAccountId, principalAmount, description, notes, disbursementDate, installments }, userId) {
    const principal = parseFloat(principalAmount);

    // Validate installments sum equals principal (tolerance 1 cent)
    const installmentsSum = installments.reduce((s, i) => s + parseFloat(i.plannedAmount), 0);
    if (Math.abs(installmentsSum - principal) > 0.01) {
      throw new AppError(`La suma de cuotas (${installmentsSum}) no coincide con el principal (${principal})`, 400);
    }

    // Validate sequences are unique and contiguous starting at 1
    const sequences = installments.map((i) => i.sequence).sort((a, b) => a - b);
    for (let i = 0; i < sequences.length; i++) {
      if (sequences[i] !== i + 1) {
        throw new AppError('Las secuencias de cuotas deben ser 1..N sin huecos ni duplicados', 400);
      }
    }

    // Validate borrower exists and is active
    const borrower = await prisma.thirdParty.findUnique({ where: { id: borrowerId } });
    if (!borrower || !borrower.isActive) {
      throw new AppError('Deudor no encontrado o inactivo', 404);
    }

    // Validate account exists and is active
    const account = await prisma.account.findUnique({ where: { id: originAccountId } });
    if (!account || !account.isActive) {
      throw new AppError('Cuenta origen no encontrada o inactiva', 404);
    }

    // Validate sufficient balance (computed from transactions ledger)
    const balance = await accountService.calculateBalance(originAccountId);
    if (balance < principal) {
      throw new AppError(`Saldo insuficiente en la cuenta origen (saldo: ${balance}, requerido: ${principal})`, 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          borrowerId,
          originAccountId,
          principalAmount: principal,
          description: description || null,
          notes: notes || null,
          disbursementDate: disbursementDate ? new Date(disbursementDate) : new Date(),
          createdBy: userId,
          installments: {
            create: installments.map((i) => ({
              sequence: i.sequence,
              dueDate: new Date(i.dueDate),
              plannedAmount: parseFloat(i.plannedAmount),
            })),
          },
        },
        include: LOAN_INCLUDE,
      });

      await tx.transaction.create({
        data: {
          accountId: originAccountId,
          type: 'EXPENSE',
          category: 'LOAN_DISBURSEMENT',
          amount: principal,
          description: `Préstamo a ${borrower.name}`,
          date: loan.disbursementDate,
          thirdPartyId: borrowerId,
          loanId: loan.id,
          createdBy: userId,
        },
      });

      return loan;
    });

    return annotateOverdue(result);
  }
}

module.exports = new LoanService();
module.exports.recomputeLoanStatus = recomputeLoanStatus;
module.exports.recomputeInstallmentStatus = recomputeInstallmentStatus;
module.exports.annotateOverdue = annotateOverdue;
module.exports.LOAN_INCLUDE = LOAN_INCLUDE;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/loanService.js
git commit -m "feat(loans): loanService.create with disbursement transaction"
```

---

### Task 4: `loanService` — list, findById

**Files:**
- Modify: `backend/src/services/loanService.js`

- [ ] **Step 1: Add `list` and `findById` methods inside the class (after `create`)**

```js
  async list({ status, borrowerId, overdueOnly } = {}) {
    const where = {};
    if (status) where.status = status;
    if (borrowerId) where.borrowerId = borrowerId;
    const loans = await prisma.loan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: LOAN_INCLUDE,
    });
    const annotated = loans.map(annotateOverdue);
    return overdueOnly ? annotated.filter((l) => l.isOverdue) : annotated;
  }

  async findById(id) {
    const loan = await prisma.loan.findUnique({
      where: { id },
      include: LOAN_INCLUDE,
    });
    if (!loan) throw new AppError('Préstamo no encontrado', 404);
    return annotateOverdue(loan);
  }
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/loanService.js
git commit -m "feat(loans): loanService.list with overdue filter and findById"
```

---

### Task 5: `loanService` — addPayment (with FIFO installment application + extra income)

**Files:**
- Modify: `backend/src/services/loanService.js`

- [ ] **Step 1: Add `addPayment` inside the class**

```js
  async addPayment(loanId, { accountId, principalAmount, extraAmount, date, notes }, userId) {
    const principal = parseFloat(principalAmount || 0);
    const extra = parseFloat(extraAmount || 0);

    if (principal + extra <= 0) {
      throw new AppError('El pago debe tener monto > 0 (principal o extra)', 400);
    }

    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: { installments: { orderBy: { sequence: 'asc' } }, borrower: true },
    });
    if (!loan) throw new AppError('Préstamo no encontrado', 404);
    if (loan.status === 'CANCELLED') throw new AppError('Préstamo cancelado', 400);
    if (loan.status === 'PAID') throw new AppError('Préstamo ya está totalmente pagado', 400);

    const remaining = parseFloat(loan.principalAmount) - parseFloat(loan.paidAmount);
    if (principal > remaining + 0.001) {
      throw new AppError(`El monto principal (${principal}) excede el saldo pendiente (${remaining}). Usá el campo extra para el sobrante.`, 400);
    }

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || !account.isActive) throw new AppError('Cuenta destino no encontrada o inactiva', 404);

    const paymentDate = date ? new Date(date) : new Date();

    // Distribute principal across installments FIFO
    let remainingPrincipal = principal;
    const installmentUpdates = [];
    for (const inst of loan.installments) {
      if (remainingPrincipal <= 0) break;
      const owed = parseFloat(inst.plannedAmount) - parseFloat(inst.paidAmount);
      if (owed <= 0) continue;
      const apply = Math.min(owed, remainingPrincipal);
      const newPaid = parseFloat(inst.paidAmount) + apply;
      installmentUpdates.push({
        id: inst.id,
        newPaid,
        newStatus: recomputeInstallmentStatus(inst.plannedAmount, newPaid),
      });
      remainingPrincipal -= apply;
    }

    const newLoanPaid = parseFloat(loan.paidAmount) + principal;
    const newLoanExtra = parseFloat(loan.extraReceived) + extra;
    const newLoanStatus = recomputeLoanStatus(loan.principalAmount, newLoanPaid);

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.loanPayment.create({
        data: {
          loanId,
          accountId,
          principalAmount: principal,
          extraAmount: extra,
          date: paymentDate,
          notes: notes || null,
          createdBy: userId,
        },
      });

      if (principal > 0) {
        await tx.transaction.create({
          data: {
            accountId,
            type: 'INCOME',
            category: 'LOAN_REPAYMENT',
            amount: principal,
            description: `Pago préstamo: ${loan.borrower.name}`,
            date: paymentDate,
            thirdPartyId: loan.borrowerId,
            loanId,
            loanPaymentId: payment.id,
            createdBy: userId,
          },
        });
      }

      if (extra > 0) {
        await tx.transaction.create({
          data: {
            accountId,
            type: 'INCOME',
            category: 'LOAN_EXTRA_INCOME',
            amount: extra,
            description: `Ingreso extra del préstamo: ${loan.borrower.name}`,
            date: paymentDate,
            thirdPartyId: loan.borrowerId,
            loanId,
            loanPaymentId: payment.id,
            createdBy: userId,
          },
        });
      }

      for (const u of installmentUpdates) {
        await tx.loanInstallment.update({
          where: { id: u.id },
          data: { paidAmount: u.newPaid, status: u.newStatus },
        });
      }

      const updatedLoan = await tx.loan.update({
        where: { id: loanId },
        data: {
          paidAmount: newLoanPaid,
          extraReceived: newLoanExtra,
          status: newLoanStatus,
        },
        include: LOAN_INCLUDE,
      });

      return updatedLoan;
    });

    return annotateOverdue(result);
  }
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/loanService.js
git commit -m "feat(loans): loanService.addPayment with FIFO installment apply and extra income"
```

---

### Task 6: `loanService` — cancel

**Files:**
- Modify: `backend/src/services/loanService.js`

- [ ] **Step 1: Add `cancel` inside the class**

```js
  async cancel(loanId) {
    const loan = await prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan) throw new AppError('Préstamo no encontrado', 404);
    if (loan.status !== 'PENDING') {
      throw new AppError('Solo se pueden cancelar préstamos sin pagos (status PENDING)', 400);
    }
    const updated = await prisma.loan.update({
      where: { id: loanId },
      data: { status: 'CANCELLED' },
      include: LOAN_INCLUDE,
    });
    return annotateOverdue(updated);
  }
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/loanService.js
git commit -m "feat(loans): loanService.cancel (only when PENDING)"
```

---

### Task 7: Loan controller + routes

**Files:**
- Create: `backend/src/controllers/loanController.js`
- Create: `backend/src/routes/loans.js`
- Modify: `backend/src/routes/index.js`

- [ ] **Step 1: Create the controller**

`backend/src/controllers/loanController.js`:

```js
const loanService = require('../services/loanService');

const create = async (req, res, next) => {
  try {
    const result = await loanService.create(req.body, req.user.id);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

const list = async (req, res, next) => {
  try {
    const { status, borrowerId, overdueOnly } = req.query;
    const data = await loanService.list({
      status: status || undefined,
      borrowerId: borrowerId || undefined,
      overdueOnly: overdueOnly === 'true',
    });
    res.json(data);
  } catch (err) { next(err); }
};

const findById = async (req, res, next) => {
  try {
    const data = await loanService.findById(req.params.id);
    res.json(data);
  } catch (err) { next(err); }
};

const addPayment = async (req, res, next) => {
  try {
    const result = await loanService.addPayment(req.params.id, req.body, req.user.id);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

const cancel = async (req, res, next) => {
  try {
    const result = await loanService.cancel(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
};

module.exports = { create, list, findById, addPayment, cancel };
```

- [ ] **Step 2: Create the routes file**

`backend/src/routes/loans.js`:

```js
const express = require('express');
const ctrl = require('../controllers/loanController');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.get('/:id', ctrl.findById);
router.post('/', validate(schemas.loanCreate), ctrl.create);
router.post('/:id/payments', validate(schemas.loanPayment), ctrl.addPayment);
router.post('/:id/cancel', ctrl.cancel);

module.exports = router;
```

- [ ] **Step 3: Register the route in `backend/src/routes/index.js`**

After the existing `router.use('/alerts', require('./alerts'));` line, add:

```js
router.use('/loans', require('./loans'));
```

- [ ] **Step 4: Restart backend dev (if running)**

```bash
lsof -ti :4000 | xargs kill 2>/dev/null
sleep 1
cd backend && npm run dev &
```

- [ ] **Step 5: Smoke test all endpoints with curl**

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/pin-login -H "Content-Type: application/json" -d '{"pin":"1234"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).accessToken))")
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/loans
```

Expected: `[]` (empty list, no loans yet, no error).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/loanController.js backend/src/routes/loans.js backend/src/routes/index.js
git commit -m "feat(loans): controller and REST routes (POST/GET/cancel)"
```

---

## Sprint L.2 — Frontend (UI)

### Task 8: Add `EMPLOYEE` option to `ThirdPartySelector`

**Files:**
- Modify: `frontend/src/components/shared/ThirdPartySelector.jsx`

- [ ] **Step 1: Update `TYPE_LABELS` and `TYPE_COLORS` constants near the top**

Replace those two `const` blocks with:

```js
const TYPE_LABELS = {
  SUPPLIER: 'Proveedor',
  CLIENT: 'Cliente',
  PARTNER: 'Socio',
  EMPLOYEE: 'Empleado',
  BOTH: 'Cliente/Proveedor',
};

const TYPE_COLORS = {
  SUPPLIER: 'text-blue-400',
  CLIENT: 'text-green-400',
  PARTNER: 'text-purple-400',
  EMPLOYEE: 'text-amber-400',
  BOTH: 'text-amber-400',
};
```

- [ ] **Step 2: Add the `EMPLOYEE` option to the create-form `<select>`**

Locate the `<select value={createForm.type} ...>` block in the component (the one with the four existing `<option>` tags). Add the new option:

```jsx
<option value="EMPLOYEE">Empleado</option>
```

Place it between `PARTNER` and `BOTH`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/shared/ThirdPartySelector.jsx
git commit -m "feat(treasury): add EMPLOYEE option to ThirdPartySelector"
```

---

### Task 9: Add `loansApi` helpers to treasury API client

**Files:**
- Modify: `frontend/src/lib/treasuryApi.js`

- [ ] **Step 1: Add the export at the end of the file**

```js
export const loansApi = {
  getAll: (params) => api.get('/loans', { params }),
  getOne: (id) => api.get(`/loans/${id}`),
  create: (data) => api.post('/loans', data),
  addPayment: (id, data) => api.post(`/loans/${id}/payments`, data),
  cancel: (id) => api.post(`/loans/${id}/cancel`),
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/treasuryApi.js
git commit -m "feat(treasury): loansApi client helpers"
```

---

### Task 10: `NewLoanModal` component

**Files:**
- Create: `frontend/src/components/treasury/NewLoanModal.jsx`
- Modify: `frontend/src/components/treasury/index.js`

- [ ] **Step 1: Create the modal**

```jsx
import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/shared/Modal';
import ThirdPartySelector from '@/components/shared/ThirdPartySelector';
import { accountsApi, loansApi } from '@/lib/treasuryApi';
import { formatCurrency, getLocalDateString } from '@/lib/constants';

const FREQUENCIES = [
  { id: 'MONTHLY', label: 'Mensual', addDays: null, addMonths: 1 },
  { id: 'BIWEEKLY', label: 'Quincenal', addDays: 15 },
  { id: 'WEEKLY', label: 'Semanal', addDays: 7 },
];

function addInterval(date, freq) {
  const d = new Date(date);
  if (freq.addMonths) {
    d.setMonth(d.getMonth() + freq.addMonths);
  } else if (freq.addDays) {
    d.setDate(d.getDate() + freq.addDays);
  }
  return d.toISOString().slice(0, 10);
}

function generateInstallments(principal, count, frequencyId, firstDate) {
  const freq = FREQUENCIES.find((f) => f.id === frequencyId) || FREQUENCIES[0];
  const total = parseFloat(principal) || 0;
  const n = Math.max(1, parseInt(count, 10) || 1);
  const base = Math.floor((total / n) * 100) / 100;
  const remainder = +(total - base * n).toFixed(2);
  const out = [];
  let date = firstDate || getLocalDateString();
  for (let i = 0; i < n; i++) {
    const planned = i === n - 1 ? +(base + remainder).toFixed(2) : base;
    out.push({ sequence: i + 1, dueDate: date, plannedAmount: planned });
    date = addInterval(date, freq);
  }
  return out;
}

export default function NewLoanModal({ isOpen, onClose, onCreated }) {
  const [accounts, setAccounts] = useState([]);
  const [borrowerId, setBorrowerId] = useState('');
  const [originAccountId, setOriginAccountId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [count, setCount] = useState(1);
  const [frequency, setFrequency] = useState('MONTHLY');
  const [firstDate, setFirstDate] = useState(getLocalDateString());
  const [installments, setInstallments] = useState([]);
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setBorrowerId('');
    setPrincipal('');
    setCount(1);
    setFrequency('MONTHLY');
    setFirstDate(getLocalDateString());
    setInstallments([]);
    setDescription('');
    setNotes('');
    setError(null);
    accountsApi.getAll().then((res) => {
      const active = res.data.filter((a) => a.isActive);
      setAccounts(active);
      setOriginAccountId((current) => current || active[0]?.id || '');
    });
  }, [isOpen]);

  const totalSchedule = useMemo(
    () => installments.reduce((s, i) => s + (parseFloat(i.plannedAmount) || 0), 0),
    [installments],
  );

  const sumOk = installments.length > 0 && Math.abs(totalSchedule - (parseFloat(principal) || 0)) < 0.01;

  const handleGenerate = () => {
    setInstallments(generateInstallments(principal, count, frequency, firstDate));
  };

  const updateInstallment = (idx, key, value) => {
    setInstallments((prev) =>
      prev.map((i, n) => (n === idx ? { ...i, [key]: key === 'plannedAmount' ? value : value } : i)),
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!borrowerId) return setError('Seleccioná un deudor.');
    if (!originAccountId) return setError('Seleccioná una cuenta origen.');
    if (!sumOk) return setError('La suma de las cuotas debe coincidir con el monto del préstamo.');
    setLoading(true);
    try {
      const payload = {
        borrowerId,
        originAccountId,
        principalAmount: parseFloat(principal),
        description: description || null,
        notes: notes || null,
        installments: installments.map((i) => ({
          sequence: i.sequence,
          dueDate: i.dueDate,
          plannedAmount: parseFloat(i.plannedAmount),
        })),
      };
      const res = await loansApi.create(payload);
      onCreated?.(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear el préstamo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo préstamo" width="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Deudor *</label>
            <ThirdPartySelector
              value={borrowerId}
              onChange={setBorrowerId}
              placeholder="Buscar o crear..."
              required
              data-testid="loan-form-borrower"
            />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Cuenta origen *</label>
            <select
              value={originAccountId}
              onChange={(e) => setOriginAccountId(e.target.value)}
              className="input w-full"
              required
              data-testid="loan-form-account"
            >
              <option value="">Seleccionar cuenta</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Monto principal *</label>
            <input
              type="number"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              className="input w-full"
              min="1"
              required
              data-testid="loan-form-principal"
            />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1"># Cuotas</label>
            <input
              type="number"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="input w-full"
              min="1"
              data-testid="loan-form-installments-count"
            />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Frecuencia</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="input w-full"
              data-testid="loan-form-frequency"
            >
              {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Primera fecha</label>
            <input
              type="date"
              value={firstDate}
              onChange={(e) => setFirstDate(e.target.value)}
              className="input w-full"
              data-testid="loan-form-first-date"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          className="btn-ghost text-sm"
          data-testid="loan-form-generate"
        >
          Generar cronograma
        </button>

        {installments.length > 0 && (
          <div className="border border-border rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[#8B949E]">Suma cuotas:</span>
              <span className={sumOk ? 'text-green-400' : 'text-red-400'}>{formatCurrency(totalSchedule)}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-[#8B949E] text-xs">
                <tr>
                  <th className="text-left py-1">#</th>
                  <th className="text-left py-1">Fecha</th>
                  <th className="text-right py-1">Monto</th>
                </tr>
              </thead>
              <tbody>
                {installments.map((i, idx) => (
                  <tr key={i.sequence} className="border-t border-border">
                    <td className="py-1">{i.sequence}</td>
                    <td>
                      <input
                        type="date"
                        value={i.dueDate}
                        onChange={(e) => updateInstallment(idx, 'dueDate', e.target.value)}
                        className="input w-full text-sm"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={i.plannedAmount}
                        onChange={(e) => updateInstallment(idx, 'plannedAmount', e.target.value)}
                        className="input w-full text-sm text-right"
                        min="0"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Descripción</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input w-full"
            placeholder="Opcional"
          />
        </div>

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Notas</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input w-full"
            placeholder="Opcional"
          />
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={loading}>Cancelar</button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={loading || !sumOk}
            data-testid="loan-form-submit"
          >
            {loading ? 'Creando...' : 'Crear préstamo'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Export from `frontend/src/components/treasury/index.js`**

Add at the end:

```js
export { default as NewLoanModal } from './NewLoanModal';
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/treasury/NewLoanModal.jsx frontend/src/components/treasury/index.js
git commit -m "feat(treasury): NewLoanModal with editable installment schedule"
```

---

### Task 11: `LoanPaymentModal` component

**Files:**
- Create: `frontend/src/components/treasury/LoanPaymentModal.jsx`
- Modify: `frontend/src/components/treasury/index.js`

- [ ] **Step 1: Create the modal**

```jsx
import { useEffect, useState } from 'react';
import Modal from '@/components/shared/Modal';
import { accountsApi, loansApi } from '@/lib/treasuryApi';
import { formatCurrency, getLocalDateString } from '@/lib/constants';

export default function LoanPaymentModal({ isOpen, onClose, onPaid, loan }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [extra, setExtra] = useState('');
  const [date, setDate] = useState(getLocalDateString());
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const remaining = loan ? parseFloat(loan.principalAmount) - parseFloat(loan.paidAmount) : 0;
  const nextInst = loan?.installments?.find((i) => i.status !== 'PAID');
  const nextOwed = nextInst ? Math.max(0, parseFloat(nextInst.plannedAmount) - parseFloat(nextInst.paidAmount)) : 0;

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setExtra('');
    setNotes('');
    setDate(getLocalDateString());
    setPrincipal(nextOwed > 0 ? String(nextOwed) : String(remaining));
    accountsApi.getAll().then((res) => {
      const active = res.data.filter((a) => a.isActive);
      setAccounts(active);
      setAccountId((curr) => curr || active[0]?.id || '');
    });
  }, [isOpen, loan]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await loansApi.addPayment(loan.id, {
        accountId,
        principalAmount: parseFloat(principal || 0),
        extraAmount: parseFloat(extra || 0),
        date: date || null,
        notes: notes || null,
      });
      onPaid?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar el pago');
    } finally {
      setLoading(false);
    }
  };

  if (!loan) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Pago de préstamo: ${loan.borrower?.name || ''}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-surface-hover rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-[#8B949E]">Saldo pendiente:</span>
            <span className="text-amber-400 font-semibold">{formatCurrency(remaining)}</span>
          </div>
          {nextInst && (
            <div className="flex justify-between">
              <span className="text-[#8B949E]">Próxima cuota (#{nextInst.sequence}):</span>
              <span>{formatCurrency(nextOwed)} • vence {new Date(nextInst.dueDate).toLocaleDateString('es-CO')}</span>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Cuenta destino *</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="input w-full"
            required
            data-testid="loan-payment-account"
          >
            <option value="">Seleccionar</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.currentBalance)})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Monto principal</label>
          <input
            type="number"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            className="input w-full"
            min="0"
            data-testid="loan-payment-principal"
          />
        </div>

        <div>
          <label className="block text-sm text-[#8B949E] mb-1">Monto extra (ingreso adicional voluntario, no descuenta saldo)</label>
          <input
            type="number"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            className="input w-full"
            min="0"
            placeholder="0"
            data-testid="loan-payment-extra"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Fecha</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input w-full" />
          </div>
          <div>
            <label className="block text-sm text-[#8B949E] mb-1">Notas</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="input w-full" placeholder="Opcional" />
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" disabled={loading}>Cancelar</button>
          <button type="submit" className="btn-primary flex-1" disabled={loading} data-testid="loan-payment-submit">
            {loading ? 'Procesando...' : 'Registrar pago'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Export from `frontend/src/components/treasury/index.js`**

```js
export { default as LoanPaymentModal } from './LoanPaymentModal';
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/treasury/LoanPaymentModal.jsx frontend/src/components/treasury/index.js
git commit -m "feat(treasury): LoanPaymentModal with optional extra income"
```

---

### Task 12: `LoansPage` listing view

**Files:**
- Create: `frontend/src/pages/treasury/LoansPage.jsx`

- [ ] **Step 1: Create the page**

```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loansApi } from '@/lib/treasuryApi';
import { formatCurrency, formatDate } from '@/lib/constants';
import { NewLoanModal, LoanPaymentModal } from '@/components/treasury';

const STATUS_LABEL = {
  PENDING: 'Pendiente',
  PARTIAL: 'Parcial',
  PAID: 'Pagado',
  CANCELLED: 'Cancelado',
};

const STATUS_COLOR = {
  PENDING: 'bg-amber-500/20 text-amber-400',
  PARTIAL: 'bg-sky-500/20 text-sky-400',
  PAID: 'bg-green-500/20 text-green-400',
  CANCELLED: 'bg-[#6E7681]/20 text-[#6E7681]',
};

const TABS = [
  { id: 'all', label: 'Todos' },
  { id: 'active', label: 'Activos' },
  { id: 'overdue', label: 'Vencidos' },
  { id: 'paid', label: 'Pagados' },
];

export default function LoansPage() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [showNew, setShowNew] = useState(false);
  const [paying, setPaying] = useState(null);

  const reload = async () => {
    setLoading(true);
    try {
      const { data } = await loansApi.getAll();
      setLoans(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const filtered = loans.filter((l) => {
    if (tab === 'all') return true;
    if (tab === 'active') return l.status === 'PENDING' || l.status === 'PARTIAL';
    if (tab === 'overdue') return l.isOverdue;
    if (tab === 'paid') return l.status === 'PAID';
    return true;
  });

  const totals = {
    lent: loans.reduce((s, l) => s + parseFloat(l.principalAmount), 0),
    paid: loans.reduce((s, l) => s + parseFloat(l.paidAmount), 0),
  };
  totals.pending = totals.lent - totals.paid;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/treasury" className="text-[#6E7681] hover:text-accent transition-colors">← Tesorería</Link>
          <h2 className="text-xl font-bold text-[#E6EDF3] mt-2">Préstamos internos</h2>
          <p className="text-sm text-[#6E7681] mt-1">Dinero prestado a terceros con cronograma de devolución</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <div className="text-[#6E7681]">Prestado</div>
            <div className="font-mono font-bold text-[#E6EDF3]">{formatCurrency(totals.lent)}</div>
          </div>
          <div className="text-right">
            <div className="text-[#6E7681]">Devuelto</div>
            <div className="font-mono font-bold text-green-400">{formatCurrency(totals.paid)}</div>
          </div>
          <div className="text-right">
            <div className="text-[#6E7681]">Pendiente</div>
            <div className="font-mono font-bold text-amber-400">{formatCurrency(totals.pending)}</div>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="btn-primary"
            data-testid="loans-create-button"
          >
            + Nuevo préstamo
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-border pb-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
              tab === t.id ? 'bg-accent/20 text-accent' : 'text-[#6E7681] hover:bg-surface-hover'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-[#6E7681]">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-4">💸</div>
          <h3 className="text-lg font-semibold text-[#E6EDF3] mb-2">Sin préstamos</h3>
          <p className="text-sm text-[#6E7681]">Creá uno con el botón de arriba.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((loan) => {
            const pending = parseFloat(loan.principalAmount) - parseFloat(loan.paidAmount);
            const next = loan.installments?.find((i) => i.status !== 'PAID');
            return (
              <div
                key={loan.id}
                className={`card p-4 ${loan.isOverdue ? 'border-red-500/40' : ''}`}
                data-testid={`loan-card-${loan.id}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-base font-semibold text-[#E6EDF3]">{loan.borrower?.name}</div>
                    <div className="text-xs text-[#6E7681]">{loan.description || 'Préstamo interno'}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLOR[loan.status]}`}>
                    {STATUS_LABEL[loan.status]}
                  </span>
                </div>
                <div className="flex justify-between items-end mb-3">
                  <div>
                    <div className="text-xs text-[#6E7681]">Pendiente</div>
                    <div className="text-xl font-mono font-bold text-amber-400">{formatCurrency(pending)}</div>
                  </div>
                  <div className="text-right text-xs text-[#6E7681]">
                    de {formatCurrency(loan.principalAmount)}
                  </div>
                </div>
                {next && (
                  <div className={`text-xs mb-3 ${loan.isOverdue ? 'text-red-400' : 'text-[#6E7681]'}`}>
                    📅 Próxima cuota #{next.sequence}: {formatDate(next.dueDate)} ({formatCurrency(next.plannedAmount)})
                  </div>
                )}
                {loan.extraReceived > 0 && (
                  <div className="text-xs text-green-400 mb-3">+ {formatCurrency(loan.extraReceived)} en ingresos extra</div>
                )}
                <div className="flex gap-2 pt-3 border-t border-border">
                  {loan.status !== 'PAID' && loan.status !== 'CANCELLED' && (
                    <button
                      onClick={() => setPaying(loan)}
                      className="flex-1 py-2 rounded-lg text-xs font-semibold bg-green-500/20 text-green-400 hover:bg-green-500/30"
                      data-testid={`loan-card-${loan.id}-pay-button`}
                    >
                      💸 Registrar pago
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewLoanModal isOpen={showNew} onClose={() => setShowNew(false)} onCreated={reload} />
      <LoanPaymentModal isOpen={!!paying} loan={paying} onClose={() => setPaying(null)} onPaid={reload} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/treasury/LoansPage.jsx
git commit -m "feat(treasury): LoansPage with totals, tabs, cards and modals"
```

---

### Task 13: Wire route + sidebar link

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/layout/AppLayout.jsx`

- [ ] **Step 1: Add the route in `App.jsx`**

Find the existing block with treasury routes (e.g. `<Route path="treasury/payables" .../>`). Add after it:

```jsx
import LoansPage from '@/pages/treasury/LoansPage';
```

(at the top with other imports)

```jsx
<Route path="treasury/loans" element={<LoansPage />} />
```

(inside the protected `<Route path="/" ...>` block, near the other treasury routes)

- [ ] **Step 2: Add sidebar link in `AppLayout.jsx`**

First read the file to learn the existing pattern:

```bash
grep -n "treasury\|Tesorería\|payables\|transactions" frontend/src/components/layout/AppLayout.jsx | head -10
```

Locate the existing treasury-related navigation entries (e.g. links to `/treasury`, `/treasury/payables`, `/treasury/transactions`). Add a new entry for `/treasury/loans` with label `Préstamos` and emoji `💸`, using the EXACT same JSX shape as the surrounding entries (don't invent a new component or class). Place it directly after the Payables entry.

If treasury sub-links are NOT in the sidebar (only the main Tesorería landing is), then this step is a no-op for the sidebar — the LoansPage is already reachable via the back-link from `/treasury/loans` and it's listed in `App.jsx`. Note this in the commit message.

- [ ] **Step 3: Restart frontend dev (if running) and click around to verify**

Visit `http://localhost:5173/treasury/loans` after logging in. Page should load with empty state. Click "+ Nuevo préstamo" — modal opens. Close it.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/layout/AppLayout.jsx
git commit -m "feat(treasury): route /treasury/loans and sidebar link"
```

---

## Sprint L.3 — E2E tests

### Task 14: Seed an `EMPLOYEE` third party for tests

**Files:**
- Modify: `tests/global-setup.ts`
- Modify: `tests/helpers/db.ts`

- [ ] **Step 1: Add `employee` to `TEST_SEED_IDS` in `tests/global-setup.ts`**

Replace the `TEST_SEED_IDS` const with:

```ts
export const TEST_SEED_IDS = {
  accountCash: 'test-acc-cash',
  accountBank: 'test-acc-bank',
  supplier: 'test-tp-supplier',
  buyer: 'test-tp-buyer',
  employee: 'test-tp-employee',
} as const;
```

- [ ] **Step 2: Update `seedAccountsAndParties` in `tests/helpers/db.ts`**

In the existing `INSERT INTO third_parties` query, add a third row:

```ts
  await client.query(
    `INSERT INTO third_parties (id, name, type, "isActive", "createdAt", "updatedAt")
     VALUES
       ($1, 'Proveedor Test', 'SUPPLIER', true, NOW(), NOW()),
       ($2, 'Cliente Test', 'CLIENT', true, NOW(), NOW()),
       ($3, 'Empleado Test', 'EMPLOYEE', true, NOW(), NOW())`,
    [TEST_SEED_IDS.supplier, TEST_SEED_IDS.buyer, TEST_SEED_IDS.employee],
  );
```

- [ ] **Step 3: Verify by running the suite once (no new tests yet)**

```bash
lsof -ti :4000 | xargs kill 2>/dev/null
lsof -ti :5173 | xargs kill 2>/dev/null
sleep 2
npx playwright test 2>&1 | tail -5
```

Expected: 12 tests pass (existing) — the new seed row doesn't affect them.

- [ ] **Step 4: Commit**

```bash
git add tests/global-setup.ts tests/helpers/db.ts
git commit -m "test(e2e): seed EMPLOYEE third party for loan tests"
```

---

### Task 15: API helpers for loans in tests

**Files:**
- Modify: `tests/helpers/api.ts`

- [ ] **Step 1: Append types and helpers**

```ts
export interface LoanInstallmentInput {
  sequence: number;
  dueDate: string;
  plannedAmount: number;
}

export interface LoanCreateInput {
  borrowerId: string;
  originAccountId: string;
  principalAmount: number;
  description?: string | null;
  installments: LoanInstallmentInput[];
}

export interface Loan {
  id: string;
  borrowerId: string;
  principalAmount: string | number;
  paidAmount: string | number;
  extraReceived: string | number;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  installments: Array<{
    id: string;
    sequence: number;
    plannedAmount: string | number;
    paidAmount: string | number;
    status: 'PENDING' | 'PARTIAL' | 'PAID';
    dueDate: string;
  }>;
  isOverdue: boolean;
}

export async function apiCreateLoan(token: string, data: LoanCreateInput): Promise<Loan> {
  return postJson('/loans', data, token);
}

export async function apiListLoans(token: string): Promise<Loan[]> {
  return getJson('/loans', token);
}

export async function apiGetLoan(token: string, id: string): Promise<Loan> {
  return getJson(`/loans/${id}`, token);
}

export interface LoanPaymentInput {
  accountId: string;
  principalAmount: number;
  extraAmount?: number;
  date?: string | null;
  notes?: string | null;
}

export async function apiAddLoanPayment(token: string, loanId: string, data: LoanPaymentInput): Promise<Loan> {
  return postJson(`/loans/${loanId}/payments`, data, token);
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/helpers/api.ts
git commit -m "test(e2e): API helpers for loans (create, list, get, addPayment)"
```

---

### Task 16: E2E happy path — create loan and pay one installment via UI

**Files:**
- Create: `tests/e2e/treasury/loans.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../../fixtures/test';
import { loginAsAdmin } from '../../fixtures/auth';
import {
  apiGetAccount,
  apiCreateLoan,
  apiGetLoan,
  apiAddLoanPayment,
} from '../../helpers/api';
import { TEST_SEED_IDS } from '../../global-setup';

test.describe('Tesorería — préstamos internos', () => {
  test('crear préstamo de 5M en 5 cuotas y registrar primer pago', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const PRINCIPAL = 5_000_000;
    const INSTALLMENT = 1_000_000;

    const cashBefore = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string,
    );
    const bankBefore = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string,
    );

    await page.goto('/treasury/loans');

    await page.getByTestId('loans-create-button').click();

    // Borrower (ThirdPartySelector by placeholder + click result)
    await page.getByPlaceholder(/Buscar o crear/).click();
    await page.getByRole('button', { name: /Empleado Test/ }).first().click();

    // Account, principal, schedule
    await page.getByTestId('loan-form-account').selectOption(TEST_SEED_IDS.accountCash);
    await page.getByTestId('loan-form-principal').fill(String(PRINCIPAL));
    await page.getByTestId('loan-form-installments-count').fill('5');
    await page.getByTestId('loan-form-frequency').selectOption('MONTHLY');
    await page.getByTestId('loan-form-generate').click();

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/loans') && r.request().method() === 'POST' && r.status() === 201,
      ),
      page.getByTestId('loan-form-submit').click(),
    ]);

    // Verify cash debited by full principal
    const cashAfterDisburse = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string,
    );
    expect(cashBefore - cashAfterDisburse).toBe(PRINCIPAL);

    // Loan card visible
    const card = page.locator('[data-testid^="loan-card-"]').first();
    await expect(card).toBeVisible();

    // Open payment modal and pay first installment INTO bank account
    const payButton = card.locator('[data-testid$="-pay-button"]');
    await payButton.click();

    await page.getByTestId('loan-payment-account').selectOption(TEST_SEED_IDS.accountBank);
    await page.getByTestId('loan-payment-principal').fill(String(INSTALLMENT));

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/loans/') && r.url().includes('/payments') && r.status() === 201,
      ),
      page.getByTestId('loan-payment-submit').click(),
    ]);

    const cashAfterPay = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountCash)).currentBalance as string,
    );
    const bankAfterPay = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string,
    );

    expect(cashBefore - cashAfterPay).toBe(PRINCIPAL); // disbursement only
    expect(bankAfterPay - bankBefore).toBe(INSTALLMENT); // repayment
  });
});
```

- [ ] **Step 2: Run only this spec**

```bash
lsof -ti :4000 | xargs kill 2>/dev/null
lsof -ti :5173 | xargs kill 2>/dev/null
sleep 2
npx playwright test tests/e2e/treasury/loans.spec.ts 2>&1 | tail -8
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/treasury/loans.spec.ts
git commit -m "test(e2e): loans happy path — create + first installment payment"
```

---

### Task 17: E2E — payment with extra income

**Files:**
- Modify: `tests/e2e/treasury/loans.spec.ts`

- [ ] **Step 1: Add the test inside the same describe block**

```ts
  test('pago con monto extra: principal va a saldo, extra va a ingreso adicional', async ({ page }) => {
    const token = await loginAsAdmin(page);

    // Create the loan via API to keep this test focused on the payment flow
    const today = new Date().toISOString().slice(0, 10);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 3_000_000,
      installments: [
        { sequence: 1, dueDate: today, plannedAmount: 1_500_000 },
        { sequence: 2, dueDate: today, plannedAmount: 1_500_000 },
      ],
    });

    const bankBefore = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string,
    );

    await page.goto('/treasury/loans');
    const card = page.getByTestId(`loan-card-${loan.id}`);
    await card.locator('[data-testid$="-pay-button"]').click();

    await page.getByTestId('loan-payment-account').selectOption(TEST_SEED_IDS.accountBank);
    await page.getByTestId('loan-payment-principal').fill('1500000');
    await page.getByTestId('loan-payment-extra').fill('200000');

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/loans/') && r.url().includes('/payments') && r.status() === 201,
      ),
      page.getByTestId('loan-payment-submit').click(),
    ]);

    const bankAfter = parseFloat(
      (await apiGetAccount(token, TEST_SEED_IDS.accountBank)).currentBalance as string,
    );
    expect(bankAfter - bankBefore).toBe(1_700_000);

    const updated = await apiGetLoan(token, loan.id);
    expect(parseFloat(updated.paidAmount as string)).toBe(1_500_000);
    expect(parseFloat(updated.extraReceived as string)).toBe(200_000);
  });
```

- [ ] **Step 2: Run the spec**

```bash
lsof -ti :4000 | xargs kill 2>/dev/null
lsof -ti :5173 | xargs kill 2>/dev/null
sleep 2
npx playwright test tests/e2e/treasury/loans.spec.ts 2>&1 | tail -10
```

Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/treasury/loans.spec.ts
git commit -m "test(e2e): loan repayment with optional extra income"
```

---

### Task 18: E2E — over-payment validation

**Files:**
- Modify: `tests/e2e/treasury/loans.spec.ts`

- [ ] **Step 1: Add the third test inside the same describe block**

```ts
  test('rechaza pago de principal mayor al saldo pendiente con error 400', async ({ page }) => {
    const token = await loginAsAdmin(page);
    const today = new Date().toISOString().slice(0, 10);
    const loan = await apiCreateLoan(token, {
      borrowerId: TEST_SEED_IDS.employee,
      originAccountId: TEST_SEED_IDS.accountCash,
      principalAmount: 4_000_000,
      installments: [{ sequence: 1, dueDate: today, plannedAmount: 4_000_000 }],
    });

    let error: Error | null = null;
    try {
      await apiAddLoanPayment(token, loan.id, {
        accountId: TEST_SEED_IDS.accountBank,
        principalAmount: 10_000_000,
      });
    } catch (e) {
      error = e as Error;
    }
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/excede el saldo pendiente/i);
  });
```

- [ ] **Step 2: Run all three loan tests**

```bash
lsof -ti :4000 | xargs kill 2>/dev/null
lsof -ti :5173 | xargs kill 2>/dev/null
sleep 2
npx playwright test tests/e2e/treasury/loans.spec.ts 2>&1 | tail -10
```

Expected: 3 passed.

- [ ] **Step 3: Run the FULL suite to verify nothing else regressed**

```bash
lsof -ti :4000 | xargs kill 2>/dev/null
lsof -ti :5173 | xargs kill 2>/dev/null
sleep 2
npx playwright test 2>&1 | tail -20
```

Expected: 15 passed (12 existing + 3 new).

- [ ] **Step 4: Restart dev**

```bash
cd backend && npm run dev &
cd frontend && npm run dev &
sleep 5
curl -s -o /dev/null -w "Backend :4000 -> %{http_code}\n" http://localhost:4000/api/health
curl -s -o /dev/null -w "Frontend :5173 -> %{http_code}\n" http://localhost:5173/
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/treasury/loans.spec.ts
git commit -m "test(e2e): reject loan over-payment with clear error"
```

---

## Out of scope for this plan (Sprint L.4 — separate plan)

These are intentionally not part of this plan and would form a follow-up:

- Detail page `/treasury/loans/:id` with installment table and full payment history.
- Visual `OVERDUE` badge on cards (the `isOverdue` flag is already returned by the API).
- "Cancelar préstamo" button on card (endpoint exists; UI does not).
- "Próxima cuota a vencer" widget on the treasury dashboard.
- CSV export of loans.

When you are ready for L.4, brainstorm and write a separate plan.
