import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { protect, AuthRequest, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// Validation schemas
const updateCityActiveSchema = z.object({
  active: z.boolean()
});

const bulkUpdateCitiesSchema = z.object({
  cityIds: z.array(z.number().int().positive()),
  active: z.boolean()
});

const rejectMerchantSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required')
});

// --- Endpoint: GET /api/admin/cities ---
// Get all cities with pagination and filtering
router.get('/cities', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const active = req.query.active as string;
    const search = req.query.search as string;
    const state = req.query.state as string;

    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};
    
    if (active !== undefined) {
      where.active = active === 'true';
    }
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { state: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (state) {
      where.state = { contains: state, mode: 'insensitive' };
    }

    // Get cities with store count
    const [cities, totalCount] = await Promise.all([
      prisma.city.findMany({
        where,
        include: {
          stores: {
            select: {
              id: true,
              active: true,
              merchant: {
                select: {
                  businessName: true,
                  status: true
                }
              }
            }
          },
          _count: {
            select: {
              stores: true
            }
          }
        },
        orderBy: [
          { state: 'asc' },
          { name: 'asc' }
        ],
        skip,
        take: limit
      }),
      prisma.city.count({ where })
    ]);

    // Calculate active store counts
    const citiesWithStats = cities.map(city => ({
      id: city.id,
      name: city.name,
      state: city.state,
      active: city.active,
      createdAt: city.createdAt,
      updatedAt: city.updatedAt,
      totalStores: city._count.stores,
      activeStores: city.stores.filter(store => store.active).length,
      approvedMerchants: city.stores.filter(store => 
        store.merchant.status === 'APPROVED' && store.active
      ).length
    }));

    res.status(200).json({
      message: 'Cities retrieved successfully',
      cities: citiesWithStats,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNext: page * limit < totalCount,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Get cities error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: PUT /api/admin/cities/:cityId/active ---
// Update a single city's active state
router.put('/cities/:cityId/active', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const cityId = parseInt(req.params.cityId);
    const { active } = updateCityActiveSchema.parse(req.body);

    if (isNaN(cityId)) {
      return res.status(400).json({ error: 'Invalid city ID' });
    }

    // Check if city exists
    const existingCity = await prisma.city.findUnique({
      where: { id: cityId },
      include: {
        _count: {
          select: {
            stores: true
          }
        }
      }
    });

    if (!existingCity) {
      return res.status(404).json({ error: 'City not found' });
    }

    // Update city active state
    const updatedCity = await prisma.city.update({
      where: { id: cityId },
      data: { active },
      include: {
        _count: {
          select: {
            stores: true
          }
        }
      }
    });

    res.status(200).json({
      message: `City ${active ? 'activated' : 'deactivated'} successfully`,
      city: {
        id: updatedCity.id,
        name: updatedCity.name,
        state: updatedCity.state,
        active: updatedCity.active,
        totalStores: updatedCity._count.stores,
        updatedAt: updatedCity.updatedAt
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Update city active state error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: PUT /api/admin/cities/bulk-update ---
// Bulk update multiple cities' active state
router.put('/cities/bulk-update', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { cityIds, active } = bulkUpdateCitiesSchema.parse(req.body);

    if (cityIds.length === 0) {
      return res.status(400).json({ error: 'At least one city ID is required' });
    }

    if (cityIds.length > 100) {
      return res.status(400).json({ error: 'Cannot update more than 100 cities at once' });
    }

    // Check if all cities exist
    const existingCities = await prisma.city.findMany({
      where: {
        id: { in: cityIds }
      },
      select: { id: true, name: true, state: true }
    });

    if (existingCities.length !== cityIds.length) {
      const foundIds = existingCities.map(c => c.id);
      const missingIds = cityIds.filter(id => !foundIds.includes(id));
      return res.status(404).json({ 
        error: 'Some cities not found',
        missingIds
      });
    }

    // Bulk update cities
    const updateResult = await prisma.city.updateMany({
      where: {
        id: { in: cityIds }
      },
      data: { active }
    });

    res.status(200).json({
      message: `${updateResult.count} cities ${active ? 'activated' : 'deactivated'} successfully`,
      updatedCount: updateResult.count,
      cityIds: cityIds,
      active
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Bulk update cities error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/admin/cities/stats ---
// Get city statistics for admin dashboard
router.get('/cities/stats', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const [
      totalCities,
      activeCities,
      inactiveCities,
      citiesWithStores,
      activeCitiesWithStores
    ] = await Promise.all([
      prisma.city.count(),
      prisma.city.count({ where: { active: true } }),
      prisma.city.count({ where: { active: false } }),
      prisma.city.count({
        where: {
          stores: {
            some: {}
          }
        }
      }),
      prisma.city.count({
        where: {
          active: true,
          stores: {
            some: {}
          }
        }
      })
    ]);

    // Get top cities by store count
    const topCitiesByStores = await prisma.city.findMany({
      include: {
        _count: {
          select: {
            stores: true
          }
        }
      },
      orderBy: {
        stores: {
          _count: 'desc'
        }
      },
      take: 10
    });

    res.status(200).json({
      message: 'City statistics retrieved successfully',
      stats: {
        totalCities,
        activeCities,
        inactiveCities,
        citiesWithStores,
        activeCitiesWithStores,
        topCitiesByStores: topCitiesByStores.map(city => ({
          id: city.id,
          name: city.name,
          state: city.state,
          active: city.active,
          storeCount: city._count.stores
        }))
      }
    });

  } catch (error) {
    console.error('Get city stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: POST /api/admin/cities ---
// Create a new city (admin only)
router.post('/cities', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const createCitySchema = z.object({
      name: z.string().min(1, 'City name is required'),
      state: z.string().min(1, 'State is required'),
      active: z.boolean().default(false)
    });

    const { name, state, active } = createCitySchema.parse(req.body);

    // Check if city already exists
    const existingCity = await prisma.city.findUnique({
      where: {
        name_state: {
          name: name.trim(),
          state: state.trim()
        }
      }
    });

    if (existingCity) {
      return res.status(409).json({ 
        error: 'City already exists',
        existingCity: {
          id: existingCity.id,
          name: existingCity.name,
          state: existingCity.state,
          active: existingCity.active
        }
      });
    }

    // Create new city
    const newCity = await prisma.city.create({
      data: {
        name: name.trim(),
        state: state.trim(),
        active
      }
    });

    res.status(201).json({
      message: 'City created successfully',
      city: {
        id: newCity.id,
        name: newCity.name,
        state: newCity.state,
        active: newCity.active,
        createdAt: newCity.createdAt
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Create city error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/admin/merchants ---
// Get all merchants with pagination and filtering
router.get('/merchants', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const status = req.query.status as string;
    const search = req.query.search as string;

    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};
    
    if (status) {
      where.status = status;
    }
    
    if (search) {
      where.OR = [
        { businessName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get merchants with related data
    const [merchants, totalCount] = await Promise.all([
      prisma.merchant.findMany({
        where,
        include: {
          owner: {
            select: {
              id: true,
              email: true,
              name: true
            }
          },
          stores: {
            include: {
              city: {
                select: {
                  id: true,
                  name: true,
                  state: true
                }
              }
            }
          },
          _count: {
            select: {
              deals: true,
              stores: true
            }
          }
        },
        orderBy: [
          { status: 'asc' },
          { createdAt: 'desc' }
        ],
        skip,
        take: limit
      }),
      prisma.merchant.count({ where })
    ]);

    res.status(200).json({
      message: 'Merchants retrieved successfully',
      merchants: merchants.map(merchant => ({
        id: merchant.id,
        businessName: merchant.businessName,
        description: merchant.description,
        address: merchant.address,
        logoUrl: merchant.logoUrl,
        latitude: merchant.latitude,
        longitude: merchant.longitude,
        status: merchant.status,
        createdAt: merchant.createdAt,
        updatedAt: merchant.updatedAt,
        owner: merchant.owner,
        stores: merchant.stores,
        totalDeals: merchant._count.deals,
        totalStores: merchant._count.stores
      })),
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNext: page * limit < totalCount,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Get merchants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/admin/merchants/:merchantId ---
// Get detailed information about a specific merchant
router.get('/merchants/:merchantId', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = parseInt(req.params.merchantId);

    if (isNaN(merchantId)) {
      return res.status(400).json({ error: 'Invalid merchant ID' });
    }

    // Get detailed merchant information
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true
          }
        },
        stores: {
          include: {
            city: {
              select: {
                id: true,
                name: true,
                state: true,
                active: true
              }
            }
          }
        },
        deals: {
          select: {
            id: true,
            title: true,
            description: true,
            discountPercentage: true,
            discountAmount: true,
            startTime: true,
            endTime: true,
            redemptionInstructions: true,
            createdAt: true,
            category: true
          }
        },
        _count: {
          select: {
            deals: true,
            stores: true
          }
        }
      }
    });

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    res.status(200).json({
      message: 'Merchant details retrieved successfully',
      merchant: {
        id: merchant.id,
        businessName: merchant.businessName,
        description: merchant.description,
        address: merchant.address,
        logoUrl: merchant.logoUrl,
        latitude: merchant.latitude,
        longitude: merchant.longitude,
        status: merchant.status,
        rejectionReason: merchant.rejectionReason,
        suspendedUntil: merchant.suspendedUntil,
        suspendedReason: merchant.suspendedReason,
        createdAt: merchant.createdAt,
        updatedAt: merchant.updatedAt,
        owner: merchant.owner,
        stores: merchant.stores,
        deals: merchant.deals,
        totalDeals: merchant._count.deals,
        totalStores: merchant._count.stores
      }
    });

  } catch (error) {
    console.error('Get merchant details error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: POST /api/admin/merchants/:merchantId/approve ---
// Approve a merchant application
router.post('/merchants/:merchantId/approve', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = parseInt(req.params.merchantId);

    if (isNaN(merchantId)) {
      return res.status(400).json({ error: 'Invalid merchant ID' });
    }

    // Check if merchant exists
    const existingMerchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true
          }
        },
        stores: {
          include: {
            city: {
              select: {
                id: true,
                name: true,
                state: true
              }
            }
          }
        }
      }
    });

    if (!existingMerchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    // Check if already approved
    if (existingMerchant.status === 'APPROVED') {
      return res.status(200).json({
        message: 'Merchant is already approved',
        merchant: {
          id: existingMerchant.id,
          businessName: existingMerchant.businessName,
          status: existingMerchant.status
        }
      });
    }

    // Update merchant status to approved
    const updatedMerchant = await prisma.merchant.update({
      where: { id: merchantId },
      data: { status: 'APPROVED' },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true
          }
        },
        stores: {
          include: {
            city: {
              select: {
                id: true,
                name: true,
                state: true
              }
            }
          }
        }
      }
    });

    res.status(200).json({
      message: 'Merchant approved successfully',
      merchant: {
        id: updatedMerchant.id,
        businessName: updatedMerchant.businessName,
        description: updatedMerchant.description,
        address: updatedMerchant.address,
        logoUrl: updatedMerchant.logoUrl,
        latitude: updatedMerchant.latitude,
        longitude: updatedMerchant.longitude,
        status: updatedMerchant.status,
        createdAt: updatedMerchant.createdAt,
        updatedAt: updatedMerchant.updatedAt,
        owner: updatedMerchant.owner,
        stores: updatedMerchant.stores
      }
    });

  } catch (error) {
    console.error('Approve merchant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: POST /api/admin/merchants/:merchantId/reject ---
// Reject a merchant application
router.post('/merchants/:merchantId/reject', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = parseInt(req.params.merchantId);
    const { reason } = rejectMerchantSchema.parse(req.body);

    if (isNaN(merchantId)) {
      return res.status(400).json({ error: 'Invalid merchant ID' });
    }

    // Check if merchant exists
    const existingMerchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true
          }
        },
        stores: {
          include: {
            city: {
              select: {
                id: true,
                name: true,
                state: true
              }
            }
          }
        }
      }
    });

    if (!existingMerchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    // Update merchant status to rejected
    const updatedMerchant = await prisma.merchant.update({
      where: { id: merchantId },
      data: { 
        status: 'REJECTED',
        // Store rejection reason in description or create a separate field if needed
        description: existingMerchant.description ? 
          `${existingMerchant.description}\n\n[REJECTED] Reason: ${reason}` : 
          `[REJECTED] Reason: ${reason}`
      },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true
          }
        },
        stores: {
          include: {
            city: {
              select: {
                id: true,
                name: true,
                state: true
              }
            }
          }
        }
      }
    });

    res.status(200).json({
      message: 'Merchant rejected successfully',
      merchant: {
        id: updatedMerchant.id,
        businessName: updatedMerchant.businessName,
        description: updatedMerchant.description,
        address: updatedMerchant.address,
        logoUrl: updatedMerchant.logoUrl,
        latitude: updatedMerchant.latitude,
        longitude: updatedMerchant.longitude,
        status: updatedMerchant.status,
        createdAt: updatedMerchant.createdAt,
        updatedAt: updatedMerchant.updatedAt,
        owner: updatedMerchant.owner,
        stores: updatedMerchant.stores,
        rejectionReason: reason
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Reject merchant error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;