-- CreateEnum
CREATE TYPE "NudgeType" AS ENUM ('INACTIVITY', 'NEARBY_DEAL', 'STREAK_REMINDER', 'HAPPY_HOUR_ALERT', 'WEATHER_BASED');

-- CreateEnum
CREATE TYPE "NudgeFrequency" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'UNLIMITED');

-- CreateTable
CREATE TABLE "Nudge" (
    "id" SERIAL NOT NULL,
    "type" "NudgeType" NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "triggerCondition" JSONB NOT NULL,
    "frequency" "NudgeFrequency" NOT NULL DEFAULT 'WEEKLY',
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "activeStartTime" TIMESTAMP(3),
    "activeEndTime" TIMESTAMP(3),
    "timeWindowStart" TEXT,
    "timeWindowEnd" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" INTEGER,

    CONSTRAINT "Nudge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNudge" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "nudgeId" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredVia" VARCHAR(20) NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "opened" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3),
    "clicked" BOOLEAN NOT NULL DEFAULT false,
    "clickedAt" TIMESTAMP(3),
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "contextData" JSONB,

    CONSTRAINT "UserNudge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNudgePreferences" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "inactivityEnabled" BOOLEAN NOT NULL DEFAULT true,
    "nearbyDealEnabled" BOOLEAN NOT NULL DEFAULT true,
    "streakReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "happyHourAlertEnabled" BOOLEAN NOT NULL DEFAULT true,
    "weatherBasedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNudgePreferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Nudge_active_type_idx" ON "Nudge"("active", "type");

-- CreateIndex
CREATE INDEX "Nudge_priority_idx" ON "Nudge"("priority");

-- CreateIndex
CREATE INDEX "UserNudge_userId_sentAt_idx" ON "UserNudge"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "UserNudge_nudgeId_sentAt_idx" ON "UserNudge"("nudgeId", "sentAt");

-- CreateIndex
CREATE INDEX "UserNudge_userId_nudgeId_sentAt_idx" ON "UserNudge"("userId", "nudgeId", "sentAt");

-- CreateIndex
CREATE INDEX "UserNudge_opened_clicked_idx" ON "UserNudge"("opened", "clicked");

-- CreateIndex
CREATE UNIQUE INDEX "UserNudgePreferences_userId_key" ON "UserNudgePreferences"("userId");

-- CreateIndex
CREATE INDEX "UserNudgePreferences_userId_enabled_idx" ON "UserNudgePreferences"("userId", "enabled");

-- AddForeignKey
ALTER TABLE "UserNudge" ADD CONSTRAINT "UserNudge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNudge" ADD CONSTRAINT "UserNudge_nudgeId_fkey" FOREIGN KEY ("nudgeId") REFERENCES "Nudge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNudgePreferences" ADD CONSTRAINT "UserNudgePreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
