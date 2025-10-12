import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { protect, AuthRequest, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// --- Business Logic Helper Functions ---

// Validate and parse period parameter
function validatePeriod(period: string): { isValid: boolean; days: number; error?: string } {
  const validPeriods = {
    '1d': 1,
    '7d': 7,
    '30d': 30,
    '90d': 90
  };
  
  if (!validPeriods[period as keyof typeof validPeriods]) {
    return {
      isValid: false,
      days: 0,
      error: 'Invalid period. Must be one of: 1d, 7d, 30d, 90d'
    };
  }
  
  return {
    isValid: true,
    days: validPeriods[period as keyof typeof validPeriods]
  };
}

// Calculate date ranges for current and previous periods
function calculateDateRanges(periodDays: number): {
  current: { from: Date; to: Date };
  previous: { from: Date; to: Date };
} {
  const now = new Date();
  const currentFrom = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const previousTo = new Date(currentFrom.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - periodDays * 24 * 60 * 60 * 1000);
  
  return {
    current: { from: currentFrom, to: now },
    previous: { from: previousFrom, to: previousTo }
  };
}

// Get merchant IDs for city filter
async function getMerchantIdsForCity(cityId: number): Promise<number[]> {
  const cityMerchants = await prisma.merchant.findMany({
    where: {
      status: 'APPROVED',
      stores: {
        some: { 
          cityId: cityId,
          active: true 
        }
      }
    },
    select: { id: true }
  });
  
  return cityMerchants.map(m => m.id);
}

// Validate merchant exists and is approved
async function validateMerchant(merchantId: number): Promise<{ isValid: boolean; error?: string }> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, status: true }
  });
  
  if (!merchant) {
    return { isValid: false, error: 'Merchant not found' };
  }
  
  if (merchant.status !== 'APPROVED') {
    return { isValid: false, error: 'Merchant is not approved' };
  }
  
  return { isValid: true };
}

// Calculate percentage change with proper handling of edge cases
function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

// Performance monitoring helper
function logPerformanceMetrics(operation: string, startTime: number, resultCount: number) {
  const duration = Date.now() - startTime;
  console.log(`[ADMIN-PERFORMANCE] ${operation}: ${duration}ms, ${resultCount} results`);
  
  if (duration > 2000) {
    console.warn(`[SLOW-ADMIN-QUERY] ${operation} took ${duration}ms - consider optimization`);
  }
}

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

// Performance API validation schemas
const performanceQuerySchema = z.object({
  period: z.enum(['1d', '7d', '30d', '90d']).default('7d'),
  cityId: z.string().optional().transform(val => val ? parseInt(val) : undefined),
  merchantId: z.string().optional().transform(val => val ? parseInt(val) : undefined),
  limit: z.string().optional().transform(val => val ? parseInt(val) : 10),
  metric: z.enum(['checkins', 'saves', 'sales']).default('checkins')
});

const weeklyChartQuerySchema = z.object({
  cityId: z.string().optional(),
  merchantId: z.string().optional(),
  metric: z.enum(['checkins', 'saves', 'sales']).default('checkins')
}).refine(data => data.cityId || data.merchantId, {
  message: "Either cityId or merchantId must be provided"
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

// --- Endpoint: GET /api/admin/performance/overview ---
// Get platform-wide performance metrics for admin dashboard
router.get('/performance/overview', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { period = '7d', cityId, merchantId } = req.query as any;
    
    // Validate period parameter
    const periodValidation = validatePeriod(period);
    if (!periodValidation.isValid) {
      return res.status(400).json({ error: periodValidation.error });
    }

    // Validate optional filters
    if (cityId && isNaN(parseInt(cityId))) {
      return res.status(400).json({ error: 'Invalid cityId. Must be a number.' });
    }
    if (merchantId && isNaN(parseInt(merchantId))) {
      return res.status(400).json({ error: 'Invalid merchantId. Must be a number.' });
    }

    // Calculate date ranges
    const dateRanges = calculateDateRanges(periodValidation.days);

    // Build merchant filter based on city or specific merchant
    let merchantIds: number[] | undefined;
    
    if (cityId) {
      merchantIds = await getMerchantIdsForCity(parseInt(cityId));
      
      if (merchantIds.length === 0) {
        logPerformanceMetrics('Performance Overview (No Data)', startTime, 0);
        return res.status(200).json({
          success: true,
          period,
          dateRange: {
            from: dateRanges.current.from.toISOString(),
            to: dateRanges.current.to.toISOString()
          },
          metrics: {
            grossSales: { value: 0, change: 0, trend: 'up' },
            orderVolume: { value: 0, change: 0, trend: 'up' },
            averageOrderValue: { value: 0, change: 0, trend: 'up' },
            totalApprovedMerchants: { value: 0, change: 0, trend: 'up' }
          },
          filters: { cityId: parseInt(cityId), merchantId: null },
          message: 'No approved merchants found in this city'
        });
      }
    } else if (merchantId) {
      const merchantValidation = await validateMerchant(parseInt(merchantId));
      if (!merchantValidation.isValid) {
        return res.status(400).json({ error: merchantValidation.error });
      }
      merchantIds = [parseInt(merchantId)];
    }

    // Build where clauses for current and previous periods
    const currentWhere: any = { createdAt: { gte: dateRanges.current.from } };
    const prevWhere: any = { 
      createdAt: { 
        gte: dateRanges.previous.from, 
        lte: dateRanges.previous.to 
      } 
    };
    
    if (merchantIds) {
      currentWhere.merchantId = { in: merchantIds };
      prevWhere.merchantId = { in: merchantIds };
    }

    // Get current period metrics with performance monitoring
    const [
      currentGrossSales,
      currentOrderVolume,
      currentTotalMerchants,
      prevGrossSales,
      prevOrderVolume,
      prevTotalMerchants
    ] = await Promise.all([
      // Current gross sales (from kickback events)
      prisma.kickbackEvent.aggregate({
        where: currentWhere,
        _sum: { sourceAmountSpent: true }
      }),
      // Current order volume (check-ins)
      prisma.checkIn.count({
        where: currentWhere
      }),
      // Current total approved merchants
      prisma.merchant.count({
        where: {
          status: 'APPROVED',
          ...(merchantIds && { id: { in: merchantIds } })
        }
      }),
      // Previous period gross sales
      prisma.kickbackEvent.aggregate({
        where: prevWhere,
        _sum: { sourceAmountSpent: true }
      }),
      // Previous period order volume
      prisma.checkIn.count({
        where: prevWhere
      }),
      // Previous total merchants (at end of previous period)
      prisma.merchant.count({
        where: {
          status: 'APPROVED',
          createdAt: { lte: dateRanges.previous.to },
          ...(merchantIds && { id: { in: merchantIds } })
        }
      })
    ]);

    // Calculate metrics
    const grossSales = Number(currentGrossSales._sum.sourceAmountSpent || 0);
    const orderVolume = currentOrderVolume;
    const totalMerchants = currentTotalMerchants;
    const averageOrderValue = orderVolume > 0 ? grossSales / orderVolume : 0;

    // Calculate percentage changes using helper function
    const prevGrossSalesAmount = Number(prevGrossSales._sum.sourceAmountSpent || 0);
    const grossSalesChange = calculatePercentageChange(grossSales, prevGrossSalesAmount);
    const orderVolumeChange = calculatePercentageChange(orderVolume, prevOrderVolume);
    
    const avgOrderValuePrev = prevOrderVolume > 0 ? prevGrossSalesAmount / prevOrderVolume : 0;
    const avgOrderValueChange = calculatePercentageChange(averageOrderValue, avgOrderValuePrev);
    const merchantChange = calculatePercentageChange(totalMerchants, prevTotalMerchants);

    logPerformanceMetrics('Performance Overview', startTime, totalMerchants);

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateRanges.current.from.toISOString(),
        to: dateRanges.current.to.toISOString()
      },
      metrics: {
        grossSales: {
          value: Number(grossSales.toFixed(2)),
          change: Number(grossSalesChange.toFixed(1)),
          trend: grossSalesChange >= 0 ? 'up' : 'down'
        },
        orderVolume: {
          value: orderVolume,
          change: Number(orderVolumeChange.toFixed(1)),
          trend: orderVolumeChange >= 0 ? 'up' : 'down'
        },
        averageOrderValue: {
          value: Number(averageOrderValue.toFixed(2)),
          change: Number(avgOrderValueChange.toFixed(1)),
          trend: avgOrderValueChange >= 0 ? 'up' : 'down'
        },
        totalApprovedMerchants: {
          value: totalMerchants,
          change: Number(merchantChange.toFixed(1)),
          trend: merchantChange >= 0 ? 'up' : 'down'
        }
      },
      filters: {
        cityId: cityId ? parseInt(cityId) : null,
        merchantId: merchantId ? parseInt(merchantId) : null
      }
    });

  } catch (error) {
    console.error('Get performance overview error:', error);
    logPerformanceMetrics('Performance Overview (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch performance overview'
    });
  }
});

// --- Endpoint: GET /api/admin/performance/cities ---
// Get city performance metrics for admin dashboard
router.get('/performance/cities', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    // Validate query parameters
    const validation = performanceQuerySchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid query parameters',
        details: validation.error.issues 
      });
    }
    
    const { period } = validation.data;
    
    // Calculate date ranges using helper function
    const periodValidation = validatePeriod(period);
    const dateRanges = calculateDateRanges(periodValidation.days);

    // Get cities with performance data
    const cities = await prisma.city.findMany({
      where: { active: true },
      include: {
        stores: {
          where: { active: true },
          include: {
            merchant: {
              select: {
                id: true,
                status: true,
                businessName: true
              }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    // Calculate performance for each city
    const cityPerformance = await Promise.all(
      cities.map(async (city) => {
        const approvedStores = city.stores.filter(store => store.merchant?.status === 'APPROVED');

        if (approvedStores.length === 0) {
          return {
            id: city.id,
            name: city.name,
            state: city.state,
            value: 0,
            change: 0,
            trend: 'up' as const
          };
        }

        // Get current period metrics for this city
        const currentMetrics = await prisma.checkIn.count({
          where: {
            merchantId: { in: approvedStores.map(store => store.merchant!.id) },
            createdAt: { gte: dateRanges.current.from }
          }
        });

        // Get previous period metrics
        const prevMetrics = await prisma.checkIn.count({
          where: {
            merchantId: { in: approvedStores.map(store => store.merchant!.id) },
            createdAt: { 
              gte: dateRanges.previous.from, 
              lte: dateRanges.previous.to 
            }
          }
        });

        const currentValue = currentMetrics;
        const prevValue = prevMetrics;
        const change = calculatePercentageChange(currentValue, prevValue);

        return {
          id: city.id,
          name: city.name,
          state: city.state,
          value: currentValue,
          change: Number(change.toFixed(1)),
          trend: change >= 0 ? 'up' as const : 'down' as const
        };
      })
    );

    // Sort by value descending and take top 10
    const topCities = cityPerformance
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    logPerformanceMetrics('City Performance', startTime, topCities.length);

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateRanges.current.from.toISOString(),
        to: dateRanges.current.to.toISOString()
      },
      cities: topCities,
      totalCities: cityPerformance.length
    });

  } catch (error) {
    console.error('Get city performance error:', error);
    logPerformanceMetrics('City Performance (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch city performance metrics'
    });
  }
});

// --- Endpoint: GET /api/admin/performance/weekly-chart ---
// Get weekly activity chart data for specific city or merchant
router.get('/performance/weekly-chart', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    // Validate query parameters
    const validation = weeklyChartQuerySchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid query parameters',
        details: validation.error.issues 
      });
    }
    
    const { cityId, merchantId, metric } = validation.data;

    // Get last 7 days
    const now = new Date();
    const days = [];
    const data = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });

      // Build where clause
      const whereClause: any = {
        createdAt: { gte: dayStart, lte: dayEnd }
      };

      if (cityId) {
        // Get merchant IDs for this city using helper function
        const cityMerchantIds = await getMerchantIdsForCity(parseInt(cityId));
        if (cityMerchantIds.length === 0) {
          days.push(dayName);
          data.push(0);
          continue;
        }
        whereClause.merchantId = { in: cityMerchantIds };
      } else if (merchantId) {
        // Validate merchant exists and is approved
        const merchantValidation = await validateMerchant(parseInt(merchantId));
        if (!merchantValidation.isValid) {
          return res.status(400).json({ error: merchantValidation.error });
        }
        whereClause.merchantId = parseInt(merchantId);
      }

      let value = 0;

      if (metric === 'checkins') {
        value = await prisma.checkIn.count({ where: whereClause });
      } else if (metric === 'saves') {
        value = await prisma.userDeal.count({ 
          where: {
            deal: {
              merchantId: whereClause.merchantId,
              createdAt: whereClause.createdAt
            }
          }
        });
      } else if (metric === 'sales') {
        value = await prisma.kickbackEvent.count({
          where: whereClause
        });
      }

      days.push(dayName);
      data.push(value);
    }

    logPerformanceMetrics('Weekly Chart', startTime, data.length);

    res.status(200).json({
      success: true,
      cityId: cityId ? parseInt(cityId) : null,
      merchantId: merchantId ? parseInt(merchantId) : null,
      metric,
      chartData: {
        days,
        data
      },
      totalDataPoints: data.length,
      totalValue: data.reduce((sum, val) => sum + val, 0)
    });

  } catch (error) {
    console.error('Get weekly chart error:', error);
    logPerformanceMetrics('Weekly Chart (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch weekly chart data'
    });
  }
});

// --- Endpoint: GET /api/admin/performance/sales-by-store ---
// Get sales by store ranking
router.get('/performance/sales-by-store', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { cityId, limit = 10, period = '7d' } = req.query as any;
    
    // Calculate date range
    const now = new Date();
    let dateFrom: Date;
    
    switch (period) {
      case '1d':
        dateFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Get stores with sales data
    const whereClause: any = {
      active: true,
      merchant: {
        status: 'APPROVED'
      }
    };

    if (cityId) {
      whereClause.cityId = parseInt(cityId);
    }

    const stores = await prisma.store.findMany({
      where: whereClause,
      include: {
        merchant: {
          select: {
            businessName: true
          }
        },
        city: {
          select: {
            name: true,
            state: true
          }
        }
      }
    });

    // Calculate sales for each store
    const storeSales = await Promise.all(
      stores.map(async (store) => {
        // Get current period sales (check-ins)
        const currentSales = await prisma.checkIn.count({
          where: {
            merchantId: store.merchantId,
            createdAt: { gte: dateFrom }
          }
        });

        // Get previous period for comparison
        const periodDays = Math.ceil((now.getTime() - dateFrom.getTime()) / (24 * 60 * 60 * 1000));
        const prevDateFrom = new Date(dateFrom.getTime() - periodDays * 24 * 60 * 60 * 1000);
        const prevDateTo = new Date(dateFrom.getTime() - 1);

        const prevSales = await prisma.checkIn.count({
          where: {
            merchantId: store.merchantId,
            createdAt: { gte: prevDateFrom, lte: prevDateTo }
          }
        });

        const change = prevSales > 0 ? ((currentSales - prevSales) / prevSales) * 100 : 0;

        return {
          id: store.id,
          name: store.merchant.businessName,
          city: `${store.city.name}, ${store.city.state}`,
          sales: currentSales,
          change: Number(change.toFixed(1)),
          trend: change >= 0 ? 'up' as const : 'down' as const
        };
      })
    );

    // Sort by sales descending and limit
    const topStores = storeSales
      .sort((a, b) => b.sales - a.sales)
      .slice(0, parseInt(limit));

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateFrom.toISOString(),
        to: now.toISOString()
      },
      stores: topStores
    });

  } catch (error) {
    console.error('Get sales by store error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/admin/performance/top-merchants ---
// Get top performing merchants by revenue
router.get('/performance/top-merchants', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { limit = 10, period = '7d' } = req.query as any;
    
    // Calculate date range
    const now = new Date();
    let dateFrom: Date;
    
    switch (period) {
      case '1d':
        dateFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Get merchants with revenue data
    const merchants = await prisma.merchant.findMany({
      where: { status: 'APPROVED' },
      select: {
        id: true,
        businessName: true,
        description: true,
        logoUrl: true
      }
    });

    // Calculate revenue for each merchant
    const merchantRevenue = await Promise.all(
      merchants.map(async (merchant) => {
        // Get current period revenue (from kickback events)
        const currentRevenue = await prisma.kickbackEvent.aggregate({
          where: {
            merchantId: merchant.id,
            createdAt: { gte: dateFrom }
          },
          _sum: { sourceAmountSpent: true }
        });

        // Get previous period for comparison
        const periodDays = Math.ceil((now.getTime() - dateFrom.getTime()) / (24 * 60 * 60 * 1000));
        const prevDateFrom = new Date(dateFrom.getTime() - periodDays * 24 * 60 * 60 * 1000);
        const prevDateTo = new Date(dateFrom.getTime() - 1);

        const prevRevenue = await prisma.kickbackEvent.aggregate({
          where: {
            merchantId: merchant.id,
            createdAt: { gte: prevDateFrom, lte: prevDateTo }
          },
          _sum: { sourceAmountSpent: true }
        });

        const currentValue = Number(currentRevenue._sum.sourceAmountSpent || 0);
        const prevValue = Number(prevRevenue._sum.sourceAmountSpent || 0);
        const change = prevValue > 0 ? ((currentValue - prevValue) / prevValue) * 100 : 0;

        return {
          id: merchant.id,
          name: merchant.businessName,
          description: merchant.description,
          logoUrl: merchant.logoUrl,
          revenue: Number(currentValue.toFixed(2)),
          change: Number(change.toFixed(1)),
          trend: change >= 0 ? 'up' as const : 'down' as const
        };
      })
    );

    // Sort by revenue descending and limit
    const topMerchants = merchantRevenue
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, parseInt(limit));

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateFrom.toISOString(),
        to: now.toISOString()
      },
      merchants: topMerchants
    });

  } catch (error) {
    console.error('Get top merchants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/admin/performance/top-cities ---
// Get top cities by revenue
router.get('/performance/top-cities', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { limit = 10, period = '7d' } = req.query as any;
    
    // Calculate date range
    const now = new Date();
    let dateFrom: Date;
    
    switch (period) {
      case '1d':
        dateFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Get cities with revenue data
    const cities = await prisma.city.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        state: true
      }
    });

    // Calculate revenue for each city
    const cityRevenue = await Promise.all(
      cities.map(async (city) => {
        // Get merchant IDs for this city
        const cityMerchants = await prisma.merchant.findMany({
          where: {
            stores: {
              some: { cityId: city.id }
            },
            status: 'APPROVED'
          },
          select: { id: true }
        });

        // Get current period revenue (from kickback events)
        const currentRevenue = await prisma.kickbackEvent.aggregate({
          where: {
            merchantId: { in: cityMerchants.map(m => m.id) },
            createdAt: { gte: dateFrom }
          },
          _sum: { sourceAmountSpent: true }
        });

        // Get previous period for comparison
        const periodDays = Math.ceil((now.getTime() - dateFrom.getTime()) / (24 * 60 * 60 * 1000));
        const prevDateFrom = new Date(dateFrom.getTime() - periodDays * 24 * 60 * 60 * 1000);
        const prevDateTo = new Date(dateFrom.getTime() - 1);

        const prevRevenue = await prisma.kickbackEvent.aggregate({
          where: {
            merchantId: { in: cityMerchants.map(m => m.id) },
            createdAt: { gte: prevDateFrom, lte: prevDateTo }
          },
          _sum: { sourceAmountSpent: true }
        });

        const currentValue = Number(currentRevenue._sum.sourceAmountSpent || 0);
        const prevValue = Number(prevRevenue._sum.sourceAmountSpent || 0);
        const change = prevValue > 0 ? ((currentValue - prevValue) / prevValue) * 100 : 0;

        return {
          id: city.id,
          name: city.name,
          state: city.state,
          revenue: Number(currentValue.toFixed(2)),
          change: Number(change.toFixed(1)),
          trend: change >= 0 ? 'up' as const : 'down' as const
        };
      })
    );

    // Sort by revenue descending and limit
    const topCities = cityRevenue
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, parseInt(limit));

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateFrom.toISOString(),
        to: now.toISOString()
      },
      cities: topCities
    });

  } catch (error) {
    console.error('Get top cities error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/admin/performance/top-categories ---
// Get top categories by deals count
router.get('/performance/top-categories', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { limit = 10, period = '7d' } = req.query as any;
    
    // Calculate date range
    const now = new Date();
    let dateFrom: Date;
    
    switch (period) {
      case '1d':
        dateFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Get categories with deal counts
    const categories = await prisma.dealCategoryMaster.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        description: true,
        icon: true,
        color: true
      }
    });

    // Calculate deal counts for each category
    const categoryStats = await Promise.all(
      categories.map(async (category) => {
        // Get current period deals
        const currentDeals = await prisma.deal.count({
          where: {
            category: {
              name: category.name
            },
            createdAt: { gte: dateFrom },
            merchant: {
              status: 'APPROVED'
            }
          }
        });

        // Get previous period for comparison
        const periodDays = Math.ceil((now.getTime() - dateFrom.getTime()) / (24 * 60 * 60 * 1000));
        const prevDateFrom = new Date(dateFrom.getTime() - periodDays * 24 * 60 * 60 * 1000);
        const prevDateTo = new Date(dateFrom.getTime() - 1);

        const prevDeals = await prisma.deal.count({
          where: {
            category: {
              name: category.name
            },
            createdAt: { gte: prevDateFrom, lte: prevDateTo },
            merchant: {
              status: 'APPROVED'
            }
          }
        });

        const change = prevDeals > 0 ? ((currentDeals - prevDeals) / prevDeals) * 100 : 0;

        return {
          id: category.id,
          name: category.name,
          description: category.description,
          icon: category.icon,
          color: category.color,
          deals: currentDeals,
          change: Number(change.toFixed(1)),
          trend: change >= 0 ? 'up' as const : 'down' as const
        };
      })
    );

    // Sort by deals descending and limit
    const topCategories = categoryStats
      .sort((a, b) => b.deals - a.deals)
      .slice(0, parseInt(limit));

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateFrom.toISOString(),
        to: now.toISOString()
      },
      categories: topCategories
    });

  } catch (error) {
    console.error('Get top categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;