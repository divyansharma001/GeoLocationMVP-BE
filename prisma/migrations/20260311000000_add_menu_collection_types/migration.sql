-- CreateEnum
CREATE TYPE "MenuCollectionType" AS ENUM ('STANDARD', 'HAPPY_HOUR', 'SPECIAL');

-- AlterTable
ALTER TABLE "MenuCollection" ADD COLUMN "menuType" "MenuCollectionType" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "MenuCollection" ADD COLUMN "subType" TEXT;
ALTER TABLE "MenuCollection" ADD COLUMN "startTime" TEXT;
ALTER TABLE "MenuCollection" ADD COLUMN "endTime" TEXT;
ALTER TABLE "MenuCollection" ADD COLUMN "themeName" TEXT;
ALTER TABLE "MenuCollection" ADD COLUMN "icon" TEXT;
ALTER TABLE "MenuCollection" ADD COLUMN "color" TEXT;

-- CreateIndex
CREATE INDEX "MenuCollection_merchantId_menuType_idx" ON "MenuCollection"("merchantId", "menuType");
