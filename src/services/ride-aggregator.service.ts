import axios from 'axios';
import prisma from '../lib/prisma';
import { haversineMeters } from '../lib/geo';
import { CacheTTL, createCacheKey, getOrSetCache } from '../lib/cache';
import { metricsCollector } from '../lib/metrics';

type RideProvider = 'uber' | 'lyft';

export interface CoordinateInput {
  lat: number;
  lng: number;
}

export interface RideEstimateRequest {
  pickup: CoordinateInput;
  dropoff?: CoordinateInput & {
    address?: string;
    merchantId?: number;
    eventId?: number;
    serviceId?: number;
  };
  merchantId?: number;
  eventId?: number;
  serviceId?: number;
  providers?: RideProvider[];
}

export interface RideEstimate {
  provider: RideProvider;
  rideType: string;
  estimatedFareMin: number | null;
  estimatedFareMax: number | null;
  estimatedArrivalMinutes: number | null;
  estimatedTripMinutes: number | null;
  currency: string;
  deepLink: string;
  availability: 'available' | 'deep_link_only' | 'unavailable';
  rawMeta: Record<string, unknown>;
}

export interface ProviderError {
  provider: string;
  message: string;
}

interface ProviderStatus {
  enabled: boolean;
  mode: 'live' | 'deep_link_only' | 'disabled';
}

interface ResolvedDropoff {
  lat: number;
  lng: number;
  address?: string | null;
  label: string;
}

const RIDE_PROVIDERS: RideProvider[] = ['uber', 'lyft'];

function parseProviderList(providers?: RideProvider[]): RideProvider[] {
  const normalized = (providers || RIDE_PROVIDERS).filter((provider): provider is RideProvider =>
    RIDE_PROVIDERS.includes(provider)
  );
  return normalized.length ? normalized : RIDE_PROVIDERS;
}

async function safeExternalCall<T>(metricName: string, loader: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await loader();
    metricsCollector.recordExternalApi(metricName, Date.now() - startedAt);
    return result;
  } catch (error) {
    metricsCollector.recordExternalApi(metricName, Date.now() - startedAt, true);
    throw error;
  }
}

export class RideAggregatorService {
  async getProviderStatus() {
    return {
      providers: {
        uber: this.getUberStatus(),
        lyft: this.getLyftStatus(),
      },
    };
  }

  async getEstimates(
    request: RideEstimateRequest
  ): Promise<{ estimates: RideEstimate[]; errors: ProviderError[]; cacheHit: boolean }> {
    const pickup = { lat: Number(request.pickup.lat), lng: Number(request.pickup.lng) };
    const dropoff = await this.resolveDropoff(request);
    const providers = parseProviderList(request.providers);

    const { value, hit } = await getOrSetCache({
      namespace: 'external:rides',
      key: createCacheKey([pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, providers.join(',')]),
      ttlMs: parseInt(process.env.RIDE_ESTIMATES_CACHE_TTL_MS || String(CacheTTL.EXTERNAL_API), 10),
      loader: async () => {
        const results = await Promise.allSettled(
          providers.map(provider => this.getProviderEstimate(provider, pickup, dropoff))
        );

        const estimates: RideEstimate[] = [];
        const errors: ProviderError[] = [];

        results.forEach((result, index) => {
          const provider = providers[index];
          if (result.status === 'fulfilled') {
            estimates.push(result.value);
          } else {
            errors.push({
              provider,
              message: result.reason instanceof Error ? result.reason.message : 'Unknown provider error',
            });
          }
        });

        estimates.sort((a, b) => {
          const aFare = a.estimatedFareMin ?? Number.MAX_SAFE_INTEGER;
          const bFare = b.estimatedFareMin ?? Number.MAX_SAFE_INTEGER;
          if (aFare !== bFare) return aFare - bFare;
          return (a.estimatedArrivalMinutes ?? Number.MAX_SAFE_INTEGER) - (b.estimatedArrivalMinutes ?? Number.MAX_SAFE_INTEGER);
        });

        return { estimates, errors };
      },
    });

    return { ...value, cacheHit: hit };
  }

  async getDeepLink(request: RideEstimateRequest & { provider: RideProvider }) {
    const pickup = { lat: Number(request.pickup.lat), lng: Number(request.pickup.lng) };
    const dropoff = await this.resolveDropoff(request);
    if (request.provider === 'uber') {
      return {
        provider: 'uber' as const,
        deepLink: this.buildUberDeepLink(pickup, dropoff),
      };
    }
    return {
      provider: 'lyft' as const,
      deepLink: this.buildLyftDeepLink(pickup, dropoff),
    };
  }

  private getUberStatus(): ProviderStatus {
    if (process.env.UBER_RIDES_API_URL && process.env.UBER_RIDES_API_KEY) {
      return { enabled: true, mode: 'live' };
    }
    if (process.env.UBER_ENABLED === 'false') {
      return { enabled: false, mode: 'disabled' };
    }
    return { enabled: true, mode: 'deep_link_only' };
  }

  private getLyftStatus(): ProviderStatus {
    if (process.env.LYFT_API_URL && process.env.LYFT_API_KEY) {
      return { enabled: true, mode: 'live' };
    }
    if (process.env.LYFT_ENABLED === 'false') {
      return { enabled: false, mode: 'disabled' };
    }
    return { enabled: true, mode: 'deep_link_only' };
  }

  private async resolveDropoff(request: RideEstimateRequest): Promise<ResolvedDropoff> {
    if (request.dropoff) {
      return {
        lat: Number(request.dropoff.lat),
        lng: Number(request.dropoff.lng),
        address: request.dropoff.address,
        label: request.dropoff.address || 'dropoff',
      };
    }

    if (request.merchantId) {
      const merchant = await prisma.merchant.findUnique({
        where: { id: request.merchantId },
        select: { businessName: true, address: true, latitude: true, longitude: true },
      });
      if (!merchant || merchant.latitude == null || merchant.longitude == null) {
        throw new Error('Merchant dropoff could not be resolved.');
      }
      return {
        lat: merchant.latitude,
        lng: merchant.longitude,
        address: merchant.address,
        label: merchant.businessName,
      };
    }

    if (request.eventId) {
      const event = await prisma.event.findUnique({
        where: { id: request.eventId },
        select: { title: true, venueAddress: true, latitude: true, longitude: true },
      });
      if (!event || event.latitude == null || event.longitude == null) {
        throw new Error('Event dropoff could not be resolved.');
      }
      return {
        lat: event.latitude,
        lng: event.longitude,
        address: event.venueAddress,
        label: event.title,
      };
    }

    if (request.serviceId) {
      const service = await (prisma as any).service.findUnique({
        where: { id: request.serviceId },
        select: {
          title: true,
          merchant: {
            select: { businessName: true, address: true, latitude: true, longitude: true },
          },
        },
      });
      const merchant = service?.merchant;
      if (!service || !merchant || merchant.latitude == null || merchant.longitude == null) {
        throw new Error('Service dropoff could not be resolved.');
      }
      return {
        lat: merchant.latitude,
        lng: merchant.longitude,
        address: merchant.address,
        label: `${merchant.businessName} - ${service.title}`,
      };
    }

    throw new Error('A ride dropoff is required.');
  }

  private async getProviderEstimate(
    provider: RideProvider,
    pickup: CoordinateInput,
    dropoff: ResolvedDropoff
  ): Promise<RideEstimate> {
    if (provider === 'uber') {
      return this.getUberEstimate(pickup, dropoff);
    }
    return this.getLyftEstimate(pickup, dropoff);
  }

  private async getUberEstimate(pickup: CoordinateInput, dropoff: ResolvedDropoff): Promise<RideEstimate> {
    const status = this.getUberStatus();
    if (!status.enabled) {
      throw new Error('Uber is disabled.');
    }

    const deepLink = this.buildUberDeepLink(pickup, dropoff);

    if (status.mode === 'live') {
      const data = await safeExternalCall('rides.uber.estimate', async () => {
        const response = await axios.get(process.env.UBER_RIDES_API_URL!, {
          timeout: parseInt(process.env.RIDE_PROVIDER_TIMEOUT_MS || '6000', 10),
          headers: { Authorization: `Bearer ${process.env.UBER_RIDES_API_KEY}` },
          params: {
            start_latitude: pickup.lat,
            start_longitude: pickup.lng,
            end_latitude: dropoff.lat,
            end_longitude: dropoff.lng,
          },
        });
        return response.data;
      });

      return {
        provider: 'uber',
        rideType: String(data.rideType || data.display_name || 'uberx'),
        estimatedFareMin: Number(data.estimatedFareMin ?? data.low_estimate ?? 0),
        estimatedFareMax: Number(data.estimatedFareMax ?? data.high_estimate ?? 0),
        estimatedArrivalMinutes: Number(data.estimatedArrivalMinutes ?? data.pickup_estimate ?? 0),
        estimatedTripMinutes: Number(data.estimatedTripMinutes ?? data.durationMinutes ?? 0),
        currency: String(data.currency || 'USD'),
        deepLink,
        availability: 'available',
        rawMeta: data,
      };
    }

    return this.buildHeuristicEstimate('uber', pickup, dropoff, deepLink);
  }

  private async getLyftEstimate(pickup: CoordinateInput, dropoff: ResolvedDropoff): Promise<RideEstimate> {
    const status = this.getLyftStatus();
    if (!status.enabled) {
      throw new Error('Lyft is disabled.');
    }

    const deepLink = this.buildLyftDeepLink(pickup, dropoff);

    if (status.mode === 'live') {
      const data = await safeExternalCall('rides.lyft.estimate', async () => {
        const response = await axios.get(process.env.LYFT_API_URL!, {
          timeout: parseInt(process.env.RIDE_PROVIDER_TIMEOUT_MS || '6000', 10),
          headers: { Authorization: `Bearer ${process.env.LYFT_API_KEY}` },
          params: {
            start_lat: pickup.lat,
            start_lng: pickup.lng,
            end_lat: dropoff.lat,
            end_lng: dropoff.lng,
          },
        });
        return response.data;
      });

      return {
        provider: 'lyft',
        rideType: String(data.rideType || data.display_name || 'lyft'),
        estimatedFareMin: Number(
          data.estimatedFareMin ?? ((data.estimated_cost_cents_min ?? 0) / 100)
        ),
        estimatedFareMax: Number(
          data.estimatedFareMax ?? ((data.estimated_cost_cents_max ?? 0) / 100)
        ),
        estimatedArrivalMinutes: Number(data.estimatedArrivalMinutes ?? ((data.eta_seconds ?? 0) / 60)),
        estimatedTripMinutes: Number(data.estimatedTripMinutes ?? data.durationMinutes ?? 0),
        currency: String(data.currency || 'USD'),
        deepLink,
        availability: 'available',
        rawMeta: data,
      };
    }

    return this.buildHeuristicEstimate('lyft', pickup, dropoff, deepLink);
  }

  private buildUberDeepLink(pickup: CoordinateInput, dropoff: ResolvedDropoff): string {
    return `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${pickup.lat}&pickup[longitude]=${pickup.lng}&dropoff[latitude]=${dropoff.lat}&dropoff[longitude]=${dropoff.lng}&dropoff[nickname]=${encodeURIComponent(dropoff.label)}`;
  }

  private buildLyftDeepLink(pickup: CoordinateInput, dropoff: ResolvedDropoff): string {
    return `lyft://ridetype?id=lyft&pickup[latitude]=${pickup.lat}&pickup[longitude]=${pickup.lng}&destination[latitude]=${dropoff.lat}&destination[longitude]=${dropoff.lng}`;
  }

  private buildHeuristicEstimate(
    provider: RideProvider,
    pickup: CoordinateInput,
    dropoff: ResolvedDropoff,
    deepLink: string
  ): RideEstimate {
    const distanceKm = haversineMeters(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng) / 1000;
    const baseFare = provider === 'uber' ? 6 : 5.5;
    const perKm = provider === 'uber' ? 1.8 : 1.65;
    const fareMin = Number((baseFare + distanceKm * perKm).toFixed(2));
    const fareMax = Number((fareMin + 4.5).toFixed(2));
    const arrival = provider === 'uber' ? 5 : 6;
    const tripMinutes = Math.max(6, Math.round(distanceKm * 2.8));

    return {
      provider,
      rideType: provider === 'uber' ? 'uberx' : 'lyft',
      estimatedFareMin: fareMin,
      estimatedFareMax: fareMax,
      estimatedArrivalMinutes: arrival,
      estimatedTripMinutes: tripMinutes,
      currency: 'USD',
      deepLink,
      availability: 'deep_link_only',
      rawMeta: {
        heuristic: true,
        distanceKm: Number(distanceKm.toFixed(2)),
        destination: dropoff.label,
      },
    };
  }
}

export const rideAggregatorService = new RideAggregatorService();
