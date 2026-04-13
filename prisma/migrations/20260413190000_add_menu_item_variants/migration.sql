ALTER TABLE "MenuItem"
ADD COLUMN "hasVariants" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MenuItemVariant" (
  "id" SERIAL NOT NULL,
  "menuItemId" INTEGER NOT NULL,
  "sku" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "inventoryQuantity" INTEGER,
  "lowStockThreshold" INTEGER,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MenuItemVariant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MenuItemVariant_sku_key" ON "MenuItemVariant"("sku");
CREATE INDEX "MenuItemVariant_menuItemId_idx" ON "MenuItemVariant"("menuItemId");

ALTER TABLE "MenuItemVariant"
ADD CONSTRAINT "MenuItemVariant_menuItemId_fkey"
FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
