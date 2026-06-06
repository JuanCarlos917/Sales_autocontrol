-- ═══════════════════════════════════════════════════════════════
-- Backfill: crear companion TRANSFER_OUT + TRANSFER_IN transactions
-- para Transfers preexistentes que no las tengan.
--
-- Bug histórico: saleService creaba Transfers directos sin las
-- companion transactions, así que calculateBalance NO los sumaba al
-- saldo de las cuentas BUDGET. Después de este backfill, los saldos
-- ya empiezan a reflejarse correctamente.
--
-- Solo procesa Transfers sin transactions asociadas (idempotente).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

\echo ''
\echo '── ANTES: Transfers sin companion transactions ──'
SELECT count(*) AS transfers_huerfanos
FROM transfers tr
WHERE NOT EXISTS (
  SELECT 1 FROM transactions t WHERE t."transferId" = tr.id
);

-- Crear TRANSFER_OUT en la cuenta origen
INSERT INTO transactions (
  id, "accountId", type, category, amount, description, date,
  "transferId", "vehicleId", "createdBy", "createdAt", "updatedAt"
)
SELECT
  'bf_out_' || substr(md5(random()::text || tr.id), 1, 18),
  tr."fromAccountId",
  'TRANSFER_OUT',
  'TRANSFER',
  tr.amount,
  tr.description,
  tr.date,
  tr.id,
  -- Tratar de inferir vehicleId desde la descripción ("Reinversión venta XYZ123")
  (SELECT v.id FROM vehicles v
   WHERE tr.description LIKE '%venta ' || v.plate || '%'
   LIMIT 1),
  COALESCE(tr."createdBy", (SELECT id FROM users LIMIT 1)),
  tr."createdAt",
  tr."createdAt"
FROM transfers tr
WHERE NOT EXISTS (
  SELECT 1 FROM transactions t
  WHERE t."transferId" = tr.id AND t.type = 'TRANSFER_OUT'
);

-- Crear TRANSFER_IN en la cuenta destino
INSERT INTO transactions (
  id, "accountId", type, category, amount, description, date,
  "transferId", "vehicleId", "createdBy", "createdAt", "updatedAt"
)
SELECT
  'bf_in_' || substr(md5(random()::text || tr.id), 1, 18),
  tr."toAccountId",
  'TRANSFER_IN',
  'TRANSFER',
  tr.amount,
  tr.description,
  tr.date,
  tr.id,
  (SELECT v.id FROM vehicles v
   WHERE tr.description LIKE '%venta ' || v.plate || '%'
   LIMIT 1),
  COALESCE(tr."createdBy", (SELECT id FROM users LIMIT 1)),
  tr."createdAt",
  tr."createdAt"
FROM transfers tr
WHERE NOT EXISTS (
  SELECT 1 FROM transactions t
  WHERE t."transferId" = tr.id AND t.type = 'TRANSFER_IN'
);

\echo ''
\echo '── DESPUÉS: Transfers sin companion transactions (debe ser 0) ──'
SELECT count(*) AS transfers_huerfanos
FROM transfers tr
WHERE NOT EXISTS (
  SELECT 1 FROM transactions t WHERE t."transferId" = tr.id
);

\echo ''
\echo '── Saldos de cuentas BUDGET después del backfill ──'
SELECT a.name, COALESCE(SUM(CASE WHEN t.type='TRANSFER_IN' THEN t.amount ELSE -t.amount END), 0) AS movimiento_neto
FROM accounts a
LEFT JOIN transactions t ON t."accountId" = a.id
WHERE a.type = 'BUDGET'
GROUP BY a.id, a.name
ORDER BY a.name;

COMMIT;
