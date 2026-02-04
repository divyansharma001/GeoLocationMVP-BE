-- CreateEnum
CREATE TYPE "SocialProvider" AS ENUM ('GOOGLE', 'FACEBOOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('PARTY', 'BAR_CRAWL', 'SPORTS_TOURNAMENT', 'FESTIVAL', 'RSVP_EVENT', 'WAGBT');

-- CreateEnum
CREATE TYPE "TicketTier" AS ENUM ('GENERAL_ADMISSION', 'VIP', 'PREMIUM', 'EARLY_BIRD', 'ALL_ACCESS', 'DAY_PASS');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "AttendeeType" AS ENUM ('TICKET_HOLDER', 'RSVP', 'WAITLIST', 'ORGANIZER', 'VENDOR', 'VIP_GUEST');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentPurpose" ADD VALUE 'EVENT_TICKET';
ALTER TYPE "PaymentPurpose" ADD VALUE 'EVENT_ADDON';
ALTER TYPE "PaymentPurpose" ADD VALUE 'EVENT_VENDOR_FEE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'EVENT_ORGANIZER';
ALTER TYPE "UserRole" ADD VALUE 'VENDOR';
ALTER TYPE "UserRole" ADD VALUE 'EVENT_OWNER';
ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ALTER COLUMN "password" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" SERIAL NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "profile" JSONB,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDescription" VARCHAR(500),
    "eventType" "EventType" NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "organizerId" INTEGER NOT NULL,
    "merchantId" INTEGER,
    "venueName" TEXT,
    "venueAddress" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "cityId" INTEGER,
    "isVirtualEvent" BOOLEAN NOT NULL DEFAULT false,
    "virtualEventUrl" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "isMultiDay" BOOLEAN NOT NULL DEFAULT false,
    "maxAttendees" INTEGER,
    "currentAttendees" INTEGER NOT NULL DEFAULT 0,
    "enableWaitlist" BOOLEAN NOT NULL DEFAULT false,
    "waitlistCapacity" INTEGER,
    "isFreeEvent" BOOLEAN NOT NULL DEFAULT false,
    "enablePresale" BOOLEAN NOT NULL DEFAULT false,
    "presaleStartDate" TIMESTAMP(3),
    "presaleEndDate" TIMESTAMP(3),
    "coverImageUrl" TEXT,
    "imageGallery" TEXT[],
    "videoUrl" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "accessCode" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "minAge" INTEGER,
    "ageVerificationReq" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[],
    "categoryId" INTEGER,
    "socialProofCount" INTEGER NOT NULL DEFAULT 0,
    "trendingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTicketTier" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tier" "TicketTier" NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "serviceFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalQuantity" INTEGER NOT NULL,
    "soldQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "minPerOrder" INTEGER NOT NULL DEFAULT 1,
    "maxPerOrder" INTEGER NOT NULL DEFAULT 10,
    "maxPerUser" INTEGER,
    "isPresaleOnly" BOOLEAN NOT NULL DEFAULT false,
    "presaleCode" TEXT,
    "validDates" TIMESTAMP(3)[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "salesStartDate" TIMESTAMP(3),
    "salesEndDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTicketTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTicket" (
    "id" SERIAL NOT NULL,
    "ticketTierId" INTEGER NOT NULL,
    "eventId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'RESERVED',
    "purchasePrice" DOUBLE PRECISION NOT NULL,
    "paymentTransactionId" INTEGER,
    "purchasedAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "checkedInBy" INTEGER,
    "originalOwnerId" INTEGER NOT NULL,
    "transferredAt" TIMESTAMP(3),
    "transferredTo" INTEGER,
    "refundedAt" TIMESTAMP(3),
    "refundAmount" DOUBLE PRECISION,
    "refundReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAttendee" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "attendeeType" "AttendeeType" NOT NULL DEFAULT 'TICKET_HOLDER',
    "rsvpStatus" TEXT,
    "rsvpedAt" TIMESTAMP(3),
    "waitlistPosition" INTEGER,
    "waitlistJoinedAt" TIMESTAMP(3),
    "waitlistApprovedAt" TIMESTAMP(3),
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "guestNames" JSONB,
    "dietaryRestrictions" TEXT,
    "accessibilityNeeds" TEXT,
    "specialRequests" TEXT,
    "smsNotifications" BOOLEAN NOT NULL DEFAULT false,
    "phoneNumber" TEXT,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCheckIn" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "ticketId" INTEGER,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedInBy" INTEGER,
    "checkInMethod" TEXT NOT NULL DEFAULT 'QR_SCAN',
    "locationName" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "EventCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAddOn" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT true,
    "totalQuantity" INTEGER,
    "soldQuantity" INTEGER NOT NULL DEFAULT 0,
    "maxPerUser" INTEGER NOT NULL DEFAULT 1,
    "availableFrom" TIMESTAMP(3),
    "availableUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAddOnPurchase" (
    "id" SERIAL NOT NULL,
    "addOnId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "ticketId" INTEGER,
    "paymentTransactionId" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAddOnPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccount_userId_provider_idx" ON "SocialAccount"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_provider_providerUserId_key" ON "SocialAccount"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_accessCode_key" ON "Event"("accessCode");

-- CreateIndex
CREATE INDEX "Event_organizerId_status_idx" ON "Event"("organizerId", "status");

-- CreateIndex
CREATE INDEX "Event_eventType_status_idx" ON "Event"("eventType", "status");

-- CreateIndex
CREATE INDEX "Event_startDate_status_idx" ON "Event"("startDate", "status");

-- CreateIndex
CREATE INDEX "Event_cityId_startDate_idx" ON "Event"("cityId", "startDate");

-- CreateIndex
CREATE INDEX "Event_status_publishedAt_idx" ON "Event"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Event_trendingScore_idx" ON "Event"("trendingScore");

-- CreateIndex
CREATE INDEX "Event_accessCode_idx" ON "Event"("accessCode");

-- CreateIndex
CREATE INDEX "EventTicketTier_eventId_isActive_idx" ON "EventTicketTier"("eventId", "isActive");

-- CreateIndex
CREATE INDEX "EventTicketTier_eventId_tier_idx" ON "EventTicketTier"("eventId", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "EventTicket_ticketNumber_key" ON "EventTicket"("ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EventTicket_qrCode_key" ON "EventTicket"("qrCode");

-- CreateIndex
CREATE INDEX "EventTicket_userId_status_idx" ON "EventTicket"("userId", "status");

-- CreateIndex
CREATE INDEX "EventTicket_eventId_status_idx" ON "EventTicket"("eventId", "status");

-- CreateIndex
CREATE INDEX "EventTicket_ticketNumber_idx" ON "EventTicket"("ticketNumber");

-- CreateIndex
CREATE INDEX "EventTicket_qrCode_idx" ON "EventTicket"("qrCode");

-- CreateIndex
CREATE INDEX "EventTicket_paymentTransactionId_idx" ON "EventTicket"("paymentTransactionId");

-- CreateIndex
CREATE INDEX "EventAttendee_eventId_attendeeType_idx" ON "EventAttendee"("eventId", "attendeeType");

-- CreateIndex
CREATE INDEX "EventAttendee_userId_idx" ON "EventAttendee"("userId");

-- CreateIndex
CREATE INDEX "EventAttendee_waitlistPosition_idx" ON "EventAttendee"("waitlistPosition");

-- CreateIndex
CREATE UNIQUE INDEX "EventAttendee_eventId_userId_key" ON "EventAttendee"("eventId", "userId");

-- CreateIndex
CREATE INDEX "EventCheckIn_eventId_checkedInAt_idx" ON "EventCheckIn"("eventId", "checkedInAt");

-- CreateIndex
CREATE INDEX "EventCheckIn_userId_idx" ON "EventCheckIn"("userId");

-- CreateIndex
CREATE INDEX "EventCheckIn_ticketId_idx" ON "EventCheckIn"("ticketId");

-- CreateIndex
CREATE INDEX "EventAddOn_eventId_isActive_idx" ON "EventAddOn"("eventId", "isActive");

-- CreateIndex
CREATE INDEX "EventAddOn_category_idx" ON "EventAddOn"("category");

-- CreateIndex
CREATE INDEX "EventAddOnPurchase_addOnId_idx" ON "EventAddOnPurchase"("addOnId");

-- CreateIndex
CREATE INDEX "EventAddOnPurchase_userId_idx" ON "EventAddOnPurchase"("userId");

-- CreateIndex
CREATE INDEX "EventAddOnPurchase_paymentTransactionId_idx" ON "EventAddOnPurchase"("paymentTransactionId");

-- CreateIndex
CREATE INDEX "Booking_tableId_bookingDate_status_idx" ON "Booking"("tableId", "bookingDate", "status");

-- CreateIndex
CREATE INDEX "Heist_attackerId_victimId_idx" ON "Heist"("attackerId", "victimId");

-- CreateIndex
CREATE INDEX "UserPointEvent_pointEventTypeId_createdAt_idx" ON "UserPointEvent"("pointEventTypeId", "createdAt");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicketTier" ADD CONSTRAINT "EventTicketTier_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicket" ADD CONSTRAINT "EventTicket_ticketTierId_fkey" FOREIGN KEY ("ticketTierId") REFERENCES "EventTicketTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicket" ADD CONSTRAINT "EventTicket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicket" ADD CONSTRAINT "EventTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicket" ADD CONSTRAINT "EventTicket_originalOwnerId_fkey" FOREIGN KEY ("originalOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicket" ADD CONSTRAINT "EventTicket_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCheckIn" ADD CONSTRAINT "EventCheckIn_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCheckIn" ADD CONSTRAINT "EventCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCheckIn" ADD CONSTRAINT "EventCheckIn_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "EventTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAddOn" ADD CONSTRAINT "EventAddOn_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAddOnPurchase" ADD CONSTRAINT "EventAddOnPurchase_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "EventAddOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAddOnPurchase" ADD CONSTRAINT "EventAddOnPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAddOnPurchase" ADD CONSTRAINT "EventAddOnPurchase_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "EventTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAddOnPurchase" ADD CONSTRAINT "EventAddOnPurchase_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
