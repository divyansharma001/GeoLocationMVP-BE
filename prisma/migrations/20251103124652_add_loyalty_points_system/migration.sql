-- CreateEnum
CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARNED', 'REDEEMED', 'EXPIRED', 'ADJUSTED', 'BONUS', 'REFUNDED');

-- CreateEnum
CREATE TYPE "LoyaltyRedemptionStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "MerchantLoyaltyProgram" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "pointsPerDollar" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "minimumPurchase" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "minimumRedemption" INTEGER NOT NULL DEFAULT 25,
    "redemptionValue" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "pointExpirationDays" INTEGER,
    "allowCombineWithDeals" BOOLEAN NOT NULL DEFAULT true,
    "earnOnDiscounted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantLoyaltyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMerchantLoyalty" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "loyaltyProgramId" INTEGER NOT NULL,
    "currentBalance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "lifetimeRedeemed" INTEGER NOT NULL DEFAULT 0,
    "lastEarnedAt" TIMESTAMP(3),
    "lastRedeemedAt" TIMESTAMP(3),
    "tier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMerchantLoyalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyPointTransaction" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "loyaltyProgramId" INTEGER NOT NULL,
    "userLoyaltyId" INTEGER NOT NULL,
    "type" "LoyaltyTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "relatedOrderId" INTEGER,
    "relatedRedemptionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyPointTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyRedemption" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "loyaltyProgramId" INTEGER NOT NULL,
    "userLoyaltyId" INTEGER NOT NULL,
    "pointsUsed" INTEGER NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "orderId" INTEGER,
    "status" "LoyaltyRedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "loyaltyProgramId" INTEGER,
    "orderNumber" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "loyaltyDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalAmount" DOUBLE PRECISION NOT NULL,
    "loyaltyPointsEarned" INTEGER NOT NULL DEFAULT 0,
    "loyaltyPointsRedeemed" INTEGER NOT NULL DEFAULT 0,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "orderItems" JSONB NOT NULL,
    "paymentMethod" TEXT,
    "paymentTransactionId" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantLoyaltyProgram_merchantId_key" ON "MerchantLoyaltyProgram"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantLoyaltyProgram_merchantId_isActive_idx" ON "MerchantLoyaltyProgram"("merchantId", "isActive");

-- CreateIndex
CREATE INDEX "MerchantLoyaltyProgram_isActive_idx" ON "MerchantLoyaltyProgram"("isActive");

-- CreateIndex
CREATE INDEX "UserMerchantLoyalty_userId_idx" ON "UserMerchantLoyalty"("userId");

-- CreateIndex
CREATE INDEX "UserMerchantLoyalty_merchantId_idx" ON "UserMerchantLoyalty"("merchantId");

-- CreateIndex
CREATE INDEX "UserMerchantLoyalty_currentBalance_idx" ON "UserMerchantLoyalty"("currentBalance");

-- CreateIndex
CREATE INDEX "UserMerchantLoyalty_userId_merchantId_currentBalance_idx" ON "UserMerchantLoyalty"("userId", "merchantId", "currentBalance");

-- CreateIndex
CREATE UNIQUE INDEX "UserMerchantLoyalty_userId_merchantId_key" ON "UserMerchantLoyalty"("userId", "merchantId");

-- CreateIndex
CREATE INDEX "LoyaltyPointTransaction_userId_createdAt_idx" ON "LoyaltyPointTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyPointTransaction_merchantId_createdAt_idx" ON "LoyaltyPointTransaction"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyPointTransaction_type_idx" ON "LoyaltyPointTransaction"("type");

-- CreateIndex
CREATE INDEX "LoyaltyPointTransaction_createdAt_idx" ON "LoyaltyPointTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyPointTransaction_userId_merchantId_createdAt_idx" ON "LoyaltyPointTransaction"("userId", "merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyRedemption_userId_status_idx" ON "LoyaltyRedemption"("userId", "status");

-- CreateIndex
CREATE INDEX "LoyaltyRedemption_merchantId_status_idx" ON "LoyaltyRedemption"("merchantId", "status");

-- CreateIndex
CREATE INDEX "LoyaltyRedemption_status_idx" ON "LoyaltyRedemption"("status");

-- CreateIndex
CREATE INDEX "LoyaltyRedemption_redeemedAt_idx" ON "LoyaltyRedemption"("redeemedAt");

-- CreateIndex
CREATE INDEX "LoyaltyRedemption_userId_merchantId_redeemedAt_idx" ON "LoyaltyRedemption"("userId", "merchantId", "redeemedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_merchantId_idx" ON "Order"("merchantId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_userId_merchantId_createdAt_idx" ON "Order"("userId", "merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_orderNumber_idx" ON "Order"("orderNumber");

-- AddForeignKey
ALTER TABLE "MerchantLoyaltyProgram" ADD CONSTRAINT "MerchantLoyaltyProgram_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMerchantLoyalty" ADD CONSTRAINT "UserMerchantLoyalty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMerchantLoyalty" ADD CONSTRAINT "UserMerchantLoyalty_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMerchantLoyalty" ADD CONSTRAINT "UserMerchantLoyalty_loyaltyProgramId_fkey" FOREIGN KEY ("loyaltyProgramId") REFERENCES "MerchantLoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPointTransaction" ADD CONSTRAINT "LoyaltyPointTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPointTransaction" ADD CONSTRAINT "LoyaltyPointTransaction_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPointTransaction" ADD CONSTRAINT "LoyaltyPointTransaction_loyaltyProgramId_fkey" FOREIGN KEY ("loyaltyProgramId") REFERENCES "MerchantLoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPointTransaction" ADD CONSTRAINT "LoyaltyPointTransaction_userLoyaltyId_fkey" FOREIGN KEY ("userLoyaltyId") REFERENCES "UserMerchantLoyalty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPointTransaction" ADD CONSTRAINT "LoyaltyPointTransaction_relatedOrderId_fkey" FOREIGN KEY ("relatedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPointTransaction" ADD CONSTRAINT "LoyaltyPointTransaction_relatedRedemptionId_fkey" FOREIGN KEY ("relatedRedemptionId") REFERENCES "LoyaltyRedemption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_loyaltyProgramId_fkey" FOREIGN KEY ("loyaltyProgramId") REFERENCES "MerchantLoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_userLoyaltyId_fkey" FOREIGN KEY ("userLoyaltyId") REFERENCES "UserMerchantLoyalty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_loyaltyProgramId_fkey" FOREIGN KEY ("loyaltyProgramId") REFERENCES "MerchantLoyaltyProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;
