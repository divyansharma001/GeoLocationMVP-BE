import { Router, Response } from 'express';
import { z } from 'zod';
import {
  protect,
  AuthRequest,
  isApprovedMerchant,
  requireAdmin,
} from '../middleware/auth.middleware';
import {
  requireMerchantVerified,
  claimCooldownLock,
  releaseClaimLockAndSetCooldown,
  releaseClaimLock,
} from '../middleware/verification-lock.middleware';
import {
  createVenueReward,
  claimVenueReward,
  getAvailableVenueRewards,
  getMerchantVenueRewards,
  activateVenueReward,
  deactivateVenueReward,
  submitVerificationStep,
  reviewVerificationStep,
  getMerchantVerificationStatus,
} from '../services/venue-reward.service';

const router = Router();

// ── Merchant Reward Endpoints ──

const createRewardSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().optional(),
  rewardType: z.enum(['COINS', 'DISCOUNT_PERCENTAGE', 'DISCOUNT_FIXED', 'BONUS_POINTS', 'FREE_ITEM']),
  rewardAmount: z.number().positive(),
  geoFenceRadiusMeters: z.number().int().min(10).max(5000).optional(),
  storeId: z.number().int().positive().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  maxTotalClaims: z.number().int().positive().optional(),
  maxClaimsPerUser: z.number().int().positive().optional(),
  cooldownHours: z.number().int().min(0).optional(),
  requiresCheckIn: z.boolean().optional(),
  imageUrl: z.string().url().optional(),
});

router.post(
  '/rewards',
  protect,
  isApprovedMerchant,
  requireMerchantVerified,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = createRewardSchema.parse(req.body);
      const merchantId = req.merchant!.id;
      const reward = await createVenueReward({
        ...data,
        merchantId,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
      });
      res.status(201).json({ success: true, data: reward });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: error.issues });
      }
      console.error('Error creating venue reward:', error);
      const status = error.message?.includes('not found') ? 404 : 400;
      res.status(status).json({ success: false, error: error.message });
    }
  }
);

router.get(
  '/rewards/my',
  protect,
  isApprovedMerchant,
  async (req: AuthRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const status = req.query.status as string | undefined;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

      const result = await getMerchantVenueRewards({ merchantId, status, page, limit });
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Error fetching merchant venue rewards:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch venue rewards' });
    }
  }
);

router.patch(
  '/rewards/:id/activate',
  protect,
  isApprovedMerchant,
  requireMerchantVerified,
  async (req: AuthRequest, res: Response) => {
    try {
      const rewardId = Number(req.params.id);
      const merchantId = req.merchant!.id;
      const reward = await activateVenueReward(rewardId, merchantId);
      res.json({ success: true, message: 'Venue reward activated', data: reward });
    } catch (error: any) {
      console.error('Error activating venue reward:', error);
      const status = error.message?.includes('not found') ? 404 : 400;
      res.status(status).json({ success: false, error: error.message });
    }
  }
);

router.patch(
  '/rewards/:id/deactivate',
  protect,
  isApprovedMerchant,
  async (req: AuthRequest, res: Response) => {
    try {
      const rewardId = Number(req.params.id);
      const merchantId = req.merchant!.id;
      const reward = await deactivateVenueReward(rewardId, merchantId);
      res.json({ success: true, message: 'Venue reward paused', data: reward });
    } catch (error: any) {
      console.error('Error deactivating venue reward:', error);
      const status = error.message?.includes('not found') ? 404 : 400;
      res.status(status).json({ success: false, error: error.message });
    }
  }
);

// ── User Reward Endpoints ──

const claimSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  verificationMethod: z.enum(['GPS', 'QR_CODE']).optional(),
});

router.post(
  '/rewards/:venueRewardId/claim',
  protect,
  claimCooldownLock,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = claimSchema.parse(req.body);
      const userId = req.user!.id;
      const venueRewardId = Number(req.params.venueRewardId);

      const result = await claimVenueReward({
        userId,
        venueRewardId,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        verificationMethod: parsed.verificationMethod,
      });

      // Release lock and set cooldown after successful claim
      await releaseClaimLockAndSetCooldown(req, result.cooldownHours);

      res.json({ success: true, data: result });
    } catch (error: any) {
      // Release lock WITHOUT setting cooldown on failure
      await releaseClaimLock(req);

      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: error.issues });
      }
      console.error('Error claiming venue reward:', error);
      const msg = error.message || '';
      const status = msg.includes('not found') ? 404
        : msg.includes('outside') || msg.includes('cooldown') || msg.includes('limit') || msg.includes('maximum') || msg.includes('check in') ? 400
        : 500;
      res.status(status).json({ success: false, error: error.message });
    }
  }
);

const nearbySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(100).max(50000).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

router.get(
  '/rewards/nearby',
  protect,
  async (req: AuthRequest, res: Response) => {
    try {
      const params = nearbySchema.parse(req.query);
      const userId = req.user!.id;

      const result = await getAvailableVenueRewards({
        latitude: params.latitude,
        longitude: params.longitude,
        radiusMeters: params.radius,
        page: params.page,
        limit: params.limit,
        userId,
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ errors: error.issues });
      }
      console.error('Error fetching nearby venue rewards:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch nearby rewards' });
    }
  }
);

// ── Verification Endpoints ──

router.post(
  '/verification/submit',
  protect,
  isApprovedMerchant,
  async (req: AuthRequest, res: Response) => {
    try {
      const { stepType, documentUrl, documentType } = req.body;
      const merchantId = req.merchant!.id;

      if (!stepType || !documentUrl) {
        return res.status(400).json({ success: false, error: 'stepType and documentUrl are required' });
      }

      const result = await submitVerificationStep({ merchantId, stepType, documentUrl, documentType });
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Error submitting verification:', error);
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

router.get(
  '/verification/status',
  protect,
  isApprovedMerchant,
  async (req: AuthRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const status = await getMerchantVerificationStatus(merchantId);
      res.json({ success: true, data: status });
    } catch (error: any) {
      console.error('Error fetching verification status:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch verification status' });
    }
  }
);

router.patch(
  '/verification/:id/review',
  protect,
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const verificationId = Number(req.params.id);
      const adminUserId = req.user!.id;
      const { approved, rejectionReason, notes } = req.body;

      if (approved === undefined) {
        return res.status(400).json({ success: false, error: 'approved (boolean) is required' });
      }

      const result = await reviewVerificationStep({
        verificationId,
        adminUserId,
        approved,
        rejectionReason,
        notes,
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Error reviewing verification:', error);
      const status = error.message?.includes('not found') ? 404 : 400;
      res.status(status).json({ success: false, error: error.message });
    }
  }
);

export default router;
