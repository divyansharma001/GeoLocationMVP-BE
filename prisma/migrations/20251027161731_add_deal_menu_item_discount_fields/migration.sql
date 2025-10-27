-- AlterTable
ALTER TABLE "DealMenuItem" ADD COLUMN     "customDiscount" DOUBLE PRECISION,
ADD COLUMN     "customPrice" DOUBLE PRECISION,
ADD COLUMN     "discountAmount" DOUBLE PRECISION,
ADD COLUMN     "useGlobalDiscount" BOOLEAN NOT NULL DEFAULT true;
