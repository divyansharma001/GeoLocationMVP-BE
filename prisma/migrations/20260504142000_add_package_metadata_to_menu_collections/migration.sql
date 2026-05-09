ALTER TABLE "MenuCollection"
ADD COLUMN IF NOT EXISTS "coverImageUrl" TEXT,
ADD COLUMN IF NOT EXISTS "servesCount" INTEGER,
ADD COLUMN IF NOT EXISTS "packagePrice" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "MenuCollection_merchantId_displayOrder_idx"
ON "MenuCollection"("merchantId", "displayOrder");
