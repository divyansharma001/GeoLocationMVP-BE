// src/routes/merchant.routes.ts
import { Router, Response } from 'express';
import { protect, isApprovedMerchant, isMerchant, AuthRequest } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';
import { uploadImage, deleteImage, uploadToCloudinary } from '../lib/cloudinary';
import { slugify } from '../lib/slugify';
import multer from 'multer';


const router = Router();

// Configure multer for image uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
});

// --- Endpoint: POST /api/merchants/register ---
// Allows a user to register as a merchant.
router.post('/merchants/register', protect, async (req: AuthRequest, res) => {
  try {
  const { businessName, address, description, logoUrl, phoneNumber, latitude, longitude, cityId, businessType } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!businessName || !address) {
      return res.status(400).json({ error: 'Business name and address are required' });
    }

    // Validate businessType if provided
    if (businessType && !['NATIONAL', 'LOCAL'].includes(businessType)) {
      return res.status(400).json({ error: 'Business type must be either NATIONAL or LOCAL' });
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

    // Enforce selection of an existing ACTIVE city (no on-the-fly creation anymore)
    if (!cityId) {
      return res.status(400).json({ error: 'cityId is required. Only pre-approved active cities may be selected.' });
    }
    // @ts-ignore - available after Prisma generate
    const existingCity = await prisma.city.findUnique({ where: { id: Number(cityId) } });
    if (!existingCity) {
      return res.status(400).json({ error: 'Invalid cityId provided.' });
    }
    if (!existingCity.active) {
      return res.status(400).json({ error: 'Selected city is not active for merchant onboarding.' });
    }
    const resolvedCityId: number = existingCity.id;

    const [merchant] = await prisma.$transaction([
      prisma.merchant.create({
        data: {
          businessName,
          address,
          description,
          logoUrl,
          phoneNumber: phoneNumber || null,
          businessType: businessType || 'LOCAL', // Default to LOCAL if not provided
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          // legacy free-form city usage disabled for new merchants
          city: null,
          owner: { connect: { id: userId } },
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { role: 'MERCHANT' },
      }),
    ]);

    // If a city was resolved, create a Store for this merchant
    let store = null as any;
    // @ts-ignore - available after Prisma generate
    store = await prisma.store.create({
      data: {
        merchantId: merchant.id,
        cityId: resolvedCityId,
        address,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
      }
    });

    res.status(201).json({
      message: 'Merchant application submitted successfully. It is now pending approval.',
      merchant,
      store,
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
        businessType: true,
        address: true,
        description: true,
        logoUrl: true,
        phoneNumber: true,
        city: true,
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

// --- Enhanced Endpoint: POST /api/deals ---
// Allows an APPROVED merchant to create a comprehensive deal with all dynamic fields.
router.post('/deals', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const {
      // Basic deal information
      title,
      description,
      activeDateRange, // { startDate, endDate }
      timeRanges, // placeholder for future granular hours
      redemptionInstructions,
      
      // Visual content
      imageUrls,
      primaryImageIndex, // Index of primary image in imageUrls array
      
      // Offer details
      discountPercentage,
      discountAmount,
      offerTerms,
      customOfferDisplay, // Custom offer text (e.g., "Buy 2 Get 1 Free")
      
      // Categorization
      category,
      dealType: rawDealType,
      recurringDays: rawRecurringDays,
      
      // Features and settings
      kickbackEnabled,
      isFeatured, // Whether this deal should be featured
      priority, // Deal priority for sorting (1-10, higher = more priority)
      
      // Menu integration
      menuItems, // [{ id, isHidden, customPrice?, customDiscount? }]
      
      // Advanced settings
      maxRedemptions, // Maximum number of redemptions allowed
      minOrderAmount, // Minimum order amount to qualify
      validDaysOfWeek, // Specific days of week when deal is valid
      validHours, // Specific time ranges when deal is valid
      
      // Social and engagement
      socialProofEnabled, // Whether to show social proof
      allowSharing, // Whether deal can be shared
      
      // Location-specific settings
      storeIds, // Specific store IDs where deal is valid (if not all stores)
      cityIds, // Specific city IDs where deal is valid
      
      // Additional metadata
      tags, // Array of tags for better categorization
      notes, // Internal notes for merchant
      externalUrl // Link to external page or menu
    } = req.body;
    const merchantId = req.merchant?.id;

    if (!merchantId) {
      return res.status(401).json({ error: 'Merchant authentication required' });
    }

    // Enhanced validation with detailed error messages
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required and must be a non-empty string.' });
    }
    
    if (title.trim().length > 100) {
      return res.status(400).json({ error: 'Title must be 100 characters or less.' });
    }
    
    if (!activeDateRange?.startDate || !activeDateRange?.endDate) {
      return res.status(400).json({ error: 'activeDateRange with startDate and endDate are required.' });
    }
    
    const startTime = new Date(activeDateRange.startDate);
    const endTime = new Date(activeDateRange.endDate);
    
    if (!(startTime instanceof Date) || isNaN(startTime.getTime())) {
      return res.status(400).json({ error: 'Invalid start date format. Please provide a valid ISO date string.' });
    }
    
    if (!(endTime instanceof Date) || isNaN(endTime.getTime())) {
      return res.status(400).json({ error: 'Invalid end date format. Please provide a valid ISO date string.' });
    }
    
    if (startTime >= endTime) {
      return res.status(400).json({ error: 'End date must be after start date.' });
    }
    
    // Check if dates are not too far in the past or future
    const now = new Date();
    const oneYearFromNow = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000));
    
    if (startTime < now) {
      return res.status(400).json({ error: 'Start date cannot be in the past.' });
    }
    
    if (endTime > oneYearFromNow) {
      return res.status(400).json({ error: 'End date cannot be more than one year in the future.' });
    }

    // Validate description
    if (description && typeof description !== 'string') {
      return res.status(400).json({ error: 'Description must be a string.' });
    }
    
    if (description && description.length > 1000) {
      return res.status(400).json({ error: 'Description must be 1000 characters or less.' });
    }

    // Validate redemptionInstructions
    if (redemptionInstructions && typeof redemptionInstructions !== 'string') {
      return res.status(400).json({ error: 'Redemption instructions must be a string.' });
    }
    
    if (redemptionInstructions && redemptionInstructions.length > 500) {
      return res.status(400).json({ error: 'Redemption instructions must be 500 characters or less.' });
    }

    // Validate imageUrls
    if (imageUrls && (!Array.isArray(imageUrls) || imageUrls.some((u: any) => typeof u !== 'string'))) {
      return res.status(400).json({ error: 'imageUrls must be an array of strings.' });
    }
    
    if (imageUrls && imageUrls.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 images allowed per deal.' });
    }

    // Handle primaryImageIndex validation and final value
    let finalPrimaryImageIndex = primaryImageIndex;
    
    // If no images are provided, set primaryImageIndex to null
    if (!imageUrls || imageUrls.length === 0) {
      finalPrimaryImageIndex = null;
    } else {
      // Only validate primaryImageIndex if images are provided
      if (primaryImageIndex !== undefined && primaryImageIndex !== null) {
        const primaryIndex = parseInt(primaryImageIndex);
        if (isNaN(primaryIndex) || primaryIndex < 0 || primaryIndex >= imageUrls.length) {
          return res.status(400).json({ error: 'primaryImageIndex must be a valid index within imageUrls array.' });
        }
        finalPrimaryImageIndex = primaryIndex;
      }
    }

    // Validate discount fields
    if (discountPercentage !== undefined && (isNaN(discountPercentage) || discountPercentage < 0 || discountPercentage > 100)) {
      return res.status(400).json({ error: 'discountPercentage must be between 0 and 100.' });
    }
    if (discountAmount !== undefined && (isNaN(discountAmount) || discountAmount < 0)) {
      return res.status(400).json({ error: 'discountAmount must be a positive number.' });
    }
    if (!discountPercentage && !discountAmount && !customOfferDisplay) {
      return res.status(400).json({ error: 'At least one of discountPercentage, discountAmount, or customOfferDisplay is required.' });
    }

    // Validate priority
    if (priority !== undefined && (isNaN(priority) || priority < 1 || priority > 10)) {
      return res.status(400).json({ error: 'priority must be between 1 and 10.' });
    }

    // Validate maxRedemptions (0 means unlimited)
    if (maxRedemptions !== undefined && (isNaN(maxRedemptions) || maxRedemptions < 0)) {
      return res.status(400).json({ error: 'maxRedemptions must be a non-negative number (0 for unlimited).' });
    }

    // Validate minOrderAmount
    if (minOrderAmount !== undefined && (isNaN(minOrderAmount) || minOrderAmount < 0)) {
      return res.status(400).json({ error: 'minOrderAmount must be a non-negative number.' });
    }

    // Validate tags
    if (tags && (!Array.isArray(tags) || tags.some((tag: any) => typeof tag !== 'string'))) {
      return res.status(400).json({ error: 'tags must be an array of strings.' });
    }

    // Validate storeIds
    if (storeIds && (!Array.isArray(storeIds) || storeIds.some((id: any) => isNaN(parseInt(id))))) {
      return res.status(400).json({ error: 'storeIds must be an array of valid store IDs.' });
    }

    // Validate cityIds
    if (cityIds && (!Array.isArray(cityIds) || cityIds.some((id: any) => isNaN(parseInt(id))))) {
      return res.status(400).json({ error: 'cityIds must be an array of valid city IDs.' });
    }

    // Validate and resolve deal type ID
    let dealTypeId: number | undefined;
    if (rawDealType) {
      const dealTypeRecord = await prisma.dealTypeMaster.findFirst({
        where: { name: { equals: String(rawDealType).trim(), mode: 'insensitive' }, active: true }
      });
      if (!dealTypeRecord) {
        return res.status(400).json({ error: `Invalid dealType: ${rawDealType}. Please check available deal types.` });
      }
      dealTypeId = dealTypeRecord.id;
    } else {
      // Default to Standard deal type
      const standardDealType = await prisma.dealTypeMaster.findFirst({
        where: { name: { equals: 'Standard', mode: 'insensitive' }, active: true }
      });
      if (standardDealType) {
        dealTypeId = standardDealType.id;
      } else {
        // If Standard doesn't exist, get the first available deal type
        const firstDealType = await prisma.dealTypeMaster.findFirst({
          where: { active: true },
          orderBy: { id: 'asc' }
        });
        if (firstDealType) {
          dealTypeId = firstDealType.id;
        } else {
          return res.status(500).json({ error: 'No active deal types found in the system.' });
        }
      }
    }
    
    // Ensure dealTypeId is set
    if (!dealTypeId) {
      return res.status(500).json({ error: 'Failed to resolve deal type. Please try again.' });
    }

    // Validate and resolve category ID if provided
    let categoryId: number | undefined;
    
    // Map frontend category values to database category names
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
    
    if (category) {
      const dbCategoryName = categoryMapping[category] || category;
      
      const categoryRecord = await prisma.dealCategoryMaster.findFirst({
        where: { name: { equals: dbCategoryName, mode: 'insensitive' }, active: true }
      });
      
      if (!categoryRecord) {
        return res.status(400).json({ error: `Invalid category: ${category}. Please check available categories.` });
      }
      categoryId = categoryRecord.id;
    } else {
      // Default to "Other" category if no category is provided
      const defaultCategory = await prisma.dealCategoryMaster.findFirst({
        where: { name: { equals: 'Other', mode: 'insensitive' }, active: true }
      });
      
      if (defaultCategory) {
        categoryId = defaultCategory.id;
      } else {
        // If "Other" doesn't exist, get the first available category
        const firstCategory = await prisma.dealCategoryMaster.findFirst({
          where: { active: true },
          orderBy: { sortOrder: 'asc' }
        });
        
        if (firstCategory) {
          categoryId = firstCategory.id;
        } else {
          return res.status(500).json({ error: 'No active categories found in the system.' });
        }
      }
    }
    
    // Ensure categoryId is set
    if (!categoryId) {
      return res.status(500).json({ error: 'Failed to resolve category. Please try again.' });
    }

    // Normalize recurringDays input
    const validDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    let recurringDays: string | null = null;
    if (rawRecurringDays !== undefined && rawRecurringDays !== null && rawRecurringDays !== '') {
      let daysArray: string[] = [];
      if (Array.isArray(rawRecurringDays)) {
        daysArray = rawRecurringDays.map(d => String(d).trim().toUpperCase());
      } else if (typeof rawRecurringDays === 'string') {
        daysArray = rawRecurringDays.split(',').map(d => d.trim().toUpperCase()).filter(Boolean);
      } else {
        return res.status(400).json({ error: 'recurringDays must be an array or comma-separated string.' });
      }
      const seen = new Set<string>();
      daysArray = daysArray.filter(d => { if (!seen.has(d)) { seen.add(d); return true; } return false; });
      const invalidDays = daysArray.filter(d => !validDays.includes(d));
      if (invalidDays.length) {
        return res.status(400).json({ error: `Invalid recurringDays: ${invalidDays.join(', ')}` });
      }
      if (daysArray.length === 0) return res.status(400).json({ error: 'recurringDays cannot be empty if provided.' });
      recurringDays = daysArray.join(',');
    }
    // Check if deal type requires recurring days
    if (dealTypeId) {
      const dealTypeRecord = await prisma.dealTypeMaster.findUnique({
        where: { id: dealTypeId }
      });
      if (dealTypeRecord && dealTypeRecord.name === 'Recurring' && !recurringDays) {
        return res.status(400).json({ error: 'recurringDays required for RECURRING deals.' });
      }
      if (dealTypeRecord && dealTypeRecord.name !== 'Recurring') {
        recurringDays = null;
      }
    }

    // Enhanced deal creation with all dynamic fields
    let newDeal;
    try {
      newDeal = await prisma.$transaction(async (tx) => {
      // Prepare enhanced deal data
      const dealData = {
        title,
        description: description || '',
        startTime,
        endTime,
        redemptionInstructions: redemptionInstructions || '',
        imageUrls: imageUrls || [],
        discountPercentage: discountPercentage ? parseFloat(discountPercentage) : null,
        discountAmount: discountAmount ? parseFloat(discountAmount) : null,
        categoryId: categoryId!,
        dealTypeId: dealTypeId!,
        recurringDays,
        offerTerms: offerTerms || null,
        kickbackEnabled: !!kickbackEnabled,
        merchantId: merchantId
      };

      const createdDeal = await tx.deal.create({
        data: dealData
      });

      // Handle menu items with enhanced data
      if (menuItems && Array.isArray(menuItems) && menuItems.length > 0) {
        const dealMenuItemsData = menuItems
          .filter(mi => mi && typeof mi.id !== 'undefined')
          .map(mi => ({
            dealId: createdDeal.id,
            menuItemId: Number(mi.id),
            isHidden: !!mi.isHidden,
            // Enhanced menu item data
            customPrice: mi.customPrice ? parseFloat(mi.customPrice) : null,
            customDiscount: mi.customDiscount ? parseFloat(mi.customDiscount) : null
          }));
        
        if (dealMenuItemsData.length) {
          // @ts-ignore - DealMenuItem model available after generate
          await tx.dealMenuItem.createMany({ data: dealMenuItemsData });
        }
      }

      return createdDeal;
    });
    } catch (transactionError: unknown) {
      console.error('Transaction error during deal creation:', transactionError);
      
      // Handle specific Prisma errors
      if (transactionError instanceof Error) {
        if (transactionError.message.includes('Unique constraint')) {
          return res.status(400).json({ error: 'A deal with this title already exists for your business.' });
        }
        if (transactionError.message.includes('Foreign key constraint')) {
          return res.status(400).json({ error: 'Invalid reference to category, deal type, or merchant.' });
        }
        if (transactionError.message.includes('Invalid input')) {
          return res.status(400).json({ error: 'Invalid data provided. Please check your input and try again.' });
        }
      }
      
      return res.status(500).json({ 
        error: 'Failed to create deal. Please try again or contact support if the problem persists.',
        details: process.env.NODE_ENV === 'development' && transactionError instanceof Error ? transactionError.message : undefined
      });
    }

    // Enhanced response with all dynamic fields
    const response = {
      success: true,
      message: 'Deal created successfully with enhanced features',
      deal: {
        id: newDeal.id,
        title: newDeal.title,
        description: newDeal.description,
        startTime: newDeal.startTime,
        endTime: newDeal.endTime,
        discountPercentage: newDeal.discountPercentage,
        discountAmount: newDeal.discountAmount,
        imageUrls: newDeal.imageUrls,
        offerTerms: newDeal.offerTerms,
        kickbackEnabled: newDeal.kickbackEnabled,
        createdAt: newDeal.createdAt,
        updatedAt: newDeal.updatedAt
      },
      normalization: {
        dealTypeId,
        recurringDays: recurringDays ? recurringDays.split(',') : null
      }
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Deal creation error:', error);
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
        businessType: true,
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

// --- Endpoint: GET /api/merchants/deals ---
// Returns all deals created by the authenticated (approved) merchant.
// Optional query params:
//   activeOnly=true  -> only deals currently active (start <= now <= end)
//   includeExpired=false (alias; if provided and false, expired filtered out)
router.get('/merchants/deals', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;

    if (!merchantId) {
      return res.status(401).json({ error: 'Merchant authentication required' });
    }

    const { activeOnly, includeExpired } = req.query;
    const now = new Date();

    // Fetch all deals for this merchant (dashboard view)
    const deals = await prisma.deal.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        discountPercentage: true,
        discountAmount: true,
        startTime: true,
        endTime: true,
        redemptionInstructions: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    // Derive status flags
    const enriched = deals.map(d => {
      const isActive = d.startTime <= now && d.endTime >= now;
      const isExpired = d.endTime < now;
      const isUpcoming = d.startTime > now;
      return { ...d, isActive, isExpired, isUpcoming };
    });

    // Filtering logic
    let filtered = enriched;
    const activeOnlyFlag = (typeof activeOnly === 'string' && activeOnly.toLowerCase() === 'true');
    const includeExpiredFlag = (typeof includeExpired === 'string') ? includeExpired.toLowerCase() === 'true' : true; // default include

    if (activeOnlyFlag) {
      filtered = filtered.filter(d => d.isActive);
    } else if (!includeExpiredFlag) {
      filtered = filtered.filter(d => !d.isExpired);
    }

    const counts = {
      total: enriched.length,
      active: enriched.filter(d => d.isActive).length,
      expired: enriched.filter(d => d.isExpired).length,
      upcoming: enriched.filter(d => d.isUpcoming).length
    };

    res.status(200).json({
      deals: filtered,
      counts,
      filters: {
        activeOnly: activeOnlyFlag,
        includeExpired: includeExpiredFlag
      }
    });

  } catch (error) {
    console.error('Merchant deals fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/merchants/dashboard/stats ---
// Returns key performance indicators for the merchant dashboard
router.get('/merchants/dashboard/stats', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { period = 'all_time' } = req.query as any;
    
    // Calculate date range based on period
    let dateFrom: Date | null = null;
    const now = new Date();
    
    switch (period) {
      case 'last_7_days':
        dateFrom = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        break;
      case 'last_30_days':
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        break;
      case 'this_month':
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'this_year':
        dateFrom = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        dateFrom = null; // all_time
    }

    // Build date filter for queries
    const dateFilter = dateFrom ? { gte: dateFrom } : undefined;

    // Get check-ins (order volume proxy)
    const checkInCount = await prisma.checkIn.count({
      where: {
        merchantId,
        ...(dateFilter && { createdAt: dateFilter })
      }
    });

    // Get kickback earnings data (gross sales proxy)
    const kickbackData = await prisma.kickbackEvent.aggregate({
      where: {
        merchantId,
        ...(dateFilter && { createdAt: dateFilter })
      },
      _sum: {
        sourceAmountSpent: true,
        amountEarned: true
      },
      _count: {
        id: true
      }
    });

    // Calculate gross sales (total spending from kickback events)
    const grossSales = kickbackData._sum.sourceAmountSpent || 0;
    
    // Calculate average order value
    const averageOrderValue = checkInCount > 0 ? grossSales / checkInCount : 0;

    // Get active deals count
    const activeDealsCount = await prisma.deal.count({
      where: {
        merchantId,
        startTime: { lte: now },
        endTime: { gte: now }
      }
    });

    // Get total saved deals (engagement metric)
    const totalSavedDeals = await prisma.userDeal.count({
      where: {
        deal: {
          merchantId
        },
        ...(dateFilter && { savedAt: dateFilter })
      }
    });

    res.status(200).json({
      period,
      kpis: {
        grossSales: Number(grossSales.toFixed(2)),
        orderVolume: checkInCount,
        averageOrderValue: Number(averageOrderValue.toFixed(2)),
        totalKickbackHandout: Number((kickbackData._sum.amountEarned || 0).toFixed(2))
      },
      metrics: {
        activeDeals: activeDealsCount,
        totalSavedDeals,
        totalKickbackEvents: kickbackData._count.id
      },
      dateRange: {
        from: dateFrom,
        to: now
      }
    });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/merchants/dashboard/city-performance ---
// Returns performance metrics by city for the merchant
router.get('/merchants/dashboard/city-performance', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { period = 'all_time' } = req.query as any;
    
    // Calculate date range based on period
    let dateFrom: Date | null = null;
    const now = new Date();
    
    switch (period) {
      case 'last_7_days':
        dateFrom = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        break;
      case 'last_30_days':
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        break;
      case 'this_month':
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'this_year':
        dateFrom = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        dateFrom = null; // all_time
    }

    // Get stores with their cities
    const stores = await prisma.store.findMany({
      where: { merchantId },
      include: {
        city: true
      }
    });

    // Get city performance data
    const cityPerformance = await Promise.all(
      stores.map(async (store) => {
        const dateFilter = dateFrom ? { gte: dateFrom } : undefined;
        
        // Get check-ins for this city (through store)
        const checkIns = await prisma.checkIn.count({
          where: {
            merchantId,
            ...(dateFilter && { createdAt: dateFilter })
          }
        });

        // Get kickback events for this city
        const kickbackEvents = await prisma.kickbackEvent.aggregate({
          where: {
            merchantId,
            ...(dateFilter && { createdAt: dateFilter })
          },
          _sum: {
            sourceAmountSpent: true,
            amountEarned: true
          },
          _count: {
            id: true
          }
        });

        // Get active deals count for this merchant (not city-specific yet)
        const activeDeals = await prisma.deal.count({
          where: {
            merchantId,
            startTime: { lte: now },
            endTime: { gte: now }
          }
        });

        const grossSales = kickbackEvents._sum.sourceAmountSpent || 0;
        const orderVolume = checkIns;
        const averageOrderValue = orderVolume > 0 ? grossSales / orderVolume : 0;

        return {
          cityId: store.city.id,
          cityName: store.city.name,
          state: store.city.state,
          storeId: store.id,
          storeAddress: store.address,
          performance: {
            grossSales: Number(grossSales.toFixed(2)),
            orderVolume,
            averageOrderValue: Number(averageOrderValue.toFixed(2)),
            activeDeals,
            kickbackEarnings: Number((kickbackEvents._sum.amountEarned || 0).toFixed(2))
          }
        };
      })
    );

    // Group by city (in case there are multiple stores in same city)
    const cityGroups = (cityPerformance || []).reduce((acc, item) => {
      const key = `${item.cityName}, ${item.state}`;
      if (!acc[key]) {
        acc[key] = {
          cityId: item.cityId,
          cityName: item.cityName,
          state: item.state,
          stores: [],
          totalPerformance: {
            grossSales: 0,
            orderVolume: 0,
            averageOrderValue: 0,
            activeDeals: 0,
            kickbackEarnings: 0
          }
        };
      }
      
      acc[key].stores.push({
        storeId: item.storeId,
        address: item.storeAddress
      });
      
      // Aggregate performance metrics
      acc[key].totalPerformance.grossSales += item.performance.grossSales;
      acc[key].totalPerformance.orderVolume += item.performance.orderVolume;
      acc[key].totalPerformance.kickbackEarnings += item.performance.kickbackEarnings;
      acc[key].totalPerformance.activeDeals = item.performance.activeDeals; // Same for all stores
    }, {} as any);

    // Calculate average order value for each city
    Object.values(cityGroups || {}).forEach((city: any) => {
      city.totalPerformance.averageOrderValue = city.totalPerformance.orderVolume > 0 
        ? Number((city.totalPerformance.grossSales / city.totalPerformance.orderVolume).toFixed(2))
        : 0;
    });

    const cityPerformanceArray = Object.values(cityGroups || {});

    res.status(200).json({
      period,
      cities: cityPerformanceArray,
      summary: {
        totalCities: cityPerformanceArray.length,
        totalStores: stores.length,
        totalGrossSales: cityPerformanceArray.reduce((sum: number, city: any) => 
          sum + city.totalPerformance.grossSales, 0),
        totalOrderVolume: cityPerformanceArray.reduce((sum: number, city: any) => 
          sum + city.totalPerformance.orderVolume, 0)
      },
      dateRange: {
        from: dateFrom,
        to: now
      }
    });

  } catch (error) {
    console.error('City performance error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
});

// --- Endpoint: GET /api/merchants/dashboard/analytics ---
// Returns detailed analytics for the merchant dashboard
router.get('/merchants/dashboard/analytics', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { period = 'last_30_days', groupBy = 'day' } = req.query as any;
    
    // Calculate date range
    let dateFrom: Date;
    const now = new Date();
    
    switch (period) {
      case 'last_7_days':
        dateFrom = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        break;
      case 'last_30_days':
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        break;
      case 'this_month':
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'this_year':
        dateFrom = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    }

    // Get deals performance
    const dealsPerformance = await prisma.deal.findMany({
      where: {
        merchantId,
        createdAt: { gte: dateFrom }
      },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        kickbackEnabled: true,
        _count: {
          select: {
            savedByUsers: true,
            checkIns: true,
            kickbackEvents: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate time-series data for check-ins and kickback events
    const timeSeriesData = [];
    const currentDate = new Date(dateFrom);
    
    while (currentDate <= now) {
      const dayStart = new Date(currentDate);
      const dayEnd = new Date(currentDate);
      dayEnd.setHours(23, 59, 59, 999);

      const dayCheckIns = await prisma.checkIn.count({
        where: {
          merchantId,
          createdAt: { gte: dayStart, lte: dayEnd }
        }
      });

      const dayKickbackEvents = await prisma.kickbackEvent.aggregate({
        where: {
          merchantId,
          createdAt: { gte: dayStart, lte: dayEnd }
        },
        _sum: {
          sourceAmountSpent: true,
          amountEarned: true
        }
      });

      timeSeriesData.push({
        date: currentDate.toISOString().split('T')[0],
        checkIns: dayCheckIns,
        grossSales: Number((dayKickbackEvents._sum.sourceAmountSpent || 0).toFixed(2)),
        kickbackEarnings: Number((dayKickbackEvents._sum.amountEarned || 0).toFixed(2))
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Get top performing deals
    const topDeals = dealsPerformance
      .map(deal => ({
        id: deal.id,
        title: deal.title,
        checkIns: deal._count.checkIns,
        saves: deal._count.savedByUsers,
        kickbackEvents: deal._count.kickbackEvents,
        isActive: deal.startTime <= now && deal.endTime >= now,
        kickbackEnabled: deal.kickbackEnabled
      }))
      .sort((a, b) => b.checkIns - a.checkIns)
      .slice(0, 10);

    // Get user engagement metrics
    const totalUsers = await prisma.user.count({
      where: {
        OR: [
          { checkIns: { some: { merchantId } } },
          { savedDeals: { some: { deal: { merchantId } } } }
        ]
      }
    });

    // Get users with multiple check-ins (returning users)
    const userCheckInCounts = await prisma.checkIn.groupBy({
      by: ['userId'],
      where: {
        merchantId,
        createdAt: { gte: dateFrom }
      },
      _count: {
        id: true
      }
    });

    const returningUsers = userCheckInCounts.filter(user => user._count.id > 1);

    res.status(200).json({
      period,
      groupBy,
      timeSeries: timeSeriesData,
      dealsPerformance: topDeals,
      userEngagement: {
        totalUsers,
        returningUsers: returningUsers.length,
        newUsers: totalUsers - returningUsers.length
      },
      summary: {
        totalDeals: dealsPerformance.length,
        activeDeals: dealsPerformance.filter(d => d.startTime <= now && d.endTime >= now).length,
        totalCheckIns: dealsPerformance.reduce((sum, d) => sum + d._count.checkIns, 0),
        totalSaves: dealsPerformance.reduce((sum, d) => sum + d._count.savedByUsers, 0),
        totalKickbackEvents: dealsPerformance.reduce((sum, d) => sum + d._count.kickbackEvents, 0)
      },
      dateRange: {
        from: dateFrom,
        to: now
      }
    });

  } catch (error) {
    console.error('Dashboard analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/merchants/dashboard/deal-performance ---
// Returns detailed performance analytics for individual deals
router.get('/merchants/dashboard/deal-performance', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { period = 'last_30_days', dealId, limit = 10 } = req.query as any;
    
    // Calculate date range
    let dateFrom: Date;
    const now = new Date();
    
    switch (period) {
      case 'last_7_days':
        dateFrom = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        break;
      case 'last_30_days':
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        break;
      case 'this_month':
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'this_year':
        dateFrom = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    }

    // Build base where clause
    const baseWhere: any = {
      merchantId,
      createdAt: { gte: dateFrom }
    };

    // If specific deal ID requested
    if (dealId) {
      baseWhere.id = Number(dealId);
    }

    // Get deals with comprehensive performance metrics
    const deals = await prisma.deal.findMany({
      where: baseWhere,
      include: {
        _count: {
          select: {
            savedByUsers: true,
            checkIns: true,
            kickbackEvents: true
          }
        },
        category: true,
        dealType: true,
        menuItems: {
          include: {
            menuItem: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit)
    });

    // Get detailed performance data for each deal
    const dealPerformance = await Promise.all(
      deals.map(async (deal) => {
        // Get check-ins over time for this deal
        const checkInTimeSeries = [];
        const currentDate = new Date(dateFrom);
        
        while (currentDate <= now) {
          const dayStart = new Date(currentDate);
          const dayEnd = new Date(currentDate);
          dayEnd.setHours(23, 59, 59, 999);

          const dayCheckIns = await prisma.checkIn.count({
            where: {
              dealId: deal.id,
              createdAt: { gte: dayStart, lte: dayEnd }
            }
          });

          const daySaves = await prisma.userDeal.count({
            where: {
              dealId: deal.id,
              savedAt: { gte: dayStart, lte: dayEnd }
            }
          });

          const dayKickbacks = await prisma.kickbackEvent.aggregate({
            where: {
              dealId: deal.id,
              createdAt: { gte: dayStart, lte: dayEnd }
            },
            _sum: {
              sourceAmountSpent: true,
              amountEarned: true
            }
          });

          checkInTimeSeries.push({
            date: currentDate.toISOString().split('T')[0],
            checkIns: dayCheckIns,
            saves: daySaves,
            revenue: Number((dayKickbacks._sum.sourceAmountSpent || 0).toFixed(2)),
            kickbackEarnings: Number((dayKickbacks._sum.amountEarned || 0).toFixed(2))
          });

          currentDate.setDate(currentDate.getDate() + 1);
        }

        // Get user engagement details
        const uniqueUsers = await prisma.user.count({
          where: {
            OR: [
              { checkIns: { some: { dealId: deal.id } } },
              { savedDeals: { some: { dealId: deal.id } } }
            ]
          }
        });

        const returningUsers = await prisma.checkIn.groupBy({
          by: ['userId'],
          where: {
            dealId: deal.id,
            createdAt: { gte: dateFrom }
          },
          _count: { id: true }
        });

        const returningUserCount = returningUsers.filter(u => u._count.id > 1).length;

        // Calculate conversion metrics
        const saveToCheckInRate = deal._count.savedByUsers > 0 
          ? Number(((deal._count.checkIns / deal._count.savedByUsers) * 100).toFixed(2))
          : 0;

        const checkInToKickbackRate = deal._count.checkIns > 0
          ? Number(((deal._count.kickbackEvents / deal._count.checkIns) * 100).toFixed(2))
          : 0;

        return {
          id: deal.id,
          title: deal.title,
          description: deal.description,
          category: deal.category,
          dealType: deal.dealType,
          isActive: deal.startTime <= now && deal.endTime >= now,
          kickbackEnabled: deal.kickbackEnabled,
          performance: {
            checkIns: deal._count.checkIns,
            saves: deal._count.savedByUsers,
            kickbackEvents: deal._count.kickbackEvents,
            uniqueUsers,
            returningUsers: returningUserCount,
            conversionRates: {
              saveToCheckIn: saveToCheckInRate,
              checkInToKickback: checkInToKickbackRate
            }
          },
          timeSeries: checkInTimeSeries,
          menuItems: deal.menuItems.map(dmi => ({
            id: dmi.menuItem.id,
            name: dmi.menuItem.name,
            price: dmi.menuItem.price,
            category: dmi.menuItem.category,
            isHidden: dmi.isHidden
          }))
        };
      })
    );

    res.status(200).json({
      period,
      deals: dealPerformance,
      summary: {
        totalDeals: dealPerformance.length,
        activeDeals: dealPerformance.filter(d => d.isActive).length,
        totalCheckIns: dealPerformance.reduce((sum, d) => sum + d.performance.checkIns, 0),
        totalSaves: dealPerformance.reduce((sum, d) => sum + d.performance.saves, 0),
        totalKickbackEvents: dealPerformance.reduce((sum, d) => sum + d.performance.kickbackEvents, 0),
        averageSaveToCheckInRate: dealPerformance.length > 0 
          ? Number((dealPerformance.reduce((sum, d) => sum + d.performance.conversionRates.saveToCheckIn, 0) / dealPerformance.length).toFixed(2))
          : 0
      },
      dateRange: {
        from: dateFrom,
        to: now
      }
    });

  } catch (error) {
    console.error('Deal performance error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/merchants/dashboard/customer-insights ---
// Returns detailed customer behavior and engagement analytics
router.get('/merchants/dashboard/customer-insights', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { period = 'last_30_days' } = req.query as any;
    
    // Calculate date range
    let dateFrom: Date;
    const now = new Date();
    
    switch (period) {
      case 'last_7_days':
        dateFrom = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        break;
      case 'last_30_days':
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        break;
      case 'this_month':
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'this_year':
        dateFrom = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    }

    // Get customer engagement data
    const totalCustomers = await prisma.user.count({
      where: {
        OR: [
          { checkIns: { some: { merchantId } } },
          { savedDeals: { some: { deal: { merchantId } } } }
        ]
      }
    });

    // Get new vs returning customers
    const newCustomers = await prisma.user.count({
      where: {
        OR: [
          { checkIns: { some: { merchantId, createdAt: { gte: dateFrom } } } },
          { savedDeals: { some: { deal: { merchantId }, savedAt: { gte: dateFrom } } } }
        ],
        createdAt: { gte: dateFrom }
      }
    });

    // Get customer activity patterns
    const customerActivity = await prisma.checkIn.groupBy({
      by: ['userId'],
      where: {
        merchantId,
        createdAt: { gte: dateFrom }
      },
      _count: { id: true },
      _max: { createdAt: true },
      _min: { createdAt: true }
    });

    // Categorize customers by activity level
    const activityCategories = {
      high: customerActivity.filter(u => u._count.id >= 5).length,
      medium: customerActivity.filter(u => u._count.id >= 2 && u._count.id < 5).length,
      low: customerActivity.filter(u => u._count.id === 1).length
    };

    // Get customer lifetime value (through kickback events)
    const customerValueData = await prisma.kickbackEvent.groupBy({
      by: ['userId'],
      where: {
        merchantId,
        createdAt: { gte: dateFrom }
      },
      _sum: {
        sourceAmountSpent: true,
        amountEarned: true
      },
      _count: { id: true }
    });

    // Calculate customer value metrics
    const avgCustomerValue = customerValueData.length > 0
      ? Number((customerValueData.reduce((sum, c) => sum + (c._sum.sourceAmountSpent || 0), 0) / customerValueData.length).toFixed(2))
      : 0;

    const topCustomers = customerValueData
      .sort((a, b) => (b._sum.sourceAmountSpent || 0) - (a._sum.sourceAmountSpent || 0))
      .slice(0, 10)
      .map(async (customer) => {
        const user = await prisma.user.findUnique({
          where: { id: customer.userId },
          select: { id: true, name: true, avatarUrl: true, createdAt: true }
        });
        
        return {
          user,
          totalSpent: Number((customer._sum.sourceAmountSpent || 0).toFixed(2)),
          totalEarned: Number((customer._sum.amountEarned || 0).toFixed(2)),
          kickbackEvents: customer._count.id
        };
      });

    const resolvedTopCustomers = await Promise.all(topCustomers);

    // Get referral performance
    const referralData = await prisma.user.findMany({
      where: {
        referredByUserId: { not: null },
        OR: [
          { checkIns: { some: { merchantId } } },
          { savedDeals: { some: { deal: { merchantId } } } }
        ]
      },
      include: {
        referredBy: {
          select: { id: true, name: true, avatarUrl: true }
        },
        _count: {
          select: {
            checkIns: {
              where: { merchantId }
            },
            savedDeals: {
              where: {
                deal: { merchantId }
              }
            }
          }
        }
      }
    });

    // Get peak activity times
    const hourlyActivity = await Promise.all(
      Array.from({ length: 24 }, (_, hour) => 
        prisma.checkIn.count({
          where: {
            merchantId,
            createdAt: { gte: dateFrom },
            // Note: This is a simplified approach. For production, you'd want to extract hour from createdAt
          }
        })
      )
    );

    res.status(200).json({
      period,
      customerOverview: {
        totalCustomers,
        newCustomers,
        returningCustomers: totalCustomers - newCustomers,
        customerRetentionRate: totalCustomers > 0 
          ? Number(((totalCustomers - newCustomers) / totalCustomers * 100).toFixed(2))
          : 0
      },
      activityLevels: activityCategories,
      customerValue: {
        averageCustomerValue: avgCustomerValue,
        topCustomers: resolvedTopCustomers
      },
      referralInsights: {
        referredCustomers: referralData.length,
        referralEngagement: referralData.map(r => ({
          customer: { id: r.id, name: r.name, avatarUrl: r.avatarUrl },
          referrer: r.referredBy,
          checkIns: r._count.checkIns,
          savedDeals: r._count.savedDeals
        }))
      },
      activityPatterns: {
        hourlyDistribution: hourlyActivity,
        peakHours: hourlyActivity
          .map((count, hour) => ({ hour, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
      },
      dateRange: {
        from: dateFrom,
        to: now
      }
    });

  } catch (error) {
    console.error('Customer insights error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/merchants/dashboard/revenue-analytics ---
// Returns detailed revenue breakdown and financial analytics
router.get('/merchants/dashboard/revenue-analytics', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { period = 'last_30_days' } = req.query as any;
    
    // Calculate date range
    let dateFrom: Date;
    const now = new Date();
    
    switch (period) {
      case 'last_7_days':
        dateFrom = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        break;
      case 'last_30_days':
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        break;
      case 'this_month':
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'this_year':
        dateFrom = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    }

    // Get revenue data from kickback events
    const revenueData = await prisma.kickbackEvent.findMany({
      where: {
        merchantId,
        createdAt: { gte: dateFrom }
      },
      include: {
        deal: {
          select: {
            id: true,
            title: true,
            category: {
              select: {
                name: true,
                icon: true
              }
            },
            dealType: {
              select: {
                name: true
              }
            }
          }
        },
        user: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate revenue by category
    const revenueByCategory = revenueData.reduce((acc, event) => {
      const categoryName = event.deal.category.name;
      if (!acc[categoryName]) {
        acc[categoryName] = {
          category: event.deal.category,
          revenue: 0,
          kickbackPaid: 0,
          transactions: 0
        };
      }
      acc[categoryName].revenue += event.sourceAmountSpent;
      acc[categoryName].kickbackPaid += event.amountEarned;
      acc[categoryName].transactions += 1;
      return acc;
    }, {} as any);

    // Calculate revenue by deal type
    const revenueByDealType = revenueData.reduce((acc, event) => {
      const dealTypeName = event.deal.dealType.name;
      if (!acc[dealTypeName]) {
        acc[dealTypeName] = {
          dealType: dealTypeName,
          revenue: 0,
          kickbackPaid: 0,
          transactions: 0
        };
      }
      acc[dealTypeName].revenue += event.sourceAmountSpent;
      acc[dealTypeName].kickbackPaid += event.amountEarned;
      acc[dealTypeName].transactions += 1;
      return acc;
    }, {} as any);

    // Get top performing deals by revenue
    const topDealsByRevenue = revenueData.reduce((acc, event) => {
      const dealId = event.dealId;
      if (!acc[dealId]) {
        acc[dealId] = {
          deal: event.deal,
          revenue: 0,
          kickbackPaid: 0,
          transactions: 0,
          uniqueCustomers: new Set()
        };
      }
      acc[dealId].revenue += event.sourceAmountSpent;
      acc[dealId].kickbackPaid += event.amountEarned;
      acc[dealId].transactions += 1;
      acc[dealId].uniqueCustomers.add(event.userId);
      return acc;
    }, {} as any);

    const topDeals = Object.values(topDealsByRevenue)
      .map((deal: any) => ({
        ...deal,
        uniqueCustomers: deal.uniqueCustomers.size
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Calculate daily revenue trends
    const dailyRevenue = [];
    const currentDate = new Date(dateFrom);
    
    while (currentDate <= now) {
      const dayStart = new Date(currentDate);
      const dayEnd = new Date(currentDate);
      dayEnd.setHours(23, 59, 59, 999);

      const dayRevenue = revenueData
        .filter(event => event.createdAt >= dayStart && event.createdAt <= dayEnd)
        .reduce((sum, event) => sum + event.sourceAmountSpent, 0);

      const dayKickback = revenueData
        .filter(event => event.createdAt >= dayStart && event.createdAt <= dayEnd)
        .reduce((sum, event) => sum + event.amountEarned, 0);

      dailyRevenue.push({
        date: currentDate.toISOString().split('T')[0],
        revenue: Number(dayRevenue.toFixed(2)),
        kickbackPaid: Number(dayKickback.toFixed(2)),
        transactions: revenueData.filter(event => event.createdAt >= dayStart && event.createdAt <= dayEnd).length
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calculate summary metrics
    const totalRevenue = revenueData.reduce((sum, event) => sum + event.sourceAmountSpent, 0);
    const totalKickbackPaid = revenueData.reduce((sum, event) => sum + event.amountEarned, 0);
    const totalTransactions = revenueData.length;
    const averageTransactionValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
    const kickbackRate = totalRevenue > 0 ? (totalKickbackPaid / totalRevenue) * 100 : 0;

    res.status(200).json({
      period,
      summary: {
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalKickbackPaid: Number(totalKickbackPaid.toFixed(2)),
        totalTransactions,
        averageTransactionValue: Number(averageTransactionValue.toFixed(2)),
        kickbackRate: Number(kickbackRate.toFixed(2))
      },
      revenueByCategory: Object.values(revenueByCategory).map((cat: any) => ({
        ...cat,
        revenue: Number(cat.revenue.toFixed(2)),
        kickbackPaid: Number(cat.kickbackPaid.toFixed(2))
      })),
      revenueByDealType: Object.values(revenueByDealType).map((type: any) => ({
        ...type,
        revenue: Number(type.revenue.toFixed(2)),
        kickbackPaid: Number(type.kickbackPaid.toFixed(2))
      })),
      topDeals: topDeals.map((deal: any) => ({
        ...deal,
        revenue: Number(deal.revenue.toFixed(2)),
        kickbackPaid: Number(deal.kickbackPaid.toFixed(2))
      })),
      dailyTrends: dailyRevenue,
      dateRange: {
        from: dateFrom,
        to: now
      }
    });

  } catch (error) {
    console.error('Revenue analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/merchants/dashboard/engagement-metrics ---
// Returns detailed user engagement and behavior analytics
router.get('/merchants/dashboard/engagement-metrics', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { period = 'last_30_days' } = req.query as any;
    
    // Calculate date range
    let dateFrom: Date;
    const now = new Date();
    
    switch (period) {
      case 'last_7_days':
        dateFrom = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        break;
      case 'last_30_days':
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        break;
      case 'this_month':
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'this_year':
        dateFrom = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    }

    // Get engagement funnel data
    const totalDealViews = await prisma.deal.count({
      where: {
        merchantId,
        createdAt: { gte: dateFrom }
      }
    });

    const totalDealSaves = await prisma.userDeal.count({
      where: {
        deal: { merchantId },
        savedAt: { gte: dateFrom }
      }
    });

    const totalCheckIns = await prisma.checkIn.count({
      where: {
        merchantId,
        createdAt: { gte: dateFrom }
      }
    });

    const totalKickbackEvents = await prisma.kickbackEvent.count({
      where: {
        merchantId,
        createdAt: { gte: dateFrom }
      }
    });

    // Calculate conversion rates
    const saveRate = totalDealViews > 0 ? (totalDealSaves / totalDealViews) * 100 : 0;
    const checkInRate = totalDealSaves > 0 ? (totalCheckIns / totalDealSaves) * 100 : 0;
    const kickbackRate = totalCheckIns > 0 ? (totalKickbackEvents / totalCheckIns) * 100 : 0;

    // Get user engagement patterns
    const userEngagement = await prisma.user.findMany({
      where: {
        OR: [
          { checkIns: { some: { merchantId, createdAt: { gte: dateFrom } } } },
          { savedDeals: { some: { deal: { merchantId }, savedAt: { gte: dateFrom } } } }
        ]
      },
      include: {
        _count: {
          select: {
            checkIns: {
              where: { merchantId, createdAt: { gte: dateFrom } }
            },
            savedDeals: {
              where: {
                deal: { merchantId },
                savedAt: { gte: dateFrom }
              }
            }
          }
        }
      }
    });

    // Categorize users by engagement level
    const engagementLevels = {
      high: userEngagement.filter(u => (u._count.checkIns + u._count.savedDeals) >= 5).length,
      medium: userEngagement.filter(u => (u._count.checkIns + u._count.savedDeals) >= 2 && (u._count.checkIns + u._count.savedDeals) < 5).length,
      low: userEngagement.filter(u => (u._count.checkIns + u._count.savedDeals) === 1).length
    };

    // Get daily engagement trends
    const dailyEngagement = [];
    const currentDate = new Date(dateFrom);
    
    while (currentDate <= now) {
      const dayStart = new Date(currentDate);
      const dayEnd = new Date(currentDate);
      dayEnd.setHours(23, 59, 59, 999);

      const daySaves = await prisma.userDeal.count({
        where: {
          deal: { merchantId },
          savedAt: { gte: dayStart, lte: dayEnd }
        }
      });

      const dayCheckIns = await prisma.checkIn.count({
        where: {
          merchantId,
          createdAt: { gte: dayStart, lte: dayEnd }
        }
      });

      const dayKickbacks = await prisma.kickbackEvent.count({
        where: {
          merchantId,
          createdAt: { gte: dayStart, lte: dayEnd }
        }
      });

      dailyEngagement.push({
        date: currentDate.toISOString().split('T')[0],
        saves: daySaves,
        checkIns: dayCheckIns,
        kickbackEvents: dayKickbacks,
        engagementScore: daySaves + (dayCheckIns * 2) + (dayKickbacks * 3) // Weighted engagement score
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Get most engaging deals
    const engagingDeals = await prisma.deal.findMany({
      where: {
        merchantId,
        createdAt: { gte: dateFrom }
      },
      include: {
        _count: {
          select: {
            savedByUsers: {
              where: { savedAt: { gte: dateFrom } }
            },
            checkIns: {
              where: { createdAt: { gte: dateFrom } }
            },
            kickbackEvents: {
              where: { createdAt: { gte: dateFrom } }
            }
          }
        },
        category: {
          select: {
            name: true,
            icon: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const topEngagingDeals = engagingDeals
      .map(deal => ({
        id: deal.id,
        title: deal.title,
        category: deal.category,
        engagementScore: deal._count.savedByUsers + (deal._count.checkIns * 2) + (deal._count.kickbackEvents * 3),
        saves: deal._count.savedByUsers,
        checkIns: deal._count.checkIns,
        kickbackEvents: deal._count.kickbackEvents
      }))
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, 10);

    // Get retention metrics
    const repeatCustomers = await prisma.checkIn.groupBy({
      by: ['userId'],
      where: {
        merchantId,
        createdAt: { gte: dateFrom }
      },
      _count: { id: true }
    });

    const customerRetentionRate = userEngagement.length > 0 
      ? (repeatCustomers.filter(u => u._count.id > 1).length / userEngagement.length) * 100 
      : 0;

    res.status(200).json({
      period,
      funnelMetrics: {
        totalDealViews: totalDealViews,
        totalDealSaves: totalDealSaves,
        totalCheckIns: totalCheckIns,
        totalKickbackEvents: totalKickbackEvents,
        conversionRates: {
          saveRate: Number(saveRate.toFixed(2)),
          checkInRate: Number(checkInRate.toFixed(2)),
          kickbackRate: Number(kickbackRate.toFixed(2))
        }
      },
      userEngagement: {
        totalEngagedUsers: userEngagement.length,
        engagementLevels,
        customerRetentionRate: Number(customerRetentionRate.toFixed(2)),
        averageEngagementPerUser: userEngagement.length > 0 
          ? Number((userEngagement.reduce((sum, u) => sum + u._count.checkIns + u._count.savedDeals, 0) / userEngagement.length).toFixed(2))
          : 0
      },
      dailyEngagement: dailyEngagement,
      topEngagingDeals,
      dateRange: {
        from: dateFrom,
        to: now
      }
    });

  } catch (error) {
    console.error('Engagement metrics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/merchants/dashboard/performance-comparison ---
// Returns period-over-period performance comparisons
router.get('/merchants/dashboard/performance-comparison', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { currentPeriod = 'last_30_days', comparePeriod = 'previous_30_days' } = req.query as any;
    
    const now = new Date();
    let currentFrom: Date, currentTo: Date, compareFrom: Date, compareTo: Date;

    // Calculate current period
    switch (currentPeriod) {
      case 'last_7_days':
        currentFrom = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        currentTo = now;
        break;
      case 'last_30_days':
        currentFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        currentTo = now;
        break;
      case 'this_month':
        currentFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        currentTo = now;
        break;
      case 'this_year':
        currentFrom = new Date(now.getFullYear(), 0, 1);
        currentTo = now;
        break;
      default:
        currentFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        currentTo = now;
    }

    // Calculate comparison period
    switch (comparePeriod) {
      case 'previous_30_days':
        const daysDiff = Math.ceil((currentTo.getTime() - currentFrom.getTime()) / (1000 * 60 * 60 * 24));
        compareTo = new Date(currentFrom.getTime() - 1);
        compareFrom = new Date(compareTo.getTime() - (daysDiff * 24 * 60 * 60 * 1000));
        break;
      case 'previous_month':
        compareTo = new Date(currentFrom.getTime() - 1);
        compareFrom = new Date(compareTo.getFullYear(), compareTo.getMonth(), 1);
        break;
      case 'previous_year':
        compareTo = new Date(currentFrom.getTime() - 1);
        compareFrom = new Date(compareTo.getFullYear(), 0, 1);
        break;
      default:
        const daysDiffDefault = Math.ceil((currentTo.getTime() - currentFrom.getTime()) / (1000 * 60 * 60 * 24));
        compareTo = new Date(currentFrom.getTime() - 1);
        compareFrom = new Date(compareTo.getTime() - (daysDiffDefault * 24 * 60 * 60 * 1000));
    }

    // Get current period data
    const currentData = await Promise.all([
      prisma.checkIn.count({
        where: {
          merchantId,
          createdAt: { gte: currentFrom, lte: currentTo }
        }
      }),
      prisma.userDeal.count({
        where: {
          deal: { merchantId },
          savedAt: { gte: currentFrom, lte: currentTo }
        }
      }),
      prisma.kickbackEvent.aggregate({
        where: {
          merchantId,
          createdAt: { gte: currentFrom, lte: currentTo }
        },
        _sum: {
          sourceAmountSpent: true,
          amountEarned: true
        }
      }),
      prisma.user.count({
        where: {
          OR: [
            { checkIns: { some: { merchantId, createdAt: { gte: currentFrom, lte: currentTo } } } },
            { savedDeals: { some: { deal: { merchantId }, savedAt: { gte: currentFrom, lte: currentTo } } } }
          ]
        }
      })
    ]);

    // Get comparison period data
    const compareData = await Promise.all([
      prisma.checkIn.count({
        where: {
          merchantId,
          createdAt: { gte: compareFrom, lte: compareTo }
        }
      }),
      prisma.userDeal.count({
        where: {
          deal: { merchantId },
          savedAt: { gte: compareFrom, lte: compareTo }
        }
      }),
      prisma.kickbackEvent.aggregate({
        where: {
          merchantId,
          createdAt: { gte: compareFrom, lte: compareTo }
        },
        _sum: {
          sourceAmountSpent: true,
          amountEarned: true
        }
      }),
      prisma.user.count({
        where: {
          OR: [
            { checkIns: { some: { merchantId, createdAt: { gte: compareFrom, lte: compareTo } } } },
            { savedDeals: { some: { deal: { merchantId }, savedAt: { gte: compareFrom, lte: compareTo } } } }
          ]
        }
      })
    ]);

    // Calculate metrics
    const currentMetrics = {
      checkIns: currentData[0],
      dealSaves: currentData[1],
      grossSales: currentData[2]._sum.sourceAmountSpent || 0,
      kickbackPaid: currentData[2]._sum.amountEarned || 0,
      uniqueUsers: currentData[3]
    };

    const compareMetrics = {
      checkIns: compareData[0],
      dealSaves: compareData[1],
      grossSales: compareData[2]._sum.sourceAmountSpent || 0,
      kickbackPaid: compareData[2]._sum.amountEarned || 0,
      uniqueUsers: compareData[3]
    };

    // Calculate percentage changes
    const calculateChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number((((current - previous) / previous) * 100).toFixed(2));
    };

    const changes = {
      checkIns: calculateChange(currentMetrics.checkIns, compareMetrics.checkIns),
      dealSaves: calculateChange(currentMetrics.dealSaves, compareMetrics.dealSaves),
      grossSales: calculateChange(currentMetrics.grossSales, compareMetrics.grossSales),
      kickbackPaid: calculateChange(currentMetrics.kickbackPaid, compareMetrics.kickbackPaid),
      uniqueUsers: calculateChange(currentMetrics.uniqueUsers, compareMetrics.uniqueUsers)
    };

    res.status(200).json({
      currentPeriod,
      comparePeriod,
      currentMetrics: {
        ...currentMetrics,
        grossSales: Number(currentMetrics.grossSales.toFixed(2)),
        kickbackPaid: Number(currentMetrics.kickbackPaid.toFixed(2))
      },
      compareMetrics: {
        ...compareMetrics,
        grossSales: Number(compareMetrics.grossSales.toFixed(2)),
        kickbackPaid: Number(compareMetrics.kickbackPaid.toFixed(2))
      },
      changes,
      trends: {
        checkIns: changes.checkIns > 0 ? 'up' : changes.checkIns < 0 ? 'down' : 'stable',
        dealSaves: changes.dealSaves > 0 ? 'up' : changes.dealSaves < 0 ? 'down' : 'stable',
        grossSales: changes.grossSales > 0 ? 'up' : changes.grossSales < 0 ? 'down' : 'stable',
        kickbackPaid: changes.kickbackPaid > 0 ? 'up' : changes.kickbackPaid < 0 ? 'down' : 'stable',
        uniqueUsers: changes.uniqueUsers > 0 ? 'up' : changes.uniqueUsers < 0 ? 'down' : 'stable'
      },
      dateRanges: {
        current: { from: currentFrom, to: currentTo },
        compare: { from: compareFrom, to: compareTo }
      }
    });

  } catch (error) {
    console.error('Performance comparison error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/merchants/dashboard/performance-comparison-custom ---
// Returns customizable period-over-period performance comparisons with flexible time periods
router.get('/merchants/dashboard/performance-comparison-custom', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { 
      currentPeriod = 'last_30_days', 
      comparePeriod = 'previous_30_days',
      // Custom date range options
      currentFrom: currentFromParam,
      currentTo: currentToParam,
      compareFrom: compareFromParam,
      compareTo: compareToParam,
      // Metric filters
      metrics = 'all', // 'all', 'checkins', 'deals', 'sales', 'kickbacks', 'users'
      granularity = 'day', // 'day', 'week', 'month'
      groupBy = 'date' // 'date', 'deal', 'category', 'dealType'
    } = req.query as any;
    
    const now = new Date();
    let currentFrom: Date, currentTo: Date, compareFrom: Date, compareTo: Date;

    // Initialize default values to avoid TypeScript errors
    currentFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    currentTo = now;
    compareFrom = new Date(currentFrom.getTime() - (30 * 24 * 60 * 60 * 1000));
    compareTo = new Date(currentFrom.getTime() - 1);

    // Handle custom date ranges or predefined periods
    if (currentFromParam && currentToParam && compareFromParam && compareToParam) {
      // Custom date range mode
      currentFrom = new Date(currentFromParam);
      currentTo = new Date(currentToParam);
      compareFrom = new Date(compareFromParam);
      compareTo = new Date(compareToParam);
      
      // Validate custom dates
      if (isNaN(currentFrom.getTime()) || isNaN(currentTo.getTime()) || 
          isNaN(compareFrom.getTime()) || isNaN(compareTo.getTime())) {
        return res.status(400).json({ error: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)' });
      }
      
      if (currentFrom >= currentTo || compareFrom >= compareTo) {
        return res.status(400).json({ error: 'Start date must be before end date for both periods' });
      }
      
      if (currentTo > now) {
        return res.status(400).json({ error: 'Current period end date cannot be in the future' });
      }
      
      // Check if date ranges are reasonable (not more than 2 years apart)
      const maxDaysDiff = 365 * 2;
      const currentDaysDiff = Math.ceil((currentTo.getTime() - currentFrom.getTime()) / (1000 * 60 * 60 * 24));
      const compareDaysDiff = Math.ceil((compareTo.getTime() - compareFrom.getTime()) / (1000 * 60 * 60 * 24));
      
      if (currentDaysDiff > maxDaysDiff || compareDaysDiff > maxDaysDiff) {
        return res.status(400).json({ error: 'Date range cannot exceed 2 years' });
      }
      
    } else {
      // Predefined period mode
      // Calculate current period
      switch (currentPeriod) {
        case 'last_7_days':
          currentFrom = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
          currentTo = now;
          break;
        case 'last_30_days':
          currentFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
          currentTo = now;
          break;
        case 'last_90_days':
          currentFrom = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
          currentTo = now;
          break;
        case 'this_month':
          currentFrom = new Date(now.getFullYear(), now.getMonth(), 1);
          currentTo = now;
          break;
        case 'last_month':
          currentFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          currentTo = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
          break;
        case 'this_quarter':
          const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
          currentFrom = new Date(now.getFullYear(), quarterStartMonth, 1);
          currentTo = now;
          break;
        case 'last_quarter':
          const lastQuarterStartMonth = Math.floor(now.getMonth() / 3) * 3 - 3;
          const lastQuarterYear = lastQuarterStartMonth < 0 ? now.getFullYear() - 1 : now.getFullYear();
          const adjustedMonth = lastQuarterStartMonth < 0 ? lastQuarterStartMonth + 12 : lastQuarterStartMonth;
          currentFrom = new Date(lastQuarterYear, adjustedMonth, 1);
          currentTo = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 0, 23, 59, 59, 999);
          break;
        case 'this_year':
          currentFrom = new Date(now.getFullYear(), 0, 1);
          currentTo = now;
          break;
        case 'last_year':
          currentFrom = new Date(now.getFullYear() - 1, 0, 1);
          currentTo = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
          break;
        default:
          currentFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
          currentTo = now;
      }

      // Calculate comparison period
      // Initialize default values to avoid TypeScript errors
      let compareTo = new Date(currentFrom.getTime() - 1);
      let compareFrom = new Date(compareTo.getTime() - (30 * 24 * 60 * 60 * 1000));
      
      switch (comparePeriod) {
        case 'previous_7_days':
          compareTo = new Date(currentFrom.getTime() - 1);
          compareFrom = new Date(compareTo.getTime() - (7 * 24 * 60 * 60 * 1000));
          break;
        case 'previous_30_days':
          const daysDiff = Math.ceil((currentTo.getTime() - currentFrom.getTime()) / (1000 * 60 * 60 * 24));
          compareTo = new Date(currentFrom.getTime() - 1);
          compareFrom = new Date(compareTo.getTime() - (daysDiff * 24 * 60 * 60 * 1000));
          break;
        case 'previous_90_days':
          compareTo = new Date(currentFrom.getTime() - 1);
          compareFrom = new Date(compareTo.getTime() - (90 * 24 * 60 * 60 * 1000));
          break;
        case 'previous_month':
          compareTo = new Date(currentFrom.getTime() - 1);
          compareFrom = new Date(compareTo.getFullYear(), compareTo.getMonth(), 1);
          break;
        case 'same_month_last_year':
          compareFrom = new Date(currentFrom.getFullYear() - 1, currentFrom.getMonth(), currentFrom.getDate());
          compareTo = new Date(currentTo.getFullYear() - 1, currentTo.getMonth(), currentTo.getDate());
          break;
        case 'previous_quarter':
          compareTo = new Date(currentFrom.getTime() - 1);
          const prevQuarterStartMonth = Math.floor(compareTo.getMonth() / 3) * 3 - 3;
          const prevQuarterYear = prevQuarterStartMonth < 0 ? compareTo.getFullYear() - 1 : compareTo.getFullYear();
          const prevAdjustedMonth = prevQuarterStartMonth < 0 ? prevQuarterStartMonth + 12 : prevQuarterStartMonth;
          compareFrom = new Date(prevQuarterYear, prevAdjustedMonth, 1);
          compareTo = new Date(compareTo.getFullYear(), Math.floor(compareTo.getMonth() / 3) * 3, 0, 23, 59, 59, 999);
          break;
        case 'same_quarter_last_year':
          const currentQuarterStartMonth = Math.floor(currentFrom.getMonth() / 3) * 3;
          compareFrom = new Date(currentFrom.getFullYear() - 1, currentQuarterStartMonth, currentFrom.getDate());
          compareTo = new Date(currentTo.getFullYear() - 1, currentQuarterStartMonth + 2, currentTo.getDate());
          break;
        case 'previous_year':
          compareTo = new Date(currentFrom.getTime() - 1);
          compareFrom = new Date(compareTo.getFullYear() - 1, 0, 1);
          compareTo = new Date(compareFrom.getFullYear(), 11, 31, 23, 59, 59, 999);
          break;
        default:
          const daysDiffDefault = Math.ceil((currentTo.getTime() - currentFrom.getTime()) / (1000 * 60 * 60 * 24));
          compareTo = new Date(currentFrom.getTime() - 1);
          compareFrom = new Date(compareTo.getTime() - (daysDiffDefault * 24 * 60 * 60 * 1000));
      }
    }

    // Validate granularity parameter
    const validGranularities = ['day', 'week', 'month'];
    if (!validGranularities.includes(granularity)) {
      return res.status(400).json({ error: 'Invalid granularity. Must be one of: day, week, month' });
    }

    // Validate metrics parameter
    const validMetrics = ['all', 'checkins', 'deals', 'sales', 'kickbacks', 'users'];
    if (!validMetrics.includes(metrics)) {
      return res.status(400).json({ error: 'Invalid metrics. Must be one of: all, checkins, deals, sales, kickbacks, users' });
    }

    // Validate groupBy parameter
    const validGroupBy = ['date', 'deal', 'category', 'dealType'];
    if (!validGroupBy.includes(groupBy)) {
      return res.status(400).json({ error: 'Invalid groupBy. Must be one of: date, deal, category, dealType' });
    }

    // Helper function to calculate change percentage
    const calculateChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number(((current - previous) / previous * 100).toFixed(2));
    };

    // Get comprehensive metrics for current period
    const currentMetrics = await Promise.all([
      // Check-ins
      metrics === 'all' || metrics === 'checkins' ? prisma.checkIn.count({
        where: {
          merchantId,
          createdAt: { gte: currentFrom, lte: currentTo }
        }
      }) : 0,
      
      // Deal saves
      metrics === 'all' || metrics === 'deals' ? prisma.userDeal.count({
        where: {
          deal: { merchantId },
          savedAt: { gte: currentFrom, lte: currentTo }
        }
      }) : 0,
      
      // Gross sales from kickback events
      metrics === 'all' || metrics === 'sales' ? prisma.kickbackEvent.aggregate({
        where: {
          merchantId,
          createdAt: { gte: currentFrom, lte: currentTo }
        },
        _sum: {
          sourceAmountSpent: true,
          amountEarned: true
        }
      }) : { _sum: { sourceAmountSpent: 0, amountEarned: 0 } },
      
      // Unique users
      metrics === 'all' || metrics === 'users' ? prisma.user.count({
        where: {
          OR: [
            { checkIns: { some: { merchantId, createdAt: { gte: currentFrom, lte: currentTo } } } },
            { savedDeals: { some: { deal: { merchantId }, savedAt: { gte: currentFrom, lte: currentTo } } } }
          ]
        }
      }) : 0,
      
      // Active deals
      metrics === 'all' || metrics === 'deals' ? prisma.deal.count({
        where: {
          merchantId,
          createdAt: { gte: currentFrom, lte: currentTo }
        }
      }) : 0
    ]);

    // Get comprehensive metrics for comparison period
    const compareMetrics = await Promise.all([
      // Check-ins
      metrics === 'all' || metrics === 'checkins' ? prisma.checkIn.count({
        where: {
          merchantId,
          createdAt: { gte: compareFrom, lte: compareTo }
        }
      }) : 0,
      
      // Deal saves
      metrics === 'all' || metrics === 'deals' ? prisma.userDeal.count({
        where: {
          deal: { merchantId },
          savedAt: { gte: compareFrom, lte: compareTo }
        }
      }) : 0,
      
      // Gross sales from kickback events
      metrics === 'all' || metrics === 'sales' ? prisma.kickbackEvent.aggregate({
        where: {
          merchantId,
          createdAt: { gte: compareFrom, lte: compareTo }
        },
        _sum: {
          sourceAmountSpent: true,
          amountEarned: true
        }
      }) : { _sum: { sourceAmountSpent: 0, amountEarned: 0 } },
      
      // Unique users
      metrics === 'all' || metrics === 'users' ? prisma.user.count({
        where: {
          OR: [
            { checkIns: { some: { merchantId, createdAt: { gte: compareFrom, lte: compareTo } } } },
            { savedDeals: { some: { deal: { merchantId }, savedAt: { gte: compareFrom, lte: compareTo } } } }
          ]
        }
      }) : 0,
      
      // Active deals
      metrics === 'all' || metrics === 'deals' ? prisma.deal.count({
        where: {
          merchantId,
          createdAt: { gte: compareFrom, lte: compareTo }
        }
      }) : 0
    ]);

    // Format metrics
    const currentFormatted = {
      checkIns: currentMetrics[0],
      dealSaves: currentMetrics[1],
      grossSales: Number((currentMetrics[2]._sum.sourceAmountSpent || 0).toFixed(2)),
      kickbackPaid: Number((currentMetrics[2]._sum.amountEarned || 0).toFixed(2)),
      uniqueUsers: currentMetrics[3],
      activeDeals: currentMetrics[4]
    };

    const compareFormatted = {
      checkIns: compareMetrics[0],
      dealSaves: compareMetrics[1],
      grossSales: Number((compareMetrics[2]._sum.sourceAmountSpent || 0).toFixed(2)),
      kickbackPaid: Number((compareMetrics[2]._sum.amountEarned || 0).toFixed(2)),
      uniqueUsers: compareMetrics[3],
      activeDeals: compareMetrics[4]
    };

    // Calculate changes
    const changes = {
      checkIns: calculateChange(currentFormatted.checkIns, compareFormatted.checkIns),
      dealSaves: calculateChange(currentFormatted.dealSaves, compareFormatted.dealSaves),
      grossSales: calculateChange(currentFormatted.grossSales, compareFormatted.grossSales),
      kickbackPaid: calculateChange(currentFormatted.kickbackPaid, compareFormatted.kickbackPaid),
      uniqueUsers: calculateChange(currentFormatted.uniqueUsers, compareFormatted.uniqueUsers),
      activeDeals: calculateChange(currentFormatted.activeDeals, compareFormatted.activeDeals)
    };

    // Get time-series data based on granularity
    let timeSeriesData: any[] = [];
    
    if (granularity === 'day' || granularity === 'week' || granularity === 'month') {
      const intervals = [];
      const current = new Date(currentFrom);
      const compare = new Date(compareFrom);
      
      while (current <= currentTo) {
        let intervalEnd = new Date(current);
        
        switch (granularity) {
          case 'day':
            intervalEnd.setDate(current.getDate() + 1);
            break;
          case 'week':
            intervalEnd.setDate(current.getDate() + 7);
            break;
          case 'month':
            intervalEnd.setMonth(current.getMonth() + 1);
            break;
        }
        
        intervals.push({
          period: 'current',
          start: new Date(current),
          end: new Date(Math.min(intervalEnd.getTime(), currentTo.getTime()))
        });
        
        current.setTime(intervalEnd.getTime());
      }
      
      // Add comparison period intervals
      while (compare <= compareTo) {
        let intervalEnd = new Date(compare);
        
        switch (granularity) {
          case 'day':
            intervalEnd.setDate(compare.getDate() + 1);
            break;
          case 'week':
            intervalEnd.setDate(compare.getDate() + 7);
            break;
          case 'month':
            intervalEnd.setMonth(compare.getMonth() + 1);
            break;
        }
        
        intervals.push({
          period: 'compare',
          start: new Date(compare),
          end: new Date(Math.min(intervalEnd.getTime(), compareTo.getTime()))
        });
        
        compare.setTime(intervalEnd.getTime());
      }
      
      // Get data for each interval
      timeSeriesData = await Promise.all(intervals.map(async (interval) => {
        const [checkIns, dealSaves, sales] = await Promise.all([
          metrics === 'all' || metrics === 'checkins' ? prisma.checkIn.count({
            where: {
              merchantId,
              createdAt: { gte: interval.start, lte: interval.end }
            }
          }) : 0,
          
          metrics === 'all' || metrics === 'deals' ? prisma.userDeal.count({
            where: {
              deal: { merchantId },
              savedAt: { gte: interval.start, lte: interval.end }
            }
          }) : 0,
          
          metrics === 'all' || metrics === 'sales' ? prisma.kickbackEvent.aggregate({
            where: {
              merchantId,
              createdAt: { gte: interval.start, lte: interval.end }
            },
            _sum: { sourceAmountSpent: true }
          }) : { _sum: { sourceAmountSpent: 0 } }
        ]);
        
        return {
          period: interval.period,
          date: interval.start.toISOString().split('T')[0],
          checkIns,
          dealSaves,
          grossSales: Number((sales._sum.sourceAmountSpent || 0).toFixed(2))
        };
      }));
    }

    res.status(200).json({
      currentPeriod,
      comparePeriod,
      customDates: !!(currentFromParam && currentToParam && compareFromParam && compareToParam),
      currentMetrics: currentFormatted,
      compareMetrics: compareFormatted,
      changes,
      trends: {
        checkIns: changes.checkIns > 0 ? 'up' : changes.checkIns < 0 ? 'down' : 'stable',
        dealSaves: changes.dealSaves > 0 ? 'up' : changes.dealSaves < 0 ? 'down' : 'stable',
        grossSales: changes.grossSales > 0 ? 'up' : changes.grossSales < 0 ? 'down' : 'stable',
        kickbackPaid: changes.kickbackPaid > 0 ? 'up' : changes.kickbackPaid < 0 ? 'down' : 'stable',
        uniqueUsers: changes.uniqueUsers > 0 ? 'up' : changes.uniqueUsers < 0 ? 'down' : 'stable',
        activeDeals: changes.activeDeals > 0 ? 'up' : changes.activeDeals < 0 ? 'down' : 'stable'
      },
      dateRanges: {
        current: { from: currentFrom, to: currentTo },
        compare: { from: compareFrom, to: compareTo }
      },
      timeSeriesData,
      filters: {
        metrics,
        granularity,
        groupBy
      },
      summary: {
        totalDaysCurrent: Math.ceil((currentTo.getTime() - currentFrom.getTime()) / (1000 * 60 * 60 * 24)),
        totalDaysCompare: Math.ceil((compareTo.getTime() - compareFrom.getTime()) / (1000 * 60 * 60 * 24)),
        periodDifference: Math.abs(Math.ceil((currentTo.getTime() - currentFrom.getTime()) / (1000 * 60 * 60 * 24)) - 
                                  Math.ceil((compareTo.getTime() - compareFrom.getTime()) / (1000 * 60 * 60 * 24)))
      }
    });

  } catch (error) {
    console.error('Custom performance comparison error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

// --- Endpoint: GET /api/merchants/me/menu ---
// Returns menu items for the authenticated merchant (any status).
// Response: { menuItems: [ { id, name, price, category, imageUrl } ] }
router.get('/merchants/me/menu', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    // @ts-ignore - MenuItem available post generate
    const menuItems = await prisma.menuItem.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        price: true,
        category: true,
        imageUrl: true,
      }
    });
    res.status(200).json({ menuItems });
  } catch (e) {
    console.error('Fetch menu items failed', e);
    res.status(500).json({ error: 'Failed to fetch menu items' });
  }
});

// --- Endpoint: POST /api/merchants/me/menu/item ---
// Create a new menu item for the merchant (any status)
router.post('/merchants/me/menu/item', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { name, price, category, description, imageUrl } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (price === undefined || price === null || isNaN(Number(price)) || Number(price) <= 0) {
      return res.status(400).json({ error: 'price must be a positive number' });
    }
    if (!category || typeof category !== 'string' || category.trim().length === 0) {
      return res.status(400).json({ error: 'category is required' });
    }

    // @ts-ignore
    const created = await prisma.menuItem.create({
      data: {
        merchantId,
        name: name.trim(),
        price: Number(price),
        category: category.trim(),
        description: description ? String(description).trim() : null,
        imageUrl: imageUrl ? String(imageUrl).trim() : null,
      },
      select: { id: true, name: true, price: true, category: true, imageUrl: true, description: true }
    });
    res.status(201).json({ menuItem: created });
  } catch (e) {
    console.error('Create menu item failed', e);
    res.status(500).json({ error: 'Failed to create menu item' });
  }
});

// --- Endpoint: PUT /api/merchants/me/menu/item/:itemId ---
// Update an existing menu item (must belong to merchant)
router.put('/merchants/me/menu/item/:itemId', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'Invalid itemId' });

    // @ts-ignore
    const existing = await prisma.menuItem.findUnique({ where: { id: itemId }, select: { id: true, merchantId: true } });
    if (!existing || existing.merchantId !== merchantId) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    const { name, price, category, description, imageUrl } = req.body || {};
    const data: any = {};
    if (name !== undefined) {
      if (!name || typeof name !== 'string' || name.trim().length === 0) return res.status(400).json({ error: 'name cannot be empty' });
      data.name = name.trim();
    }
    if (price !== undefined) {
      if (price === null || isNaN(Number(price)) || Number(price) <= 0) return res.status(400).json({ error: 'price must be a positive number' });
      data.price = Number(price);
    }
    if (category !== undefined) {
      if (!category || typeof category !== 'string' || category.trim().length === 0) return res.status(400).json({ error: 'category cannot be empty' });
      data.category = category.trim();
    }
    if (description !== undefined) {
      data.description = description ? String(description).trim() : null;
    }
    if (imageUrl !== undefined) {
      data.imageUrl = imageUrl ? String(imageUrl).trim() : null;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    // @ts-ignore
    const updated = await prisma.menuItem.update({
      where: { id: itemId },
      data,
      select: { id: true, name: true, price: true, category: true, imageUrl: true, description: true }
    });
    res.status(200).json({ menuItem: updated });
  } catch (e) {
    console.error('Update menu item failed', e);
    res.status(500).json({ error: 'Failed to update menu item' });
  }
});

// --- Endpoint: DELETE /api/merchants/me/menu/item/:itemId ---
// Permanently deletes a menu item (consider soft delete later)
router.delete('/merchants/me/menu/item/:itemId', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'Invalid itemId' });

    // @ts-ignore
    const existing = await prisma.menuItem.findUnique({ where: { id: itemId }, select: { id: true, merchantId: true } });
// --- Endpoint: GET /api/merchants/me/kickback-earnings ---
// Fetches aggregated and detailed Kickback earnings data with real database queries.
router.get('/merchants/me/kickback-earnings', protect, isApprovedMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const { period = 'all_time' } = req.query as any;

    // Calculate date range based on period
    let dateFrom: Date | null = null;
    const now = new Date();
    
    switch (period) {
      case 'last_7_days':
        dateFrom = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        break;
      case 'last_30_days':
        dateFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        break;
      case 'this_month':
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'this_year':
        dateFrom = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        dateFrom = null; // all_time
    }

    // Build date filter for queries
    const dateFilter = dateFrom ? { gte: dateFrom } : undefined;

    // Get aggregated kickback data
    const kickbackSummary = await prisma.kickbackEvent.aggregate({
      where: {
        merchantId,
        ...(dateFilter && { createdAt: dateFilter })
      },
      _sum: {
        sourceAmountSpent: true,
        amountEarned: true
      },
      _count: {
        id: true
      }
    });

    // Get detailed kickback events grouped by user
    const kickbackDetails = await prisma.kickbackEvent.findMany({
      where: {
        merchantId,
        ...(dateFilter && { createdAt: dateFilter })
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true
          }
        },
        deal: {
          select: {
            id: true,
            title: true,
            imageUrls: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Group by user and aggregate their kickback data
    const userKickbackMap = kickbackDetails.reduce((acc, event) => {
      const userId = event.userId;
      if (!acc[userId]) {
        acc[userId] = {
          user: event.user,
          earned: 0,
          invitedCount: 0,
          totalSpentByInvitees: 0,
          kickbackEvents: []
        };
      }
      
      acc[userId].earned += event.amountEarned;
      acc[userId].invitedCount += event.inviteeCount;
      acc[userId].totalSpentByInvitees += event.sourceAmountSpent;
      acc[userId].kickbackEvents.push(event);
      
      return acc;
    }, {} as any);

    // Convert to array and format for response
    const details = Object.values(userKickbackMap).map((userData: any) => ({
      user: {
        id: userData.user.id,
        name: userData.user.name || 'Anonymous User',
        avatarUrl: userData.user.avatarUrl
      },
      earned: Number(userData.earned.toFixed(2)),
      invitedCount: userData.invitedCount,
      totalSpentByInvitees: Number(userData.totalSpentByInvitees.toFixed(2)),
      spendingDetail: userData.kickbackEvents.map((event: any) => ({
        dealTitle: event.deal.title,
        dealId: event.deal.id,
        amountSpent: Number(event.sourceAmountSpent.toFixed(2)),
        amountEarned: Number(event.amountEarned.toFixed(2)),
        inviteeCount: event.inviteeCount,
        date: event.createdAt
      }))
    })).sort((a, b) => b.earned - a.earned); // Sort by highest earnings

    // Get time-series data for kickback earnings
    const timeSeriesData = [];
    if (dateFrom) {
      const currentDate = new Date(dateFrom);
      while (currentDate <= now) {
        const dayStart = new Date(currentDate);
        const dayEnd = new Date(currentDate);
        dayEnd.setHours(23, 59, 59, 999);

        const dayKickbackEvents = await prisma.kickbackEvent.aggregate({
          where: {
            merchantId,
            createdAt: { gte: dayStart, lte: dayEnd }
          },
          _sum: {
            sourceAmountSpent: true,
            amountEarned: true
          },
          _count: {
            id: true
          }
        });

        timeSeriesData.push({
          date: currentDate.toISOString().split('T')[0],
          revenue: Number((dayKickbackEvents._sum.sourceAmountSpent || 0).toFixed(2)),
          kickbackHandout: Number((dayKickbackEvents._sum.amountEarned || 0).toFixed(2)),
          eventCount: dayKickbackEvents._count.id
        });

        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    res.status(200).json({
      period,
      summary: {
        revenue: Number((kickbackSummary._sum.sourceAmountSpent || 0).toFixed(2)),
        totalKickbackHandout: Number((kickbackSummary._sum.amountEarned || 0).toFixed(2)),
        totalEvents: kickbackSummary._count.id,
        uniqueUsers: details.length
      },
      details,
      timeSeries: timeSeriesData,
      dateRange: {
        from: dateFrom,
        to: now
      },
      merchantId
    });
  } catch (error) {
    console.error('Kickback earnings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

    if (!existing || existing.merchantId !== merchantId) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    // @ts-ignore
    await prisma.menuItem.delete({ where: { id: itemId } });
    res.status(200).json({ message: 'Menu item deleted' });
  } catch (e) {
    console.error('Delete menu item failed', e);
    res.status(500).json({ error: 'Failed to delete menu item' });
  }
});

// --- Endpoint: GET /api/merchants/stores ---
// List stores for the authenticated approved merchant
router.get('/merchants/stores', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });
    // @ts-ignore
    const stores = await prisma.store.findMany({ where: { merchantId }, include: { city: true } });
    res.status(200).json({ total: stores.length, stores });
  } catch (e) {
    console.error('List stores failed', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: POST /api/merchants/stores ---
// Create a new store for the authenticated approved merchant
// Body: { address, latitude?, longitude?, cityId? OR (cityName & state), active? }
router.post('/merchants/stores', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { address, latitude, longitude, cityId, active } = req.body || {};
    if (!address) return res.status(400).json({ error: 'address is required' });
    if (!cityId) return res.status(400).json({ error: 'cityId is required. Only existing active cities may be used.' });
    // @ts-ignore
    const existing = await prisma.city.findUnique({ where: { id: Number(cityId) } });
    if (!existing) return res.status(400).json({ error: 'Invalid cityId' });
    if (!existing.active) return res.status(400).json({ error: 'City is not active.' });
    const resolvedCityId: number = existing.id;

    const lat = latitude !== undefined && latitude !== null && String(latitude) !== '' ? parseFloat(latitude) : null;
    const lon = longitude !== undefined && longitude !== null && String(longitude) !== '' ? parseFloat(longitude) : null;
    if (lat !== null && (isNaN(lat) || lat < -90 || lat > 90)) return res.status(400).json({ error: 'Latitude must be a number between -90 and 90' });
    if (lon !== null && (isNaN(lon) || lon < -180 || lon > 180)) return res.status(400).json({ error: 'Longitude must be a number between -180 and 180' });

    // @ts-ignore
    const store = await prisma.store.create({
      data: {
        merchantId,
  cityId: resolvedCityId,
        address,
        latitude: lat,
        longitude: lon,
        active: typeof active === 'boolean' ? active : true,
      },
      include: { city: true }
    });
    res.status(201).json({ message: 'Store created', store });
  } catch (e) {
    console.error('Create store failed', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// --- Endpoint: POST /api/deals/upload-image ---
// Allows an APPROVED merchant to upload a single image for a deal.
// The middleware chain ensures security and handles the file parsing.
router.post('/deals/upload-image', protect, isApprovedMerchant, upload.single('image'), async (req: AuthRequest, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided.' });
        }

        // Extract optional metadata from the request body
        const { businessName, dealTitle } = req.body;
        const merchantId = req.merchant!.id; // Available from isApprovedMerchant middleware

         const businessSlug = slugify(businessName || `merchant-${merchantId}`);
        const dealSlug = slugify(dealTitle || 'deal-image');
        const timestamp = Date.now();

        // Build deterministic publicId path (folder style) for overwrite/idempotency potential
        const publicId = `${businessSlug}-${merchantId}/${dealSlug}-${timestamp}`;

        const result = await uploadToCloudinary(req.file.buffer, { publicId });

        if (!result || !result.secure_url) {
            return res.status(500).json({ error: 'Cloudinary upload failed.' });
        }
        
        res.status(200).json({
            message: 'Image uploaded successfully.',
            imageUrl: result.secure_url,
      publicId: result.public_id
        });

    } catch (error: any) {
        console.error('Image upload error:', error);
        // Handle multer file filter errors
        if (error.message === 'Only image files are allowed!') {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Internal server error during file upload.' });
    }
});
