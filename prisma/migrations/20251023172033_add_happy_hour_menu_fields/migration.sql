-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "happyHourPrice" DOUBLE PRECISION,
ADD COLUMN     "isHappyHour" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "MenuItem_merchantId_isHappyHour_idx" ON "MenuItem"("merchantId", "isHappyHour");
