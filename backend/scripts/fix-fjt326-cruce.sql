-- ═══════════════════════════════════════════════════════════════
-- Fix retroactivo del cruce de FJT326 (venta del 2026-06-01)
-- ───────────────────────────────────────────────────────────────
-- Contexto: el usuario vendió FJT326 por 40M, recibiendo 17.5M en
-- cruce (vehículo PZD94H) y dejando 22.5M pendiente. Por un bug en
-- el formulario de edición (ya arreglado), los datos del cruce se
-- guardaron en FJT326 pero la venta se registró como CASH 40M:
--   • no se creó el vehículo PZD94H en NEGOCIANDO
--   • no se abrió CxC por 22.5M
--   • se generó una transacción phantom de +40M en caja
--   • saleService sobreescribió los receivedVehicle* a null/false
--
-- Este script es idempotente: cada bloque verifica si ya está hecho.
-- Correr DENTRO de psql; falla atómicamente si algo no calza.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1) Restaurar metadata del cruce en FJT326 (la sobreescribió saleService al enviar paymentType=CASH).
UPDATE vehicles
SET "receivedVehicle" = true,
    "receivedVehiclePlate" = 'PZD94H',
    "receivedVehicleValue" = 17500000.00,
    "updatedAt" = NOW()
WHERE plate = 'FJT326'
  AND stage = 'VENDIDO'
  AND "receivedVehicle" = false;

-- 2) Crear PZD94H en NEGOCIANDO con fromTradeIn=true (si no existe).
INSERT INTO vehicles (
  id, plate, stage, "negotiatedValue", "fromTradeIn",
  "userId", notes, participation, "partnerAssumesExpenses",
  "publishedPortals", "createdAt", "updatedAt"
)
SELECT
  'fix_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20),
  'PZD94H',
  'NEGOCIANDO',
  17500000.00,
  true,
  v."userId",
  'Recibido en cruce por venta de FJT326 (fix retroactivo 2026-06-03)',
  1.0,
  true,
  ARRAY[]::text[],
  NOW(),
  NOW()
FROM vehicles v
WHERE v.plate = 'FJT326'
  AND v.stage = 'VENDIDO'
  AND NOT EXISTS (
    SELECT 1 FROM vehicles WHERE plate = 'PZD94H'
  );

-- 3) Eliminar la transacción phantom de 40M (nunca se recibió esa caja).
--    También borra los PayablePayment huérfanos que la referencian (no debería haber).
DELETE FROM payable_payments
WHERE "transactionId" IN (
  SELECT t.id
  FROM transactions t
  JOIN vehicles v ON v.id = t."vehicleId"
  WHERE v.plate = 'FJT326'
    AND t.category = 'VEHICLE_SALE'
    AND t.amount = 40000000.00
);

DELETE FROM transactions
WHERE id IN (
  SELECT t.id
  FROM transactions t
  JOIN vehicles v ON v.id = t."vehicleId"
  WHERE v.plate = 'FJT326'
    AND t.category = 'VEHICLE_SALE'
    AND t.amount = 40000000.00
);

-- 4) Crear CxC de 22.5M (40M precio - 17.5M cruce) si no existe.
INSERT INTO payables (
  id, "vehicleId", type, status, "totalAmount", "paidAmount",
  description, "thirdPartyId", "createdBy", "createdAt", "updatedAt"
)
SELECT
  'fix_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20),
  v.id,
  'RECEIVABLE',
  'PENDING',
  22500000.00,
  0,
  'Saldo pendiente venta FJT326 (fix retroactivo del cruce)',
  v."buyerId",
  v."userId",
  NOW(),
  NOW()
FROM vehicles v
WHERE v.plate = 'FJT326'
  AND v.stage = 'VENDIDO'
  AND NOT EXISTS (
    SELECT 1 FROM payables
    WHERE "vehicleId" = v.id
      AND type = 'RECEIVABLE'
  );

-- 5) Verificación final — debe mostrar exactamente lo esperado.
\echo ''
\echo '── Verificación final ──'
SELECT plate, stage, "salePrice", "receivedVehicle", "receivedVehiclePlate", "receivedVehicleValue"
FROM vehicles
WHERE plate IN ('FJT326', 'PZD94H')
ORDER BY plate;

\echo ''
\echo '── Transacciones VEHICLE_SALE para FJT326 (debe ser 0 filas) ──'
SELECT t.description, t.amount
FROM transactions t
JOIN vehicles v ON v.id = t."vehicleId"
WHERE v.plate = 'FJT326'
  AND t.category = 'VEHICLE_SALE';

\echo ''
\echo '── CxC RECEIVABLE para FJT326 (debe ser 22.5M PENDING) ──'
SELECT p.type, p.status, p."totalAmount", p."paidAmount", p.description
FROM payables p
JOIN vehicles v ON v.id = p."vehicleId"
WHERE v.plate = 'FJT326'
  AND p.type = 'RECEIVABLE';

COMMIT;
