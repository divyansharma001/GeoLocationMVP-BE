// src/routes/merchant.routes.ts
import { Router } from 'express';
import { protect, isApprovedMerchant, AuthRequest } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';

const router = Router();

// --- Endpoint: POST /api/merchants/register ---
// Allows a user to register as a merchant.
router.post('/merchants/register', protect, async (req: AuthRequest, res) => {
  try {
    const { businessName, address, description, logoUrl, latitude, longitude } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!businessName || !address) {
      return res.status(400).json({ error: 'Business name and address are required' });
    }

    // Validate coordinates if provided
    if (latitude !== undefined || longitude !== undefined) {
      if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({ error: 'Both latitude and longitude must be provided together' });
      }

      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);

      if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ error: 'Latitude and longitude must be valid numbers' });
      }

      if (lat < -90 || lat > 90) {
        return res.status(400).json({ error: 'Latitude must be between -90 and 90 degrees' });
      }

      if (lon < -180 || lon > 180) {
        return res.status(400).json({ error: 'Longitude must be between -180 and 180 degrees' });
      }
    }

    const existingMerchant = await prisma.merchant.findUnique({
      where: { ownerId: userId },
    });

    if (existingMerchant) {
      return res.status(409).json({ error: 'You have already registered as a merchant.' });
    }

    const merchant = await prisma.merchant.create({
      data: {
        businessName,
        address,
        description,
        logoUrl,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        owner: { connect: { id: userId } },
      },
    });

    res.status(201).json({
      message: 'Merchant application submitted successfully. It is now pending approval.',
      merchant,
    });

  } catch (error) {
    console.error('Merchant registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/merchants/status ---
// Returns the merchant status for the authenticated user
router.get('/merchants/status', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const merchant = await prisma.merchant.findUnique({
      where: { ownerId: userId },
      select: {
        id: true,
        status: true,
        businessName: true,
        address: true,
        description: true,
        logoUrl: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!merchant) {
      return res.status(404).json({ error: 'No merchant profile found' });
    }

    res.status(200).json({ merchant });

  } catch (error) {
    console.error('Fetch merchant status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: POST /api/deals ---
// Allows an APPROVED merchant to create a new deal.
router.post('/deals', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const { title, description, startTime, endTime, redemptionInstructions, discountPercentage, discountAmount, category } = req.body;
    const merchantId = req.merchant?.id; // Get merchantId from our middleware

    // Input validation
    if (!title || !description || !startTime || !endTime) {
        return res.status(400).json({ error: 'Title, description, start time, and end time are required.'});
    }

    // Validate category if provided
    if (category) {
      const validCategories = [
        'FOOD_AND_BEVERAGE', 'RETAIL', 'ENTERTAINMENT', 'HEALTH_AND_FITNESS',
        'BEAUTY_AND_SPA', 'AUTOMOTIVE', 'TRAVEL', 'EDUCATION', 'TECHNOLOGY',
        'HOME_AND_GARDEN', 'OTHER'
      ];
      
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
        });
      }
    }

    const newDeal = await prisma.deal.create({
        data: {
            title,
            description,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            redemptionInstructions,
            discountPercentage: discountPercentage ? parseInt(discountPercentage, 10) : null,
            discountAmount: discountAmount ? parseFloat(discountAmount) : null,
            category: category || 'OTHER',
            merchant: {
                connect: { id: merchantId }
            }
        }
    });

    res.status(201).json({ message: 'Deal created successfully', deal: newDeal });

  } catch (error) {
    console.error('Deal creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/merchants/deals ---
// Returns all deals created by the authenticated merchant
router.get('/merchants/deals', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    const { status, category, page = '1', limit = '10' } = req.query;

    if (!merchantId) {
      return res.status(401).json({ error: 'Merchant authentication required' });
    }

    // Parse pagination parameters
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    // Validate pagination parameters
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ error: 'Page must be a positive integer' });
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'Limit must be between 1 and 100' });
    }

    // Build filter conditions
    const whereConditions: any = {
      merchantId: merchantId,
    };

    // Filter by deal status (active, expired, upcoming)
    if (status) {
      const now = new Date();
      switch (status) {
        case 'active':
          whereConditions.startTime = { lte: now };
          whereConditions.endTime = { gte: now };
          break;
        case 'expired':
          whereConditions.endTime = { lt: now };
          break;
        case 'upcoming':
          whereConditions.startTime = { gt: now };
          break;
        default:
          return res.status(400).json({ 
            error: 'Invalid status. Must be one of: active, expired, upcoming' 
          });
      }
    }

    // Filter by category
    if (category) {
      const validCategories = [
        'FOOD_AND_BEVERAGE', 'RETAIL', 'ENTERTAINMENT', 'HEALTH_AND_FITNESS',
        'BEAUTY_AND_SPA', 'AUTOMOTIVE', 'TRAVEL', 'EDUCATION', 'TECHNOLOGY',
        'HOME_AND_GARDEN', 'OTHER'
      ];
      
      if (!validCategories.includes(category as string)) {
        return res.status(400).json({
          error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
        });
      }
      
      whereConditions.category = category;
    }

    // Get deals with pagination
    const [deals, totalCount] = await Promise.all([
      prisma.deal.findMany({
        where: whereConditions,
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
            },
          },
          savedBy: {
            select: {
              id: true,
              userId: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: skip,
        take: limitNum,
      }),
      prisma.deal.count({
        where: whereConditions,
      }),
    ]);

    // Format deals for response
    const formattedDeals = deals.map(deal => ({
      id: deal.id,
      title: deal.title,
      description: deal.description,
      imageUrl: deal.imageUrl,
      discountPercentage: deal.discountPercentage,
      discountAmount: deal.discountAmount,
      category: deal.category,
      startTime: deal.startTime.toISOString(),
      endTime: deal.endTime.toISOString(),
      redemptionInstructions: deal.redemptionInstructions,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
      merchant: {
        id: deal.merchant.id,
        businessName: deal.merchant.businessName,
        address: deal.merchant.address,
        description: deal.merchant.description,
        logoUrl: deal.merchant.logoUrl,
        latitude: deal.merchant.latitude,
        longitude: deal.merchant.longitude,
        status: deal.merchant.status,
      },
      stats: {
        totalSaves: deal.savedBy.length,
        recentSaves: deal.savedBy.filter(save => {
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
          return save.createdAt >= oneWeekAgo;
        }).length,
      },
      status: (() => {
        const now = new Date();
        if (deal.startTime > now) return 'upcoming';
        if (deal.endTime < now) return 'expired';
        return 'active';
      })(),
    }));

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    res.status(200).json({
      deals: formattedDeals,
      pagination: {
        currentPage: pageNum,
        totalPages: totalPages,
        totalCount: totalCount,
        limit: limitNum,
        hasNextPage: hasNextPage,
        hasPrevPage: hasPrevPage,
      },
      filters: {
        status: status || null,
        category: category || null,
      },
    });

  } catch (error) {
    console.error('Error fetching merchant deals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: PUT /api/merchants/coordinates ---
// Allows an approved merchant to update their coordinates.
router.put('/merchants/coordinates', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const { latitude, longitude } = req.body;
    const merchantId = req.merchant?.id;

    if (!merchantId) {
      return res.status(401).json({ error: 'Merchant authentication required' });
    }

    // Validate coordinates
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Both latitude and longitude are required' });
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'Latitude and longitude must be valid numbers' });
    }

    if (lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'Latitude must be between -90 and 90 degrees' });
    }

    if (lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Longitude must be between -180 and 180 degrees' });
    }

    const updatedMerchant = await prisma.merchant.update({
      where: { id: merchantId },
      data: {
        latitude: lat,
        longitude: lon,
      },
      select: {
        id: true,
        businessName: true,
        latitude: true,
        longitude: true,
        address: true,
      },
    });

    res.status(200).json({
      message: 'Coordinates updated successfully',
      merchant: updatedMerchant,
    });

  } catch (error) {
    console.error('Coordinate update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;