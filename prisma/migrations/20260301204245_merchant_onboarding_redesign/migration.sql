-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "categoryId" INTEGER,
ADD COLUMN     "facebookUrl" TEXT,
ADD COLUMN     "galleryUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "priceRange" TEXT,
ADD COLUMN     "twitterUrl" TEXT,
ADD COLUMN     "websiteUrl" TEXT,
ALTER COLUMN "address" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "description" TEXT,
ADD COLUMN     "galleryUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isFoodTruck" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "operatingHours" JSONB;

-- AddForeignKey
ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DealCategoryMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
