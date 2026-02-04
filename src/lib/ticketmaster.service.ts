// src/lib/ticketmaster.service.ts

import axios, { AxiosInstance } from 'axios';

/**
 * Ticketmaster Discovery API Integration Service
 * Provides event discovery, venue search, and artist information
 * API Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 */

const TICKETMASTER_API_BASE = 'https://app.ticketmaster.com/discovery/v2';
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY || '';

interface TicketmasterSearchParams {
  keyword?: string;
  city?: string;
  stateCode?: string;
  countryCode?: string;
  postalCode?: string;
  latlong?: string; // Format: "latitude,longitude"
  radius?: number; // In miles
  unit?: 'miles' | 'km';
  startDateTime?: string; // ISO 8601 format
  endDateTime?: string;
  classificationName?: string; // Music, Sports, Arts, Family, etc.
  genreId?: string;
  venueId?: string;
  attractionId?: string;
  size?: number; // Results per page (max 200)
  page?: number;
  sort?: 'date,asc' | 'date,desc' | 'relevance,asc' | 'relevance,desc' | 'name,asc' | 'name,desc';
}

interface TicketmasterImage {
  url: string;
  ratio?: string;
  width: number;
  height: number;
  fallback?: boolean;
}

interface TicketmasterVenue {
  id: string;
  name: string;
  type?: string;
  url?: string;
  postalCode?: string;
  timezone?: string;
  city?: {
    name: string;
  };
  state?: {
    name: string;
    stateCode: string;
  };
  country?: {
    name: string;
    countryCode: string;
  };
  address?: {
    line1?: string;
  };
  location?: {
    longitude: string;
    latitude: string;
  };
  images?: TicketmasterImage[];
}

interface TicketmasterAttraction {
  id: string;
  name: string;
  type?: string;
  url?: string;
  images?: TicketmasterImage[];
  classifications?: Array<{
    primary?: boolean;
    segment?: { id: string; name: string };
    genre?: { id: string; name: string };
    subGenre?: { id: string; name: string };
  }>;
}

interface TicketmasterPriceRange {
  type: string;
  currency: string;
  min: number;
  max: number;
}

interface TicketmasterEvent {
  id: string;
  name: string;
  type: string;
  url: string;
  locale?: string;
  images?: TicketmasterImage[];
  sales?: {
    public?: {
      startDateTime?: string;
      endDateTime?: string;
    };
    presales?: Array<{
      startDateTime?: string;
      endDateTime?: string;
      name?: string;
    }>;
  };
  dates?: {
    start?: {
      localDate?: string;
      localTime?: string;
      dateTime?: string;
    };
    end?: {
      localDate?: string;
      localTime?: string;
      dateTime?: string;
    };
    timezone?: string;
    status?: {
      code: string;
    };
  };
  classifications?: Array<{
    primary?: boolean;
    segment?: { id: string; name: string };
    genre?: { id: string; name: string };
    subGenre?: { id: string; name: string };
  }>;
  priceRanges?: TicketmasterPriceRange[];
  promoter?: {
    id: string;
    name: string;
  };
  info?: string;
  pleaseNote?: string;
  _embedded?: {
    venues?: TicketmasterVenue[];
    attractions?: TicketmasterAttraction[];
  };
}

interface TicketmasterResponse {
  _embedded?: {
    events?: TicketmasterEvent[];
    venues?: TicketmasterVenue[];
    attractions?: TicketmasterAttraction[];
  };
  _links?: {
    self?: { href: string };
    next?: { href: string };
    prev?: { href: string };
  };
  page?: {
    size: number;
    totalElements: number;
    totalPages: number;
    number: number;
  };
}

class TicketmasterService {
  private client: AxiosInstance;
  private isEnabled: boolean;

  constructor() {
    this.isEnabled = !!TICKETMASTER_API_KEY;
    
    if (!this.isEnabled) {
      console.warn('[Ticketmaster] API key not configured. Service disabled.');
    }

    this.client = axios.create({
      baseURL: TICKETMASTER_API_BASE,
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 429) {
          console.error('[Ticketmaster] Rate limit exceeded');
          throw new Error('Ticketmaster API rate limit exceeded. Please try again later.');
        }
        if (error.response?.status === 401) {
          console.error('[Ticketmaster] Invalid API key');
          throw new Error('Ticketmaster API authentication failed');
        }
        throw error;
      }
    );
  }

  /**
   * Check if Ticketmaster integration is enabled
   */
  isAvailable(): boolean {
    return this.isEnabled;
  }

  /**
   * Search for events on Ticketmaster
   */
  async searchEvents(params: TicketmasterSearchParams): Promise<TicketmasterResponse> {
    if (!this.isEnabled) {
      throw new Error('Ticketmaster API is not configured');
    }

    try {
      const response = await this.client.get<TicketmasterResponse>('/events.json', {
        params: {
          apikey: TICKETMASTER_API_KEY,
          ...params,
        },
      });

      return response.data;
    } catch (error) {
      console.error('[Ticketmaster] Event search error:', error);
      throw error;
    }
  }

  /**
   * Get event details by ID
   */
  async getEventById(eventId: string): Promise<TicketmasterEvent | null> {
    if (!this.isEnabled) {
      throw new Error('Ticketmaster API is not configured');
    }

    try {
      const response = await this.client.get<TicketmasterEvent>(`/events/${eventId}.json`, {
        params: {
          apikey: TICKETMASTER_API_KEY,
        },
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      console.error('[Ticketmaster] Get event error:', error);
      throw error;
    }
  }

  /**
   * Search for venues
   */
  async searchVenues(params: Omit<TicketmasterSearchParams, 'classificationName'>): Promise<TicketmasterResponse> {
    if (!this.isEnabled) {
      throw new Error('Ticketmaster API is not configured');
    }

    try {
      const response = await this.client.get<TicketmasterResponse>('/venues.json', {
        params: {
          apikey: TICKETMASTER_API_KEY,
          ...params,
        },
      });

      return response.data;
    } catch (error) {
      console.error('[Ticketmaster] Venue search error:', error);
      throw error;
    }
  }

  /**
   * Get venue details by ID
   */
  async getVenueById(venueId: string): Promise<TicketmasterVenue | null> {
    if (!this.isEnabled) {
      throw new Error('Ticketmaster API is not configured');
    }

    try {
      const response = await this.client.get<TicketmasterVenue>(`/venues/${venueId}.json`, {
        params: {
          apikey: TICKETMASTER_API_KEY,
        },
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      console.error('[Ticketmaster] Get venue error:', error);
      throw error;
    }
  }

  /**
   * Search for attractions (artists, teams, etc.)
   */
  async searchAttractions(params: TicketmasterSearchParams): Promise<TicketmasterResponse> {
    if (!this.isEnabled) {
      throw new Error('Ticketmaster API is not configured');
    }

    try {
      const response = await this.client.get<TicketmasterResponse>('/attractions.json', {
        params: {
          apikey: TICKETMASTER_API_KEY,
          ...params,
        },
      });

      return response.data;
    } catch (error) {
      console.error('[Ticketmaster] Attraction search error:', error);
      throw error;
    }
  }

  /**
   * Get attraction details by ID
   */
  async getAttractionById(attractionId: string): Promise<TicketmasterAttraction | null> {
    if (!this.isEnabled) {
      throw new Error('Ticketmaster API is not configured');
    }

    try {
      const response = await this.client.get<TicketmasterAttraction>(`/attractions/${attractionId}.json`, {
        params: {
          apikey: TICKETMASTER_API_KEY,
        },
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      console.error('[Ticketmaster] Get attraction error:', error);
      throw error;
    }
  }

  /**
   * Convert Ticketmaster event to unified format for our platform
   */
  normalizeEvent(tmEvent: TicketmasterEvent): any {
    const venue = tmEvent._embedded?.venues?.[0];
    const attractions = tmEvent._embedded?.attractions || [];
    const mainAttraction = attractions[0];
    
    return {
      id: `tm_${tmEvent.id}`,
      externalId: tmEvent.id,
      source: 'ticketmaster',
      title: tmEvent.name,
      description: tmEvent.info || tmEvent.pleaseNote || '',
      shortDescription: tmEvent.info?.substring(0, 500),
      eventType: this.mapClassificationToEventType(tmEvent.classifications?.[0]),
      status: this.mapTicketmasterStatus(tmEvent.dates?.status?.code),
      
      // Dates
      startDate: tmEvent.dates?.start?.dateTime || 
                 this.combineDateTime(tmEvent.dates?.start?.localDate, tmEvent.dates?.start?.localTime),
      endDate: tmEvent.dates?.end?.dateTime ||
               this.combineDateTime(tmEvent.dates?.end?.localDate, tmEvent.dates?.end?.localTime),
      timezone: tmEvent.dates?.timezone || 'America/New_York',
      
      // Venue
      venueName: venue?.name,
      venueAddress: venue?.address?.line1,
      latitude: venue?.location?.latitude ? parseFloat(venue.location.latitude) : null,
      longitude: venue?.location?.longitude ? parseFloat(venue.location.longitude) : null,
      city: venue?.city?.name,
      state: venue?.state?.stateCode,
      
      // Media
      coverImageUrl: this.getBestImage(tmEvent.images),
      imageGallery: tmEvent.images?.map(img => img.url) || [],
      
      // Ticketing
      externalUrl: tmEvent.url,
      priceRange: tmEvent.priceRanges?.[0] ? {
        min: tmEvent.priceRanges[0].min,
        max: tmEvent.priceRanges[0].max,
        currency: tmEvent.priceRanges[0].currency,
      } : null,
      
      // Classification
      genre: tmEvent.classifications?.[0]?.genre?.name,
      subGenre: tmEvent.classifications?.[0]?.subGenre?.name,
      
      // Attractions
      performers: attractions.map(attr => ({
        id: attr.id,
        name: attr.name,
        type: attr.type,
        url: attr.url,
        image: this.getBestImage(attr.images),
      })),
      
      // Metadata
      isExternal: true,
      platform: 'Ticketmaster',
    };
  }

  /**
   * Get best quality image from Ticketmaster images array
   */
  private getBestImage(images?: TicketmasterImage[]): string | null {
    if (!images || images.length === 0) return null;
    
    // Prefer 16:9 ratio, high resolution
    const preferred = images.find(img => img.ratio === '16_9' && img.width >= 1024);
    if (preferred) return preferred.url;
    
    // Fallback to largest image
    const largest = images.reduce((prev, curr) => 
      (curr.width * curr.height) > (prev.width * prev.height) ? curr : prev
    );
    
    return largest.url;
  }

  /**
   * Map Ticketmaster classification to our EventType
   */
  private mapClassificationToEventType(classification?: any): string {
    const segment = classification?.segment?.name?.toLowerCase();
    const genre = classification?.genre?.name?.toLowerCase();
    
    if (segment?.includes('sports')) return 'SPORTS_TOURNAMENT';
    if (segment?.includes('music') || genre?.includes('concert')) return 'PARTY';
    if (segment?.includes('arts') || segment?.includes('theatre')) return 'FESTIVAL';
    if (genre?.includes('festival')) return 'FESTIVAL';
    
    return 'PARTY'; // Default
  }

  /**
   * Map Ticketmaster status code to our EventStatus
   */
  private mapTicketmasterStatus(statusCode?: string): string {
    switch (statusCode) {
      case 'onsale':
      case 'offsale':
        return 'PUBLISHED';
      case 'cancelled':
      case 'canceled':
        return 'CANCELLED';
      case 'postponed':
      case 'rescheduled':
        return 'DRAFT';
      default:
        return 'PUBLISHED';
    }
  }

  /**
   * Combine local date and time into ISO string
   */
  private combineDateTime(date?: string, time?: string): string | null {
    if (!date) return null;
    
    const dateTimeStr = time ? `${date}T${time}` : `${date}T00:00:00`;
    return new Date(dateTimeStr).toISOString();
  }
}

// Export singleton instance
export const ticketmasterService = new TicketmasterService();

// Export types
export type {
  TicketmasterSearchParams,
  TicketmasterEvent,
  TicketmasterVenue,
  TicketmasterAttraction,
  TicketmasterResponse,
};
