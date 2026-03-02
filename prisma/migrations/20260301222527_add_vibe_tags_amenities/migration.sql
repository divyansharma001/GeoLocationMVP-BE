-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "thingsToNote" TEXT,
ADD COLUMN     "vibeTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
