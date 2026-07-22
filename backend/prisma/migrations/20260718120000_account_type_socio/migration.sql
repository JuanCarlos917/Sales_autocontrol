-- Tipo de cuenta dedicada al socio, ligada a su tercero.
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'SOCIO';
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "thirdPartyId" TEXT;
DO $$ BEGIN
  ALTER TABLE "accounts" ADD CONSTRAINT "accounts_thirdPartyId_fkey"
    FOREIGN KEY ("thirdPartyId") REFERENCES "third_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "accounts_thirdPartyId_idx" ON "accounts"("thirdPartyId");
