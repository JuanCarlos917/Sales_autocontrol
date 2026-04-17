-- CreateEnum
CREATE TYPE "PayableType" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "PayableStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "payables" (
    "id" TEXT NOT NULL,
    "type" "PayableType" NOT NULL,
    "status" "PayableStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DECIMAL(15,2) NOT NULL,
    "paidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "description" TEXT,
    "vehicleId" TEXT,
    "expenseId" TEXT,
    "thirdPartyId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_payments" (
    "id" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payable_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payables_expenseId_key" ON "payables"("expenseId");

-- CreateIndex
CREATE INDEX "payables_type_status_idx" ON "payables"("type", "status");

-- CreateIndex
CREATE INDEX "payables_vehicleId_idx" ON "payables"("vehicleId");

-- CreateIndex
CREATE INDEX "payables_thirdPartyId_idx" ON "payables"("thirdPartyId");

-- CreateIndex
CREATE INDEX "payables_dueDate_idx" ON "payables"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "payable_payments_transactionId_key" ON "payable_payments"("transactionId");

-- CreateIndex
CREATE INDEX "payable_payments_payableId_idx" ON "payable_payments"("payableId");

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "third_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
