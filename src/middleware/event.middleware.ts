// src/middleware/event.middleware.ts

import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import prisma from '../lib/prisma';

/**
 * Middleware to check if user has EVENT_ORGANIZER or ADMIN role
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

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Allow EVENT_ORGANIZER, EVENT_OWNER, SUPER_ADMIN, or ADMIN
    if (!['EVENT_ORGANIZER', 'EVENT_OWNER', 'SUPER_ADMIN', 'ADMIN'].includes(user.role)) {
      return res.status(403).json({ 
        error: 'Access denied. Event organizer privileges required.' 
      });
    }

    next();
  } catch (error) {
    console.error('Event organizer check error:', error);
    res.status(500).json({ error: 'Failed to verify organizer status' });
  }
};

/**
 * Middleware to verify event ownership
 * Must be used AFTER requireEventOrganizer
 */
export const verifyEventOwnership = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    const eventId = parseInt(req.params.eventId || req.params.id);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!eventId || isNaN(eventId)) {
      return res.status(400).json({ error: 'Valid event ID required' });
    }

    // Check if user is admin first
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    // Admins and super admins can access any event
    if (user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') {
      return next();
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { organizerId: true, merchantId: true }
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check if user is the organizer
    if (event.organizerId === userId) {
      return next();
    }

    // If event is merchant-hosted, check if user owns the merchant
    if (event.merchantId) {
      const merchant = await prisma.merchant.findUnique({
        where: { id: event.merchantId },
        select: { ownerId: true }
      });

      if (merchant?.ownerId === userId) {
        return next();
      }
    }

    return res.status(403).json({ 
      error: 'Access denied. You do not own this event.' 
    });
  } catch (error) {
    console.error('Event ownership verification error:', error);
    res.status(500).json({ error: 'Failed to verify event ownership' });
  }
};

/**
 * Middleware to check if user is a vendor
 */
export const requireVendor = async (
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

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!['VENDOR', 'EVENT_OWNER', 'SUPER_ADMIN', 'ADMIN'].includes(user.role)) {
      return res.status(403).json({ 
        error: 'Access denied. Vendor privileges required.' 
      });
    }

    next();
  } catch (error) {
    console.error('Vendor check error:', error);
    res.status(500).json({ error: 'Failed to verify vendor status' });
  }
};

/**
 * Middleware to verify ticket ownership
 */
export const verifyTicketOwnership = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    const ticketId = parseInt(req.params.ticketId || req.params.id);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!ticketId || isNaN(ticketId)) {
      return res.status(400).json({ error: 'Valid ticket ID required' });
    }

    const ticket = await prisma.eventTicket.findUnique({
      where: { id: ticketId },
      select: { userId: true }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (ticket.userId !== userId) {
      return res.status(403).json({ 
        error: 'Access denied. You do not own this ticket.' 
      });
    }

    next();
  } catch (error) {
    console.error('Ticket ownership verification error:', error);
    res.status(500).json({ error: 'Failed to verify ticket ownership' });
  }
};
