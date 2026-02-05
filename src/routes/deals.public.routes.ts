// src/routes/deals.public.routes.ts

import { Router } from 'express';
import prisma from '../lib/prisma';

const router = Router();

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

// --- Social Proof Utilities ---
// Utility to add social proof to a deal object (expects raw prisma deal with savedByUsers + _count)
function addSocialProofToDeal(deal: any) {
    if (!deal.savedByUsers) {
        return {
            ...deal,
            claimedBy: { totalCount: 0, visibleUsers: [] }
        };
    }
    const totalCount = deal._count?.savedByUsers ?? deal.savedByUsers.length;
    const visibleUsers = deal.savedByUsers
      .map((save: any) => ({ avatarUrl: save.user?.avatarUrl || null }))
      .filter((u: any) => u.avatarUrl);

    // Remove the raw savedByUsers data from the final output
    const { savedByUsers, _count, ...dealWithoutSocialProof } = deal;

    return {
        ...dealWithoutSocialProof,
        claimedBy: { totalCount, visibleUsers }
    };
}

// Utility function to format deal data for frontend consumption (compact shape + social proof)
function formatDealForFrontend(rawDeal: any, distance?: number) {
  const formattedDeal = {
    id: rawDeal.id,
    title: rawDeal.title || '',
    description: rawDeal.description || '',
    imageUrl: rawDeal.imageUrls?.[0] || null, // Primary image
    images: rawDeal.imageUrls || [],          // All images
    offerDisplay: rawDeal.discountPercentage ? `${rawDeal.discountPercentage}% OFF` : (rawDeal.discountAmount ? 'DEAL' : 'FREE'),
    offerTerms: rawDeal.offerTerms || null,
    dealType: rawDeal.dealType || 'STANDARD',
    startTime: rawDeal.startTime?.toISOString() || null,
    endTime: rawDeal.endTime?.toISOString() || null,
    redemptionInstructions: rawDeal.redemptionInstructions || '',
    merchant: {
      id: rawDeal.merchant?.id || null,
      businessName: rawDeal.merchant?.businessName || '',
      address: rawDeal.merchant?.address || '',
      latitude: rawDeal.merchant?.latitude || null,
      longitude: rawDeal.merchant?.longitude || null,
      logoUrl: rawDeal.merchant?.logoUrl || null,
      phoneNumber: rawDeal.merchant?.phoneNumber || null,
    },
    ...(distance !== undefined && { distance: Math.round(distance * 100) / 100 }),
  };

  // Merge social proof from raw deal
  return addSocialProofToDeal({ ...formattedDeal, savedByUsers: rawDeal.savedByUsers, _count: rawDeal._count });
}

// Performance monitoring utility
function logQueryPerformance(operation: string, startTime: number, resultCount: number, filters?: any) {
  const duration = Date.now() - startTime;
  console.log(`[PERFORMANCE] ${operation}: ${duration}ms, ${resultCount} results`, filters ? `Filters: ${JSON.stringify(filters)}` : '');
  
  // Log slow queries for optimization
  if (duration > 1000) {
    console.warn(`[SLOW QUERY] ${operation} took ${duration}ms - consider optimization`);
  }
}

// --- Endpoint: GET /api/deals ---
// Fetches all active deals from approved merchants.
// Optional query parameters: latitude, longitude, radius (in kilometers), category, search, accessCode
router.get('/deals', async (req, res) => {
  try {
    const { latitude, longitude, radius, category, search, cityId, accessCode } = req.query as any;
    const now = new Date();
  // Determine today's weekday name for recurring deal filtering (server local time)
  const dayNames = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const todayName = dayNames[now.getDay()];
    
    // Build the where clause for filtering
    const whereClause: any = {
      // Filter for active deals
      startTime: { lte: now },
      endTime: { gte: now },
      // IMPORTANT: Only show deals from approved merchants
      merchant: {
        status: 'APPROVED',
      },
    };

    // Filter out hidden deals UNLESS accessCode is provided
    if (!accessCode) {
      // Exclude deals that have accessCode (hidden deals)
      whereClause.accessCode = null;
    } else {
      // If access code provided, only show that specific hidden deal
      whereClause.accessCode = accessCode;
    }

    // Add category filter if provided
    if (category) {
      // Map enum-style category names to database names
      const categoryMapping: Record<string, string> = {
        'FOOD_AND_BEVERAGE': 'Food & Beverage',
        'RETAIL': 'Retail',
        'ENTERTAINMENT': 'Entertainment',
        'HEALTH_AND_FITNESS': 'Health & Fitness',
        'BEAUTY_AND_SPA': 'Beauty & Spa',
        'AUTOMOTIVE': 'Automotive',
        'TRAVEL': 'Travel',
        'EDUCATION': 'Education',
        'TECHNOLOGY': 'Technology',
        'HOME_AND_GARDEN': 'Home & Garden',
        'OTHER': 'Other'
      };
      
      const validCategories = Object.keys(categoryMapping);
      
      if (!validCategories.includes(category as string)) {
        return res.status(400).json({
          error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
        });
      }
      
      const dbCategoryName = categoryMapping[category as string];
      
      // Check if category exists in database
      try {
        const categoryExists = await prisma.dealCategoryMaster.findFirst({
          where: { name: dbCategoryName, active: true }
        });
        
        if (!categoryExists) {
          return res.status(400).json({
            error: `Category '${category}' not found or inactive`
          });
        }
      } catch (dbError) {
        console.error('Error checking category:', dbError);
        return res.status(500).json({
          error: 'Database error while validating category'
        });
      }
      
      // Filter by category relation using the database name
      whereClause.category = {
        name: {
          equals: dbCategoryName
        }
      };
    }

    // Add search filter if provided
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const searchTerm = search.trim();
      
      // Validate search term length
      if (searchTerm.length < 2) {
        return res.status(400).json({
          error: 'Search term must be at least 2 characters long.'
        });
      }
      
      if (searchTerm.length > 100) {
        return res.status(400).json({
          error: 'Search term must be no more than 100 characters long.'
        });
      }
      
      // Search in both title and description using case-insensitive contains
      whereClause.OR = [
        {
          title: {
            contains: searchTerm,
            mode: 'insensitive' // Case-insensitive search
          }
        },
        {
          description: {
            contains: searchTerm,
            mode: 'insensitive' // Case-insensitive search
          }
        }
      ];
    }
    
    // Base query for active deals from approved merchants
    // Optimized to use database indexes efficiently
    const queryStartTime = Date.now();
    // @ts-ignore: Prisma types will include merchant.stores after generate
    let deals: any[] = await prisma.deal.findMany({
      where: whereClause,
      include: {
        merchant: { include: { stores: { include: { city: true } } } },
        category: true,
        dealType: true,
        _count: { select: { savedByUsers: true } },
        savedByUsers: {
          take: 5,
          select: { user: { select: { avatarUrl: true } } }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter recurring deals so they only appear on their specified day(s)
    // recurringDays stored as comma-separated list of day names (MONDAY,...)
    if (deals.length) {
      deals = deals.filter(d => {
        if (d.dealType !== 'RECURRING') return true;
        if (!d.recurringDays) return false; // malformed recurring deal, hide
  const days = d.recurringDays.split(',').map((s: string) => s.trim().toUpperCase());
        return days.includes(todayName);
      });
    }

    // Log query performance
    logQueryPerformance('Deals Query', queryStartTime, deals.length, {
      category: category || 'all',
      search: search ? 'yes' : 'no',
      geolocation: (latitude && longitude && radius) ? 'yes' : 'no'
    });

    // If a cityId filter is provided, filter deals by merchant's stores in that city
    if (cityId) {
      const cid = Number(cityId);
      if (!Number.isFinite(cid)) {
        return res.status(400).json({ error: 'cityId must be a number' });
      }
      deals = deals.filter(d => Array.isArray((d as any).merchant.stores) && (d as any).merchant.stores.some((s: any) => s.cityId === cid));
    }

    // If coordinates and radius are provided, filter by distance
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

      // Use database-level geospatial filtering for better performance
      // This leverages the merchant status + coordinates index
      whereClause.merchant = {
        ...whereClause.merchant,
        latitude: { not: null },
        longitude: { not: null },
      };

      // Re-query with geospatial constraints
      deals = await prisma.deal.findMany({
        where: whereClause,
        include: {
          merchant: true,
          category: true,
          dealType: true,
          _count: { select: { savedByUsers: true } },
          savedByUsers: {
            take: 5,
            select: { user: { select: { avatarUrl: true } } }
          }
        },
        orderBy: { createdAt: 'desc' },
      });

      // Filter by distance and add distance information
      // FIX: Calculate distance only once per deal (was previously calculated twice)
      const dealsWithDistance = (deals as any[])
        .map(deal => {
          if (!deal.merchant?.latitude || !deal.merchant?.longitude) {
            return null;
          }
          const distance = calculateDistance(
            userLat,
            userLon,
            deal.merchant.latitude,
            deal.merchant.longitude
          );
          if (distance > radiusKm) {
            return null;
          }
          return formatDealForFrontend(deal, distance);
        })
        .filter((deal): deal is NonNullable<typeof deal> => deal !== null)
        .sort((a, b) => (a.distance || 0) - (b.distance || 0));

      deals = dealsWithDistance;
    } else {
      // Format deals for frontend when no geolocation filtering is applied
      deals = deals.map(deal => formatDealForFrontend(deal));
    }

    // Prioritize active HAPPY_HOUR deals at the top while preserving distance or createdAt ordering within groups
    if (Array.isArray(deals) && deals.length) {
      const isFormatted = !('merchant' in deals[0] && !(deals[0] as any).merchant.businessName); // naive check
      // deals are already formatted above (or include distance) at this point
      const happyHourDeals = (deals as any[]).filter(d => d.dealType.name === 'Happy Hour');
      const otherDeals = (deals as any[]).filter(d => d.dealType.name !== 'Happy Hour');
      // Preserve existing sort inside each group (distance or createdAt formatting kept earlier)
      deals = [...happyHourDeals, ...otherDeals];
    }

    res.status(200).json({
      deals,
      total: deals.length,
      filters: {
        latitude: latitude ? parseFloat(latitude as string) : null,
        longitude: longitude ? parseFloat(longitude as string) : null,
        radius: radius ? parseFloat(radius as string) : null,
        category: category ? category as string : null,
        search: search ? search as string : null,
        cityId: cityId ? Number(cityId) : null,
        today: todayName
      }
    });
  } catch (error) {
    // Log error details securely (don't expose query params in production logs)
    const isDev = process.env.NODE_ENV === 'development';
    console.error('Error fetching deals:', error instanceof Error ? error.message : 'Unknown error');
    if (isDev) {
      console.error('Error details:', {
        stack: error instanceof Error ? error.stack : undefined,
        query: req.query
      });
    }
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch deals. Please try again later.'
    });
  }
});

// --- Endpoint: GET /api/deals/categories ---
// Returns all available deal categories from database
router.get('/deals/categories', async (req, res) => {
  try {
    // Fetch categories from database
    const dbCategories = await prisma.dealCategoryMaster.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' }
    });

    // Map database categories to frontend format
    const categoryMapping: Record<string, string> = {
      'Food & Beverage': 'FOOD_AND_BEVERAGE',
      'Retail': 'RETAIL',
      'Entertainment': 'ENTERTAINMENT',
      'Health & Fitness': 'HEALTH_AND_FITNESS',
      'Beauty & Spa': 'BEAUTY_AND_SPA',
      'Automotive': 'AUTOMOTIVE',
      'Travel': 'TRAVEL',
      'Education': 'EDUCATION',
      'Technology': 'TECHNOLOGY',
      'Home & Garden': 'HOME_AND_GARDEN',
      'Other': 'OTHER'
    };

    const iconMapping: Record<string, string> = {
      'Food & Beverage': '🍽️',
      'Retail': '🛍️',
      'Entertainment': '🎬',
      'Health & Fitness': '💪',
      'Beauty & Spa': '💅',
      'Automotive': '🚗',
      'Travel': '✈️',
      'Education': '📚',
      'Technology': '💻',
      'Home & Garden': '🏠',
      'Other': '📦'
    };

    const categories = dbCategories.map(category => ({
      value: categoryMapping[category.name] || category.name.toUpperCase().replace(/[^A-Z]/g, '_'),
      label: category.name,
      description: category.description || `${category.name} deals and offers`,
      icon: category.icon || iconMapping[category.name] || '📦'
    }));

    res.status(200).json({
      categories,
      total: categories.length,
      metadata: {
        lastUpdated: new Date().toISOString(),
        version: '1.0.0'
      }
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/deals/featured ---
// Returns a small set of "hottest" deals for homepage hero sections.
// Strategy:
//  1. Active HAPPY_HOUR deals ending soon (soonest first)
//  2. Then other active deals (RECURRING filtered to today) by higher discount, sooner end
//  3. Limit configurable (?limit=8, default 8, max 20)
router.get('/deals/featured', async (req, res) => {
  try {
    const now = new Date();
    const dayNames = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
    const todayName = dayNames[now.getDay()];
    const limitParam = parseInt(String(req.query.limit || ''), 10);
    const limit = (!isNaN(limitParam) && limitParam > 0) ? Math.min(limitParam, 20) : 8;

    // Fetch a candidate pool (cap to 100 for performance) of currently active deals
    // Only from approved merchants.
    let candidates = await prisma.deal.findMany({
      where: {
        startTime: { lte: now },
        endTime: { gte: now },
        merchant: { status: 'APPROVED' }
      },
      // ADD THIS SELECT CLAUSE
      select: {
        id: true,
        title: true,
        description: true,
        imageUrls: true,
        discountPercentage: true,
        discountAmount: true,
        category: true,
        dealType: true,
        recurringDays: true,
        startTime: true,
        endTime: true,
        redemptionInstructions: true,
        createdAt: true,
        updatedAt: true,
        merchantId: true,
        merchant: {
          select: {
            id: true,
            businessName: true,
            businessType: true,
            address: true,
            description: true,
            logoUrl: true,
            latitude: true,
            longitude: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          }
        }
      },
      orderBy: { endTime: 'asc' }, // early ending first to bias candidate set
      take: 100
    });

    // Filter recurring deals to correct day
    candidates = candidates.filter(d => {
      if (d.dealType.name !== 'Recurring') return true;
      if (!d.recurringDays) return false;
      const days = d.recurringDays.split(',').map(s => s.trim().toUpperCase());
      return days.includes(todayName);
    });

    // Compute ranking comparator
    const scored = candidates.map(d => {
      const timeRemainingMs = d.endTime.getTime() - now.getTime();
      const timeRemainingMinutes = timeRemainingMs / 60000;
      const discountPct = d.discountPercentage || 0;
      const discountValue = d.discountAmount || 0;
      // Basic priority groups by deal type
      const typePriority = d.dealType.name === 'Happy Hour' ? 3 : (d.dealType.name === 'Recurring' ? 2 : 1);
      return { d, timeRemainingMinutes, discountPct, discountValue, typePriority };
    });

    scored.sort((a, b) => {
      // 1. Higher typePriority first (Happy Hour > Recurring > Standard)
      if (b.typePriority !== a.typePriority) return b.typePriority - a.typePriority;
      // 2. For same type: earlier ending first
      if (a.timeRemainingMinutes !== b.timeRemainingMinutes) return a.timeRemainingMinutes - b.timeRemainingMinutes;
      // 3. Higher percentage discount
      if (b.discountPct !== a.discountPct) return b.discountPct - a.discountPct;
      // 4. Higher absolute discount amount
      if (b.discountValue !== a.discountValue) return b.discountValue - a.discountValue;
      // 5. Newer createdAt last tiebreak (newer first)
  return b.d.createdAt.getTime() - a.d.createdAt.getTime();
    });

    const selected = scored.slice(0, limit).map(s => formatDealForFrontend(s.d));

    res.status(200).json({
      deals: selected,
      total: selected.length,
      limit,
      generatedAt: now.toISOString(),
      criteria: {
        prioritized: ['HAPPY_HOUR ending soon', 'RECURRING (today)', 'Others by discount & end time'],
        weekday: todayName
      }
    });
  } catch (error) {
    console.error('Error fetching featured deals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Enhanced Endpoint: GET /api/deals/:id ---
// Returns comprehensive deal details for detailed view
router.get('/deals/:id', async (req, res) => {
  try {
    const dealId = parseInt(req.params.id as string);
    if (isNaN(dealId)) {
      return res.status(400).json({ error: 'Invalid Deal ID.' });
    }

    // Get user ID from query parameter for personalized data (optional)
    const { userId } = req.query;

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        merchant: {
          include: {
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
            _count: {
              select: {
                deals: true,
                stores: true
              }
            }
          }
        },
        dealType: true,
        category: true,
        menuItems: {
          where: { isHidden: false },
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                description: true,
                price: true,
                imageUrl: true,
                category: true
              }
            }
          }
        },
        _count: { 
          select: { 
            savedByUsers: true,
            menuItems: true,
            checkIns: true  // Add check-in count
          } 
        },
        savedByUsers: {
          take: 10,
          select: { 
            user: { 
              select: { 
                id: true,
                name: true,
                avatarUrl: true 
              } 
            },
            savedAt: true
          },
          orderBy: { savedAt: 'desc' }
        },
        // Add recent check-ins for social proof
        checkIns: {
          take: 5,
          select: {
            id: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                avatarUrl: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!deal || deal.merchant.status !== 'APPROVED') {
      return res.status(404).json({ error: 'Deal not available or merchant not approved.' });
    }

    // Check if deal is currently active
    const now = new Date();
    const isActive = deal.startTime <= now && deal.endTime >= now;
    const isExpired = deal.endTime < now;
    const isUpcoming = deal.startTime > now;
    
    // Calculate time remaining
    const timeRemaining = isActive ? deal.endTime.getTime() - now.getTime() : 0;
    const hoursRemaining = Math.floor(timeRemaining / (1000 * 60 * 60));
    const minutesRemaining = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));

    // Format recurring days if applicable
    const recurringDays = deal.recurringDays ? 
      deal.recurringDays.split(',').map(day => day.trim()) : [];

    // Calculate discount value
    const discountValue = deal.discountPercentage ? 
      `${deal.discountPercentage}% OFF` : 
      (deal.discountAmount ? `$${deal.discountAmount} OFF` : 'Special Offer');

    // Format menu items
    const formattedMenuItems = deal.menuItems.map(item => ({
      id: item.menuItem.id,
      name: item.menuItem.name,
      description: item.menuItem.description,
      originalPrice: item.menuItem.price,
      discountedPrice: deal.discountPercentage ? 
        item.menuItem.price * (1 - deal.discountPercentage / 100) : 
        (deal.discountAmount ? Math.max(0, item.menuItem.price - deal.discountAmount) : item.menuItem.price),
      imageUrl: item.menuItem.imageUrl,
      category: item.menuItem.category
    }));

    // Enhanced social proof with both saves and check-ins
    const socialProof = {
      totalSaves: deal._count.savedByUsers,
      totalCheckIns: deal._count.checkIns,
      recentSavers: deal.savedByUsers.map(save => ({
        id: save.user.id,
        name: save.user.name,
        avatarUrl: save.user.avatarUrl,
        savedAt: save.savedAt,
        type: 'saved'
      })),
      recentCheckIns: deal.checkIns.map(checkIn => ({
        id: checkIn.user.id,
        name: checkIn.user.name,
        avatarUrl: checkIn.user.avatarUrl,
        checkedInAt: checkIn.createdAt,
        type: 'checked_in'
      }))
    };

    // Combine and sort recent activity
    const recentActivity = [...socialProof.recentSavers, ...socialProof.recentCheckIns]
      .sort((a, b) => {
        const dateA = new Date((a as any).savedAt || (a as any).checkedInAt).getTime();
        const dateB = new Date((b as any).savedAt || (b as any).checkedInAt).getTime();
        return dateB - dateA;
      })
      .slice(0, 10);

    // Format merchant details
    const merchantDetails = {
      id: deal.merchant.id,
      businessName: deal.merchant.businessName,
      description: deal.merchant.description,
      address: deal.merchant.address,
      latitude: deal.merchant.latitude,
      longitude: deal.merchant.longitude,
      logoUrl: deal.merchant.logoUrl,
      phoneNumber: deal.merchant.phoneNumber,
      totalDeals: deal.merchant._count.deals,
      totalStores: deal.merchant._count.stores,
      stores: deal.merchant.stores.map(store => ({
        id: store.id,
        address: store.address,
        latitude: store.latitude,
        longitude: store.longitude,
        active: store.active,
        city: {
          id: store.city.id,
          name: store.city.name,
          state: store.city.state,
          active: store.city.active
        }
      }))
    };

    // Check if user has saved this deal (if userId provided)
    let userInteraction = null;
    if (userId) {
      const userSave = await prisma.userDeal.findUnique({
        where: {
          userId_dealId: {
            userId: parseInt(userId as string),
            dealId: deal.id
          }
        }
      });
      
      userInteraction = {
        isSaved: !!userSave,
        savedAt: userSave?.savedAt || null
      };
    }

    // Comprehensive deal response for details page
    const detailedDeal = {
      // Basic deal info
      id: deal.id,
      title: deal.title,
      description: deal.description,
      category: {
        value: deal.category.name,
        label: deal.category.name.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l: string) => l.toUpperCase()),
        description: deal.category.description,
        icon: deal.category.icon,
        color: deal.category.color
      },
      
      // Visual content
      imageUrl: deal.imageUrls?.[0] || null,
      images: deal.imageUrls || [],
      hasMultipleImages: (deal.imageUrls?.length || 0) > 1,
      
      // Offer details
      offerDisplay: discountValue,
      discountPercentage: deal.discountPercentage,
      discountAmount: deal.discountAmount,
      offerTerms: deal.offerTerms,
      
      // Deal type and timing
      dealType: {
        name: deal.dealType.name,
        description: deal.dealType.description
      },
      startTime: deal.startTime.toISOString(),
      endTime: deal.endTime.toISOString(),
      recurringDays: recurringDays,
      
      // Status and timing
      status: {
        isActive,
        isExpired,
        isUpcoming,
        timeRemaining: {
          total: timeRemaining,
          hours: hoursRemaining,
          minutes: minutesRemaining,
          formatted: `${hoursRemaining}h ${minutesRemaining}m`,
          percentageRemaining: timeRemaining > 0 ? 
            Math.round((timeRemaining / (deal.endTime.getTime() - deal.startTime.getTime())) * 100) : 0
        }
      },
      
      // Redemption
      redemptionInstructions: deal.redemptionInstructions,
      kickbackEnabled: deal.kickbackEnabled,
      
      // Menu items (if applicable)
      menuItems: formattedMenuItems,
      hasMenuItems: formattedMenuItems.length > 0,
      
      // Merchant information
      merchant: merchantDetails,
      
      // Enhanced social proof and activity
      socialProof: {
        ...socialProof,
        recentActivity,
        totalEngagement: socialProof.totalSaves + socialProof.totalCheckIns
      },
      
      // User interaction (if userId provided)
      userInteraction,
      
      // Popularity metrics
      popularity: {
        totalSaves: deal._count.savedByUsers,
        totalCheckIns: deal._count.checkIns,
        totalEngagement: deal._count.savedByUsers + deal._count.checkIns,
        isPopular: deal._count.savedByUsers > 10,
        isTrending: deal._count.savedByUsers > 25,
        engagementScore: Math.min(100, Math.round(((deal._count.savedByUsers + deal._count.checkIns) / 50) * 100))
      },
      
      // Metadata
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
      
      // Additional context for UI
      context: {
        isRecurring: deal.dealType.name === 'Recurring',
        isHappyHour: deal.dealType.name === 'Happy Hour',
        hasMultipleStores: merchantDetails.totalStores > 1,
        canShare: true,
        canSave: true,
        canCheckIn: isActive,
        requiresLocation: true
      },
      
      // Action URLs for frontend
      actions: {
        shareUrl: `/api/deals/${deal.id}/share`,
        saveUrl: `/api/users/save-deal`,
        checkInUrl: `/api/users/check-in`,
        callUrl: merchantDetails.phoneNumber ? `tel:${merchantDetails.phoneNumber}` : null,
        directionsUrl: merchantDetails.latitude && merchantDetails.longitude ? 
          `https://maps.google.com/?q=${merchantDetails.latitude},${merchantDetails.longitude}` : null
      }
    };

    res.status(200).json({
      success: true,
      deal: detailedDeal,
      metadata: {
        fetchedAt: now.toISOString(),
        version: '2.0.0'
      }
    });

  } catch (error) {
    console.error(`Error fetching detailed deal ${req.params.id}:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: 'Failed to fetch deal details'
    });
  }
});

// --- Endpoint: POST /api/deals/:id/share ---
// Track deal sharing for analytics and social proof
router.post('/deals/:id/share', async (req, res) => {
  try {
    const dealId = parseInt(req.params.id as string);
    if (isNaN(dealId)) {
      return res.status(400).json({ error: 'Invalid Deal ID.' });
    }

    const { shareMethod, platform } = req.body; // e.g., shareMethod: 'link', platform: 'whatsapp'

    // Check if deal exists and is active
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        merchant: {
          select: {
            status: true,
            businessName: true,
            businessType: true
          }
        }
      }
    });

    if (!deal || deal.merchant.status !== 'APPROVED') {
      return res.status(404).json({ error: 'Deal not available or merchant not approved.' });
    }

    // Check if deal is currently active
    const now = new Date();
    const isActive = deal.startTime <= now && deal.endTime >= now;
    if (!isActive) {
      return res.status(400).json({ error: 'Cannot share inactive deal.' });
    }

    // In a real implementation, you might want to:
    // 1. Track share analytics in a separate table
    // 2. Generate shareable links with tracking parameters
    // 3. Store share metadata (user agent, timestamp, etc.)
    
    // For now, we'll just return success with deal information for sharing
    const shareData = {
      dealId: deal.id,
      title: deal.title,
      description: deal.description,
      imageUrl: deal.imageUrls?.[0] || null,
      merchantName: deal.merchant.businessName,
      shareUrl: `${process.env.FRONTEND_URL || 'https://your-app.com'}/deals/${deal.id}`,
      shareMethod: shareMethod || 'link',
      platform: platform || 'general'
    };

    res.status(200).json({
      success: true,
      message: 'Deal shared successfully',
      shareData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`Error sharing deal ${req.params.id}:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: 'Failed to share deal'
    });
  }
});

// --- Endpoint: GET /api/menu/items ---
// Public endpoint to filter and search menu items from approved merchants
// Query parameters:
// - merchantId: Filter by specific merchant
// - category: Filter by menu category (e.g., "Appetizers", "Mains", "Desserts")
// - subcategory: Filter by subcategory within a category
// - minPrice: Minimum price filter
// - maxPrice: Maximum price filter
// - search: Text search in name and description
// - cityId: Filter by city
// - latitude, longitude, radius: Location-based filtering
// - isHappyHour: Filter by Happy Hour items (true/false)
// - dealType: Filter by specific deal type (HAPPY_HOUR_BOUNTY, HAPPY_HOUR_SURPRISE, etc.)
// - limit: Number of results (default 50, max 100)
// - offset: Pagination offset
router.get('/menu/items', async (req, res) => {
  try {
    const startTime = Date.now();
    const {
      merchantId,
      category,
      subcategory,
      minPrice,
      maxPrice,
      search,
      cityId,
      latitude,
      longitude,
      radius,
      isHappyHour,
      dealType,
      limit: limitParam,
      offset: offsetParam
    } = req.query as any;

    // Parse and validate pagination parameters
    const limit = Math.min(parseInt(limitParam || '50', 10) || 50, 100);
    const offset = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);

    // Build the where clause for filtering
    const whereClause: any = {
      // Only show menu items from approved merchants
      merchant: {
        status: 'APPROVED'
      }
    };

    // Filter by specific merchant
    if (merchantId) {
      const merchantIdNum = parseInt(merchantId, 10);
      if (isNaN(merchantIdNum)) {
        return res.status(400).json({ error: 'Invalid merchantId parameter' });
      }
      whereClause.merchantId = merchantIdNum;
    }

    // Filter by category (case-insensitive)
    if (category) {
      whereClause.category = {
        contains: category.trim(),
        mode: 'insensitive'
      };
    }

    // Filter by subcategory (case-insensitive)
    if (subcategory) {
      whereClause.category = {
        contains: subcategory.trim(),
        mode: 'insensitive'
      };
    }

    // Price range filtering
    if (minPrice !== undefined || maxPrice !== undefined) {
      whereClause.price = {};
      
      if (minPrice !== undefined) {
        const minPriceNum = parseFloat(minPrice);
        if (isNaN(minPriceNum) || minPriceNum < 0) {
          return res.status(400).json({ error: 'Invalid minPrice parameter' });
        }
        whereClause.price.gte = minPriceNum;
      }
      
      if (maxPrice !== undefined) {
        const maxPriceNum = parseFloat(maxPrice);
        if (isNaN(maxPriceNum) || maxPriceNum < 0) {
          return res.status(400).json({ error: 'Invalid maxPrice parameter' });
        }
        whereClause.price.lte = maxPriceNum;
      }
    }

    // Text search in name and description
    if (search) {
      const searchTerm = search.trim();
      if (searchTerm.length === 0) {
        return res.status(400).json({ error: 'Search term cannot be empty' });
      }
      whereClause.OR = [
        {
          name: {
            contains: searchTerm,
            mode: 'insensitive'
          }
        },
        {
          description: {
            contains: searchTerm,
            mode: 'insensitive'
          }
        }
      ];
    }

    // Happy Hour filtering
    if (isHappyHour !== undefined) {
      const isHappyHourBool = isHappyHour === 'true' || isHappyHour === true;
      if (typeof isHappyHour !== 'boolean' && isHappyHour !== 'true' && isHappyHour !== 'false') {
        return res.status(400).json({ error: 'isHappyHour must be true or false' });
      }
      whereClause.isHappyHour = isHappyHourBool;
    }

    // Deal type filtering
    if (dealType !== undefined) {
      const validDealTypes = [
        'HAPPY_HOUR_BOUNTY', 'HAPPY_HOUR_SURPRISE', 'HAPPY_HOUR_LATE_NIGHT', 
        'HAPPY_HOUR_MID_DAY', 'HAPPY_HOUR_MORNINGS', 'REDEEM_NOW_BOUNTY', 
        'REDEEM_NOW_SURPRISE', 'STANDARD', 'RECURRING'
      ];
      if (!validDealTypes.includes(dealType)) {
        return res.status(400).json({ error: `dealType must be one of: ${validDealTypes.join(', ')}` });
      }
      whereClause.dealType = dealType;
    }

    // Location-based filtering
    if (cityId) {
      const cityIdNum = parseInt(cityId, 10);
      if (isNaN(cityIdNum)) {
        return res.status(400).json({ error: 'Invalid cityId parameter' });
      }
      
      whereClause.merchant = {
        ...whereClause.merchant,
        stores: {
          some: {
            cityId: cityIdNum,
            active: true
          }
        }
      };
    } else if (latitude && longitude && radius) {
      // Geolocation-based filtering using merchant's primary location
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const rad = parseFloat(radius);

      if (isNaN(lat) || isNaN(lng) || isNaN(rad)) {
        return res.status(400).json({ 
          error: 'Invalid latitude, longitude, or radius parameters' 
        });
      }

      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ 
          error: 'Latitude must be between -90 and 90, longitude between -180 and 180' 
        });
      }

      if (rad <= 0 || rad > 1000) {
        return res.status(400).json({ 
          error: 'Radius must be between 0 and 1000 kilometers' 
        });
      }

      // Add geolocation filter using merchant's coordinates
      whereClause.merchant = {
        ...whereClause.merchant,
        latitude: { not: null },
        longitude: { not: null }
      };
    }

    // Execute the query with pagination
    const [menuItems, totalCount] = await Promise.all([
      prisma.menuItem.findMany({
        where: whereClause,
        include: {
          merchant: {
            select: {
              id: true,
              businessName: true,
              address: true,
              latitude: true,
              longitude: true,
              logoUrl: true,
              description: true,
              stores: {
                where: { active: true },
                select: {
                  id: true,
                  address: true,
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
          }
        },
        orderBy: [
          { category: 'asc' },
          { price: 'asc' },
          { name: 'asc' }
        ],
        take: limit,
        skip: offset
      }),
      prisma.menuItem.count({ where: whereClause })
    ]);

    // If geolocation filtering was requested, filter results by distance
    let filteredMenuItems = menuItems;
    if (latitude && longitude && radius) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const rad = parseFloat(radius);

      filteredMenuItems = menuItems.filter(item => {
        if (!item.merchant.latitude || !item.merchant.longitude) return false;
        
        const distance = calculateDistance(
          lat, lng,
          item.merchant.latitude, item.merchant.longitude
        );
        
        return distance <= rad;
      });
    }

    // Format the response
    const formattedMenuItems = filteredMenuItems.map(item => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price,
      category: item.category,
      imageUrl: item.imageUrl,
      isHappyHour: item.isHappyHour,
      happyHourPrice: item.happyHourPrice,
      dealType: item.dealType,
      validStartTime: item.validStartTime,
      validEndTime: item.validEndTime,
      validDays: item.validDays,
      isSurprise: item.isSurprise,
      surpriseRevealTime: item.surpriseRevealTime,
      createdAt: item.createdAt,
      merchant: {
        id: item.merchant.id,
        businessName: item.merchant.businessName,
        address: item.merchant.address,
        latitude: item.merchant.latitude,
        longitude: item.merchant.longitude,
        logoUrl: item.merchant.logoUrl,
        description: item.merchant.description,
        stores: item.merchant.stores
      }
    }));

    // Calculate pagination metadata
    const hasMore = offset + limit < totalCount;
    const totalPages = Math.ceil(totalCount / limit);
    const currentPage = Math.floor(offset / limit) + 1;

    // Log performance for slow queries
    logQueryPerformance(
      'menu-items-filter',
      startTime,
      formattedMenuItems.length,
      { category, subcategory, merchantId, search, cityId, limit, offset }
    );

    res.status(200).json({
      menuItems: formattedMenuItems,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore,
        currentPage,
        totalPages
      },
      filters: {
        category: category || null,
        subcategory: subcategory || null,
        merchantId: merchantId || null,
        minPrice: minPrice ? parseFloat(minPrice) : null,
        maxPrice: maxPrice ? parseFloat(maxPrice) : null,
        search: search || null,
        cityId: cityId ? parseInt(cityId, 10) : null,
        location: (latitude && longitude && radius) ? {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          radius: parseFloat(radius)
        } : null
      }
    });

  } catch (error) {
    console.error('Menu items filter error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/menu/categories ---
// Returns all unique menu categories from approved merchants
// Query parameters:
// - merchantId: Filter categories by specific merchant
// - cityId: Filter categories by city
router.get('/menu/categories', async (req, res) => {
  try {
    const { merchantId, cityId } = req.query as any;

    const whereClause: any = {
      merchant: {
        status: 'APPROVED'
      }
    };

    // Filter by specific merchant
    if (merchantId) {
      const merchantIdNum = parseInt(merchantId, 10);
      if (isNaN(merchantIdNum)) {
        return res.status(400).json({ error: 'Invalid merchantId parameter' });
      }
      whereClause.merchantId = merchantIdNum;
    }

    // Filter by city
    if (cityId) {
      const cityIdNum = parseInt(cityId, 10);
      if (isNaN(cityIdNum)) {
        return res.status(400).json({ error: 'Invalid cityId parameter' });
      }
      
      whereClause.merchant = {
        ...whereClause.merchant,
        stores: {
          some: {
            cityId: cityIdNum,
            active: true
          }
        }
      };
    }

    // Get unique categories with counts
    const categories = await prisma.menuItem.groupBy({
      by: ['category'],
      where: whereClause,
      _count: {
        category: true
      },
      orderBy: {
        category: 'asc'
      }
    });

    const formattedCategories = categories.map(cat => ({
      name: cat.category,
      count: cat._count.category
    }));

    res.status(200).json({
      categories: formattedCategories,
      total: formattedCategories.length
    });

  } catch (error) {
    console.error('Menu categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/menu/happy-hour ---
// Dedicated endpoint for Happy Hour menu items from approved merchants
// Query parameters:
// - merchantId: Filter by specific merchant
// - category: Filter by menu category
// - minPrice: Minimum price filter
// - maxPrice: Maximum price filter
// - search: Text search in name and description
// - cityId: Filter by city
// - latitude, longitude, radius: Location-based filtering
// - limit: Number of results (default 50, max 100)
// - offset: Pagination offset
router.get('/menu/happy-hour', async (req, res) => {
  try {
    const startTime = Date.now();
    const {
      merchantId,
      category,
      minPrice,
      maxPrice,
      search,
      cityId,
      latitude,
      longitude,
      radius,
      limit: limitParam,
      offset: offsetParam
    } = req.query as any;

    // Parse and validate pagination parameters
    const limit = Math.min(parseInt(limitParam || '50', 10) || 50, 100);
    const offset = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);

    // Build the where clause for filtering - only Happy Hour items
    const whereClause: any = {
      isHappyHour: true, // Only Happy Hour items
      merchant: {
        status: 'APPROVED'
      }
    };

    // Filter by specific merchant
    if (merchantId) {
      const merchantIdNum = parseInt(merchantId, 10);
      if (isNaN(merchantIdNum)) {
        return res.status(400).json({ error: 'Invalid merchantId parameter' });
      }
      whereClause.merchantId = merchantIdNum;
    }

    // Filter by category (case-insensitive)
    if (category) {
      whereClause.category = {
        contains: category.trim(),
        mode: 'insensitive'
      };
    }

    // Price range filtering
    if (minPrice !== undefined || maxPrice !== undefined) {
      whereClause.price = {};
      
      if (minPrice !== undefined) {
        const minPriceNum = parseFloat(minPrice);
        if (isNaN(minPriceNum) || minPriceNum < 0) {
          return res.status(400).json({ error: 'Invalid minPrice parameter' });
        }
        whereClause.price.gte = minPriceNum;
      }
      
      if (maxPrice !== undefined) {
        const maxPriceNum = parseFloat(maxPrice);
        if (isNaN(maxPriceNum) || maxPriceNum < 0) {
          return res.status(400).json({ error: 'Invalid maxPrice parameter' });
        }
        whereClause.price.lte = maxPriceNum;
      }
    }

    // Text search in name and description
    if (search) {
      const searchTerm = search.trim();
      if (searchTerm.length === 0) {
        return res.status(400).json({ error: 'Search term cannot be empty' });
      }
      whereClause.OR = [
        {
          name: {
            contains: searchTerm,
            mode: 'insensitive'
          }
        },
        {
          description: {
            contains: searchTerm,
            mode: 'insensitive'
          }
        }
      ];
    }

    // Location-based filtering
    if (cityId) {
      const cityIdNum = parseInt(cityId, 10);
      if (isNaN(cityIdNum)) {
        return res.status(400).json({ error: 'Invalid cityId parameter' });
      }
      
      whereClause.merchant = {
        ...whereClause.merchant,
        stores: {
          some: {
            cityId: cityIdNum,
            active: true
          }
        }
      };
    }

    // Geolocation filtering
    if (latitude && longitude && radius) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const rad = parseFloat(radius);

      if (isNaN(lat) || isNaN(lng) || isNaN(rad) || rad <= 0) {
        return res.status(400).json({ error: 'Invalid geolocation parameters' });
      }

      whereClause.merchant = {
        ...whereClause.merchant,
        latitude: { not: null },
        longitude: { not: null }
      };
    }

    // Execute the query with pagination
    const [menuItems, totalCount] = await Promise.all([
      prisma.menuItem.findMany({
        where: whereClause,
        include: {
          merchant: {
            select: {
              id: true,
              businessName: true,
              address: true,
              latitude: true,
              longitude: true,
              logoUrl: true,
              description: true,
              stores: {
                where: { active: true },
                select: {
                  id: true,
                  address: true,
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
          }
        },
        orderBy: [
          { category: 'asc' },
          { price: 'asc' },
          { name: 'asc' }
        ],
        take: limit,
        skip: offset
      }),
      prisma.menuItem.count({ where: whereClause })
    ]);

    // If geolocation filtering was requested, filter results by distance
    let filteredMenuItems = menuItems;
    if (latitude && longitude && radius) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const rad = parseFloat(radius);

      filteredMenuItems = menuItems.filter(item => {
        if (!item.merchant.latitude || !item.merchant.longitude) return false;
        
        const distance = calculateDistance(
          lat, lng,
          item.merchant.latitude, item.merchant.longitude
        );
        
        return distance <= rad;
      });
    }

    // Format the response
    const formattedMenuItems = filteredMenuItems.map(item => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price,
      category: item.category,
      imageUrl: item.imageUrl,
      isHappyHour: item.isHappyHour,
      happyHourPrice: item.happyHourPrice,
      dealType: item.dealType,
      validStartTime: item.validStartTime,
      validEndTime: item.validEndTime,
      validDays: item.validDays,
      isSurprise: item.isSurprise,
      surpriseRevealTime: item.surpriseRevealTime,
      createdAt: item.createdAt,
      merchant: {
        id: item.merchant.id,
        businessName: item.merchant.businessName,
        address: item.merchant.address,
        latitude: item.merchant.latitude,
        longitude: item.merchant.longitude,
        logoUrl: item.merchant.logoUrl,
        description: item.merchant.description,
        stores: item.merchant.stores
      }
    }));

    // Calculate pagination metadata
    const hasMore = offset + limit < totalCount;
    const totalPages = Math.ceil(totalCount / limit);
    const currentPage = Math.floor(offset / limit) + 1;

    // Log performance for slow queries
    logQueryPerformance(
      'happy-hour-menu-filter',
      startTime,
      formattedMenuItems.length,
      { category, merchantId, search, cityId, limit, offset }
    );

    res.status(200).json({
      menuItems: formattedMenuItems,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore,
        totalPages,
        currentPage
      },
      filters: {
        merchantId: merchantId || null,
        category: category || null,
        search: search || null,
        cityId: cityId || null,
        isHappyHour: true
      }
    });

  } catch (error) {
    console.error('Happy Hour menu items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/menu/deal-types ---
// Get all available deal types with descriptions
router.get('/menu/deal-types', async (req, res) => {
  try {
    const dealTypes = [
      {
        value: 'HAPPY_HOUR_BOUNTY',
        label: 'Happy Hour Bounty',
        description: 'Happy Hour bounty - redeem now',
        category: 'Happy Hour'
      },
      {
        value: 'HAPPY_HOUR_SURPRISE',
        label: 'Happy Hour Surprise',
        description: 'Happy Hour surprise deal',
        category: 'Happy Hour'
      },
      {
        value: 'HAPPY_HOUR_LATE_NIGHT',
        label: 'Happy Hour Late Night',
        description: 'Happy Hour late night specials',
        category: 'Happy Hour'
      },
      {
        value: 'HAPPY_HOUR_MID_DAY',
        label: 'Happy Hour Mid Day',
        description: 'Happy Hour mid day specials',
        category: 'Happy Hour'
      },
      {
        value: 'HAPPY_HOUR_MORNINGS',
        label: 'Happy Hour Mornings',
        description: 'Happy Hour morning specials',
        category: 'Happy Hour'
      },
      {
        value: 'REDEEM_NOW_BOUNTY',
        label: 'Redeem Now Bounty',
        description: 'Redeem now bounty',
        category: 'Redeem Now'
      },
      {
        value: 'REDEEM_NOW_SURPRISE',
        label: 'Redeem Now Surprise',
        description: 'Redeem now surprise deal',
        category: 'Redeem Now'
      },
      {
        value: 'STANDARD',
        label: 'Standard',
        description: 'Regular menu item',
        category: 'Standard'
      },
      {
        value: 'RECURRING',
        label: 'Recurring',
        description: 'Recurring deal',
        category: 'Standard'
      }
    ];

    res.status(200).json({
      dealTypes,
      total: dealTypes.length
    });

  } catch (error) {
    console.error('Deal types error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/menu-collections/:merchantId ---
// Get menu collections for a specific approved merchant (public endpoint)
router.get('/menu-collections/:merchantId', async (req, res) => {
  try {
    const merchantId = Number(req.params.merchantId);
    if (!Number.isFinite(merchantId)) {
      return res.status(400).json({ error: 'Invalid merchant ID' });
    }

    const collections = await prisma.menuCollection.findMany({
      where: {
        merchantId,
        isActive: true,
        merchant: {
          status: 'APPROVED'
        }
      },
      include: {
        items: {
          where: { isActive: true },
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                price: true,
                category: true,
                imageUrl: true,
                description: true,
                dealType: true,
                isHappyHour: true,
                happyHourPrice: true
              }
            }
          },
          orderBy: { sortOrder: 'asc' }
        },
        _count: {
          select: { items: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ collections });
  } catch (error) {
    console.error('Get menu collections error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/deals/hidden/:code ---
// Access hidden deals via access code, direct link, or QR code
router.get('/deals/hidden/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const now = new Date();
    const upperCode = code?.trim().toUpperCase();

    if (!code || code.trim().length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Access code is required' 
      });
    }

    console.log(`[Hidden Deal] Looking for deal with accessCode: ${upperCode}`);

    // First, check if ANY deal exists with this access code (without restrictions)
    const anyDeal = await prisma.deal.findFirst({
      where: {
        accessCode: upperCode,
      },
      select: { 
        id: true, 
        accessCode: true,
        endTime: true, 
        startTime: true,
        merchant: { 
          select: { 
            id: true,
            status: true,
            businessName: true
          } 
        },
        dealType: {
          select: {
            name: true
          }
        }
      }
    });

    if (!anyDeal) {
      console.log(`[Hidden Deal] No deal found with accessCode: ${upperCode}`);
      return res.status(404).json({ 
        success: false,
        error: 'Hidden deal not found',
        hint: 'No deal exists with this access code. Please check the code and try again.'
      });
    }

    console.log(`[Hidden Deal] Found deal ID: ${anyDeal.id}, DealType: ${anyDeal.dealType?.name}, Merchant Status: ${anyDeal.merchant.status}, EndTime: ${anyDeal.endTime}`);

    // Check if deal has expired
    if (anyDeal.endTime < now) {
      return res.status(404).json({ 
        success: false,
        error: 'This hidden deal has expired',
        hint: `The deal ended on ${anyDeal.endTime.toISOString()}`
      });
    }

    // Check if merchant is approved
    if (anyDeal.merchant.status !== 'APPROVED') {
      return res.status(404).json({ 
        success: false,
        error: 'Hidden deal not available',
        hint: `The merchant account (${anyDeal.merchant.businessName}) is not approved. Status: ${anyDeal.merchant.status}`
      });
    }

    // Now fetch the full deal with all relations
    const deal = await prisma.deal.findFirst({
      where: {
        id: anyDeal.id,
        accessCode: upperCode,
        merchant: {
          status: 'APPROVED'
        }
      },
      include: {
        merchant: {
          include: {
            stores: {
              include: {
                city: true
              }
            }
          }
        },
        category: true,
        dealType: true,
        menuItems: {
          include: {
            menuItem: true
          }
        },
        _count: {
          select: { savedByUsers: true }
        }
      }
    });

    if (!deal) {
      console.log(`[Hidden Deal] Deal ${anyDeal.id} found but failed to load full details`);
      return res.status(404).json({ 
        success: false,
        error: 'Hidden deal not found',
        hint: 'Deal exists but could not be loaded. Please try again.'
      });
    }

    // Return deal with bounty info if applicable
    const response: any = {
      success: true,
      deal: {
        ...deal,
        isHidden: true
      }
    };

    if (deal.bountyRewardAmount && deal.minReferralsRequired) {
      response.bounty = {
        enabled: true,
        rewardAmount: deal.bountyRewardAmount,
        minReferrals: deal.minReferralsRequired,
        description: `Bring ${deal.minReferralsRequired} friend${deal.minReferralsRequired > 1 ? 's' : ''} and earn $${deal.bountyRewardAmount} per person!`
      };
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Get hidden deal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: POST /api/deals/:id/redeem ---
// Redeem a deal with optional bounty verification via QR code
router.post('/deals/:id/redeem', async (req, res) => {
  try {
    const { id } = req.params;
    const { qrCodeData, referralCount } = req.body;
    const userId = (req as any).user?.id; // Assuming protect middleware adds user

    const dealId = parseInt(id);
    if (isNaN(dealId)) {
      return res.status(400).json({ error: 'Invalid deal ID' });
    }

    // Fetch the deal
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        dealType: true,
        merchant: true
      }
    });

    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    // Check if deal is active
    const now = new Date();
    if (now < deal.startTime || now > deal.endTime) {
      return res.status(400).json({ error: 'Deal is not currently active' });
    }

    // Check flash sale redemption limit
    if (deal.isFlashSale && deal.maxRedemptions) {
      if (deal.currentRedemptions >= deal.maxRedemptions) {
        return res.status(400).json({
          error: 'This deal has reached maximum redemptions',
          maxRedemptions: deal.maxRedemptions
        });
      }
    }

    // Handle bounty deals with QR code verification
    if (deal.kickbackEnabled && deal.bountyRewardAmount) {
      // Verify QR code if provided
      if (qrCodeData) {
        const { verifyBountyQRCode } = require('../lib/dealUtils');
        const verification = verifyBountyQRCode(qrCodeData);

        if (!verification) {
          return res.status(400).json({
            error: 'Invalid QR code',
            hint: 'Please scan the correct bounty QR code'
          });
        }

        if (verification.dealId !== dealId) {
          return res.status(400).json({
            error: 'QR code does not match this deal'
          });
        }
      }

      // Validate referral count
      const actualReferralCount = referralCount || 0;
      if (actualReferralCount < (deal.minReferralsRequired || 0)) {
        return res.status(400).json({
          error: `You must bring at least ${deal.minReferralsRequired} friend${deal.minReferralsRequired! > 1 ? 's' : ''} to redeem this bounty`,
          required: deal.minReferralsRequired,
          provided: actualReferralCount
        });
      }

      // Create kickback event for bounty reward
      const bountyEarned = deal.bountyRewardAmount * actualReferralCount;
      
      if (userId) {
        await prisma.kickbackEvent.create({
          data: {
            merchantId: deal.merchantId,
            dealId: deal.id,
            userId: userId,
            amountEarned: bountyEarned,
            sourceAmountSpent: 0, // Can be updated with actual purchase amount
            inviteeCount: actualReferralCount
          }
        });
      }

      // Increment redemption count for flash sales
      if (deal.isFlashSale) {
        await prisma.deal.update({
          where: { id: dealId },
          data: {
            currentRedemptions: {
              increment: 1
            }
          }
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Bounty deal redeemed successfully!',
        bountyEarned: bountyEarned,
        referralCount: actualReferralCount,
        cashBack: `$${bountyEarned.toFixed(2)}`
      });
    }

    // Regular deal redemption (non-bounty)
    if (deal.isFlashSale) {
      await prisma.deal.update({
        where: { id: dealId },
        data: {
          currentRedemptions: {
            increment: 1
          }
        }
      });

      return res.status(200).json({
        success: true,
        message: 'Deal redeemed successfully!',
        discount: deal.discountPercentage ? `${deal.discountPercentage}%` : deal.discountAmount ? `$${deal.discountAmount}` : 'Special offer'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Deal redeemed successfully!'
    });

  } catch (error) {
    console.error('Deal redemption error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;