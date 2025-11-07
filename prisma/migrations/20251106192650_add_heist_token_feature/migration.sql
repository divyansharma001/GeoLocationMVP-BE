-- CreateEnum
CREATE TYPE "HeistStatus" AS ENUM ('SUCCESS', 'FAILED_COOLDOWN', 'FAILED_TARGET_PROTECTED', 'FAILED_SHIELD', 'FAILED_INSUFFICIENT_POINTS', 'FAILED_INSUFFICIENT_TOKENS', 'FAILED_INVALID_TARGET');

-- CreateEnum
CREATE TYPE "HeistNotificationType" AS ENUM ('HEIST_SUCCESS', 'HEIST_VICTIM', 'TOKEN_EARNED', 'SHIELD_ACTIVATED', 'SHIELD_EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PointEventType" ADD VALUE 'HEIST_GAIN';
ALTER TYPE "PointEventType" ADD VALUE 'HEIST_LOSS';

-- CreateTable
CREATE TABLE "HeistToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "lastEarnedAt" TIMESTAMP(3),
    "lastSpentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeistToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Heist" (
    "id" SERIAL NOT NULL,
    "attackerId" INTEGER NOT NULL,
    "victimId" INTEGER NOT NULL,
    "pointsStolen" INTEGER NOT NULL,
    "victimPointsBefore" INTEGER NOT NULL,
    "victimPointsAfter" INTEGER NOT NULL,
    "attackerPointsBefore" INTEGER NOT NULL,
    "attackerPointsAfter" INTEGER NOT NULL,
    "tokenSpent" BOOLEAN NOT NULL DEFAULT true,
    "status" "HeistStatus" NOT NULL DEFAULT 'SUCCESS',
    "failureReason" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Heist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeistNotification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "heistId" INTEGER,
    "type" "HeistNotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeistNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HeistToken_userId_key" ON "HeistToken"("userId");

-- CreateIndex
CREATE INDEX "HeistToken_userId_idx" ON "HeistToken"("userId");

-- CreateIndex
CREATE INDEX "HeistToken_balance_idx" ON "HeistToken"("balance");

-- CreateIndex
CREATE INDEX "HeistToken_lastSpentAt_idx" ON "HeistToken"("lastSpentAt");

-- CreateIndex
CREATE INDEX "Heist_attackerId_createdAt_idx" ON "Heist"("attackerId", "createdAt");

-- CreateIndex
CREATE INDEX "Heist_victimId_createdAt_idx" ON "Heist"("victimId", "createdAt");

-- CreateIndex
CREATE INDEX "Heist_createdAt_idx" ON "Heist"("createdAt");

-- CreateIndex
CREATE INDEX "Heist_status_idx" ON "Heist"("status");

-- CreateIndex
CREATE INDEX "Heist_attackerId_status_idx" ON "Heist"("attackerId", "status");

-- CreateIndex
CREATE INDEX "Heist_victimId_status_idx" ON "Heist"("victimId", "status");

-- CreateIndex
CREATE INDEX "HeistNotification_userId_read_idx" ON "HeistNotification"("userId", "read");

-- CreateIndex
CREATE INDEX "HeistNotification_userId_createdAt_idx" ON "HeistNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "HeistNotification_createdAt_idx" ON "HeistNotification"("createdAt");

-- CreateIndex
CREATE INDEX "HeistNotification_type_idx" ON "HeistNotification"("type");

-- AddForeignKey
ALTER TABLE "HeistToken" ADD CONSTRAINT "HeistToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Heist" ADD CONSTRAINT "Heist_attacker_fkey" FOREIGN KEY ("attackerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Heist" ADD CONSTRAINT "Heist_victimId_fkey" FOREIGN KEY ("victimId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Heist" ADD CONSTRAINT "Heist_attackerToken_fkey" FOREIGN KEY ("attackerId") REFERENCES "HeistToken"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeistNotification" ADD CONSTRAINT "HeistNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeistNotification" ADD CONSTRAINT "HeistNotification_heistId_fkey" FOREIGN KEY ("heistId") REFERENCES "Heist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
