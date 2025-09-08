// src/routes/deals.user.routes.ts

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { protect, AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

// Utility function to format deal data for frontend consumption
function formatDealForFrontend(deal: any, distance?: number) {
  return {
    id: deal.id,
    title: deal.title || '',
    description: deal.description || '',
    imageUrl: deal.imageUrl || null,
    discountPercentage: deal.discountPercentage || null,
    discountAmount: deal.discountAmount || null,
    category: deal.category || 'OTHER',
    startTime: deal.startTime?.toISOString() || null,
    endTime: deal.endTime?.toISOString() || null,
    redemptionInstructions: deal.redemptionInstructions || '',
    createdAt: deal.createdAt?.toISOString() || null,
    updatedAt: deal.updatedAt?.toISOString() || null,
    merchantId: deal.merchantId,
    merchant: {
      id: deal.merchant?.id || null,
      businessName: deal.merchant?.businessName || '',
      address: deal.merchant?.address || '',
      description: deal.merchant?.description || null,
      logoUrl: deal.merchant?.logoUrl || null,
      latitude: deal.merchant?.latitude || null,
      longitude: deal.merchant?.longitude || null,
      status: deal.merchant?.status || 'PENDING',
      createdAt: deal.merchant?.createdAt?.toISOString() || null,
      updatedAt: deal.merchant?.updatedAt?.toISOString() || null,
    },
    ...(distance !== undefined && { distance: Math.round(distance * 100) / 100 }), // Round to 2 decimal places
  };
}

// --- Endpoint: POST /api/user/deals/:dealId/save ---
// Allows a logged-in user to save a deal
router.post('/deals/:dealId/save', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const dealId = parseInt(req.params.dealId);

    // Validate dealId
    if (isNaN(dealId) || dealId <= 0) {
      return res.status(400).json({
        error: 'Invalid deal ID. Must be a positive integer.'
      });
    }

    // Check if the deal exists and is active
    const deal = await prisma.deal.findFirst({
      where: {
        id: dealId,
        startTime: { lte: new Date() },
        endTime: { gte: new Date() },
        merchant: {
          status: 'APPROVED',
        },
      },
      include: {
        merchant: {
          select: {
            id: true,
            businessName: true,
            address: true,
            description: true,
            logoUrl: true,
            latitude: true,
            longitude: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!deal) {
      return res.status(404).json({
        error: 'Deal not found or not available. The deal may be inactive, expired, or from an unapproved merchant.'
      });
    }

    // Check if the user has already saved this deal
    const existingSavedDeal = await prisma.savedDeal.findUnique({
      where: {
        userId_dealId: {
          userId: userId!,
          dealId: dealId,
        },
      },
    });

    if (existingSavedDeal) {
      return res.status(409).json({
        error: 'You have already saved this deal.',
        savedDeal: {
          id: existingSavedDeal.id,
          dealId: existingSavedDeal.dealId,
          savedAt: existingSavedDeal.createdAt.toISOString(),
        },
      });
    }

    // Save the deal
    const savedDeal = await prisma.savedDeal.create({
      data: {
        userId: userId!,
        dealId: dealId,
      },
      include: {
        deal: {
          include: {
            merchant: {
              select: {
                id: true,
                businessName: true,
                address: true,
                description: true,
                logoUrl: true,
                latitude: true,
                longitude: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    // Format the response
    const formattedDeal = formatDealForFrontend(savedDeal.deal);

    res.status(201).json({
      message: 'Deal saved successfully!',
      savedDeal: {
        id: savedDeal.id,
        dealId: savedDeal.dealId,
        savedAt: savedDeal.createdAt.toISOString(),
        deal: formattedDeal,
      },
    });
  } catch (error) {
    console.error('Error saving deal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: DELETE /api/user/deals/:dealId/save ---
// Allows a logged-in user to unsave a deal
router.delete('/deals/:dealId/save', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const dealId = parseInt(req.params.dealId);

    // Validate dealId
    if (isNaN(dealId) || dealId <= 0) {
      return res.status(400).json({
        error: 'Invalid deal ID. Must be a positive integer.'
      });
    }

    // Check if the user has saved this deal
    const savedDeal = await prisma.savedDeal.findUnique({
      where: {
        userId_dealId: {
          userId: userId!,
          dealId: dealId,
        },
      },
    });

    if (!savedDeal) {
      return res.status(404).json({
        error: 'You have not saved this deal.'
      });
    }

    // Remove the saved deal
    await prisma.savedDeal.delete({
      where: {
        id: savedDeal.id,
      },
    });

    res.status(200).json({
      message: 'Deal removed from saved deals successfully!',
      removedDeal: {
        dealId: dealId,
        removedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error removing saved deal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/user/deals/:dealId/saved ---
// Check if a specific deal is saved by the logged-in user
router.get('/deals/:dealId/saved', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const dealId = parseInt(req.params.dealId);

    // Validate dealId
    if (isNaN(dealId) || dealId <= 0) {
      return res.status(400).json({
        error: 'Invalid deal ID. Must be a positive integer.'
      });
    }

    // Check if the user has saved this deal
    const savedDeal = await prisma.savedDeal.findUnique({
      where: {
        userId_dealId: {
          userId: userId!,
          dealId: dealId,
        },
      },
    });

    res.status(200).json({
      isSaved: !!savedDeal,
      savedDeal: savedDeal ? {
        id: savedDeal.id,
        dealId: savedDeal.dealId,
        savedAt: savedDeal.createdAt.toISOString(),
      } : null,
    });
  } catch (error) {
    console.error('Error checking saved deal status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/user/deals/saved ---
// Returns all deals saved by the logged-in user
router.get('/deals/saved', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { latitude, longitude, radius } = req.query;

    // Build the query for saved deals
    const savedDeals = await prisma.savedDeal.findMany({
      where: {
        userId: userId!,
        deal: {
          startTime: { lte: new Date() },
          endTime: { gte: new Date() },
          merchant: {
            status: 'APPROVED' as const,
          },
        },
      },
      include: {
        deal: {
          include: {
            merchant: {
              select: {
                id: true,
                businessName: true,
                address: true,
                description: true,
                logoUrl: true,
                latitude: true,
                longitude: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Format the deals for frontend
    let formattedDeals = savedDeals.map((savedDeal: any) => {
      const deal = savedDeal.deal;
      return {
        ...formatDealForFrontend(deal),
        savedAt: savedDeal.createdAt.toISOString(),
      };
    });

    // If coordinates and radius are provided, add distance information
    if (latitude && longitude && radius) {
      const userLat = parseFloat(latitude as string);
      const userLon = parseFloat(longitude as string);
      const radiusKm = parseFloat(radius as string);

      // Validate input parameters
      if (isNaN(userLat) || isNaN(userLon) || isNaN(radiusKm)) {
        return res.status(400).json({ 
          error: 'Invalid parameters. latitude, longitude, and radius must be valid numbers.' 
        });
      }

      if (userLat < -90 || userLat > 90) {
        return res.status(400).json({ 
          error: 'Latitude must be between -90 and 90 degrees.' 
        });
      }

      if (userLon < -180 || userLon > 180) {
        return res.status(400).json({ 
          error: 'Longitude must be between -180 and 180 degrees.' 
        });
      }

      if (radiusKm <= 0) {
        return res.status(400).json({ 
          error: 'Radius must be a positive number.' 
        });
      }

      // Calculate distance for each deal
      formattedDeals = formattedDeals.map((deal: any) => {
        if (deal.merchant.latitude && deal.merchant.longitude) {
          const distance = calculateDistance(
            userLat,
            userLon,
            deal.merchant.latitude,
            deal.merchant.longitude
          );
          return {
            ...deal,
            distance: Math.round(distance * 100) / 100,
          };
        }
        return deal;
      });

      // Sort by distance
      formattedDeals.sort((a: any, b: any) => (a.distance || 0) - (b.distance || 0));
    }

    res.status(200).json({
      savedDeals: formattedDeals,
      total: formattedDeals.length,
      filters: {
        latitude: latitude ? parseFloat(latitude as string) : null,
        longitude: longitude ? parseFloat(longitude as string) : null,
        radius: radius ? parseFloat(radius as string) : null,
      }
    });
  } catch (error) {
    console.error('Error fetching saved deals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Utility function to calculate distance between two points using Haversine formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in kilometers
}

export default router;
