# 🎯 Heist Token Feature - Developer Guide

## 🚀 Quick Start for Developers

This guide helps you get started implementing the Heist Token feature.

---

## 📋 Prerequisites

Before starting:
- [x] Read `HEIST_PROJECT_SUMMARY.md` for overview
- [x] Review `HEIST_TOKEN_FEATURE_PLAN.md` for complete specs
- [x] Check `HEIST_FLOW_DIAGRAMS.md` for visual understanding
- [ ] Get stakeholder approval to proceed
- [ ] Set up local development environment

---

## 🔧 Step 1: Database Setup (Day 1)

### 1.1 Review Schema Changes

The schema has already been updated in `prisma/schema.prisma`:
- ✅ HeistToken model added
- ✅ Heist model added
- ✅ HeistNotification model added
- ✅ User model updated with relations
- ✅ Enums added (HeistStatus, HeistNotificationType)
- ✅ PointEventType enum updated

### 1.2 Create Migration

```bash
# Generate migration file
npx prisma migrate dev --name add_heist_token_feature

# This will:
# 1. Create migration SQL in prisma/migrations/
# 2. Apply migration to your local database
# 3. Regenerate Prisma Client

# Verify migration was successful
npx prisma studio
# Check that HeistToken, Heist, HeistNotification tables exist
```

### 1.3 Seed Point Event Types

Create `scripts/seed-heist-point-types.ts`:

```typescript
import prisma from '../src/lib/prisma';

async function seedHeistPointTypes() {
  console.log('🌱 Seeding Heist Point Event Types...');

  const pointTypes = [
    {
      name: 'HEIST_GAIN',
      description: 'Points gained from successfully robbing another player',
      points: 0, // Variable amount
      active: true,
    },
    {
      name: 'HEIST_LOSS',
      description: 'Points lost from being robbed by another player',
      points: 0, // Variable amount (will be negative)
      active: true,
    },
  ];

  for (const type of pointTypes) {
    await prisma.pointEventTypeMaster.upsert({
      where: { name: type.name },
      update: type,
      create: type,
    });
    console.log(`✅ Created/Updated: ${type.name}`);
  }

  console.log('🎉 Heist point types seeded successfully!');
}

if (require.main === module) {
  seedHeistPointTypes()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export default seedHeistPointTypes;
```

Run the seed:
```bash
npx ts-node scripts/seed-heist-point-types.ts
```

---

## 📦 Step 2: Set Up Environment Variables

Add to `.env`:

```env
# Heist Feature Configuration
HEIST_ENABLED=true
HEIST_COOLDOWN_HOURS=24
HEIST_TARGET_COOLDOWN_HOURS=48
HEIST_STEAL_PERCENTAGE=5
HEIST_MAX_STEAL_POINTS=100
HEIST_MIN_TARGET_POINTS=20
HEIST_EMAIL_ENABLED=true
HEIST_RATE_LIMIT_PER_MINUTE=10
```

Create config helper in `src/lib/heist/config.ts`:

```typescript
export function getHeistConfig() {
  return {
    enabled: process.env.HEIST_ENABLED === 'true',
    cooldownHours: parseInt(process.env.HEIST_COOLDOWN_HOURS || '24'),
    targetCooldownHours: parseInt(process.env.HEIST_TARGET_COOLDOWN_HOURS || '48'),
    stealPercentage: parseInt(process.env.HEIST_STEAL_PERCENTAGE || '5'),
    maxStealPoints: parseInt(process.env.HEIST_MAX_STEAL_POINTS || '100'),
    minTargetPoints: parseInt(process.env.HEIST_MIN_TARGET_POINTS || '20'),
    emailEnabled: process.env.HEIST_EMAIL_ENABLED === 'true',
    rateLimitPerMinute: parseInt(process.env.HEIST_RATE_LIMIT_PER_MINUTE || '10'),
  };
}
```

---

## 🏗️ Step 3: Implement Core Business Logic (Week 1)

### 3.1 Token Management (`src/lib/heist/tokens.ts`)

```typescript
import prisma from '../prisma';

/**
 * Get user's token balance and history
 */
export async function getTokenBalance(userId: number) {
  const tokenData = await prisma.heistToken.findUnique({
    where: { userId },
  });

  if (!tokenData) {
    return {
      balance: 0,
      totalEarned: 0,
      totalSpent: 0,
      lastEarnedAt: null,
      lastSpentAt: null,
    };
  }

  return tokenData;
}

/**
 * Award a heist token to a user (called on successful referral)
 */
export async function awardToken(userId: number) {
  const result = await prisma.heistToken.upsert({
    where: { userId },
    update: {
      balance: { increment: 1 },
      totalEarned: { increment: 1 },
      lastEarnedAt: new Date(),
    },
    create: {
      userId,
      balance: 1,
      totalEarned: 1,
      lastEarnedAt: new Date(),
    },
  });

  return result;
}

/**
 * Spend a token (called during heist execution)
 * Returns true if successful, false if insufficient balance
 */
export async function spendToken(userId: number): Promise<boolean> {
  const tokens = await getTokenBalance(userId);
  
  if (tokens.balance < 1) {
    return false;
  }

  await prisma.heistToken.update({
    where: { userId },
    data: {
      balance: { decrement: 1 },
      totalSpent: { increment: 1 },
      lastSpentAt: new Date(),
    },
  });

  return true;
}

/**
 * Check if user has enough tokens
 */
export async function hasTokens(userId: number, required: number = 1): Promise<boolean> {
  const tokens = await getTokenBalance(userId);
  return tokens.balance >= required;
}
```

### 3.2 Heist Validation (`src/lib/heist/validation.ts`)

```typescript
import prisma from '../prisma';
import { addHours } from 'date-fns';
import { getHeistConfig } from './config';

const config = getHeistConfig();

/**
 * Check if attacker can perform a heist (cooldown check)
 */
export async function canPerformHeist(attackerId: number): Promise<{
  allowed: boolean;
  reason?: string;
  cooldownEndsAt?: Date;
}> {
  // Get last successful heist by this attacker
  const lastHeist = await prisma.heist.findFirst({
    where: {
      attackerId,
      status: 'SUCCESS',
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!lastHeist) {
    return { allowed: true };
  }

  const cooldownEnd = addHours(lastHeist.createdAt, config.cooldownHours);
  const now = new Date();

  if (now < cooldownEnd) {
    const hoursRemaining = Math.ceil((cooldownEnd.getTime() - now.getTime()) / (1000 * 60 * 60));
    return {
      allowed: false,
      reason: `You can perform another heist in ${hoursRemaining} hours`,
      cooldownEndsAt: cooldownEnd,
    };
  }

  return { allowed: true };
}

/**
 * Check if target is protected (recently robbed)
 */
export async function isTargetProtected(victimId: number): Promise<{
  protected: boolean;
  reason?: string;
  protectionEndsAt?: Date;
}> {
  const lastRobbed = await prisma.heist.findFirst({
    where: {
      victimId,
      status: 'SUCCESS',
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!lastRobbed) {
    return { protected: false };
  }

  const protectionEnd = addHours(lastRobbed.createdAt, config.targetCooldownHours);
  const now = new Date();

  if (now < protectionEnd) {
    const hoursRemaining = Math.ceil((protectionEnd.getTime() - now.getTime()) / (1000 * 60 * 60));
    return {
      protected: true,
      reason: `This player was recently robbed and is protected for ${hoursRemaining} more hours`,
      protectionEndsAt: protectionEnd,
    };
  }

  return { protected: false };
}

/**
 * Validate target user
 */
export async function isValidTarget(
  attackerId: number,
  victimId: number
): Promise<{
  valid: boolean;
  reason?: string;
}> {
  // Can't rob yourself
  if (attackerId === victimId) {
    return { valid: false, reason: 'You cannot rob yourself' };
  }

  // Check if victim exists
  const victim = await prisma.user.findUnique({
    where: { id: victimId },
    select: { id: true, monthlyPoints: true },
  });

  if (!victim) {
    return { valid: false, reason: 'Target user not found' };
  }

  // Check if victim has minimum points
  if (victim.monthlyPoints < config.minTargetPoints) {
    return {
      valid: false,
      reason: `Target must have at least ${config.minTargetPoints} points (currently has ${victim.monthlyPoints})`,
    };
  }

  return { valid: true };
}

/**
 * Calculate how many points will be stolen
 */
export function calculateStealAmount(victimPoints: number): number {
  const percentage = config.stealPercentage / 100;
  const calculated = Math.floor(victimPoints * percentage);
  return Math.min(calculated, config.maxStealPoints);
}

/**
 * Comprehensive eligibility check
 */
export async function checkHeistEligibility(
  attackerId: number,
  victimId: number
): Promise<{
  eligible: boolean;
  reason?: string;
  details?: any;
}> {
  // Check if heist feature is enabled
  if (!config.enabled) {
    return { eligible: false, reason: 'Heist feature is currently disabled' };
  }

  // Check if attacker has tokens
  const { hasTokens: hasToken } = await import('./tokens');
  const hasTokens = await hasToken(attackerId, 1);
  if (!hasTokens) {
    return { eligible: false, reason: 'You need at least 1 Heist Token' };
  }

  // Check attacker cooldown
  const cooldownCheck = await canPerformHeist(attackerId);
  if (!cooldownCheck.allowed) {
    return {
      eligible: false,
      reason: cooldownCheck.reason,
      details: { cooldownEndsAt: cooldownCheck.cooldownEndsAt },
    };
  }

  // Validate target
  const targetCheck = await isValidTarget(attackerId, victimId);
  if (!targetCheck.valid) {
    return { eligible: false, reason: targetCheck.reason };
  }

  // Check target protection
  const protectionCheck = await isTargetProtected(victimId);
  if (protectionCheck.protected) {
    return {
      eligible: false,
      reason: protectionCheck.reason,
      details: { protectionEndsAt: protectionCheck.protectionEndsAt },
    };
  }

  // All checks passed
  return { eligible: true };
}
```

### 3.3 Heist Execution (`src/lib/heist/execution.ts`)

```typescript
import prisma from '../prisma';
import { calculateStealAmount, checkHeistEligibility } from './validation';
import { spendToken } from './tokens';
import { getHeistConfig } from './config';
import { invalidateLeaderboardCache } from '../leaderboard/cache';

interface HeistResult {
  success: boolean;
  heistId?: number;
  pointsStolen?: number;
  error?: string;
  errorCode?: string;
}

/**
 * Execute a heist (main function)
 */
export async function executeHeist(
  attackerId: number,
  victimId: number,
  ipAddress?: string
): Promise<HeistResult> {
  // Pre-validation
  const eligibility = await checkHeistEligibility(attackerId, victimId);
  if (!eligibility.eligible) {
    return {
      success: false,
      error: eligibility.reason,
      errorCode: 'ELIGIBILITY_FAILED',
    };
  }

  // Execute in a transaction
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock victim row
      const victim = await tx.user.findUnique({
        where: { id: victimId },
        select: { id: true, monthlyPoints: true, name: true },
      });

      const attacker = await tx.user.findUnique({
        where: { id: attackerId },
        select: { id: true, monthlyPoints: true, name: true },
      });

      if (!victim || !attacker) {
        throw new Error('User not found');
      }

      // Calculate steal amount
      const pointsStolen = calculateStealAmount(victim.monthlyPoints);

      if (pointsStolen === 0) {
        throw new Error('Insufficient points to steal');
      }

      // Update victim points
      const updatedVictim = await tx.user.update({
        where: { id: victimId },
        data: { monthlyPoints: { decrement: pointsStolen } },
        select: { monthlyPoints: true },
      });

      // Update attacker points
      const updatedAttacker = await tx.user.update({
        where: { id: attackerId },
        data: { monthlyPoints: { increment: pointsStolen } },
        select: { monthlyPoints: true },
      });

      // Spend token
      await tx.heistToken.update({
        where: { userId: attackerId },
        data: {
          balance: { decrement: 1 },
          totalSpent: { increment: 1 },
          lastSpentAt: new Date(),
        },
      });

      // Create heist record
      const heist = await tx.heist.create({
        data: {
          attackerId,
          victimId,
          pointsStolen,
          victimPointsBefore: victim.monthlyPoints,
          victimPointsAfter: updatedVictim.monthlyPoints,
          attackerPointsBefore: attacker.monthlyPoints,
          attackerPointsAfter: updatedAttacker.monthlyPoints,
          status: 'SUCCESS',
          ipAddress,
        },
      });

      // Get HEIST_GAIN and HEIST_LOSS point event type IDs
      const heistGainType = await tx.pointEventTypeMaster.findUnique({
        where: { name: 'HEIST_GAIN' },
      });
      const heistLossType = await tx.pointEventTypeMaster.findUnique({
        where: { name: 'HEIST_LOSS' },
      });

      if (!heistGainType || !heistLossType) {
        throw new Error('Heist point event types not found in database');
      }

      // Create point events
      await tx.userPointEvent.create({
        data: {
          userId: attackerId,
          points: pointsStolen,
          pointEventTypeId: heistGainType.id,
        },
      });

      await tx.userPointEvent.create({
        data: {
          userId: victimId,
          points: -pointsStolen,
          pointEventTypeId: heistLossType.id,
        },
      });

      return {
        heistId: heist.id,
        pointsStolen,
        attackerName: attacker.name,
        victimName: victim.name,
      };
    });

    // Invalidate leaderboard cache
    invalidateLeaderboardCache();

    // Send notifications (async, don't await)
    const { sendHeistNotifications } = await import('./notifications');
    sendHeistNotifications(attackerId, victimId, result.pointsStolen, result.heistId).catch(
      (err) => console.error('Failed to send heist notifications:', err)
    );

    return {
      success: true,
      heistId: result.heistId,
      pointsStolen: result.pointsStolen,
    };
  } catch (error) {
    console.error('Heist execution failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'EXECUTION_FAILED',
    };
  }
}
```

---

## 🔔 Step 4: Implement Notifications (Week 2)

### 4.1 Notification System (`src/lib/heist/notifications.ts`)

```typescript
import prisma from '../prisma';
import { sendHeistSuccessEmail, sendHeistVictimEmail } from '../email';
import { getHeistConfig } from './config';

const config = getHeistConfig();

/**
 * Send all heist-related notifications
 */
export async function sendHeistNotifications(
  attackerId: number,
  victimId: number,
  pointsStolen: number,
  heistId: number
) {
  // Get user details
  const [attacker, victim] = await Promise.all([
    prisma.user.findUnique({
      where: { id: attackerId },
      select: { name: true, email: true, monthlyPoints: true },
    }),
    prisma.user.findUnique({
      where: { id: victimId },
      select: { name: true, email: true, monthlyPoints: true },
    }),
  ]);

  if (!attacker || !victim) return;

  // Create in-app notifications
  await Promise.all([
    // Attacker notification
    prisma.heistNotification.create({
      data: {
        userId: attackerId,
        heistId,
        type: 'HEIST_SUCCESS',
        message: `Success! You pulled a heist on ${victim.name || 'a player'} and stole ${pointsStolen} points!`,
        metadata: {
          victimName: victim.name,
          pointsStolen,
          victimId,
        },
      },
    }),
    // Victim notification
    prisma.heistNotification.create({
      data: {
        userId: victimId,
        heistId,
        type: 'HEIST_VICTIM',
        message: `Oh no! ${attacker.name || 'Someone'} just pulled a heist on you and stole ${pointsStolen} of your monthly points!`,
        metadata: {
          attackerName: attacker.name,
          pointsLost: pointsStolen,
          attackerId,
        },
      },
    }),
  ]);

  // Send emails if enabled
  if (config.emailEnabled) {
    // Don't await, fire and forget
    sendHeistSuccessEmail({
      to: attacker.email,
      attackerName: attacker.name || 'Player',
      victimName: victim.name || 'another player',
      pointsStolen,
      newTotalPoints: attacker.monthlyPoints,
    }).catch((err) => console.error('Failed to send attacker email:', err));

    sendHeistVictimEmail({
      to: victim.email,
      victimName: victim.name || 'Player',
      attackerName: attacker.name || 'someone',
      pointsLost: pointsStolen,
      remainingPoints: victim.monthlyPoints,
    }).catch((err) => console.error('Failed to send victim email:', err));
  }
}

/**
 * Get user's notifications
 */
export async function getUserNotifications(userId: number, unreadOnly: boolean = false) {
  const where: any = { userId };
  if (unreadOnly) {
    where.read = false;
  }

  const notifications = await prisma.heistNotification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const unreadCount = await prisma.heistNotification.count({
    where: { userId, read: false },
  });

  return { notifications, unreadCount };
}

/**
 * Mark notifications as read
 */
export async function markNotificationsRead(userId: number, notificationIds?: number[]) {
  const where: any = { userId };
  
  if (notificationIds && notificationIds.length > 0) {
    where.id = { in: notificationIds };
  }

  await prisma.heistNotification.updateMany({
    where,
    data: { read: true },
  });
}
```

---

## 🌐 Step 5: Create API Endpoints (Week 2-3)

### 5.1 Create Route File (`src/routes/heist.routes.ts`)

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import { getTokenBalance } from '../lib/heist/tokens';
import { executeHeist } from '../lib/heist/execution';
import { checkHeistEligibility, calculateStealAmount } from '../lib/heist/validation';
import { getUserNotifications, markNotificationsRead } from '../lib/heist/notifications';
import prisma from '../lib/prisma';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiter for heist execution
const heistLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: 'Too many heist attempts, please try again later',
});

// GET /api/heist/tokens - Get token balance
router.get('/tokens', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const tokens = await getTokenBalance(userId);
    res.json(tokens);
  } catch (error) {
    console.error('Get tokens error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/heist/execute - Execute heist
const executeSchema = z.object({
  targetUserId: z.number().int().positive(),
});

router.post('/execute', protect, heistLimiter, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { targetUserId } = executeSchema.parse(req.body);

    const result = await executeHeist(userId, targetUserId, req.ip);

    if (result.success) {
      res.json({
        success: true,
        heistId: result.heistId,
        pointsStolen: result.pointsStolen,
        message: `Success! You stole ${result.pointsStolen} points!`,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.errorCode,
        message: result.error,
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Execute heist error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/heist/can-rob/:targetUserId - Check eligibility
router.get('/can-rob/:targetUserId', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const targetUserId = parseInt(req.params.targetUserId);

    if (isNaN(targetUserId)) {
      return res.status(400).json({ error: 'Invalid target user ID' });
    }

    const eligibility = await checkHeistEligibility(userId, targetUserId);
    
    let potentialSteal = 0;
    let targetPoints = 0;

    if (eligibility.eligible) {
      const target = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { monthlyPoints: true },
      });
      if (target) {
        targetPoints = target.monthlyPoints;
        potentialSteal = calculateStealAmount(targetPoints);
      }
    }

    res.json({
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      potentialSteal,
      targetPoints,
      details: eligibility.details,
    });
  } catch (error) {
    console.error('Check eligibility error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/heist/notifications - Get notifications
router.get('/notifications', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const unreadOnly = req.query.unreadOnly === 'true';

    const result = await getUserNotifications(userId, unreadOnly);
    res.json(result);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/heist/notifications/read - Mark as read
const markReadSchema = z.object({
  notificationIds: z.array(z.number()).optional(),
});

router.post('/notifications/read', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { notificationIds } = markReadSchema.parse(req.body);

    await markNotificationsRead(userId, notificationIds);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

### 5.2 Register Routes (`src/app.ts`)

Add this to your Express app setup:

```typescript
import heistRoutes from './routes/heist.routes';

// ... other routes ...
app.use('/api/heist', heistRoutes);
```

---

## 🔗 Step 6: Integrate with Existing Systems (Week 3)

### 6.1 Update Referral System (`src/routes/auth.routes.ts`)

Add after successful user creation:

```typescript
// Award heist token for successful referral
if (referredByUserId) {
  const { awardToken } = await import('../lib/heist/tokens');
  await awardToken(referredByUserId);
  
  // Create notification
  await prisma.heistNotification.create({
    data: {
      userId: referredByUserId,
      type: 'TOKEN_EARNED',
      message: `You earned a Heist Token! ${name || 'Someone'} joined using your referral code.`,
      metadata: { referredUserName: name },
    },
  });
}
```

---

## 🧪 Step 7: Write Tests

### Example Unit Test (`tests/heist.tokens.test.ts`)

```typescript
import { awardToken, getTokenBalance, spendToken, hasTokens } from '../src/lib/heist/tokens';
import prisma from '../src/lib/prisma';

describe('Heist Token Management', () => {
  let testUserId: number;

  beforeAll(async () => {
    // Create test user
    const user = await prisma.user.create({
      data: {
        email: 'test-heist@example.com',
        password: 'hashed',
        name: 'Test User',
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.heistToken.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } });
    await prisma.$disconnect();
  });

  it('should award token to user', async () => {
    await awardToken(testUserId);
    const balance = await getTokenBalance(testUserId);
    expect(balance.balance).toBe(1);
    expect(balance.totalEarned).toBe(1);
  });

  it('should check token availability', async () => {
    const has = await hasTokens(testUserId, 1);
    expect(has).toBe(true);
  });

  it('should spend token', async () => {
    const spent = await spendToken(testUserId);
    expect(spent).toBe(true);
    
    const balance = await getTokenBalance(testUserId);
    expect(balance.balance).toBe(0);
    expect(balance.totalSpent).toBe(1);
  });

  it('should fail to spend when no tokens', async () => {
    const spent = await spendToken(testUserId);
    expect(spent).toBe(false);
  });
});
```

Run tests:
```bash
npm test -- tests/heist.tokens.test.ts
```

---

## 📝 Step 8: Documentation

Update these files:
- [ ] `API_DOCUMENTATION.md` - Add heist endpoint docs
- [ ] `README.md` - Mention heist feature
- [ ] `GAMIFICATION_SETUP_GUIDE.md` - Add heist section

---

## 🚀 Step 9: Deploy

### Pre-Deployment Checklist
- [ ] All tests passing
- [ ] Code reviewed
- [ ] Documentation complete
- [ ] Environment variables set in production
- [ ] Database backup created

### Deployment Steps
```bash
# 1. Merge to main branch
git checkout main
git merge feature/heist-token

# 2. Run migration on production
npx prisma migrate deploy

# 3. Seed point event types on production
npx ts-node scripts/seed-heist-point-types.ts

# 4. Deploy application
# (Use your deployment process)

# 5. Verify
# Check that endpoints work
# Check that notifications send
# Monitor error logs
```

---

## 📊 Monitoring After Launch

### Key Metrics Dashboard

```sql
-- Daily heist stats
SELECT 
  DATE(created_at) as date,
  COUNT(*) filter (where status = 'SUCCESS') as successful_heists,
  COUNT(*) filter (where status != 'SUCCESS') as failed_heists,
  AVG(points_stolen) filter (where status = 'SUCCESS') as avg_points_stolen
FROM "Heist"
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Token distribution
SELECT 
  balance,
  COUNT(*) as user_count
FROM "HeistToken"
GROUP BY balance
ORDER BY balance DESC;

-- Top robbers
SELECT 
  u.name,
  COUNT(h.id) as heist_count,
  SUM(h.points_stolen) as total_stolen
FROM "Heist" h
JOIN "User" u ON h.attacker_id = u.id
WHERE h.status = 'SUCCESS'
  AND h.created_at >= NOW() - INTERVAL '30 days'
GROUP BY u.id, u.name
ORDER BY heist_count DESC
LIMIT 10;
```

---

## ❓ FAQ

**Q: What if migration fails?**
A: Rollback with `npx prisma migrate reset`, fix issues, try again.

**Q: How do I test locally?**
A: Use Postman/curl to test API endpoints. Create test users with referral codes.

**Q: Can I change configuration without redeploying?**
A: Yes, environment variables can be changed and app restarted.

**Q: What if performance is slow?**
A: Check database indexes, add caching, optimize queries.

---

## 📞 Need Help?

- Check `HEIST_TOKEN_FEATURE_PLAN.md` for complete specs
- Check `HEIST_FLOW_DIAGRAMS.md` for visual flows
- Ask team lead or senior developer
- Create GitHub issue with "heist" label

---

**Happy coding! 🚀**

