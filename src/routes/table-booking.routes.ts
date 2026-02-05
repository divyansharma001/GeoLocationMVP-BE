import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { protect, isMerchant, isApprovedMerchant } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';
import { z } from 'zod';

const router = Router();

// Validation schemas
const createTableSchema = z.object({
  name: z.string().min(1, 'Table name is required'),
  capacity: z.number().int().min(1, 'Capacity must be at least 1').max(20, 'Capacity cannot exceed 20'),
  features: z.array(z.string()).optional().default([])
});

const createTimeSlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
  duration: z.number().int().min(15, 'Duration must be at least 15 minutes').max(480, 'Duration cannot exceed 8 hours'),
  maxBookings: z.number().int().min(1).max(10).default(1)
});

const createBookingSchema = z.object({
  tableId: z.number().int().positive('Invalid table ID'),
  timeSlotId: z.number().int().positive('Invalid time slot ID'),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  partySize: z.number().int().min(1, 'Party size must be at least 1').max(20, 'Party size cannot exceed 20'),
  specialRequests: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional()
});

const updateBookingSettingsSchema = z.object({
  advanceBookingDays: z.number().int().min(1).max(365).optional(),
  minPartySize: z.number().int().min(1).optional(),
  maxPartySize: z.number().int().min(1).max(50).optional(),
  bookingDuration: z.number().int().min(15).max(480).optional(),
  requiresConfirmation: z.boolean().optional(),
  allowsModifications: z.boolean().optional(),
  allowsCancellations: z.boolean().optional(),
  cancellationHours: z.number().int().min(1).max(168).optional(),
  autoConfirm: z.boolean().optional(),
  sendReminders: z.boolean().optional(),
  reminderHours: z.number().int().min(1).max(24).optional()
});

// Helper function to generate confirmation code
function generateConfirmationCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Helper function to check if booking is within allowed time
async function isBookingAllowed(merchantId: number, bookingDate: string): Promise<{ allowed: boolean; reason?: string }> {
  const settings = await prisma.bookingSettings.findUnique({
    where: { merchantId }
  });

  if (!settings) {
    return { allowed: true }; // No restrictions if no settings
  }

  const bookingDateTime = new Date(bookingDate);
  const now = new Date();
  const daysDifference = Math.ceil((bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDifference < 0) {
    return { allowed: false, reason: 'Cannot book for past dates' };
  }

  if (daysDifference > settings.advanceBookingDays) {
    return { allowed: false, reason: `Cannot book more than ${settings.advanceBookingDays} days in advance` };
  }

  return { allowed: true };
}

// Helper function to check table availability
async function checkTableAvailability(tableId: number, timeSlotId: number, bookingDate: string, excludeBookingId?: number): Promise<{ available: boolean; reason?: string }> {
  const table = await prisma.table.findUnique({
    where: { id: tableId },
    include: { merchant: true }
  });

  if (!table) {
    return { available: false, reason: 'Table not found' };
  }

  if (table.status !== 'AVAILABLE') {
    return { available: false, reason: 'Table is not available' };
  }

  const timeSlot = await prisma.timeSlot.findUnique({
    where: { id: timeSlotId }
  });

  if (!timeSlot) {
    return { available: false, reason: 'Time slot not found' };
  }

  if (!timeSlot.isActive) {
    return { available: false, reason: 'Time slot is not active' };
  }

  // Check existing bookings for this table and time slot
  const existingBookings = await prisma.booking.count({
    where: {
      tableId,
      timeSlotId,
      bookingDate: new Date(bookingDate),
      status: { in: ['PENDING', 'CONFIRMED'] },
      id: excludeBookingId ? { not: excludeBookingId } : undefined
    }
  });

  if (existingBookings >= timeSlot.maxBookings) {
    return { available: false, reason: 'Time slot is fully booked' };
  }

  return { available: true };
}

// --- MERCHANT ENDPOINTS ---

// GET /api/table-booking/merchant/tables - Get merchant's tables
router.get('/merchant/tables', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const tables = await prisma.table.findMany({
      where: { merchantId },
      orderBy: { name: 'asc' }
    });

    res.status(200).json({ success: true, tables });
  } catch (error) {
    console.error('Get merchant tables error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/table-booking/merchant/tables - Create new table
router.post('/merchant/tables', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const validatedData = createTableSchema.parse(req.body);

    const table = await prisma.table.create({
      data: {
        merchantId,
        name: validatedData.name,
        capacity: validatedData.capacity,
        features: validatedData.features
      }
    });

    res.status(201).json({ success: true, table });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.issues });
    }
    console.error('Create table error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/table-booking/merchant/tables/:tableId - Update table
router.put('/merchant/tables/:tableId', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const tableId = parseInt(req.params.tableId as string);
    if (isNaN(tableId)) return res.status(400).json({ error: 'Invalid table ID' });

    const validatedData = createTableSchema.partial().parse(req.body);

    // Check if table belongs to merchant
    const existingTable = await prisma.table.findFirst({
      where: { id: tableId, merchantId }
    });

    if (!existingTable) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const table = await prisma.table.update({
      where: { id: tableId },
      data: validatedData
    });

    res.status(200).json({ success: true, table });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.issues });
    }
    console.error('Update table error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/table-booking/merchant/tables/:tableId - Delete table
router.delete('/merchant/tables/:tableId', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const tableId = parseInt(req.params.tableId as string);
    if (isNaN(tableId)) return res.status(400).json({ error: 'Invalid table ID' });

    // Check if table belongs to merchant
    const existingTable = await prisma.table.findFirst({
      where: { id: tableId, merchantId }
    });

    if (!existingTable) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Check if table has active bookings
    const activeBookings = await prisma.booking.count({
      where: {
        tableId,
        status: { in: ['PENDING', 'CONFIRMED'] }
      }
    });

    if (activeBookings > 0) {
      return res.status(400).json({ error: 'Cannot delete table with active bookings' });
    }

    await prisma.table.delete({
      where: { id: tableId }
    });

    res.status(200).json({ success: true, message: 'Table deleted successfully' });
  } catch (error) {
    console.error('Delete table error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/table-booking/merchant/time-slots - Get merchant's time slots
router.get('/merchant/time-slots', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { dayOfWeek } = req.query;

    const whereClause: any = { merchantId };
    if (dayOfWeek !== undefined) {
      whereClause.dayOfWeek = parseInt(dayOfWeek as string);
    }

    const timeSlots = await prisma.timeSlot.findMany({
      where: whereClause,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }]
    });

    res.status(200).json({ success: true, timeSlots });
  } catch (error) {
    console.error('Get time slots error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/table-booking/merchant/time-slots - Create time slot
router.post('/merchant/time-slots', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const validatedData = createTimeSlotSchema.parse(req.body);

    // Validate time range
    const startTime = new Date(`1970-01-01T${validatedData.startTime}:00`);
    const endTime = new Date(`1970-01-01T${validatedData.endTime}:00`);
    
    if (startTime >= endTime) {
      return res.status(400).json({ error: 'Start time must be before end time' });
    }

    const timeSlot = await prisma.timeSlot.create({
      data: {
        merchantId,
        dayOfWeek: validatedData.dayOfWeek,
        startTime: validatedData.startTime,
        endTime: validatedData.endTime,
        duration: validatedData.duration,
        maxBookings: validatedData.maxBookings
      }
    });

    res.status(201).json({ success: true, timeSlot });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.issues });
    }
    console.error('Create time slot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/table-booking/merchant/time-slots/:timeSlotId - Update time slot
router.put('/merchant/time-slots/:timeSlotId', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const timeSlotId = parseInt(req.params.timeSlotId as string);
    if (isNaN(timeSlotId)) return res.status(400).json({ error: 'Invalid time slot ID' });

    const validatedData = createTimeSlotSchema.partial().parse(req.body);

    // Check if time slot belongs to merchant
    const existingTimeSlot = await prisma.timeSlot.findFirst({
      where: { id: timeSlotId, merchantId }
    });

    if (!existingTimeSlot) {
      return res.status(404).json({ error: 'Time slot not found' });
    }

    const timeSlot = await prisma.timeSlot.update({
      where: { id: timeSlotId },
      data: validatedData
    });

    res.status(200).json({ success: true, timeSlot });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.issues });
    }
    console.error('Update time slot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/table-booking/merchant/time-slots/:timeSlotId - Delete time slot
router.delete('/merchant/time-slots/:timeSlotId', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const timeSlotId = parseInt(req.params.timeSlotId as string);
    if (isNaN(timeSlotId)) return res.status(400).json({ error: 'Invalid time slot ID' });

    // Check if time slot belongs to merchant
    const existingTimeSlot = await prisma.timeSlot.findFirst({
      where: { id: timeSlotId, merchantId }
    });

    if (!existingTimeSlot) {
      return res.status(404).json({ error: 'Time slot not found' });
    }

    // Check if time slot has active bookings
    const activeBookings = await prisma.booking.count({
      where: {
        timeSlotId,
        status: { in: ['PENDING', 'CONFIRMED'] }
      }
    });

    if (activeBookings > 0) {
      return res.status(400).json({ error: 'Cannot delete time slot with active bookings' });
    }

    await prisma.timeSlot.delete({
      where: { id: timeSlotId }
    });

    res.status(200).json({ success: true, message: 'Time slot deleted successfully' });
  } catch (error) {
    console.error('Delete time slot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/table-booking/merchant/bookings - Get merchant's bookings
router.get('/merchant/bookings', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { 
      status, 
      date, 
      page = '1', 
      limit = '20' 
    } = req.query as any;

    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    const whereClause: any = { merchantId };
    
    if (status) {
      whereClause.status = status;
    }
    
    if (date) {
      whereClause.bookingDate = new Date(date);
    }

    const [bookings, totalCount] = await Promise.all([
      prisma.booking.findMany({
        where: whereClause,
        include: {
          table: {
            select: {
              id: true,
              name: true,
              capacity: true,
              features: true,
              status: true
            }
          },
          timeSlot: {
            select: {
              id: true,
              startTime: true,
              endTime: true,
              duration: true
            }
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              createdAt: true
            }
          },
          merchant: {
            select: {
              id: true,
              businessName: true,
              phoneNumber: true
            }
          }
        },
        orderBy: { bookingDate: 'desc' },
        skip: offset,
        take: limitNum
      }),
      prisma.booking.count({ where: whereClause })
    ]);

    res.status(200).json({
      success: true,
      bookings,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: Math.ceil(totalCount / limitNum)
      }
    });
  } catch (error) {
    console.error('Get merchant bookings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/table-booking/merchant/bookings/:bookingId/status - Update booking status
router.put('/merchant/bookings/:bookingId/status', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const bookingId = parseInt(req.params.bookingId as string);
    if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

    const { status, notes } = req.body;

    if (!['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Check if booking belongs to merchant
    const existingBooking = await prisma.booking.findFirst({
      where: { id: bookingId, merchantId }
    });

    if (!existingBooking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const updateData: any = { status };
    
    if (status === 'CONFIRMED' && existingBooking.status !== 'CONFIRMED') {
      updateData.confirmedAt = new Date();
    }
    
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: updateData,
      include: {
        table: {
          select: {
            id: true,
            name: true,
            capacity: true,
            features: true,
            status: true
          }
        },
        timeSlot: {
          select: {
            id: true,
            startTime: true,
            endTime: true,
            duration: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true
          }
        },
        merchant: {
          select: {
            id: true,
            businessName: true,
            phoneNumber: true
          }
        }
      }
    });

    res.status(200).json({ success: true, booking });
  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/table-booking/merchant/settings - Get booking settings
router.get('/merchant/settings', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    let settings = await prisma.bookingSettings.findUnique({
      where: { merchantId }
    });

    // Create default settings if none exist
    if (!settings) {
      settings = await prisma.bookingSettings.create({
        data: { merchantId }
      });
    }

    res.status(200).json({ success: true, settings });
  } catch (error) {
    console.error('Get booking settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/table-booking/merchant/settings - Update booking settings
router.put('/merchant/settings', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const validatedData = updateBookingSettingsSchema.parse(req.body);

    const settings = await prisma.bookingSettings.upsert({
      where: { merchantId },
      update: validatedData,
      create: {
        merchantId,
        ...validatedData
      }
    });

    res.status(200).json({ success: true, settings });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.issues });
    }
    console.error('Update booking settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- PUBLIC ENDPOINTS ---

// GET /api/table-booking/merchants/:merchantId/availability - Get available time slots
router.get('/merchants/:merchantId/availability', async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = parseInt(req.params.merchantId as string);
    if (isNaN(merchantId)) return res.status(400).json({ error: 'Invalid merchant ID' });

    const { date, partySize = '1' } = req.query as any;
    
    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    const partySizeNum = parseInt(partySize) || 1;

    // Check if merchant exists and is approved
    const merchant = await prisma.merchant.findFirst({
      where: { id: merchantId, status: 'APPROVED' }
    });

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found or not approved' });
    }

    // Check if booking is allowed
    const bookingAllowed = await isBookingAllowed(merchantId, date);
    if (!bookingAllowed.allowed) {
      return res.status(400).json({ error: bookingAllowed.reason });
    }

    const bookingDate = new Date(date);
    const dayOfWeek = bookingDate.getDay();

    // Get available time slots for this day
    const timeSlots = await prisma.timeSlot.findMany({
      where: {
        merchantId,
        dayOfWeek,
        isActive: true
      },
      include: {
        bookings: {
          where: {
            bookingDate,
            status: { in: ['PENDING', 'CONFIRMED'] }
          }
        }
      },
      orderBy: { startTime: 'asc' }
    });

    // Get available tables that can accommodate the party size
    const availableTables = await prisma.table.findMany({
      where: {
        merchantId,
        status: 'AVAILABLE',
        capacity: { gte: partySizeNum }
      },
      orderBy: { capacity: 'asc' }
    });

    const availableTimeSlots = timeSlots
      .filter(slot => {
        // Check if there are available tables for this time slot
        const hasAvailableTable = availableTables.some(table => 
          slot.bookings.filter(booking => booking.tableId === table.id).length < slot.maxBookings
        );
        return hasAvailableTable;
      })
      .map(slot => ({
        id: slot.id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        duration: slot.duration,
        maxBookings: slot.maxBookings,
        currentBookings: slot.bookings.length,
        availableSpots: slot.maxBookings - slot.bookings.length
      }));

    // Find next available time slot (for suggested booking)
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes(); // Current time in minutes since midnight
    
    let nextAvailableSlot = null;
    for (const slot of availableTimeSlots) {
      const [slotHour, slotMinute] = slot.startTime.split(':').map(Number);
      const slotTime = slotHour * 60 + slotMinute;
      
      // If this is a future slot today, or any slot for future dates
      const isToday = bookingDate.toDateString() === now.toDateString();
      if (!isToday || slotTime > currentTime) {
        nextAvailableSlot = {
          ...slot,
          isNextAvailable: true
        };
        break;
      }
    }

    // If no slot today, find next day with available slots
    let nextAvailableDate = null;
    let nextAvailableTimeSlot = nextAvailableSlot;
    
    if (!nextAvailableSlot) {
      // Check next 30 days for availability
      for (let i = 1; i <= 30; i++) {
        const nextDate = new Date(bookingDate);
        nextDate.setDate(nextDate.getDate() + i);
        
        const nextDayOfWeek = nextDate.getDay();
        
        // Get time slots for this future day
        const futureTimeSlots = await prisma.timeSlot.findMany({
          where: {
            merchantId,
            dayOfWeek: nextDayOfWeek,
            isActive: true
          },
          include: {
            bookings: {
              where: {
                bookingDate: nextDate,
                status: { in: ['PENDING', 'CONFIRMED'] }
              }
            }
          },
          orderBy: { startTime: 'asc' }
        });

        // Check if any slot is available
        for (const slot of futureTimeSlots) {
          const hasAvailableTable = availableTables.some(table => 
            slot.bookings.filter(booking => booking.tableId === table.id).length < slot.maxBookings
          );
          
          if (hasAvailableTable) {
            nextAvailableDate = nextDate.toISOString().split('T')[0];
            nextAvailableTimeSlot = {
              id: slot.id,
              startTime: slot.startTime,
              endTime: slot.endTime,
              duration: slot.duration,
              maxBookings: slot.maxBookings,
              currentBookings: slot.bookings.length,
              availableSpots: slot.maxBookings - slot.bookings.length,
              isNextAvailable: true
            };
            break;
          }
        }
        
        if (nextAvailableTimeSlot) break;
      }
    }

    res.status(200).json({
      success: true,
      date,
      partySize: partySizeNum,
      availableTimeSlots,
      availableTables: availableTables.map(table => ({
        id: table.id,
        name: table.name,
        capacity: table.capacity,
        features: table.features
      })),
      nextAvailableSlot: nextAvailableTimeSlot,
      nextAvailableDate
    });
  } catch (error) {
    console.error('Get availability error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/table-booking/bookings - Create booking
router.post('/bookings', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const validatedData = createBookingSchema.parse(req.body);

    // Get table and time slot info
    const [table, timeSlot] = await Promise.all([
      prisma.table.findUnique({
        where: { id: validatedData.tableId },
        include: { merchant: true }
      }),
      prisma.timeSlot.findUnique({
        where: { id: validatedData.timeSlotId }
      })
    ]);

    if (!table || !timeSlot) {
      return res.status(404).json({ error: 'Table or time slot not found' });
    }

    if (table.merchant.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Merchant is not approved for bookings' });
    }

    if (table.merchant.id !== timeSlot.merchantId) {
      return res.status(400).json({ error: 'Table and time slot do not belong to the same merchant' });
    }

    // Check if booking is allowed
    const bookingAllowed = await isBookingAllowed(table.merchant.id, validatedData.bookingDate);
    if (!bookingAllowed.allowed) {
      return res.status(400).json({ error: bookingAllowed.reason });
    }

    // Check table availability
    const availability = await checkTableAvailability(
      validatedData.tableId, 
      validatedData.timeSlotId, 
      validatedData.bookingDate
    );

    if (!availability.available) {
      return res.status(400).json({ error: availability.reason });
    }

    // Check party size constraints
    const settings = await prisma.bookingSettings.findUnique({
      where: { merchantId: table.merchant.id }
    });

    if (settings) {
      if (validatedData.partySize < settings.minPartySize) {
        return res.status(400).json({ error: `Minimum party size is ${settings.minPartySize}` });
      }
      if (validatedData.partySize > settings.maxPartySize) {
        return res.status(400).json({ error: `Maximum party size is ${settings.maxPartySize}` });
      }
    }

    // Generate confirmation code
    let confirmationCode: string;
    let isUnique = false;
    do {
      confirmationCode = generateConfirmationCode();
      const existing = await prisma.booking.findUnique({
        where: { confirmationCode }
      });
      isUnique = !existing;
    } while (!isUnique);

    // Create booking
    const booking = await prisma.booking.create({
      data: {
        merchantId: table.merchant.id,
        tableId: validatedData.tableId,
        timeSlotId: validatedData.timeSlotId,
        userId,
        bookingDate: new Date(validatedData.bookingDate),
        partySize: validatedData.partySize,
        specialRequests: validatedData.specialRequests,
        contactPhone: validatedData.contactPhone,
        contactEmail: validatedData.contactEmail,
        confirmationCode,
        status: settings?.autoConfirm ? 'CONFIRMED' : 'PENDING',
        confirmedAt: settings?.autoConfirm ? new Date() : null
      },
      include: {
        table: true,
        timeSlot: true,
        merchant: {
          select: {
            id: true,
            businessName: true,
            phoneNumber: true
          }
        }
      }
    });

    res.status(201).json({ success: true, booking });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.issues });
    }
    console.error('Create booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/table-booking/bookings - Get user's bookings
router.get('/bookings', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { status, page = '1', limit = '20' } = req.query as any;

    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    const whereClause: any = { userId };
    if (status) {
      whereClause.status = status;
    }

    const [bookings, totalCount] = await Promise.all([
      prisma.booking.findMany({
        where: whereClause,
        include: {
          table: true,
          timeSlot: true,
          merchant: {
            select: {
              id: true,
              businessName: true,
              phoneNumber: true
            }
          }
        },
        orderBy: { bookingDate: 'desc' },
        skip: offset,
        take: limitNum
      }),
      prisma.booking.count({ where: whereClause })
    ]);

    res.status(200).json({
      success: true,
      bookings,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: Math.ceil(totalCount / limitNum)
      }
    });
  } catch (error) {
    console.error('Get user bookings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/table-booking/bookings/:confirmationCode - Get booking by confirmation code
router.get('/bookings/:confirmationCode', protect, async (req: AuthRequest, res: Response) => {
  try {
    const confirmationCode = req.params.confirmationCode as string;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const booking = await prisma.booking.findUnique({
      where: { confirmationCode },
      include: {
        table: true,
        timeSlot: true,
        merchant: {
          select: {
            id: true,
            businessName: true,
            phoneNumber: true
          }
        }
      }
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Users can only view their own bookings
    if (booking.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.status(200).json({ success: true, booking });
  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/table-booking/bookings/:bookingId - Update booking
router.put('/bookings/:bookingId', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const bookingId = parseInt(req.params.bookingId as string);
    if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

    const { partySize, specialRequests, contactPhone, contactEmail } = req.body;

    // Get existing booking
    const existingBooking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        table: true,
        timeSlot: true,
        merchant: {
          include: {
            bookingSettings: true
          }
        }
      }
    });

    if (!existingBooking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (existingBooking.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (existingBooking.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Cannot modify cancelled booking' });
    }

    // Check if modifications are allowed
    const settings = existingBooking.merchant.bookingSettings;
    if (settings && !settings.allowsModifications) {
      return res.status(400).json({ error: 'Modifications are not allowed for this merchant' });
    }

    // Validate party size if provided
    if (partySize !== undefined) {
      if (settings) {
        if (partySize < settings.minPartySize) {
          return res.status(400).json({ error: `Minimum party size is ${settings.minPartySize}` });
        }
        if (partySize > settings.maxPartySize) {
          return res.status(400).json({ error: `Maximum party size is ${settings.maxPartySize}` });
        }
      }

      // Check if new party size fits table capacity
      if (partySize > existingBooking.table.capacity) {
        return res.status(400).json({ error: 'Party size exceeds table capacity' });
      }
    }

    const updateData: any = {};
    if (partySize !== undefined) updateData.partySize = partySize;
    if (specialRequests !== undefined) updateData.specialRequests = specialRequests;
    if (contactPhone !== undefined) updateData.contactPhone = contactPhone;
    if (contactEmail !== undefined) updateData.contactEmail = contactEmail;

    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: updateData,
      include: {
        table: true,
        timeSlot: true,
        merchant: {
          select: {
            id: true,
            businessName: true,
            phoneNumber: true
          }
        }
      }
    });

    res.status(200).json({ success: true, booking });
  } catch (error) {
    console.error('Update booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/table-booking/bookings/:bookingId - Cancel booking
router.delete('/bookings/:bookingId', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const bookingId = parseInt(req.params.bookingId as string);
    if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

    // Get existing booking
    const existingBooking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        merchant: {
          include: {
            bookingSettings: true
          }
        }
      }
    });

    if (!existingBooking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (existingBooking.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (existingBooking.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Booking is already cancelled' });
    }

    // Check if cancellations are allowed
    const settings = existingBooking.merchant.bookingSettings;
    if (settings && !settings.allowsCancellations) {
      return res.status(400).json({ error: 'Cancellations are not allowed for this merchant' });
    }

    // Check cancellation time limit
    if (settings && settings.cancellationHours) {
      const bookingDateTime = new Date(existingBooking.bookingDate);
      const now = new Date();
      const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      if (hoursUntilBooking < settings.cancellationHours) {
        return res.status(400).json({ 
          error: `Cancellation must be made at least ${settings.cancellationHours} hours before the booking time` 
        });
      }
    }

    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: userId
      },
      include: {
        table: true,
        timeSlot: true,
        merchant: {
          select: {
            id: true,
            businessName: true,
            phoneNumber: true
          }
        }
      }
    });

    res.status(200).json({ success: true, booking });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

