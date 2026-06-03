-- ═══════════════════════════════════════════════════════════════
-- Cruces: vínculo duro entre el vehículo recibido y la venta origen.
--
-- Agrega vehicles.sourceVehicleId (self-relation, nullable) y hace
-- backfill para cruces preexistentes — los vincula con su venta
-- origen usando vehicles.receivedVehiclePlate matching.
--
-- También copia el buyerId del origen al supplierId del cruce, ya
-- que el comprador del carro vendido es quien entregó este vehículo
-- como parte de pago (i.e. su "proveedor").
-- ═══════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN "sourceVehicleId" TEXT;

-- CreateIndex (lookups reverse: dado un origen, qué cruces entregó)
CREATE INDEX "vehicles_sourceVehicleId_idx" ON "vehicles"("sourceVehicleId");

-- AddForeignKey (self-relation, SET NULL on delete del origen para no romper el cruce)
ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_sourceVehicleId_fkey"
  FOREIGN KEY ("sourceVehicleId") REFERENCES "vehicles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: para cada cruce preexistente, encontrar su origen y enlazar.
-- Tomamos el vehículo VENDIDO más reciente cuyo receivedVehiclePlate
-- coincide con la placa del cruce. Si hay ambigüedad por placas repetidas,
-- el match más reciente gana (ORDER BY saleDate DESC).
WITH origen AS (
  SELECT DISTINCT ON (origen.plate, cruce.id)
    cruce.id AS cruce_id,
    origen.id AS origen_id,
    origen."buyerId" AS origen_buyer_id
  FROM vehicles cruce
  JOIN vehicles origen
    ON origen."receivedVehiclePlate" = cruce.plate
    AND origen."receivedVehicle" = true
    AND origen.stage = 'VENDIDO'
  WHERE cruce."fromTradeIn" = true
    AND cruce."sourceVehicleId" IS NULL
  ORDER BY origen.plate, cruce.id, origen."saleDate" DESC NULLS LAST
)
UPDATE vehicles v
SET "sourceVehicleId" = o.origen_id,
    "supplierId"      = COALESCE(v."supplierId", o.origen_buyer_id),
    "updatedAt"       = NOW()
FROM origen o
WHERE v.id = o.cruce_id;

-- Auto-upgrade del tercero (CLIENT -> BOTH) cuando ahora figura como proveedor de un cruce.
UPDATE third_parties tp
SET type = 'BOTH',
    "updatedAt" = NOW()
WHERE tp.type = 'CLIENT'
  AND EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v."supplierId" = tp.id
      AND v."fromTradeIn" = true
  );
