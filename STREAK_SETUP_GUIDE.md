# Streak Feature Quick Setup Guide

## Overview
This guide will help you set up the User Streak feature that rewards users with increasing discounts (10% to 45%) based on consecutive weekly check-ins.

## Prerequisites
- PostgreSQL database running
- Existing GeolocationMVP backend setup
- Node.js and npm installed

## Setup Steps

### 1. Run Database Migration

The schema has already been updated with the `UserStreak` model. Run the migration:

```bash
npx prisma migrate dev --name add_user_streak_feature
```

This will:
- Create the `UserStreak` table
- Add index on `CheckIn` for `(userId, createdAt)`
- Update the Prisma client

### 2. Generate Prisma Client

```bash
npx prisma generate
```

### 3. Verify Installation

Check that the new table exists:

```bash
npx prisma studio
```

Look for the `UserStreak` table in Prisma Studio.

### 4. Test the API

Start your server:

```bash
npm run dev
```

Test the new endpoints:

#### Get Discount Tiers (Public)
```bash
curl http://localhost:3000/api/streak/discount-tiers
```

#### Get Your Streak (Authenticated)
```bash
curl http://localhost:3000/api/streak \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Check In (Automatically updates streak)
```bash
curl -X POST http://localhost:3000/api/users/check-in \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "dealId": 1,
    "latitude": 40.7128,
    "longitude": -74.0060
  }'
```

The response will include a `streak` object with current discount information.

## New API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/streak` | Yes | Get user's current streak |
| GET | `/api/streak/leaderboard` | No | Get streak leaderboard |
| POST | `/api/streak/calculate-discount` | Yes | Calculate discount for order |
| GET | `/api/streak/discount-tiers` | No | Get all discount tier info |

## How It Works

### Discount Formula
- **Week 1**: 10% base discount
- **Week 2-7**: +5% per consecutive week
- **Week 7+**: Maximum 45% discount

### Streak Rules
1. Check in at least once per week to maintain streak
2. Consecutive weeks increase your discount
3. Missing a week resets your streak to 1 (10% discount)
4. Multiple check-ins in same week don't increase streak
5. Week runs Sunday to Saturday

## Integration with Check-In

The existing `/api/users/check-in` endpoint now returns streak information:

```json
{
  "dealId": 123,
  "withinRange": true,
  "pointsAwarded": 15,
  "streak": {
    "currentStreak": 3,
    "currentDiscountPercent": 20,
    "message": "3 week streak! You've earned 20% off!",
    "newWeek": true,
    "streakBroken": false,
    "maxDiscountReached": false
  }
}
```

## Frontend Integration Example

```javascript
// Display streak badge
function displayStreak(streak) {
  const badge = document.getElementById('streak-badge');
  badge.innerHTML = `
    <div class="streak-display">
      🔥 Week ${streak.currentStreak} 
      <span class="discount">${streak.currentDiscountPercent}% OFF</span>
    </div>
  `;
}

// Apply discount at checkout
async function applyStreakDiscount(orderAmount) {
  const response = await fetch('/api/streak/calculate-discount', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ orderAmount })
  });
  
  const data = await response.json();
  return data.discount; // { originalAmount, discountAmount, finalAmount }
}
```

## Migrating Existing Users

For existing users, streaks will be automatically created on their first check-in after the feature is deployed. No manual data migration is needed.

Optionally, you can pre-create streak records:

```typescript
// Optional: Create empty streak records for all existing users
import prisma from './src/lib/prisma';

async function initializeStreaks() {
  const users = await prisma.user.findMany({
    where: {
      streak: null
    }
  });
  
  for (const user of users) {
    await prisma.userStreak.create({
      data: {
        userId: user.id,
        currentStreak: 0,
        longestStreak: 0,
        totalCheckIns: 0,
        currentDiscountPercent: 0,
      }
    });
  }
  
  console.log(`Initialized streaks for ${users.length} users`);
}

// Run once after migration
initializeStreaks().then(() => process.exit(0));
```

## Testing Checklist

- [ ] Database migration successful
- [ ] Prisma client generated
- [ ] Server starts without errors
- [ ] `/api/streak/discount-tiers` returns tier info
- [ ] Check-in updates streak correctly
- [ ] Same-week check-ins don't increase streak
- [ ] Consecutive week check-ins increase streak
- [ ] Missed week resets streak
- [ ] Maximum discount (45%) caps at week 7
- [ ] Leaderboard displays correctly

## Troubleshooting

### Migration fails
```bash
# Reset and rerun
npx prisma migrate reset
npx prisma migrate dev --name add_user_streak_feature
```

### TypeScript errors
```bash
# Regenerate Prisma client
npx prisma generate
# Restart TypeScript server in VS Code
```

### Streak not updating
- Check that check-in is successful (within range)
- Verify server logs for errors
- Check database: `SELECT * FROM "UserStreak" WHERE "userId" = YOUR_USER_ID;`

## Production Deployment

Before deploying to production:

1. **Backup database**: `pg_dump your_database > backup.sql`
2. **Run migration**: `npx prisma migrate deploy`
3. **Test thoroughly**: Verify streak logic with test users
4. **Monitor logs**: Watch for any errors after deployment
5. **Update documentation**: Inform users about the new feature

## Support & Documentation

- Full documentation: `docs/streak-feature.md`
- API documentation: Available in the main doc
- Code location: `src/lib/streak.ts` and `src/routes/streak.routes.ts`

## Feature Flags (Optional)

Consider adding a feature flag to gradually roll out:

```typescript
// In .env
STREAK_FEATURE_ENABLED=true

// In code
if (process.env.STREAK_FEATURE_ENABLED === 'true') {
  const streakUpdate = await updateStreakAfterCheckIn(userId, now);
  // ... include in response
}
```

## Success Metrics

Track these metrics to measure feature success:

1. **User Engagement**: % of users with active streaks
2. **Retention**: Do users check in more consistently?
3. **Revenue Impact**: Effect on order frequency and value
4. **Streak Length**: Average and distribution of streak lengths
5. **Drop-off**: Where do users typically lose their streaks?

---

🎉 **Setup Complete!** Your streak feature is now ready to reward loyal users!
