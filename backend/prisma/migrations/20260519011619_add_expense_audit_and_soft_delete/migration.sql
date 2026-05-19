-- CreateEnum
CREATE TYPE "ExpenseAuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionCategory" ADD VALUE 'EXPENSE_ADJUSTMENT';
ALTER TYPE "TransactionCategory" ADD VALUE 'EXPENSE_REVERSAL';

-- DropIndex
DROP INDEX "transactions_expenseId_key";

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" TEXT,
ADD COLUMN     "updatedBy" TEXT;

-- CreateTable
CREATE TABLE "expense_audit_logs" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "ExpenseAuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_audit_logs_expenseId_idx" ON "expense_audit_logs"("expenseId");

-- CreateIndex
CREATE INDEX "expense_audit_logs_userId_idx" ON "expense_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "expense_audit_logs_createdAt_idx" ON "expense_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "expenses_deletedAt_idx" ON "expenses"("deletedAt");

-- CreateIndex
CREATE INDEX "transactions_expenseId_idx" ON "transactions"("expenseId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_audit_logs" ADD CONSTRAINT "expense_audit_logs_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_audit_logs" ADD CONSTRAINT "expense_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
