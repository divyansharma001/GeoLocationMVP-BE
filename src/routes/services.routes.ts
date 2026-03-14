// src/routes/services.routes.ts
import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { protect, isApprovedMerchant, isMerchant, AuthRequest } from '../middleware/auth.middleware';
import { verifyServiceOwnership, verifyBookingOwnership } from '../middleware/service.middleware';
import * as svc from '../services/service-catalog.service';
import prisma from '../lib/prisma';

const router = Router();

function isServiceCatalogSchemaError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2021') {
    return false;
  }

  const modelName = String(error.meta?.modelName ?? '');
  const tableName = String(error.meta?.table ?? '');
  return modelName.startsWith('Service') || tableName.includes('Service');
}

function handleServiceRouteError(
  res: Response,
  error: unknown,
  options: { logLabel: string; fallbackMessage: string; badRequest?: boolean }
) {
  console.error(options.logLabel, error);

  if (isServiceCatalogSchemaError(error)) {
    return res.status(503).json({
      error: 'Service catalog is temporarily unavailable. Database migration is pending.',
      code: 'SERVICE_CATALOG_SCHEMA_MISSING',
    });
  }

  if (options.badRequest) {
    const message = error instanceof Error ? error.message : options.fallbackMessage;
    return res.status(400).json({ error: message || options.fallbackMessage });
  }

  return res.status(500).json({ error: options.fallbackMessage });
}

// ==================== PUBLIC ROUTES ====================

/**
 * GET /api/services
 * Browse published services
 */
router.get('/services', async (req: AuthRequest, res: Response) => {
  try {
    const { serviceType, merchantId, search, page, limit } = req.query;
    const result = await svc.getPublicServices({
      serviceType: serviceType as string | undefined,
      merchantId: merchantId ? parseInt(merchantId as string) : undefined,
      search: search as string | undefined,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json(result);
  } catch (error) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Browse services error:',
      fallbackMessage: 'Failed to fetch services',
    });
  }
});

/**
 * GET /api/services/:id
 * Get single service details (public)
 */
router.get('/services/:id', async (req: AuthRequest, res: Response) => {
  try {
    const serviceId = parseInt(req.params.id as string);
    if (isNaN(serviceId)) return res.status(400).json({ error: 'Invalid service ID' });

    const service = await (prisma as any).service.findUnique({
      where: { id: serviceId },
      include: {
        merchant: { select: { id: true, businessName: true, logoUrl: true, address: true, phoneNumber: true } },
        pricingTiers: { where: { isActive: true }, orderBy: { price: 'asc' } },
        addOns: { where: { isActive: true } },
        _count: { select: { bookings: true } },
      },
    });

    if (!service || service.status !== 'PUBLISHED') {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json({ service });
  } catch (error) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Get service error:',
      fallbackMessage: 'Failed to fetch service',
    });
  }
});

/**
 * GET /api/merchants/:merchantId/services
 * Public: all published services for a specific merchant
 */
router.get('/merchants/:merchantId/services', async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = parseInt(req.params.merchantId as string);
    if (isNaN(merchantId)) return res.status(400).json({ error: 'Invalid merchant ID' });
    const result = await svc.getPublicServices({ merchantId });
    res.json(result);
  } catch (error) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Merchant services error:',
      fallbackMessage: 'Failed to fetch merchant services',
    });
  }
});

// ==================== MERCHANT SERVICE MANAGEMENT ====================

/**
 * GET /api/services/me/list
 * List merchant's own services
 */
router.get('/services/me/list', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const { status } = req.query;
    const services = await svc.getMerchantServices(merchantId, { status: status as string | undefined });
    res.json({ services });
  } catch (error) {
    return handleServiceRouteError(res, error, {
      logLabel: 'List services error:',
      fallbackMessage: 'Failed to list services',
    });
  }
});

/**
 * POST /api/services
 * Create a new service (DRAFT)
 */
router.post('/services', protect, isApprovedMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const service = await svc.createService(merchantId, req.body);
    res.status(201).json({ service, message: 'Service created. Add pricing tiers and a cover image, then publish.' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Create service error:',
      fallbackMessage: 'Failed to create service',
      badRequest: true,
    });
  }
});

/**
 * PUT /api/services/:id
 * Update service
 */
router.put('/services/:id', protect, isApprovedMerchant, verifyServiceOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const serviceId = parseInt(req.params.id as string);
    const service = await svc.updateService(merchantId, serviceId, req.body);
    res.json({ service, message: 'Service updated successfully' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Update service error:',
      fallbackMessage: 'Failed to update service',
      badRequest: true,
    });
  }
});

/**
 * DELETE /api/services/:id
 * Delete or cancel service
 */
router.delete('/services/:id', protect, isApprovedMerchant, verifyServiceOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const serviceId = parseInt(req.params.id as string);
    const result = await svc.deleteService(merchantId, serviceId);
    res.json({ result, message: 'Service removed' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Delete service error:',
      fallbackMessage: 'Failed to delete service',
      badRequest: true,
    });
  }
});

/**
 * POST /api/services/:id/publish
 */
router.post('/services/:id/publish', protect, isApprovedMerchant, verifyServiceOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const serviceId = parseInt(req.params.id as string);
    const service = await svc.publishService(merchantId, serviceId);
    res.json({ service, message: 'Service published successfully!' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Publish service error:',
      fallbackMessage: 'Failed to publish service',
      badRequest: true,
    });
  }
});

/**
 * POST /api/services/:id/pause
 */
router.post('/services/:id/pause', protect, isApprovedMerchant, verifyServiceOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const serviceId = parseInt(req.params.id as string);
    const service = await svc.pauseService(merchantId, serviceId);
    res.json({ service, message: 'Service paused' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Pause service error:',
      fallbackMessage: 'Failed to pause service',
      badRequest: true,
    });
  }
});

/**
 * POST /api/services/:id/cancel
 */
router.post('/services/:id/cancel', protect, isApprovedMerchant, verifyServiceOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const serviceId = parseInt(req.params.id as string);
    const service = await svc.cancelService(merchantId, serviceId);
    res.json({ service, message: 'Service cancelled. Active bookings have been cancelled.' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Cancel service error:',
      fallbackMessage: 'Failed to cancel service',
      badRequest: true,
    });
  }
});

// ── Pricing Tiers ──

/**
 * POST /api/services/:serviceId/pricing-tiers
 */
router.post('/services/:serviceId/pricing-tiers', protect, isApprovedMerchant, verifyServiceOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const serviceId = parseInt(req.params.serviceId as string);
    const tier = await svc.createPricingTier(merchantId, serviceId, req.body);
    res.status(201).json({ tier, message: 'Pricing tier created' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Create pricing tier error:',
      fallbackMessage: 'Failed to create pricing tier',
      badRequest: true,
    });
  }
});

/**
 * PUT /api/services/:serviceId/pricing-tiers/:tierId
 */
router.put('/services/:serviceId/pricing-tiers/:tierId', protect, isApprovedMerchant, verifyServiceOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const serviceId = parseInt(req.params.serviceId as string);
    const tierId = parseInt(req.params.tierId as string);
    const tier = await svc.updatePricingTier(merchantId, serviceId, tierId, req.body);
    res.json({ tier, message: 'Pricing tier updated' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Update pricing tier error:',
      fallbackMessage: 'Failed to update pricing tier',
      badRequest: true,
    });
  }
});

/**
 * DELETE /api/services/:serviceId/pricing-tiers/:tierId
 */
router.delete('/services/:serviceId/pricing-tiers/:tierId', protect, isApprovedMerchant, verifyServiceOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const serviceId = parseInt(req.params.serviceId as string);
    const tierId = parseInt(req.params.tierId as string);
    const result = await svc.deletePricingTier(merchantId, serviceId, tierId);
    res.json({ result, message: 'Pricing tier removed' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Delete pricing tier error:',
      fallbackMessage: 'Failed to delete pricing tier',
      badRequest: true,
    });
  }
});

// ── Add-Ons ──

/**
 * POST /api/services/:serviceId/add-ons
 */
router.post('/services/:serviceId/add-ons', protect, isApprovedMerchant, verifyServiceOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const serviceId = parseInt(req.params.serviceId as string);
    const addOn = await svc.createAddOn(merchantId, serviceId, req.body);
    res.status(201).json({ addOn, message: 'Add-on created' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Create add-on error:',
      fallbackMessage: 'Failed to create add-on',
      badRequest: true,
    });
  }
});

/**
 * PUT /api/services/:serviceId/add-ons/:addOnId
 */
router.put('/services/:serviceId/add-ons/:addOnId', protect, isApprovedMerchant, verifyServiceOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const serviceId = parseInt(req.params.serviceId as string);
    const addOnId = parseInt(req.params.addOnId as string);
    const addOn = await svc.updateAddOn(merchantId, serviceId, addOnId, req.body);
    res.json({ addOn, message: 'Add-on updated' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Update add-on error:',
      fallbackMessage: 'Failed to update add-on',
      badRequest: true,
    });
  }
});

/**
 * DELETE /api/services/:serviceId/add-ons/:addOnId
 */
router.delete('/services/:serviceId/add-ons/:addOnId', protect, isApprovedMerchant, verifyServiceOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const serviceId = parseInt(req.params.serviceId as string);
    const addOnId = parseInt(req.params.addOnId as string);
    const result = await svc.deleteAddOn(merchantId, serviceId, addOnId);
    res.json({ result, message: 'Add-on removed' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Delete add-on error:',
      fallbackMessage: 'Failed to delete add-on',
      badRequest: true,
    });
  }
});

// ── Merchant Booking Dashboard ──

/**
 * GET /api/services/me/bookings
 * Merchant: view all bookings across their services
 */
router.get('/services/me/bookings', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const { status, serviceId, date, page, limit } = req.query;
    const result = await svc.getMerchantBookings(merchantId, {
      status: status as string | undefined,
      serviceId: serviceId ? parseInt(serviceId as string) : undefined,
      date: date as string | undefined,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json(result);
  } catch (error) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Get merchant bookings error:',
      fallbackMessage: 'Failed to fetch bookings',
    });
  }
});

/**
 * PUT /api/services/bookings/:bookingId/confirm
 */
router.put('/services/bookings/:bookingId/confirm', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const bookingId = parseInt(req.params.bookingId as string);
    const booking = await svc.confirmBooking(merchantId, bookingId);
    res.json({ booking, message: 'Booking confirmed' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Confirm booking error:',
      fallbackMessage: 'Failed to confirm booking',
      badRequest: true,
    });
  }
});

/**
 * PUT /api/services/bookings/:bookingId/complete
 */
router.put('/services/bookings/:bookingId/complete', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const bookingId = parseInt(req.params.bookingId as string);
    const booking = await svc.completeBooking(merchantId, bookingId);
    res.json({ booking, message: 'Booking completed' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Complete booking error:',
      fallbackMessage: 'Failed to complete booking',
      badRequest: true,
    });
  }
});

/**
 * PUT /api/services/bookings/:bookingId/no-show
 */
router.put('/services/bookings/:bookingId/no-show', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const bookingId = parseInt(req.params.bookingId as string);
    const booking = await svc.markNoShow(merchantId, bookingId);
    res.json({ booking, message: 'Booking marked as no-show' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'No-show booking error:',
      fallbackMessage: 'Failed to mark no-show',
      badRequest: true,
    });
  }
});

/**
 * POST /api/services/bookings/:bookingId/check-in
 * QR-based check-in when customer arrives (merchant/staff scans)
 */
router.post('/services/bookings/:bookingId/check-in', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const bookingId = parseInt(req.params.bookingId as string);
    const checkedInBy = req.user!.id;
    const { qrData } = req.body;
    if (!qrData) return res.status(400).json({ error: 'qrData is required' });
    const checkIn = await svc.checkInBooking(bookingId, checkedInBy, qrData);
    res.json({ checkIn, message: 'Customer checked in successfully' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Check-in error:',
      fallbackMessage: 'Check-in failed',
      badRequest: true,
    });
  }
});

// ==================== USER BOOKING ROUTES ====================

/**
 * POST /api/services/:serviceId/bookings
 * User: book an appointment
 */
router.post('/services/:serviceId/bookings', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const serviceId = parseInt(req.params.serviceId as string);
    const booking = await svc.reserveServiceBooking(userId, {
      serviceId,
      tierId: parseInt(req.body.tierId),
      bookingDate: new Date(req.body.bookingDate),
      startTime: req.body.startTime,
      notes: req.body.notes,
      specialRequests: req.body.specialRequests,
      contactPhone: req.body.contactPhone,
      contactEmail: req.body.contactEmail,
      addOns: req.body.addOns,
    });
    res.status(201).json({
      booking,
      message: booking.status === 'CONFIRMED'
        ? 'Booking confirmed! Check your confirmation code.'
        : 'Booking received and pending merchant confirmation.',
    });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Reserve booking error:',
      fallbackMessage: 'Failed to reserve booking',
      badRequest: true,
    });
  }
});

/**
 * DELETE /api/services/bookings/:bookingId
 * User: cancel their own booking
 */
router.delete('/services/bookings/:bookingId', protect, verifyBookingOwnership, async (req: AuthRequest, res: Response) => {
  try {
    const bookingId = parseInt(req.params.bookingId as string);
    const userId = req.user!.id;
    const { reason } = req.body;
    const booking = await svc.cancelBooking(bookingId, userId, reason);
    res.json({ booking, message: 'Booking cancelled' });
  } catch (error: any) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Cancel booking error:',
      fallbackMessage: 'Failed to cancel booking',
      badRequest: true,
    });
  }
});

/**
 * GET /api/users/me/service-bookings
 * User: their own bookings
 */
router.get('/users/me/service-bookings', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { status, page, limit } = req.query;
    const result = await svc.getUserBookings(userId, {
      status: status as string | undefined,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json(result);
  } catch (error) {
    return handleServiceRouteError(res, error, {
      logLabel: 'Get user bookings error:',
      fallbackMessage: 'Failed to fetch your bookings',
    });
  }
});

export default router;
