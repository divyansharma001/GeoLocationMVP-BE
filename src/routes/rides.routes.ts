import { Response, Router } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { detailRateLimit, expensiveReadRateLimit } from '../middleware/production.middleware';
import { rideAggregatorService, RideEstimateRequest } from '../services/ride-aggregator.service';

const router = Router();

function parseCoordinate(value: any): { lat: number; lng: number } | null {
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

function parseProviders(value: unknown): Array<'uber' | 'lyft'> | undefined {
  if (!Array.isArray(value)) return undefined;
  const providers = value.filter((item): item is 'uber' | 'lyft' => item === 'uber' || item === 'lyft');
  return providers.length ? providers : undefined;
}

function buildRequest(body: any): RideEstimateRequest | { error: string } {
  const pickup = parseCoordinate(body?.pickup);
  if (!pickup) {
    return { error: 'Valid pickup coordinates are required.' };
  }

  const dropoff = body?.dropoff ? parseCoordinate(body.dropoff) : null;
  if (!dropoff && !body?.merchantId && !body?.eventId && !body?.serviceId) {
    return { error: 'A dropoff, merchantId, eventId, or serviceId is required.' };
  }

  return {
    pickup,
    dropoff: dropoff
      ? {
          ...dropoff,
          address: typeof body.dropoff?.address === 'string' ? body.dropoff.address.trim() : undefined,
        }
      : undefined,
    merchantId: body?.merchantId !== undefined ? Number(body.merchantId) : undefined,
    eventId: body?.eventId !== undefined ? Number(body.eventId) : undefined,
    serviceId: body?.serviceId !== undefined ? Number(body.serviceId) : undefined,
    providers: parseProviders(body?.providers),
  };
}

router.get('/rides/providers/status', detailRateLimit, async (_req: AuthRequest, res: Response) => {
  const status = await rideAggregatorService.getProviderStatus();
  res.json(status);
});

router.post('/rides/estimates', expensiveReadRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = buildRequest(req.body);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const result = await rideAggregatorService.getEstimates(parsed);
    res.setHeader('X-Cache', result.cacheHit ? 'HIT' : 'MISS');
    res.json(result);
  } catch (error: any) {
    if (error.message?.includes('required') || error.message?.includes('resolved')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Ride estimates error:', error);
    res.status(500).json({ error: 'Failed to fetch ride estimates' });
  }
});

router.post('/rides/deeplink', detailRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = buildRequest(req.body);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const provider = req.body?.provider;
    if (provider !== 'uber' && provider !== 'lyft') {
      return res.status(400).json({ error: 'provider must be either uber or lyft.' });
    }

    const result = await rideAggregatorService.getDeepLink({
      ...parsed,
      provider,
    });
    res.json(result);
  } catch (error: any) {
    if (error.message?.includes('required') || error.message?.includes('resolved')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Ride deeplink error:', error);
    res.status(500).json({ error: 'Failed to generate ride deeplink' });
  }
});

export default router;
