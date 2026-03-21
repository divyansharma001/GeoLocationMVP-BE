// src/services/service-catalog.service.ts

import prisma from '../lib/prisma';
import crypto from 'crypto';
import { CacheTTL, createCacheKey, getOrSetCache, invalidateCachePattern } from '../lib/cache';

const QR_SECRET = process.env.QR_CODE_SECRET || 'default-qr-secret-change-in-production';

function generateBookingQRData(bookingId: number, serviceId: number, userId: number, confirmationCode: string): string {
  const dataString = `SVC|${bookingId}|${serviceId}|${userId}|${confirmationCode}|${Date.now()}`;
  const sig = crypto.createHmac('sha256', QR_SECRET).update(dataString).digest('hex');
  return `${dataString}|${sig}`;
}

export function verifyBookingQRData(qrData: string): { bookingId: number; serviceId: number; userId: number; confirmationCode: string } | null {
  try {
    const parts = qrData.split('|');
    if (parts.length !== 7 || parts[0] !== 'SVC') return null;
    const [, bookingId, serviceId, userId, confirmationCode, timestamp, sig] = parts;
    const dataString = `SVC|${bookingId}|${serviceId}|${userId}|${confirmationCode}|${timestamp}`;
    const expected = crypto.createHmac('sha256', QR_SECRET).update(dataString).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return {
      bookingId: parseInt(bookingId),
      serviceId: parseInt(serviceId),
      userId: parseInt(userId),
      confirmationCode,
    };
  } catch {
    return null;
  }
}

function generateConfirmationCode(): string {
  return 'SVC-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function invalidateServiceCaches(serviceId?: number, merchantId?: number): Promise<void> {
  await Promise.all([
    invalidateCachePattern('*', 'services:public'),
    invalidateCachePattern('*', 'services:merchant'),
    serviceId ? invalidateCachePattern(`${serviceId}:*`, 'services:detail') : Promise.resolve(),
    merchantId ? invalidateCachePattern(`${merchantId}:*`, 'services:merchant-public') : Promise.resolve(),
  ]);
}

// ── Service CRUD ──

export async function createService(merchantId: number, data: {
  title: string;
  description: string;
  shortDescription?: string;
  serviceType: string;
  category?: string;
  durationMinutes: number;
  coverImageUrl?: string;
  imageGallery?: string[];
  tags?: string[];
  requiresApproval?: boolean;
  advanceBookingDays?: number;
  cancellationHours?: number;
  maxBookingsPerDay?: number;
}) {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, status: true },
  });
  if (!merchant) throw new Error('Merchant not found');
  if (merchant.status !== 'APPROVED') throw new Error('Merchant is not approved');
  if (!data.title?.trim()) throw new Error('title is required');
  if (!data.description?.trim()) throw new Error('description is required');
  if (!data.serviceType?.trim()) throw new Error('serviceType is required');
  if (!data.durationMinutes || data.durationMinutes < 1) throw new Error('durationMinutes must be at least 1');

  const service = await (prisma as any).service.create({
    data: {
      merchantId,
      title: data.title.trim(),
      description: data.description.trim(),
      shortDescription: data.shortDescription?.trim() ?? null,
      serviceType: data.serviceType.trim(),
      category: data.category?.trim() ?? null,
      durationMinutes: data.durationMinutes,
      coverImageUrl: data.coverImageUrl ?? null,
      imageGallery: data.imageGallery ?? [],
      tags: data.tags ?? [],
      requiresApproval: data.requiresApproval ?? false,
      advanceBookingDays: data.advanceBookingDays ?? 30,
      cancellationHours: data.cancellationHours ?? 24,
      maxBookingsPerDay: data.maxBookingsPerDay ?? null,
      status: 'DRAFT',
    },
    include: { merchant: { select: { id: true, businessName: true } } },
  });
  await invalidateServiceCaches(service.id, merchantId);
  return service;
}

export async function publishService(merchantId: number, serviceId: number) {
  const service = await (prisma as any).service.findUnique({
    where: { id: serviceId },
    include: { pricingTiers: { where: { isActive: true } } },
  });
  if (!service) throw new Error('Service not found');
  if (service.merchantId !== merchantId) throw new Error('Service not found');
  if (service.status !== 'DRAFT' && service.status !== 'PAUSED') {
    throw new Error(`Cannot publish service with status ${service.status}`);
  }
  if (!service.pricingTiers || service.pricingTiers.length === 0) {
    throw new Error('Add at least one pricing tier before publishing');
  }
  if (!service.coverImageUrl) {
    throw new Error('Add a cover image before publishing');
  }
  const publishedService = await (prisma as any).service.update({
    where: { id: serviceId },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  });
  await invalidateServiceCaches(serviceId, merchantId);
  return publishedService;
}

export async function pauseService(merchantId: number, serviceId: number) {
  const service = await (prisma as any).service.findUnique({ where: { id: serviceId } });
  if (!service) throw new Error('Service not found');
  if (service.merchantId !== merchantId) throw new Error('Service not found');
  if (service.status !== 'PUBLISHED') throw new Error('Only published services can be paused');
  const pausedService = await (prisma as any).service.update({ where: { id: serviceId }, data: { status: 'PAUSED' } });
  await invalidateServiceCaches(serviceId, merchantId);
  return pausedService;
}

export async function cancelService(merchantId: number, serviceId: number) {
  const service = await (prisma as any).service.findUnique({
    where: { id: serviceId },
    select: { id: true, merchantId: true, status: true },
  });
  if (!service) throw new Error('Service not found');
  if (service.merchantId !== merchantId) throw new Error('Service not found');
  // Cancel pending/confirmed bookings
  await (prisma as any).serviceBooking.updateMany({
    where: { serviceId, status: { in: ['PENDING', 'CONFIRMED'] } },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'Service cancelled by merchant' },
  });
  const updated = await (prisma as any).service.update({
    where: { id: serviceId },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });
  await invalidateServiceCaches(serviceId, merchantId);
  return updated;
}

export async function updateService(merchantId: number, serviceId: number, data: Record<string, any>) {
  const service = await (prisma as any).service.findUnique({ where: { id: serviceId } });
  if (!service) throw new Error('Service not found');
  if (service.merchantId !== merchantId) throw new Error('Service not found');

  const allowed = ['title', 'description', 'shortDescription', 'serviceType', 'category',
    'durationMinutes', 'coverImageUrl', 'imageGallery', 'tags', 'requiresApproval',
    'advanceBookingDays', 'cancellationHours', 'maxBookingsPerDay'];
  const updateData: Record<string, any> = {};
  for (const key of allowed) {
    if (data[key] !== undefined) updateData[key] = data[key];
  }
  const updatedService = await (prisma as any).service.update({ where: { id: serviceId }, data: updateData });
  await invalidateServiceCaches(serviceId, merchantId);
  return updatedService;
}

export async function deleteService(merchantId: number, serviceId: number) {
  const service = await (prisma as any).service.findUnique({
    where: { id: serviceId },
    select: { id: true, merchantId: true },
  });
  if (!service) throw new Error('Service not found');
  if (service.merchantId !== merchantId) throw new Error('Service not found');
  const confirmedBookings = await (prisma as any).serviceBooking.count({
    where: { serviceId, status: { in: ['CONFIRMED', 'PENDING'] } },
  });
  if (confirmedBookings > 0) {
    // Soft delete: cancel the service
    return cancelService(merchantId, serviceId);
  }
  await (prisma as any).service.delete({ where: { id: serviceId } });
  await invalidateServiceCaches(serviceId, merchantId);
  return { deleted: true };
}

export async function getMerchantServices(merchantId: number, filters?: { status?: string }) {
  const where: any = { merchantId };
  if (filters?.status) where.status = filters.status;
  const cacheKey = createCacheKey([merchantId, filters?.status || 'all']);
  const { value } = await getOrSetCache({
    namespace: 'services:merchant',
    key: cacheKey,
    ttlMs: CacheTTL.MERCHANT_DASHBOARD,
    loader: () => (prisma as any).service.findMany({
      where,
      include: {
        pricingTiers: { where: { isActive: true } },
        addOns: { where: { isActive: true } },
        _count: { select: { bookings: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  });
  return value;
}

export async function getPublicServices(filters?: {
  serviceType?: string;
  merchantId?: number;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const where: any = { status: 'PUBLISHED' };
  if (filters?.serviceType) where.serviceType = { contains: filters.serviceType, mode: 'insensitive' };
  if (filters?.merchantId) where.merchantId = filters.merchantId;
  if (filters?.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
      { tags: { has: filters.search } },
    ];
  }
  const cacheKey = createCacheKey([
    filters?.serviceType || '',
    filters?.merchantId || '',
    filters?.search || '',
    page,
    limit,
  ]);
  const namespace = filters?.merchantId ? 'services:merchant-public' : 'services:public';
  const { value } = await getOrSetCache({
    namespace,
    key: filters?.merchantId ? `${filters.merchantId}:${cacheKey}` : cacheKey,
    ttlMs: CacheTTL.PUBLIC_LIST,
    loader: async () => {
      const [services, total] = await Promise.all([
        (prisma as any).service.findMany({
          where,
          include: {
            merchant: { select: { id: true, businessName: true, logoUrl: true, address: true } },
            pricingTiers: { where: { isActive: true }, orderBy: { price: 'asc' } },
            addOns: { where: { isActive: true } },
            _count: { select: { bookings: true } },
          },
          orderBy: { publishedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (prisma as any).service.count({ where }),
      ]);
      return {
        services,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total },
      };
    },
  });
  return value;
}

// ── Pricing Tiers ──

export async function createPricingTier(merchantId: number, serviceId: number, data: {
  name: string;
  description?: string;
  price: number;
  durationMinutes: number;
  totalSlots?: number;
  maxPerUser?: number;
}) {
  const service = await (prisma as any).service.findUnique({ where: { id: serviceId } });
  if (!service) throw new Error('Service not found');
  if (service.merchantId !== merchantId) throw new Error('Service not found');
  if (!data.name?.trim()) throw new Error('name is required');
  if (data.price < 0) throw new Error('price cannot be negative');
  if (data.durationMinutes < 1) throw new Error('durationMinutes must be at least 1');

  return (prisma as any).servicePricingTier.create({
    data: {
      serviceId,
      name: data.name.trim(),
      description: data.description?.trim() ?? null,
      price: data.price,
      durationMinutes: data.durationMinutes,
      totalSlots: data.totalSlots ?? null,
      maxPerUser: data.maxPerUser ?? 1,
    },
  });
}

export async function updatePricingTier(merchantId: number, serviceId: number, tierId: number, data: Record<string, any>) {
  const tier = await (prisma as any).servicePricingTier.findFirst({ where: { id: tierId, serviceId } });
  if (!tier) throw new Error('Pricing tier not found');
  const service = await (prisma as any).service.findUnique({ where: { id: serviceId } });
  if (service?.merchantId !== merchantId) throw new Error('Pricing tier not found');
  const allowed = ['name', 'description', 'price', 'durationMinutes', 'totalSlots', 'maxPerUser', 'isActive'];
  const updateData: Record<string, any> = {};
  for (const key of allowed) {
    if (data[key] !== undefined) updateData[key] = data[key];
  }
  return (prisma as any).servicePricingTier.update({ where: { id: tierId }, data: updateData });
}

export async function deletePricingTier(merchantId: number, serviceId: number, tierId: number) {
  const tier = await (prisma as any).servicePricingTier.findFirst({ where: { id: tierId, serviceId } });
  if (!tier) throw new Error('Pricing tier not found');
  const service = await (prisma as any).service.findUnique({ where: { id: serviceId } });
  if (service?.merchantId !== merchantId) throw new Error('Pricing tier not found');
  const hasBookings = await (prisma as any).serviceBooking.count({ where: { tierId } });
  if (hasBookings > 0) {
    return (prisma as any).servicePricingTier.update({ where: { id: tierId }, data: { isActive: false } });
  }
  await (prisma as any).servicePricingTier.delete({ where: { id: tierId } });
  return { deleted: true };
}

// ── Add-Ons ──

export async function createAddOn(merchantId: number, serviceId: number, data: {
  name: string;
  description?: string;
  price: number;
  isOptional?: boolean;
}) {
  const service = await (prisma as any).service.findUnique({ where: { id: serviceId } });
  if (!service || service.merchantId !== merchantId) throw new Error('Service not found');
  if (!data.name?.trim()) throw new Error('name is required');
  if (data.price < 0) throw new Error('price cannot be negative');
  return (prisma as any).serviceAddOn.create({
    data: {
      serviceId,
      name: data.name.trim(),
      description: data.description?.trim() ?? null,
      price: data.price,
      isOptional: data.isOptional !== false,
    },
  });
}

export async function updateAddOn(merchantId: number, serviceId: number, addOnId: number, data: Record<string, any>) {
  const service = await (prisma as any).service.findUnique({ where: { id: serviceId } });
  if (!service || service.merchantId !== merchantId) throw new Error('Service not found');
  const addOn = await (prisma as any).serviceAddOn.findFirst({ where: { id: addOnId, serviceId } });
  if (!addOn) throw new Error('Add-on not found');
  const allowed = ['name', 'description', 'price', 'isOptional', 'isActive'];
  const updateData: Record<string, any> = {};
  for (const key of allowed) {
    if (data[key] !== undefined) updateData[key] = data[key];
  }
  return (prisma as any).serviceAddOn.update({ where: { id: addOnId }, data: updateData });
}

export async function deleteAddOn(merchantId: number, serviceId: number, addOnId: number) {
  const service = await (prisma as any).service.findUnique({ where: { id: serviceId } });
  if (!service || service.merchantId !== merchantId) throw new Error('Service not found');
  const addOn = await (prisma as any).serviceAddOn.findFirst({ where: { id: addOnId, serviceId } });
  if (!addOn) throw new Error('Add-on not found');
  const hasPurchases = await (prisma as any).serviceAddOnPurchase.count({ where: { addOnId } });
  if (hasPurchases > 0) {
    return (prisma as any).serviceAddOn.update({ where: { id: addOnId }, data: { isActive: false } });
  }
  await (prisma as any).serviceAddOn.delete({ where: { id: addOnId } });
  return { deleted: true };
}

// ── Bookings ──

export async function reserveServiceBooking(userId: number, data: {
  serviceId: number;
  tierId: number;
  bookingDate: Date;
  startTime: string;
  notes?: string;
  specialRequests?: string;
  contactPhone?: string;
  contactEmail?: string;
  addOns?: { addOnId: number; quantity: number }[];
}) {
  const service = await (prisma as any).service.findUnique({
    where: { id: data.serviceId },
    include: { pricingTiers: true },
  });
  if (!service) throw new Error('Service not found');
  if (service.status !== 'PUBLISHED') throw new Error('Service is not available for booking');

  const tier = service.pricingTiers.find((t: any) => t.id === data.tierId && t.isActive);
  if (!tier) throw new Error('Pricing tier not found or inactive');

  // Validate advance booking window
  const now = new Date();
  const bookingDate = new Date(data.bookingDate);
  const maxFutureDate = new Date(now.getTime() + service.advanceBookingDays * 24 * 60 * 60 * 1000);
  if (bookingDate < now) throw new Error('Booking date must be in the future');
  if (bookingDate > maxFutureDate) throw new Error(`Cannot book more than ${service.advanceBookingDays} days in advance`);

  // Check per-user limit
  const userBookingCount = await (prisma as any).serviceBooking.count({
    where: { tierId: data.tierId, userId, status: { in: ['PENDING', 'CONFIRMED'] } },
  });
  if (userBookingCount >= tier.maxPerUser) {
    throw new Error(`You have reached the maximum bookings for this tier`);
  }

  // Check slot availability for the day
  if (tier.totalSlots !== null) {
    const dayStart = new Date(bookingDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(bookingDate);
    dayEnd.setHours(23, 59, 59, 999);
    const existingBookings = await (prisma as any).serviceBooking.count({
      where: {
        tierId: data.tierId,
        bookingDate: { gte: dayStart, lte: dayEnd },
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
    });
    if (existingBookings >= tier.totalSlots) throw new Error('No slots available for this date');
  }

  // Calculate endTime
  const [hh, mm] = data.startTime.split(':').map(Number);
  const endMinutes = hh * 60 + mm + tier.durationMinutes;
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

  // Validate add-ons
  let addOnTotal = 0;
  const addOnData: any[] = [];
  if (data.addOns && data.addOns.length > 0) {
    const addOnIds = data.addOns.map((a) => a.addOnId);
    const addOns = await (prisma as any).serviceAddOn.findMany({
      where: { id: { in: addOnIds }, serviceId: data.serviceId, isActive: true },
    });
    if (addOns.length !== addOnIds.length) throw new Error('One or more add-ons not found or inactive');
    for (const a of data.addOns) {
      const addOn = addOns.find((ao: any) => ao.id === a.addOnId);
      addOnTotal += addOn.price * a.quantity;
      addOnData.push({ addOnId: a.addOnId, quantity: a.quantity, unitPrice: addOn.price, totalPrice: addOn.price * a.quantity });
    }
  }

  const confirmationCode = generateConfirmationCode();

  const booking = await (prisma as any).serviceBooking.create({
    data: {
      serviceId: data.serviceId,
      tierId: data.tierId,
      userId,
      merchantId: service.merchantId,
      bookingDate,
      startTime: data.startTime,
      endTime,
      status: service.requiresApproval ? 'PENDING' : 'CONFIRMED',
      confirmationCode,
      qrCode: generateBookingQRData(0, data.serviceId, userId, confirmationCode), // temp; updated below
      notes: data.notes ?? null,
      specialRequests: data.specialRequests ?? null,
      contactPhone: data.contactPhone ?? null,
      contactEmail: data.contactEmail ?? null,
      price: tier.price,
      confirmedAt: service.requiresApproval ? null : new Date(),
    },
  });

  // Update qrCode with real bookingId
  const realQR = generateBookingQRData(booking.id, data.serviceId, userId, confirmationCode);
  await (prisma as any).serviceBooking.update({ where: { id: booking.id }, data: { qrCode: realQR } });

  // Create add-on purchases
  if (addOnData.length > 0) {
    await (prisma as any).serviceAddOnPurchase.createMany({
      data: addOnData.map((a) => ({ ...a, bookingId: booking.id, userId })),
    });
  }

  return {
    ...booking,
    qrCode: realQR,
    totalAmount: tier.price + addOnTotal,
    addOnPurchases: addOnData,
  };
}

export async function confirmBooking(merchantId: number, bookingId: number) {
  const booking = await (prisma as any).serviceBooking.findFirst({
    where: { id: bookingId, merchantId },
  });
  if (!booking) throw new Error('Booking not found');
  if (booking.status !== 'PENDING') throw new Error('Only pending bookings can be confirmed');
  return (prisma as any).serviceBooking.update({
    where: { id: bookingId },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  });
}

export async function completeBooking(merchantId: number, bookingId: number) {
  const booking = await (prisma as any).serviceBooking.findFirst({
    where: { id: bookingId, merchantId },
  });
  if (!booking) throw new Error('Booking not found');
  if (booking.status !== 'CONFIRMED') throw new Error('Only confirmed bookings can be completed');
  return (prisma as any).serviceBooking.update({
    where: { id: bookingId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
}

export async function markNoShow(merchantId: number, bookingId: number) {
  const booking = await (prisma as any).serviceBooking.findFirst({
    where: { id: bookingId, merchantId },
  });
  if (!booking) throw new Error('Booking not found');
  if (booking.status !== 'CONFIRMED') throw new Error('Only confirmed bookings can be marked as no-show');
  return (prisma as any).serviceBooking.update({ where: { id: bookingId }, data: { status: 'NO_SHOW' } });
}

export async function cancelBooking(bookingId: number, cancelledBy: number, reason?: string) {
  const booking = await (prisma as any).serviceBooking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new Error('Booking not found');
  if (!['PENDING', 'CONFIRMED'].includes(booking.status)) {
    throw new Error('Cannot cancel a booking that is already completed, cancelled, or no-show');
  }
  // Enforce cancellation window
  const service = await (prisma as any).service.findUnique({ where: { id: booking.serviceId } });
  const bookingDateTime = new Date(booking.bookingDate);
  const [hh, mm] = booking.startTime.split(':').map(Number);
  bookingDateTime.setHours(hh, mm, 0, 0);
  const hoursUntilBooking = (bookingDateTime.getTime() - Date.now()) / 3600000;
  if (hoursUntilBooking < service.cancellationHours) {
    throw new Error(`Cannot cancel within ${service.cancellationHours} hours of the appointment`);
  }
  return (prisma as any).serviceBooking.update({
    where: { id: bookingId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy, cancellationReason: reason ?? null },
  });
}

export async function checkInBooking(bookingId: number, checkedInBy: number, qrData: string) {
  const payload = verifyBookingQRData(qrData);
  if (!payload || payload.bookingId !== bookingId) throw new Error('Invalid or mismatched QR code');

  const booking = await (prisma as any).serviceBooking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new Error('Booking not found');
  if (booking.status !== 'CONFIRMED') throw new Error('Booking must be confirmed for check-in');

  const existing = await (prisma as any).serviceCheckIn.findUnique({ where: { bookingId } });
  if (existing) throw new Error('Already checked in');

  return (prisma as any).serviceCheckIn.create({
    data: {
      serviceId: booking.serviceId,
      bookingId,
      userId: booking.userId,
      checkedInBy,
      checkInMethod: 'QR_SCAN',
    },
  });
}

export async function getMerchantBookings(merchantId: number, filters?: {
  status?: string;
  serviceId?: number;
  date?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const where: any = { merchantId };
  if (filters?.status) where.status = filters.status;
  if (filters?.serviceId) where.serviceId = filters.serviceId;
  if (filters?.date) {
    const d = new Date(filters.date);
    const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999);
    where.bookingDate = { gte: dayStart, lte: dayEnd };
  }
  const [bookings, total] = await Promise.all([
    (prisma as any).serviceBooking.findMany({
      where,
      include: {
        service: { select: { id: true, title: true, serviceType: true } },
        tier: { select: { id: true, name: true, price: true, durationMinutes: true } },
        user: { select: { id: true, name: true, email: true } },
        addOnPurchases: { include: { addOn: true } },
        checkIns: true,
      },
      orderBy: [{ bookingDate: 'asc' }, { startTime: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    (prisma as any).serviceBooking.count({ where }),
  ]);
  return { bookings, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getUserBookings(userId: number, filters?: { status?: string; page?: number; limit?: number }) {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const where: any = { userId };
  if (filters?.status) where.status = filters.status;
  const [bookings, total] = await Promise.all([
    (prisma as any).serviceBooking.findMany({
      where,
      include: {
        service: { select: { id: true, title: true, serviceType: true, coverImageUrl: true } },
        tier: { select: { id: true, name: true, price: true, durationMinutes: true } },
        addOnPurchases: { include: { addOn: { select: { id: true, name: true, price: true } } } },
        checkIns: { select: { checkedInAt: true, checkInMethod: true } },
      },
      orderBy: [{ bookingDate: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    (prisma as any).serviceBooking.count({ where }),
  ]);
  return { bookings, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
