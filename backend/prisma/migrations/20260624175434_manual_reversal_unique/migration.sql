-- Partial unique index: only one MANUAL_REVERSAL per original transaction.
-- EXPENSE_ADJUSTMENT and EXPENSE_REVERSAL rows are NOT affected because they use
-- different category values, so the WHERE clause excludes them.
CREATE UNIQUE INDEX "manual_reversal_unique"
  ON "transactions" ("reversesTransactionId")
  WHERE "category" = 'MANUAL_REVERSAL';
