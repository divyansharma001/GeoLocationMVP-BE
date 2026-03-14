// src/middleware/service.middleware.ts

import { Prisma } from '@prisma/client';
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import prisma from '../lib/prisma';

function isServiceCatalogSchemaError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2021') {
    return false;
  }

  const modelName = String(error.meta?.modelName ?? '');
  const tableName = String(error.meta?.table ?? '');
  return modelName.startsWith('Service') || tableName.includes('Service');
}

/**
 * Middleware to verify service ownership
 * Checks that the authenticated merchant owns the service
 * Must be used AFTER protect + isApprovedMerchant
 */
export const verifyServiceOwnership = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    const serviceId = parseInt((req.params.serviceId || req.params.id) as string);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!serviceId || isNaN(serviceId)) {
      return res.status(400).json({ error: 'Valid service ID required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') {
      return next();
    }

    const service = await (prisma as any).service.findUnique({
      where: { id: serviceId },
      select: { merchantId: true },
    });

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const merchant = await prisma.merchant.findUnique({
      where: { id: service.merchantId },
      select: { ownerId: true },
    });

    if (merchant?.ownerId !== userId) {
      return res.status(403).json({ error: 'Access denied. You do not own this service.' });
    }

    next();
  } catch (error) {
    console.error('Service ownership verification error:', error);
    if (isServiceCatalogSchemaError(error)) {
      return res.status(503).json({
        error: 'Service catalog is temporarily unavailable. Database migration is pending.',
        code: 'SERVICE_CATALOG_SCHEMA_MISSING',
      });
    }
    res.status(500).json({ error: 'Failed to verify service ownership' });
  }
};

/**
 * Middleware to verify service booking ownership (user owns the booking)
 */
export const verifyBookingOwnership = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    const bookingId = parseInt(req.params.bookingId as string);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!bookingId || isNaN(bookingId)) {
      return res.status(400).json({ error: 'Valid booking ID required' });
    }

    const booking = await (prisma as any).serviceBooking.findUnique({
      where: { id: bookingId },
      select: { userId: true },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.userId !== userId) {
      return res.status(403).json({ error: 'Access denied. You do not own this booking.' });
    }

    next();
  } catch (error) {
    console.error('Booking ownership verification error:', error);
    if (isServiceCatalogSchemaError(error)) {
      return res.status(503).json({
        error: 'Service catalog is temporarily unavailable. Database migration is pending.',
        code: 'SERVICE_CATALOG_SCHEMA_MISSING',
      });
    }
    res.status(500).json({ error: 'Failed to verify booking ownership' });
  }
};
