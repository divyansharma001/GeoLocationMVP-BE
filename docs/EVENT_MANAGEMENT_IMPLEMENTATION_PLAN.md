# Event Management System - Comprehensive Implementation Plan

## Executive Summary
This document provides a phased implementation plan for integrating a comprehensive Event Management System into the existing Express.js + Prisma + PostgreSQL backend. The system supports multiple event types, ticketing, vendor marketplace, add-ons, and integrates with existing payment, loyalty, and gamification systems.

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Phase 1: MVP Foundation](#phase-1-mvp-foundation)
3. [Phase 2: Advanced Features](#phase-2-advanced-features)
4. [Phase 3: Vendor Marketplace](#phase-3-vendor-marketplace)
5. [Phase 4: Advanced Event Types](#phase-4-advanced-event-types)
6. [Database Schema](#database-schema)
7. [API Endpoints](#api-endpoints)
8. [Middleware & Authorization](#middleware--authorization)
9. [Integration Points](#integration-points)
10. [Performance & Scalability](#performance--scalability)

---

## Architecture Overview

### System Components
```
┌─────────────────────────────────────────────────────────┐
│                    EVENT MANAGEMENT                      │
├──────────────┬──────────────┬──────────────┬────────────┤
│   Events     │   Tickets    │   Vendors    │  Add-ons   │
├──────────────┼──────────────┼──────────────┼────────────┤
│  Organizers  │  Attendees   │  Analytics   │   QR Gen   │
└──────────────┴──────────────┴──────────────┴────────────┘
         ▼               ▼              ▼
┌─────────────────────────────────────────────────────────┐
│              EXISTING INFRASTRUCTURE                     │
├──────────────┬──────────────┬──────────────┬────────────┤
│   Payment    │   Loyalty    │ Gamification │    Auth    │
│   (PayPal)   │   (Points)   │   (Points)   │   (JWT)    │
└──────────────┴──────────────┴──────────────┴────────────┘
```

### Key Design Principles
- **Leverage Existing Systems**: Reuse PaymentTransaction, User, Merchant models
- **Role Extension**: Add EVENT_ORGANIZER, VENDOR to UserRole enum
- **Payment Integration**: Use existing PaymentPurpose enum with new values
- **Gradual Rollout**: MVP first, then complex features
- **Backwards Compatible**: No breaking changes to existing APIs

---

## Phase 1: MVP Foundation
**Timeline**: 3-4 weeks  
**Goal**: Basic event creation, ticket sales, and attendee management

### 1.1 Database Schema (MVP)

#### New Enums
```prisma
enum EventStatus {
  DRAFT           // Being created
  PUBLISHED       // Live, accepting registrations
  CANCELLED       // Cancelled by organizer
  COMPLETED       // Event has ended
  SOLD_OUT        // All tickets sold
}

enum EventType {
  PARTY           // House party, club event
  BAR_CRAWL       // Multi-location bar crawl
  SPORTS_TOURNAMENT // Tournament with teams
  FESTIVAL        // Multi-day festival
  RSVP_EVENT      // Free RSVP tracking
  WAGBT           // "We're All Going To Be There"
}

enum TicketTier {
  GENERAL_ADMISSION
  VIP
  PREMIUM
  EARLY_BIRD
  ALL_ACCESS      // For multi-day events
  DAY_PASS        // Single day of multi-day event
}

enum TicketStatus {
  RESERVED        // In cart, not paid
  CONFIRMED       // Payment completed
  CHECKED_IN      // QR code scanned at entrance
  CANCELLED       // Refunded/cancelled
  TRANSFERRED     // Transferred to another user
}

enum AttendeeType {
  TICKET_HOLDER   // Paid ticket
  RSVP            // Free RSVP
  WAITLIST        // On waitlist
  ORGANIZER       // Event organizer
  VENDOR          // Vendor participant
  VIP_GUEST       // Comped/invited
}
```

#### Core Models
```prisma
model Event {
  id                  Int                 @id @default(autoincrement())
  title               String
  description         String              @db.Text
  shortDescription    String?             @db.VarChar(500)
  
  // Event Type & Status
  eventType           EventType
  status              EventStatus         @default(DRAFT)
  
  // Organizer Information
  organizerId         Int                 // User who created event
  merchantId          Int?                // Optional: if merchant-hosted
  
  // Location & Venue
  venueName           String?
  venueAddress        String?
  latitude            Float?
  longitude           Float?
  cityId              Int?                // Link to City model
  isVirtualEvent      Boolean             @default(false)
  virtualEventUrl     String?
  
  // Date & Time
  startDate           DateTime
  endDate             DateTime
  timezone            String              @default("America/New_York")
  isMultiDay          Boolean             @default(false)
  
  // Capacity & Registration
  maxAttendees        Int?                // null = unlimited
  currentAttendees    Int                 @default(0)
  enableWaitlist      Boolean             @default(false)
  waitlistCapacity    Int?
  
  // Ticketing
  isFreeEvent         Boolean             @default(false)
  enablePresale       Boolean             @default(false)
  presaleStartDate    DateTime?
  presaleEndDate      DateTime?
  
  // Media
  coverImageUrl       String?
  imageGallery        String[]            // Array of image URLs
  videoUrl            String?
  
  // Privacy & Access
  isPrivate           Boolean             @default(false)
  accessCode          String?             @unique // For private/hidden events
  requiresApproval    Boolean             @default(false) // Manual approval for RSVPs
  
  // Age Restrictions
  minAge              Int?
  ageVerificationReq  Boolean             @default(false)
  
  // Additional Info
  tags                String[]            // ["nightlife", "sports", "music"]
  categoryId          Int?                // Link to EventCategory if needed
  
  // WAGBT Specific
  socialProofCount    Int                 @default(0) // "X people are going"
  trendingScore       Float               @default(0) // Algorithm score
  
  // Timestamps
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  publishedAt         DateTime?
  cancelledAt         DateTime?
  
  // Relations
  organizer           User                @relation("EventOrganizer", fields: [organizerId], references: [id])
  merchant            Merchant?           @relation(fields: [merchantId], references: [id])
  city                City?               @relation(fields: [cityId], references: [id])
  
  ticketTiers         EventTicketTier[]
  attendees           EventAttendee[]
  addOns              EventAddOn[]
  schedules           EventSchedule[]     // For multi-day/bar crawl routes
  checkIns            EventCheckIn[]
  analytics           EventAnalytics?
  
  @@index([organizerId, status])
  @@index([eventType, status])
  @@index([startDate, status])
  @@index([cityId, startDate])
  @@index([status, publishedAt])
  @@index([trendingScore]) // For WAGBT events
  @@index([accessCode])
}

model EventTicketTier {
  id                  Int                 @id @default(autoincrement())
  eventId             Int
  name                String              // "General Admission", "VIP"
  description         String?
  tier                TicketTier
  
  // Pricing
  price               Float
  serviceFee          Float               @default(0) // Platform fee
  taxRate             Float               @default(0)
  
  // Inventory
  totalQuantity       Int                 // Total tickets available
  soldQuantity        Int                 @default(0)
  reservedQuantity    Int                 @default(0) // In carts
  
  // Purchase Limits
  minPerOrder         Int                 @default(1)
  maxPerOrder         Int                 @default(10)
  maxPerUser          Int?                // Limit per user (fraud prevention)
  
  // Presale
  isPresaleOnly       Boolean             @default(false)
  presaleCode         String?
  
  // Validity (for multi-day)
  validDates          DateTime[]          // Which days this tier is valid for
  
  // Status
  isActive            Boolean             @default(true)
  salesStartDate      DateTime?
  salesEndDate        DateTime?
  
  // Timestamps
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  
  // Relations
  event               Event               @relation(fields: [eventId], references: [id], onDelete: Cascade)
  tickets             EventTicket[]
  
  @@index([eventId, isActive])
  @@index([eventId, tier])
}

model EventTicket {
  id                  Int                 @id @default(autoincrement())
  ticketTierId        Int
  eventId             Int
  userId              Int                 // Ticket holder
  
  // Ticket Details
  ticketNumber        String              @unique // "EVT-2026-001234"
  qrCode              String              @unique // QR code data for check-in
  status              TicketStatus        @default(RESERVED)
  
  // Purchase Info
  purchasePrice       Float               // Actual price paid (includes fees)
  paymentTransactionId Int?               // Link to PaymentTransaction
  purchasedAt         DateTime?
  
  // Check-in
  checkedInAt         DateTime?
  checkedInBy         Int?                // Staff member who scanned
  
  // Transfer
  originalOwnerId     Int                 // Original purchaser
  transferredAt       DateTime?
  transferredTo       Int?
  
  // Refund
  refundedAt          DateTime?
  refundAmount        Float?
  refundReason        String?
  
  // Timestamps
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  
  // Relations
  ticketTier          EventTicketTier     @relation(fields: [ticketTierId], references: [id])
  event               Event               @relation(fields: [eventId], references: [id])
  user                User                @relation("EventTickets", fields: [userId], references: [id])
  originalOwner       User                @relation("OriginalTicketOwner", fields: [originalOwnerId], references: [id])
  paymentTransaction  PaymentTransaction? @relation(fields: [paymentTransactionId], references: [id])
  
  @@index([userId, status])
  @@index([eventId, status])
  @@index([ticketNumber])
  @@index([qrCode])
  @@index([paymentTransactionId])
}

model EventAttendee {
  id                  Int                 @id @default(autoincrement())
  eventId             Int
  userId              Int
  attendeeType        AttendeeType        @default(TICKET_HOLDER)
  
  // RSVP Details
  rsvpStatus          String?             // "GOING", "MAYBE", "NOT_GOING"
  rsvpedAt            DateTime?
  
  // Waitlist
  waitlistPosition    Int?
  waitlistJoinedAt    DateTime?
  waitlistApprovedAt  DateTime?
  
  // Guest Info
  guestCount          Int                 @default(1) // Including self
  guestNames          Json?               // Array of guest names
  
  // Special Requirements
  dietaryRestrictions String?
  accessibilityNeeds  String?
  specialRequests     String?
  
  // Notifications
  smsNotifications    Boolean             @default(false)
  phoneNumber         String?
  emailNotifications  Boolean             @default(true)
  
  // Timestamps
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  
  // Relations
  event               Event               @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user                User                @relation("EventAttendees", fields: [userId], references: [id])
  
  @@unique([eventId, userId])
  @@index([eventId, attendeeType])
  @@index([userId])
  @@index([waitlistPosition])
}

model EventCheckIn {
  id                  Int                 @id @default(autoincrement())
  eventId             Int
  userId              Int
  ticketId            Int?
  
  // Check-in Details
  checkedInAt         DateTime            @default(now())
  checkedInBy         Int?                // Staff/organizer who scanned
  checkInMethod       String              @default("QR_SCAN") // QR_SCAN, MANUAL, NFC
  
  // Location (for bar crawl tracking)
  locationName        String?
  latitude            Float?
  longitude           Float?
  
  // Relations
  event               Event               @relation(fields: [eventId], references: [id])
  user                User                @relation("EventCheckIns", fields: [userId], references: [id])
  ticket              EventTicket?        @relation(fields: [ticketId], references: [id])
  
  @@index([eventId, checkedInAt])
  @@index([userId])
  @@index([ticketId])
}

// Add-Ons System (Valet, DJ Requests, etc.)
model EventAddOn {
  id                  Int                 @id @default(autoincrement())
  eventId             Int
  name                String              // "Valet Parking", "DJ Song Request"
  description         String?
  category            String              // "PARKING", "ENTERTAINMENT", "FOOD"
  
  // Pricing
  price               Float
  isOptional          Boolean             @default(true)
  
  // Inventory
  totalQuantity       Int?                // null = unlimited
  soldQuantity        Int                 @default(0)
  
  // Restrictions
  maxPerUser          Int                 @default(1)
  availableFrom       DateTime?
  availableUntil      DateTime?
  
  // Status
  isActive            Boolean             @default(true)
  
  // Timestamps
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  
  // Relations
  event               Event               @relation(fields: [eventId], references: [id], onDelete: Cascade)
  purchases           EventAddOnPurchase[]
  
  @@index([eventId, isActive])
  @@index([category])
}

model EventAddOnPurchase {
  id                  Int                 @id @default(autoincrement())
  addOnId             Int
  userId              Int
  ticketId            Int?                // Optional: associate with ticket
  
  // Purchase Details
  quantity            Int                 @default(1)
  pricePerUnit        Float
  totalPrice          Float
  paymentTransactionId Int?
  
  // Status
  status              String              @default("CONFIRMED") // CONFIRMED, CANCELLED, REFUNDED
  
  // Fulfillment (for services like DJ requests)
  fulfillmentStatus   String?             // PENDING, IN_PROGRESS, COMPLETED
  fulfillmentNotes    String?
  
  // Timestamps
  purchasedAt         DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  
  // Relations
  addOn               EventAddOn          @relation(fields: [addOnId], references: [id])
  user                User                @relation("EventAddOnPurchases", fields: [userId], references: [id])
  ticket              EventTicket?        @relation(fields: [ticketId], references: [id])
  paymentTransaction  PaymentTransaction? @relation(fields: [paymentTransactionId], references: [id])
  
  @@index([addOnId])
  @@index([userId])
  @@index([ticketId])
}

// Analytics for organizers
model EventAnalytics {
  id                  Int                 @id @default(autoincrement())
  eventId             Int                 @unique
  
  // Sales Metrics
  totalRevenue        Float               @default(0)
  ticketRevenue       Float               @default(0)
  addOnRevenue        Float               @default(0)
  totalTicketsSold    Int                 @default(0)
  
  // Engagement Metrics
  totalViews          Int                 @default(0)
  uniqueVisitors      Int                 @default(0)
  conversionRate      Float               @default(0) // Views to purchases
  
  // Check-in Metrics
  totalCheckIns       Int                 @default(0)
  checkInRate         Float               @default(0) // Checked in / sold
  
  // Waitlist Metrics
  waitlistTotal       Int                 @default(0)
  waitlistConverted   Int                 @default(0)
  
  // Social Proof (WAGBT)
  socialShares        Int                 @default(0)
  referralTickets     Int                 @default(0)
  
  // Timestamps
  updatedAt           DateTime            @updatedAt
  
  // Relations
  event               Event               @relation(fields: [eventId], references: [id], onDelete: Cascade)
  
  @@index([eventId])
}
```

### 1.2 User Role Extension

**Update User Model:**
```prisma
model User {
  // ... existing fields ...
  
  // Event Management Relations
  organizedEvents     Event[]             @relation("EventOrganizer")
  eventTickets        EventTicket[]       @relation("EventTickets")
  originalTickets     EventTicket[]       @relation("OriginalTicketOwner")
  eventAttendances    EventAttendee[]     @relation("EventAttendees")
  eventCheckIns       EventCheckIn[]      @relation("EventCheckIns")
  eventAddOnPurchases EventAddOnPurchase[] @relation("EventAddOnPurchases")
}

model Merchant {
  // ... existing fields ...
  
  // Event Management
  hostedEvents        Event[]
}
```

**Update UserRole Enum:**
```prisma
enum UserRole {
  USER
  MERCHANT
  ADMIN
  EVENT_ORGANIZER     // Can create and manage events
  VENDOR              // Can apply to events as vendor
}
```

**Update PaymentPurpose Enum:**
```prisma
enum PaymentPurpose {
  COIN_PURCHASE
  DEAL_PURCHASE
  BOOKING_PREPAY
  MENU_ORDER
  EVENT_TICKET        // NEW
  EVENT_ADD_ON        // NEW
  VENDOR_APPLICATION  // NEW (for Phase 3)
}
```

### 1.3 Payment Integration

**Update PaymentTransaction Model:**
```prisma
model PaymentTransaction {
  // ... existing fields ...
  
  // Event Relations
  eventTickets        EventTicket[]
  eventAddOnPurchases EventAddOnPurchase[]
}
```

### 1.4 Middleware & Authorization

**New File: `src/middleware/event.middleware.ts`**
```typescript
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import prisma from '../lib/prisma';

/**
 * Middleware: Verify user is an event organizer (has EVENT_ORGANIZER or ADMIN role)
 */
export const requireEventOrganizer = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!user || (user.role !== 'EVENT_ORGANIZER' && user.role !== 'ADMIN')) {
      return res.status(403).json({ 
        error: 'Event organizer privileges required' 
      });
    }

    next();
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify organizer status' });
  }
};

/**
 * Middleware: Verify user owns the event they're trying to modify
 */
export const requireEventOwnership = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    const eventId = parseInt(req.params.eventId);

    if (!userId || !eventId) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { organizerId: true }
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Allow admins to access any event
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (event.organizerId !== userId && user?.role !== 'ADMIN') {
      return res.status(403).json({ 
        error: 'You do not own this event' 
      });
    }

    next();
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify event ownership' });
  }
};

/**
 * Middleware: Check if event is published and accepting registrations
 */
export const requirePublishedEvent = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const eventId = parseInt(req.params.eventId);

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { status: true, startDate: true }
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.status !== 'PUBLISHED') {
      return res.status(400).json({ 
        error: 'This event is not currently accepting registrations' 
      });
    }

    if (event.startDate < new Date()) {
      return res.status(400).json({ 
        error: 'This event has already started' 
      });
    }

    next();
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify event status' });
  }
};
```

### 1.5 API Endpoints (MVP)

**New File: `src/routes/events.routes.ts`**
```typescript
import express from 'express';
import { protect, requireAdmin } from '../middleware/auth.middleware';
import { 
  requireEventOrganizer, 
  requireEventOwnership,
  requirePublishedEvent 
} from '../middleware/event.middleware';
import prisma from '../lib/prisma';
import { EventStatus, EventType } from '@prisma/client';

const router = express.Router();

// ============================================================
// PUBLIC ROUTES - Browse events
// ============================================================

/**
 * GET /api/events
 * Browse all published events with filters
 */
router.get('/', async (req, res) => {
  try {
    const {
      eventType,
      cityId,
      startDate,
      endDate,
      isFreeEvent,
      search,
      page = '1',
      limit = '20'
    } = req.query;

    const where: any = {
      status: EventStatus.PUBLISHED
    };

    if (eventType) where.eventType = eventType as EventType;
    if (cityId) where.cityId = parseInt(cityId as string);
    if (isFreeEvent) where.isFreeEvent = isFreeEvent === 'true';
    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } }
      ];
    }
    if (startDate || endDate) {
      where.startDate = {};
      if (startDate) where.startDate.gte = new Date(startDate as string);
      if (endDate) where.startDate.lte = new Date(endDate as string);
    }

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          organizer: {
            select: { id: true, name: true, avatarUrl: true }
          },
          city: true,
          ticketTiers: {
            where: { isActive: true },
            orderBy: { price: 'asc' }
          },
          _count: {
            select: { attendees: true }
          }
        },
        orderBy: [
          { trendingScore: 'desc' }, // WAGBT prioritized
          { startDate: 'asc' }
        ],
        skip,
        take
      }),
      prisma.event.count({ where })
    ]);

    res.json({
      events,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/**
 * GET /api/events/:eventId
 * Get single event details
 */
router.get('/:eventId', async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizer: {
          select: { id: true, name: true, email: true, avatarUrl: true }
        },
        merchant: {
          select: { id: true, businessName: true, logoUrl: true }
        },
        city: true,
        ticketTiers: {
          where: { isActive: true },
          orderBy: { price: 'asc' }
        },
        addOns: {
          where: { isActive: true }
        },
        schedules: {
          orderBy: { startTime: 'asc' }
        },
        analytics: true,
        _count: {
          select: { 
            attendees: true,
            checkIns: true 
          }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Increment view count (could be done async)
    if (event.analytics) {
      await prisma.eventAnalytics.update({
        where: { eventId },
        data: {
          totalViews: { increment: 1 }
        }
      });
    }

    res.json({ event });
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// ============================================================
// ORGANIZER ROUTES - Create & manage events
// ============================================================

/**
 * POST /api/events
 * Create new event (requires EVENT_ORGANIZER role)
 */
router.post('/', protect, requireEventOrganizer, async (req, res) => {
  try {
    const userId = req.user!.id;
    const {
      title,
      description,
      shortDescription,
      eventType,
      venueName,
      venueAddress,
      latitude,
      longitude,
      cityId,
      startDate,
      endDate,
      maxAttendees,
      isFreeEvent,
      coverImageUrl,
      tags
    } = req.body;

    // Validation
    if (!title || !description || !eventType || !startDate || !endDate) {
      return res.status(400).json({ 
        error: 'Missing required fields' 
      });
    }

    const event = await prisma.$transaction(async (tx) => {
      // Create event
      const newEvent = await tx.event.create({
        data: {
          title,
          description,
          shortDescription,
          eventType,
          status: EventStatus.DRAFT,
          organizerId: userId,
          venueName,
          venueAddress,
          latitude,
          longitude,
          cityId: cityId ? parseInt(cityId) : null,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          maxAttendees: maxAttendees ? parseInt(maxAttendees) : null,
          isFreeEvent: isFreeEvent || false,
          coverImageUrl,
          tags: tags || []
        },
        include: {
          organizer: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      // Create analytics record
      await tx.eventAnalytics.create({
        data: { eventId: newEvent.id }
      });

      return newEvent;
    });

    res.status(201).json({ 
      message: 'Event created successfully',
      event 
    });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

/**
 * PATCH /api/events/:eventId
 * Update event (owner only)
 */
router.patch(
  '/:eventId',
  protect,
  requireEventOrganizer,
  requireEventOwnership,
  async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId);
      const updates = req.body;

      // Prevent updating certain fields after publishing
      const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: { status: true }
      });

      if (event?.status === EventStatus.PUBLISHED) {
        const restrictedFields = ['eventType', 'startDate', 'isFreeEvent'];
        const hasRestrictedUpdates = restrictedFields.some(
          field => field in updates
        );
        
        if (hasRestrictedUpdates) {
          return res.status(400).json({
            error: 'Cannot modify event type or dates after publishing'
          });
        }
      }

      const updatedEvent = await prisma.event.update({
        where: { id: eventId },
        data: updates
      });

      res.json({ 
        message: 'Event updated successfully',
        event: updatedEvent 
      });
    } catch (error) {
      console.error('Error updating event:', error);
      res.status(500).json({ error: 'Failed to update event' });
    }
  }
);

/**
 * POST /api/events/:eventId/publish
 * Publish event (make it live)
 */
router.post(
  '/:eventId/publish',
  protect,
  requireEventOrganizer,
  requireEventOwnership,
  async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId);

      // Validation: ensure event has at least one ticket tier (if not free)
      const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
          ticketTiers: true
        }
      });

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      if (event.status !== EventStatus.DRAFT) {
        return res.status(400).json({
          error: 'Only draft events can be published'
        });
      }

      if (!event.isFreeEvent && event.ticketTiers.length === 0) {
        return res.status(400).json({
          error: 'Paid events must have at least one ticket tier'
        });
      }

      const updatedEvent = await prisma.event.update({
        where: { id: eventId },
        data: {
          status: EventStatus.PUBLISHED,
          publishedAt: new Date()
        }
      });

      res.json({
        message: 'Event published successfully',
        event: updatedEvent
      });
    } catch (error) {
      console.error('Error publishing event:', error);
      res.status(500).json({ error: 'Failed to publish event' });
    }
  }
);

/**
 * DELETE /api/events/:eventId
 * Delete/cancel event
 */
router.delete(
  '/:eventId',
  protect,
  requireEventOrganizer,
  requireEventOwnership,
  async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId);

      const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
          _count: {
            select: { attendees: true }
          }
        }
      });

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // If event has attendees, mark as cancelled instead of deleting
      if (event._count.attendees > 0) {
        await prisma.event.update({
          where: { id: eventId },
          data: {
            status: EventStatus.CANCELLED,
            cancelledAt: new Date()
          }
        });

        // TODO: Send cancellation notifications to attendees
        // TODO: Process refunds

        return res.json({
          message: 'Event cancelled successfully'
        });
      }

      // No attendees, safe to delete
      await prisma.event.delete({
        where: { id: eventId }
      });

      res.json({
        message: 'Event deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting event:', error);
      res.status(500).json({ error: 'Failed to delete event' });
    }
  }
);

// ============================================================
// TICKET TIER MANAGEMENT
// ============================================================

/**
 * POST /api/events/:eventId/ticket-tiers
 * Add ticket tier to event
 */
router.post(
  '/:eventId/ticket-tiers',
  protect,
  requireEventOrganizer,
  requireEventOwnership,
  async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId);
      const {
        name,
        description,
        tier,
        price,
        totalQuantity,
        maxPerOrder,
        isPresaleOnly
      } = req.body;

      if (!name || !tier || price === undefined || !totalQuantity) {
        return res.status(400).json({ 
          error: 'Missing required fields' 
        });
      }

      const ticketTier = await prisma.eventTicketTier.create({
        data: {
          eventId,
          name,
          description,
          tier,
          price: parseFloat(price),
          serviceFee: parseFloat(price) * 0.05, // 5% platform fee
          totalQuantity: parseInt(totalQuantity),
          maxPerOrder: maxPerOrder ? parseInt(maxPerOrder) : 10,
          isPresaleOnly: isPresaleOnly || false
        }
      });

      res.status(201).json({
        message: 'Ticket tier created successfully',
        ticketTier
      });
    } catch (error) {
      console.error('Error creating ticket tier:', error);
      res.status(500).json({ error: 'Failed to create ticket tier' });
    }
  }
);

/**
 * PATCH /api/events/:eventId/ticket-tiers/:tierId
 * Update ticket tier
 */
router.patch(
  '/:eventId/ticket-tiers/:tierId',
  protect,
  requireEventOrganizer,
  requireEventOwnership,
  async (req, res) => {
    try {
      const tierId = parseInt(req.params.tierId);
      const updates = req.body;

      // Prevent reducing quantity below sold amount
      if ('totalQuantity' in updates) {
        const tier = await prisma.eventTicketTier.findUnique({
          where: { id: tierId },
          select: { soldQuantity: true }
        });

        if (tier && updates.totalQuantity < tier.soldQuantity) {
          return res.status(400).json({
            error: 'Cannot reduce quantity below number of tickets already sold'
          });
        }
      }

      const updatedTier = await prisma.eventTicketTier.update({
        where: { id: tierId },
        data: updates
      });

      res.json({
        message: 'Ticket tier updated successfully',
        ticketTier: updatedTier
      });
    } catch (error) {
      console.error('Error updating ticket tier:', error);
      res.status(500).json({ error: 'Failed to update ticket tier' });
    }
  }
);

// ============================================================
// TICKET PURCHASE & ATTENDEE MANAGEMENT
// ============================================================

/**
 * POST /api/events/:eventId/tickets/purchase
 * Purchase tickets (creates PayPal payment intent)
 */
router.post(
  '/:eventId/tickets/purchase',
  protect,
  requirePublishedEvent,
  async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId);
      const userId = req.user!.id;
      const { ticketTierId, quantity, addOnIds } = req.body;

      if (!ticketTierId || !quantity) {
        return res.status(400).json({ 
          error: 'Missing required fields' 
        });
      }

      // Validation
      const [event, ticketTier] = await Promise.all([
        prisma.event.findUnique({
          where: { id: eventId },
          select: { 
            maxAttendees: true, 
            currentAttendees: true,
            status: true 
          }
        }),
        prisma.eventTicketTier.findUnique({
          where: { id: ticketTierId },
          select: {
            price: true,
            serviceFee: true,
            totalQuantity: true,
            soldQuantity: true,
            reservedQuantity: true,
            maxPerOrder: true
          }
        })
      ]);

      if (!event || !ticketTier) {
        return res.status(404).json({ error: 'Event or ticket tier not found' });
      }

      if (quantity > ticketTier.maxPerOrder) {
        return res.status(400).json({
          error: `Maximum ${ticketTier.maxPerOrder} tickets per order`
        });
      }

      const available = ticketTier.totalQuantity - 
                        ticketTier.soldQuantity - 
                        ticketTier.reservedQuantity;

      if (quantity > available) {
        return res.status(400).json({
          error: `Only ${available} tickets remaining`
        });
      }

      // Calculate total price
      const ticketPrice = (ticketTier.price + ticketTier.serviceFee) * quantity;
      let addOnPrice = 0;

      if (addOnIds && addOnIds.length > 0) {
        const addOns = await prisma.eventAddOn.findMany({
          where: { 
            id: { in: addOnIds },
            eventId,
            isActive: true 
          }
        });
        addOnPrice = addOns.reduce((sum, addOn) => sum + addOn.price, 0);
      }

      const totalPrice = ticketPrice + addOnPrice;

      // Reserve tickets (temporary hold for 10 minutes)
      await prisma.eventTicketTier.update({
        where: { id: ticketTierId },
        data: {
          reservedQuantity: { increment: quantity }
        }
      });

      // Create PayPal order (integration with existing payment system)
      // TODO: Use existing PayPal integration from src/routes/payments.routes.ts

      res.json({
        message: 'Tickets reserved, proceed to payment',
        reservation: {
          eventId,
          ticketTierId,
          quantity,
          totalPrice,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 min
        }
      });
    } catch (error) {
      console.error('Error purchasing tickets:', error);
      res.status(500).json({ error: 'Failed to purchase tickets' });
    }
  }
);

/**
 * GET /api/events/:eventId/attendees
 * Get event attendee list (organizer only)
 */
router.get(
  '/:eventId/attendees',
  protect,
  requireEventOrganizer,
  requireEventOwnership,
  async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId);
      const { attendeeType, search } = req.query;

      const where: any = { eventId };
      if (attendeeType) where.attendeeType = attendeeType;

      const attendees = await prisma.eventAttendee.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phoneNumber: true,
              avatarUrl: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      res.json({ attendees });
    } catch (error) {
      console.error('Error fetching attendees:', error);
      res.status(500).json({ error: 'Failed to fetch attendees' });
    }
  }
);

/**
 * GET /api/events/:eventId/analytics
 * Get event analytics (organizer only)
 */
router.get(
  '/:eventId/analytics',
  protect,
  requireEventOrganizer,
  requireEventOwnership,
  async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId);

      const analytics = await prisma.eventAnalytics.findUnique({
        where: { eventId },
        include: {
          event: {
            select: {
              title: true,
              status: true,
              startDate: true,
              _count: {
                select: {
                  attendees: true,
                  checkIns: true
                }
              }
            }
          }
        }
      });

      if (!analytics) {
        return res.status(404).json({ error: 'Analytics not found' });
      }

      res.json({ analytics });
    } catch (error) {
      console.error('Error fetching analytics:', error);
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  }
);

export default router;
```

### 1.6 Integration with App.ts

**Update: `src/app.ts`**
```typescript
// Add to imports
import eventsRoutes from './routes/events.routes';

// Add to route registrations
app.use('/api/events', eventsRoutes);
```

### 1.7 Migration Script

**Create: `prisma/migrations/YYYYMMDD_add_event_management/migration.sql`**

This will be auto-generated when running:
```bash
npx prisma migrate dev --name add_event_management_mvp
```

---

## Phase 2: Advanced Features
**Timeline**: 3-4 weeks  
**Builds on**: Phase 1

### 2.1 Multi-Day Events & Scheduling

**New Model:**
```prisma
model EventSchedule {
  id                  Int                 @id @default(autoincrement())
  eventId             Int
  dayNumber           Int                 // Day 1, 2, 3 for multi-day
  date                DateTime
  title               String              // "Day 1: Opening Ceremony"
  description         String?
  
  // Location (for bar crawls with multiple stops)
  locationName        String?
  locationAddress     String?
  latitude            Float?
  longitude           Float?
  
  // Timing
  startTime           DateTime
  endTime             DateTime
  
  // Activities
  activities          Json?               // Array of activities at this location
  
  // Special Info
  notes               String?
  
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  
  event               Event               @relation(fields: [eventId], references: [id], onDelete: Cascade)
  
  @@index([eventId, dayNumber])
  @@index([eventId, startTime])
}
```

**API Endpoints:**
```typescript
// POST /api/events/:eventId/schedule
// GET /api/events/:eventId/schedule
// PATCH /api/events/:eventId/schedule/:scheduleId
// DELETE /api/events/:eventId/schedule/:scheduleId
```

### 2.2 QR Code Generation & Check-In System

**Install Dependencies:**
```bash
npm install qrcode @types/qrcode
```

**New Service: `src/services/qrcode.service.ts`**
```typescript
import QRCode from 'qrcode';
import crypto from 'crypto';

export class QRCodeService {
  /**
   * Generate unique ticket QR code
   */
  static async generateTicketQRCode(
    ticketId: number,
    userId: number,
    eventId: number
  ): Promise<string> {
    // Create secure QR payload
    const payload = {
      ticketId,
      userId,
      eventId,
      timestamp: Date.now(),
      hash: crypto
        .createHash('sha256')
        .update(`${ticketId}-${userId}-${eventId}-${process.env.QR_SECRET}`)
        .digest('hex')
    };

    return JSON.stringify(payload);
  }

  /**
   * Generate QR code image data URL
   */
  static async generateQRCodeImage(data: string): Promise<string> {
    return await QRCode.toDataURL(data);
  }

  /**
   * Verify QR code authenticity
   */
  static verifyQRCode(qrData: string): boolean {
    try {
      const payload = JSON.parse(qrData);
      const expectedHash = crypto
        .createHash('sha256')
        .update(
          `${payload.ticketId}-${payload.userId}-${payload.eventId}-${process.env.QR_SECRET}`
        )
        .digest('hex');

      return payload.hash === expectedHash;
    } catch {
      return false;
    }
  }
}
```

**Check-In Endpoints:**
```typescript
/**
 * POST /api/events/:eventId/check-in
 * Check in attendee with QR code scan
 */
router.post(
  '/:eventId/check-in',
  protect,
  requireEventOrganizer,
  async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId);
      const { qrCode } = req.body;
      const staffId = req.user!.id;

      // Verify QR code
      if (!QRCodeService.verifyQRCode(qrCode)) {
        return res.status(400).json({ error: 'Invalid QR code' });
      }

      const qrData = JSON.parse(qrCode);

      // Find ticket
      const ticket = await prisma.eventTicket.findUnique({
        where: { qrCode },
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      if (ticket.eventId !== eventId) {
        return res.status(400).json({ 
          error: 'Ticket is for a different event' 
        });
      }

      if (ticket.status === 'CHECKED_IN') {
        return res.status(400).json({
          error: 'Ticket already checked in',
          checkedInAt: ticket.checkedInAt
        });
      }

      if (ticket.status !== 'CONFIRMED') {
        return res.status(400).json({
          error: `Ticket status is ${ticket.status}`
        });
      }

      // Perform check-in
      await prisma.$transaction([
        prisma.eventTicket.update({
          where: { id: ticket.id },
          data: {
            status: 'CHECKED_IN',
            checkedInAt: new Date(),
            checkedInBy: staffId
          }
        }),
        prisma.eventCheckIn.create({
          data: {
            eventId,
            userId: ticket.userId,
            ticketId: ticket.id,
            checkedInBy: staffId,
            checkInMethod: 'QR_SCAN'
          }
        }),
        prisma.eventAnalytics.update({
          where: { eventId },
          data: {
            totalCheckIns: { increment: 1 }
          }
        })
      ]);

      res.json({
        message: 'Check-in successful',
        attendee: {
          name: ticket.user.name,
          email: ticket.user.email,
          ticketTier: ticket.ticketTierId
        }
      });
    } catch (error) {
      console.error('Error checking in:', error);
      res.status(500).json({ error: 'Check-in failed' });
    }
  }
);
```

### 2.3 Waitlist Management

**API Endpoints:**
```typescript
/**
 * POST /api/events/:eventId/waitlist/join
 * Join event waitlist
 */
router.post(
  '/:eventId/waitlist/join',
  protect,
  async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId);
      const userId = req.user!.id;

      const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: { 
          enableWaitlist: true,
          status: true,
          _count: { select: { attendees: true } }
        }
      });

      if (!event?.enableWaitlist) {
        return res.status(400).json({
          error: 'This event does not have a waitlist'
        });
      }

      // Get current waitlist position
      const waitlistCount = await prisma.eventAttendee.count({
        where: {
          eventId,
          attendeeType: 'WAITLIST'
        }
      });

      await prisma.eventAttendee.create({
        data: {
          eventId,
          userId,
          attendeeType: 'WAITLIST',
          waitlistPosition: waitlistCount + 1,
          waitlistJoinedAt: new Date()
        }
      });

      res.json({
        message: 'Added to waitlist',
        position: waitlistCount + 1
      });
    } catch (error) {
      console.error('Error joining waitlist:', error);
      res.status(500).json({ error: 'Failed to join waitlist' });
    }
  }
);

/**
 * POST /api/events/:eventId/waitlist/:attendeeId/approve
 * Approve waitlist attendee (organizer only)
 */
router.post(
  '/:eventId/waitlist/:attendeeId/approve',
  protect,
  requireEventOrganizer,
  requireEventOwnership,
  async (req, res) => {
    try {
      const attendeeId = parseInt(req.params.attendeeId);

      await prisma.eventAttendee.update({
        where: { id: attendeeId },
        data: {
          attendeeType: 'RSVP',
          waitlistApprovedAt: new Date()
        }
      });

      // TODO: Send notification to user

      res.json({ message: 'Attendee approved from waitlist' });
    } catch (error) {
      console.error('Error approving attendee:', error);
      res.status(500).json({ error: 'Failed to approve attendee' });
    }
  }
);
```

### 2.4 Presale & SMS Notifications

**Install Dependencies:**
```bash
npm install twilio
```

**New Service: `src/services/sms.service.ts`**
```typescript
import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(accountSid, authToken);

export class SMSService {
  static async sendPresaleNotification(
    phoneNumber: string,
    eventTitle: string,
    presaleUrl: string
  ): Promise<void> {
    try {
      await client.messages.create({
        body: `🎟️ Presale NOW OPEN for ${eventTitle}! Get your tickets: ${presaleUrl}`,
        from: fromNumber,
        to: phoneNumber
      });
    } catch (error) {
      console.error('SMS send error:', error);
      throw error;
    }
  }

  static async sendTicketConfirmation(
    phoneNumber: string,
    eventTitle: string,
    ticketCount: number
  ): Promise<void> {
    try {
      await client.messages.create({
        body: `✅ Confirmed! ${ticketCount} ticket(s) for ${eventTitle}. Check your email for QR codes.`,
        from: fromNumber,
        to: phoneNumber
      });
    } catch (error) {
      console.error('SMS send error:', error);
      throw error;
    }
  }
}
```

### 2.5 Ticket Transfer System

**API Endpoints:**
```typescript
/**
 * POST /api/events/tickets/:ticketId/transfer
 * Transfer ticket to another user
 */
router.post(
  '/tickets/:ticketId/transfer',
  protect,
  async (req, res) => {
    try {
      const ticketId = parseInt(req.params.ticketId);
      const userId = req.user!.id;
      const { recipientEmail } = req.body;

      const ticket = await prisma.eventTicket.findUnique({
        where: { id: ticketId },
        include: {
          event: {
            select: { title: true, startDate: true }
          }
        }
      });

      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      if (ticket.userId !== userId) {
        return res.status(403).json({ 
          error: 'You do not own this ticket' 
        });
      }

      if (ticket.status === 'CHECKED_IN') {
        return res.status(400).json({
          error: 'Cannot transfer checked-in ticket'
        });
      }

      // Find recipient
      const recipient = await prisma.user.findUnique({
        where: { email: recipientEmail }
      });

      if (!recipient) {
        return res.status(404).json({
          error: 'Recipient user not found'
        });
      }

      // Generate new QR code for recipient
      const newQRCode = await QRCodeService.generateTicketQRCode(
        ticket.id,
        recipient.id,
        ticket.eventId
      );

      await prisma.eventTicket.update({
        where: { id: ticketId },
        data: {
          userId: recipient.id,
          qrCode: newQRCode,
          transferredAt: new Date(),
          transferredTo: recipient.id
        }
      });

      // TODO: Send notification to recipient

      res.json({ message: 'Ticket transferred successfully' });
    } catch (error) {
      console.error('Error transferring ticket:', error);
      res.status(500).json({ error: 'Failed to transfer ticket' });
    }
  }
);
```

---

## Phase 3: Vendor Marketplace
**Timeline**: 4-5 weeks  
**Builds on**: Phases 1 & 2

### 3.1 Vendor System Schema

```prisma
enum VendorApplicationStatus {
  PENDING
  APPROVED
  REJECTED
  WAITLISTED
}

model EventVendor {
  id                  Int                      @id @default(autoincrement())
  eventId             Int
  userId              Int
  businessName        String
  businessDescription String                   @db.Text
  businessType        String                   // "FOOD", "MERCHANDISE", "SERVICES"
  logoUrl             String?
  
  // Application
  applicationStatus   VendorApplicationStatus  @default(PENDING)
  applicationFee      Float?
  applicationFeePaid  Boolean                  @default(false)
  applicationNotes    String?
  appliedAt           DateTime                 @default(now())
  reviewedAt          DateTime?
  reviewedBy          Int?
  
  // Booth/Section Assignment
  sectionAssigned     String?                  // "Section A", "Booth 12"
  sectionFee          Float?
  sectionFeePaid      Boolean                  @default(false)
  
  // Sales Tracking (organizer view only)
  totalSales          Float                    @default(0)
  transactionCount    Int                      @default(0)
  
  // Contact
  contactEmail        String
  contactPhone        String?
  website             String?
  socialMedia         Json?                    // {instagram: "", facebook: ""}
  
  // Status
  isActive            Boolean                  @default(true)
  
  // Timestamps
  createdAt           DateTime                 @default(now())
  updatedAt           DateTime                 @updatedAt
  
  // Relations
  event               Event                    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user                User                     @relation("EventVendors", fields: [userId], references: [id])
  products            VendorProduct[]
  
  @@unique([eventId, userId])
  @@index([eventId, applicationStatus])
  @@index([userId])
}

model VendorProduct {
  id                  Int                 @id @default(autoincrement())
  vendorId            Int
  name                String
  description         String              @db.Text
  category            String              // "Food", "Apparel", "Art", etc.
  price               Float
  
  // Media
  imageUrls           String[]
  videoUrl            String?
  
  // Inventory
  stockQuantity       Int?                // null = unlimited
  soldQuantity        Int                 @default(0)
  
  // Availability
  isAvailable         Boolean             @default(true)
  availableFrom       DateTime?
  availableUntil      DateTime?
  
  // Display
  isFeatured          Boolean             @default(false)
  sortOrder           Int                 @default(0)
  
  // Timestamps
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  
  // Relations
  vendor              EventVendor         @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  sales               VendorSale[]
  
  @@index([vendorId, isAvailable])
  @@index([category])
}

model VendorSale {
  id                  Int                 @id @default(autoincrement())
  productId           Int
  vendorId            Int
  eventId             Int
  userId              Int                 // Customer
  
  // Sale Details
  quantity            Int
  pricePerUnit        Float
  totalPrice          Float
  
  // Payment
  paymentTransactionId Int?
  paymentStatus       PaymentStatus       @default(PENDING)
  
  // Fulfillment
  fulfillmentStatus   String              @default("PENDING") // PENDING, READY, PICKED_UP
  fulfillmentNotes    String?
  pickedUpAt          DateTime?
  
  // Timestamps
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  
  // Relations
  product             VendorProduct       @relation(fields: [productId], references: [id])
  vendor              EventVendor         @relation("VendorSales", fields: [vendorId], references: [id])
  event               Event               @relation(fields: [eventId], references: [id])
  customer            User                @relation("VendorPurchases", fields: [userId], references: [id])
  paymentTransaction  PaymentTransaction? @relation(fields: [paymentTransactionId], references: [id])
  
  @@index([vendorId])
  @@index([eventId])
  @@index([userId])
  @@index([productId])
}
```

**Update Relations:**
```prisma
model User {
  // ... existing fields ...
  vendorApplications  EventVendor[]       @relation("EventVendors")
  vendorPurchases     VendorSale[]        @relation("VendorPurchases")
}

model Event {
  // ... existing fields ...
  vendors             EventVendor[]
  vendorSales         VendorSale[]
}
```

### 3.2 Vendor API Endpoints

**New File: `src/routes/event-vendors.routes.ts`**
```typescript
import express from 'express';
import { protect } from '../middleware/auth.middleware';
import { requireEventOwnership } from '../middleware/event.middleware';
import prisma from '../lib/prisma';

const router = express.Router();

/**
 * POST /api/events/:eventId/vendors/apply
 * Apply to be a vendor at event
 */
router.post('/:eventId/vendors/apply', protect, async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const userId = req.user!.id;
    const {
      businessName,
      businessDescription,
      businessType,
      logoUrl,
      contactEmail,
      contactPhone,
      website
    } = req.body;

    // Check if already applied
    const existing = await prisma.eventVendor.findUnique({
      where: {
        eventId_userId: { eventId, userId }
      }
    });

    if (existing) {
      return res.status(400).json({
        error: 'You have already applied to this event'
      });
    }

    // Get event vendor application fee
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { vendorApplicationFee: true }
    });

    const application = await prisma.eventVendor.create({
      data: {
        eventId,
        userId,
        businessName,
        businessDescription,
        businessType,
        logoUrl,
        contactEmail,
        contactPhone,
        website,
        applicationFee: event?.vendorApplicationFee || 0,
        applicationStatus: 'PENDING'
      }
    });

    // If there's an application fee, create payment transaction
    if (event?.vendorApplicationFee && event.vendorApplicationFee > 0) {
      // TODO: Integrate with PayPal payment flow
      // Similar to ticket purchase flow
    }

    res.status(201).json({
      message: 'Vendor application submitted',
      application
    });
  } catch (error) {
    console.error('Error applying as vendor:', error);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

/**
 * GET /api/events/:eventId/vendors
 * Get all approved vendors for an event (public)
 */
router.get('/:eventId/vendors', async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);

    const vendors = await prisma.eventVendor.findMany({
      where: {
        eventId,
        applicationStatus: 'APPROVED',
        isActive: true
      },
      include: {
        user: {
          select: { id: true, name: true, avatarUrl: true }
        },
        products: {
          where: { isAvailable: true },
          orderBy: { sortOrder: 'asc' }
        }
      }
    });

    res.json({ vendors });
  } catch (error) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
});

/**
 * GET /api/events/:eventId/vendors/applications
 * Get vendor applications for review (organizer only)
 */
router.get(
  '/:eventId/vendors/applications',
  protect,
  requireEventOwnership,
  async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId);
      const { status } = req.query;

      const where: any = { eventId };
      if (status) where.applicationStatus = status;

      const applications = await prisma.eventVendor.findMany({
        where,
        include: {
          user: {
            select: { 
              id: true, 
              name: true, 
              email: true,
              avatarUrl: true 
            }
          }
        },
        orderBy: { appliedAt: 'desc' }
      });

      res.json({ applications });
    } catch (error) {
      console.error('Error fetching applications:', error);
      res.status(500).json({ error: 'Failed to fetch applications' });
    }
  }
);

/**
 * PATCH /api/events/:eventId/vendors/:vendorId/review
 * Approve/reject vendor application (organizer only)
 */
router.patch(
  '/:eventId/vendors/:vendorId/review',
  protect,
  requireEventOwnership,
  async (req, res) => {
    try {
      const vendorId = parseInt(req.params.vendorId);
      const { applicationStatus, applicationNotes, sectionAssigned } = req.body;
      const reviewerId = req.user!.id;

      const vendor = await prisma.eventVendor.update({
        where: { id: vendorId },
        data: {
          applicationStatus,
          applicationNotes,
          sectionAssigned,
          reviewedAt: new Date(),
          reviewedBy: reviewerId
        }
      });

      // TODO: Send notification to vendor

      res.json({
        message: `Application ${applicationStatus.toLowerCase()}`,
        vendor
      });
    } catch (error) {
      console.error('Error reviewing application:', error);
      res.status(500).json({ error: 'Failed to review application' });
    }
  }
);

/**
 * POST /api/events/:eventId/vendors/:vendorId/products
 * Add product to vendor showcase
 */
router.post(
  '/:eventId/vendors/:vendorId/products',
  protect,
  async (req, res) => {
    try {
      const vendorId = parseInt(req.params.vendorId);
      const userId = req.user!.id;

      // Verify vendor ownership
      const vendor = await prisma.eventVendor.findUnique({
        where: { id: vendorId },
        select: { userId: true, applicationStatus: true }
      });

      if (!vendor || vendor.userId !== userId) {
        return res.status(403).json({
          error: 'You do not own this vendor profile'
        });
      }

      if (vendor.applicationStatus !== 'APPROVED') {
        return res.status(400).json({
          error: 'Vendor application must be approved first'
        });
      }

      const {
        name,
        description,
        category,
        price,
        imageUrls,
        stockQuantity
      } = req.body;

      const product = await prisma.vendorProduct.create({
        data: {
          vendorId,
          name,
          description,
          category,
          price: parseFloat(price),
          imageUrls: imageUrls || [],
          stockQuantity: stockQuantity ? parseInt(stockQuantity) : null
        }
      });

      res.status(201).json({
        message: 'Product added successfully',
        product
      });
    } catch (error) {
      console.error('Error adding product:', error);
      res.status(500).json({ error: 'Failed to add product' });
    }
  }
);

/**
 * GET /api/events/:eventId/vendors/:vendorId/sales
 * Get vendor sales data (vendor/organizer only)
 */
router.get(
  '/:eventId/vendors/:vendorId/sales',
  protect,
  async (req, res) => {
    try {
      const vendorId = parseInt(req.params.vendorId);
      const eventId = parseInt(req.params.eventId);
      const userId = req.user!.id;

      // Verify access
      const vendor = await prisma.eventVendor.findUnique({
        where: { id: vendorId },
        select: { userId: true }
      });

      const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: { organizerId: true }
      });

      const isOwner = vendor?.userId === userId;
      const isOrganizer = event?.organizerId === userId;

      if (!isOwner && !isOrganizer) {
        return res.status(403).json({
          error: 'Access denied'
        });
      }

      const sales = await prisma.vendorSale.findMany({
        where: { vendorId },
        include: {
          product: {
            select: { name: true, category: true }
          },
          // Only show customer details to organizer
          ...(isOrganizer && {
            customer: {
              select: { id: true, name: true, email: true }
            }
          })
        },
        orderBy: { createdAt: 'desc' }
      });

      // Calculate summary
      const summary = {
        totalSales: sales.reduce((sum, sale) => sum + sale.totalPrice, 0),
        transactionCount: sales.length,
        productsSold: sales.reduce((sum, sale) => sum + sale.quantity, 0)
      };

      res.json({ sales, summary });
    } catch (error) {
      console.error('Error fetching sales:', error);
      res.status(500).json({ error: 'Failed to fetch sales' });
    }
  }
);

export default router;
```

### 3.3 Vendor Showcase Page Structure

Organizers should see:
- Total vendor sales volume (aggregated)
- Number of transactions per vendor
- Vendor performance ranking
- **NO access to individual customer PII**

Vendors should see:
- Their own sales history
- Product performance
- Inventory levels
- **NO access to other vendors' data**

---

## Phase 4: Advanced Event Types
**Timeline**: 3-4 weeks  
**Builds on**: Phases 1-3

### 4.1 Bar Crawl Specific Features

**New Models:**
```prisma
model BarCrawlStop {
  id                  Int                 @id @default(autoincrement())
  eventScheduleId     Int                 // Links to EventSchedule
  stopNumber          Int                 // Order in crawl
  barName             String
  barAddress          String
  latitude            Float
  longitude           Float
  
  // Check-in Requirements
  checkInRadius       Int                 @default(100) // meters
  minTimeAtStop       Int?                // minutes
  
  // Special Deals
  specialMenuItems    Json?               // Array of discounted items
  drinkSpecials       String?
  
  // Gaming
  gameChallenge       String?             // "Beer pong tournament"
  gamePrize           String?
  
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  
  schedule            EventSchedule       @relation(fields: [eventScheduleId], references: [id], onDelete: Cascade)
  checkIns            BarCrawlCheckIn[]
  
  @@index([eventScheduleId, stopNumber])
}

model BarCrawlCheckIn {
  id                  Int                 @id @default(autoincrement())
  stopId              Int
  userId              Int
  eventId             Int
  
  checkedInAt         DateTime            @default(now())
  latitude            Float
  longitude           Float
  distanceFromStop    Float               // meters
  
  // Game Participation
  gameParticipated    Boolean             @default(false)
  gameScore           Int?
  
  stop                BarCrawlStop        @relation(fields: [stopId], references: [id])
  user                User                @relation("BarCrawlCheckIns", fields: [userId], references: [id])
  event               Event               @relation(fields: [eventId], references: [id])
  
  @@index([stopId, userId])
  @@index([eventId, userId])
}

// Add to User model
model User {
  // ... existing ...
  barCrawlCheckIns    BarCrawlCheckIn[]   @relation("BarCrawlCheckIns")
}

// Add to Event model
model Event {
  // ... existing ...
  barCrawlCheckIns    BarCrawlCheckIn[]
}
```

**Bar Crawl Endpoints:**
```typescript
/**
 * POST /api/events/:eventId/bar-crawl/check-in/:stopId
 * Check in at bar crawl stop with location verification
 */
router.post(
  '/:eventId/bar-crawl/check-in/:stopId',
  protect,
  async (req, res) => {
    try {
      const stopId = parseInt(req.params.stopId);
      const eventId = parseInt(req.params.eventId);
      const userId = req.user!.id;
      const { latitude, longitude } = req.body;

      // Verify user has ticket
      const ticket = await prisma.eventTicket.findFirst({
        where: {
          eventId,
          userId,
          status: 'CONFIRMED'
        }
      });

      if (!ticket) {
        return res.status(403).json({
          error: 'Valid ticket required'
        });
      }

      // Get stop details
      const stop = await prisma.barCrawlStop.findUnique({
        where: { id: stopId }
      });

      if (!stop) {
        return res.status(404).json({ error: 'Stop not found' });
      }

      // Calculate distance
      const distance = calculateDistance(
        latitude,
        longitude,
        stop.latitude,
        stop.longitude
      );

      if (distance > stop.checkInRadius) {
        return res.status(400).json({
          error: 'You are too far from the check-in location',
          distance: Math.round(distance),
          required: stop.checkInRadius
        });
      }

      // Record check-in
      const checkIn = await prisma.barCrawlCheckIn.create({
        data: {
          stopId,
          userId,
          eventId,
          latitude,
          longitude,
          distanceFromStop: distance
        }
      });

      // Award points for check-in (gamification integration)
      await prisma.user.update({
        where: { id: userId },
        data: {
          points: { increment: 50 } // Bar crawl check-in bonus
        }
      });

      // Check if completed all stops
      const totalStops = await prisma.barCrawlStop.count({
        where: {
          schedule: {
            eventId
          }
        }
      });

      const userCheckIns = await prisma.barCrawlCheckIn.count({
        where: {
          eventId,
          userId
        }
      });

      const completedCrawl = userCheckIns === totalStops;

      if (completedCrawl) {
        // Award completion bonus
        await prisma.user.update({
          where: { id: userId },
          data: {
            points: { increment: 200 } // Completion bonus
          }
        });
      }

      res.json({
        message: 'Check-in successful',
        checkIn,
        progress: {
          completed: userCheckIns,
          total: totalStops,
          completedCrawl
        }
      });
    } catch (error) {
      console.error('Error checking in:', error);
      res.status(500).json({ error: 'Check-in failed' });
    }
  }
);

// Helper function
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}
```

### 4.2 Sports Tournament Features

**New Models:**
```prisma
enum TournamentFormat {
  SINGLE_ELIMINATION
  DOUBLE_ELIMINATION
  ROUND_ROBIN
  SWISS
}

enum MatchStatus {
  SCHEDULED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

model SportsTournament {
  id                  Int                 @id @default(autoincrement())
  eventId             Int                 @unique
  sportType           String              // "Basketball", "Soccer", etc.
  format              TournamentFormat
  
  // Entry
  entryFee            Float               @default(0)
  maxTeams            Int
  minTeamSize         Int
  maxTeamSize         Int
  
  // Prize Pool
  totalPrizePool      Float               @default(0)
  prizeDistribution   Json?               // { "1st": 1000, "2nd": 500, "3rd": 250 }
  
  // Schedule
  registrationDeadline DateTime
  tournamentStartDate DateTime
  
  // Status
  isRegistrationOpen  Boolean             @default(true)
  bracketsGenerated   Boolean             @default(false)
  
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  
  event               Event               @relation(fields: [eventId], references: [id], onDelete: Cascade)
  teams               TournamentTeam[]
  matches             TournamentMatch[]
  
  @@index([eventId])
}

model TournamentTeam {
  id                  Int                 @id @default(autoincrement())
  tournamentId        Int
  teamName            String
  captainUserId       Int
  
  // Entry
  entryFeePaid        Boolean             @default(false)
  registeredAt        DateTime            @default(now())
  
  // Standing
  wins                Int                 @default(0)
  losses              Int                 @default(0)
  points              Int                 @default(0)
  rank                Int?
  
  // Status
  isActive            Boolean             @default(true)
  
  tournament          SportsTournament    @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  captain             User                @relation("TournamentCaptain", fields: [captainUserId], references: [id])
  members             TournamentTeamMember[]
  homeMatches         TournamentMatch[]   @relation("HomeTeam")
  awayMatches         TournamentMatch[]   @relation("AwayTeam")
  
  @@index([tournamentId])
  @@index([captainUserId])
}

model TournamentTeamMember {
  id                  Int                 @id @default(autoincrement())
  teamId              Int
  userId              Int
  role                String?             // "Player", "Coach", "Substitute"
  jerseyNumber        Int?
  
  joinedAt            DateTime            @default(now())
  
  team                TournamentTeam      @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user                User                @relation("TournamentPlayers", fields: [userId], references: [id])
  
  @@unique([teamId, userId])
  @@index([teamId])
  @@index([userId])
}

model TournamentMatch {
  id                  Int                 @id @default(autoincrement())
  tournamentId        Int
  round               Int                 // 1 = First round, 2 = Quarter-finals, etc.
  matchNumber         Int
  
  // Teams
  homeTeamId          Int?
  awayTeamId          Int?
  
  // Scheduling
  scheduledTime       DateTime?
  location            String?
  
  // Results
  status              MatchStatus         @default(SCHEDULED)
  homeScore           Int?
  awayScore           Int?
  winnerTeamId        Int?
  
  // Notes
  notes               String?
  
  completedAt         DateTime?
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  
  tournament          SportsTournament    @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  homeTeam            TournamentTeam?     @relation("HomeTeam", fields: [homeTeamId], references: [id])
  awayTeam            TournamentTeam?     @relation("AwayTeam", fields: [awayTeamId], references: [id])
  
  @@index([tournamentId, round])
  @@index([homeTeamId])
  @@index([awayTeamId])
}

// Add to User model
model User {
  // ... existing ...
  captainedTeams      TournamentTeam[]    @relation("TournamentCaptain")
  teamMemberships     TournamentTeamMember[] @relation("TournamentPlayers")
}

// Add to Event model
model Event {
  // ... existing ...
  tournament          SportsTournament?
}
```

### 4.3 WAGBT (Social Proof) Events

**Features:**
- Spontaneous event creation
- Real-time "X people are going" counter
- Trending algorithm based on momentum
- Social sharing incentives

**Update Event Model:**
```prisma
model Event {
  // ... existing fields ...
  
  // WAGBT Specific
  socialProofCount    Int                 @default(0)
  trendingScore       Float               @default(0)
  momentumFactor      Float               @default(0) // Rate of new attendees
  
  @@index([trendingScore])
  @@index([socialProofCount])
}
```

**Trending Algorithm Service:**
```typescript
// src/services/trending.service.ts
export class TrendingService {
  /**
   * Calculate trending score for WAGBT events
   * Factors: social proof count, momentum, recency
   */
  static async calculateTrendingScore(eventId: number): Promise<number> {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        _count: { select: { attendees: true } }
      }
    });

    if (!event) return 0;

    // Get recent attendee growth (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentAttendees = await prisma.eventAttendee.count({
      where: {
        eventId,
        createdAt: { gte: oneHourAgo }
      }
    });

    const momentum = recentAttendees / 60; // Per minute rate
    const social = event._count.attendees;
    const recency = Math.max(
      0,
      7 - Math.floor((Date.now() - event.publishedAt!.getTime()) / (24 * 60 * 60 * 1000))
    ); // Decay over 7 days

    // Weighted score
    const score = (social * 1.0) + (momentum * 10.0) + (recency * 5.0);

    // Update event
    await prisma.event.update({
      where: { id: eventId },
      data: {
        trendingScore: score,
        momentumFactor: momentum
      }
    });

    return score;
  }

  /**
   * Get trending WAGBT events
   */
  static async getTrendingEvents(limit: number = 10) {
    return await prisma.event.findMany({
      where: {
        eventType: 'WAGBT',
        status: 'PUBLISHED',
        startDate: { gte: new Date() }
      },
      orderBy: { trendingScore: 'desc' },
      take: limit,
      include: {
        organizer: {
          select: { id: true, name: true, avatarUrl: true }
        },
        _count: { select: { attendees: true } }
      }
    });
  }
}
```

---

## Integration Points

### 5.1 Payment System Integration

**Extend PaymentTransaction for Events:**
```typescript
// In src/routes/events.routes.ts
import { createPayPalOrder } from '../services/paypal.service';

async function createEventTicketPayment(
  userId: number,
  eventId: number,
  totalAmount: number,
  ticketDetails: any
) {
  // Create PayPal order
  const paypalOrder = await createPayPalOrder(totalAmount, 'USD');

  // Create payment transaction
  const payment = await prisma.paymentTransaction.create({
    data: {
      userId,
      amount: totalAmount,
      currency: 'USD',
      purpose: 'EVENT_TICKET',
      gateway: 'PAYPAL',
      paypalOrderId: paypalOrder.id,
      status: 'PENDING',
      metadata: {
        eventId,
        ticketDetails
      }
    }
  });

  return { payment, paypalOrder };
}
```

### 5.2 Loyalty & Gamification Integration

**Award Points for Event Actions:**
```typescript
// Award points for ticket purchases
await prisma.user.update({
  where: { id: userId },
  data: {
    points: { increment: 100 },
    experiencePoints: { increment: 50 }
  }
});

await prisma.userPointEvent.create({
  data: {
    userId,
    points: 100,
    pointEventTypeId: EVENT_TICKET_PURCHASE_TYPE_ID
  }
});

// Integration with existing achievements system
// Check if user unlocked "First Event Attendee" achievement
```

### 5.3 Email Notifications

**New Email Templates:**
```typescript
// src/services/email.service.ts
export class EmailService {
  static async sendTicketConfirmation(
    userEmail: string,
    eventDetails: any,
    tickets: any[]
  ) {
    // Generate QR codes and send email with tickets
  }

  static async sendEventReminder(
    userEmail: string,
    eventDetails: any,
    hoursUntilEvent: number
  ) {
    // Send reminder 24h and 2h before event
  }

  static async sendVendorApplicationStatus(
    vendorEmail: string,
    status: string,
    eventDetails: any
  ) {
    // Notify vendor of application approval/rejection
  }
}
```

---

## Performance & Scalability

### 6.1 Database Indexes

**Critical Indexes (Already in schema):**
```prisma
@@index([organizerId, status])
@@index([eventType, status])
@@index([startDate, status])
@@index([cityId, startDate])
@@index([status, publishedAt])
@@index([trendingScore])
```

### 6.2 Caching Strategy

**Redis Integration (optional):**
```bash
npm install redis @types/redis
```

```typescript
// src/lib/redis.ts
import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', (err) => console.error('Redis error:', err));

export async function getCachedEvents(cacheKey: string) {
  const cached = await redisClient.get(cacheKey);
  return cached ? JSON.parse(cached) : null;
}

export async function cacheEvents(cacheKey: string, data: any, ttl: number = 300) {
  await redisClient.setEx(cacheKey, ttl, JSON.stringify(data));
}
```

### 6.3 Background Jobs

**For Automated Tasks:**
```typescript
// src/jobs/event-jobs.ts
import cron from 'node-cron';

// Update trending scores every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  const activeEvents = await prisma.event.findMany({
    where: {
      eventType: 'WAGBT',
      status: 'PUBLISHED',
      startDate: { gte: new Date() }
    }
  });

  for (const event of activeEvents) {
    await TrendingService.calculateTrendingScore(event.id);
  }
});

// Release expired ticket reservations
cron.schedule('* * * * *', async () => {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  
  // Find expired reservations and release
  // Implementation here
});
```

---

## File Structure Summary

```
c:\GeolocationMVPBackend\
├── prisma\
│   └── schema.prisma (UPDATED with all event models)
├── src\
│   ├── middleware\
│   │   └── event.middleware.ts (NEW)
│   ├── routes\
│   │   ├── events.routes.ts (NEW)
│   │   ├── event-vendors.routes.ts (NEW - Phase 3)
│   │   └── event-tournaments.routes.ts (NEW - Phase 4)
│   ├── services\
│   │   ├── qrcode.service.ts (NEW)
│   │   ├── sms.service.ts (NEW)
│   │   ├── trending.service.ts (NEW)
│   │   └── email.service.ts (UPDATED)
│   ├── jobs\
│   │   └── event-jobs.ts (NEW)
│   ├── lib\
│   │   └── redis.ts (NEW - optional)
│   └── app.ts (UPDATED with event routes)
└── docs\
    └── EVENT_MANAGEMENT_IMPLEMENTATION_PLAN.md (THIS FILE)
```

---

## Implementation Checklist

### Phase 1: MVP (Weeks 1-4)
- [ ] Update Prisma schema with core event models
- [ ] Run migration: `npx prisma migrate dev --name add_event_management_mvp`
- [ ] Create event.middleware.ts
- [ ] Create events.routes.ts with basic CRUD
- [ ] Implement ticket tier management
- [ ] Integrate with existing PayPal payment system
- [ ] Create ticket purchase flow
- [ ] Add event routes to app.ts
- [ ] Test basic event creation and ticket purchase

### Phase 2: Advanced (Weeks 5-8)
- [ ] Add EventSchedule model for multi-day events
- [ ] Install and configure QRCode library
- [ ] Create qrcode.service.ts
- [ ] Implement check-in endpoints with QR scanning
- [ ] Add waitlist management endpoints
- [ ] Install and configure Twilio
- [ ] Create sms.service.ts
- [ ] Implement presale notifications
- [ ] Add ticket transfer system
- [ ] Test QR code generation and scanning

### Phase 3: Vendor Marketplace (Weeks 9-13)
- [ ] Add vendor models to schema
- [ ] Run migration: `npx prisma migrate dev --name add_vendor_marketplace`
- [ ] Create event-vendors.routes.ts
- [ ] Implement vendor application flow
- [ ] Create vendor product management
- [ ] Add sales tracking (with privacy controls)
- [ ] Implement vendor approval workflow
- [ ] Test vendor application and product showcase

### Phase 4: Advanced Event Types (Weeks 14-17)
- [ ] Add bar crawl specific models
- [ ] Implement location-based check-ins
- [ ] Add tournament models
- [ ] Create tournament bracket system
- [ ] Implement WAGBT trending algorithm
- [ ] Create trending.service.ts
- [ ] Add background jobs for trending scores
- [ ] Test bar crawl check-ins and tournaments

### Final Integration & Testing
- [ ] Full end-to-end testing of all event types
- [ ] Performance testing with load simulation
- [ ] Security audit of payment and ticket systems
- [ ] Documentation for organizers
- [ ] API documentation (Swagger/OpenAPI)
- [ ] Deploy to staging environment
- [ ] Production deployment

---

## Environment Variables Required

Add to `.env`:
```env
# QR Code Security
QR_SECRET=your-secret-key-for-qr-generation

# Twilio (for SMS notifications)
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=+1234567890

# Redis (optional, for caching)
REDIS_URL=redis://localhost:6379

# PayPal (existing, ensure configured)
PAYPAL_CLIENT_ID=existing-paypal-client-id
PAYPAL_CLIENT_SECRET=existing-paypal-client-secret
PAYPAL_MODE=sandbox

# Existing vars
DATABASE_URL=...
JWT_SECRET=...
```

---

## Next Steps

1. **Review and approve this plan** with your team
2. **Prioritize features** - decide which phases are critical for MVP
3. **Set up project tracking** - create tickets/tasks for each checklist item
4. **Begin Phase 1 implementation** - start with database schema updates
5. **Iterate and gather feedback** - deploy MVP and collect user feedback

---

## Notes & Considerations

### Security
- **QR Code Security**: Use HMAC signatures to prevent forgery
- **Payment Validation**: Always verify payment completion before issuing tickets
- **Access Control**: Strict ownership checks for event management
- **Rate Limiting**: Prevent ticket hoarding with rate limits on purchase endpoints
- **Vendor Data Privacy**: Organizers see aggregated data only, not customer PII

### Scalability
- **Database Indexes**: Comprehensive indexing for fast queries
- **Caching**: Redis for frequently accessed event listings
- **Background Jobs**: Offload heavy tasks (trending scores, notifications)
- **CDN**: Use CDN for event images and QR codes
- **Load Balancing**: Prepare for horizontal scaling

### User Experience
- **Mobile First**: Design for mobile check-ins and ticket viewing
- **Offline Support**: QR codes work without internet (verify later)
- **Real-time Updates**: WebSocket for live attendee counts (future enhancement)
- **Push Notifications**: Mobile app integration for event reminders

### Business Logic
- **Refund Policy**: Define clear refund rules per event type
- **Cancellation Window**: Allow organizers to cancel with refund handling
- **Vendor Commission**: Platform takes X% of vendor sales
- **Dynamic Pricing**: Future enhancement for surge pricing

---

**End of Implementation Plan**
