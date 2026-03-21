import axios from 'axios';
import prisma from '../lib/prisma';
import { haversineMeters } from '../lib/geo';
import { CacheTTL, createCacheKey, getOrSetCache } from '../lib/cache';
import { metricsCollector } from '../lib/metrics';

type DeliveryProvider = 'ubereats' | 'doordash';

export interface CoordinateInput {
  lat: number;
  lng: number;
}

export interface DeliveryQuoteRequest {
  origin: CoordinateInput;
  destination?: CoordinateInput & {
    address?: string;
    merchantId?: number;
    eventId?: number;
    serviceId?: number;
  };
  merchantId?: number;
  eventId?: number;
  serviceId?: number;
  cartSubtotal?: number;
  providers?: DeliveryProvider[];
}

export interface ProviderError {
  provider: string;
  message: string;
}

export interface DeliveryQuote {
  provider: DeliveryProvider;
  serviceLevel: string;
  deliveryType: string;
  estimatedFee: number | null;
  estimatedMinMinutes: number | null;
  estimatedMaxMinutes: number | null;
  currency: string;
  deepLink: string;
  availability: 'available' | 'deep_link_only' | 'unavailable';
  rawMeta: Record<string, unknown>;
}

interface ProviderStatus {
  enabled: boolean;
  mode: 'live' | 'heuristic' | 'disabled';
}

interface ResolvedDestination {
  lat: number;
  lng: number;
  address?: string | null;
  label: string;
}

const DELIVERY_PROVIDERS: DeliveryProvider[] = ['ubereats', 'doordash'];

function toCoordinatePair(value: CoordinateInput): CoordinateInput {
  return { lat: Number(value.lat), lng: Number(value.lng) };
}

function buildGeoQuery(origin: CoordinateInput, destination: CoordinateInput): string {
  return `${origin.lat},${origin.lng}|${destination.lat},${destination.lng}`;
}

function parseProviderList(providers?: DeliveryProvider[]): DeliveryProvider[] {
  const normalized = (providers || DELIVERY_PROVIDERS).filter((provider): provider is DeliveryProvider =>
    DELIVERY_PROVIDERS.includes(provider)
  );
  return normalized.length ? normalized : DELIVERY_PROVIDERS;
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

export class DeliveryAggregatorService {
  async getProviderStatus() {
    return {
      providers: {
        ubereats: this.getUberEatsStatus(),
        doordash: this.getDoorDashStatus(),
      },
    };
  }

  async getQuotes(request: DeliveryQuoteRequest): Promise<{ quotes: DeliveryQuote[]; errors: ProviderError[]; cacheHit: boolean }> {
    const resolved = await this.resolveDestination(request);
    const origin = toCoordinatePair(request.origin);
    const providers = parseProviderList(request.providers);

    const { value, hit } = await getOrSetCache({
      namespace: 'external:delivery',
      key: createCacheKey([
        origin.lat,
        origin.lng,
        resolved.lat,
        resolved.lng,
        resolved.address || '',
        request.cartSubtotal || 0,
        providers.join(','),
      ]),
      ttlMs: parseInt(process.env.DELIVERY_QUOTES_CACHE_TTL_MS || String(CacheTTL.EXTERNAL_API), 10),
      loader: async () => {
        const results = await Promise.allSettled(
          providers.map(provider => this.getProviderQuote(provider, origin, resolved, request.cartSubtotal))
        );

        const quotes: DeliveryQuote[] = [];
        const errors: ProviderError[] = [];

        results.forEach((result, index) => {
          const provider = providers[index];
          if (result.status === 'fulfilled') {
            quotes.push(result.value);
          } else {
            errors.push({
              provider,
              message: result.reason instanceof Error ? result.reason.message : 'Unknown provider error',
            });
          }
        });

        quotes.sort((a, b) => {
          const aFee = a.estimatedFee ?? Number.MAX_SAFE_INTEGER;
          const bFee = b.estimatedFee ?? Number.MAX_SAFE_INTEGER;
          if (aFee !== bFee) return aFee - bFee;
          return (a.estimatedMinMinutes ?? Number.MAX_SAFE_INTEGER) - (b.estimatedMinMinutes ?? Number.MAX_SAFE_INTEGER);
        });

        return { quotes, errors };
      },
    });

    return { ...value, cacheHit: hit };
  }

  async compareQuotes(request: DeliveryQuoteRequest) {
    const result = await this.getQuotes(request);
    return {
      ...result,
      bestByPrice: result.quotes[0] || null,
      bestByEta: [...result.quotes].sort((a, b) =>
        (a.estimatedMinMinutes ?? Number.MAX_SAFE_INTEGER) - (b.estimatedMinMinutes ?? Number.MAX_SAFE_INTEGER)
      )[0] || null,
    };
  }

  private getUberEatsStatus(): ProviderStatus {
    if (process.env.UBEREATS_API_URL && process.env.UBEREATS_API_KEY) {
      return { enabled: true, mode: 'live' };
    }
    if (process.env.UBEREATS_ENABLED === 'false') {
      return { enabled: false, mode: 'disabled' };
    }
    return { enabled: true, mode: 'heuristic' };
  }

  private getDoorDashStatus(): ProviderStatus {
    if (process.env.DOORDASH_API_URL && process.env.DOORDASH_API_KEY) {
      return { enabled: true, mode: 'live' };
    }
    if (process.env.DOORDASH_ENABLED === 'false') {
      return { enabled: false, mode: 'disabled' };
    }
    return { enabled: true, mode: 'heuristic' };
  }

  private async resolveDestination(request: DeliveryQuoteRequest): Promise<ResolvedDestination> {
    if (request.destination) {
      return {
        lat: Number(request.destination.lat),
        lng: Number(request.destination.lng),
        address: request.destination.address,
        label: request.destination.address || 'destination',
      };
    }

    if (request.merchantId) {
      const merchant = await prisma.merchant.findUnique({
        where: { id: request.merchantId },
        select: { businessName: true, address: true, latitude: true, longitude: true },
      });
      if (!merchant || merchant.latitude == null || merchant.longitude == null) {
        throw new Error('Merchant destination could not be resolved.');
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
        throw new Error('Event destination could not be resolved.');
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
        throw new Error('Service destination could not be resolved.');
      }
      return {
        lat: merchant.latitude,
        lng: merchant.longitude,
        address: merchant.address,
        label: `${merchant.businessName} - ${service.title}`,
      };
    }

    throw new Error('A delivery destination is required.');
  }

  private async getProviderQuote(
    provider: DeliveryProvider,
    origin: CoordinateInput,
    destination: ResolvedDestination,
    cartSubtotal?: number
  ): Promise<DeliveryQuote> {
    if (provider === 'ubereats') {
      return this.getUberEatsQuote(origin, destination, cartSubtotal);
    }
    return this.getDoorDashQuote(origin, destination, cartSubtotal);
  }

  private async getUberEatsQuote(
    origin: CoordinateInput,
    destination: ResolvedDestination,
    cartSubtotal?: number
  ): Promise<DeliveryQuote> {
    const status = this.getUberEatsStatus();
    if (!status.enabled) {
      throw new Error('Uber Eats is disabled.');
    }

    const deepLink = `https://www.ubereats.com/store?dropoff=${encodeURIComponent(
      `${destination.lat},${destination.lng}`
    )}`;

    if (status.mode === 'live') {
      const data = await safeExternalCall('delivery.ubereats.quote', async () => {
        const response = await axios.get(process.env.UBEREATS_API_URL!, {
          timeout: parseInt(process.env.DELIVERY_PROVIDER_TIMEOUT_MS || '6000', 10),
          headers: { Authorization: `Bearer ${process.env.UBEREATS_API_KEY}` },
          params: {
            origin_lat: origin.lat,
            origin_lng: origin.lng,
            destination_lat: destination.lat,
            destination_lng: destination.lng,
            subtotal: cartSubtotal,
          },
        });
        return response.data;
      });

      return {
        provider: 'ubereats',
        serviceLevel: String(data.serviceLevel || 'standard'),
        deliveryType: String(data.deliveryType || 'delivery'),
        estimatedFee: Number(data.estimatedFee ?? data.fee ?? 0),
        estimatedMinMinutes: Number(data.estimatedMinMinutes ?? data.etaMin ?? 0),
        estimatedMaxMinutes: Number(data.estimatedMaxMinutes ?? data.etaMax ?? 0),
        currency: String(data.currency || 'USD'),
        deepLink,
        availability: 'available',
        rawMeta: data,
      };
    }

    return this.buildHeuristicQuote('ubereats', origin, destination, cartSubtotal, deepLink);
  }

  private async getDoorDashQuote(
    origin: CoordinateInput,
    destination: ResolvedDestination,
    cartSubtotal?: number
  ): Promise<DeliveryQuote> {
    const status = this.getDoorDashStatus();
    if (!status.enabled) {
      throw new Error('DoorDash is disabled.');
    }

    const deepLink = `https://www.doordash.com/search/store/${encodeURIComponent(destination.label)}`;

    if (status.mode === 'live') {
      const data = await safeExternalCall('delivery.doordash.quote', async () => {
        const response = await axios.get(process.env.DOORDASH_API_URL!, {
          timeout: parseInt(process.env.DELIVERY_PROVIDER_TIMEOUT_MS || '6000', 10),
          headers: { Authorization: `Bearer ${process.env.DOORDASH_API_KEY}` },
          params: {
            pickup_lat: origin.lat,
            pickup_lng: origin.lng,
            dropoff_lat: destination.lat,
            dropoff_lng: destination.lng,
            subtotal: cartSubtotal,
          },
        });
        return response.data;
      });

      return {
        provider: 'doordash',
        serviceLevel: String(data.serviceLevel || 'standard'),
        deliveryType: String(data.deliveryType || 'delivery'),
        estimatedFee: Number(data.estimatedFee ?? data.fee ?? 0),
        estimatedMinMinutes: Number(data.estimatedMinMinutes ?? data.etaMin ?? 0),
        estimatedMaxMinutes: Number(data.estimatedMaxMinutes ?? data.etaMax ?? 0),
        currency: String(data.currency || 'USD'),
        deepLink,
        availability: 'available',
        rawMeta: data,
      };
    }

    return this.buildHeuristicQuote('doordash', origin, destination, cartSubtotal, deepLink);
  }

  private buildHeuristicQuote(
    provider: DeliveryProvider,
    origin: CoordinateInput,
    destination: ResolvedDestination,
    cartSubtotal: number | undefined,
    deepLink: string
  ): DeliveryQuote {
    const distanceKm = haversineMeters(origin.lat, origin.lng, destination.lat, destination.lng) / 1000;
    const subtotal = cartSubtotal ?? 0;
    const baseFee = provider === 'ubereats' ? 3.49 : 2.99;
    const distanceFee = distanceKm * (provider === 'ubereats' ? 0.95 : 0.85);
    const smallOrderFee = subtotal > 0 && subtotal < 15 ? 2 : 0;
    const estimatedFee = Number((baseFee + distanceFee + smallOrderFee).toFixed(2));
    const etaBase = provider === 'ubereats' ? 18 : 16;
    const etaMin = Math.max(12, Math.round(etaBase + distanceKm * 2.5));
    const etaMax = etaMin + 8;

    return {
      provider,
      serviceLevel: 'standard',
      deliveryType: 'delivery',
      estimatedFee,
      estimatedMinMinutes: etaMin,
      estimatedMaxMinutes: etaMax,
      currency: 'USD',
      deepLink,
      availability: 'deep_link_only',
      rawMeta: {
        heuristic: true,
        distanceKm: Number(distanceKm.toFixed(2)),
        destination: destination.label,
      },
    };
  }
}

export const deliveryAggregatorService = new DeliveryAggregatorService();
