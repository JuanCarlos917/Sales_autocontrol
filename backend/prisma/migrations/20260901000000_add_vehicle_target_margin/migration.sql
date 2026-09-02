-- Add targetMargin column to Vehicle
-- Nullable decimal field for target sales margin tracking
ALTER TABLE "vehicles" ADD COLUMN "targetMargin" DECIMAL(5,4);
