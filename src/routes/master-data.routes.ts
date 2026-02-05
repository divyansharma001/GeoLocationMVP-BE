import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { protect, AuthRequest, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// Validation schemas
const createCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(100),
  description: z.string().optional(),
  icon: z.string().max(100).optional(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, 'Color must be a valid hex color').optional(),
  sortOrder: z.number().int().min(0).default(0),
  active: z.boolean().default(true)
});

const updateCategorySchema = createCategorySchema.partial();

const createDealTypeSchema = z.object({
  name: z.string().min(1, 'Deal type name is required').max(50),
  description: z.string().optional(),
  active: z.boolean().default(true)
});

const updateDealTypeSchema = createDealTypeSchema.partial();

const createPointEventTypeSchema = z.object({
  name: z.string().min(1, 'Point event type name is required').max(50),
  description: z.string().optional(),
  points: z.number().int().min(0, 'Points must be non-negative'),
  active: z.boolean().default(true)
});

const updatePointEventTypeSchema = createPointEventTypeSchema.partial();

const bulkUpdateSchema = z.object({
  ids: z.array(z.number().int().positive()),
  updates: z.object({
    active: z.boolean().optional()
  })
});

// ============================================================================
// DEAL CATEGORIES MANAGEMENT
// ============================================================================

// GET /api/admin/master-data/categories
router.get('/categories', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const active = req.query.active as string;
    const search = req.query.search as string;
    const sortBy = req.query.sortBy as string || 'sortOrder';
    const sortOrder = req.query.sortOrder as string || 'asc';

    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};
    
    if (active !== undefined) {
      where.active = active === 'true';
    }
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Build orderBy clause
    const orderBy: any = {};
    if (sortBy === 'name') {
      orderBy.name = sortOrder;
    } else if (sortBy === 'createdAt') {
      orderBy.createdAt = sortOrder;
    } else {
      orderBy.sortOrder = sortOrder;
    }

    // Get categories with deal count
    const [categories, totalCount] = await Promise.all([
      prisma.dealCategoryMaster.findMany({
        where,
        include: {
          _count: {
            select: {
              deals: true
            }
          }
        },
        orderBy,
        skip,
        take: limit
      }),
      prisma.dealCategoryMaster.count({ where })
    ]);

    res.status(200).json({
      message: 'Categories retrieved successfully',
      categories: categories.map(category => ({
        id: category.id,
        name: category.name,
        description: category.description,
        icon: category.icon,
        color: category.color,
        sortOrder: category.sortOrder,
        active: category.active,
        dealCount: category._count.deals,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt
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
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/master-data/categories
router.post('/categories', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const data = createCategorySchema.parse(req.body);

    // Check if category name already exists
    const existingCategory = await prisma.dealCategoryMaster.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } }
    });

    if (existingCategory) {
      return res.status(409).json({ 
        error: 'Category name already exists',
        existingCategory: {
          id: existingCategory.id,
          name: existingCategory.name,
          active: existingCategory.active
        }
      });
    }

    const newCategory = await prisma.dealCategoryMaster.create({
      data
    });

    res.status(201).json({
      message: 'Category created successfully',
      category: newCategory
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/master-data/categories/:id
router.get('/categories/:id', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = parseInt(req.params.id as string);

    if (isNaN(categoryId)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }

    const category = await prisma.dealCategoryMaster.findUnique({
      where: { id: categoryId },
      include: {
        _count: {
          select: {
            deals: true
          }
        }
      }
    });

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.status(200).json({
      message: 'Category retrieved successfully',
      category: {
        ...category,
        dealCount: category._count.deals
      }
    });

  } catch (error) {
    console.error('Get category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/master-data/categories/:id
router.put('/categories/:id', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = parseInt(req.params.id as string);
    const data = updateCategorySchema.parse(req.body);

    if (isNaN(categoryId)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }

    // Check if category exists
    const existingCategory = await prisma.dealCategoryMaster.findUnique({
      where: { id: categoryId }
    });

    if (!existingCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check if name is being changed and if new name already exists
    if (data.name && data.name !== existingCategory.name) {
      const nameExists = await prisma.dealCategoryMaster.findFirst({
        where: { 
          name: { equals: data.name, mode: 'insensitive' },
          id: { not: categoryId }
        }
      });

      if (nameExists) {
        return res.status(409).json({ 
          error: 'Category name already exists',
          existingCategory: {
            id: nameExists.id,
            name: nameExists.name
          }
        });
      }
    }

    const updatedCategory = await prisma.dealCategoryMaster.update({
      where: { id: categoryId },
      data: {
        ...data,
        updatedAt: new Date()
      }
    });

    res.status(200).json({
      message: 'Category updated successfully',
      category: updatedCategory
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Update category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/master-data/categories/:id
router.delete('/categories/:id', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = parseInt(req.params.id as string);

    if (isNaN(categoryId)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }

    // Check if category exists
    const existingCategory = await prisma.dealCategoryMaster.findUnique({
      where: { id: categoryId },
      include: {
        _count: {
          select: {
            deals: true
          }
        }
      }
    });

    if (!existingCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check if category is in use
    if (existingCategory._count.deals > 0) {
      return res.status(409).json({ 
        error: 'Cannot delete category that is in use',
        dealCount: existingCategory._count.deals,
        suggestion: 'Deactivate the category instead of deleting it'
      });
    }

    await prisma.dealCategoryMaster.delete({
      where: { id: categoryId }
    });

    res.status(200).json({
      message: 'Category deleted successfully',
      deletedCategory: {
        id: existingCategory.id,
        name: existingCategory.name
      }
    });

  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// DEAL TYPES MANAGEMENT
// ============================================================================

// GET /api/admin/master-data/deal-types
router.get('/deal-types', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const active = req.query.active as string;
    const search = req.query.search as string;

    const skip = (page - 1) * limit;

    const where: any = {};
    
    if (active !== undefined) {
      where.active = active === 'true';
    }
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [dealTypes, totalCount] = await Promise.all([
      prisma.dealTypeMaster.findMany({
        where,
        include: {
          _count: {
            select: {
              deals: true
            }
          }
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit
      }),
      prisma.dealTypeMaster.count({ where })
    ]);

    res.status(200).json({
      message: 'Deal types retrieved successfully',
      dealTypes: dealTypes.map(dealType => ({
        id: dealType.id,
        name: dealType.name,
        description: dealType.description,
        active: dealType.active,
        dealCount: dealType._count.deals,
        createdAt: dealType.createdAt,
        updatedAt: dealType.updatedAt
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
    console.error('Get deal types error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/master-data/deal-types
router.post('/deal-types', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const data = createDealTypeSchema.parse(req.body);

    const existingDealType = await prisma.dealTypeMaster.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } }
    });

    if (existingDealType) {
      return res.status(409).json({ 
        error: 'Deal type name already exists',
        existingDealType: {
          id: existingDealType.id,
          name: existingDealType.name
        }
      });
    }

    const newDealType = await prisma.dealTypeMaster.create({
      data
    });

    res.status(201).json({
      message: 'Deal type created successfully',
      dealType: newDealType
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Create deal type error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// POINT EVENT TYPES MANAGEMENT
// ============================================================================

// GET /api/admin/master-data/point-event-types
router.get('/point-event-types', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const active = req.query.active as string;
    const search = req.query.search as string;

    const skip = (page - 1) * limit;

    const where: any = {};
    
    if (active !== undefined) {
      where.active = active === 'true';
    }
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [pointEventTypes, totalCount] = await Promise.all([
      prisma.pointEventTypeMaster.findMany({
        where,
        include: {
          _count: {
            select: {
              pointEvents: true
            }
          }
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit
      }),
      prisma.pointEventTypeMaster.count({ where })
    ]);

    res.status(200).json({
      message: 'Point event types retrieved successfully',
      pointEventTypes: pointEventTypes.map(pointEventType => ({
        id: pointEventType.id,
        name: pointEventType.name,
        description: pointEventType.description,
        points: pointEventType.points,
        active: pointEventType.active,
        eventCount: pointEventType._count.pointEvents,
        createdAt: pointEventType.createdAt,
        updatedAt: pointEventType.updatedAt
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
    console.error('Get point event types error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/master-data/point-event-types
router.post('/point-event-types', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const data = createPointEventTypeSchema.parse(req.body);

    const existingPointEventType = await prisma.pointEventTypeMaster.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } }
    });

    if (existingPointEventType) {
      return res.status(409).json({ 
        error: 'Point event type name already exists',
        existingPointEventType: {
          id: existingPointEventType.id,
          name: existingPointEventType.name
        }
      });
    }

    const newPointEventType = await prisma.pointEventTypeMaster.create({
      data
    });

    res.status(201).json({
      message: 'Point event type created successfully',
      pointEventType: newPointEventType
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Create point event type error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// BULK OPERATIONS
// ============================================================================

// PUT /api/admin/master-data/categories/bulk
router.put('/categories/bulk', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { ids, updates } = bulkUpdateSchema.parse(req.body);

    if (ids.length === 0) {
      return res.status(400).json({ error: 'At least one category ID is required' });
    }

    if (ids.length > 100) {
      return res.status(400).json({ error: 'Cannot update more than 100 categories at once' });
    }

    const updateResult = await prisma.dealCategoryMaster.updateMany({
      where: { id: { in: ids } },
      data: {
        ...updates,
        updatedAt: new Date()
      }
    });

    res.status(200).json({
      message: `${updateResult.count} categories updated successfully`,
      updatedCount: updateResult.count,
      categoryIds: ids,
      updates
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Bulk update categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// STATISTICS
// ============================================================================

// GET /api/admin/master-data/stats
router.get('/stats', protect, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const [
      totalCategories,
      activeCategories,
      totalDealTypes,
      activeDealTypes,
      totalPointEventTypes,
      activePointEventTypes,
      totalCities,
      activeCities
    ] = await Promise.all([
      prisma.dealCategoryMaster.count(),
      prisma.dealCategoryMaster.count({ where: { active: true } }),
      prisma.dealTypeMaster.count(),
      prisma.dealTypeMaster.count({ where: { active: true } }),
      prisma.pointEventTypeMaster.count(),
      prisma.pointEventTypeMaster.count({ where: { active: true } }),
      prisma.city.count(),
      prisma.city.count({ where: { active: true } })
    ]);

    res.status(200).json({
      message: 'Master data statistics retrieved successfully',
      stats: {
        categories: {
          total: totalCategories,
          active: activeCategories,
          inactive: totalCategories - activeCategories
        },
        dealTypes: {
          total: totalDealTypes,
          active: activeDealTypes,
          inactive: totalDealTypes - activeDealTypes
        },
        pointEventTypes: {
          total: totalPointEventTypes,
          active: activePointEventTypes,
          inactive: totalPointEventTypes - activePointEventTypes
        },
        cities: {
          total: totalCities,
          active: activeCities,
          inactive: totalCities - activeCities
        }
      }
    });

  } catch (error) {
    console.error('Get master data stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
