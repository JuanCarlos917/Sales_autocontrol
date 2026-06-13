-- AlterEnum
ALTER TYPE "TransactionCategory" ADD VALUE 'LOAN_INTEREST_INCOME';

-- AlterTable
ALTER TABLE "loan_payments" ADD COLUMN     "capitalPortion" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "interestPortion" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "interestAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "interestRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "interestReceived" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Backfill: pagos históricos eran 100% capital (sin interés).
UPDATE "loan_payments" SET "capitalPortion" = "principalAmount" WHERE "interestPortion" = 0;
