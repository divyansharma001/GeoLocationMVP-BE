-- CreateEnum
CREATE TYPE "CheckInGameType" AS ENUM ('SCRATCH_CARD', 'SPIN_WHEEL', 'PICK_A_CARD');

-- CreateEnum
CREATE TYPE "CheckInGameRewardType" AS ENUM ('DISCOUNT_PERCENTAGE', 'DISCOUNT_FIXED', 'FREE_ITEM', 'COINS', 'BONUS_POINTS');

-- CreateEnum
CREATE TYPE "CheckInGameSessionStatus" AS ENUM ('ELIGIBLE', 'PLAYED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CheckInGameRewardStatus" AS ENUM ('AVAILABLE', 'REDEEMED', 'EXPIRED');

-- CreateTable
CREATE TABLE "CheckInGameConfig" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "gameType" "CheckInGameType" NOT NULL DEFAULT 'SCRATCH_CARD',
    "title" TEXT NOT NULL DEFAULT 'Tap to win',
    "subtitle" TEXT,
    "accentColor" TEXT,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 0,
    "maxPlaysPerCheckIn" INTEGER NOT NULL DEFAULT 1,
    "sessionExpiryMinutes" INTEGER NOT NULL DEFAULT 15,
    "rewardExpiryHours" INTEGER NOT NULL DEFAULT 24,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckInGameConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInGameReward" (
    "id" SERIAL NOT NULL,
    "configId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "rewardType" "CheckInGameRewardType" NOT NULL,
    "rewardValue" DOUBLE PRECISION NOT NULL,
    "rewardLabel" TEXT,
    "probabilityWeight" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxWins" INTEGER,
    "currentWins" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckInGameReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInGameSession" (
    "id" SERIAL NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "configId" INTEGER NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "checkInId" INTEGER NOT NULL,
    "gameType" "CheckInGameType" NOT NULL,
    "status" "CheckInGameSessionStatus" NOT NULL DEFAULT 'ELIGIBLE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "playedAt" TIMESTAMP(3),
    "resultSlot" INTEGER,
    "selectedRewardId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckInGameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInGameIssuedReward" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "rewardId" INTEGER NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "dealId" INTEGER,
    "rewardType" "CheckInGameRewardType" NOT NULL,
    "rewardValue" DOUBLE PRECISION NOT NULL,
    "rewardLabel" TEXT,
    "claimCode" TEXT NOT NULL,
    "status" "CheckInGameRewardStatus" NOT NULL DEFAULT 'AVAILABLE',
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckInGameIssuedReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckInGameConfig_merchantId_key" ON "CheckInGameConfig"("merchantId");

-- CreateIndex
CREATE INDEX "CheckInGameConfig_isEnabled_idx" ON "CheckInGameConfig"("isEnabled");

-- CreateIndex
CREATE INDEX "CheckInGameReward_configId_isActive_idx" ON "CheckInGameReward"("configId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CheckInGameSession_sessionToken_key" ON "CheckInGameSession"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "CheckInGameSession_checkInId_key" ON "CheckInGameSession"("checkInId");

-- CreateIndex
CREATE INDEX "CheckInGameSession_userId_createdAt_idx" ON "CheckInGameSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CheckInGameSession_merchantId_createdAt_idx" ON "CheckInGameSession"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "CheckInGameSession_status_expiresAt_idx" ON "CheckInGameSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckInGameIssuedReward_sessionId_key" ON "CheckInGameIssuedReward"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckInGameIssuedReward_claimCode_key" ON "CheckInGameIssuedReward"("claimCode");

-- CreateIndex
CREATE INDEX "CheckInGameIssuedReward_merchantId_createdAt_idx" ON "CheckInGameIssuedReward"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "CheckInGameIssuedReward_userId_status_createdAt_idx" ON "CheckInGameIssuedReward"("userId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "CheckInGameConfig" ADD CONSTRAINT "CheckInGameConfig_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGameReward" ADD CONSTRAINT "CheckInGameReward_configId_fkey" FOREIGN KEY ("configId") REFERENCES "CheckInGameConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGameSession" ADD CONSTRAINT "CheckInGameSession_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGameSession" ADD CONSTRAINT "CheckInGameSession_configId_fkey" FOREIGN KEY ("configId") REFERENCES "CheckInGameConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGameSession" ADD CONSTRAINT "CheckInGameSession_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGameSession" ADD CONSTRAINT "CheckInGameSession_selectedRewardId_fkey" FOREIGN KEY ("selectedRewardId") REFERENCES "CheckInGameReward"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGameSession" ADD CONSTRAINT "CheckInGameSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGameIssuedReward" ADD CONSTRAINT "CheckInGameIssuedReward_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGameIssuedReward" ADD CONSTRAINT "CheckInGameIssuedReward_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGameIssuedReward" ADD CONSTRAINT "CheckInGameIssuedReward_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "CheckInGameReward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGameIssuedReward" ADD CONSTRAINT "CheckInGameIssuedReward_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CheckInGameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInGameIssuedReward" ADD CONSTRAINT "CheckInGameIssuedReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
