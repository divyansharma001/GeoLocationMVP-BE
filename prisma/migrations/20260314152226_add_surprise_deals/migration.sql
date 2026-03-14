-- CreateEnum
CREATE TYPE "SurpriseType" AS ENUM ('LOCATION_BASED', 'TIME_BASED', 'ENGAGEMENT_BASED', 'RANDOM_DROP');

-- AlterEnum
ALTER TYPE "NudgeType" ADD VALUE 'SURPRISE_NEARBY';

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "isSurprise" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revealAt" TIMESTAMP(3),
ADD COLUMN     "revealDurationMinutes" INTEGER DEFAULT 60,
ADD COLUMN     "revealRadiusMeters" INTEGER,
ADD COLUMN     "surpriseHint" TEXT,
ADD COLUMN     "surpriseSlotsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "surpriseTotalSlots" INTEGER,
ADD COLUMN     "surpriseType" "SurpriseType";

-- AlterTable
ALTER TABLE "UserNudgePreferences" ADD COLUMN     "surpriseNearbyEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "UserSurpriseReveal" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "dealId" INTEGER NOT NULL,
    "revealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemed" BOOLEAN NOT NULL DEFAULT false,
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "UserSurpriseReveal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserSurpriseReveal_userId_idx" ON "UserSurpriseReveal"("userId");

-- CreateIndex
CREATE INDEX "UserSurpriseReveal_dealId_idx" ON "UserSurpriseReveal"("dealId");

-- CreateIndex
CREATE INDEX "UserSurpriseReveal_expiresAt_idx" ON "UserSurpriseReveal"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSurpriseReveal_userId_dealId_key" ON "UserSurpriseReveal"("userId", "dealId");

-- CreateIndex
CREATE INDEX "Deal_isSurprise_surpriseType_endTime_idx" ON "Deal"("isSurprise", "surpriseType", "endTime");

-- AddForeignKey
ALTER TABLE "UserSurpriseReveal" ADD CONSTRAINT "UserSurpriseReveal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSurpriseReveal" ADD CONSTRAINT "UserSurpriseReveal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
