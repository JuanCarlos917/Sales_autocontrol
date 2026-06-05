-- ═══════════════════════════════════════════════════════════════
-- Limpieza de Payables COMMISSION + SaleParticipants + Transfers
-- generados por ventas sin purchasePrice válido (Problema B/D del
-- audit end-to-end posterior a Fase 1).
--
-- Antes del fix `calculateCommissionBase` con purchasePrice=NULL
-- trataba el costo como 0 y cobraba comisión sobre el salePrice
-- total. Este script borra esos registros huérfanos.
--
-- Salvaguardas:
--   - Solo borra Payables COMMISSION en estado PENDING (no toca pagos hechos)
--   - Solo borra SaleParticipants ligados a vehículos sin purchasePrice
--   - Solo borra Transfers a cuentas BUDGET cuya descripción referencia
--     un vehículo sin purchasePrice
--
-- Idempotente: si el caso no existe, no hace nada.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

\echo ''
\echo '── ANTES: Vehículos vendidos sin purchasePrice ──'
SELECT plate, "salePrice", "purchasePrice"
FROM vehicles
WHERE stage = 'VENDIDO'
  AND ("purchasePrice" IS NULL OR "purchasePrice" = 0)
ORDER BY plate;

\echo ''
\echo '── ANTES: Payables COMMISSION PENDING en esos vehículos ──'
SELECT p.id, v.plate, p."totalAmount", p.status
FROM payables p
JOIN vehicles v ON v.id = p."vehicleId"
WHERE p.type = 'COMMISSION'
  AND p.status = 'PENDING'
  AND (v."purchasePrice" IS NULL OR v."purchasePrice" = 0);

-- 1) Borrar SaleParticipants ligados a Payables COMMISSION PENDING de esos vehículos
DELETE FROM sale_participants sp
USING payables p, vehicles v
WHERE sp."payableId" = p.id
  AND p."vehicleId" = v.id
  AND p.type = 'COMMISSION'
  AND p.status = 'PENDING'
  AND (v."purchasePrice" IS NULL OR v."purchasePrice" = 0);

-- 2) Borrar Payables COMMISSION PENDING de esos vehículos
DELETE FROM payables p
USING vehicles v
WHERE p."vehicleId" = v.id
  AND p.type = 'COMMISSION'
  AND p.status = 'PENDING'
  AND (v."purchasePrice" IS NULL OR v."purchasePrice" = 0);

-- 3) Borrar Transfers a cuentas BUDGET cuya descripción referencia esos vehículos
DELETE FROM transfers tr
USING vehicles v, accounts a
WHERE tr."toAccountId" = a.id
  AND a.type = 'BUDGET'
  AND tr.description LIKE '%' || v.plate || '%'
  AND v.stage = 'VENDIDO'
  AND (v."purchasePrice" IS NULL OR v."purchasePrice" = 0);

\echo ''
\echo '── DESPUÉS: Payables COMMISSION en esos vehículos (debe ser 0) ──'
SELECT count(*) AS payables_restantes
FROM payables p
JOIN vehicles v ON v.id = p."vehicleId"
WHERE p.type = 'COMMISSION'
  AND (v."purchasePrice" IS NULL OR v."purchasePrice" = 0);

\echo ''
\echo '── DESPUÉS: Transfers a BUDGET referenciando esos vehículos (debe ser 0) ──'
SELECT count(*) AS transfers_restantes
FROM transfers tr
JOIN accounts a ON a.id = tr."toAccountId"
WHERE a.type = 'BUDGET'
  AND EXISTS (
    SELECT 1 FROM vehicles v
    WHERE tr.description LIKE '%' || v.plate || '%'
      AND v.stage = 'VENDIDO'
      AND (v."purchasePrice" IS NULL OR v."purchasePrice" = 0)
  );

COMMIT;
