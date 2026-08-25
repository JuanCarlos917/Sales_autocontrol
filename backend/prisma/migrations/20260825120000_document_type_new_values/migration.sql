-- AlterEnum
-- Tipos de documento vigentes (2026-08-25). Los valores previos se conservan
-- para no romper documentos existentes; solo se dejan de ofrecer en el formulario.
-- Idempotente (IF NOT EXISTS) por consistencia con las demás migraciones de enum.
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'FORMULARIO_TRASPASO';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CONTRATO_MANDATO';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CONTRATO_COMPRAVENTA';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CC_PROPIETARIO';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CC_COMPRADOR';
