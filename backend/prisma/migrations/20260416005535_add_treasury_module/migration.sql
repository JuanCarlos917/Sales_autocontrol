-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'SAVINGS');

-- CreateEnum
CREATE TYPE "ThirdPartyType" AS ENUM ('SUPPLIER', 'CLIENT', 'PARTNER');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "TransactionCategory" AS ENUM ('VEHICLE_SALE', 'VEHICLE_SALE_PARTIAL', 'CAPITAL_CONTRIBUTION', 'OTHER_INCOME', 'VEHICLE_PURCHASE', 'VEHICLE_EXPENSE', 'OPERATING_EXPENSE', 'OTHER_EXPENSE', 'TRANSFER');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "bank" TEXT,
    "accountNumber" TEXT,
    "initialBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "third_parties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ThirdPartyType" NOT NULL,
    "document" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "third_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "category" "TransactionCategory" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vehicleId" TEXT,
    "thirdPartyId" TEXT,
    "transferId" TEXT,
    "expenseId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "fromAccountId" TEXT NOT NULL,
    "toAccountId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_counts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "expectedBalance" DECIMAL(15,2) NOT NULL,
    "countedBalance" DECIMAL(15,2) NOT NULL,
    "difference" DECIMAL(15,2) NOT NULL,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_expenseId_key" ON "transactions"("expenseId");

-- CreateIndex
CREATE INDEX "transactions_accountId_idx" ON "transactions"("accountId");

-- CreateIndex
CREATE INDEX "transactions_vehicleId_idx" ON "transactions"("vehicleId");

-- CreateIndex
CREATE INDEX "transactions_thirdPartyId_idx" ON "transactions"("thirdPartyId");

-- CreateIndex
CREATE INDEX "transactions_date_idx" ON "transactions"("date");

-- CreateIndex
CREATE INDEX "transactions_type_category_idx" ON "transactions"("type", "category");

-- CreateIndex
CREATE INDEX "transfers_fromAccountId_idx" ON "transfers"("fromAccountId");

-- CreateIndex
CREATE INDEX "transfers_toAccountId_idx" ON "transfers"("toAccountId");

-- CreateIndex
CREATE INDEX "transfers_date_idx" ON "transfers"("date");

-- CreateIndex
CREATE INDEX "cash_counts_accountId_idx" ON "cash_counts"("accountId");

-- CreateIndex
CREATE INDEX "cash_counts_date_idx" ON "cash_counts"("date");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "third_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
