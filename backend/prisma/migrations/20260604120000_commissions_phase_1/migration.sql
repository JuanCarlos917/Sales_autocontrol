-- ═══════════════════════════════════════════════════════════════
-- Comisiones y bolsillos — Fase 1
--
-- Crea el enum ParticipantRole, la tabla sale_participants, dos
-- cuentas BUDGET (Fondo Reinversión, Reserva Impuestos), un
-- tercero EMPLOYEE "Dueño / Yo" y los 7 Settings con valores
-- default (60/30/10, 30/70). Los enum values BUDGET y COMMISSION
-- se agregan en la migración previa
-- (20260604115900_commissions_enum_additions) porque Postgres
-- requiere commitearlos en una transacción separada.
-- ═══════════════════════════════════════════════════════════════

-- 1) New enum
CREATE TYPE "ParticipantRole" AS ENUM ('CAPTADOR', 'CERRADOR', 'OTHER');

-- 2) New table sale_participants
CREATE TABLE "sale_participants" (
  "id"           TEXT NOT NULL,
  "vehicleId"    TEXT NOT NULL,
  "thirdPartyId" TEXT NOT NULL,
  "role"         "ParticipantRole" NOT NULL,
  "sharePct"     DECIMAL(5, 2) NOT NULL,
  "amount"       DECIMAL(15, 2) NOT NULL,
  "payableId"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sale_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sale_participants_payableId_key" ON "sale_participants"("payableId");
CREATE INDEX "sale_participants_vehicleId_idx" ON "sale_participants"("vehicleId");
CREATE INDEX "sale_participants_thirdPartyId_idx" ON "sale_participants"("thirdPartyId");

ALTER TABLE "sale_participants"
  ADD CONSTRAINT "sale_participants_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_participants"
  ADD CONSTRAINT "sale_participants_thirdPartyId_fkey"
  FOREIGN KEY ("thirdPartyId") REFERENCES "third_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_participants"
  ADD CONSTRAINT "sale_participants_payableId_fkey"
  FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Seed BUDGET accounts (idempotent)
INSERT INTO "accounts" ("id", "name", "type", "initialBalance", "isActive", "createdAt", "updatedAt")
VALUES
  ('budget-reinvest', 'Fondo Reinversión', 'BUDGET', 0, true, NOW(), NOW()),
  ('budget-tax',      'Reserva Impuestos', 'BUDGET', 0, true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 4) Seed ThirdParty "Dueño / Yo" used as default participant when API caller doesn't pass participants[]
INSERT INTO "third_parties" ("id", "name", "type", "isActive", "createdAt", "updatedAt")
VALUES ('owner-self', 'Dueño / Yo', 'EMPLOYEE', true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 5) Seed default settings (idempotent)
INSERT INTO "settings" ("id", "key", "value")
VALUES
  ('set-commission-pct',  'commission_share_pct',   '60'),
  ('set-reinvest-pct',    'reinvest_share_pct',     '30'),
  ('set-tax-pct',         'tax_share_pct',          '10'),
  ('set-captador-pct',    'default_captador_pct',   '30'),
  ('set-cerrador-pct',    'default_cerrador_pct',   '70'),
  ('set-reinvest-acc',    'reinvest_account_id',    'budget-reinvest'),
  ('set-tax-acc',         'tax_reserve_account_id', 'budget-tax')
ON CONFLICT ("key") DO NOTHING;
