-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "accessCode" TEXT,
ADD COLUMN     "bountyQRCode" TEXT,
ADD COLUMN     "bountyRewardAmount" DOUBLE PRECISION,
ADD COLUMN     "currentRedemptions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isFlashSale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxRedemptions" INTEGER,
ADD COLUMN     "minReferralsRequired" INTEGER;

-- CreateIndex
CREATE INDEX "Deal_accessCode_idx" ON "Deal"("accessCode");

-- CreateIndex
CREATE INDEX "Deal_merchantId_dealTypeId_idx" ON "Deal"("merchantId", "dealTypeId");

-- CreateIndex
CREATE INDEX "Deal_isFlashSale_endTime_idx" ON "Deal"("isFlashSale", "endTime");
