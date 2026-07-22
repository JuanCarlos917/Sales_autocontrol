-- AlterEnum
-- Idempotente (IF NOT EXISTS) por consistencia con las demás migraciones de enum.
ALTER TYPE "TransactionCategory" ADD VALUE IF NOT EXISTS 'COMMISSION_RETURN';
