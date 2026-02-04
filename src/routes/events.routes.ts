      // src/routes/events.routes.ts

import { Router, Response } from 'express';
import crypto from 'crypto';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import { 
  requireEventOrganizer, 
  verifyEventOwnership,
  verifyTicketOwnership 
} from '../middleware/event.middleware';
import prisma from '../lib/prisma';
import { 
  generateTicket, 
  verifyTicketQRData,
  generateQRCodeImage 
} from '../lib/qrcode.service';

const router = Router();

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if event has available capacity
 */
function hasAvailableCapacity(event: any): boolean {
  if (!event.maxAttendees) return true; // Unlimited capacity
  return event.currentAttendees < event.maxAttendees;
}

/**
 * Calculate ticket price with fees
 */
function calculateTicketPrice(tier: any): number {
  const basePrice = tier.price;
  const serviceFee = tier.serviceFee || 0;
  const tax = basePrice * (tier.taxRate || 0);
  return basePrice + serviceFee + tax;
}

/**
 * Format event for API response
 */
function formatEventResponse(event: any) {
  return {
    ...event,
    availableTickets: event.ticketTiers?.reduce((sum: number, tier: any) => {
      return sum + (tier.totalQuantity - tier.soldQuantity - tier.reservedQuantity);
    }, 0) || 0,
    isSoldOut: event.status === 'SOLD_OUT',
    isUpcoming: new Date(event.startDate) > new Date(),
    isPast: new Date(event.endDate) < new Date()
  };
}

// ==================== PUBLIC EVENT ROUTES ====================

/**
 * GET /api/events
 * Browse published events (public)
 */
router.get('/events', async (req: AuthRequest, res: Response) => {
  try {
    const {
      eventType,
      cityId,
      startDate,
      endDate,
      isFreeEvent,
      minPrice,
      maxPrice,
      search,
      page = '1',
      limit = '20',
      sortBy = 'startDate',
      sortOrder = 'asc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build filter conditions
    const where: any = {
      status: 'PUBLISHED',
      startDate: { gte: new Date() } // Future events by default
    };

    if (eventType) where.eventType = eventType;
    if (cityId) where.cityId = parseInt(cityId as string);
    if (isFreeEvent !== undefined) where.isFreeEvent = isFreeEvent === 'true';
    
    if (startDate) {
      where.startDate = { gte: new Date(startDate as string) };
    }
    
    if (endDate) {
      where.endDate = { lte: new Date(endDate as string) };
    }

    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
        { tags: { has: search as string } }
      ];
    }

    // Price filtering (requires joining with ticket tiers)
    let priceFilter = {};
    if (minPrice || maxPrice) {
      priceFilter = {
        ticketTiers: {
          some: {
            price: {
              ...(minPrice && { gte: parseFloat(minPrice as string) }),
              ...(maxPrice && { lte: parseFloat(maxPrice as string) })
            }
          }
        }
      };
      Object.assign(where, priceFilter);
    }

    // Sorting
    const orderBy: any = {};
    if (sortBy === 'trendingScore') {
      orderBy.trendingScore = sortOrder === 'desc' ? 'desc' : 'asc';
    } else if (sortBy === 'socialProofCount') {
      orderBy.socialProofCount = sortOrder === 'desc' ? 'desc' : 'asc';
    } else {
      orderBy.startDate = sortOrder === 'desc' ? 'desc' : 'asc';
    }

    const [events, totalCount] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy,
        skip,
        take: limitNum,
        include: {
          organizer: {
            select: { id: true, name: true, email: true }
          },
          merchant: {
            select: { 
              id: true, 
              businessName: true, 
              logoUrl: true,
              address: true,
              latitude: true,
              longitude: true
            }
          },
          city: {
            select: { id: true, name: true, state: true }
          },
          ticketTiers: {
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              tier: true,
              price: true,
              serviceFee: true,
              totalQuantity: true,
              soldQuantity: true,
              reservedQuantity: true
            }
          },
          _count: {
            select: {
              attendees: true,
              ticketTiers: true
            }
          }
        }
      }),
      prisma.event.count({ where })
    ]);

    const formattedEvents = events.map(formatEventResponse);

    res.json({
      events: formattedEvents,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        totalCount,
        hasMore: skip + events.length < totalCount
      }
    });
  } catch (error) {
    console.error('Browse events error:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/**
 * GET /api/events/:id
 * Get single event details (public)
 */
router.get('/events/:id', async (req: AuthRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.id);

    if (isNaN(eventId)) {
      return res.status(400).json({ error: 'Invalid event ID' });
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizer: {
          select: { id: true, name: true, avatarUrl: true }
        },
        merchant: {
          select: {
            id: true,
            businessName: true,
            logoUrl: true,
            address: true,
            latitude: true,
            longitude: true,
            phoneNumber: true
          }
        },
        city: {
          select: { id: true, name: true, state: true }
        },
        ticketTiers: {
          where: { isActive: true },
          orderBy: { price: 'asc' }
        },
        addOns: {
          where: { isActive: true }
        },
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

    // Check if event is private and requires access code
    if (event.isPrivate && !req.user) {
      return res.status(403).json({ 
        error: 'This is a private event. Authentication required.',
        requiresAccessCode: true
      });
    }

    // If user is authenticated, check if they have access
    let userAttendee = null;
    let userTickets = null;
    
    if (req.user) {
      userAttendee = await prisma.eventAttendee.findUnique({
        where: {
          eventId_userId: {
            eventId: event.id,
            userId: req.user.id
          }
        }
      });

      userTickets = await prisma.eventTicket.findMany({
        where: {
          eventId: event.id,
          userId: req.user.id,
          status: { in: ['RESERVED', 'CONFIRMED'] }
        }
      });
    }

    const formattedEvent = formatEventResponse(event);

    res.json({
      ...formattedEvent,
      userAttendee,
      userTickets,
      isUserAttending: !!userAttendee || (userTickets && userTickets.length > 0)
    });
  } catch (error) {
    console.error('Get event details error:', error);
    res.status(500).json({ error: 'Failed to fetch event details' });
  }
});

// ==================== ORGANIZER EVENT MANAGEMENT ====================

/**
 * POST /api/events
 * Create new event (requires EVENT_ORGANIZER role)
 */
router.post('/events', protect, requireEventOrganizer, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      title,
      description,
      shortDescription,
      eventType,
      merchantId,
      venueName,
      venueAddress,
      latitude,
      longitude,
      cityId,
      isVirtualEvent,
      virtualEventUrl,
      startDate,
      endDate,
      timezone,
      isMultiDay,
      maxAttendees,
      enableWaitlist,
      waitlistCapacity,
      isFreeEvent,
      enablePresale,
      presaleStartDate,
      presaleEndDate,
      coverImageUrl,
      imageGallery,
      videoUrl,
      isPrivate,
      requiresApproval,
      minAge,
      ageVerificationReq,
      tags,
      categoryId
    } = req.body;

    // Validation
    if (!title || !description || !eventType || !startDate || !endDate) {
      return res.status(400).json({ 
        error: 'Required fields: title, description, eventType, startDate, endDate' 
      });
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start >= end) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    if (start < new Date()) {
      return res.status(400).json({ error: 'Start date must be in the future' });
    }

    // If merchant-hosted, verify ownership
    if (merchantId) {
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { ownerId: true, status: true }
      });

      if (!merchant) {
        return res.status(404).json({ error: 'Merchant not found' });
      }

      if (merchant.ownerId !== userId) {
        return res.status(403).json({ error: 'You do not own this merchant' });
      }

      if (merchant.status !== 'APPROVED') {
        return res.status(403).json({ error: 'Merchant must be approved to host events' });
      }
    }

    // Generate access code for private events
    const accessCode = isPrivate ? 
      crypto.randomBytes(6).toString('hex').toUpperCase() : 
      null;

    const event = await prisma.event.create({
      data: {
        title,
        description,
        shortDescription,
        eventType,
        organizerId: userId,
        merchantId,
        venueName,
        venueAddress,
        latitude,
        longitude,
        cityId,
        isVirtualEvent: isVirtualEvent || false,
        virtualEventUrl,
        startDate: start,
        endDate: end,
        timezone: timezone || 'America/New_York',
        isMultiDay: isMultiDay || false,
        maxAttendees,
        enableWaitlist: enableWaitlist || false,
        waitlistCapacity,
        isFreeEvent: isFreeEvent || false,
        enablePresale: enablePresale || false,
        presaleStartDate: presaleStartDate ? new Date(presaleStartDate) : null,
        presaleEndDate: presaleEndDate ? new Date(presaleEndDate) : null,
        coverImageUrl,
        imageGallery: imageGallery || [],
        videoUrl,
        isPrivate: isPrivate || false,
        accessCode,
        requiresApproval: requiresApproval || false,
        minAge,
        ageVerificationReq: ageVerificationReq || false,
        tags: tags || [],
        categoryId,
        status: 'DRAFT'
      },
      include: {
        organizer: {
          select: { id: true, name: true, email: true }
        },
        merchant: {
          select: { 
            id: true, 
            businessName: true,
            logoUrl: true 
          }
        },
        city: true
      }
    });

    res.status(201).json({ 
      event: formatEventResponse(event),
      message: 'Event created successfully. Add ticket tiers to publish.'
    });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

/**
 * PUT /api/events/:id
 * Update event (owner only)
 */
router.put('/events/:id', protect, requireEventOrganizer, verifyEventOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.id);
    const updates = req.body;

    // Get current event to check status
    const currentEvent = await prisma.event.findUnique({
      where: { id: eventId },
      select: { status: true, startDate: true }
    });

    if (!currentEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Prevent editing past events
    if (new Date(currentEvent.startDate) < new Date()) {
      return res.status(403).json({ error: 'Cannot edit past events' });
    }

    // Prevent certain changes after publishing
    if (currentEvent.status === 'PUBLISHED') {
      const restrictedFields = ['eventType', 'isFreeEvent'];
      const hasRestrictedChanges = restrictedFields.some(field => field in updates);
      
      if (hasRestrictedChanges) {
        return res.status(403).json({ 
          error: 'Cannot change event type or pricing structure after publishing' 
        });
      }
    }

    // Validate date changes
    if (updates.startDate || updates.endDate) {
      const start = updates.startDate ? new Date(updates.startDate) : currentEvent.startDate;
      const end = updates.endDate ? new Date(updates.endDate) : new Date();
      
      if (start >= end) {
        return res.status(400).json({ error: 'End date must be after start date' });
      }
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: {
        ...updates,
        updatedAt: new Date()
      },
      include: {
        organizer: {
          select: { id: true, name: true }
        },
        ticketTiers: true,
        addOns: true,
        _count: {
          select: { attendees: true }
        }
      }
    });

    res.json({ 
      event: formatEventResponse(event),
      message: 'Event updated successfully'
    });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

/**
 * DELETE /api/events/:id
 * Delete/Cancel event (owner only)
 */
router.delete('/events/:id', protect, requireEventOrganizer, verifyEventOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.id);

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { 
        status: true,
        _count: {
          select: { tickets: { where: { status: 'CONFIRMED' } } }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // If tickets have been sold, cancel instead of delete
    if (event._count.tickets > 0) {
      await prisma.event.update({
        where: { id: eventId },
        data: { 
          status: 'CANCELLED',
          cancelledAt: new Date()
        }
      });

      // TODO: Trigger refund process and send notifications

      return res.json({ 
        message: 'Event cancelled successfully. Refunds will be processed.',
        action: 'cancelled'
      });
    }

    // No tickets sold, safe to delete
    await prisma.event.delete({
      where: { id: eventId }
    });

    res.json({ 
      message: 'Event deleted successfully',
      action: 'deleted'
    });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

/**
 * POST /api/events/:id/publish
 * Publish event (make it visible to public)
 */
router.post('/events/:id/publish', protect, requireEventOrganizer, verifyEventOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.id);

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        ticketTiers: { where: { isActive: true } }
      }
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Only draft events can be published' });
    }

    // Validation before publishing
    if (!event.isFreeEvent && (!event.ticketTiers || event.ticketTiers.length === 0)) {
      return res.status(400).json({ 
        error: 'Add at least one ticket tier before publishing' 
      });
    }

    if (!event.coverImageUrl) {
      return res.status(400).json({ 
        error: 'Add a cover image before publishing' 
      });
    }

    const publishedEvent = await prisma.event.update({
      where: { id: eventId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date()
      }
    });

    res.json({ 
      event: formatEventResponse(publishedEvent),
      message: 'Event published successfully!'
    });
  } catch (error) {
    console.error('Publish event error:', error);
    res.status(500).json({ error: 'Failed to publish event' });
  }
});

// ==================== TICKET TIER MANAGEMENT ====================

/**
 * POST /api/events/:eventId/ticket-tiers
 * Create ticket tier
 */
router.post('/events/:eventId/ticket-tiers', protect, requireEventOrganizer, verifyEventOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const {
      name,
      description,
      tier,
      price,
      serviceFee,
      taxRate,
      totalQuantity,
      minPerOrder,
      maxPerOrder,
      maxPerUser,
      isPresaleOnly,
      presaleCode,
      validDates,
      salesStartDate,
      salesEndDate
    } = req.body;

    // Validation
    if (!name || !tier || price === undefined || !totalQuantity) {
      return res.status(400).json({ 
        error: 'Required fields: name, tier, price, totalQuantity' 
      });
    }

    if (price < 0) {
      return res.status(400).json({ error: 'Price cannot be negative' });
    }

    if (totalQuantity < 1) {
      return res.status(400).json({ error: 'Total quantity must be at least 1' });
    }

    const ticketTier = await prisma.eventTicketTier.create({
      data: {
        eventId,
        name,
        description,
        tier,
        price,
        serviceFee: serviceFee || 0,
        taxRate: taxRate || 0,
        totalQuantity,
        minPerOrder: minPerOrder || 1,
        maxPerOrder: maxPerOrder || 10,
        maxPerUser,
        isPresaleOnly: isPresaleOnly || false,
        presaleCode,
        validDates: validDates || [],
        salesStartDate: salesStartDate ? new Date(salesStartDate) : null,
        salesEndDate: salesEndDate ? new Date(salesEndDate) : null,
        isActive: true
      }
    });

    res.status(201).json({ 
      ticketTier,
      message: 'Ticket tier created successfully'
    });
  } catch (error) {
    console.error('Create ticket tier error:', error);
    res.status(500).json({ error: 'Failed to create ticket tier' });
  }
});

/**
 * PUT /api/events/:eventId/ticket-tiers/:tierId
 * Update ticket tier
 */
router.put('/events/:eventId/ticket-tiers/:tierId', protect, requireEventOrganizer, verifyEventOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const tierId = parseInt(req.params.tierId);
    const updates = req.body;

    // Check if tier exists and belongs to event
    const existingTier = await prisma.eventTicketTier.findFirst({
      where: { id: tierId, eventId }
    });

    if (!existingTier) {
      return res.status(404).json({ error: 'Ticket tier not found' });
    }

    // Prevent reducing quantity below sold amount
    if (updates.totalQuantity !== undefined) {
      if (updates.totalQuantity < existingTier.soldQuantity) {
        return res.status(400).json({ 
          error: `Cannot reduce quantity below ${existingTier.soldQuantity} (already sold)` 
        });
      }
    }

    const ticketTier = await prisma.eventTicketTier.update({
      where: { id: tierId },
      data: {
        ...updates,
        updatedAt: new Date()
      }
    });

    res.json({ 
      ticketTier,
      message: 'Ticket tier updated successfully'
    });
  } catch (error) {
    console.error('Update ticket tier error:', error);
    res.status(500).json({ error: 'Failed to update ticket tier' });
  }
});

/**
 * DELETE /api/events/:eventId/ticket-tiers/:tierId
 * Delete ticket tier (soft delete - mark as inactive)
 */
router.delete('/events/:eventId/ticket-tiers/:tierId', protect, requireEventOrganizer, verifyEventOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const tierId = parseInt(req.params.tierId);

    const tier = await prisma.eventTicketTier.findFirst({
      where: { id: tierId, eventId },
      select: { soldQuantity: true }
    });

    if (!tier) {
      return res.status(404).json({ error: 'Ticket tier not found' });
    }

    if (tier.soldQuantity > 0) {
      // Soft delete if tickets have been sold
      await prisma.eventTicketTier.update({
        where: { id: tierId },
        data: { isActive: false }
      });

      return res.json({ 
        message: 'Ticket tier deactivated (tickets have been sold)',
        action: 'deactivated'
      });
    }

    // Hard delete if no tickets sold
    await prisma.eventTicketTier.delete({
      where: { id: tierId }
    });

    res.json({ 
      message: 'Ticket tier deleted successfully',
      action: 'deleted'
    });
  } catch (error) {
    console.error('Delete ticket tier error:', error);
    res.status(500).json({ error: 'Failed to delete ticket tier' });
  }
});

// ==================== ADD-ONS MANAGEMENT ====================

/**
 * POST /api/events/:eventId/add-ons
 * Create event add-on
 */
router.post('/events/:eventId/add-ons', protect, requireEventOrganizer, verifyEventOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const {
      name,
      description,
      category,
      price,
      isOptional,
      totalQuantity,
      maxPerUser,
      availableFrom,
      availableUntil
    } = req.body;

    if (!name || !category || price === undefined) {
      return res.status(400).json({ 
        error: 'Required fields: name, category, price' 
      });
    }

    const addOn = await prisma.eventAddOn.create({
      data: {
        eventId,
        name,
        description,
        category,
        price,
        isOptional: isOptional !== false,
        totalQuantity,
        maxPerUser: maxPerUser || 1,
        availableFrom: availableFrom ? new Date(availableFrom) : null,
        availableUntil: availableUntil ? new Date(availableUntil) : null,
        isActive: true
      }
    });

    res.status(201).json({ 
      addOn,
      message: 'Add-on created successfully'
    });
  } catch (error) {
    console.error('Create add-on error:', error);
    res.status(500).json({ error: 'Failed to create add-on' });
  }
});

/**
 * PUT /api/events/:eventId/add-ons/:addOnId
 * Update event add-on
 */
router.put('/events/:eventId/add-ons/:addOnId', protect, requireEventOrganizer, verifyEventOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const addOnId = parseInt(req.params.addOnId);
    const updates = req.body;

    const existingAddOn = await prisma.eventAddOn.findFirst({
      where: { id: addOnId, eventId }
    });

    if (!existingAddOn) {
      return res.status(404).json({ error: 'Add-on not found' });
    }

    const addOn = await prisma.eventAddOn.update({
      where: { id: addOnId },
      data: {
        ...updates,
        updatedAt: new Date()
      }
    });

    res.json({ 
      addOn,
      message: 'Add-on updated successfully'
    });
  } catch (error) {
    console.error('Update add-on error:', error);
    res.status(500).json({ error: 'Failed to update add-on' });
  }
});

// ==================== USER EVENT ROUTES ====================

/**
 * GET /api/my-events
 * Get user's organized events
 */
router.get('/my-events', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { status } = req.query;

    const where: any = { organizerId: userId };
    if (status) {
      where.status = status;
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        ticketTiers: {
          where: { isActive: true }
        },
        _count: {
          select: {
            attendees: true,
            tickets: { where: { status: 'CONFIRMED' } }
          }
        }
      }
    });

    const formattedEvents = events.map(formatEventResponse);

    res.json({ events: formattedEvents });
  } catch (error) {
    console.error('Get my events error:', error);
    res.status(500).json({ error: 'Failed to fetch your events' });
  }
});

/**
 * GET /api/my-tickets
 * Get user's event tickets
 */
router.get('/my-tickets', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { status, upcoming } = req.query;

    const where: any = { userId };
    
    if (status) {
      where.status = status;
    }

    const tickets = await prisma.eventTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        event: {
          include: {
            organizer: {
              select: { id: true, name: true }
            },
            merchant: {
              select: { 
                id: true, 
                businessName: true,
                address: true
              }
            }
          }
        },
        ticketTier: true
      }
    });

    // Filter upcoming if requested
    let filteredTickets = tickets;
    if (upcoming === 'true') {
      filteredTickets = tickets.filter(t => new Date(t.event.startDate) > new Date());
    }

    res.json({ tickets: filteredTickets });
  } catch (error) {
    console.error('Get my tickets error:', error);
    res.status(500).json({ error: 'Failed to fetch your tickets' });
  }
});

/**
 * GET /api/tickets/:ticketId/qr
 * Get ticket QR code
 */
router.get('/tickets/:ticketId/qr', protect, verifyTicketOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const ticketId = parseInt(req.params.ticketId);

    const ticket = await prisma.eventTicket.findUnique({
      where: { id: ticketId },
      select: { 
        qrCode: true,
        status: true,
        event: {
          select: { title: true, startDate: true }
        }
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (ticket.status === 'CANCELLED') {
      return res.status(400).json({ error: 'This ticket has been cancelled' });
    }

    // Generate QR code image
    const qrCodeImage = await generateQRCodeImage(ticket.qrCode);

    res.json({
      qrCode: ticket.qrCode,
      qrCodeImage,
      event: ticket.event
    });
  } catch (error) {
    console.error('Get ticket QR code error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

export default router;
