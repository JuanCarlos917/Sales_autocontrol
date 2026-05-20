-- CreateEnum
CREATE TYPE "VehicleAuditAction" AS ENUM ('CREATE', 'UPDATE', 'STAGE_CHANGE', 'DELETE');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPERVISOR';

-- CreateTable
CREATE TABLE "vehicle_audit_logs" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "VehicleAuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_audit_logs_vehicleId_idx" ON "vehicle_audit_logs"("vehicleId");

-- CreateIndex
CREATE INDEX "vehicle_audit_logs_userId_idx" ON "vehicle_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "vehicle_audit_logs_createdAt_idx" ON "vehicle_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "vehicle_audit_logs" ADD CONSTRAINT "vehicle_audit_logs_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_audit_logs" ADD CONSTRAINT "vehicle_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
