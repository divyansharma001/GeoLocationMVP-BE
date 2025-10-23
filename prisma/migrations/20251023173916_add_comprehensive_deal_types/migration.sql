-- CreateEnum
CREATE TYPE "MenuDealType" AS ENUM ('HAPPY_HOUR_BOUNTY', 'HAPPY_HOUR_SURPRISE', 'HAPPY_HOUR_LATE_NIGHT', 'HAPPY_HOUR_MID_DAY', 'HAPPY_HOUR_MORNINGS', 'REDEEM_NOW_BOUNTY', 'REDEEM_NOW_SURPRISE', 'STANDARD', 'RECURRING');

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "dealType" "MenuDealType" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "isSurprise" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "surpriseRevealTime" TEXT,
ADD COLUMN     "validDays" TEXT,
ADD COLUMN     "validEndTime" TEXT,
ADD COLUMN     "validStartTime" TEXT;

-- CreateIndex
CREATE INDEX "MenuItem_merchantId_dealType_idx" ON "MenuItem"("merchantId", "dealType");

-- CreateIndex
CREATE INDEX "MenuItem_dealType_idx" ON "MenuItem"("dealType");
