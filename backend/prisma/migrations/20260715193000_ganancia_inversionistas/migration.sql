-- Enums nuevos (idempotente)
ALTER TYPE "PayableType" ADD VALUE IF NOT EXISTS 'PROFIT_SHARE';
ALTER TYPE "ParticipantRole" ADD VALUE IF NOT EXISTS 'INVESTOR';

-- Settings nuevos (idempotente). Los porcentajes son editables desde la UI.
INSERT INTO "settings" ("id", "key", "value") VALUES
  ('set-commission-gross-pct', 'commission_gross_pct', '10'),
  ('set-dist-reinvest-pct',    'reinvest_pct',         '30'),
  ('set-dist-tax-pct',         'tax_pct',              '10'),
  ('set-investor-team',        'investor_team',        '[]')
ON CONFLICT ("key") DO NOTHING;
