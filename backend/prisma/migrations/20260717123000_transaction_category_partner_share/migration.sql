-- Categoría de transacción para el pago de la ganancia del socio. Sin ella, pagar
-- una CxP PARTNER_SHARE se categorizaba VEHICLE_PURCHASE (contaminando el costo del
-- vehículo). Idempotente y aislada.
ALTER TYPE "TransactionCategory" ADD VALUE IF NOT EXISTS 'PARTNER_SHARE';
