-- Per-conversion referral attribution table.
-- Additive only.

CREATE TABLE "ReferralAttribution" (
    "id" SERIAL NOT NULL,
    "programId" INTEGER NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "referrerUserId" INTEGER NOT NULL,
    "referredUserId" INTEGER NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerId" INTEGER,
    "dealId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralAttribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralAttribution_programId_referredUserId_triggerType_key"
    ON "ReferralAttribution"("programId", "referredUserId", "triggerType");
CREATE INDEX "ReferralAttribution_merchantId_idx" ON "ReferralAttribution"("merchantId");
CREATE INDEX "ReferralAttribution_programId_idx" ON "ReferralAttribution"("programId");
CREATE INDEX "ReferralAttribution_referrerUserId_idx" ON "ReferralAttribution"("referrerUserId");
CREATE INDEX "ReferralAttribution_merchantId_createdAt_idx" ON "ReferralAttribution"("merchantId", "createdAt");

ALTER TABLE "ReferralAttribution"
    ADD CONSTRAINT "ReferralAttribution_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "MerchantReferralProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralAttribution"
    ADD CONSTRAINT "ReferralAttribution_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralAttribution"
    ADD CONSTRAINT "ReferralAttribution_referrerUserId_fkey"
    FOREIGN KEY ("referrerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAttribution"
    ADD CONSTRAINT "ReferralAttribution_referredUserId_fkey"
    FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
