-- ═══════════════════════════════════════════════════════════════
-- Comisiones y bolsillos — Fase 1 (enum additions)
--
-- Postgres requiere que un nuevo valor de enum esté commiteado en
-- una transacción separada antes de poder usarse. Esta migración
-- solo agrega los nuevos valores; la migración siguiente
-- (20260604120000_commissions_phase_1) crea la tabla y los seeds
-- que dependen de ellos.
-- ═══════════════════════════════════════════════════════════════

ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'BUDGET';
ALTER TYPE "PayableType" ADD VALUE IF NOT EXISTS 'COMMISSION';
