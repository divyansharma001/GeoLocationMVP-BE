-- Catering: standalone catering items + options + order line-items.
-- Additive only; does not alter existing tables (other than adding FK references via the new tables).

CREATE TYPE "CateringPricingType" AS ENUM ('PER_PERSON', 'FIXED');

CREATE TABLE "CateringItem" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "pricePerPerson" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fixedPrice" DOUBLE PRECISION,
    "pricingType" "CateringPricingType" NOT NULL DEFAULT 'PER_PERSON',
    "minPeople" INTEGER NOT NULL DEFAULT 1,
    "maxPeople" INTEGER,
    "servesCount" INTEGER,
    "imageUrl" TEXT,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "packagingType" TEXT,
    "dietaryInfo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "specialInstructions" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CateringItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CateringItem_merchantId_idx" ON "CateringItem"("merchantId");
CREATE INDEX "CateringItem_merchantId_category_idx" ON "CateringItem"("merchantId", "category");
CREATE INDEX "CateringItem_merchantId_isActive_idx" ON "CateringItem"("merchantId", "isActive");
CREATE INDEX "CateringItem_category_idx" ON "CateringItem"("category");
CREATE INDEX "CateringItem_isActive_isPopular_idx" ON "CateringItem"("isActive", "isPopular");

ALTER TABLE "CateringItem"
    ADD CONSTRAINT "CateringItem_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CateringItemOption" (
    "id" SERIAL NOT NULL,
    "cateringItemId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "minSelections" INTEGER NOT NULL DEFAULT 0,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CateringItemOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CateringItemOption_cateringItemId_idx" ON "CateringItemOption"("cateringItemId");
CREATE INDEX "CateringItemOption_cateringItemId_displayOrder_idx" ON "CateringItemOption"("cateringItemId", "displayOrder");

ALTER TABLE "CateringItemOption"
    ADD CONSTRAINT "CateringItemOption_cateringItemId_fkey"
    FOREIGN KEY ("cateringItemId") REFERENCES "CateringItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CateringItemOptionChoice" (
    "id" SERIAL NOT NULL,
    "optionId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "priceModifier" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CateringItemOptionChoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CateringItemOptionChoice_optionId_idx" ON "CateringItemOptionChoice"("optionId");
CREATE INDEX "CateringItemOptionChoice_optionId_displayOrder_idx" ON "CateringItemOptionChoice"("optionId", "displayOrder");

ALTER TABLE "CateringItemOptionChoice"
    ADD CONSTRAINT "CateringItemOptionChoice_optionId_fkey"
    FOREIGN KEY ("optionId") REFERENCES "CateringItemOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CateringOrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "cateringItemId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "pricePerUnit" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "specialInstructions" TEXT,
    "selectedOptions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CateringOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CateringOrderItem_orderId_idx" ON "CateringOrderItem"("orderId");
CREATE INDEX "CateringOrderItem_cateringItemId_idx" ON "CateringOrderItem"("cateringItemId");

ALTER TABLE "CateringOrderItem"
    ADD CONSTRAINT "CateringOrderItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CateringOrderItem"
    ADD CONSTRAINT "CateringOrderItem_cateringItemId_fkey"
    FOREIGN KEY ("cateringItemId") REFERENCES "CateringItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
