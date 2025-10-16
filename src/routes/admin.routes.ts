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
          deals: {
            select: {
              id: true,
              title: true,
              startTime: true,
              endTime: true,
              createdAt: true
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

    // Calculate deal counts dynamically
    const now = new Date();
    const merchantsWithCounts = merchants.map(merchant => {
      // Count all deals
      const totalDeals = merchant.deals.length;
      
      // Count active deals (currently valid based on time)
      const activeDeals = merchant.deals.filter(deal => 
        new Date(deal.startTime) <= now && new Date(deal.endTime) >= now
      ).length;
      
      // Count upcoming deals
      const upcomingDeals = merchant.deals.filter(deal => 
        new Date(deal.startTime) > now
      ).length;
      
      // Count expired deals
      const expiredDeals = merchant.deals.filter(deal => 
        new Date(deal.endTime) < now
      ).length;

      return {
        id: merchant.id,
        businessName: merchant.businessName,
        description: merchant.description,
        address: merchant.address,
        logoUrl: merchant.logoUrl,
        latitude: merchant.latitude,
        longitude: merchant.longitude,
        status: merchant.status,
        phoneNumber: merchant.phoneNumber,
        createdAt: merchant.createdAt,
        updatedAt: merchant.updatedAt,
        owner: merchant.owner,
        stores: merchant.stores,
        totalDeals,
        activeDeals,
        upcomingDeals,
        expiredDeals,
        totalStores: merchant.stores.length
      };
    });

    res.status(200).json({
      message: 'Merchants retrieved successfully',
      merchants: merchantsWithCounts,
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
// Get top categories by deals count, optionally filtered by city
router.get('/performance/top-categories', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { limit = 10, period = '7d', cityId } = req.query as any;
    
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

    // Get merchant IDs for city filter if provided
    let merchantIds: number[] | undefined;
    if (cityId) {
      merchantIds = await getMerchantIdsForCity(parseInt(cityId));
      
      // If no merchants in this city, return empty results
      if (merchantIds.length === 0) {
        return res.status(200).json({
          success: true,
          period,
          dateRange: {
            from: dateFrom.toISOString(),
            to: now.toISOString()
          },
          categories: [],
          filters: { cityId: parseInt(cityId) },
          message: 'No approved merchants found in this city'
        });
      }
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

    // Build where clause for deals
    const buildDealWhere = (dateFilter: any) => {
      const where: any = {
        category: {},
        createdAt: dateFilter,
        merchant: {
          status: 'APPROVED'
        }
      };
      
      if (merchantIds) {
        where.merchantId = { in: merchantIds };
      }
      
      return where;
    };

    // Calculate deal counts for each category
    const categoryStats = await Promise.all(
      categories.map(async (category) => {
        // Get current period deals
        const currentWhere = buildDealWhere({ gte: dateFrom });
        currentWhere.category.name = category.name;
        
        const currentDeals = await prisma.deal.count({
          where: currentWhere
        });

        // Get previous period for comparison
        const periodDays = Math.ceil((now.getTime() - dateFrom.getTime()) / (24 * 60 * 60 * 1000));
        const prevDateFrom = new Date(dateFrom.getTime() - periodDays * 24 * 60 * 60 * 1000);
        const prevDateTo = new Date(dateFrom.getTime() - 1);

        const prevWhere = buildDealWhere({ gte: prevDateFrom, lte: prevDateTo });
        prevWhere.category.name = category.name;
        
        const prevDeals = await prisma.deal.count({
          where: prevWhere
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
      categories: topCategories,
      filters: {
        cityId: cityId ? parseInt(cityId) : null
      }
    });

  } catch (error) {
    console.error('Get top categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Customer Management APIs ---

// --- Endpoint: GET /api/admin/customers/overview ---
// Get customer management KPIs for admin dashboard
router.get('/customers/overview', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { period = '30d', cityId, state } = req.query as any;
    
    // Validate period parameter
    const periodValidation = validatePeriod(period);
    if (!periodValidation.isValid) {
      return res.status(400).json({ error: periodValidation.error });
    }

    // Calculate date ranges
    const dateRanges = calculateDateRanges(periodValidation.days);

    // Build location filters
    let locationFilter: any = {};
    if (cityId) {
      locationFilter.cityId = parseInt(cityId);
    }
    if (state) {
      locationFilter.state = state;
    }

    // Get customer overview metrics
    const [
      totalCustomers,
      paidMembers,
      totalSpend,
      avgSpend,
      prevTotalCustomers,
      prevPaidMembers,
      prevTotalSpend,
      prevAvgSpend
    ] = await Promise.all([
      // Current total customers
      prisma.user.count({
        where: {
          role: 'USER',
          ...(Object.keys(locationFilter).length > 0 && {
            savedDeals: {
              some: {
                deal: {
                  merchant: {
                    stores: {
                      some: locationFilter
                    }
                  }
                }
              }
            }
          })
        }
      }),
      
      // Current paid members (users with premium subscriptions or high spending)
      prisma.user.count({
        where: {
          role: 'USER',
          OR: [
            { monthlyPoints: { gte: 1000 } }, // High engagement users
            { points: { gte: 500 } }, // Users with significant points
            {
              savedDeals: {
                some: {
                  deal: {
                    merchant: {
                      stores: {
                        some: locationFilter
                      }
                    }
                  }
                }
              }
            }
          ]
        }
      }),
      
      // Current total spend (from kickback events)
      prisma.kickbackEvent.aggregate({
        where: {
          createdAt: { gte: dateRanges.current.from },
          ...(Object.keys(locationFilter).length > 0 && {
            merchant: {
              stores: {
                some: locationFilter
              }
            }
          })
        },
        _sum: { sourceAmountSpent: true }
      }),
      
      // Calculate transaction count for average spend
      prisma.kickbackEvent.count({
        where: {
          createdAt: { gte: dateRanges.current.from },
          ...(Object.keys(locationFilter).length > 0 && {
            merchant: {
              stores: {
                some: locationFilter
              }
            }
          })
        }
      }),
      
      // Previous period metrics
      prisma.user.count({
        where: {
          role: 'USER',
          createdAt: { lte: dateRanges.previous.to },
          ...(Object.keys(locationFilter).length > 0 && {
            savedDeals: {
              some: {
                deal: {
                  merchant: {
                    stores: {
                      some: locationFilter
                    }
                  }
                }
              }
            }
          })
        }
      }),
      
      prisma.user.count({
        where: {
          role: 'USER',
          createdAt: { lte: dateRanges.previous.to },
          OR: [
            { monthlyPoints: { gte: 1000 } },
            { points: { gte: 500 } }
          ]
        }
      }),
      
      prisma.kickbackEvent.aggregate({
        where: {
          createdAt: { 
            gte: dateRanges.previous.from, 
            lte: dateRanges.previous.to 
          },
          ...(Object.keys(locationFilter).length > 0 && {
            merchant: {
              stores: {
                some: locationFilter
              }
            }
          })
        },
        _sum: { sourceAmountSpent: true }
      }),
      
      prisma.kickbackEvent.count({
        where: {
          createdAt: { 
            gte: dateRanges.previous.from, 
            lte: dateRanges.previous.to 
          },
          ...(Object.keys(locationFilter).length > 0 && {
            merchant: {
              stores: {
                some: locationFilter
              }
            }
          })
        }
      })
    ]);

    // Calculate metrics
    const totalSpendAmount = Number(totalSpend._sum.sourceAmountSpent || 0);
    const totalTransactions = avgSpend;
    const averageSpend = totalTransactions > 0 ? totalSpendAmount / totalTransactions : 0;

    const prevTotalSpendAmount = Number(prevTotalSpend._sum.sourceAmountSpent || 0);
    const prevTotalTransactions = prevAvgSpend;
    const prevAverageSpend = prevTotalTransactions > 0 ? prevTotalSpendAmount / prevTotalTransactions : 0;

    // Calculate percentage changes
    const totalCustomersChange = calculatePercentageChange(totalCustomers, prevTotalCustomers);
    const paidMembersChange = calculatePercentageChange(paidMembers, prevPaidMembers);
    const totalSpendChange = calculatePercentageChange(totalSpendAmount, prevTotalSpendAmount);
    const avgSpendChange = calculatePercentageChange(averageSpend, prevAverageSpend);

    logPerformanceMetrics('Customer Overview', startTime, totalCustomers);

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateRanges.current.from.toISOString(),
        to: dateRanges.current.to.toISOString()
      },
      metrics: {
        totalCustomers: {
          value: totalCustomers,
          change: Number(totalCustomersChange.toFixed(1)),
          trend: totalCustomersChange >= 0 ? 'up' : 'down'
        },
        paidMembers: {
          value: paidMembers,
          change: Number(paidMembersChange.toFixed(1)),
          trend: paidMembersChange >= 0 ? 'up' : 'down'
        },
        totalSpend: {
          value: Number(totalSpendAmount.toFixed(2)),
          change: Number(totalSpendChange.toFixed(1)),
          trend: totalSpendChange >= 0 ? 'up' : 'down'
        },
        averageSpend: {
          value: Number(averageSpend.toFixed(2)),
          change: Number(avgSpendChange.toFixed(1)),
          trend: avgSpendChange >= 0 ? 'up' : 'down'
        }
      },
      filters: {
        cityId: cityId ? parseInt(cityId) : null,
        state: state || null
      }
    });

  } catch (error) {
    console.error('Get customer overview error:', error);
    logPerformanceMetrics('Customer Overview (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch customer overview'
    });
  }
});

// --- Endpoint: GET /api/admin/customers ---
// Get customer list with search and filtering
router.get('/customers', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { 
      page = 1, 
      limit = 50, 
      search, 
      cityId, 
      state, 
      memberType = 'all',
      sortBy = 'lastActive',
      sortOrder = 'desc'
    } = req.query as any;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build search filter
    let searchFilter: any = {
      role: 'USER'
    };

    if (search && search.trim().length > 0) {
      const searchTerm = search.trim();
      searchFilter.OR = [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { email: { contains: searchTerm, mode: 'insensitive' } }
      ];
    }

    // Build member type filter
    if (memberType === 'paid') {
      searchFilter.OR = [
        { monthlyPoints: { gte: 1000 } },
        { points: { gte: 500 } }
      ];
    } else if (memberType === 'free') {
      searchFilter.AND = [
        { monthlyPoints: { lt: 1000 } },
        { points: { lt: 500 } }
      ];
    }

    // Get customers with their activity data
    const [customers, totalCount] = await Promise.all([
      prisma.user.findMany({
        where: searchFilter,
        select: {
          id: true,
          name: true,
          email: true,
          points: true,
          monthlyPoints: true,
          createdAt: true,
          savedDeals: {
            select: {
              savedAt: true,
              deal: {
                select: {
                  merchant: {
                    select: {
                      stores: {
                        select: {
                          city: {
                            select: {
                              name: true,
                              state: true
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            orderBy: { savedAt: 'desc' },
            take: 1
          },
          checkIns: {
            select: {
              createdAt: true
            },
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: parseInt(limit)
      }),
      
      prisma.user.count({ where: searchFilter })
    ]);

    // Calculate customer metrics and format response
    const formattedCustomers = await Promise.all(
      customers.map(async (customer) => {
        // Get customer's total spend
        const totalSpend = await prisma.kickbackEvent.aggregate({
          where: { userId: customer.id },
          _sum: { sourceAmountSpent: true }
        });

        // Determine member type
        const isPaidMember = customer.monthlyPoints >= 1000 || customer.points >= 500;
        const memberType = isPaidMember ? 'paid' : 'free';

        // Get primary location from saved deals
        const primaryLocation = customer.savedDeals[0]?.deal?.merchant?.stores?.[0]?.city;

        // Get last active date
        const lastSavedDeal = customer.savedDeals[0]?.savedAt;
        const lastCheckIn = customer.checkIns[0]?.createdAt;
        const lastActive = lastSavedDeal && lastCheckIn 
          ? (lastSavedDeal > lastCheckIn ? lastSavedDeal : lastCheckIn)
          : (lastSavedDeal || lastCheckIn || customer.createdAt);

        return {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          location: primaryLocation ? `${primaryLocation.name}, ${primaryLocation.state}` : 'Unknown',
          totalSpend: Number((totalSpend._sum.sourceAmountSpent || 0).toFixed(2)),
          points: customer.points,
          memberType,
          lastActive: lastActive.toISOString().split('T')[0],
          createdAt: customer.createdAt.toISOString().split('T')[0]
        };
      })
    );

    logPerformanceMetrics('Customer List', startTime, formattedCustomers.length);

    res.status(200).json({
      success: true,
      customers: formattedCustomers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        hasNext: skip + parseInt(limit) < totalCount,
        hasPrev: parseInt(page) > 1
      },
      filters: {
        search: search || null,
        cityId: cityId ? parseInt(cityId) : null,
        state: state || null,
        memberType,
        sortBy,
        sortOrder
      }
    });

  } catch (error) {
    console.error('Get customers error:', error);
    logPerformanceMetrics('Customer List (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch customers'
    });
  }
});

// --- Endpoint: GET /api/admin/customers/:customerId ---
// Get detailed information about a specific customer
router.get('/customers/:customerId', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const customerId = parseInt(req.params.customerId);
    
    if (isNaN(customerId)) {
      return res.status(400).json({ error: 'Invalid customer ID' });
    }

    // Get customer details
    const customer = await prisma.user.findUnique({
      where: { id: customerId, role: 'USER' },
      select: {
        id: true,
        name: true,
        email: true,
        points: true,
        monthlyPoints: true,
        createdAt: true,
        updatedAt: true,
        savedDeals: {
          include: {
            deal: {
              select: {
                id: true,
                title: true,
                merchant: {
                  select: {
                    businessName: true,
                    stores: {
                      select: {
                        city: {
                          select: {
                            name: true,
                            state: true
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          orderBy: { savedAt: 'desc' }
        },
        checkIns: {
          include: {
            deal: {
              select: {
                id: true,
                title: true,
                merchant: {
                  select: {
                    businessName: true
                  }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Get customer's spending data
    const [
      totalSpend,
      monthlySpend,
      dealSaves,
      checkIns,
      kickbackEvents
    ] = await Promise.all([
      prisma.kickbackEvent.aggregate({
        where: { userId: customerId },
        _sum: { sourceAmountSpent: true },
        _count: { id: true }
      }),
      
      prisma.kickbackEvent.aggregate({
        where: { 
          userId: customerId,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        },
        _sum: { sourceAmountSpent: true }
      }),
      
      prisma.userDeal.count({ where: { userId: customerId } }),
      prisma.checkIn.count({ where: { userId: customerId } }),
      prisma.kickbackEvent.findMany({
        where: { userId: customerId },
        include: {
          deal: {
            select: {
              title: true,
              merchant: {
                select: {
                  businessName: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      })
    ]);

    // Calculate engagement metrics
    const totalSpendAmount = Number(totalSpend._sum.sourceAmountSpent || 0);
    const monthlySpendAmount = Number(monthlySpend._sum.sourceAmountSpent || 0);
    const isPaidMember = customer.monthlyPoints >= 1000 || customer.points >= 500;
    
    // Get primary location
    const primaryLocation = customer.savedDeals[0]?.deal?.merchant?.stores?.[0]?.city;

    // Get last active date
    const lastSavedDeal = customer.savedDeals[0]?.savedAt;
    const lastCheckIn = customer.checkIns[0]?.createdAt;
    const lastActive = lastSavedDeal && lastCheckIn 
      ? (lastSavedDeal > lastCheckIn ? lastSavedDeal : lastCheckIn)
      : (lastSavedDeal || lastCheckIn || customer.createdAt);

    logPerformanceMetrics('Customer Details', startTime, 1);

    res.status(200).json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        location: primaryLocation ? `${primaryLocation.name}, ${primaryLocation.state}` : 'Unknown',
        memberType: isPaidMember ? 'paid' : 'free',
        points: customer.points,
        monthlyPoints: customer.monthlyPoints,
        totalSpend: Number(totalSpendAmount.toFixed(2)),
        monthlySpend: Number(monthlySpendAmount.toFixed(2)),
        totalTransactions: totalSpend._count.id,
        totalDealSaves: dealSaves,
        totalCheckIns: checkIns,
        lastActive: lastActive.toISOString(),
        createdAt: customer.createdAt.toISOString(),
        updatedAt: customer.updatedAt.toISOString()
      },
      activity: {
        recentSaves: customer.savedDeals.slice(0, 5).map(save => ({
          id: save.deal.id,
          title: save.deal.title,
          merchant: save.deal.merchant.businessName,
          savedAt: save.savedAt.toISOString()
        })),
        recentCheckIns: customer.checkIns.slice(0, 5).map(checkIn => ({
          id: checkIn.deal.id,
          title: checkIn.deal.title,
          merchant: checkIn.deal.merchant.businessName,
          checkedInAt: checkIn.createdAt.toISOString()
        })),
        recentTransactions: kickbackEvents.map(event => ({
          id: event.id,
          deal: event.deal.title,
          merchant: event.deal.merchant.businessName,
          amount: Number(event.sourceAmountSpent.toFixed(2)),
          transactionDate: event.createdAt.toISOString()
        }))
      }
    });

  } catch (error) {
    console.error('Get customer details error:', error);
    logPerformanceMetrics('Customer Details (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch customer details'
    });
  }
});

// --- Endpoint: GET /api/admin/customers/analytics ---
// Get customer analytics and insights
router.get('/customers/analytics', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { period = '30d' } = req.query as any;
    
    // Validate period parameter
    const periodValidation = validatePeriod(period);
    if (!periodValidation.isValid) {
      return res.status(400).json({ error: periodValidation.error });
    }

    // Calculate date ranges
    const dateRanges = calculateDateRanges(periodValidation.days);

    // Get customer analytics
    const [
      totalCustomers,
      newCustomers,
      activeCustomers,
      topSpendingCustomers,
      customerEngagement,
      locationDistribution
    ] = await Promise.all([
      // Total customers
      prisma.user.count({ where: { role: 'USER' } }),
      
      // New customers in period
      prisma.user.count({
        where: {
          role: 'USER',
          createdAt: { gte: dateRanges.current.from }
        }
      }),
      
      // Active customers (with check-ins or saves in period)
      prisma.user.count({
        where: {
          role: 'USER',
          OR: [
            {
              checkIns: {
                some: {
                  createdAt: { gte: dateRanges.current.from }
                }
              }
            },
            {
              savedDeals: {
                some: {
                  savedAt: { gte: dateRanges.current.from }
                }
              }
            }
          ]
        }
      }),
      
      // Top spending customers
      prisma.kickbackEvent.groupBy({
        by: ['userId'],
        where: {
          createdAt: { gte: dateRanges.current.from }
        },
        _sum: { sourceAmountSpent: true },
        orderBy: { _sum: { sourceAmountSpent: 'desc' } },
        take: 10
      }),
      
      // Customer engagement metrics
      prisma.user.aggregate({
        where: { role: 'USER' },
        _avg: { 
          points: true,
          monthlyPoints: true 
        },
        _max: { 
          points: true,
          monthlyPoints: true 
        }
      }),
      
      // Location distribution
      prisma.user.findMany({
        where: { role: 'USER' },
        select: {
          savedDeals: {
            select: {
              deal: {
                select: {
                  merchant: {
                    select: {
                      stores: {
                        select: {
                          city: {
                            select: {
                              name: true,
                              state: true
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      })
    ]);

    // Get top customer details
    const topCustomerIds = topSpendingCustomers.map(c => c.userId);
    const topCustomerDetails = await prisma.user.findMany({
      where: { id: { in: topCustomerIds } },
      select: {
        id: true,
        name: true,
        email: true,
        points: true
      }
    });

    // Format top customers
    const formattedTopCustomers = topSpendingCustomers.map(spender => {
      const customer = topCustomerDetails.find(c => c.id === spender.userId);
      return {
        id: spender.userId,
        name: customer?.name || 'Unknown',
        email: customer?.email || 'Unknown',
        points: customer?.points || 0,
        totalSpend: Number((spender._sum.sourceAmountSpent || 0).toFixed(2))
      };
    });

    // Calculate location distribution
    const locationMap = new Map();
    locationDistribution.forEach(user => {
      user.savedDeals.forEach(save => {
        const city = save.deal?.merchant?.stores?.[0]?.city;
        if (city) {
          const key = `${city.name}, ${city.state}`;
          locationMap.set(key, (locationMap.get(key) || 0) + 1);
        }
      });
    });

    const locationStats = Array.from(locationMap.entries())
      .map(([location, count]) => ({ location, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    logPerformanceMetrics('Customer Analytics', startTime, totalCustomers);

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateRanges.current.from.toISOString(),
        to: dateRanges.current.to.toISOString()
      },
      overview: {
        totalCustomers,
        newCustomers,
        activeCustomers,
        inactiveCustomers: totalCustomers - activeCustomers,
        engagementRate: totalCustomers > 0 ? ((activeCustomers / totalCustomers) * 100).toFixed(1) : '0'
      },
      topCustomers: formattedTopCustomers,
      engagement: {
        averagePoints: Number((customerEngagement._avg.points || 0).toFixed(1)),
        averageMonthlyPoints: Number((customerEngagement._avg.monthlyPoints || 0).toFixed(1)),
        maxPoints: customerEngagement._max.points || 0,
        maxMonthlyPoints: customerEngagement._max.monthlyPoints || 0
      },
      locationDistribution: locationStats
    });

  } catch (error) {
    console.error('Get customer analytics error:', error);
    logPerformanceMetrics('Customer Analytics (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch customer analytics'
    });
  }
});

// ============================================================================
// TAP-INS (CHECK-INS) STATISTICS APIs
// ============================================================================

// --- Endpoint: GET /api/admin/tap-ins/overview ---
// Get comprehensive tap-ins overview with real-time stats from database
router.get('/tap-ins/overview', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { period = '7d', cityId, merchantId } = req.query as any;
    
    // Validate period parameter
    const periodValidation = validatePeriod(period);
    if (!periodValidation.isValid) {
      return res.status(400).json({ error: periodValidation.error });
    }

    // Calculate date ranges
    const dateRanges = calculateDateRanges(periodValidation.days);

    // Build merchant filter based on city or specific merchant
    let merchantIds: number[] | undefined;
    
    if (cityId) {
      merchantIds = await getMerchantIdsForCity(parseInt(cityId));
      
      if (merchantIds.length === 0) {
        logPerformanceMetrics('Tap-ins Overview (No Data)', startTime, 0);
        return res.status(200).json({
          success: true,
          period,
          dateRange: {
            from: dateRanges.current.from.toISOString(),
            to: dateRanges.current.to.toISOString()
          },
          metrics: {
            totalTapIns: { value: 0, change: 0, trend: 'up' },
            uniqueUsers: { value: 0, change: 0, trend: 'up' },
            averageDistance: { value: 0, change: 0, trend: 'up' },
            pointsAwarded: { value: 0, change: 0, trend: 'up' }
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

    // Get current period metrics
    const [
      currentTapIns,
      currentUniqueUsers,
      currentAvgDistance,
      currentPointsAwarded,
      prevTapIns,
      prevUniqueUsers,
      prevAvgDistance,
      prevPointsAwarded
    ] = await Promise.all([
      // Current period tap-ins count
      prisma.checkIn.count({ where: currentWhere }),
      
      // Current period unique users
      prisma.checkIn.groupBy({
        by: ['userId'],
        where: currentWhere,
        _count: { userId: true }
      }).then(result => result.length),
      
      // Current period average distance
      prisma.checkIn.aggregate({
        where: currentWhere,
        _avg: { distanceMeters: true }
      }),
      
      // Current period points awarded (from point events)
      prisma.userPointEvent.aggregate({
        where: {
          pointEventType: {
            name: { in: ['CHECKIN', 'FIRST_CHECKIN_DEAL'] }
          },
          createdAt: { gte: dateRanges.current.from },
          ...(merchantIds && {
            deal: {
              merchantId: { in: merchantIds }
            }
          })
        },
        _sum: { points: true }
      }),
      
      // Previous period metrics
      prisma.checkIn.count({ where: prevWhere }),
      
      prisma.checkIn.groupBy({
        by: ['userId'],
        where: prevWhere,
        _count: { userId: true }
      }).then(result => result.length),
      
      prisma.checkIn.aggregate({
        where: prevWhere,
        _avg: { distanceMeters: true }
      }),
      
      prisma.userPointEvent.aggregate({
        where: {
          pointEventType: {
            name: { in: ['CHECKIN', 'FIRST_CHECKIN_DEAL'] }
          },
          createdAt: { 
            gte: dateRanges.previous.from, 
            lte: dateRanges.previous.to 
          },
          ...(merchantIds && {
            deal: {
              merchantId: { in: merchantIds }
            }
          })
        },
        _sum: { points: true }
      })
    ]);

    // Calculate metrics
    const totalTapIns = currentTapIns;
    const uniqueUsers = currentUniqueUsers;
    const averageDistance = Number((currentAvgDistance._avg.distanceMeters || 0).toFixed(2));
    const pointsAwarded = Number(currentPointsAwarded._sum.points || 0);

    // Calculate percentage changes
    const totalTapInsChange = calculatePercentageChange(totalTapIns, prevTapIns);
    const uniqueUsersChange = calculatePercentageChange(uniqueUsers, prevUniqueUsers);
    const avgDistancePrev = Number(prevAvgDistance._avg.distanceMeters || 0);
    const averageDistanceChange = calculatePercentageChange(averageDistance, avgDistancePrev);
    const pointsAwardedPrev = Number(prevPointsAwarded._sum.points || 0);
    const pointsAwardedChange = calculatePercentageChange(pointsAwarded, pointsAwardedPrev);

    logPerformanceMetrics('Tap-ins Overview', startTime, totalTapIns);

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateRanges.current.from.toISOString(),
        to: dateRanges.current.to.toISOString()
      },
      metrics: {
        totalTapIns: {
          value: totalTapIns,
          change: Number(totalTapInsChange.toFixed(1)),
          trend: totalTapInsChange >= 0 ? 'up' : 'down'
        },
        uniqueUsers: {
          value: uniqueUsers,
          change: Number(uniqueUsersChange.toFixed(1)),
          trend: uniqueUsersChange >= 0 ? 'up' : 'down'
        },
        averageDistance: {
          value: averageDistance,
          change: Number(averageDistanceChange.toFixed(1)),
          trend: averageDistanceChange >= 0 ? 'up' : 'down'
        },
        pointsAwarded: {
          value: pointsAwarded,
          change: Number(pointsAwardedChange.toFixed(1)),
          trend: pointsAwardedChange >= 0 ? 'up' : 'down'
        }
      },
      filters: {
        cityId: cityId ? parseInt(cityId) : null,
        merchantId: merchantId ? parseInt(merchantId) : null
      }
    });

  } catch (error) {
    console.error('Get tap-ins overview error:', error);
    logPerformanceMetrics('Tap-ins Overview (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch tap-ins overview'
    });
  }
});

// --- Endpoint: GET /api/admin/tap-ins/analytics ---
// Get detailed tap-ins analytics with trends and patterns
router.get('/tap-ins/analytics', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { period = '30d', cityId, merchantId } = req.query as any;
    
    // Validate period parameter
    const periodValidation = validatePeriod(period);
    if (!periodValidation.isValid) {
      return res.status(400).json({ error: periodValidation.error });
    }

    // Calculate date ranges
    const dateRanges = calculateDateRanges(periodValidation.days);

    // Build merchant filter
    let merchantIds: number[] | undefined;
    
    if (cityId) {
      merchantIds = await getMerchantIdsForCity(parseInt(cityId));
      if (merchantIds.length === 0) {
        return res.status(200).json({
          success: true,
          period,
          dateRange: {
            from: dateRanges.current.from.toISOString(),
            to: dateRanges.current.to.toISOString()
          },
          analytics: {
            hourlyDistribution: [],
            dailyPatterns: [],
            topDeals: [],
            topMerchants: [],
            distanceAnalysis: { average: 0, median: 0, distribution: [] }
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

    // Build where clause
    const whereClause: any = { createdAt: { gte: dateRanges.current.from } };
    if (merchantIds) {
      whereClause.merchantId = { in: merchantIds };
    }

    // Get detailed analytics
    const [
      hourlyDistribution,
      dailyPatterns,
      topDeals,
      topMerchants,
      distanceAnalysis,
      engagementData
    ] = await Promise.all([
      // Hourly distribution (last 7 days)
      prisma.checkIn.groupBy({
        by: ['createdAt'],
        where: {
          ...whereClause,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        },
        _count: { id: true },
        orderBy: { createdAt: 'asc' }
      }).then(results => {
        const hourlyMap = new Map();
        results.forEach(result => {
          const hour = new Date(result.createdAt).getHours();
          hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + result._count.id);
        });
        return Array.from({ length: 24 }, (_, i) => ({
          hour: i,
          count: hourlyMap.get(i) || 0
        }));
      }),
      
      // Daily patterns (last 30 days)
      prisma.checkIn.groupBy({
        by: ['createdAt'],
        where: {
          ...whereClause,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        },
        _count: { id: true },
        orderBy: { createdAt: 'asc' }
      }).then(results => {
        const dailyMap = new Map();
        results.forEach(result => {
          const day = new Date(result.createdAt).getDay();
          dailyMap.set(day, (dailyMap.get(day) || 0) + result._count.id);
        });
        return Array.from({ length: 7 }, (_, i) => ({
          day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i],
          count: dailyMap.get(i) || 0
        }));
      }),
      
      // Top deals by tap-ins
      prisma.checkIn.groupBy({
        by: ['dealId'],
        where: whereClause,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10
      }).then(async results => {
        const dealIds = results.map(r => r.dealId);
        const deals = await prisma.deal.findMany({
          where: { id: { in: dealIds } },
          select: {
            id: true,
            title: true,
            merchant: {
              select: {
                businessName: true
              }
            }
          }
        });
        
        return results.map(result => {
          const deal = deals.find(d => d.id === result.dealId);
          return {
            dealId: result.dealId,
            title: deal?.title || 'Unknown Deal',
            merchant: deal?.merchant.businessName || 'Unknown Merchant',
            tapIns: result._count.id
          };
        });
      }),
      
      // Top merchants by tap-ins
      prisma.checkIn.groupBy({
        by: ['merchantId'],
        where: whereClause,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10
      }).then(async results => {
        const merchantIds = results.map(r => r.merchantId);
        const merchants = await prisma.merchant.findMany({
          where: { id: { in: merchantIds } },
          select: {
            id: true,
            businessName: true
          }
        });
        
        return results.map(result => {
          const merchant = merchants.find(m => m.id === result.merchantId);
          return {
            merchantId: result.merchantId,
            businessName: merchant?.businessName || 'Unknown Merchant',
            tapIns: result._count.id
          };
        });
      }),
      
      // Distance analysis
      prisma.checkIn.findMany({
        where: whereClause,
        select: { distanceMeters: true }
      }).then(results => {
        const distances = results.map(r => r.distanceMeters);
        const sorted = distances.sort((a, b) => a - b);
        const average = distances.reduce((sum, d) => sum + d, 0) / distances.length;
        const median = sorted.length % 2 === 0 
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];
        
        // Distance distribution
        const distribution = [
          { range: '0-25m', count: distances.filter(d => d <= 25).length },
          { range: '25-50m', count: distances.filter(d => d > 25 && d <= 50).length },
          { range: '50-100m', count: distances.filter(d => d > 50 && d <= 100).length },
          { range: '100m+', count: distances.filter(d => d > 100).length }
        ];
        
        return {
          average: Number(average.toFixed(2)),
          median: Number(median.toFixed(2)),
          distribution
        };
      }),
      
      // First-time vs repeat tap-ins
      prisma.checkIn.groupBy({
        by: ['userId', 'dealId'],
        where: whereClause,
        _count: { id: true }
      }).then(results => {
        const firstTime = results.filter(r => r._count.id === 1).length;
        const repeat = results.filter(r => r._count.id > 1).length;
        return { firstTime, repeat };
      })
    ]);

    logPerformanceMetrics('Tap-ins Analytics', startTime, topDeals.length);

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateRanges.current.from.toISOString(),
        to: dateRanges.current.to.toISOString()
      },
      analytics: {
        hourlyDistribution,
        dailyPatterns,
        topDeals,
        topMerchants,
        distanceAnalysis,
        engagement: {
          firstTimeTapIns: engagementData.firstTime,
          repeatTapIns: engagementData.repeat,
          repeatRate: engagementData.firstTime + engagementData.repeat > 0 
            ? Number(((engagementData.repeat / (engagementData.firstTime + engagementData.repeat)) * 100).toFixed(1))
            : 0
        }
      },
      filters: {
        cityId: cityId ? parseInt(cityId) : null,
        merchantId: merchantId ? parseInt(merchantId) : null
      }
    });

  } catch (error) {
    console.error('Get tap-ins analytics error:', error);
    logPerformanceMetrics('Tap-ins Analytics (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch tap-ins analytics'
    });
  }
});

// --- Endpoint: GET /api/admin/tap-ins/top-performers ---
// Get top performing users and merchants by tap-ins
router.get('/tap-ins/top-performers', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { period = '30d', cityId, merchantId, limit = 10 } = req.query as any;
    
    // Validate period parameter
    const periodValidation = validatePeriod(period);
    if (!periodValidation.isValid) {
      return res.status(400).json({ error: periodValidation.error });
    }

    // Calculate date ranges
    const dateRanges = calculateDateRanges(periodValidation.days);

    // Build merchant filter
    let merchantIds: number[] | undefined;
    
    if (cityId) {
      merchantIds = await getMerchantIdsForCity(parseInt(cityId));
      if (merchantIds.length === 0) {
        return res.status(200).json({
          success: true,
          period,
          dateRange: {
            from: dateRanges.current.from.toISOString(),
            to: dateRanges.current.to.toISOString()
          },
          topUsers: [],
          topMerchants: [],
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

    // Build where clause
    const whereClause: any = { createdAt: { gte: dateRanges.current.from } };
    if (merchantIds) {
      whereClause.merchantId = { in: merchantIds };
    }

    // Get top performers
    const [topUsers, topMerchants] = await Promise.all([
      // Top users by tap-ins
      prisma.checkIn.groupBy({
        by: ['userId'],
        where: whereClause,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: parseInt(limit)
      }).then(async results => {
        const userIds = results.map(r => r.userId);
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            name: true,
            email: true,
            points: true
          }
        });
        
        return results.map(result => {
          const user = users.find(u => u.id === result.userId);
          return {
            userId: result.userId,
            name: user?.name || 'Unknown User',
            email: user?.email || 'Unknown Email',
            points: user?.points || 0,
            tapIns: result._count.id
          };
        });
      }),
      
      // Top merchants by tap-ins
      prisma.checkIn.groupBy({
        by: ['merchantId'],
        where: whereClause,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: parseInt(limit)
      }).then(async results => {
        const merchantIds = results.map(r => r.merchantId);
        const merchants = await prisma.merchant.findMany({
          where: { id: { in: merchantIds } },
          select: {
            id: true,
            businessName: true,
            description: true,
            logoUrl: true
          }
        });
        
        return results.map(result => {
          const merchant = merchants.find(m => m.id === result.merchantId);
          return {
            merchantId: result.merchantId,
            businessName: merchant?.businessName || 'Unknown Merchant',
            description: merchant?.description || '',
            logoUrl: merchant?.logoUrl || null,
            tapIns: result._count.id
          };
        });
      })
    ]);

    logPerformanceMetrics('Tap-ins Top Performers', startTime, topUsers.length + topMerchants.length);

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateRanges.current.from.toISOString(),
        to: dateRanges.current.to.toISOString()
      },
      topUsers,
      topMerchants,
      filters: {
        cityId: cityId ? parseInt(cityId) : null,
        merchantId: merchantId ? parseInt(merchantId) : null
      }
    });

  } catch (error) {
    console.error('Get tap-ins top performers error:', error);
    logPerformanceMetrics('Tap-ins Top Performers (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch tap-ins top performers'
    });
  }
});

// --- Endpoint: GET /api/admin/tap-ins/geographic ---
// Get geographic distribution of tap-ins
router.get('/tap-ins/geographic', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { period = '30d', limit = 20 } = req.query as any;
    
    // Validate period parameter
    const periodValidation = validatePeriod(period);
    if (!periodValidation.isValid) {
      return res.status(400).json({ error: periodValidation.error });
    }

    // Calculate date ranges
    const dateRanges = calculateDateRanges(periodValidation.days);

    // Build where clause
    const whereClause = { createdAt: { gte: dateRanges.current.from } };

    // Get geographic distribution
    const [cityDistribution, stateDistribution, distanceAnalysis] = await Promise.all([
      // City distribution
      prisma.checkIn.groupBy({
        by: ['merchantId'],
        where: whereClause,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: parseInt(limit)
      }).then(async results => {
        const merchantIds = results.map(r => r.merchantId);
        const merchants = await prisma.merchant.findMany({
          where: { id: { in: merchantIds } },
          include: {
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
        
        const cityMap = new Map();
        results.forEach(result => {
          const merchant = merchants.find(m => m.id === result.merchantId);
          if (merchant?.stores?.[0]?.city) {
            const city = merchant.stores[0].city;
            const key = `${city.name}, ${city.state}`;
            cityMap.set(key, (cityMap.get(key) || 0) + result._count.id);
          }
        });
        
        return Array.from(cityMap.entries())
          .map(([location, count]) => ({ location, count }))
          .sort((a, b) => b.count - a.count);
      }),
      
      // State distribution
      prisma.checkIn.groupBy({
        by: ['merchantId'],
        where: whereClause,
        _count: { id: true }
      }).then(async results => {
        const merchantIds = results.map(r => r.merchantId);
        const merchants = await prisma.merchant.findMany({
          where: { id: { in: merchantIds } },
          include: {
            stores: {
              include: {
                city: {
                  select: {
                    state: true
                  }
                }
              }
            }
          }
        });
        
        const stateMap = new Map();
        results.forEach(result => {
          const merchant = merchants.find(m => m.id === result.merchantId);
          if (merchant?.stores?.[0]?.city) {
            const state = merchant.stores[0].city.state;
            stateMap.set(state, (stateMap.get(state) || 0) + result._count.id);
          }
        });
        
        return Array.from(stateMap.entries())
          .map(([state, count]) => ({ state, count }))
          .sort((a, b) => b.count - a.count);
      }),
      
      // Distance analysis
      prisma.checkIn.findMany({
        where: whereClause,
        select: { distanceMeters: true }
      }).then(results => {
        const distances = results.map(r => r.distanceMeters);
        const sorted = distances.sort((a, b) => a - b);
        
        return {
          average: Number((distances.reduce((sum, d) => sum + d, 0) / distances.length).toFixed(2)),
          median: Number((sorted.length % 2 === 0 
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)]).toFixed(2)),
          min: Number(sorted[0]?.toFixed(2) || 0),
          max: Number(sorted[sorted.length - 1]?.toFixed(2) || 0),
          total: distances.length
        };
      })
    ]);

    logPerformanceMetrics('Tap-ins Geographic', startTime, cityDistribution.length);

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateRanges.current.from.toISOString(),
        to: dateRanges.current.to.toISOString()
      },
      geographic: {
        cityDistribution,
        stateDistribution,
        distanceAnalysis
      }
    });

  } catch (error) {
    console.error('Get tap-ins geographic error:', error);
    logPerformanceMetrics('Tap-ins Geographic (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch tap-ins geographic data'
    });
  }
});

// --- Endpoint: GET /api/admin/tap-ins/time-charts ---
// Get time-based charts for tap-ins activity
router.get('/tap-ins/time-charts', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { period = '7d', cityId, merchantId, chartType = 'daily' } = req.query as any;
    
    // Validate period parameter
    const periodValidation = validatePeriod(period);
    if (!periodValidation.isValid) {
      return res.status(400).json({ error: periodValidation.error });
    }

    // Build merchant filter
    let merchantIds: number[] | undefined;
    
    if (cityId) {
      merchantIds = await getMerchantIdsForCity(parseInt(cityId));
      if (merchantIds.length === 0) {
        return res.status(200).json({
          success: true,
          period,
          chartType,
          chartData: {
            labels: [],
            data: []
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

    // Build where clause
    const whereClause: any = {};
    if (merchantIds) {
      whereClause.merchantId = { in: merchantIds };
    }

    let chartData: { labels: string[], data: number[] };

    if (chartType === 'hourly') {
      // Hourly chart for last 24 hours
      const now = new Date();
      const labels = [];
      const data = [];
      
      for (let i = 23; i >= 0; i--) {
        const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
        const hourStart = new Date(hour);
        hourStart.setMinutes(0, 0, 0);
        const hourEnd = new Date(hour);
        hourEnd.setMinutes(59, 59, 999);
        
        const count = await prisma.checkIn.count({
          where: {
            ...whereClause,
            createdAt: { gte: hourStart, lte: hourEnd }
          }
        });
        
        labels.push(hour.getHours().toString().padStart(2, '0') + ':00');
        data.push(count);
      }
      
      chartData = { labels, data };
    } else {
      // Daily chart for specified period
      const days = periodValidation.days;
      const labels = [];
      const data = [];
      
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 999);
        
        const count = await prisma.checkIn.count({
          where: {
            ...whereClause,
            createdAt: { gte: dayStart, lte: dayEnd }
          }
        });
        
        labels.push(date.toISOString().split('T')[0]);
        data.push(count);
      }
      
      chartData = { labels, data };
    }

    logPerformanceMetrics('Tap-ins Time Charts', startTime, chartData.data.length);

    res.status(200).json({
      success: true,
      period,
      chartType,
      chartData,
      filters: {
        cityId: cityId ? parseInt(cityId) : null,
        merchantId: merchantId ? parseInt(merchantId) : null
      }
    });

  } catch (error) {
    console.error('Get tap-ins time charts error:', error);
    logPerformanceMetrics('Tap-ins Time Charts (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch tap-ins time charts'
    });
  }
});

// ============================================================================
// BOUNTIES (MONTHLY LEADERBOARD) STATISTICS APIs
// ============================================================================

// --- Endpoint: GET /api/admin/bounties/overview ---
// Get comprehensive bounties overview with monthly competition stats
router.get('/bounties/overview', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { period = '30d', cityId } = req.query as any;
    
    // Validate period parameter
    const periodValidation = validatePeriod(period);
    if (!periodValidation.isValid) {
      return res.status(400).json({ error: periodValidation.error });
    }

    // Calculate date ranges
    const dateRanges = calculateDateRanges(periodValidation.days);

    // Build user filter based on city (if provided)
    let userFilter: any = { role: 'USER' };
    if (cityId) {
      // Get users who have interacted with merchants in this city
      const cityMerchants = await getMerchantIdsForCity(parseInt(cityId));
      if (cityMerchants.length === 0) {
        return res.status(200).json({
          success: true,
          period,
          dateRange: {
            from: dateRanges.current.from.toISOString(),
            to: dateRanges.current.to.toISOString()
          },
          metrics: {
            totalParticipants: { value: 0, change: 0, trend: 'up' },
            totalPointsAwarded: { value: 0, change: 0, trend: 'up' },
            averagePointsPerUser: { value: 0, change: 0, trend: 'up' },
            topPerformerPoints: { value: 0, change: 0, trend: 'up' }
          },
          filters: { cityId: parseInt(cityId) },
          message: 'No approved merchants found in this city'
        });
      }
      
      // Filter users who have check-ins with merchants in this city
      userFilter.checkIns = {
        some: {
          merchantId: { in: cityMerchants }
        }
      };
    }

    // Get current period metrics
    const [
      currentParticipants,
      currentTotalPoints,
      currentAvgPoints,
      currentTopPerformer,
      prevParticipants,
      prevTotalPoints,
      prevAvgPoints,
      prevTopPerformer
    ] = await Promise.all([
      // Current period participants (users with points in period)
      prisma.user.count({
        where: {
          ...userFilter,
          pointEvents: {
            some: {
              createdAt: { gte: dateRanges.current.from }
            }
          }
        }
      }),
      
      // Current period total points awarded
      prisma.userPointEvent.aggregate({
        where: {
          createdAt: { gte: dateRanges.current.from },
          ...(cityId && {
            deal: {
              merchantId: { in: await getMerchantIdsForCity(parseInt(cityId)) }
            }
          })
        },
        _sum: { points: true }
      }),
      
      // Current period average points per user
      prisma.user.aggregate({
        where: {
          ...userFilter,
          pointEvents: {
            some: {
              createdAt: { gte: dateRanges.current.from }
            }
          }
        },
        _avg: { points: true }
      }),
      
      // Current period top performer
      prisma.user.findFirst({
        where: {
          ...userFilter,
          pointEvents: {
            some: {
              createdAt: { gte: dateRanges.current.from }
            }
          }
        },
        orderBy: { points: 'desc' },
        select: { points: true }
      }),
      
      // Previous period metrics
      prisma.user.count({
        where: {
          ...userFilter,
          pointEvents: {
            some: {
              createdAt: { 
                gte: dateRanges.previous.from, 
                lte: dateRanges.previous.to 
              }
            }
          }
        }
      }),
      
      prisma.userPointEvent.aggregate({
        where: {
          createdAt: { 
            gte: dateRanges.previous.from, 
            lte: dateRanges.previous.to 
          },
          ...(cityId && {
            deal: {
              merchantId: { in: await getMerchantIdsForCity(parseInt(cityId)) }
            }
          })
        },
        _sum: { points: true }
      }),
      
      prisma.user.aggregate({
        where: {
          ...userFilter,
          pointEvents: {
            some: {
              createdAt: { 
                gte: dateRanges.previous.from, 
                lte: dateRanges.previous.to 
              }
            }
          }
        },
        _avg: { points: true }
      }),
      
      prisma.user.findFirst({
        where: {
          ...userFilter,
          pointEvents: {
            some: {
              createdAt: { 
                gte: dateRanges.previous.from, 
                lte: dateRanges.previous.to 
              }
            }
          }
        },
        orderBy: { points: 'desc' },
        select: { points: true }
      })
    ]);

    // Calculate metrics
    const totalParticipants = currentParticipants;
    const totalPointsAwarded = Number(currentTotalPoints._sum.points || 0);
    const averagePointsPerUser = Number((currentAvgPoints._avg.points || 0).toFixed(2));
    const topPerformerPoints = currentTopPerformer?.points || 0;

    // Calculate percentage changes
    const totalParticipantsChange = calculatePercentageChange(totalParticipants, prevParticipants);
    const totalPointsAwardedPrev = Number(prevTotalPoints._sum.points || 0);
    const totalPointsAwardedChange = calculatePercentageChange(totalPointsAwarded, totalPointsAwardedPrev);
    const avgPointsPrev = Number(prevAvgPoints._avg.points || 0);
    const averagePointsPerUserChange = calculatePercentageChange(averagePointsPerUser, avgPointsPrev);
    const topPerformerPointsPrev = prevTopPerformer?.points || 0;
    const topPerformerPointsChange = calculatePercentageChange(topPerformerPoints, topPerformerPointsPrev);

    logPerformanceMetrics('Bounties Overview', startTime, totalParticipants);

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateRanges.current.from.toISOString(),
        to: dateRanges.current.to.toISOString()
      },
      metrics: {
        totalParticipants: {
          value: totalParticipants,
          change: Number(totalParticipantsChange.toFixed(1)),
          trend: totalParticipantsChange >= 0 ? 'up' : 'down'
        },
        totalPointsAwarded: {
          value: totalPointsAwarded,
          change: Number(totalPointsAwardedChange.toFixed(1)),
          trend: totalPointsAwardedChange >= 0 ? 'up' : 'down'
        },
        averagePointsPerUser: {
          value: averagePointsPerUser,
          change: Number(averagePointsPerUserChange.toFixed(1)),
          trend: averagePointsPerUserChange >= 0 ? 'up' : 'down'
        },
        topPerformerPoints: {
          value: topPerformerPoints,
          change: Number(topPerformerPointsChange.toFixed(1)),
          trend: topPerformerPointsChange >= 0 ? 'up' : 'down'
        }
      },
      filters: {
        cityId: cityId ? parseInt(cityId) : null
      }
    });

  } catch (error) {
    console.error('Get bounties overview error:', error);
    logPerformanceMetrics('Bounties Overview (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch bounties overview'
    });
  }
});

// --- Endpoint: GET /api/admin/bounties/leaderboard ---
// Get current monthly leaderboard with rankings
router.get('/bounties/leaderboard', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { limit = 50, cityId, period = 'current' } = req.query as any;
    
    // Build user filter based on city (if provided)
    let userFilter: any = { role: 'USER' };
    if (cityId) {
      const cityMerchants = await getMerchantIdsForCity(parseInt(cityId));
      if (cityMerchants.length === 0) {
        return res.status(200).json({
          success: true,
          period,
          leaderboard: [],
          filters: { cityId: parseInt(cityId) },
          message: 'No approved merchants found in this city'
        });
      }
      
      userFilter.checkIns = {
        some: {
          merchantId: { in: cityMerchants }
        }
      };
    }

    let leaderboardData: any[];

    if (period === 'current') {
      // Current month leaderboard using monthlyPoints
      leaderboardData = await prisma.user.findMany({
        where: {
          ...userFilter,
          monthlyPoints: { gt: 0 }
        },
        select: {
          id: true,
          name: true,
          email: true,
          points: true,
          monthlyPoints: true,
          createdAt: true
        },
        orderBy: { monthlyPoints: 'desc' },
        take: parseInt(limit)
      });
    } else {
      // Historical period leaderboard using point events
      const periodValidation = validatePeriod(period);
      if (!periodValidation.isValid) {
        return res.status(400).json({ error: periodValidation.error });
      }

      const dateRanges = calculateDateRanges(periodValidation.days);
      
      leaderboardData = await prisma.user.findMany({
        where: {
          ...userFilter,
          pointEvents: {
            some: {
              createdAt: { gte: dateRanges.current.from }
            }
          }
        },
        select: {
          id: true,
          name: true,
          email: true,
          points: true,
          monthlyPoints: true,
          createdAt: true,
          pointEvents: {
            where: {
              createdAt: { gte: dateRanges.current.from }
            },
            select: { points: true }
          }
        },
        orderBy: { points: 'desc' },
        take: parseInt(limit)
      });

      // Calculate period points for historical data
      leaderboardData = leaderboardData.map(user => ({
        ...user,
        periodPoints: user.pointEvents.reduce((sum: number, event: { points: number }) => sum + event.points, 0)
      }));
    }

    // Add rankings
    const leaderboard = leaderboardData.map((user, index) => ({
      rank: index + 1,
      userId: user.id,
      name: user.name || 'Anonymous',
      email: user.email,
      totalPoints: user.points,
      periodPoints: period === 'current' ? user.monthlyPoints : user.periodPoints,
      memberSince: user.createdAt.toISOString().split('T')[0]
    }));

    logPerformanceMetrics('Bounties Leaderboard', startTime, leaderboard.length);

    res.status(200).json({
      success: true,
      period,
      leaderboard,
      filters: {
        cityId: cityId ? parseInt(cityId) : null
      }
    });

  } catch (error) {
    console.error('Get bounties leaderboard error:', error);
    logPerformanceMetrics('Bounties Leaderboard (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch bounties leaderboard'
    });
  }
});

// --- Endpoint: GET /api/admin/bounties/analytics ---
// Get detailed bounties analytics with competition insights
router.get('/bounties/analytics', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { period = '30d', cityId } = req.query as any;
    
    // Validate period parameter
    const periodValidation = validatePeriod(period);
    if (!periodValidation.isValid) {
      return res.status(400).json({ error: periodValidation.error });
    }

    // Calculate date ranges
    const dateRanges = calculateDateRanges(periodValidation.days);

    // Build user filter
    let userFilter: any = { role: 'USER' };
    if (cityId) {
      const cityMerchants = await getMerchantIdsForCity(parseInt(cityId));
      if (cityMerchants.length === 0) {
        return res.status(200).json({
          success: true,
          period,
          dateRange: {
            from: dateRanges.current.from.toISOString(),
            to: dateRanges.current.to.toISOString()
          },
          analytics: {
            pointDistribution: [],
            activityPatterns: [],
            competitionMetrics: {},
            topPerformers: []
          },
          filters: { cityId: parseInt(cityId) },
          message: 'No approved merchants found in this city'
        });
      }
      
      userFilter.checkIns = {
        some: {
          merchantId: { in: cityMerchants }
        }
      };
    }

    // Get detailed analytics
    const [
      pointDistribution,
      activityPatterns,
      competitionMetrics,
      topPerformers
    ] = await Promise.all([
      // Point distribution analysis
      prisma.user.findMany({
        where: {
          ...userFilter,
          pointEvents: {
            some: {
              createdAt: { gte: dateRanges.current.from }
            }
          }
        },
        select: {
          id: true,
          points: true,
          pointEvents: {
            where: {
              createdAt: { gte: dateRanges.current.from }
            },
            select: { points: true }
          }
        }
      }).then(users => {
        const periodPoints = users.map(user => 
          user.pointEvents.reduce((sum, event) => sum + event.points, 0)
        );
        
        const sorted = periodPoints.sort((a, b) => a - b);
        const total = periodPoints.length;
        
        return {
          total: total,
          average: total > 0 ? Number((periodPoints.reduce((sum, p) => sum + p, 0) / total).toFixed(2)) : 0,
          median: total > 0 ? (total % 2 === 0 
            ? (sorted[total / 2 - 1] + sorted[total / 2]) / 2
            : sorted[Math.floor(total / 2)]
          ) : 0,
          distribution: [
            { range: '0-50', count: periodPoints.filter(p => p <= 50).length },
            { range: '51-100', count: periodPoints.filter(p => p > 50 && p <= 100).length },
            { range: '101-250', count: periodPoints.filter(p => p > 100 && p <= 250).length },
            { range: '251-500', count: periodPoints.filter(p => p > 250 && p <= 500).length },
            { range: '500+', count: periodPoints.filter(p => p > 500).length }
          ]
        };
      }),
      
      // Activity patterns (daily points awarded)
      prisma.userPointEvent.groupBy({
        by: ['createdAt'],
        where: {
          createdAt: { gte: dateRanges.current.from },
          ...(cityId && {
            deal: {
              merchantId: { in: await getMerchantIdsForCity(parseInt(cityId)) }
            }
          })
        },
        _sum: { points: true },
        orderBy: { createdAt: 'asc' }
      }).then(results => {
        const dailyMap = new Map();
        results.forEach(result => {
          const day = new Date(result.createdAt).getDay();
          dailyMap.set(day, (dailyMap.get(day) || 0) + Number(result._sum.points || 0));
        });
        
        return Array.from({ length: 7 }, (_, i) => ({
          day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i],
          points: dailyMap.get(i) || 0
        }));
      }),
      
      // Competition metrics
      prisma.user.count({
        where: {
          ...userFilter,
          pointEvents: {
            some: {
              createdAt: { gte: dateRanges.current.from }
            }
          }
        }
      }).then(async totalParticipants => {
        const top10Percent = Math.max(1, Math.floor(totalParticipants * 0.1));
        const top25Percent = Math.max(1, Math.floor(totalParticipants * 0.25));
        
        // Get top 10% and 25% thresholds
        const topUsers = await prisma.user.findMany({
          where: {
            ...userFilter,
            pointEvents: {
              some: {
                createdAt: { gte: dateRanges.current.from }
              }
            }
          },
          select: {
            pointEvents: {
              where: {
                createdAt: { gte: dateRanges.current.from }
              },
              select: { points: true }
            }
          },
          orderBy: { points: 'desc' },
          take: top25Percent
        });
        
        const userPoints = topUsers.map(user => 
          user.pointEvents.reduce((sum, event) => sum + event.points, 0)
        );
        
        return {
          totalParticipants,
          top10PercentThreshold: userPoints[top10Percent - 1] || 0,
          top25PercentThreshold: userPoints[top25Percent - 1] || 0,
          competitionIntensity: totalParticipants > 0 ? Number(((userPoints[0] || 0) / Math.max(1, userPoints[userPoints.length - 1] || 1)).toFixed(2)) : 0
        };
      }),
      
      // Top performers
      prisma.user.findMany({
        where: {
          ...userFilter,
          pointEvents: {
            some: {
              createdAt: { gte: dateRanges.current.from }
            }
          }
        },
        select: {
          id: true,
          name: true,
          email: true,
          points: true,
          pointEvents: {
            where: {
              createdAt: { gte: dateRanges.current.from }
            },
            select: { points: true }
          }
        },
        orderBy: { points: 'desc' },
        take: 10
      }).then(users => 
        users.map(user => ({
          userId: user.id,
          name: user.name || 'Anonymous',
          email: user.email,
          totalPoints: user.points,
          periodPoints: user.pointEvents.reduce((sum, event) => sum + event.points, 0)
        }))
      )
    ]);

    logPerformanceMetrics('Bounties Analytics', startTime, pointDistribution.total);

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateRanges.current.from.toISOString(),
        to: dateRanges.current.to.toISOString()
      },
      analytics: {
        pointDistribution,
        activityPatterns,
        competitionMetrics,
        topPerformers
      },
      filters: {
        cityId: cityId ? parseInt(cityId) : null
      }
    });

  } catch (error) {
    console.error('Get bounties analytics error:', error);
    logPerformanceMetrics('Bounties Analytics (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch bounties analytics'
    });
  }
});

// --- Endpoint: GET /api/admin/bounties/rewards ---
// Get points rewards distribution and statistics
router.get('/bounties/rewards', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { period = '30d', cityId } = req.query as any;
    
    // Validate period parameter
    const periodValidation = validatePeriod(period);
    if (!periodValidation.isValid) {
      return res.status(400).json({ error: periodValidation.error });
    }

    // Calculate date ranges
    const dateRanges = calculateDateRanges(periodValidation.days);

    // Build where clause for point events
    const whereClause: any = {
      createdAt: { gte: dateRanges.current.from }
    };
    
    if (cityId) {
      const cityMerchants = await getMerchantIdsForCity(parseInt(cityId));
      if (cityMerchants.length === 0) {
        return res.status(200).json({
          success: true,
          period,
          dateRange: {
            from: dateRanges.current.from.toISOString(),
            to: dateRanges.current.to.toISOString()
          },
          rewards: {
            totalPointsAwarded: 0,
            pointsByEventType: [],
            pointsByUser: [],
            pointsByDeal: [],
            averagePointsPerEvent: 0
          },
          filters: { cityId: parseInt(cityId) },
          message: 'No approved merchants found in this city'
        });
      }
      
      whereClause.deal = {
        merchantId: { in: cityMerchants }
      };
    }

    // Get rewards analytics
    const [
      totalPointsAwarded,
      pointsByEventType,
      pointsByUser,
      pointsByDeal,
      averagePointsPerEvent
    ] = await Promise.all([
      // Total points awarded in period
      prisma.userPointEvent.aggregate({
        where: whereClause,
        _sum: { points: true }
      }),
      
      // Points by event type
      prisma.userPointEvent.groupBy({
        by: ['pointEventTypeId'],
        where: whereClause,
        _sum: { points: true },
        _count: { id: true }
      }).then(async results => {
        const eventTypes = await prisma.pointEventTypeMaster.findMany({
          where: { id: { in: results.map(r => r.pointEventTypeId) } },
          select: { id: true, name: true, points: true }
        });
        
        return results.map(result => {
          const eventType = eventTypes.find(et => et.id === result.pointEventTypeId);
          return {
            eventTypeId: result.pointEventTypeId,
            eventTypeName: eventType?.name || 'Unknown',
            basePoints: eventType?.points || 0,
            totalPointsAwarded: Number(result._sum.points || 0),
            totalEvents: result._count.id,
            averagePointsPerEvent: result._count.id > 0 
              ? Number((Number(result._sum.points || 0) / result._count.id).toFixed(2))
              : 0
          };
        });
      }),
      
      // Top users by points earned
      prisma.userPointEvent.groupBy({
        by: ['userId'],
        where: whereClause,
        _sum: { points: true },
        _count: { id: true },
        orderBy: { _sum: { points: 'desc' } },
        take: 20
      }).then(async results => {
        const userIds = results.map(r => r.userId);
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true }
        });
        
        return results.map(result => {
          const user = users.find(u => u.id === result.userId);
          return {
            userId: result.userId,
            name: user?.name || 'Anonymous',
            email: user?.email || 'Unknown',
            totalPointsEarned: Number(result._sum.points || 0),
            totalEvents: result._count.id,
            averagePointsPerEvent: result._count.id > 0 
              ? Number((Number(result._sum.points || 0) / result._count.id).toFixed(2))
              : 0
          };
        });
      }),
      
      // Top deals by points awarded
      prisma.userPointEvent.groupBy({
        by: ['dealId'],
        where: {
          ...whereClause,
          dealId: { not: null }
        },
        _sum: { points: true },
        _count: { id: true },
        orderBy: { _sum: { points: 'desc' } },
        take: 20
      }).then(async results => {
        const dealIds = results.map(r => r.dealId).filter(id => id !== null);
        const deals = await prisma.deal.findMany({
          where: { id: { in: dealIds } },
          select: {
            id: true,
            title: true,
            merchant: {
              select: { businessName: true }
            }
          }
        });
        
        return results.map(result => {
          const deal = deals.find(d => d.id === result.dealId);
          return {
            dealId: result.dealId,
            title: deal?.title || 'Unknown Deal',
            merchant: deal?.merchant.businessName || 'Unknown Merchant',
            totalPointsAwarded: Number(result._sum.points || 0),
            totalEvents: result._count.id,
            averagePointsPerEvent: result._count.id > 0 
              ? Number((Number(result._sum.points || 0) / result._count.id).toFixed(2))
              : 0
          };
        });
      }),
      
      // Average points per event
      prisma.userPointEvent.aggregate({
        where: whereClause,
        _avg: { points: true },
        _count: { id: true }
      })
    ]);

    logPerformanceMetrics('Bounties Rewards', startTime, pointsByUser.length);

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        from: dateRanges.current.from.toISOString(),
        to: dateRanges.current.to.toISOString()
      },
      rewards: {
        totalPointsAwarded: Number(totalPointsAwarded._sum.points || 0),
        pointsByEventType,
        pointsByUser,
        pointsByDeal,
        averagePointsPerEvent: Number((averagePointsPerEvent._avg.points || 0).toFixed(2)),
        totalEvents: averagePointsPerEvent._count.id
      },
      filters: {
        cityId: cityId ? parseInt(cityId) : null
      }
    });

  } catch (error) {
    console.error('Get bounties rewards error:', error);
    logPerformanceMetrics('Bounties Rewards (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch bounties rewards'
    });
  }
});

// --- Endpoint: GET /api/admin/bounties/historical ---
// Get historical bounties data and past competitions
router.get('/bounties/historical', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { months = 6, cityId } = req.query as any;
    
    // Get historical data for specified number of months
    const historicalData = [];
    const now = new Date();
    
    for (let i = 0; i < parseInt(months); i++) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
      
      // Build user filter
      let userFilter: any = { role: 'USER' };
      if (cityId) {
        const cityMerchants = await getMerchantIdsForCity(parseInt(cityId));
        if (cityMerchants.length > 0) {
          userFilter.checkIns = {
            some: {
              merchantId: { in: cityMerchants }
            }
          };
        }
      }
      
      // Get month data
      const [
        totalParticipants,
        totalPointsAwarded,
        topPerformer,
        averagePoints
      ] = await Promise.all([
        prisma.user.count({
          where: {
            ...userFilter,
            pointEvents: {
              some: {
                createdAt: { gte: monthStart, lte: monthEnd }
              }
            }
          }
        }),
        
        prisma.userPointEvent.aggregate({
          where: {
            createdAt: { gte: monthStart, lte: monthEnd },
            ...(cityId && {
              deal: {
                merchantId: { in: await getMerchantIdsForCity(parseInt(cityId)) }
              }
            })
          },
          _sum: { points: true }
        }),
        
        prisma.user.findFirst({
          where: {
            ...userFilter,
            pointEvents: {
              some: {
                createdAt: { gte: monthStart, lte: monthEnd }
              }
            }
          },
          orderBy: { points: 'desc' },
          select: { id: true, name: true, points: true }
        }),
        
        prisma.user.aggregate({
          where: {
            ...userFilter,
            pointEvents: {
              some: {
                createdAt: { gte: monthStart, lte: monthEnd }
              }
            }
          },
          _avg: { points: true }
        })
      ]);
      
      historicalData.push({
        month: monthStart.toISOString().substring(0, 7), // YYYY-MM format
        monthName: monthStart.toLocaleDateString('en-US', { year: 'numeric', month: 'long' }),
        totalParticipants,
        totalPointsAwarded: Number(totalPointsAwarded._sum.points || 0),
        topPerformer: {
          userId: topPerformer?.id || null,
          name: topPerformer?.name || null,
          points: topPerformer?.points || 0
        },
        averagePoints: Number((averagePoints._avg.points || 0).toFixed(2))
      });
    }

    logPerformanceMetrics('Bounties Historical', startTime, historicalData.length);

    res.status(200).json({
      success: true,
      historicalData,
      filters: {
        cityId: cityId ? parseInt(cityId) : null,
        months: parseInt(months)
      }
    });

  } catch (error) {
    console.error('Get bounties historical error:', error);
    logPerformanceMetrics('Bounties Historical (Error)', startTime, 0);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to fetch bounties historical data'
    });
  }
});

export default router;