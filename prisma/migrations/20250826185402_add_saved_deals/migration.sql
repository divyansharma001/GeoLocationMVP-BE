-- DropIndex
DROP INDEX "idx_deals_active_approved_created";

-- DropIndex
DROP INDEX "idx_deals_category";

-- DropIndex
DROP INDEX "idx_deals_category_active";

-- DropIndex
DROP INDEX "idx_deals_category_merchant";

-- DropIndex
DROP INDEX "idx_deals_complex_query";

-- DropIndex
DROP INDEX "idx_deals_description_trgm";

-- DropIndex
DROP INDEX "idx_deals_merchant_id";

-- DropIndex
DROP INDEX "idx_deals_merchant_status_active";

-- DropIndex
DROP INDEX "idx_deals_title_trgm";

-- DropIndex
DROP INDEX "idx_merchant_status";

-- DropIndex
DROP INDEX "idx_merchant_status_coordinates";

-- CreateTable
CREATE TABLE "SavedDeal" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "dealId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedDeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedDeal_userId_dealId_key" ON "SavedDeal"("userId", "dealId");

-- AddForeignKey
ALTER TABLE "SavedDeal" ADD CONSTRAINT "SavedDeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedDeal" ADD CONSTRAINT "SavedDeal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
