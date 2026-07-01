-- AlterTable
ALTER TABLE "debt_payments" ADD COLUMN     "reconciled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reverseReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedBy" TEXT;

-- Índice único parcial: un solo reverso (DEBT_REVERSAL) por transacción original.
CREATE UNIQUE INDEX "debt_reversal_unique"
  ON "transactions" ("reversesTransactionId")
  WHERE "category" = 'DEBT_REVERSAL';
