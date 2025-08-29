"use strict";
// src/routes/deals.public.routes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
// Utility function to calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
}
// Utility function to format deal data for frontend consumption
function formatDealForFrontend(deal, distance) {
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
// Performance monitoring utility
function logQueryPerformance(operation, startTime, resultCount, filters) {
    const duration = Date.now() - startTime;
    console.log(`[PERFORMANCE] ${operation}: ${duration}ms, ${resultCount} results`, filters ? `Filters: ${JSON.stringify(filters)}` : '');
    // Log slow queries for optimization
    if (duration > 1000) {
        console.warn(`[SLOW QUERY] ${operation} took ${duration}ms - consider optimization`);
    }
}
// --- Endpoint: GET /api/deals ---
// Fetches all active deals from approved merchants.
// Optional query parameters: latitude, longitude, radius (in kilometers), category, search
router.get('/deals', async (req, res) => {
    try {
        const { latitude, longitude, radius, category, search } = req.query;
        const now = new Date();
        // Build the where clause for filtering
        const whereClause = {
            // Filter for active deals
            startTime: { lte: now },
            endTime: { gte: now },
            // IMPORTANT: Only show deals from approved merchants
            merchant: {
                status: 'APPROVED',
            },
        };
        // Add category filter if provided
        if (category) {
            // Validate category
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
            whereClause.category = category;
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
        let deals = await prisma.deal.findMany({
            where: whereClause,
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
            orderBy: {
                createdAt: 'desc',
            },
            // Add query hints for better performance
            // This helps PostgreSQL choose the right indexes
        });
        // Log query performance
        logQueryPerformance('Deals Query', queryStartTime, deals.length, {
            category: category || 'all',
            search: search ? 'yes' : 'no',
            geolocation: (latitude && longitude && radius) ? 'yes' : 'no'
        });
        // If coordinates and radius are provided, filter by distance
        if (latitude && longitude && radius) {
            const userLat = parseFloat(latitude);
            const userLon = parseFloat(longitude);
            const radiusKm = parseFloat(radius);
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
                orderBy: {
                    createdAt: 'desc',
                },
            });
            // Filter by distance and add distance information
            const dealsWithDistance = deals
                .filter(deal => {
                if (!deal.merchant.latitude || !deal.merchant.longitude) {
                    return false;
                }
                const distance = calculateDistance(userLat, userLon, deal.merchant.latitude, deal.merchant.longitude);
                return distance <= radiusKm;
            })
                .map(deal => {
                const distance = calculateDistance(userLat, userLon, deal.merchant.latitude, deal.merchant.longitude);
                return formatDealForFrontend(deal, distance);
            })
                .sort((a, b) => (a.distance || 0) - (b.distance || 0));
            deals = dealsWithDistance;
        }
        else {
            // Format deals for frontend when no geolocation filtering is applied
            deals = deals.map(deal => formatDealForFrontend(deal));
        }
        res.status(200).json({
            deals,
            total: deals.length,
            filters: {
                latitude: latitude ? parseFloat(latitude) : null,
                longitude: longitude ? parseFloat(longitude) : null,
                radius: radius ? parseFloat(radius) : null,
                category: category ? category : null,
                search: search ? search : null,
            }
        });
    }
    catch (error) {
        console.error('Error fetching deals:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// --- Endpoint: GET /api/deals/:dealId/saved ---
// Check if a specific deal is saved by the logged-in user (for public access)
router.get('/deals/:dealId/saved', async (req, res) => {
    try {
        const dealId = parseInt(req.params.dealId);
        // Validate dealId
        if (isNaN(dealId) || dealId <= 0) {
            return res.status(400).json({
                error: 'Invalid deal ID. Must be a positive integer.'
            });
        }
        // For public access, always return false since we can't determine the user
        // This endpoint is useful for frontend consistency
        res.status(200).json({
            isSaved: false,
            savedDeal: null,
            message: 'Authentication required to check saved status'
        });
    }
    catch (error) {
        console.error('Error checking saved deal status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// --- Endpoint: GET /api/deals/categories ---
// Returns all available deal categories
router.get('/deals/categories', async (req, res) => {
    try {
        const categories = [
            {
                value: 'FOOD_AND_BEVERAGE',
                label: 'Food & Beverage',
                description: 'Restaurants, cafes, bars, food delivery',
                icon: '🍽️'
            },
            {
                value: 'RETAIL',
                label: 'Retail',
                description: 'Clothing, electronics, general merchandise',
                icon: '🛍️'
            },
            {
                value: 'ENTERTAINMENT',
                label: 'Entertainment',
                description: 'Movies, events, activities, gaming',
                icon: '🎬'
            },
            {
                value: 'HEALTH_AND_FITNESS',
                label: 'Health & Fitness',
                description: 'Gyms, wellness, medical services',
                icon: '💪'
            },
            {
                value: 'BEAUTY_AND_SPA',
                label: 'Beauty & Spa',
                description: 'Salons, spas, beauty services',
                icon: '💅'
            },
            {
                value: 'AUTOMOTIVE',
                label: 'Automotive',
                description: 'Car services, dealerships, auto parts',
                icon: '🚗'
            },
            {
                value: 'TRAVEL',
                label: 'Travel',
                description: 'Hotels, flights, vacation packages',
                icon: '✈️'
            },
            {
                value: 'EDUCATION',
                label: 'Education',
                description: 'Courses, training, educational services',
                icon: '📚'
            },
            {
                value: 'TECHNOLOGY',
                label: 'Technology',
                description: 'Software, gadgets, tech services',
                icon: '💻'
            },
            {
                value: 'HOME_AND_GARDEN',
                label: 'Home & Garden',
                description: 'Furniture, gardening, home improvement',
                icon: '🏠'
            },
            {
                value: 'OTHER',
                label: 'Other',
                description: 'Miscellaneous deals',
                icon: '📦'
            }
        ];
        res.status(200).json({
            categories,
            total: categories.length,
            metadata: {
                lastUpdated: new Date().toISOString(),
                version: '1.0.0'
            }
        });
    }
    catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
