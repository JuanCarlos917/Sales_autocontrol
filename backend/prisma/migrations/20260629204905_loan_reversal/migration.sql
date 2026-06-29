-- AlterTable
ALTER TABLE "loan_payments" ADD COLUMN     "reverseReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedBy" TEXT;

-- Índice único parcial: un solo reverso (LOAN_REVERSAL) por transacción original.
-- No afecta otras categorías porque el WHERE las excluye.
CREATE UNIQUE INDEX "loan_reversal_unique"
  ON "transactions" ("reversesTransactionId")
  WHERE "category" = 'LOAN_REVERSAL';
