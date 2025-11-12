-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('PAYPAL', 'STRIPE');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('COIN_PURCHASE', 'DEAL_PURCHASE', 'BOOKING_PREPAY', 'MENU_ORDER');

-- CreateEnum
CREATE TYPE "HeistItemType" AS ENUM ('SWORD', 'HAMMER', 'SHIELD');

-- CreateEnum
CREATE TYPE "HeistItemEffectType" AS ENUM ('INCREASE_STEAL_PERCENTAGE', 'INCREASE_STEAL_BONUS', 'REDUCE_THEFT_PERCENTAGE', 'BLOCK_THEFT_CHANCE', 'INCREASE_SUCCESS_RATE');

-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "gateway" "PaymentGateway" NOT NULL DEFAULT 'PAYPAL',
ADD COLUMN     "purpose" "PaymentPurpose" NOT NULL DEFAULT 'COIN_PURCHASE',
ADD COLUMN     "relatedOrderId" INTEGER;

-- CreateTable
CREATE TABLE "HeistItem" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HeistItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "coinCost" INTEGER NOT NULL,
    "effectType" "HeistItemEffectType" NOT NULL,
    "effectValue" DOUBLE PRECISION NOT NULL,
    "durationHours" INTEGER,
    "maxUses" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserHeistItem" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "usesRemaining" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UserHeistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeistItemUsage" (
    "id" SERIAL NOT NULL,
    "heistId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectApplied" JSONB,

    CONSTRAINT "HeistItemUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HeistItem_name_key" ON "HeistItem"("name");

-- CreateIndex
CREATE INDEX "HeistItem_isActive_idx" ON "HeistItem"("isActive");

-- CreateIndex
CREATE INDEX "HeistItem_type_idx" ON "HeistItem"("type");

-- CreateIndex
CREATE INDEX "UserHeistItem_userId_isActive_idx" ON "UserHeistItem"("userId", "isActive");

-- CreateIndex
CREATE INDEX "UserHeistItem_expiresAt_idx" ON "UserHeistItem"("expiresAt");

-- CreateIndex
CREATE INDEX "UserHeistItem_userId_expiresAt_idx" ON "UserHeistItem"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserHeistItem_userId_itemId_key" ON "UserHeistItem"("userId", "itemId");

-- CreateIndex
CREATE INDEX "HeistItemUsage_heistId_idx" ON "HeistItemUsage"("heistId");

-- CreateIndex
CREATE INDEX "HeistItemUsage_userId_idx" ON "HeistItemUsage"("userId");

-- CreateIndex
CREATE INDEX "HeistItemUsage_itemId_idx" ON "HeistItemUsage"("itemId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_relatedOrderId_idx" ON "PaymentTransaction"("relatedOrderId");

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_relatedOrderId_fkey" FOREIGN KEY ("relatedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHeistItem" ADD CONSTRAINT "UserHeistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHeistItem" ADD CONSTRAINT "UserHeistItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "HeistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeistItemUsage" ADD CONSTRAINT "HeistItemUsage_heistId_fkey" FOREIGN KEY ("heistId") REFERENCES "Heist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeistItemUsage" ADD CONSTRAINT "HeistItemUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeistItemUsage" ADD CONSTRAINT "HeistItemUsage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "HeistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
