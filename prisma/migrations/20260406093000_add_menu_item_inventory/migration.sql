ALTER TABLE "MenuItem"
ADD COLUMN "isAvailable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "inventoryTrackingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "inventoryQuantity" INTEGER,
ADD COLUMN "lowStockThreshold" INTEGER,
ADD COLUMN "allowBackorder" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "MenuItem_merchantId_isAvailable_idx"
ON "MenuItem"("merchantId", "isAvailable");
