import axios, { AxiosInstance } from 'axios';
import { CacheTTL, createCacheKey, getOrSetCache } from './cache';
import { metricsCollector } from './metrics';

const SEATGEEK_API_BASE = 'https://api.seatgeek.com/2';
const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID || '';
const SEATGEEK_CLIENT_SECRET = process.env.SEATGEEK_CLIENT_SECRET || '';
const SEATGEEK_AID = process.env.SEATGEEK_AFFILIATE_ID || '';

interface SeatGeekSearchParams {
  q?: string;
  'venue.city'?: string;
  'venue.state'?: string;
  geoip?: string | boolean;
  lat?: number;
  lon?: number;
  range?: string;
  'datetime_utc.gte'?: string;
  'datetime_utc.lte'?: string;
  taxonomies?: string;
  page?: number;
  per_page?: number;
  sort?: 'datetime_utc.asc' | 'datetime_utc.desc' | 'score.desc' | 'score.asc';
}

interface SeatGeekPerformer {
  id: number;
  name: string;
  short_name?: string;
  url?: string;
  image?: string | null;
  images?: {
    huge?: string;
    large?: string;
    medium?: string;
    small?: string;
  } | null;
  primary?: boolean;
  type?: string;
  slug?: string;
}

interface SeatGeekVenue {
  id: number;
  name: string;
  url?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  address?: string | null;
  extended_address?: string | null;
  location?: {
    lat?: number;
    lon?: number;
  };
}

interface SeatGeekTaxonomy {
  id: number;
  name: string;
  parent_id?: number | null;
}

interface SeatGeekStats {
  listing_count?: number | null;
  average_price?: number | null;
  lowest_price?: number | null;
  highest_price?: number | null;
}

interface SeatGeekEvent {
  id: number;
  title: string;
  short_title?: string;
  type?: string;
  url: string;
  datetime_local?: string;
  datetime_utc?: string;
  announce_date?: string;
  visible_until?: string;
  time_tbd?: boolean;
  date_tbd?: boolean;
  score?: number;
  stats?: SeatGeekStats;
  venue?: SeatGeekVenue;
  performers?: SeatGeekPerformer[];
  taxonomies?: SeatGeekTaxonomy[];
}

interface SeatGeekResponseMeta {
  page: number;
  per_page: number;
  total: number;
}

interface SeatGeekResponse {
  events?: SeatGeekEvent[];
  meta?: SeatGeekResponseMeta;
}

class SeatGeekService {
  private client: AxiosInstance;
  private isEnabled: boolean;

  constructor() {
    this.isEnabled = !!SEATGEEK_CLIENT_ID;

    if (!this.isEnabled) {
      console.warn('[SeatGeek] Client ID not configured. Service disabled.');
    }

    this.client = axios.create({
      baseURL: SEATGEEK_API_BASE,
      timeout: 10000,
      headers: {
        Accept: 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 429) {
          console.error('[SeatGeek] Rate limit exceeded');
          throw new Error('SeatGeek API rate limit exceeded. Please try again later.');
        }
        if (error.response?.status === 401 || error.response?.status === 403) {
          console.error('[SeatGeek] Authentication failed');
          throw new Error('SeatGeek API authentication failed');
        }
        throw error;
      }
    );
  }

  isAvailable(): boolean {
    return this.isEnabled;
  }

  async searchEvents(params: SeatGeekSearchParams): Promise<SeatGeekResponse> {
    if (!this.isEnabled) {
      throw new Error('SeatGeek API is not configured');
    }

    const { value } = await getOrSetCache({
      namespace: 'external:seatgeek',
      key: createCacheKey(['search', JSON.stringify(params)]),
      ttlMs: CacheTTL.EXTERNAL_API,
      loader: async () => {
        const startedAt = Date.now();
        try {
          const response = await this.client.get<SeatGeekResponse>('/events', {
            params: {
              client_id: SEATGEEK_CLIENT_ID,
              ...(SEATGEEK_CLIENT_SECRET ? { client_secret: SEATGEEK_CLIENT_SECRET } : {}),
              ...(SEATGEEK_AID ? { aid: SEATGEEK_AID } : {}),
              ...params,
            },
          });
          metricsCollector.recordExternalApi('seatgeek.search', Date.now() - startedAt);
          return response.data;
        } catch (error) {
          metricsCollector.recordExternalApi('seatgeek.search', Date.now() - startedAt, true);
          console.error('[SeatGeek] Event search error:', error);
          throw error;
        }
      },
    });

    return value;
  }

  async getEventById(eventId: string): Promise<SeatGeekEvent | null> {
    if (!this.isEnabled) {
      throw new Error('SeatGeek API is not configured');
    }

    const { value } = await getOrSetCache({
      namespace: 'external:seatgeek',
      key: createCacheKey(['detail', eventId]),
      ttlMs: CacheTTL.EXTERNAL_API,
      loader: async () => {
        const startedAt = Date.now();
        try {
          const response = await this.client.get<SeatGeekEvent>(`/events/${eventId}`, {
            params: {
              client_id: SEATGEEK_CLIENT_ID,
              ...(SEATGEEK_CLIENT_SECRET ? { client_secret: SEATGEEK_CLIENT_SECRET } : {}),
              ...(SEATGEEK_AID ? { aid: SEATGEEK_AID } : {}),
            },
          });
          metricsCollector.recordExternalApi('seatgeek.detail', Date.now() - startedAt);
          return response.data;
        } catch (error) {
          metricsCollector.recordExternalApi('seatgeek.detail', Date.now() - startedAt, true);
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            return null;
          }
          console.error('[SeatGeek] Get event error:', error);
          throw error;
        }
      },
    });

    return value;
  }

  normalizeEvent(event: SeatGeekEvent) {
    return {
      id: `sg_${event.id}`,
      externalId: String(event.id),
      source: 'seatgeek',
      title: event.title,
      description: '',
      shortDescription: event.short_title || event.title,
      eventType: this.mapTypeToEventType(event.type, event.taxonomies),
      status: 'PUBLISHED',
      startDate: event.datetime_utc || event.datetime_local || null,
      endDate: null,
      timezone: 'UTC',
      venueName: event.venue?.name || null,
      venueAddress: event.venue?.address || event.venue?.extended_address || null,
      latitude: event.venue?.location?.lat ?? null,
      longitude: event.venue?.location?.lon ?? null,
      city: event.venue?.city || null,
      state: event.venue?.state || null,
      coverImageUrl: this.getBestImage(event.performers),
      imageGallery: this.getAllImages(event.performers),
      externalUrl: event.url,
      priceRange: event.stats?.lowest_price != null || event.stats?.highest_price != null ? {
        min: event.stats?.lowest_price ?? event.stats?.average_price ?? 0,
        max: event.stats?.highest_price ?? event.stats?.average_price ?? 0,
        currency: 'USD',
      } : null,
      genre: event.taxonomies?.[0]?.name || null,
      subGenre: null,
      performers: (event.performers || []).map((performer) => ({
        id: performer.id,
        name: performer.name,
        type: performer.type,
        url: performer.url,
        image: performer.image || performer.images?.large || performer.images?.medium || null,
      })),
      isExternal: true,
      platform: 'SeatGeek',
    };
  }

  private getBestImage(performers?: SeatGeekPerformer[]): string | null {
    if (!performers?.length) return null;

    const primary = performers.find((performer) => performer.primary);
    const candidate = primary || performers[0];

    return (
      candidate.image ||
      candidate.images?.huge ||
      candidate.images?.large ||
      candidate.images?.medium ||
      candidate.images?.small ||
      null
    );
  }

  private getAllImages(performers?: SeatGeekPerformer[]): string[] {
    if (!performers?.length) return [];

    return performers.flatMap((performer) =>
      [
        performer.image,
        performer.images?.huge,
        performer.images?.large,
        performer.images?.medium,
        performer.images?.small,
      ].filter((image): image is string => !!image)
    );
  }

  private mapTypeToEventType(type?: string, taxonomies?: SeatGeekTaxonomy[]): string {
    const normalized = `${type || ''} ${taxonomies?.map((taxonomy) => taxonomy.name).join(' ') || ''}`.toLowerCase();

    if (normalized.includes('sport')) return 'SPORTS';
    if (normalized.includes('comedy')) return 'COMEDY';
    if (normalized.includes('festival')) return 'FESTIVAL';
    if (normalized.includes('theater') || normalized.includes('theatre') || normalized.includes('art')) return 'ARTS';
    if (normalized.includes('food')) return 'FOOD_AND_DRINK';
    if (normalized.includes('concert') || normalized.includes('music')) return 'CONCERT';

    return 'OTHER';
  }
}

export const seatGeekService = new SeatGeekService();

export type {
  SeatGeekSearchParams,
  SeatGeekEvent,
  SeatGeekResponse,
};
