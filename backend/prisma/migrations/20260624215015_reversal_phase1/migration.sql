-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionCategory" ADD VALUE 'LOAN_REVERSAL';
ALTER TYPE "TransactionCategory" ADD VALUE 'DEBT_REVERSAL';

-- AlterEnum
ALTER TYPE "TreasuryAuditAction" ADD VALUE 'REVERSE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TreasuryAuditEntity" ADD VALUE 'LOAN';
ALTER TYPE "TreasuryAuditEntity" ADD VALUE 'LOAN_PAYMENT';
ALTER TYPE "TreasuryAuditEntity" ADD VALUE 'DEBT_PAYMENT';
ALTER TYPE "TreasuryAuditEntity" ADD VALUE 'CASH_COUNT';

-- AlterTable
ALTER TABLE "cash_counts" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedBy" TEXT;
