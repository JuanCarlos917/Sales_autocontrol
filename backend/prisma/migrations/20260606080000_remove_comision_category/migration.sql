-- ═══════════════════════════════════════════════════════════════
-- Eliminar el valor 'COMISION' del enum ExpenseCategory.
--
-- Las comisiones ahora se modelan vía Payable type=COMMISSION en el
-- flujo de venta, NO como gastos del vehículo. Esta migración:
--   1. Mueve cualquier gasto legacy con categoría COMISION a 'OTRO'
--      (safety: nunca borra datos sin notar al usuario)
--   2. Reemplaza el enum por uno sin COMISION
--
-- Postgres no permite ALTER TYPE ... DROP VALUE — hay que crear un
-- nuevo enum, hacer ALTER COLUMN para usarlo, y dropear el viejo.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1) Mover legacy expenses con categoría COMISION a OTRO (idempotente).
UPDATE "expenses"
SET category = 'OTRO',
    description = COALESCE(description || ' ', '') || '[migrado de COMISION → ver CxPs del vehículo en Tesorería]',
    "updatedAt" = NOW()
WHERE category = 'COMISION';

-- 2) Crear nuevo enum sin COMISION.
CREATE TYPE "ExpenseCategory_new" AS ENUM (
  'MECANICA',
  'ESTETICA',
  'IMPUESTOS',
  'TRAMITE',
  'PARQUEADERO',
  'PUBLICIDAD',
  'COMBUSTIBLE',
  'OTRO'
);

-- 3) Cambiar la columna a usar el nuevo tipo (cast vía text).
ALTER TABLE "expenses"
  ALTER COLUMN category TYPE "ExpenseCategory_new"
  USING (category::text::"ExpenseCategory_new");

-- 4) Dropear el viejo y renombrar.
DROP TYPE "ExpenseCategory";
ALTER TYPE "ExpenseCategory_new" RENAME TO "ExpenseCategory";

COMMIT;
