# User Streak Feature Documentation

## Overview

The Streak Feature is a gamification system that rewards users with increasing discounts based on their consistent check-in behavior. Users who check in every week build up a streak and earn progressively higher discounts, up to a maximum of 45% off after 7 consecutive weeks.

## How It Works

### Streak Rules

1. **Week Definition**: A week runs from Sunday to Saturday
2. **Starting Streak**: First check-in starts a 1-week streak with 10% discount
3. **Building Streak**: Check in at least once per week to maintain and grow your streak
4. **Consecutive Weeks**: Each consecutive week increases the discount by 5%
5. **Maximum Streak**: 7 weeks = 45% discount (maximum)
6. **Streak Reset**: Missing a week breaks the streak and resets it to 1 week (10% discount)

### Discount Tiers

| Week | Discount | Description |
|------|----------|-------------|
| 1    | 10%      | Base discount - First week |
| 2    | 15%      | +5% bonus |
| 3    | 20%      | +5% bonus |
| 4    | 25%      | +5% bonus |
| 5    | 30%      | +5% bonus |
| 6    | 35%      | +5% bonus |
| 7+   | 45%      | Maximum discount! |

## API Endpoints

### 1. Get Current Streak

**Endpoint:** `GET /api/streak`

**Authentication:** Required (Bearer token)

**Description:** Get the authenticated user's current streak information.

**Response:**
```json
{
  "success": true,
  "streak": {
    "currentStreak": 3,
    "longestStreak": 5,
    "lastCheckInDate": "2025-11-03T14:30:00.000Z",
    "currentWeekCheckIns": 2,
    "totalCheckIns": 15,
    "streakStartDate": "2025-10-13T10:00:00.000Z",
    "currentDiscountPercent": 20,
    "nextWeekDiscountPercent": 25,
    "maxDiscountReached": false,
    "weeksUntilMaxDiscount": 4,
    "maxPossibleDiscount": 45
  },
  "message": "Current streak: 3 weeks with 20% discount"
}
```

**Response Fields:**
- `currentStreak`: Number of consecutive weeks with check-ins
- `longestStreak`: Highest streak ever achieved by the user
- `lastCheckInDate`: Date of the most recent check-in
- `currentWeekCheckIns`: Number of check-ins in the current week
- `totalCheckIns`: Total lifetime check-ins
- `streakStartDate`: When the current streak started
- `currentDiscountPercent`: Current discount percentage earned
- `nextWeekDiscountPercent`: Discount if streak continues next week
- `maxDiscountReached`: Whether maximum discount has been achieved
- `weeksUntilMaxDiscount`: Weeks remaining until max discount
- `maxPossibleDiscount`: Maximum possible discount (45%)

---

### 2. Check-In with Streak Update

**Endpoint:** `POST /api/users/check-in`

**Authentication:** Required (Bearer token)

**Description:** Check in at a merchant location. Updates streak automatically.

**Request Body:**
```json
{
  "dealId": 123,
  "latitude": 40.7128,
  "longitude": -74.0060
}
```

**Response:**
```json
{
  "dealId": 123,
  "merchantId": 45,
  "userId": 67,
  "distanceMeters": 42.5,
  "withinRange": true,
  "thresholdMeters": 100,
  "dealActive": true,
  "pointsAwarded": 15,
  "firstCheckIn": false,
  "pointEvents": [...],
  "streak": {
    "currentStreak": 3,
    "currentDiscountPercent": 20,
    "message": "3 week streak! You've earned 20% off on your next order/pickup!",
    "newWeek": true,
    "streakBroken": false,
    "maxDiscountReached": false
  }
}
```

**Streak Response Fields:**
- `currentStreak`: Updated streak count
- `currentDiscountPercent`: Current discount earned
- `message`: Human-readable streak status message
- `newWeek`: Whether this check-in started a new week
- `streakBroken`: Whether the streak was broken and reset
- `maxDiscountReached`: Whether maximum discount achieved

---

### 3. Get Streak Leaderboard

**Endpoint:** `GET /api/streak/leaderboard?limit=10`

**Authentication:** Not required

**Description:** Get top users by current streak.

**Query Parameters:**
- `limit` (optional): Number of users to return (1-100, default: 10)

**Response:**
```json
{
  "success": true,
  "leaderboard": [
    {
      "userId": 123,
      "user": {
        "id": 123,
        "name": "John Doe",
        "email": "john@example.com",
        "avatarUrl": "https://..."
      },
      "currentStreak": 7,
      "longestStreak": 10,
      "totalCheckIns": 45,
      "currentDiscountPercent": 45,
      "maxDiscountReached": true
    }
  ],
  "total": 10
}
```

---

### 4. Calculate Discount for Order

**Endpoint:** `POST /api/streak/calculate-discount`

**Authentication:** Required (Bearer token)

**Description:** Calculate how much discount applies to a specific order amount.

**Request Body:**
```json
{
  "orderAmount": 50.00
}
```

**Response:**
```json
{
  "success": true,
  "discount": {
    "originalAmount": 50.00,
    "discountPercent": 20,
    "discountAmount": 10.00,
    "finalAmount": 40.00
  },
  "streak": {
    "currentStreak": 3,
    "currentDiscountPercent": 20,
    "maxDiscountReached": false
  }
}
```

---

### 5. Get Discount Tiers

**Endpoint:** `GET /api/streak/discount-tiers`

**Authentication:** Not required

**Description:** Get information about all discount tiers.

**Response:**
```json
{
  "success": true,
  "tiers": [
    {
      "week": 1,
      "discountPercent": 10,
      "description": "First week - Base discount"
    },
    {
      "week": 2,
      "discountPercent": 15,
      "description": "Week 2 bonus"
    },
    {
      "week": 7,
      "discountPercent": 45,
      "description": "Maximum discount reached!"
    }
  ],
  "maxWeeks": 7,
  "maxDiscount": 45,
  "description": "Check in every week to increase your discount! Starts at 10% and increases by 5% each consecutive week, up to 45% after 7 weeks."
}
```

## Database Schema

### UserStreak Model

```prisma
model UserStreak {
  id                     Int       @id @default(autoincrement())
  userId                 Int       @unique
  currentStreak          Int       @default(0)
  longestStreak          Int       @default(0)
  lastCheckInDate        DateTime?
  currentWeekCheckIns    Int       @default(0)
  totalCheckIns          Int       @default(0)
  streakStartDate        DateTime?
  currentDiscountPercent Float     @default(0)
  maxDiscountReached     Boolean   @default(false)
  createdAt              DateTime  @default(now())
  updatedAt              DateTime  @updatedAt
  user                   User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([currentStreak])
}
```

### CheckIn Model Updates

The `CheckIn` model now includes an additional index for efficient streak queries:

```prisma
@@index([userId, createdAt])
```

## Integration Guide

### Frontend Integration

#### Display Current Streak

```javascript
async function getStreak() {
  const response = await fetch('/api/streak', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  
  // Display: "🔥 Week 3 Streak - 20% off!"
  console.log(`🔥 Week ${data.streak.currentStreak} Streak - ${data.streak.currentDiscountPercent}% off!`);
}
```

#### Handle Check-In Response

```javascript
async function checkIn(dealId, lat, lon) {
  const response = await fetch('/api/users/check-in', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ dealId, latitude: lat, longitude: lon })
  });
  
  const data = await response.json();
  
  if (data.streak) {
    if (data.streak.newWeek) {
      showNotification(data.streak.message); // "3 week streak! You've earned 20% off..."
    }
    
    if (data.streak.streakBroken) {
      showWarning("Streak broken! Starting fresh with 10% discount.");
    }
    
    if (data.streak.maxDiscountReached) {
      showCelebration("🎉 Maximum discount reached!");
    }
  }
}
```

#### Display Discount at Checkout

```javascript
async function calculateDiscount(orderAmount) {
  const response = await fetch('/api/streak/calculate-discount', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ orderAmount })
  });
  
  const data = await response.json();
  
  // Display:
  // Original: $50.00
  // Streak Discount (20%): -$10.00
  // Total: $40.00
  return data.discount;
}
```

## User Experience Flow

### First Time User
1. User checks in → Streak starts at 1 week → 10% discount earned
2. User sees: "1 week streak! You've earned 10% off on your next order/pickup!"

### Returning User (Same Week)
1. User checks in again in same week → Streak stays at current level
2. User sees: "Check-in recorded! Current discount: 20%"

### Continuing Streak (New Week)
1. User checks in in a new consecutive week → Streak increases
2. User sees: "4 week streak! You've earned 25% off on your next order/pickup!"

### Breaking Streak
1. User misses a week → Streak resets to 1 week
2. User sees: "Streak broken! Starting fresh with 10% discount."

### Maximum Streak
1. User reaches 7 weeks → 45% discount (maximum)
2. User sees: "7 week streak! You've earned 45% off on your next order/pickup! 🎉 Maximum discount reached!"

## Best Practices

### For Users
1. **Check in weekly**: At least once per week to maintain streak
2. **Multiple check-ins**: Can check in multiple times per week, but streak only counts consecutive weeks
3. **Plan ahead**: Don't miss a week or your streak resets!

### For Merchants
1. **Promote the feature**: Encourage users to maintain their streaks
2. **Honor discounts**: Apply streak discounts at checkout/pickup
3. **Verify streaks**: Use the calculate-discount endpoint to verify discount amounts

### For Developers
1. **Cache streak data**: Reduce database queries by caching user streak info
2. **Handle timezone**: All dates are in UTC; convert as needed for display
3. **Monitor performance**: Index on `userId` and `currentStreak` for fast queries
4. **Test edge cases**: Week boundaries, year boundaries, timezone changes

## Migration & Setup

### Run Migration

```bash
npx prisma migrate dev --name add_user_streak
```

### Generate Prisma Client

```bash
npx prisma generate
```

### Seed Initial Data (Optional)

```typescript
// For existing users, initialize streaks
await prisma.user.findMany().then(users => 
  Promise.all(users.map(user => 
    prisma.userStreak.create({
      data: { userId: user.id }
    })
  ))
);
```

## Testing

### Test Scenarios

1. **New user check-in**: Verify streak starts at 1, discount at 10%
2. **Same week check-in**: Verify streak doesn't increase
3. **Consecutive week**: Verify streak increases by 1, discount increases by 5%
4. **Missed week**: Verify streak resets to 1
5. **Maximum streak**: Verify caps at 7 weeks, 45% discount
6. **Year boundary**: Check-ins across New Year work correctly
7. **Timezone handling**: Consistent behavior across timezones

## Troubleshooting

### Streak not updating
- Check that check-in is successful (within range)
- Verify date/time is correctly parsed
- Check database indexes are created

### Wrong discount calculation
- Verify streak count in database
- Check `currentDiscountPercent` field
- Use `/api/streak` endpoint to debug current state

### Performance issues
- Ensure indexes are created on UserStreak table
- Consider caching streak info in Redis
- Batch process streak leaderboard updates

## Future Enhancements

Potential features for future versions:

1. **Streak Freeze**: Allow users to "freeze" their streak for one week
2. **Bonus Multipliers**: Extra rewards on weekends or holidays
3. **Social Features**: Share streak achievements on social media
4. **Push Notifications**: Remind users when streak is at risk
5. **Streak Recovery**: One-time recovery option for broken streaks
6. **Team Streaks**: Group challenges with friends
7. **Seasonal Events**: Special streak bonuses during promotions

## Support

For questions or issues:
- Check API responses for error messages
- Review database logs for streak updates
- Contact development team for complex issues
