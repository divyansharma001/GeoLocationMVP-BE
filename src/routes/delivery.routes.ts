import { Response, Router } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { detailRateLimit, expensiveReadRateLimit } from '../middleware/production.middleware';
import {
  deliveryAggregatorService,
  DeliveryQuoteRequest,
} from '../services/delivery-aggregator.service';

const router = Router();

function parseCoordinate(value: any, label: string): { lat: number; lng: number } | null {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

function parseProviders(value: unknown): Array<'ubereats' | 'doordash'> | undefined {
  if (!Array.isArray(value)) return undefined;
  const providers = value.filter(
    (item): item is 'ubereats' | 'doordash' => item === 'ubereats' || item === 'doordash'
  );
  return providers.length ? providers : undefined;
}

function buildRequest(body: any): DeliveryQuoteRequest | { error: string } {
  const origin = parseCoordinate(body?.origin, 'origin');
  if (!origin) {
    return { error: 'Valid origin coordinates are required.' };
  }

  const destination = body?.destination ? parseCoordinate(body.destination, 'destination') : null;

  if (!destination && !body?.merchantId && !body?.eventId && !body?.serviceId) {
    return { error: 'A destination, merchantId, eventId, or serviceId is required.' };
  }

  return {
    origin,
    destination: destination
      ? {
          ...destination,
          address: typeof body.destination?.address === 'string' ? body.destination.address.trim() : undefined,
        }
      : undefined,
    merchantId: body?.merchantId !== undefined ? Number(body.merchantId) : undefined,
    eventId: body?.eventId !== undefined ? Number(body.eventId) : undefined,
    serviceId: body?.serviceId !== undefined ? Number(body.serviceId) : undefined,
    cartSubtotal: body?.cartSubtotal !== undefined ? Number(body.cartSubtotal) : undefined,
    providers: parseProviders(body?.providers),
  };
}

router.get('/delivery/providers/status', detailRateLimit, async (_req: AuthRequest, res: Response) => {
  const status = await deliveryAggregatorService.getProviderStatus();
  res.json(status);
});

router.post('/delivery/quotes', expensiveReadRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = buildRequest(req.body);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const result = await deliveryAggregatorService.getQuotes(parsed);
    res.setHeader('X-Cache', result.cacheHit ? 'HIT' : 'MISS');
    res.json(result);
  } catch (error: any) {
    if (error.message?.includes('required') || error.message?.includes('resolved')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Delivery quotes error:', error);
    res.status(500).json({ error: 'Failed to fetch delivery quotes' });
  }
});

router.post('/delivery/compare', expensiveReadRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = buildRequest(req.body);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const result = await deliveryAggregatorService.compareQuotes(parsed);
    res.setHeader('X-Cache', result.cacheHit ? 'HIT' : 'MISS');
    res.json(result);
  } catch (error: any) {
    if (error.message?.includes('required') || error.message?.includes('resolved')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Delivery compare error:', error);
    res.status(500).json({ error: 'Failed to compare delivery options' });
  }
});

export default router;
