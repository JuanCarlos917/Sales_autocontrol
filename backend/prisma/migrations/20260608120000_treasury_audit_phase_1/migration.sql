-- ═══════════════════════════════════════════════════════════════
-- Fase 1 de la auditoría de trazabilidad de tesorería:
--   1. Nueva tabla TreasuryAuditLog (polimórfica: TRANSACTION /
--      TRANSFER / ACCOUNT / PAYABLE / PAYABLE_PAYMENT).
--   2. Nueva columna Transaction.reversesTransactionId (self-FK)
--      para vincular EXPENSE_ADJUSTMENT / EXPENSE_REVERSAL con el
--      VEHICLE_EXPENSE original que ajustan/reversan.
--
-- Spec: docs/superpowers/audits/2026-06-07-treasury-traceability-audit.md
-- ═══════════════════════════════════════════════════════════════

-- 1) Enums
CREATE TYPE "TreasuryAuditEntity" AS ENUM (
  'TRANSACTION',
  'TRANSFER',
  'ACCOUNT',
  'PAYABLE',
  'PAYABLE_PAYMENT'
);

CREATE TYPE "TreasuryAuditAction" AS ENUM (
  'CREATE',
  'UPDATE',
  'DELETE',
  'CANCEL',
  'PAYMENT'
);

-- 2) Tabla treasury_audit_logs
CREATE TABLE "treasury_audit_logs" (
  "id"         TEXT NOT NULL,
  "entityType" "TreasuryAuditEntity" NOT NULL,
  "entityId"   TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "action"     "TreasuryAuditAction" NOT NULL,
  "before"     JSONB,
  "after"      JSONB,
  "reason"     TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "treasury_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "treasury_audit_logs_entityType_entityId_idx"
  ON "treasury_audit_logs"("entityType", "entityId");
CREATE INDEX "treasury_audit_logs_userId_idx"
  ON "treasury_audit_logs"("userId");
CREATE INDEX "treasury_audit_logs_createdAt_idx"
  ON "treasury_audit_logs"("createdAt");

ALTER TABLE "treasury_audit_logs"
  ADD CONSTRAINT "treasury_audit_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) Transaction.reversesTransactionId (self-FK)
ALTER TABLE "transactions"
  ADD COLUMN "reversesTransactionId" TEXT;

CREATE INDEX "transactions_reversesTransactionId_idx"
  ON "transactions"("reversesTransactionId");

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_reversesTransactionId_fkey"
  FOREIGN KEY ("reversesTransactionId") REFERENCES "transactions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
