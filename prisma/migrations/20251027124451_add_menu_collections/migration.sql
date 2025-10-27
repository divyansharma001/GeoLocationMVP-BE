-- CreateTable
CREATE TABLE "MenuCollection" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuCollectionItem" (
    "collectionId" INTEGER NOT NULL,
    "menuItemId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "customPrice" DOUBLE PRECISION,
    "customDiscount" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuCollectionItem_pkey" PRIMARY KEY ("collectionId","menuItemId")
);

-- CreateIndex
CREATE INDEX "MenuCollection_merchantId_idx" ON "MenuCollection"("merchantId");

-- CreateIndex
CREATE INDEX "MenuCollection_merchantId_isActive_idx" ON "MenuCollection"("merchantId", "isActive");

-- CreateIndex
CREATE INDEX "MenuCollection_name_idx" ON "MenuCollection"("name");

-- CreateIndex
CREATE INDEX "MenuCollectionItem_collectionId_idx" ON "MenuCollectionItem"("collectionId");

-- CreateIndex
CREATE INDEX "MenuCollectionItem_menuItemId_idx" ON "MenuCollectionItem"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuCollectionItem_collectionId_sortOrder_idx" ON "MenuCollectionItem"("collectionId", "sortOrder");

-- AddForeignKey
ALTER TABLE "MenuCollection" ADD CONSTRAINT "MenuCollection_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCollectionItem" ADD CONSTRAINT "MenuCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MenuCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCollectionItem" ADD CONSTRAINT "MenuCollectionItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
