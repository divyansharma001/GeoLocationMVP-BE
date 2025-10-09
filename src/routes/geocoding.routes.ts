import { Router } from 'express';
import { protect, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// Simple rate limiting to respect Nominatim's 1 request per second policy
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 second

const rateLimitedFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        const delay = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    lastRequestTime = Date.now();
    return fetch(url, options);
};

// Endpoint: POST /api/geocoding/reverse
// Reverse geocoding - convert coordinates to address
router.post('/reverse', protect, async (req: AuthRequest, res) => {
    try {
        const { lat, lng } = req.body;

        if (!lat || !lng) {
            return res.status(400).json({ error: 'Latitude and longitude are required' });
        }

        if (isNaN(lat) || isNaN(lng)) {
            return res.status(400).json({ error: 'Invalid coordinates' });
        }

        const response = await rateLimitedFetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
            {
                headers: {
                    'User-Agent': 'YOHOP-GeoLocation-App/1.0 (contact@yohop.com)',
                    'Accept': 'application/json',
                }
            }
        );

        if (!response.ok) {
            if (response.status === 403) {
                return res.status(503).json({ 
                    error: 'Geocoding service temporarily unavailable. Please try again later.' 
                });
            }
            return res.status(500).json({ error: 'Failed to fetch address' });
        }

        const data = await response.json();
        
        if (data && data.address) {
            const addr = data.address;
            const result = {
                street: `${addr.house_number || ''} ${addr.road || ''}`.trim(),
                city: addr.city || addr.town || addr.village || '',
                state: addr.state || '',
                zip: addr.postcode || '',
                country: addr.country || '',
            };
            res.json(result);
        } else {
            res.status(404).json({ error: 'Address not found' });
        }

    } catch (error: any) {
        console.error('Reverse geocoding error:', error);
        res.status(500).json({ 
            error: 'Internal server error during reverse geocoding.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Endpoint: POST /api/geocoding/search
// Forward geocoding - convert address to coordinates
router.post('/search', protect, async (req: AuthRequest, res) => {
    try {
        const { query, city, limit = 5 } = req.body;

        if (!query || query.trim().length < 3) {
            return res.status(400).json({ error: 'Query must be at least 3 characters long' });
        }

        // Build the search query
        const fullQuery = city ? `${query}, ${city}` : query;
        
        const response = await rateLimitedFetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullQuery)}&limit=${limit}`,
            {
                headers: {
                    'User-Agent': 'YOHOP-GeoLocation-App/1.0 (contact@yohop.com)',
                    'Accept': 'application/json',
                }
            }
        );

        if (!response.ok) {
            if (response.status === 403) {
                return res.status(503).json({ 
                    error: 'Address search service temporarily unavailable. Please try again later.' 
                });
            }
            return res.status(500).json({ error: 'Failed to fetch address suggestions' });
        }

        const data = await response.json();
        
        // Transform the data to match the expected format
        const suggestions = data.map((item: any) => ({
            place_id: item.place_id,
            display_name: item.display_name,
            lat: item.lat,
            lon: item.lon
        }));

        res.json(suggestions);

    } catch (error: any) {
        console.error('Address search error:', error);
        res.status(500).json({ 
            error: 'Internal server error during address search.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

export default router;
