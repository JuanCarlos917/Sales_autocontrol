-- Crea la cuenta SOCIO para cada tercero PARTNER que aún no tenga una. Idempotente.
INSERT INTO "accounts" ("id", "name", "type", "initialBalance", "isActive", "thirdPartyId", "createdAt", "updatedAt")
SELECT 'socio-acct-' || tp."id", 'Cuenta Socio — ' || tp."name", 'SOCIO', 0, true, tp."id", NOW(), NOW()
FROM "third_parties" tp
WHERE tp."type" = 'PARTNER'
  AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."thirdPartyId" = tp."id" AND a."type" = 'SOCIO');
