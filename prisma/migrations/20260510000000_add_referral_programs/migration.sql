-- Per-merchant referral programs.
-- Additive only.

CREATE TABLE "MerchantReferralProgram" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rewardForReferrer" TEXT NOT NULL,
    "rewardForReferred" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxRedemptionsPerUser" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantReferralProgram_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MerchantReferralProgram_merchantId_idx" ON "MerchantReferralProgram"("merchantId");
CREATE INDEX "MerchantReferralProgram_merchantId_isActive_idx" ON "MerchantReferralProgram"("merchantId", "isActive");

ALTER TABLE "MerchantReferralProgram"
    ADD CONSTRAINT "MerchantReferralProgram_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
