-- ═══════════════════════════════════════════════════════════════
-- Fix v2 — Ajuste de la venta de FJT326
-- ───────────────────────────────────────────────────────────────
-- Realidad confirmada por el usuario (2026-06-03):
--   • Precio total de venta: 57,500,000 COP
--   • Pagado en efectivo a Bancolombia MAMI: 40,000,000 COP
--   • Pagado en cruce (vehículo PZD94H): 17,500,000 COP
--   • Sin saldo pendiente.
--
-- En el fix v1 dejé salePrice=40M y abrí CxC por 22.5M, asumiendo
-- mal que el trade-in se restaba del precio entrado. Este v2:
--   1. Sube salePrice a 57.5M
--   2. Borra la CxC de 22.5M
--   3. Crea la transacción INCOME +40M en Bancolombia MAMI
--
-- Idempotente: cada bloque verifica condición previa.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1) Corregir salePrice a 57.5M (40M efectivo + 17.5M cruce).
UPDATE vehicles
SET "salePrice" = 57500000.00,
    "updatedAt" = NOW()
WHERE plate = 'FJT326'
  AND stage = 'VENDIDO'
  AND "salePrice" = 40000000.00;

-- 2) Borrar la CxC de 22.5M creada por el fix v1 (ya no aplica).
DELETE FROM payable_payments
WHERE "payableId" IN (
  SELECT p.id
  FROM payables p
  JOIN vehicles v ON v.id = p."vehicleId"
  WHERE v.plate = 'FJT326'
    AND p.type = 'RECEIVABLE'
    AND p."totalAmount" = 22500000.00
);

DELETE FROM payables
WHERE id IN (
  SELECT p.id
  FROM payables p
  JOIN vehicles v ON v.id = p."vehicleId"
  WHERE v.plate = 'FJT326'
    AND p.type = 'RECEIVABLE'
    AND p."totalAmount" = 22500000.00
);

-- 3) Crear la transacción INCOME +40M en Bancolombia MAMI.
--    Solo si no existe ya una transacción VEHICLE_SALE para FJT326
--    (idempotencia: si re-corres el script, no duplica).
INSERT INTO transactions (
  id, "accountId", type, category, amount, description,
  date, "vehicleId", "thirdPartyId", "createdBy", "createdAt", "updatedAt"
)
SELECT
  'fix_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20),
  'cmphpxlra0007o91frmuem89w',           -- Bancolombia MAMI
  'INCOME',
  'VEHICLE_SALE',
  40000000.00,
  'Venta vehículo FJT326 (efectivo) — fix retroactivo del cruce',
  '2026-06-01 14:49:35.835'::timestamp,  -- mantener la fecha original de la venta
  v.id,
  v."buyerId",
  v."userId",
  NOW(),
  NOW()
FROM vehicles v
WHERE v.plate = 'FJT326'
  AND v.stage = 'VENDIDO'
  AND NOT EXISTS (
    SELECT 1 FROM transactions t
    WHERE t."vehicleId" = v.id
      AND t.category = 'VEHICLE_SALE'
  );

-- 4) Verificación final
\echo ''
\echo '── FJT326 (salePrice debe ser 57500000, receivedVehicle=t) ──'
SELECT plate, stage, "salePrice", "receivedVehicle", "receivedVehiclePlate", "receivedVehicleValue"
FROM vehicles
WHERE plate = 'FJT326';

\echo ''
\echo '── Transacción VEHICLE_SALE para FJT326 (debe ser 40M en Bancolombia MAMI) ──'
SELECT t.amount, t.category, a.name AS cuenta, t.description
FROM transactions t
JOIN vehicles v ON v.id = t."vehicleId"
JOIN accounts a ON a.id = t."accountId"
WHERE v.plate = 'FJT326'
  AND t.category = 'VEHICLE_SALE';

\echo ''
\echo '── Payables para FJT326 (NO debe haber RECEIVABLE) ──'
SELECT p.type, p.status, p."totalAmount", p.description
FROM payables p
JOIN vehicles v ON v.id = p."vehicleId"
WHERE v.plate = 'FJT326';

\echo ''
\echo '── PZD94H (debe seguir en NEGOCIANDO con fromTradeIn=t) ──'
SELECT plate, stage, "negotiatedValue", "fromTradeIn"
FROM vehicles
WHERE plate = 'PZD94H';

COMMIT;
