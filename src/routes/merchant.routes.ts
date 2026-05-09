// src/routes/merchant.routes.ts
import { Router, Response } from 'express';
import { protect, isApprovedMerchant, isMerchant, AuthRequest } from '../middleware/auth.middleware';
// requireMerchantVerified removed from store CRUD — basic location setup shouldn't require docs.
// The verification gate stays on venue-reward routes (where it actually issues value).
import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { uploadImage, deleteImage, uploadToCloudinary } from '../lib/cloudinary';
import { slugify } from '../lib/slugify';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { annotateStopStatus, resolveScheduleStatusFor } from '../services/truck-schedule.service';


const router = Router();

type InventoryPayload = {
  isAvailable?: unknown;
  inventoryTrackingEnabled?: unknown;
  inventoryQuantity?: unknown;
  lowStockThreshold?: unknown;
  allowBackorder?: unknown;
};

type BulkOrderPayload = {
  isBulkOrderEnabled?: unknown;
  defaultPeopleCount?: unknown;
  minPeopleCount?: unknown;
};

type InventoryAlert = {
  level: 'LOW_STOCK' | 'OUT_OF_STOCK';
  title: string;
  message: string;
};

// --- SKU Generation Helper ---
function generateSku(itemName: string, variantLabel: string, merchantId: number): string {
  const slugify = (s: string) =>
    s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
  const base = slugify(itemName);
  const variant = slugify(variantLabel);
  const suffix = String(merchantId).slice(-4).padStart(4, '0');
  return `${base}-${variant}-${suffix}`;
}

const variantSelect = {
  id: true,
  sku: true,
  label: true,
  price: true,
  servesCount: true,
  inventoryQuantity: true,
  lowStockThreshold: true,
  isAvailable: true,
  sortOrder: true,
} as const;

function getVariantInventoryStatus(variant: {
  isAvailable?: boolean | null;
  inventoryQuantity?: number | null;
  lowStockThreshold?: number | null;
}) {
  if (variant.isAvailable === false) return 'OUT_OF_STOCK';
  if (variant.inventoryQuantity == null) return 'UNTRACKED';
  if (variant.inventoryQuantity <= 0) return 'OUT_OF_STOCK';
  if (
    variant.lowStockThreshold != null &&
    variant.inventoryQuantity <= variant.lowStockThreshold
  ) {
    return 'LOW_STOCK';
  }
  return 'IN_STOCK';
}

function normalizeVariants(variants: any[] | undefined) {
  if (!variants || variants.length === 0) return [];
  return variants.map((v: any) => ({
    ...v,
    inventoryStatus: getVariantInventoryStatus(v),
  }));
}

function getInventoryStatus(item: {
  isAvailable?: boolean | null;
  inventoryTrackingEnabled?: boolean | null;
  inventoryQuantity?: number | null;
  lowStockThreshold?: number | null;
  allowBackorder?: boolean | null;
}) {
  if (!item.isAvailable) return 'OUT_OF_STOCK';
  if (!item.inventoryTrackingEnabled) return 'UNTRACKED';
  if ((item.inventoryQuantity ?? 0) <= 0 && !item.allowBackorder) return 'OUT_OF_STOCK';
  if (
    item.lowStockThreshold != null &&
    item.inventoryQuantity != null &&
    item.inventoryQuantity <= item.lowStockThreshold
  ) {
    return 'LOW_STOCK';
  }
  return 'IN_STOCK';
}

function buildMenuItemInventoryAlert(
  previous: {
    isAvailable?: boolean | null;
    inventoryTrackingEnabled?: boolean | null;
    inventoryQuantity?: number | null;
    lowStockThreshold?: number | null;
    allowBackorder?: boolean | null;
  },
  next: {
    isAvailable?: boolean | null;
    inventoryTrackingEnabled?: boolean | null;
    inventoryQuantity?: number | null;
    lowStockThreshold?: number | null;
    allowBackorder?: boolean | null;
  },
  itemName: string,
): InventoryAlert | null {
  const previousStatus = getInventoryStatus(previous);
  const nextStatus = getInventoryStatus(next);
  if (previousStatus === nextStatus) return null;
  if (nextStatus !== 'LOW_STOCK' && nextStatus !== 'OUT_OF_STOCK') return null;

  const quantity = next.inventoryQuantity ?? 0;
  const threshold = next.lowStockThreshold ?? 0;
  if (nextStatus === 'OUT_OF_STOCK') {
    return {
      level: 'OUT_OF_STOCK',
      title: `Out of stock: ${itemName}`,
      message: `${itemName} is now out of stock. Restock soon to avoid missed orders.`,
    };
  }
  return {
    level: 'LOW_STOCK',
    title: `Low stock: ${itemName}`,
    message: `${itemName} is running low (${quantity} left, threshold ${threshold}).`,
  };
}

function buildVariantInventoryAlert(
  previous: {
    isAvailable?: boolean | null;
    inventoryQuantity?: number | null;
    lowStockThreshold?: number | null;
  },
  next: {
    isAvailable?: boolean | null;
    inventoryQuantity?: number | null;
    lowStockThreshold?: number | null;
  },
  itemName: string,
  variantLabel: string,
): InventoryAlert | null {
  const previousStatus = getVariantInventoryStatus(previous);
  const nextStatus = getVariantInventoryStatus(next);
  if (previousStatus === nextStatus) return null;
  if (nextStatus !== 'LOW_STOCK' && nextStatus !== 'OUT_OF_STOCK') return null;

  const quantity = next.inventoryQuantity ?? 0;
  const threshold = next.lowStockThreshold ?? 0;
  const label = `${itemName} (${variantLabel})`;
  if (nextStatus === 'OUT_OF_STOCK') {
    return {
      level: 'OUT_OF_STOCK',
      title: `Out of stock: ${label}`,
      message: `${label} is now out of stock. Restock this variant to keep it sellable.`,
    };
  }
  return {
    level: 'LOW_STOCK',
    title: `Low stock: ${label}`,
    message: `${label} is running low (${quantity} left, threshold ${threshold}).`,
  };
}

function normalizeMenuItemResponse<T extends {
  isAvailable?: boolean | null;
  inventoryTrackingEnabled?: boolean | null;
  inventoryQuantity?: number | null;
  lowStockThreshold?: number | null;
  allowBackorder?: boolean | null;
  hasVariants?: boolean | null;
  variants?: any[];
}>(item: T) {
  return {
    ...item,
    inventoryStatus: getInventoryStatus(item),
    variants: normalizeVariants(item.variants),
  };
}

const menuCollectionMenuItemSelect = {
  id: true,
  name: true,
  price: true,
  category: true,
  imageUrl: true,
  imageUrls: true,
  description: true,
  dealType: true,
  isHappyHour: true,
  happyHourPrice: true,
  inventoryTrackingEnabled: true,
  inventoryQuantity: true,
  lowStockThreshold: true,
  allowBackorder: true,
  isAvailable: true,
  hasVariants: true,
  isBulkOrderEnabled: true,
  defaultPeopleCount: true,
  minPeopleCount: true,
  variants: {
    select: variantSelect,
    orderBy: { sortOrder: 'asc' as const },
  },
} as const;

function normalizeCollectionResponse<T extends { items?: Array<{ menuItem?: any }> }>(collection: T) {
  return {
    ...collection,
    items: (collection.items || []).map((item) => ({
      ...item,
      menuItem: item.menuItem ? normalizeMenuItemResponse(item.menuItem) : item.menuItem,
    })),
  };
}

function normalizeOptionalTrimmedString(value: unknown, maxLength?: number) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error('Invalid string value');
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (maxLength && trimmed.length > maxLength) {
    throw new Error(`String value must be ${maxLength} characters or less`);
  }

  return trimmed;
}

function normalizeOptionalPositiveInteger(value: unknown, fieldName: string) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return numericValue;
}

function normalizeOptionalNonNegativeInteger(value: unknown, fieldName: string) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return numericValue;
}

function normalizeOptionalNonNegativeFloat(value: unknown, fieldName: string) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }

  return numericValue;
}

function buildInventoryUpdateData(payload: InventoryPayload, isCreate = false) {
  const data: Record<string, any> = {};

  if (payload.isAvailable !== undefined) {
    if (typeof payload.isAvailable !== 'boolean') {
      throw new Error('isAvailable must be a boolean');
    }
    data.isAvailable = payload.isAvailable;
  } else if (isCreate) {
    data.isAvailable = true;
  }

  if (payload.inventoryTrackingEnabled !== undefined) {
    if (typeof payload.inventoryTrackingEnabled !== 'boolean') {
      throw new Error('inventoryTrackingEnabled must be a boolean');
    }
    data.inventoryTrackingEnabled = payload.inventoryTrackingEnabled;
  } else if (isCreate) {
    data.inventoryTrackingEnabled = false;
  }

  if (payload.allowBackorder !== undefined) {
    if (typeof payload.allowBackorder !== 'boolean') {
      throw new Error('allowBackorder must be a boolean');
    }
    data.allowBackorder = payload.allowBackorder;
  } else if (isCreate) {
    data.allowBackorder = false;
  }

  if (payload.inventoryQuantity !== undefined) {
    if (payload.inventoryQuantity === null || payload.inventoryQuantity === '') {
      data.inventoryQuantity = null;
    } else if (!Number.isInteger(Number(payload.inventoryQuantity)) || Number(payload.inventoryQuantity) < 0) {
      throw new Error('inventoryQuantity must be a non-negative integer or null');
    } else {
      data.inventoryQuantity = Number(payload.inventoryQuantity);
    }
  }

  if (payload.lowStockThreshold !== undefined) {
    if (payload.lowStockThreshold === null || payload.lowStockThreshold === '') {
      data.lowStockThreshold = null;
    } else if (!Number.isInteger(Number(payload.lowStockThreshold)) || Number(payload.lowStockThreshold) < 0) {
      throw new Error('lowStockThreshold must be a non-negative integer or null');
    } else {
      data.lowStockThreshold = Number(payload.lowStockThreshold);
    }
  }

  const trackingEnabled =
    data.inventoryTrackingEnabled ??
    (isCreate ? false : undefined);

  if (trackingEnabled === true && data.inventoryQuantity === undefined && isCreate) {
    throw new Error('inventoryQuantity is required when inventoryTrackingEnabled is true');
  }

  if (trackingEnabled === false) {
    if (payload.inventoryQuantity === undefined && isCreate) {
      data.inventoryQuantity = null;
    }
    if (payload.lowStockThreshold === undefined && isCreate) {
      data.lowStockThreshold = null;
    }
  }

  return data;
}

function buildBulkOrderUpdateData(payload: BulkOrderPayload, isCreate = false) {
  const data: Record<string, any> = {};

  if (payload.isBulkOrderEnabled !== undefined) {
    if (typeof payload.isBulkOrderEnabled !== 'boolean') {
      throw new Error('isBulkOrderEnabled must be a boolean');
    }
    data.isBulkOrderEnabled = payload.isBulkOrderEnabled;
  } else if (isCreate) {
    data.isBulkOrderEnabled = false;
  }

  if (payload.defaultPeopleCount !== undefined) {
    if (payload.defaultPeopleCount === null || payload.defaultPeopleCount === '') {
      data.defaultPeopleCount = null;
    } else if (!Number.isInteger(Number(payload.defaultPeopleCount)) || Number(payload.defaultPeopleCount) < 1) {
      throw new Error('defaultPeopleCount must be a positive integer or null');
    } else {
      data.defaultPeopleCount = Number(payload.defaultPeopleCount);
    }
  }

  if (payload.minPeopleCount !== undefined) {
    if (payload.minPeopleCount === null || payload.minPeopleCount === '') {
      data.minPeopleCount = null;
    } else if (!Number.isInteger(Number(payload.minPeopleCount)) || Number(payload.minPeopleCount) < 1) {
      throw new Error('minPeopleCount must be a positive integer or null');
    } else {
      data.minPeopleCount = Number(payload.minPeopleCount);
    }
  }

  const effectiveBulkEnabled = data.isBulkOrderEnabled ?? (isCreate ? false : undefined);
  if (effectiveBulkEnabled === false) {
    if (payload.defaultPeopleCount === undefined && isCreate) {
      data.defaultPeopleCount = null;
    }
    if (payload.minPeopleCount === undefined && isCreate) {
      data.minPeopleCount = null;
    }
  }

  if (
    data.defaultPeopleCount != null &&
    data.minPeopleCount != null &&
    data.defaultPeopleCount < data.minPeopleCount
  ) {
    throw new Error('defaultPeopleCount must be greater than or equal to minPeopleCount');
  }

  return data;
}

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

// Configure multer for Excel uploads
const excelUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv' // .csv
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) and CSV files are allowed!'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for Excel files
  }
});

// --- Endpoint: POST /api/merchants/register ---
// Allows a user to register as a merchant. No location/store required — those are added via store creation.
router.post('/merchants/register', protect, async (req: AuthRequest, res) => {
  try {
    const {
      businessName,
      address,
      description,
      logoUrl,
      phoneNumber,
      businessType,
      businessCategory,
      categoryId,
      websiteUrl,
      instagramUrl,
      facebookUrl,
      twitterUrl,
      priceRange,
      galleryUrls,
      vibeTags,
      amenities,
      stores,
    } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!businessName) {
      return res.status(400).json({ error: 'Business name is required' });
    }

    // Validate businessType if provided
    if (businessType && !['NATIONAL', 'LOCAL'].includes(businessType)) {
      return res.status(400).json({ error: 'Business type must be either NATIONAL or LOCAL' });
    }

    const existingMerchant = await prisma.merchant.findUnique({
      where: { ownerId: userId },
    });

    if (existingMerchant) {
      return res.status(409).json({ error: 'You have already registered as a merchant.' });
    }

    // Resolve categoryId from businessCategory string if provided (e.g. "Restaurant" -> DealCategoryMaster id)
    let resolvedCategoryId: number | null = null;
    if (categoryId) {
      const cat = await prisma.dealCategoryMaster.findUnique({ where: { id: Number(categoryId) } });
      if (cat) resolvedCategoryId = cat.id;
    }
    if (!resolvedCategoryId && businessCategory) {
      const cat = await prisma.dealCategoryMaster.findFirst({
        where: { name: { equals: businessCategory, mode: 'insensitive' } },
      });
      if (cat) resolvedCategoryId = cat.id;
    }

    const galleryArray = Array.isArray(galleryUrls) ? galleryUrls : typeof galleryUrls === 'string' ? (galleryUrls ? [galleryUrls] : []) : [];
    const vibeTagsArray = Array.isArray(vibeTags) ? vibeTags.filter((tag: unknown) => typeof tag === 'string') : [];
    const amenitiesArray = Array.isArray(amenities) ? amenities.filter((item: unknown) => typeof item === 'string') : [];

    const storeInputs = Array.isArray(stores) ? stores : [];
    const firstStoreAddress =
      storeInputs.length > 0 && typeof storeInputs[0]?.address === 'string' && storeInputs[0].address.trim()
        ? storeInputs[0].address.trim()
        : null;
    const merchantAddress = typeof address === 'string' && address.trim() ? address.trim() : firstStoreAddress;

    const preparedStores: Array<{
      cityId: number;
      address: string;
      latitude: number | null;
      longitude: number | null;
      active: boolean;
      description: string | null;
      operatingHours: Prisma.InputJsonValue | null;
      galleryUrls: string[];
      isFoodTruck: boolean;
    }> = [];

    for (const rawStore of storeInputs) {
      if (!rawStore || typeof rawStore !== 'object') {
        return res.status(400).json({ error: 'Each store must be an object' });
      }

      const rawAddress = typeof (rawStore as { address?: unknown }).address === 'string' ? (rawStore as { address: string }).address.trim() : '';
      const rawCityId = (rawStore as { cityId?: unknown }).cityId;
      const rawLatitude = (rawStore as { latitude?: unknown }).latitude;
      const rawLongitude = (rawStore as { longitude?: unknown }).longitude;

      if (!rawAddress) {
        return res.status(400).json({ error: 'Store address is required' });
      }

      const parsedCityId = Number(rawCityId);
      if (!rawCityId || Number.isNaN(parsedCityId)) {
        return res.status(400).json({ error: 'Each store requires a valid cityId' });
      }

      // @ts-ignore
      const city = await prisma.city.findUnique({ where: { id: parsedCityId } });
      if (!city) {
        return res.status(400).json({ error: `Invalid cityId: ${parsedCityId}` });
      }
      if (!city.active) {
        return res.status(400).json({ error: `City is not active for cityId: ${parsedCityId}` });
      }

      const lat = rawLatitude !== undefined && rawLatitude !== null && String(rawLatitude) !== '' ? parseFloat(String(rawLatitude)) : null;
      const lon = rawLongitude !== undefined && rawLongitude !== null && String(rawLongitude) !== '' ? parseFloat(String(rawLongitude)) : null;

      if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) {
        return res.status(400).json({ error: 'Store latitude must be a number between -90 and 90' });
      }
      if (lon !== null && (Number.isNaN(lon) || lon < -180 || lon > 180)) {
        return res.status(400).json({ error: 'Store longitude must be a number between -180 and 180' });
      }

      const storeGallery = Array.isArray((rawStore as { galleryUrls?: unknown }).galleryUrls)
        ? ((rawStore as { galleryUrls: unknown[] }).galleryUrls.filter((item) => typeof item === 'string') as string[])
        : [];

      const rawHours = (rawStore as { operatingHours?: unknown }).operatingHours;
      const storeHours = rawHours && typeof rawHours === 'object' ? (rawHours as Prisma.InputJsonValue) : null;

      preparedStores.push({
        cityId: parsedCityId,
        address: rawAddress,
        latitude: lat,
        longitude: lon,
        active: typeof (rawStore as { active?: unknown }).active === 'boolean' ? Boolean((rawStore as { active: unknown }).active) : true,
        description: typeof (rawStore as { description?: unknown }).description === 'string' ? (rawStore as { description: string }).description : null,
        operatingHours: storeHours,
        galleryUrls: storeGallery,
        isFoodTruck: typeof (rawStore as { isFoodTruck?: unknown }).isFoodTruck === 'boolean' ? Boolean((rawStore as { isFoodTruck: unknown }).isFoodTruck) : false,
      });
    }

    const { merchant, createdStoreIds } = await prisma.$transaction(async (tx) => {
      const createdMerchant = await tx.merchant.create({
        data: {
          businessName,
          address: merchantAddress || '',
          description: description || null,
          logoUrl: logoUrl || null,
          phoneNumber: phoneNumber || null,
          businessType: businessType || 'LOCAL',
          websiteUrl: websiteUrl || null,
          instagramUrl: instagramUrl || null,
          facebookUrl: facebookUrl || null,
          twitterUrl: twitterUrl || null,
          priceRange: priceRange || null,
          galleryUrls: galleryArray,
          vibeTags: vibeTagsArray,
          amenities: amenitiesArray,
          categoryId: resolvedCategoryId,
          ownerId: userId,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { role: 'MERCHANT' },
      });

      const ids: number[] = [];
      for (const store of preparedStores) {
        // @ts-ignore
        const createdStore = await tx.store.create({
          data: {
            merchantId: createdMerchant.id,
            cityId: store.cityId,
            address: store.address,
            latitude: store.latitude,
            longitude: store.longitude,
            active: store.active,
            description: store.description,
            operatingHours: store.operatingHours ?? undefined,
            galleryUrls: store.galleryUrls,
            isFoodTruck: store.isFoodTruck,
          },
        });
        ids.push(createdStore.id);
      }

      return { merchant: createdMerchant, createdStoreIds: ids };
    });

    const createdStores = createdStoreIds.length
      ? await prisma.store.findMany({ where: { id: { in: createdStoreIds } }, include: { city: true } })
      : [];

    res.status(201).json({
      message: createdStores.length
        ? 'Merchant application submitted successfully with initial store(s). It is now pending approval.'
        : 'Merchant application submitted successfully. It is now pending approval. Add your first location from the dashboard.',
      merchant,
      stores: createdStores,
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
        instagramUrl: true,
        facebookUrl: true,
        twitterUrl: true,
        priceRange: true,
        galleryUrls: true,
        categoryId: true,
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
// 
// DISCOUNT SYSTEM:
// ================
// This endpoint supports TWO discount strategies that can work together:
//
// 1. GLOBAL DISCOUNTS (Applied to ALL menu items in the deal):
//    - discountPercentage: A percentage discount (0-100) applied to all items
//    - discountAmount: A fixed amount discount applied to the entire deal
//    - All items with useGlobalDiscount=true will use these values
//
// 2. ITEM-SPECIFIC DISCOUNTS (Override global discount for specific items):
//    - customPrice: Override the menu item's base price for this deal
//    - customDiscount: Percentage discount (0-100) applied ONLY to this item
//    - discountAmount: Fixed amount discount applied ONLY to this item
//    - useGlobalDiscount: Auto-set to false when item has custom pricing
//
// EXAMPLE REQUEST BODY:
// {
//   "title": "Happy Hour Special",
//   "discountPercentage": 20,  // 20% off ALL items (global)
//   "menuItems": [
//     { "id": 1 },                                    // Uses 20% global discount
//     { "id": 2, "customDiscount": 50 },              // 50% off THIS item only
//     { "id": 3, "customPrice": 5.99 },               // Fixed price for THIS item
//     { "id": 4, "discountAmount": 2.00 },            // $2 off THIS item
//     { "id": 5, "customDiscount": 30, "isHidden": true }  // 30% off but hidden in deal UI
//   ]
// }
//
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
      menuCollectionId, // ID of menu collection to use
      
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

    // ==================== DEAL TYPE SPECIFIC VALIDATION & LOGIC ====================
    // Import deal utilities at the top of the file
    const { 
      generateAccessCode, 
      generateBountyQRCode, 
      validateDealTypeRequirements 
    } = require('../lib/dealUtils');

    // Get deal type to apply specific business rules
    const dealTypeRecord = await prisma.dealTypeMaster.findUnique({
      where: { id: dealTypeId! }
    });

    if (!dealTypeRecord) {
      return res.status(500).json({ error: 'Deal type not found' });
    }

    const dealTypeName = dealTypeRecord.name;
    let bountyRewardAmountValue: number | undefined;
    let minReferralsRequiredValue: number | undefined;
    let accessCodeValue: string | undefined;
    let bountyQRCodeValue: string | undefined;
    let isFlashSaleValue = false;
    let maxRedemptionsValue: number | undefined;
    let kickbackEnabledValue = !!kickbackEnabled;
    let discountPercentageValue = discountPercentage;
    let bogoBuyQuantityValue: number | undefined;
    let bogoGetQuantityValue: number | undefined;
    let bogoGetDiscountPercentValue: number | undefined;
    let bountyPotAmountValue: number | undefined;
    let bountyMaxInvitesValue: number | undefined;
    let bountyMinSpendValue: number | undefined;

    // --- HAPPY HOUR DEAL VALIDATION ---
    if (dealTypeName === 'Happy Hour') {
      if (menuItems && Array.isArray(menuItems) && menuItems.length > 0) {
        // Validate all selected items are from happy hour menu
        const menuItemIds = menuItems.map((mi: any) => Number(mi.id)).filter((id: number) => !isNaN(id));
        
        if (menuItemIds.length > 0) {
          const happyHourItems = await prisma.menuItem.findMany({
            where: {
              id: { in: menuItemIds },
              merchantId: merchantId,
              isHappyHour: true
            }
          });

          if (happyHourItems.length !== menuItemIds.length) {
            return res.status(400).json({
              error: 'All items must be from Happy Hour menu. Please select only Happy Hour items.',
              hint: 'Toggle "Happy Hour" on menu items first, then add them to this deal.'
            });
          }
        }
      }
    }

    // --- BOUNTY DEAL VALIDATION ---
    if (dealTypeName === 'Bounty Deal') {
      bountyRewardAmountValue = req.body.bountyRewardAmount ? parseFloat(req.body.bountyRewardAmount) : undefined;
      minReferralsRequiredValue = req.body.minReferralsRequired ? parseInt(req.body.minReferralsRequired) : undefined;

      if (!bountyRewardAmountValue || bountyRewardAmountValue <= 0) {
        return res.status(400).json({
          error: 'Bounty reward amount is required and must be positive',
          hint: 'Specify how much cash back customers earn per friend they bring'
        });
      }

      if (!minReferralsRequiredValue || minReferralsRequiredValue < 1) {
        return res.status(400).json({
          error: 'Minimum referrals required must be at least 1',
          hint: 'Specify minimum number of friends customer must bring'
        });
      }

      // Auto-enable kickback for bounty deals
      kickbackEnabledValue = true;

      // Generate QR code for bounty verification (will be updated after deal creation with dealId)
      // We'll generate it after the deal is created

      // Optional pot-based fields (flash group bounty)
      if (req.body.bountyPotAmount !== undefined && req.body.bountyPotAmount !== null && req.body.bountyPotAmount !== '') {
        bountyPotAmountValue = parseFloat(req.body.bountyPotAmount);
        if (!Number.isFinite(bountyPotAmountValue) || bountyPotAmountValue < 0) {
          return res.status(400).json({ error: 'bountyPotAmount must be a non-negative number' });
        }
      }
      if (req.body.bountyMaxInvites !== undefined && req.body.bountyMaxInvites !== null && req.body.bountyMaxInvites !== '') {
        bountyMaxInvitesValue = parseInt(req.body.bountyMaxInvites);
        if (!Number.isFinite(bountyMaxInvitesValue) || bountyMaxInvitesValue < 1) {
          return res.status(400).json({ error: 'bountyMaxInvites must be an integer >= 1' });
        }
      }
      if (req.body.bountyMinSpend !== undefined && req.body.bountyMinSpend !== null && req.body.bountyMinSpend !== '') {
        bountyMinSpendValue = parseFloat(req.body.bountyMinSpend);
        if (!Number.isFinite(bountyMinSpendValue) || bountyMinSpendValue < 0) {
          return res.status(400).json({ error: 'bountyMinSpend must be a non-negative number' });
        }
      }
    }

    // --- HIDDEN DEAL VALIDATION ---
    if (dealTypeName === 'Hidden Deal') {
      accessCodeValue = req.body.accessCode || generateAccessCode();
      
      // Validate access code uniqueness
      const existingDeal = await prisma.deal.findFirst({
        where: {
          AND: [
            { accessCode: accessCodeValue },
            { merchantId: { not: merchantId } } // Allow merchant to reuse their own codes
          ]
        }
      });

      if (existingDeal) {
        return res.status(400).json({
          error: 'Access code already in use. Please choose a different code.',
          generatedCode: generateAccessCode() // Suggest a new one
        });
      }

      // Force all menu items to be hidden
      if (menuItems && Array.isArray(menuItems)) {
        menuItems.forEach((item: any) => {
          item.isHidden = true;
        });
      }

      // Optional: Enable bounty for hidden deals
      if (req.body.bountyRewardAmount && req.body.minReferralsRequired) {
        bountyRewardAmountValue = parseFloat(req.body.bountyRewardAmount);
        minReferralsRequiredValue = parseInt(req.body.minReferralsRequired);
        
        if (bountyRewardAmountValue > 0 && minReferralsRequiredValue > 0) {
          kickbackEnabledValue = true;
        }
      }
    }

    // --- REDEEM NOW DEAL VALIDATION ---
    if (dealTypeName === 'Redeem Now') {
      const validPresetDiscounts = [15, 30, 45, 50, 75];
      const requestedDiscount = req.body.discountPercentage ? parseInt(req.body.discountPercentage) : null;

      if (!requestedDiscount) {
        return res.status(400).json({
          error: 'Discount percentage is required for Redeem Now deals',
          hint: 'Choose from: 15%, 30%, 45%, 50%, 75%, or custom (1-100%)'
        });
      }

      // Validate discount is either a preset or custom in valid range
      if (!validPresetDiscounts.includes(requestedDiscount)) {
        if (requestedDiscount < 1 || requestedDiscount > 100) {
          return res.status(400).json({
            error: 'Discount percentage must be between 1 and 100',
            presets: validPresetDiscounts
          });
        }
      }

      // Set the discount
      discountPercentageValue = requestedDiscount;
      isFlashSaleValue = true;

      // Validate duration (max 24 hours)
      const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
      if (durationHours > 24) {
        return res.status(400).json({
          error: 'Redeem Now deals must be 24 hours or less',
          currentDuration: `${durationHours.toFixed(1)} hours`
        });
      }

      // Optional: Set max redemptions
      maxRedemptionsValue = req.body.maxRedemptions ? parseInt(req.body.maxRedemptions) : undefined;
      if (maxRedemptionsValue && maxRedemptionsValue < 1) {
        return res.status(400).json({
          error: 'Max redemptions must be at least 1 (or omit for unlimited)'
        });
      }
    }

    // --- RECURRING DEAL VALIDATION ---
    if (dealTypeName === 'Recurring Deal') {
      if (!recurringDays || recurringDays.length === 0) {
        return res.status(400).json({
          error: 'Please select at least one day for recurring deals',
          hint: 'Specify which days this deal should appear (e.g., MONDAY,TUESDAY)'
        });
      }
    }

    // --- BOGO DEAL VALIDATION ---
    if (dealTypeName === 'BOGO') {
      bogoBuyQuantityValue = req.body.bogoBuyQuantity ? parseInt(req.body.bogoBuyQuantity) : undefined;
      bogoGetQuantityValue = req.body.bogoGetQuantity ? parseInt(req.body.bogoGetQuantity) : undefined;
      bogoGetDiscountPercentValue = req.body.bogoGetDiscountPercent !== undefined && req.body.bogoGetDiscountPercent !== null && req.body.bogoGetDiscountPercent !== ''
        ? parseFloat(req.body.bogoGetDiscountPercent)
        : undefined;

      if (!bogoBuyQuantityValue || bogoBuyQuantityValue < 1) {
        return res.status(400).json({
          error: 'BOGO buy quantity is required and must be at least 1',
          hint: 'How many items must the customer buy to unlock the BOGO offer?'
        });
      }
      if (!bogoGetQuantityValue || bogoGetQuantityValue < 1) {
        return res.status(400).json({
          error: 'BOGO get quantity is required and must be at least 1',
          hint: 'How many items does the customer get at a discount?'
        });
      }
      if (
        bogoGetDiscountPercentValue === undefined ||
        !Number.isFinite(bogoGetDiscountPercentValue) ||
        bogoGetDiscountPercentValue < 0 ||
        bogoGetDiscountPercentValue > 100
      ) {
        return res.status(400).json({
          error: 'BOGO discount percent is required and must be between 0 and 100',
          hint: 'Use 100 for "free", 50 for "half off", etc.'
        });
      }
    } else if (
      req.body.bogoBuyQuantity !== undefined &&
      req.body.bogoBuyQuantity !== null &&
      req.body.bogoBuyQuantity !== ''
    ) {
      // Allow BOGO config on any deal type (e.g. layered on a Standard deal),
      // but if any field is provided, require all three.
      bogoBuyQuantityValue = parseInt(req.body.bogoBuyQuantity);
      bogoGetQuantityValue = req.body.bogoGetQuantity ? parseInt(req.body.bogoGetQuantity) : undefined;
      bogoGetDiscountPercentValue = req.body.bogoGetDiscountPercent !== undefined && req.body.bogoGetDiscountPercent !== null && req.body.bogoGetDiscountPercent !== ''
        ? parseFloat(req.body.bogoGetDiscountPercent)
        : undefined;
      if (
        !bogoBuyQuantityValue || bogoBuyQuantityValue < 1 ||
        !bogoGetQuantityValue || bogoGetQuantityValue < 1 ||
        bogoGetDiscountPercentValue === undefined ||
        !Number.isFinite(bogoGetDiscountPercentValue) ||
        bogoGetDiscountPercentValue < 0 ||
        bogoGetDiscountPercentValue > 100
      ) {
        return res.status(400).json({
          error: 'BOGO config requires bogoBuyQuantity (≥1), bogoGetQuantity (≥1), and bogoGetDiscountPercent (0–100)',
        });
      }
    }

    // ==================== END DEAL TYPE VALIDATION ====================


    // Enhanced deal creation with all dynamic fields
    let newDeal;
    try {
      newDeal = await prisma.$transaction(async (tx) => {
      // Prepare enhanced deal data with new fields
      const dealData: any = {
        title,
        description: description || '',
        startTime,
        endTime,
        redemptionInstructions: redemptionInstructions || '',
        imageUrls: imageUrls || [],
        discountPercentage: discountPercentageValue ? parseFloat(String(discountPercentageValue)) : null,
        discountAmount: discountAmount ? parseFloat(discountAmount) : null,
        categoryId: categoryId!,
        dealTypeId: dealTypeId!,
        recurringDays,
        offerTerms: offerTerms || null,
        kickbackEnabled: kickbackEnabledValue,
        merchantId: merchantId,
        
        // New fields for different deal types
        bountyRewardAmount: bountyRewardAmountValue || null,
        minReferralsRequired: minReferralsRequiredValue || null,
        accessCode: accessCodeValue || null,
        isFlashSale: isFlashSaleValue,
        maxRedemptions: maxRedemptionsValue || null,
        currentRedemptions: 0,
        bogoBuyQuantity: bogoBuyQuantityValue ?? null,
        bogoGetQuantity: bogoGetQuantityValue ?? null,
        bogoGetDiscountPercent: bogoGetDiscountPercentValue ?? null,
        bountyPotAmount: bountyPotAmountValue ?? null,
        bountyMaxInvites: bountyMaxInvitesValue ?? null,
        bountyMinSpend: bountyMinSpendValue ?? null,
      };

      const createdDeal = await tx.deal.create({
        data: dealData
      });
      
      // Generate bounty QR code after deal creation (needs dealId)
      if (dealTypeName === 'Bounty Deal' || (dealTypeName === 'Hidden Deal' && bountyRewardAmountValue)) {
        const qrCode = generateBountyQRCode(createdDeal.id, merchantId);
        await tx.deal.update({
          where: { id: createdDeal.id },
          data: { bountyQRCode: qrCode }
        });
        bountyQRCodeValue = qrCode;
      }

      const attachedMenuItemIds = new Set<number>();

      // Handle menu items with enhanced discount support
      if (menuItems && Array.isArray(menuItems) && menuItems.length > 0) {
        const dealMenuItemsData = menuItems
          .filter(mi => mi && typeof mi.id !== 'undefined')
          .map(mi => {
            // Validate item-specific discounts if provided
            const itemData: any = {
              dealId: createdDeal.id,
              menuItemId: Number(mi.id),
              isHidden: !!mi.isHidden,
              customPrice: mi.customPrice ? parseFloat(mi.customPrice) : null,
              customDiscount: mi.customDiscount ? parseFloat(mi.customDiscount) : null,
              discountAmount: mi.discountAmount ? parseFloat(mi.discountAmount) : null,
              // If item has specific discounts, don't use global discount
              useGlobalDiscount: !(mi.customDiscount || mi.discountAmount || mi.customPrice)
            };

            // Validate custom discount percentage
            if (itemData.customDiscount !== null && (itemData.customDiscount < 0 || itemData.customDiscount > 100)) {
              throw new Error(`customDiscount for menu item ${mi.id} must be between 0 and 100`);
            }

            // Validate discount amount
            if (itemData.discountAmount !== null && itemData.discountAmount < 0) {
              throw new Error(`discountAmount for menu item ${mi.id} must be non-negative`);
            }

            // Validate custom price
            if (itemData.customPrice !== null && itemData.customPrice < 0) {
              throw new Error(`customPrice for menu item ${mi.id} must be non-negative`);
            }

            return itemData;
          });

        dealMenuItemsData.forEach((item) => {
          attachedMenuItemIds.add(item.menuItemId);
        });
        
        if (dealMenuItemsData.length) {
          // @ts-ignore - DealMenuItem model available after generate
          await tx.dealMenuItem.createMany({ data: dealMenuItemsData });
        }
      }

      // Handle menu collection if provided
      if (menuCollectionId && Number.isFinite(Number(menuCollectionId))) {
        // Verify collection belongs to merchant
        const collection = await tx.menuCollection.findFirst({
          where: {
            id: Number(menuCollectionId),
            merchantId,
            isActive: true
          },
          include: {
            items: {
              where: { isActive: true },
              include: {
                menuItem: true
              }
            }
          }
        });

        if (collection) {
          // Add all active items from collection to deal
          // Items from collection use global discount by default unless they have custom pricing
          const collectionDealItems = collection.items
            .filter((item) => !attachedMenuItemIds.has(item.menuItemId))
            .map(item => ({
              dealId: createdDeal.id,
              menuItemId: item.menuItemId,
              isHidden: false, // Default to visible
              customPrice: item.customPrice || null,
              customDiscount: item.customDiscount || null,
              discountAmount: null,
              // If collection item has custom pricing, don't use global discount
              useGlobalDiscount: !item.customPrice && !item.customDiscount
            }));

          if (collectionDealItems.length > 0) {
            // @ts-ignore - DealMenuItem model available after generate
            await tx.dealMenuItem.createMany({ data: collectionDealItems });
          }
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
    const response: any = {
      success: true,
      message: `${dealTypeName} created successfully`,
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
        updatedAt: newDeal.updatedAt,
        dealType: dealTypeName
      },
      normalization: {
        dealTypeId,
        recurringDays: recurringDays ? recurringDays.split(',') : null
      }
    };

    // Add deal type specific fields to response
    if (bountyRewardAmountValue) {
      response.bounty = {
        rewardAmount: bountyRewardAmountValue,
        minReferrals: minReferralsRequiredValue,
        qrCode: bountyQRCodeValue
      };
    }

    if (accessCodeValue) {
      const { generateHiddenDealLink } = require('../lib/dealUtils');
      response.hidden = {
        accessCode: accessCodeValue,
        directLink: generateHiddenDealLink(newDeal.id, accessCodeValue),
        qrCodeLink: `${process.env.FRONTEND_URL || 'https://yohop.com'}/qr/deal/${accessCodeValue}`
      };
    }

    if (isFlashSaleValue) {
      response.flashSale = {
        discountPercentage: newDeal.discountPercentage,
        maxRedemptions: maxRedemptionsValue || 'unlimited',
        currentRedemptions: 0
      };
    }

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
        // Type-specific fields needed by the merchant list pages
        // (BOGO list, Hidden deals list, Bounty list).
        accessCode: true,
        bountyQRCode: true,
        bountyRewardAmount: true,
        minReferralsRequired: true,
        bountyPotAmount: true,
        bountyMaxInvites: true,
        bountyMinSpend: true,
        bogoBuyQuantity: true,
        bogoGetQuantity: true,
        bogoGetDiscountPercent: true,
        currentRedemptions: true,
        maxRedemptions: true,
        isFlashSale: true,
        dealType: { select: { name: true } },
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

// --- Endpoint: GET /api/merchants/check-ins ---
// Get all check-ins for the merchant with user details including profile pictures
router.get('/merchants/check-ins', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;

    if (!merchantId) {
      return res.status(401).json({ error: 'Merchant authentication required' });
    }

    // Parse query parameters for filtering and pagination
    const { 
      dealId, 
      startDate, 
      endDate, 
      page = '1', 
      limit = '20',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    // Validate pagination
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ error: 'Invalid page number' });
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'Limit must be between 1 and 100' });
    }

    // Build where clause
    const whereClause: any = {
      merchantId: merchantId
    };

    if (dealId) {
      const dealIdNum = parseInt(dealId as string, 10);
      if (isNaN(dealIdNum)) {
        return res.status(400).json({ error: 'Invalid deal ID' });
      }
      whereClause.dealId = dealIdNum;
    }

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        const endDateTime = new Date(endDate as string);
        endDateTime.setHours(23, 59, 59, 999);
        whereClause.createdAt.lte = endDateTime;
      }
    }

    // Build order by clause
    const validSortFields = ['createdAt', 'distanceMeters'];
    const validSortOrders = ['asc', 'desc'];
    
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'createdAt';
    const sortDirection = validSortOrders.includes(sortOrder as string) ? sortOrder as string : 'desc';

    // Fetch check-ins with user details
    const [checkIns, totalCount] = await Promise.all([
      prisma.checkIn.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
              points: true
            }
          },
          deal: {
            select: {
              id: true,
              title: true,
              description: true,
              imageUrls: true,
              category: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        },
        orderBy: {
          [sortField]: sortDirection
        },
        skip: skip,
        take: limitNum
      }),
      prisma.checkIn.count({
        where: whereClause
      })
    ]);

    // Format check-ins for response
    const formattedCheckIns = checkIns.map(checkIn => ({
      id: checkIn.id,
      userId: checkIn.userId,
      user: {
        id: checkIn.user.id,
        name: checkIn.user.name || 'Anonymous User',
        email: checkIn.user.email,
        avatarUrl: checkIn.user.avatarUrl || null,
        profilePicture: checkIn.user.avatarUrl || null, // Alias for easier frontend use
        points: checkIn.user.points
      },
      deal: {
        id: checkIn.deal.id,
        title: checkIn.deal.title,
        description: checkIn.deal.description,
        imageUrl: checkIn.deal.imageUrls && checkIn.deal.imageUrls.length > 0 
          ? checkIn.deal.imageUrls[0] 
          : null,
        category: checkIn.deal.category.name
      },
      location: {
        latitude: checkIn.latitude,
        longitude: checkIn.longitude,
        distanceMeters: Math.round(checkIn.distanceMeters * 100) / 100
      },
      checkedInAt: checkIn.createdAt.toISOString()
    }));

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    return res.status(200).json({
      success: true,
      checkIns: formattedCheckIns,
      pagination: {
        currentPage: pageNum,
        totalPages: totalPages,
        totalCount: totalCount,
        limit: limitNum,
        hasNextPage: hasNextPage,
        hasPrevPage: hasPrevPage
      },
      filters: {
        dealId: dealId ? parseInt(dealId as string) : null,
        startDate: startDate || null,
        endDate: endDate || null,
        sortBy: sortField,
        sortOrder: sortDirection
      }
    });

  } catch (error) {
    console.error('Get merchant check-ins error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/merchants/check-ins/stats ---
// Get check-in statistics and summary for the merchant
router.get('/merchants/check-ins/stats', protect, isMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant?.id;

    if (!merchantId) {
      return res.status(401).json({ error: 'Merchant authentication required' });
    }

    const { startDate, endDate, dealId } = req.query;

    // Build where clause
    const whereClause: any = {
      merchantId: merchantId
    };

    if (dealId) {
      const dealIdNum = parseInt(dealId as string, 10);
      if (!isNaN(dealIdNum)) {
        whereClause.dealId = dealIdNum;
      }
    }

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        const endDateTime = new Date(endDate as string);
        endDateTime.setHours(23, 59, 59, 999);
        whereClause.createdAt.lte = endDateTime;
      }
    }

    // Get total check-ins
    const totalCheckIns = await prisma.checkIn.count({
      where: whereClause
    });

    // Get unique users who checked in
    const uniqueUsers = await prisma.checkIn.findMany({
      where: whereClause,
      select: {
        userId: true
      },
      distinct: ['userId']
    });

    // Get check-ins by deal
    const checkInsByDeal = await prisma.checkIn.groupBy({
      by: ['dealId'],
      where: whereClause,
      _count: {
        id: true
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      },
      take: 10
    });

    // Get deal details for top deals
    const dealIds = checkInsByDeal.map(item => item.dealId);
    const deals = await prisma.deal.findMany({
      where: {
        id: { in: dealIds }
      },
      select: {
        id: true,
        title: true,
        imageUrls: true
      }
    });

    const dealMap = new Map(deals.map(deal => [deal.id, deal]));

    const topDeals = checkInsByDeal.map(item => {
      const deal = dealMap.get(item.dealId);
      return {
        dealId: item.dealId,
        dealTitle: deal?.title || 'Unknown Deal',
        dealImageUrl: deal?.imageUrls && deal.imageUrls.length > 0 ? deal.imageUrls[0] : null,
        checkInCount: item._count.id
      };
    });

    // Get recent check-ins with user info (last 5)
    const recentCheckIns = await prisma.checkIn.findMany({
      where: whereClause,
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
            title: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    const formattedRecentCheckIns = recentCheckIns.map(checkIn => ({
      id: checkIn.id,
      user: {
        id: checkIn.user.id,
        name: checkIn.user.name || 'Anonymous User',
        avatarUrl: checkIn.user.avatarUrl || null
      },
      deal: {
        id: checkIn.deal.id,
        title: checkIn.deal.title
      },
      checkedInAt: checkIn.createdAt.toISOString()
    }));

    return res.status(200).json({
      success: true,
      stats: {
        totalCheckIns: totalCheckIns,
        uniqueUsers: uniqueUsers.length,
        averageCheckInsPerUser: uniqueUsers.length > 0 
          ? Math.round((totalCheckIns / uniqueUsers.length) * 100) / 100 
          : 0
      },
      topDeals: topDeals,
      recentCheckIns: formattedRecentCheckIns,
      filters: {
        dealId: dealId ? parseInt(dealId as string) : null,
        startDate: startDate || null,
        endDate: endDate || null
      }
    });

  } catch (error) {
    console.error('Get check-in stats error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

// --- Endpoint: GET /api/merchants/me/menu ---
// Returns menu items for the authenticated merchant (any status).
// Query parameters:
// - dealType: Filter by deal type (HAPPY_HOUR_BOUNTY, HAPPY_HOUR_SURPRISE, etc.)
// - category: Filter by menu category
// - isHappyHour: Filter by Happy Hour items (true/false)
// Response: { menuItems: [ { id, name, price, category, imageUrl, isHappyHour, happyHourPrice, dealType, validStartTime, validEndTime, validDays, isSurprise, surpriseRevealTime, inventory... } ] }
router.get('/merchants/me/menu', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { dealType, category, isHappyHour } = req.query;

    // Build where clause for filtering
    const whereClause: any = { merchantId };

    // Filter by deal type
    if (dealType) {
      const validDealTypes = [
        'HAPPY_HOUR_BOUNTY', 'HAPPY_HOUR_SURPRISE', 'HAPPY_HOUR_LATE_NIGHT', 
        'HAPPY_HOUR_MID_DAY', 'HAPPY_HOUR_MORNINGS', 'REDEEM_NOW_BOUNTY', 
        'REDEEM_NOW_SURPRISE', 'STANDARD', 'RECURRING'
      ];
      
      if (validDealTypes.includes(dealType as string)) {
        whereClause.dealType = dealType;
      }
    }

    // Filter by category
    if (category) {
      whereClause.category = {
        contains: category as string,
        mode: 'insensitive'
      };
    }

    // Filter by Happy Hour status
    if (isHappyHour !== undefined) {
      whereClause.isHappyHour = isHappyHour === 'true';
    }

    // @ts-ignore - MenuItem available post generate
    const menuItems = await prisma.menuItem.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        merchantId: true,
        name: true,
        description: true,
        price: true,
        category: true,
        imageUrl: true,
        imageUrls: true,
        isAvailable: true,
        inventoryTrackingEnabled: true,
        inventoryQuantity: true,
        lowStockThreshold: true,
        allowBackorder: true,
        isHappyHour: true,
        happyHourPrice: true,
        dealType: true,
        validStartTime: true,
        validEndTime: true,
        validDays: true,
        isSurprise: true,
        surpriseRevealTime: true,
        hasVariants: true,
        createdAt: true,
        updatedAt: true,
        variants: {
          select: variantSelect,
          orderBy: { sortOrder: 'asc' as const },
        },
      }
    });
    res.status(200).json({ menuItems: menuItems.map(normalizeMenuItemResponse) });
  } catch (e) {
    console.error('Fetch menu items failed', e);
    res.status(500).json({ error: 'Failed to fetch menu items' });
  }
});

// --- Endpoint: GET /api/merchants/me/menu/by-deal-type ---
// Get menu items filtered by deal type for easy collection creation
// Query parameters:
// - dealType: Filter by deal type (HAPPY_HOUR_BOUNTY, HAPPY_HOUR_SURPRISE, etc.)
// - category: Optional category filter
// Response: { menuItems: [...], dealType: "HAPPY_HOUR_BOUNTY", total: 5 }
router.get('/merchants/me/menu/by-deal-type', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { dealType, category } = req.query;

    if (!dealType) {
      return res.status(400).json({ error: 'dealType parameter is required' });
    }

    const validDealTypes = [
      'HAPPY_HOUR_BOUNTY', 'HAPPY_HOUR_SURPRISE', 'HAPPY_HOUR_LATE_NIGHT', 
      'HAPPY_HOUR_MID_DAY', 'HAPPY_HOUR_MORNINGS', 'REDEEM_NOW_BOUNTY', 
      'REDEEM_NOW_SURPRISE', 'STANDARD', 'RECURRING'
    ];

    if (!validDealTypes.includes(dealType as string)) {
      return res.status(400).json({ 
        error: 'Invalid deal type', 
        validDealTypes 
      });
    }

    // Build where clause
    const whereClause: any = { 
      merchantId,
      dealType: dealType as string
    };

    // Optional category filter
    if (category) {
      whereClause.category = {
        contains: category as string,
        mode: 'insensitive'
      };
    }

    // @ts-ignore - MenuItem available post generate
    const [menuItems, totalCount] = await Promise.all([
      prisma.menuItem.findMany({
        where: whereClause,
        orderBy: [
          { category: 'asc' },
          { name: 'asc' }
        ],
        select: {
          id: true,
          name: true,
          price: true,
          category: true,
          imageUrl: true,
          description: true,
          isHappyHour: true,
          happyHourPrice: true,
          dealType: true,
          validStartTime: true,
          validEndTime: true,
          validDays: true,
          isSurprise: true,
          surpriseRevealTime: true,
        }
      }),
      prisma.menuItem.count({ where: whereClause })
    ]);

    res.status(200).json({ 
      menuItems,
      dealType: dealType as string,
      total: totalCount,
      category: category || null
    });
  } catch (error) {
    console.error('Get menu items by deal type error:', error);
    res.status(500).json({ error: 'Failed to fetch menu items by deal type' });
  }
});

// --- Endpoint: POST /api/merchants/me/menu-collections/from-deal-type ---
// Create a menu collection from all items of a specific deal type
router.post('/merchants/me/menu-collections/from-deal-type', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { dealType, collectionName, description, category } = req.body;

    if (!dealType) {
      return res.status(400).json({ error: 'dealType is required' });
    }

    if (!collectionName) {
      return res.status(400).json({ error: 'collectionName is required' });
    }

    const validDealTypes = [
      'HAPPY_HOUR_BOUNTY', 'HAPPY_HOUR_SURPRISE', 'HAPPY_HOUR_LATE_NIGHT', 
      'HAPPY_HOUR_MID_DAY', 'HAPPY_HOUR_MORNINGS', 'REDEEM_NOW_BOUNTY', 
      'REDEEM_NOW_SURPRISE', 'STANDARD', 'RECURRING'
    ];

    if (!validDealTypes.includes(dealType)) {
      return res.status(400).json({ 
        error: 'Invalid deal type', 
        validDealTypes 
      });
    }

    // Check if collection name already exists
    const existingCollection = await prisma.menuCollection.findFirst({
      where: { 
        merchantId, 
        name: collectionName.trim(),
        isActive: true 
      }
    });

    if (existingCollection) {
      return res.status(409).json({ error: 'A collection with this name already exists' });
    }

    // Build where clause for menu items
    const whereClause: any = { 
      merchantId,
      dealType: dealType
    };

    if (category) {
      whereClause.category = {
        contains: category,
        mode: 'insensitive'
      };
    }

    // Get all menu items of the specified deal type
    // @ts-ignore - MenuItem available post generate
    const menuItems = await prisma.menuItem.findMany({
      where: whereClause,
      orderBy: [
        { category: 'asc' },
        { name: 'asc' }
      ],
      select: {
        id: true,
        name: true,
        price: true,
        category: true,
        dealType: true,
        isHappyHour: true,
        happyHourPrice: true
      }
    });

    if (menuItems.length === 0) {
      return res.status(404).json({ 
        error: `No menu items found for deal type: ${dealType}`,
        dealType,
        category: category || null
      });
    }

    // Create collection with all items
    const collection = await prisma.$transaction(async (tx) => {
      // Create the collection
      const newCollection = await tx.menuCollection.create({
        data: {
          merchantId,
          name: collectionName.trim(),
          description: description ? description.trim() : null
        }
      });

      // Add all menu items to collection
      const collectionItems = menuItems.map((item, index) => ({
        collectionId: newCollection.id,
        menuItemId: item.id,
        sortOrder: index,
        customPrice: item.happyHourPrice || null, // Use happy hour price if available
        customDiscount: null,
        notes: `Auto-added from ${dealType} items`
      }));

      await tx.menuCollectionItem.createMany({
        data: collectionItems
      });

      return newCollection;
    });

    // Fetch the created collection with items
    const createdCollection = await prisma.menuCollection.findUnique({
      where: { id: collection.id },
      include: {
        items: {
          include: {
            menuItem: {
              select: menuCollectionMenuItemSelect
            }
          },
          orderBy: { sortOrder: 'asc' }
        },
        _count: {
          select: { items: true }
        }
      }
    });

    res.status(201).json({ 
      collection: createdCollection,
      message: `Created collection "${collectionName}" with ${menuItems.length} items from ${dealType}`,
      dealType,
      itemsAdded: menuItems.length
    });
  } catch (error) {
    console.error('Create collection from deal type error:', error);
    res.status(500).json({ error: 'Failed to create collection from deal type' });
  }
});

// --- Endpoint: POST /api/merchants/me/menu/item ---
// Create a new menu item for the merchant (any status)
router.post('/merchants/me/menu/item', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { 
      name, 
      price, 
      category, 
      description, 
      imageUrl,
      isHappyHour,
      happyHourPrice,
      dealType,
      validStartTime,
      validEndTime,
      validDays,
      isSurprise,
      surpriseRevealTime,
      isAvailable,
      inventoryTrackingEnabled,
      inventoryQuantity,
      lowStockThreshold,
      allowBackorder,
      hasVariants,
      variants,
      isBulkOrderEnabled,
      defaultPeopleCount,
      minPeopleCount,
    } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (price === undefined || price === null || isNaN(Number(price)) || Number(price) <= 0) {
      return res.status(400).json({ error: 'price must be a positive number' });
    }
    if (!category || typeof category !== 'string' || category.trim().length === 0) {
      return res.status(400).json({ error: 'category is required' });
    }

    // Validate Happy Hour fields
    if (isHappyHour !== undefined && typeof isHappyHour !== 'boolean') {
      return res.status(400).json({ error: 'isHappyHour must be a boolean' });
    }
    if (happyHourPrice !== undefined && happyHourPrice !== null) {
      if (isNaN(Number(happyHourPrice)) || Number(happyHourPrice) <= 0) {
        return res.status(400).json({ error: 'happyHourPrice must be a positive number' });
      }
    }

    // Validate deal type
    const validDealTypes = [
      'HAPPY_HOUR_BOUNTY', 'HAPPY_HOUR_SURPRISE', 'HAPPY_HOUR_LATE_NIGHT', 
      'HAPPY_HOUR_MID_DAY', 'HAPPY_HOUR_MORNINGS', 'REDEEM_NOW_BOUNTY', 
      'REDEEM_NOW_SURPRISE', 'STANDARD', 'RECURRING'
    ];
    if (dealType !== undefined && !validDealTypes.includes(dealType)) {
      return res.status(400).json({ error: `dealType must be one of: ${validDealTypes.join(', ')}` });
    }

    // Validate time fields
    if (validStartTime !== undefined && validStartTime !== null) {
      if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(validStartTime)) {
        return res.status(400).json({ error: 'validStartTime must be in HH:MM format' });
      }
    }
    if (validEndTime !== undefined && validEndTime !== null) {
      if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(validEndTime)) {
        return res.status(400).json({ error: 'validEndTime must be in HH:MM format' });
      }
    }
    if (surpriseRevealTime !== undefined && surpriseRevealTime !== null) {
      if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(surpriseRevealTime)) {
        return res.status(400).json({ error: 'surpriseRevealTime must be in HH:MM format' });
      }
    }

    // Validate surprise fields
    if (isSurprise !== undefined && typeof isSurprise !== 'boolean') {
      return res.status(400).json({ error: 'isSurprise must be a boolean' });
    }

    let inventoryData: Record<string, any> = {};
    try {
      inventoryData = buildInventoryUpdateData(
        {
          isAvailable,
          inventoryTrackingEnabled,
          inventoryQuantity,
          lowStockThreshold,
          allowBackorder,
        },
        true,
      );
    } catch (inventoryError: any) {
      return res.status(400).json({ error: inventoryError.message || 'Invalid inventory data' });
    }

    let bulkOrderData: Record<string, any> = {};
    try {
      bulkOrderData = buildBulkOrderUpdateData(
        { isBulkOrderEnabled, defaultPeopleCount, minPeopleCount },
        true,
      );
    } catch (bulkOrderError: any) {
      return res.status(400).json({ error: bulkOrderError.message || 'Invalid bulk order data' });
    }

    // Build variant create data if provided
    const shouldHaveVariants = hasVariants === true && Array.isArray(variants) && variants.length > 0;
    const variantCreateData = shouldHaveVariants
      ? variants.map((v: any, i: number) => ({
          sku: v.sku?.trim() || generateSku(name.trim(), v.label?.trim() || `V${i + 1}`, merchantId),
          label: String(v.label || '').trim(),
          price: Number(v.price),
          servesCount: v.servesCount != null && v.servesCount !== '' ? Number(v.servesCount) : null,
          inventoryQuantity: v.inventoryQuantity != null ? Number(v.inventoryQuantity) : null,
          lowStockThreshold: v.lowStockThreshold != null ? Number(v.lowStockThreshold) : null,
          isAvailable: v.isAvailable !== false,
          sortOrder: v.sortOrder ?? i,
        }))
      : [];

    // Validate variant data
    for (const v of variantCreateData) {
      if (!v.label) return res.status(400).json({ error: 'Each variant must have a label' });
      if (isNaN(v.price) || v.price <= 0) return res.status(400).json({ error: `Variant "${v.label}" must have a positive price` });
      if (v.servesCount != null && (!Number.isInteger(v.servesCount) || v.servesCount < 1)) {
        return res.status(400).json({ error: `Variant "${v.label}" servesCount must be a positive integer` });
      }
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
        isHappyHour: Boolean(isHappyHour) || false,
        happyHourPrice: happyHourPrice !== undefined && happyHourPrice !== null ? Number(happyHourPrice) : null,
        dealType: dealType || 'STANDARD',
        validStartTime: validStartTime ? String(validStartTime).trim() : null,
        validEndTime: validEndTime ? String(validEndTime).trim() : null,
        validDays: validDays ? String(validDays).trim() : null,
        isSurprise: Boolean(isSurprise) || false,
        surpriseRevealTime: surpriseRevealTime ? String(surpriseRevealTime).trim() : null,
        hasVariants: shouldHaveVariants,
        ...inventoryData,
        ...bulkOrderData,
        ...(shouldHaveVariants ? { variants: { create: variantCreateData } } : {}),
      },
      select: {
        id: true,
        merchantId: true,
        name: true,
        price: true,
        category: true,
        imageUrl: true,
        imageUrls: true,
        description: true,
        isAvailable: true,
        inventoryTrackingEnabled: true,
        inventoryQuantity: true,
        lowStockThreshold: true,
        allowBackorder: true,
        isBulkOrderEnabled: true,
        defaultPeopleCount: true,
        minPeopleCount: true,
        isHappyHour: true,
        happyHourPrice: true,
        dealType: true,
        validStartTime: true,
        validEndTime: true,
        validDays: true,
        isSurprise: true,
        surpriseRevealTime: true,
        hasVariants: true,
        createdAt: true,
        updatedAt: true,
        variants: {
          select: variantSelect,
          orderBy: { sortOrder: 'asc' as const },
        },
      }
    });
    res.status(201).json({ menuItem: normalizeMenuItemResponse(created) });
  } catch (e) {
    console.error('Create menu item failed', e);
    res.status(500).json({ error: 'Failed to create menu item' });
  }
});

// --- Endpoint: POST /api/merchants/me/menu/bulk-upload ---
// Bulk upload menu items from Excel/CSV file
router.post('/merchants/me/menu/bulk-upload', protect, isMerchant, excelUpload.single('file'), async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please upload an Excel (.xlsx, .xls) or CSV file.' });
    }

    // Parse the Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    if (!jsonData || jsonData.length === 0) {
      return res.status(400).json({ error: 'The uploaded file is empty or has no valid data.' });
    }

    // Validate and prepare menu items
    const validDealTypes = [
      'HAPPY_HOUR_BOUNTY', 'HAPPY_HOUR_SURPRISE', 'HAPPY_HOUR_LATE_NIGHT', 
      'HAPPY_HOUR_MID_DAY', 'HAPPY_HOUR_MORNINGS', 'REDEEM_NOW_BOUNTY', 
      'REDEEM_NOW_SURPRISE', 'STANDARD', 'RECURRING'
    ];

    const validDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

    const errors: Array<{ row: number; field: string; message: string }> = [];
    const menuItems: any[] = [];

    // Process each row
    jsonData.forEach((row: any, index: number) => {
      const rowNumber = index + 2; // Excel row number (1-indexed + header row)
      const item: any = {
        merchantId,
      };

      // Required fields validation
      if (!row.name || typeof row.name !== 'string' || row.name.trim().length === 0) {
        errors.push({ row: rowNumber, field: 'name', message: 'Name is required and must be a non-empty string' });
      } else {
        item.name = row.name.trim();
      }

      if (row.price === undefined || row.price === null || isNaN(Number(row.price)) || Number(row.price) <= 0) {
        errors.push({ row: rowNumber, field: 'price', message: 'Price must be a positive number' });
      } else {
        item.price = Number(row.price);
      }

      if (!row.category || typeof row.category !== 'string' || row.category.trim().length === 0) {
        errors.push({ row: rowNumber, field: 'category', message: 'Category is required' });
      } else {
        item.category = row.category.trim();
      }

      // Optional fields
      if (row.description) {
        item.description = String(row.description).trim();
      }

      if (row.imageUrl) {
        item.imageUrl = String(row.imageUrl).trim();
      }

      if (row.isAvailable !== undefined && row.isAvailable !== null && row.isAvailable !== '') {
        const available = String(row.isAvailable).toLowerCase();
        if (['true', '1', 'yes'].includes(available)) {
          item.isAvailable = true;
        } else if (['false', '0', 'no'].includes(available)) {
          item.isAvailable = false;
        } else {
          errors.push({ row: rowNumber, field: 'isAvailable', message: 'isAvailable must be true/false, yes/no, or 1/0' });
        }
      } else {
        item.isAvailable = true;
      }

      if (row.inventoryTrackingEnabled !== undefined && row.inventoryTrackingEnabled !== null && row.inventoryTrackingEnabled !== '') {
        const tracking = String(row.inventoryTrackingEnabled).toLowerCase();
        if (['true', '1', 'yes'].includes(tracking)) {
          item.inventoryTrackingEnabled = true;
        } else if (['false', '0', 'no'].includes(tracking)) {
          item.inventoryTrackingEnabled = false;
        } else {
          errors.push({ row: rowNumber, field: 'inventoryTrackingEnabled', message: 'inventoryTrackingEnabled must be true/false, yes/no, or 1/0' });
        }
      } else {
        item.inventoryTrackingEnabled = false;
      }

      if (row.inventoryQuantity !== undefined && row.inventoryQuantity !== null && row.inventoryQuantity !== '') {
        if (!Number.isInteger(Number(row.inventoryQuantity)) || Number(row.inventoryQuantity) < 0) {
          errors.push({ row: rowNumber, field: 'inventoryQuantity', message: 'inventoryQuantity must be a non-negative integer' });
        } else {
          item.inventoryQuantity = Number(row.inventoryQuantity);
        }
      }

      if (row.lowStockThreshold !== undefined && row.lowStockThreshold !== null && row.lowStockThreshold !== '') {
        if (!Number.isInteger(Number(row.lowStockThreshold)) || Number(row.lowStockThreshold) < 0) {
          errors.push({ row: rowNumber, field: 'lowStockThreshold', message: 'lowStockThreshold must be a non-negative integer' });
        } else {
          item.lowStockThreshold = Number(row.lowStockThreshold);
        }
      }

      if (row.allowBackorder !== undefined && row.allowBackorder !== null && row.allowBackorder !== '') {
        const backorder = String(row.allowBackorder).toLowerCase();
        if (['true', '1', 'yes'].includes(backorder)) {
          item.allowBackorder = true;
        } else if (['false', '0', 'no'].includes(backorder)) {
          item.allowBackorder = false;
        } else {
          errors.push({ row: rowNumber, field: 'allowBackorder', message: 'allowBackorder must be true/false, yes/no, or 1/0' });
        }
      } else {
        item.allowBackorder = false;
      }

      if (item.inventoryTrackingEnabled === true && item.inventoryQuantity === undefined) {
        errors.push({ row: rowNumber, field: 'inventoryQuantity', message: 'inventoryQuantity is required when inventoryTrackingEnabled is true' });
      }

      // Happy Hour fields
      if (row.isHappyHour !== undefined) {
        const isHH = String(row.isHappyHour).toLowerCase();
        if (['true', '1', 'yes'].includes(isHH)) {
          item.isHappyHour = true;
        } else if (['false', '0', 'no'].includes(isHH)) {
          item.isHappyHour = false;
        } else {
          errors.push({ row: rowNumber, field: 'isHappyHour', message: 'isHappyHour must be true/false, yes/no, or 1/0' });
        }
      } else {
        item.isHappyHour = false;
      }

      if (row.happyHourPrice !== undefined && row.happyHourPrice !== null && row.happyHourPrice !== '') {
        if (isNaN(Number(row.happyHourPrice)) || Number(row.happyHourPrice) <= 0) {
          errors.push({ row: rowNumber, field: 'happyHourPrice', message: 'happyHourPrice must be a positive number' });
        } else {
          item.happyHourPrice = Number(row.happyHourPrice);
        }
      }

      // Deal type validation
      if (row.dealType) {
        const dealType = String(row.dealType).trim().toUpperCase().replace(/\s+/g, '_');
        if (!validDealTypes.includes(dealType)) {
          errors.push({ row: rowNumber, field: 'dealType', message: `dealType must be one of: ${validDealTypes.join(', ')}` });
        } else {
          item.dealType = dealType;
        }
      } else {
        item.dealType = 'STANDARD';
      }

      // Time validation
      if (row.validStartTime) {
        const time = String(row.validStartTime).trim();
        if (!timeRegex.test(time)) {
          errors.push({ row: rowNumber, field: 'validStartTime', message: 'validStartTime must be in HH:MM format (e.g., 17:00)' });
        } else {
          item.validStartTime = time;
        }
      }

      if (row.validEndTime) {
        const time = String(row.validEndTime).trim();
        if (!timeRegex.test(time)) {
          errors.push({ row: rowNumber, field: 'validEndTime', message: 'validEndTime must be in HH:MM format (e.g., 19:00)' });
        } else {
          item.validEndTime = time;
        }
      }

      // Valid days validation
      if (row.validDays) {
        const days = String(row.validDays).toUpperCase().split(',').map((d: string) => d.trim());
        const invalidDays = days.filter((d: string) => !validDays.includes(d));
        if (invalidDays.length > 0) {
          errors.push({ row: rowNumber, field: 'validDays', message: `Invalid days: ${invalidDays.join(', ')}. Must be comma-separated: ${validDays.join(', ')}` });
        } else {
          item.validDays = days.join(',');
        }
      }

      // Surprise deal fields
      if (row.isSurprise !== undefined) {
        const isSurp = String(row.isSurprise).toLowerCase();
        if (['true', '1', 'yes'].includes(isSurp)) {
          item.isSurprise = true;
        } else if (['false', '0', 'no'].includes(isSurp)) {
          item.isSurprise = false;
        } else {
          errors.push({ row: rowNumber, field: 'isSurprise', message: 'isSurprise must be true/false, yes/no, or 1/0' });
        }
      } else {
        item.isSurprise = false;
      }

      if (row.surpriseRevealTime) {
        const time = String(row.surpriseRevealTime).trim();
        if (!timeRegex.test(time)) {
          errors.push({ row: rowNumber, field: 'surpriseRevealTime', message: 'surpriseRevealTime must be in HH:MM format' });
        } else {
          item.surpriseRevealTime = time;
        }
      }

      // Only add if no errors for this row
      if (errors.filter(e => e.row === rowNumber).length === 0) {
        menuItems.push(item);
      }
    });

    // If there are validation errors, return them
    if (errors.length > 0) {
      return res.status(400).json({ 
        error: 'Validation failed for some rows',
        errors,
        totalRows: jsonData.length,
        validRows: menuItems.length,
        errorRows: errors.length
      });
    }

    // Bulk insert menu items
    // @ts-ignore
    const created = await prisma.menuItem.createMany({
      data: menuItems,
      skipDuplicates: true
    });

    res.status(201).json({ 
      message: `Successfully uploaded ${created.count} menu items`,
      created: created.count,
      totalRows: jsonData.length,
      skipped: jsonData.length - created.count
    });

  } catch (e: any) {
    console.error('Bulk upload menu items failed', e);
    if (e.message && e.message.includes('Only Excel')) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: 'Failed to upload menu items', details: e.message });
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

    const { 
      name, 
      price, 
      category, 
      description, 
      imageUrl, 
      isHappyHour, 
      happyHourPrice,
      dealType,
      validStartTime,
      validEndTime,
      validDays,
      isSurprise,
      surpriseRevealTime,
      isAvailable,
      inventoryTrackingEnabled,
      inventoryQuantity,
      lowStockThreshold,
      allowBackorder,
      hasVariants: hasVariantsInput,
      variants: variantsInput,
      isBulkOrderEnabled,
      defaultPeopleCount,
      minPeopleCount,
    } = req.body || {};
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
    if (isHappyHour !== undefined) {
      if (typeof isHappyHour !== 'boolean') return res.status(400).json({ error: 'isHappyHour must be a boolean' });
      data.isHappyHour = isHappyHour;
    }
    if (happyHourPrice !== undefined) {
      if (happyHourPrice !== null && (isNaN(Number(happyHourPrice)) || Number(happyHourPrice) <= 0)) {
        return res.status(400).json({ error: 'happyHourPrice must be a positive number or null' });
      }
      data.happyHourPrice = happyHourPrice !== null ? Number(happyHourPrice) : null;
    }
    if (dealType !== undefined) {
      const validDealTypes = [
        'HAPPY_HOUR_BOUNTY', 'HAPPY_HOUR_SURPRISE', 'HAPPY_HOUR_LATE_NIGHT', 
        'HAPPY_HOUR_MID_DAY', 'HAPPY_HOUR_MORNINGS', 'REDEEM_NOW_BOUNTY', 
        'REDEEM_NOW_SURPRISE', 'STANDARD', 'RECURRING'
      ];
      if (!validDealTypes.includes(dealType)) {
        return res.status(400).json({ error: `dealType must be one of: ${validDealTypes.join(', ')}` });
      }
      data.dealType = dealType;
    }
    if (validStartTime !== undefined) {
      if (validStartTime !== null && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(validStartTime)) {
        return res.status(400).json({ error: 'validStartTime must be in HH:MM format or null' });
      }
      data.validStartTime = validStartTime ? String(validStartTime).trim() : null;
    }
    if (validEndTime !== undefined) {
      if (validEndTime !== null && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(validEndTime)) {
        return res.status(400).json({ error: 'validEndTime must be in HH:MM format or null' });
      }
      data.validEndTime = validEndTime ? String(validEndTime).trim() : null;
    }
    if (validDays !== undefined) {
      data.validDays = validDays ? String(validDays).trim() : null;
    }
    if (isSurprise !== undefined) {
      if (typeof isSurprise !== 'boolean') return res.status(400).json({ error: 'isSurprise must be a boolean' });
      data.isSurprise = isSurprise;
    }
    if (surpriseRevealTime !== undefined) {
      if (surpriseRevealTime !== null && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(surpriseRevealTime)) {
        return res.status(400).json({ error: 'surpriseRevealTime must be in HH:MM format or null' });
      }
      data.surpriseRevealTime = surpriseRevealTime ? String(surpriseRevealTime).trim() : null;
    }

    try {
      Object.assign(
        data,
        buildInventoryUpdateData({
          isAvailable,
          inventoryTrackingEnabled,
          inventoryQuantity,
          lowStockThreshold,
          allowBackorder,
        }),
      );
    } catch (inventoryError: any) {
      return res.status(400).json({ error: inventoryError.message || 'Invalid inventory data' });
    }

    try {
      Object.assign(
        data,
        buildBulkOrderUpdateData({
          isBulkOrderEnabled,
          defaultPeopleCount,
          minPeopleCount,
        }),
      );
    } catch (bulkOrderError: any) {
      return res.status(400).json({ error: bulkOrderError.message || 'Invalid bulk order data' });
    }

    // Handle variants
    const shouldHaveVariants = hasVariantsInput === true && Array.isArray(variantsInput) && variantsInput.length > 0;
    if (hasVariantsInput !== undefined) {
      data.hasVariants = shouldHaveVariants;
    }

    if (Object.keys(data).length === 0 && !shouldHaveVariants) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    const updateSelect = {
      id: true,
      merchantId: true,
      name: true,
      price: true,
      category: true,
      imageUrl: true,
      imageUrls: true,
      description: true,
      isAvailable: true,
      inventoryTrackingEnabled: true,
      inventoryQuantity: true,
      lowStockThreshold: true,
      allowBackorder: true,
      isBulkOrderEnabled: true,
      defaultPeopleCount: true,
      minPeopleCount: true,
      isHappyHour: true,
      happyHourPrice: true,
      dealType: true,
      validStartTime: true,
      validEndTime: true,
      validDays: true,
      isSurprise: true,
      surpriseRevealTime: true,
      hasVariants: true,
      createdAt: true,
      updatedAt: true,
      variants: {
        select: variantSelect,
        orderBy: { sortOrder: 'asc' as const },
      },
    };

    if (shouldHaveVariants) {
      // Validate incoming variants
      for (const v of variantsInput) {
        if (!v.label || String(v.label).trim().length === 0) {
          return res.status(400).json({ error: 'Each variant must have a label' });
        }
        if (v.price === undefined || isNaN(Number(v.price)) || Number(v.price) <= 0) {
          return res.status(400).json({ error: `Variant "${v.label}" must have a positive price` });
        }
      }

      // Get the item name for SKU generation (use incoming or fetch existing)
      const itemName = data.name || (await prisma.menuItem.findUnique({ where: { id: itemId }, select: { name: true } }))?.name || 'ITEM';

      // Diff: figure out which to create, update, delete
      // @ts-ignore
      const existingVariants = await prisma.menuItemVariant.findMany({
        where: { menuItemId: itemId },
        select: { id: true },
      });
      const existingIds = new Set(existingVariants.map((v: any) => v.id));
      const incomingIds = new Set(variantsInput.filter((v: any) => v.id).map((v: any) => v.id));
      const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));

      // Use transaction for atomicity
      // @ts-ignore
      const updated = await prisma.$transaction(async (tx: any) => {
        // Delete removed variants
        if (toDelete.length > 0) {
          await tx.menuItemVariant.deleteMany({
            where: { id: { in: toDelete }, menuItemId: itemId },
          });
        }

        // Upsert each variant
        for (let i = 0; i < variantsInput.length; i++) {
          const v = variantsInput[i];
          const variantData = {
            label: String(v.label).trim(),
            price: Number(v.price),
            servesCount: v.servesCount != null && v.servesCount !== '' ? Number(v.servesCount) : null,
            inventoryQuantity: v.inventoryQuantity != null ? Number(v.inventoryQuantity) : null,
            lowStockThreshold: v.lowStockThreshold != null ? Number(v.lowStockThreshold) : null,
            isAvailable: v.isAvailable !== false,
            sortOrder: v.sortOrder ?? i,
          };

          if (variantData.servesCount != null && (!Number.isInteger(variantData.servesCount) || variantData.servesCount < 1)) {
            return res.status(400).json({ error: `Variant "${variantData.label}" servesCount must be a positive integer` });
          }

          if (v.id && existingIds.has(v.id)) {
            // Update existing
            await tx.menuItemVariant.update({
              where: { id: v.id },
              data: {
                ...variantData,
                ...(v.sku ? { sku: v.sku.trim() } : {}),
              },
            });
          } else {
            // Create new
            await tx.menuItemVariant.create({
              data: {
                menuItemId: itemId,
                sku: v.sku?.trim() || generateSku(itemName, variantData.label, merchantId),
                ...variantData,
              },
            });
          }
        }

        // Update the menu item itself
        return tx.menuItem.update({
          where: { id: itemId },
          data,
          select: updateSelect,
        });
      });

      return res.status(200).json({ menuItem: normalizeMenuItemResponse(updated) });
    }

    // No variants path — if turning off variants, delete all existing ones
    if (hasVariantsInput === false) {
      // @ts-ignore
      await prisma.menuItemVariant.deleteMany({ where: { menuItemId: itemId } });
    }

    // @ts-ignore
    const updated = await prisma.menuItem.update({
      where: { id: itemId },
      data,
      select: updateSelect,
    });
    res.status(200).json({ menuItem: normalizeMenuItemResponse(updated) });
  } catch (e) {
    console.error('Update menu item failed', e);
    res.status(500).json({ error: 'Failed to update menu item' });
  }
});

router.patch('/merchants/me/menu/item/:itemId/inventory', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'Invalid itemId' });

    // @ts-ignore
    const existing = await prisma.menuItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        merchantId: true,
        name: true,
        isAvailable: true,
        inventoryTrackingEnabled: true,
        inventoryQuantity: true,
        lowStockThreshold: true,
        allowBackorder: true,
      },
    });

    if (!existing || existing.merchantId !== merchantId) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    const mergedPayload = {
      isAvailable: req.body?.isAvailable ?? existing.isAvailable,
      inventoryTrackingEnabled: req.body?.inventoryTrackingEnabled ?? existing.inventoryTrackingEnabled,
      inventoryQuantity: req.body?.inventoryQuantity ?? existing.inventoryQuantity,
      lowStockThreshold: req.body?.lowStockThreshold ?? existing.lowStockThreshold,
      allowBackorder: req.body?.allowBackorder ?? existing.allowBackorder,
    };

    let inventoryData: Record<string, any> = {};
    try {
      inventoryData = buildInventoryUpdateData(mergedPayload);
    } catch (inventoryError: any) {
      return res.status(400).json({ error: inventoryError.message || 'Invalid inventory data' });
    }

    // @ts-ignore
    const updated = await prisma.menuItem.update({
      where: { id: itemId },
      data: inventoryData,
      select: {
        id: true,
        merchantId: true,
        name: true,
        price: true,
        category: true,
        imageUrl: true,
        imageUrls: true,
        description: true,
        isAvailable: true,
        inventoryTrackingEnabled: true,
        inventoryQuantity: true,
        lowStockThreshold: true,
        allowBackorder: true,
        isHappyHour: true,
        happyHourPrice: true,
        dealType: true,
        validStartTime: true,
        validEndTime: true,
        validDays: true,
        isSurprise: true,
        surpriseRevealTime: true,
        hasVariants: true,
        isBulkOrderEnabled: true,
        defaultPeopleCount: true,
        minPeopleCount: true,
        createdAt: true,
        updatedAt: true,
        variants: {
          select: variantSelect,
          orderBy: { sortOrder: 'asc' as const },
        },
      },
    });

    const inventoryAlert = buildMenuItemInventoryAlert(existing, updated, updated.name);
    res.status(200).json({ menuItem: normalizeMenuItemResponse(updated), inventoryAlert });
  } catch (error) {
    console.error('Update menu item inventory failed', error);
    res.status(500).json({ error: 'Failed to update menu item inventory' });
  }
});

// --- Endpoint: PATCH /api/merchants/me/menu/item/:itemId/variant/:variantId/inventory ---
// Update inventory for a specific variant
router.patch('/merchants/me/menu/item/:itemId/variant/:variantId/inventory', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const itemId = Number(req.params.itemId);
    const variantId = Number(req.params.variantId);
    if (!Number.isFinite(itemId) || !Number.isFinite(variantId)) {
      return res.status(400).json({ error: 'Invalid itemId or variantId' });
    }

    // Verify menu item belongs to merchant
    // @ts-ignore
    const menuItem = await prisma.menuItem.findUnique({
      where: { id: itemId },
      select: { id: true, merchantId: true, name: true },
    });
    if (!menuItem || menuItem.merchantId !== merchantId) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    // Verify variant belongs to menu item
    // @ts-ignore
    const existingVariant = await prisma.menuItemVariant.findFirst({
      where: { id: variantId, menuItemId: itemId },
    });
    if (!existingVariant) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    const { inventoryQuantity, lowStockThreshold, isAvailable } = req.body || {};
    const updateData: Record<string, any> = {};

    if (inventoryQuantity !== undefined) {
      if (inventoryQuantity === null) {
        updateData.inventoryQuantity = null;
      } else if (!Number.isInteger(Number(inventoryQuantity)) || Number(inventoryQuantity) < 0) {
        return res.status(400).json({ error: 'inventoryQuantity must be a non-negative integer or null' });
      } else {
        updateData.inventoryQuantity = Number(inventoryQuantity);
      }
    }

    if (lowStockThreshold !== undefined) {
      if (lowStockThreshold === null) {
        updateData.lowStockThreshold = null;
      } else if (!Number.isInteger(Number(lowStockThreshold)) || Number(lowStockThreshold) < 0) {
        return res.status(400).json({ error: 'lowStockThreshold must be a non-negative integer or null' });
      } else {
        updateData.lowStockThreshold = Number(lowStockThreshold);
      }
    }

    if (isAvailable !== undefined) {
      if (typeof isAvailable !== 'boolean') {
        return res.status(400).json({ error: 'isAvailable must be a boolean' });
      }
      updateData.isAvailable = isAvailable;
    }

    // @ts-ignore
    const updated = await prisma.menuItemVariant.update({
      where: { id: variantId },
      data: updateData,
      select: variantSelect,
    });

    const inventoryAlert = buildVariantInventoryAlert(
      existingVariant,
      updated,
      menuItem.name,
      updated.label,
    );
    res
      .status(200)
      .json({ variant: { ...updated, inventoryStatus: getVariantInventoryStatus(updated) }, inventoryAlert });
  } catch (error) {
    console.error('Update variant inventory failed', error);
    res.status(500).json({ error: 'Failed to update variant inventory' });
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
// List stores for the authenticated approved merchant.
// For food-truck stores, the response includes `currentStop` and `nextStop`
// resolved server-side from the truck's posted schedule.
router.get('/merchants/stores', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });
    // @ts-ignore
    const stores = await prisma.store.findMany({ where: { merchantId }, include: { city: true } });

    const truckIds = stores.filter((s: any) => s.isFoodTruck).map((s: any) => s.id);
    const now = new Date();
    const scheduleMap = truckIds.length
      ? await resolveScheduleStatusFor(truckIds, now)
      : new Map();

    const enrichedStores = stores.map((store: any) => {
      const status = store.isFoodTruck ? scheduleMap.get(store.id) : null;
      return {
        ...store,
        currentStop: status?.current ? annotateStopStatus(status.current, now) : null,
        nextStop: status?.next ? annotateStopStatus(status.next, now) : null,
      };
    });

    res.status(200).json({ total: enrichedStores.length, stores: enrichedStores });
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

    const { address, latitude, longitude, cityId, active, description, operatingHours, galleryUrls, isFoodTruck } = req.body || {};
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

    const galleryArray = Array.isArray(galleryUrls) ? galleryUrls : typeof galleryUrls === 'string' ? (galleryUrls ? [galleryUrls] : []) : [];
    const hours = operatingHours && typeof operatingHours === 'object' ? operatingHours : null;

    // @ts-ignore
    const store = await prisma.store.create({
      data: {
        merchantId,
        cityId: resolvedCityId,
        address,
        latitude: lat,
        longitude: lon,
        active: typeof active === 'boolean' ? active : true,
        operatingHours: hours,
        galleryUrls: galleryArray,
        isFoodTruck: typeof isFoodTruck === 'boolean' ? isFoodTruck : false,
      },
      include: { city: true }
    });
    res.status(201).json({ message: 'Store created', store });
  } catch (e) {
    console.error('Create store failed', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: PUT /api/merchants/stores/:storeId ---
// Update a store for the authenticated approved merchant
router.put('/merchants/stores/:storeId', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const storeId = parseInt(req.params.storeId as string, 10);
    if (isNaN(storeId)) return res.status(400).json({ error: 'Invalid store ID' });

    const existing = await prisma.store.findFirst({ where: { id: storeId, merchantId } });
    if (!existing) return res.status(404).json({ error: 'Store not found' });

    const { address, latitude, longitude, cityId, active, description, operatingHours, galleryUrls, isFoodTruck } = req.body || {};

    const updateData: Record<string, unknown> = {};
    if (address !== undefined) updateData.address = address;
    if (cityId !== undefined) {
      const city = await prisma.city.findUnique({ where: { id: Number(cityId) } });
      if (!city || !city.active) return res.status(400).json({ error: 'Invalid or inactive city' });
      updateData.cityId = city.id;
    }
    if (latitude !== undefined) updateData.latitude = latitude === null || latitude === '' ? null : parseFloat(latitude);
    if (longitude !== undefined) updateData.longitude = longitude === null || longitude === '' ? null : parseFloat(longitude);
    if (typeof active === 'boolean') updateData.active = active;
    if (description !== undefined) updateData.description = description || null;
    if (operatingHours !== undefined) updateData.operatingHours = operatingHours && typeof operatingHours === 'object' ? operatingHours : null;
    if (galleryUrls !== undefined) updateData.galleryUrls = Array.isArray(galleryUrls) ? galleryUrls : [];
    if (typeof isFoodTruck === 'boolean') updateData.isFoodTruck = isFoodTruck;

    const store = await prisma.store.update({
      where: { id: storeId },
      data: updateData,
      include: { city: true }
    });
    res.status(200).json({ message: 'Store updated', store });
  } catch (e) {
    console.error('Update store failed', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: DELETE /api/merchants/stores/:storeId ---
// Delete a store for the authenticated approved merchant
router.delete('/merchants/stores/:storeId', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const storeId = parseInt(req.params.storeId as string, 10);
    if (isNaN(storeId)) return res.status(400).json({ error: 'Invalid store ID' });

    // Verify the store belongs to this merchant
    // @ts-ignore
    const store = await prisma.store.findFirst({
      where: { id: storeId, merchantId },
    });

    if (!store) {
      return res.status(404).json({ error: 'Store not found or you do not have permission to delete it' });
    }

    // Delete the store
    // @ts-ignore
    await prisma.store.delete({
      where: { id: storeId },
    });

    res.status(200).json({ message: 'Store deleted successfully' });
  } catch (e) {
    console.error('Delete store failed', e);
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

// ========================================
// MENU COLLECTIONS ENDPOINTS
// ========================================

// --- Endpoint: GET /api/merchants/me/menu-collections ---
// Get all menu collections for the authenticated merchant
router.get('/merchants/me/menu-collections', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    // Optional filter by menuType (STANDARD, HAPPY_HOUR, SPECIAL)
    const menuTypeFilter = req.query.menuType as string | undefined;
    const storeIdStr = req.query.storeId as string | undefined;
    const whereClause: any = { merchantId };
    
    if (menuTypeFilter && ['STANDARD', 'HAPPY_HOUR', 'SPECIAL'].includes(menuTypeFilter)) {
      whereClause.menuType = menuTypeFilter;
    }
    
    if (storeIdStr && !isNaN(Number(storeIdStr))) {
      whereClause.storeId = Number(storeIdStr);
    }

    const collections = await prisma.menuCollection.findMany({
      where: whereClause,
      include: {
        items: {
          include: {
            menuItem: {
              select: menuCollectionMenuItemSelect
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

    res.status(200).json({ collections: collections.map((collection) => normalizeCollectionResponse(collection)) });
  } catch (error) {
    console.error('Get menu collections error:', error);
    res.status(500).json({ error: 'Failed to fetch menu collections' });
  }
});

// --- Endpoint: POST /api/merchants/me/menu-collections ---
// Create a new menu collection
router.post('/merchants/me/menu-collections', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const {
      name,
      description,
      menuItems,
      menuType,
      subType,
      startTime,
      endTime,
      themeName,
      icon,
      color,
      storeId,
      coverImageUrl,
      servesCount,
      packagePrice,
      displayOrder,
    } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    if (name.trim().length > 100) {
      return res.status(400).json({ error: 'Collection name must be 100 characters or less' });
    }

    // Validate menuType if provided
    const validMenuTypes = ['STANDARD', 'HAPPY_HOUR', 'SPECIAL'];
    if (menuType && !validMenuTypes.includes(menuType)) {
      return res.status(400).json({ error: 'Invalid menu type. Must be STANDARD, HAPPY_HOUR, or SPECIAL' });
    }

    let normalizedDescription: string | null | undefined;
    let normalizedThemeName: string | null | undefined;
    let normalizedIcon: string | null | undefined;
    let normalizedColor: string | null | undefined;
    let normalizedCoverImageUrl: string | null | undefined;
    let normalizedServesCount: number | null | undefined;
    let normalizedPackagePrice: number | null | undefined;
    let normalizedDisplayOrder: number | null | undefined;

    try {
      normalizedDescription = normalizeOptionalTrimmedString(description, 500);
      normalizedThemeName = normalizeOptionalTrimmedString(themeName, 100);
      normalizedIcon = normalizeOptionalTrimmedString(icon, 50);
      normalizedColor = normalizeOptionalTrimmedString(color, 32);
      normalizedCoverImageUrl = normalizeOptionalTrimmedString(coverImageUrl, 2048);
      normalizedServesCount = normalizeOptionalPositiveInteger(servesCount, 'servesCount');
      normalizedPackagePrice = normalizeOptionalNonNegativeFloat(packagePrice, 'packagePrice');
      normalizedDisplayOrder = normalizeOptionalNonNegativeInteger(displayOrder, 'displayOrder');
    } catch (validationError) {
      return res.status(400).json({
        error: validationError instanceof Error ? validationError.message : 'Invalid collection metadata',
      });
    }

    // Check if collection name already exists for this merchant
    const existingCollection = await prisma.menuCollection.findFirst({
      where: { 
        merchantId, 
        name: name.trim(),
        isActive: true 
      }
    });

    if (existingCollection) {
      return res.status(409).json({ error: 'A collection with this name already exists' });
    }

    // Create collection with items in a transaction
    const collection = await prisma.$transaction(async (tx) => {
      if (storeId) {
        // Validate store belongs to merchant
        const store = await tx.store.findFirst({
          where: { id: Number(storeId), merchantId }
        });
        if (!store) {
          throw new Error('Invalid store ID or store does not belong to merchant');
        }
      }

      // Create the collection
      const newCollection = await tx.menuCollection.create({
        data: {
          merchantId,
          storeId: storeId ? Number(storeId) : null,
          name: name.trim(),
          description: normalizedDescription ?? null,
          coverImageUrl: normalizedCoverImageUrl ?? null,
          servesCount: normalizedServesCount ?? null,
          packagePrice: normalizedPackagePrice ?? null,
          displayOrder: normalizedDisplayOrder ?? 0,
          menuType: menuType || 'STANDARD',
          subType: subType || null,
          startTime: startTime || null,
          endTime: endTime || null,
          themeName: normalizedThemeName ?? null,
          icon: normalizedIcon ?? null,
          color: normalizedColor ?? null
        }
      });

      // Add menu items if provided
      if (menuItems && Array.isArray(menuItems) && menuItems.length > 0) {
        const collectionItems = menuItems.map((item: any, index: number) => ({
          collectionId: newCollection.id,
          menuItemId: Number(item.id),
          sortOrder: item.sortOrder || index,
          customPrice: item.customPrice ? parseFloat(item.customPrice) : null,
          customDiscount: item.customDiscount ? parseFloat(item.customDiscount) : null,
          notes: item.notes ? item.notes.trim() : null
        }));

        await tx.menuCollectionItem.createMany({
          data: collectionItems
        });
      }

      return newCollection;
    });

    // Fetch the created collection with items
    const createdCollection = await prisma.menuCollection.findUnique({
      where: { id: collection.id },
      include: {
        items: {
          include: {
            menuItem: {
              select: menuCollectionMenuItemSelect
            }
          },
          orderBy: { sortOrder: 'asc' }
        },
        _count: {
          select: { items: true }
        }
      }
    });

    res.status(201).json({ collection: createdCollection ? normalizeCollectionResponse(createdCollection) : createdCollection });
  } catch (error) {
    console.error('Create menu collection error:', error);
    res.status(500).json({ error: 'Failed to create menu collection' });
  }
});

// --- Endpoint: GET /api/merchants/me/menu-collections/:collectionId ---
// Get a specific menu collection with its items
router.get('/merchants/me/menu-collections/:collectionId', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const collectionId = Number(req.params.collectionId);
    if (!Number.isFinite(collectionId)) {
      return res.status(400).json({ error: 'Invalid collection ID' });
    }

    const collection = await prisma.menuCollection.findFirst({
      where: { 
        id: collectionId, 
        merchantId 
      },
      include: {
        items: {
          include: {
            menuItem: {
              select: menuCollectionMenuItemSelect
            }
          },
          orderBy: { sortOrder: 'asc' }
        },
        _count: {
          select: { items: true }
        }
      }
    });

    if (!collection) {
      return res.status(404).json({ error: 'Menu collection not found' });
    }

    res.status(200).json({ collection: normalizeCollectionResponse(collection) });
  } catch (error) {
    console.error('Get menu collection error:', error);
    res.status(500).json({ error: 'Failed to fetch menu collection' });
  }
});

// --- Endpoint: PUT /api/merchants/me/menu-collections/:collectionId ---
// Update a menu collection
router.put('/merchants/me/menu-collections/:collectionId', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const collectionId = Number(req.params.collectionId);
    if (!Number.isFinite(collectionId)) {
      return res.status(400).json({ error: 'Invalid collection ID' });
    }

    const {
      name,
      description,
      isActive,
      menuType,
      subType,
      startTime,
      endTime,
      themeName,
      icon,
      color,
      storeId,
      coverImageUrl,
      servesCount,
      packagePrice,
      displayOrder,
    } = req.body;

    // Check if collection exists and belongs to merchant
    const existingCollection = await prisma.menuCollection.findFirst({
      where: { 
        id: collectionId, 
        merchantId 
      }
    });

    if (!existingCollection) {
      return res.status(404).json({ error: 'Menu collection not found' });
    }

    // Validate name if provided
    if (name !== undefined) {
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Collection name cannot be empty' });
      }
      if (name.trim().length > 100) {
        return res.status(400).json({ error: 'Collection name must be 100 characters or less' });
      }

      // Check for duplicate name (excluding current collection)
      const duplicateCollection = await prisma.menuCollection.findFirst({
        where: { 
          merchantId, 
          name: name.trim(),
          isActive: true,
          id: { not: collectionId }
        }
      });

      if (duplicateCollection) {
        return res.status(409).json({ error: 'A collection with this name already exists' });
      }
    }

    // Validate menuType if provided
    if (menuType !== undefined) {
      const validMenuTypes = ['STANDARD', 'HAPPY_HOUR', 'SPECIAL'];
      if (!validMenuTypes.includes(menuType)) {
        return res.status(400).json({ error: 'Invalid menu type' });
      }
    }

    let normalizedDescription: string | null | undefined;
    let normalizedThemeName: string | null | undefined;
    let normalizedIcon: string | null | undefined;
    let normalizedColor: string | null | undefined;
    let normalizedCoverImageUrl: string | null | undefined;
    let normalizedServesCount: number | null | undefined;
    let normalizedPackagePrice: number | null | undefined;
    let normalizedDisplayOrder: number | null | undefined;

    try {
      normalizedDescription = normalizeOptionalTrimmedString(description, 500);
      normalizedThemeName = normalizeOptionalTrimmedString(themeName, 100);
      normalizedIcon = normalizeOptionalTrimmedString(icon, 50);
      normalizedColor = normalizeOptionalTrimmedString(color, 32);
      normalizedCoverImageUrl = normalizeOptionalTrimmedString(coverImageUrl, 2048);
      normalizedServesCount = normalizeOptionalPositiveInteger(servesCount, 'servesCount');
      normalizedPackagePrice = normalizeOptionalNonNegativeFloat(packagePrice, 'packagePrice');
      normalizedDisplayOrder = normalizeOptionalNonNegativeInteger(displayOrder, 'displayOrder');
    } catch (validationError) {
      return res.status(400).json({
        error: validationError instanceof Error ? validationError.message : 'Invalid collection metadata',
      });
    }

    // Validate storeId if provided
    if (storeId) {
      const store = await prisma.store.findFirst({
        where: { id: Number(storeId), merchantId }
      });
      if (!store) {
        return res.status(400).json({ error: 'Invalid store ID or store does not belong to merchant' });
      }
    }

    // Update collection
    const updatedCollection = await prisma.menuCollection.update({
      where: { id: collectionId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: normalizedDescription ?? null }),
        ...(coverImageUrl !== undefined && { coverImageUrl: normalizedCoverImageUrl ?? null }),
        ...(servesCount !== undefined && { servesCount: normalizedServesCount ?? null }),
        ...(packagePrice !== undefined && { packagePrice: normalizedPackagePrice ?? null }),
        ...(displayOrder !== undefined && { displayOrder: normalizedDisplayOrder ?? 0 }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        ...(menuType !== undefined && { menuType }),
        ...(subType !== undefined && { subType: subType || null }),
        ...(startTime !== undefined && { startTime: startTime || null }),
        ...(endTime !== undefined && { endTime: endTime || null }),
        ...(themeName !== undefined && { themeName: normalizedThemeName ?? null }),
        ...(icon !== undefined && { icon: normalizedIcon ?? null }),
        ...(color !== undefined && { color: normalizedColor ?? null }),
        ...(storeId !== undefined && { storeId: storeId ? Number(storeId) : null })
      },
      include: {
        items: {
          include: {
            menuItem: {
              select: menuCollectionMenuItemSelect
            }
          },
          orderBy: { sortOrder: 'asc' }
        },
        _count: {
          select: { items: true }
        }
      }
    });

    res.status(200).json({ collection: normalizeCollectionResponse(updatedCollection) });
  } catch (error) {
    console.error('Update menu collection error:', error);
    res.status(500).json({ error: 'Failed to update menu collection' });
  }
});

// --- Endpoint: DELETE /api/merchants/me/menu-collections/:collectionId ---
// Delete a menu collection (soft delete by setting isActive to false)
router.delete('/merchants/me/menu-collections/:collectionId', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const collectionId = Number(req.params.collectionId);
    if (!Number.isFinite(collectionId)) {
      return res.status(400).json({ error: 'Invalid collection ID' });
    }

    // Check if collection exists and belongs to merchant
    const existingCollection = await prisma.menuCollection.findFirst({
      where: { 
        id: collectionId, 
        merchantId 
      }
    });

    if (!existingCollection) {
      return res.status(404).json({ error: 'Menu collection not found' });
    }

    // Soft delete by setting isActive to false
    await prisma.menuCollection.update({
      where: { id: collectionId },
      data: { isActive: false }
    });

    res.status(204).send();
  } catch (error) {
    console.error('Delete menu collection error:', error);
    res.status(500).json({ error: 'Failed to delete menu collection' });
  }
});

// ========================================
// MENU COLLECTION ITEMS MANAGEMENT
// ========================================

// --- Endpoint: POST /api/merchants/me/menu-collections/:collectionId/items ---
// Add menu items to a collection
router.post('/merchants/me/menu-collections/:collectionId/items', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const collectionId = Number(req.params.collectionId);
    if (!Number.isFinite(collectionId)) {
      return res.status(400).json({ error: 'Invalid collection ID' });
    }

    const { menuItems } = req.body;

    if (!menuItems || !Array.isArray(menuItems) || menuItems.length === 0) {
      return res.status(400).json({ error: 'Menu items array is required' });
    }

    // Check if collection exists and belongs to merchant
    const collection = await prisma.menuCollection.findFirst({
      where: { 
        id: collectionId, 
        merchantId,
        isActive: true 
      }
    });

    if (!collection) {
      return res.status(404).json({ error: 'Menu collection not found' });
    }

    // Validate menu items belong to merchant
    const menuItemIds = menuItems.map((item: any) => Number(item.id));
    const existingMenuItems = await prisma.menuItem.findMany({
      where: {
        id: { in: menuItemIds },
        merchantId
      },
      select: { id: true }
    });

    if (existingMenuItems.length !== menuItemIds.length) {
      return res.status(400).json({ error: 'Some menu items do not belong to this merchant' });
    }

    // Check for duplicates
    const existingCollectionItems = await prisma.menuCollectionItem.findMany({
      where: {
        collectionId,
        menuItemId: { in: menuItemIds }
      },
      select: { menuItemId: true }
    });

    const duplicateIds = existingCollectionItems.map(item => item.menuItemId);
    if (duplicateIds.length > 0) {
      return res.status(409).json({ 
        error: 'Some menu items are already in this collection',
        duplicateIds 
      });
    }

    // Add items to collection
    const collectionItems = menuItems.map((item: any, index: number) => ({
      collectionId,
      menuItemId: Number(item.id),
      sortOrder: item.sortOrder || (1000 + index), // Default high sort order
      customPrice: item.customPrice ? parseFloat(item.customPrice) : null,
      customDiscount: item.customDiscount ? parseFloat(item.customDiscount) : null,
      notes: item.notes ? item.notes.trim() : null
    }));

    await prisma.menuCollectionItem.createMany({
      data: collectionItems
    });

    // Return updated collection
    const updatedCollection = await prisma.menuCollection.findUnique({
      where: { id: collectionId },
      include: {
        items: {
          include: {
            menuItem: {
              select: menuCollectionMenuItemSelect
            }
          },
          orderBy: { sortOrder: 'asc' }
        },
        _count: {
          select: { items: true }
        }
      }
    });

    res.status(201).json({ collection: updatedCollection ? normalizeCollectionResponse(updatedCollection) : updatedCollection });
  } catch (error) {
    console.error('Add items to collection error:', error);
    res.status(500).json({ error: 'Failed to add items to collection' });
  }
});

// --- Endpoint: PUT /api/merchants/me/menu-collections/:collectionId/items/reorder ---
// Reorder items in a collection
// NOTE: This route MUST be defined before the /:itemId route to avoid Express matching "reorder" as an itemId param
router.put('/merchants/me/menu-collections/:collectionId/items/reorder', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const collectionId = Number(req.params.collectionId);
    if (!Number.isFinite(collectionId)) {
      return res.status(400).json({ error: 'Invalid collection ID' });
    }

    const { itemOrders } = req.body; // [{ itemId: 1, sortOrder: 0 }, { itemId: 2, sortOrder: 1 }]

    if (!itemOrders || !Array.isArray(itemOrders)) {
      return res.status(400).json({ error: 'itemOrders array is required' });
    }

    // Check if collection exists and belongs to merchant
    const collection = await prisma.menuCollection.findFirst({
      where: { 
        id: collectionId, 
        merchantId,
        isActive: true 
      }
    });

    if (!collection) {
      return res.status(404).json({ error: 'Menu collection not found' });
    }

    // Update sort orders in a transaction
    await prisma.$transaction(async (tx) => {
      for (const itemOrder of itemOrders) {
        await tx.menuCollectionItem.updateMany({
          where: {
            collectionId,
            menuItemId: Number(itemOrder.itemId)
          },
          data: {
            sortOrder: Number(itemOrder.sortOrder)
          }
        });
      }
    });

    // Return updated collection
    const updatedCollection = await prisma.menuCollection.findUnique({
      where: { id: collectionId },
      include: {
        items: {
          include: {
            menuItem: {
              select: menuCollectionMenuItemSelect
            }
          },
          orderBy: { sortOrder: 'asc' }
        },
        _count: {
          select: { items: true }
        }
      }
    });

    res.status(200).json({ collection: updatedCollection ? normalizeCollectionResponse(updatedCollection) : updatedCollection });
  } catch (error) {
    console.error('Reorder collection items error:', error);
    res.status(500).json({ error: 'Failed to reorder collection items' });
  }
});

// --- Endpoint: PUT /api/merchants/me/menu-collections/:collectionId/items/bulk ---
// Bulk create/update menu items in a collection (for inline editor save)
// NOTE: This route MUST be defined before the /:itemId route to avoid Express matching "bulk" as an itemId param
router.put('/merchants/me/menu-collections/:collectionId/items/bulk', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const collectionId = Number(req.params.collectionId);
    if (!Number.isFinite(collectionId)) {
      return res.status(400).json({ error: 'Invalid collection ID' });
    }

    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required and must not be empty' });
    }

    if (items.length > 200) {
      return res.status(400).json({ error: 'Maximum 200 items per bulk operation' });
    }

    // Validate each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.name || typeof item.name !== 'string' || item.name.trim().length === 0) {
        return res.status(400).json({ error: `Item at index ${i} requires a name` });
      }
      if (item.price === undefined || item.price === null || typeof item.price !== 'number' || item.price < 0) {
        return res.status(400).json({ error: `Item at index ${i} requires a valid price` });
      }
      if (item.inventoryTrackingEnabled === true) {
        const quantityValue = Number(item.inventoryQuantity);
        if (!Number.isInteger(quantityValue) || quantityValue < 0) {
          return res.status(400).json({ error: `Item at index ${i} requires a non-negative inventoryQuantity when tracking is enabled` });
        }
      }
      if (item.isBulkOrderEnabled === true) {
        const defaultPeopleCount = Number(item.defaultPeopleCount);
        const minPeopleCount = Number(item.minPeopleCount);
        if (!Number.isInteger(defaultPeopleCount) || defaultPeopleCount < 1) {
          return res.status(400).json({ error: `Item at index ${i} requires a defaultPeopleCount >= 1 when bulk ordering is enabled` });
        }
        if (!Number.isInteger(minPeopleCount) || minPeopleCount < 1) {
          return res.status(400).json({ error: `Item at index ${i} requires a minPeopleCount >= 1 when bulk ordering is enabled` });
        }
        if (defaultPeopleCount < minPeopleCount) {
          return res.status(400).json({ error: `Item at index ${i} requires defaultPeopleCount to be greater than or equal to minPeopleCount` });
        }
      }
    }

    // Check collection belongs to merchant
    const collection = await prisma.menuCollection.findFirst({
      where: { id: collectionId, merchantId, isActive: true }
    });

    if (!collection) {
      return res.status(404).json({ error: 'Menu collection not found' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const createdOrUpdatedItems = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.id) {
          // Update existing menu item
          const existingItem = await tx.menuItem.findFirst({
            where: { id: item.id, merchantId }
          });

          if (existingItem) {
            const inventoryData = buildInventoryUpdateData({
              inventoryTrackingEnabled: item.inventoryTrackingEnabled,
              inventoryQuantity: item.inventoryQuantity,
              lowStockThreshold: item.lowStockThreshold,
              allowBackorder: item.allowBackorder,
              isAvailable: item.isAvailable,
            });
            const updated = await tx.menuItem.update({
              where: { id: item.id },
              data: {
                name: item.name.trim(),
                price: item.price,
                description: item.description ? item.description.trim() : null,
                category: item.category ? item.category.trim() : existingItem.category,
                imageUrl: item.imageUrls && item.imageUrls.length > 0 ? item.imageUrls[0] : (item.imageUrl || existingItem.imageUrl),
                imageUrls: item.imageUrls || [],
                isHappyHour: item.isHappyHour !== undefined ? item.isHappyHour : existingItem.isHappyHour,
                happyHourPrice: item.happyHourPrice !== undefined ? item.happyHourPrice : existingItem.happyHourPrice,
                isBulkOrderEnabled:
                  item.isBulkOrderEnabled !== undefined
                    ? Boolean(item.isBulkOrderEnabled)
                    : existingItem.isBulkOrderEnabled,
                defaultPeopleCount:
                  item.isBulkOrderEnabled === true
                    ? Number(item.defaultPeopleCount)
                    : item.isBulkOrderEnabled === false
                      ? null
                      : item.defaultPeopleCount !== undefined
                        ? item.defaultPeopleCount
                        : existingItem.defaultPeopleCount,
                minPeopleCount:
                  item.isBulkOrderEnabled === true
                    ? Number(item.minPeopleCount)
                    : item.isBulkOrderEnabled === false
                      ? null
                      : item.minPeopleCount !== undefined
                        ? item.minPeopleCount
                        : existingItem.minPeopleCount,
                ...inventoryData
              }
            });
            createdOrUpdatedItems.push(updated);

            // Ensure it's linked to this collection
            const existingLink = await tx.menuCollectionItem.findFirst({
              where: { collectionId, menuItemId: item.id }
            });
            if (!existingLink) {
              await tx.menuCollectionItem.create({
                data: { collectionId, menuItemId: item.id, sortOrder: i }
              });
            }
          }
        } else {
          // Create new menu item and link to collection
          const inventoryData = buildInventoryUpdateData({
            inventoryTrackingEnabled: item.inventoryTrackingEnabled ?? true,
            inventoryQuantity: item.inventoryQuantity ?? 0,
            lowStockThreshold: item.lowStockThreshold ?? 5,
            allowBackorder: item.allowBackorder ?? false,
            isAvailable: item.isAvailable ?? true,
          }, true);
          const newItem = await tx.menuItem.create({
            data: {
              merchantId,
              name: item.name.trim(),
              price: item.price,
              description: item.description ? item.description.trim() : null,
              category: item.category ? item.category.trim() : 'Uncategorized',
              imageUrl: item.imageUrls && item.imageUrls.length > 0 ? item.imageUrls[0] : (item.imageUrl || null),
              imageUrls: item.imageUrls || [],
              isHappyHour: item.isHappyHour || false,
              happyHourPrice: item.happyHourPrice || null,
              isBulkOrderEnabled: item.isBulkOrderEnabled === true,
              defaultPeopleCount: item.isBulkOrderEnabled === true ? Number(item.defaultPeopleCount) : null,
              minPeopleCount: item.isBulkOrderEnabled === true ? Number(item.minPeopleCount) : null,
              ...inventoryData
            }
          });

          await tx.menuCollectionItem.create({
            data: { collectionId, menuItemId: newItem.id, sortOrder: i }
          });

          createdOrUpdatedItems.push(newItem);
        }
      }

      return createdOrUpdatedItems;
    });

    // Return full updated collection
    const updatedCollection = await prisma.menuCollection.findUnique({
      where: { id: collectionId },
      include: {
        items: {
          include: {
            menuItem: {
              select: menuCollectionMenuItemSelect
            }
          },
          orderBy: { sortOrder: 'asc' }
        },
        _count: { select: { items: true } }
      }
    });

    res.status(200).json({
      collection: updatedCollection ? normalizeCollectionResponse(updatedCollection) : updatedCollection,
      itemsProcessed: result.length,
    });
  } catch (error) {
    console.error('Bulk items error:', error);
    res.status(500).json({ error: 'Failed to bulk update collection items' });
  }
});

// --- Endpoint: PUT /api/merchants/me/menu-collections/:collectionId/items/:itemId ---
// Update a specific item in a collection
router.put('/merchants/me/menu-collections/:collectionId/items/:itemId', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const collectionId = Number(req.params.collectionId);
    const itemId = Number(req.params.itemId);
    
    if (!Number.isFinite(collectionId) || !Number.isFinite(itemId)) {
      return res.status(400).json({ error: 'Invalid collection ID or item ID' });
    }

    const { sortOrder, customPrice, customDiscount, notes, isActive } = req.body;

    // Check if collection item exists and belongs to merchant
    const collectionItem = await prisma.menuCollectionItem.findFirst({
      where: {
        collectionId,
        menuItemId: itemId,
        collection: {
          merchantId,
          isActive: true
        }
      }
    });

    if (!collectionItem) {
      return res.status(404).json({ error: 'Collection item not found' });
    }

    // Update collection item
    const updatedItem = await prisma.menuCollectionItem.update({
      where: {
        collectionId_menuItemId: {
          collectionId,
          menuItemId: itemId
        }
      },
      data: {
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
        ...(customPrice !== undefined && { customPrice: customPrice ? parseFloat(customPrice) : null }),
        ...(customDiscount !== undefined && { customDiscount: customDiscount ? parseFloat(customDiscount) : null }),
        ...(notes !== undefined && { notes: notes ? notes.trim() : null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) })
      },
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
      }
    });

    res.status(200).json({ collectionItem: updatedItem });
  } catch (error) {
    console.error('Update collection item error:', error);
    res.status(500).json({ error: 'Failed to update collection item' });
  }
});

// --- Endpoint: DELETE /api/merchants/me/menu-collections/:collectionId/items/:itemId ---
// Remove an item from a collection
router.delete('/merchants/me/menu-collections/:collectionId/items/:itemId', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const collectionId = Number(req.params.collectionId);
    const itemId = Number(req.params.itemId);
    
    if (!Number.isFinite(collectionId) || !Number.isFinite(itemId)) {
      return res.status(400).json({ error: 'Invalid collection ID or item ID' });
    }

    // Check if collection item exists and belongs to merchant
    const collectionItem = await prisma.menuCollectionItem.findFirst({
      where: {
        collectionId,
        menuItemId: itemId,
        collection: {
          merchantId,
          isActive: true
        }
      }
    });

    if (!collectionItem) {
      return res.status(404).json({ error: 'Collection item not found' });
    }

    // Remove item from collection
    await prisma.menuCollectionItem.delete({
      where: {
        collectionId_menuItemId: {
          collectionId,
          menuItemId: itemId
        }
      }
    });

    res.status(204).send();
  } catch (error) {
    console.error('Remove item from collection error:', error);
    res.status(500).json({ error: 'Failed to remove item from collection' });
  }
});
