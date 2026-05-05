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
CREATE INDEX "loans_borrowerId_idx" ON "loans"("borrowerId");
CREATE INDEX "loans_status_idx" ON "loans"("status");
CREATE UNIQUE INDEX "loan_installments_loanId_sequence_key" ON "loan_installments"("loanId", "sequence");
CREATE INDEX "loan_installments_dueDate_idx" ON "loan_installments"("dueDate");
CREATE INDEX "loan_payments_loanId_idx" ON "loan_payments"("loanId");
CREATE INDEX "transactions_loanId_idx" ON "transactions"("loanId");
CREATE INDEX "transactions_loanPaymentId_idx" ON "transactions"("loanPaymentId");

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "third_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loans" ADD CONSTRAINT "loans_originAccountId_fkey" FOREIGN KEY ("originAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loan_installments" ADD CONSTRAINT "loan_installments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loanPaymentId_fkey" FOREIGN KEY ("loanPaymentId") REFERENCES "loan_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
