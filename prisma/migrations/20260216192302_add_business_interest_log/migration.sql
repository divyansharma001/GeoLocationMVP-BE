-- CreateEnum
CREATE TYPE "KittyGameStatus" AS ENUM ('PENDING', 'ACTIVE', 'CLOSED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VenueRewardStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VenueRewardType" AS ENUM ('COINS', 'DISCOUNT_PERCENTAGE', 'DISCOUNT_FIXED', 'BONUS_POINTS', 'FREE_ITEM');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'DOCUMENTS_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VerificationStepType" AS ENUM ('IDENTITY', 'BUSINESS_LICENSE', 'ADDRESS_PROOF', 'TAX_DOCUMENT');

-- CreateEnum
CREATE TYPE "ClaimVerificationMethod" AS ENUM ('GPS', 'QR_CODE');

-- CreateTable
CREATE TABLE "BountyProgress" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "dealId" INTEGER NOT NULL,
    "referralCount" INTEGER NOT NULL DEFAULT 0,
    "rewardsEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "qrCodeScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BountyProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KittyGame" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "prizePool" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "entryFee" INTEGER NOT NULL DEFAULT 10,
    "secretValue" DOUBLE PRECISION,
    "guessWindowStart" TIMESTAMP(3) NOT NULL,
    "guessWindowEnd" TIMESTAMP(3) NOT NULL,
    "status" "KittyGameStatus" NOT NULL DEFAULT 'PENDING',
    "winnerId" INTEGER,
    "winnerGuessId" INTEGER,
    "minPlayers" INTEGER NOT NULL DEFAULT 2,
    "maxPlayers" INTEGER,
    "createdBy" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KittyGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KittyGuess" (
    "id" SERIAL NOT NULL,
    "gameId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "guessValue" DOUBLE PRECISION NOT NULL,
    "coinsSpent" INTEGER NOT NULL DEFAULT 0,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KittyGuess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueReward" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "storeId" INTEGER,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "rewardType" "VenueRewardType" NOT NULL DEFAULT 'COINS',
    "rewardAmount" DOUBLE PRECISION NOT NULL,
    "geoFenceRadiusMeters" INTEGER NOT NULL DEFAULT 100,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" "VenueRewardStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "maxTotalClaims" INTEGER,
    "currentClaims" INTEGER NOT NULL DEFAULT 0,
    "maxClaimsPerUser" INTEGER NOT NULL DEFAULT 1,
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "requiresCheckIn" BOOLEAN NOT NULL DEFAULT true,
    "isVerifiedOnly" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueRewardClaim" (
    "id" SERIAL NOT NULL,
    "venueRewardId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "claimLatitude" DOUBLE PRECISION NOT NULL,
    "claimLongitude" DOUBLE PRECISION NOT NULL,
    "distanceMeters" DOUBLE PRECISION NOT NULL,
    "verificationMethod" "ClaimVerificationMethod" NOT NULL DEFAULT 'GPS',
    "coinsAwarded" INTEGER NOT NULL DEFAULT 0,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "rewardValue" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueRewardClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantVerification" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "stepType" "VerificationStepType" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "documentUrl" TEXT,
    "documentType" VARCHAR(100),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" INTEGER,
    "rejectionReason" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessInterestLog" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "userId" INTEGER,
    "eventType" VARCHAR(50) NOT NULL,
    "dealId" INTEGER,
    "venueRewardId" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessInterestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BountyProgress_userId_idx" ON "BountyProgress"("userId");

-- CreateIndex
CREATE INDEX "BountyProgress_dealId_idx" ON "BountyProgress"("dealId");

-- CreateIndex
CREATE INDEX "BountyProgress_isCompleted_idx" ON "BountyProgress"("isCompleted");

-- CreateIndex
CREATE UNIQUE INDEX "BountyProgress_userId_dealId_key" ON "BountyProgress"("userId", "dealId");

-- CreateIndex
CREATE INDEX "KittyGame_merchantId_status_idx" ON "KittyGame"("merchantId", "status");

-- CreateIndex
CREATE INDEX "KittyGame_status_idx" ON "KittyGame"("status");

-- CreateIndex
CREATE INDEX "KittyGame_guessWindowEnd_idx" ON "KittyGame"("guessWindowEnd");

-- CreateIndex
CREATE INDEX "KittyGame_winnerId_idx" ON "KittyGame"("winnerId");

-- CreateIndex
CREATE INDEX "KittyGuess_gameId_idx" ON "KittyGuess"("gameId");

-- CreateIndex
CREATE INDEX "KittyGuess_userId_idx" ON "KittyGuess"("userId");

-- CreateIndex
CREATE INDEX "KittyGuess_isWinner_idx" ON "KittyGuess"("isWinner");

-- CreateIndex
CREATE UNIQUE INDEX "KittyGuess_gameId_userId_key" ON "KittyGuess"("gameId", "userId");

-- CreateIndex
CREATE INDEX "VenueReward_merchantId_status_idx" ON "VenueReward"("merchantId", "status");

-- CreateIndex
CREATE INDEX "VenueReward_status_startDate_endDate_idx" ON "VenueReward"("status", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "VenueReward_merchantId_storeId_idx" ON "VenueReward"("merchantId", "storeId");

-- CreateIndex
CREATE INDEX "VenueRewardClaim_userId_venueRewardId_createdAt_idx" ON "VenueRewardClaim"("userId", "venueRewardId", "createdAt");

-- CreateIndex
CREATE INDEX "VenueRewardClaim_venueRewardId_createdAt_idx" ON "VenueRewardClaim"("venueRewardId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantVerification_merchantId_status_idx" ON "MerchantVerification"("merchantId", "status");

-- CreateIndex
CREATE INDEX "MerchantVerification_status_idx" ON "MerchantVerification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantVerification_merchantId_stepType_key" ON "MerchantVerification"("merchantId", "stepType");

-- CreateIndex
CREATE INDEX "BusinessInterestLog_merchantId_eventType_createdAt_idx" ON "BusinessInterestLog"("merchantId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessInterestLog_merchantId_createdAt_idx" ON "BusinessInterestLog"("merchantId", "createdAt");

-- AddForeignKey
ALTER TABLE "BountyProgress" ADD CONSTRAINT "BountyProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BountyProgress" ADD CONSTRAINT "BountyProgress_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittyGame" ADD CONSTRAINT "KittyGame_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittyGame" ADD CONSTRAINT "KittyGame_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittyGame" ADD CONSTRAINT "KittyGame_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittyGuess" ADD CONSTRAINT "KittyGuess_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "KittyGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittyGuess" ADD CONSTRAINT "KittyGuess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueReward" ADD CONSTRAINT "VenueReward_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueReward" ADD CONSTRAINT "VenueReward_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueRewardClaim" ADD CONSTRAINT "VenueRewardClaim_venueRewardId_fkey" FOREIGN KEY ("venueRewardId") REFERENCES "VenueReward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueRewardClaim" ADD CONSTRAINT "VenueRewardClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantVerification" ADD CONSTRAINT "MerchantVerification_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessInterestLog" ADD CONSTRAINT "BusinessInterestLog_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
