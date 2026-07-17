-- Nueva categoría de transacción para el reparto de ganancia a inversionistas.
-- Sin ella, el pago de una CxP PROFIT_SHARE se categorizaba como VEHICLE_PURCHASE
-- (contaminando el costo por vehículo y el P&L por categoría). Idempotente y aislada.
ALTER TYPE "TransactionCategory" ADD VALUE IF NOT EXISTS 'PROFIT_SHARE';
