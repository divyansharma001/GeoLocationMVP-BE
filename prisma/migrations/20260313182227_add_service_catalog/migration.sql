-- CreateEnum
CREATE TYPE "MenuCollectionType" AS ENUM ('STANDARD', 'HAPPY_HOUR', 'SPECIAL');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "MenuCollection" ADD COLUMN     "color" TEXT,
ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "menuType" "MenuCollectionType" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "startTime" TEXT,
ADD COLUMN     "storeId" INTEGER,
ADD COLUMN     "subType" TEXT,
ADD COLUMN     "themeName" TEXT;

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Service" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDescription" VARCHAR(500),
    "serviceType" TEXT NOT NULL,
    "status" "ServiceStatus" NOT NULL DEFAULT 'DRAFT',
    "category" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "coverImageUrl" TEXT,
    "imageGallery" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "advanceBookingDays" INTEGER NOT NULL DEFAULT 30,
    "cancellationHours" INTEGER NOT NULL DEFAULT 24,
    "maxBookingsPerDay" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePricingTier" (
    "id" SERIAL NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "totalSlots" INTEGER,
    "maxPerUser" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceBooking" (
    "id" SERIAL NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "tierId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "bookingDate" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" "ServiceBookingStatus" NOT NULL DEFAULT 'PENDING',
    "confirmationCode" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "notes" TEXT,
    "specialRequests" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCheckIn" (
    "id" SERIAL NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedInBy" INTEGER,
    "checkInMethod" TEXT NOT NULL DEFAULT 'QR_SCAN',
    "notes" TEXT,

    CONSTRAINT "ServiceCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAddOn" (
    "id" SERIAL NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAddOnPurchase" (
    "id" SERIAL NOT NULL,
    "addOnId" INTEGER NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceAddOnPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Service_merchantId_status_idx" ON "Service"("merchantId", "status");

-- CreateIndex
CREATE INDEX "Service_serviceType_status_idx" ON "Service"("serviceType", "status");

-- CreateIndex
CREATE INDEX "Service_status_idx" ON "Service"("status");

-- CreateIndex
CREATE INDEX "Service_merchantId_idx" ON "Service"("merchantId");

-- CreateIndex
CREATE INDEX "ServicePricingTier_serviceId_isActive_idx" ON "ServicePricingTier"("serviceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceBooking_confirmationCode_key" ON "ServiceBooking"("confirmationCode");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceBooking_qrCode_key" ON "ServiceBooking"("qrCode");

-- CreateIndex
CREATE INDEX "ServiceBooking_userId_status_idx" ON "ServiceBooking"("userId", "status");

-- CreateIndex
CREATE INDEX "ServiceBooking_serviceId_bookingDate_idx" ON "ServiceBooking"("serviceId", "bookingDate");

-- CreateIndex
CREATE INDEX "ServiceBooking_merchantId_bookingDate_idx" ON "ServiceBooking"("merchantId", "bookingDate");

-- CreateIndex
CREATE INDEX "ServiceBooking_confirmationCode_idx" ON "ServiceBooking"("confirmationCode");

-- CreateIndex
CREATE INDEX "ServiceBooking_qrCode_idx" ON "ServiceBooking"("qrCode");

-- CreateIndex
CREATE INDEX "ServiceBooking_status_idx" ON "ServiceBooking"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCheckIn_bookingId_key" ON "ServiceCheckIn"("bookingId");

-- CreateIndex
CREATE INDEX "ServiceCheckIn_serviceId_checkedInAt_idx" ON "ServiceCheckIn"("serviceId", "checkedInAt");

-- CreateIndex
CREATE INDEX "ServiceCheckIn_userId_idx" ON "ServiceCheckIn"("userId");

-- CreateIndex
CREATE INDEX "ServiceAddOn_serviceId_isActive_idx" ON "ServiceAddOn"("serviceId", "isActive");

-- CreateIndex
CREATE INDEX "ServiceAddOnPurchase_bookingId_idx" ON "ServiceAddOnPurchase"("bookingId");

-- CreateIndex
CREATE INDEX "ServiceAddOnPurchase_addOnId_idx" ON "ServiceAddOnPurchase"("addOnId");

-- CreateIndex
CREATE INDEX "ServiceAddOnPurchase_userId_idx" ON "ServiceAddOnPurchase"("userId");

-- CreateIndex
CREATE INDEX "MenuCollection_merchantId_menuType_idx" ON "MenuCollection"("merchantId", "menuType");

-- CreateIndex
CREATE INDEX "MenuCollection_storeId_idx" ON "MenuCollection"("storeId");

-- AddForeignKey
ALTER TABLE "MenuCollection" ADD CONSTRAINT "MenuCollection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePricingTier" ADD CONSTRAINT "ServicePricingTier_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "ServicePricingTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCheckIn" ADD CONSTRAINT "ServiceCheckIn_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCheckIn" ADD CONSTRAINT "ServiceCheckIn_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ServiceBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAddOn" ADD CONSTRAINT "ServiceAddOn_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAddOnPurchase" ADD CONSTRAINT "ServiceAddOnPurchase_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "ServiceAddOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAddOnPurchase" ADD CONSTRAINT "ServiceAddOnPurchase_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ServiceBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAddOnPurchase" ADD CONSTRAINT "ServiceAddOnPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
