# 🎯 Heist Token Feature - Complete Implementation Plan

## Overview
The Heist Token feature allows users to "rob" other players on the leaderboard using tokens earned through successful referrals. This adds a strategic, competitive layer to the gamification system.

---

## 🎮 Feature Specifications

### Core Mechanics

#### 1. **Token Economics**
- **Earning Tokens**: Users receive 1 Heist Token per successful referral
  - A referral is "successful" when the referred user completes signup
  - Tokens are non-expiring and stackable
  - No maximum token limit initially (can add later if needed)

#### 2. **Robbery Mechanics**
- **Target Selection**: Users can rob anyone on the leaderboard
- **Stolen Amount**: 5% of target's `monthlyPoints`, capped at 100 points maximum
- **Minimum Threshold**: Target must have at least 20 points to be robbed (prevents robbing new users)
- **Cooldown**: 
  - Each user can perform 1 heist every 24 hours (prevents spam)
  - Each target can be robbed once every 48 hours (prevents repeated targeting)
- **Point Transfer**: Points stolen are immediately added to attacker's `monthlyPoints`

#### 3. **Defense Mechanisms**
- **Shield System** (Phase 2 - Future):
  - Users can purchase "shields" with coins
  - Shield protects from 1 heist attempt
  - Shields expire after 7 days if unused

#### 4. **Notifications**
- **Attacker Notification**: "Success! You pulled a heist on [Player Name] and stole 85 points!"
- **Victim Notification**: "Oh no! [Player Name] just pulled a heist on you and stole 85 of your monthly points!"
- Notification delivery methods:
  - Email (immediate)
  - In-app notification (when implemented)

---

## 🗄️ Database Schema Changes

### New Tables

#### 1. `HeistToken`
Tracks heist token inventory for each user.

```prisma
model HeistToken {
  id              Int      @id @default(autoincrement())
  userId          Int
  balance         Int      @default(0)  // Current token count
  totalEarned     Int      @default(0)  // Lifetime tokens earned
  totalSpent      Int      @default(0)  // Lifetime tokens spent
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  heists          Heist[]  // Heists performed by this user

  @@unique([userId])
  @@index([userId])
  @@index([balance])
}
```

#### 2. `Heist`
Records all heist attempts (successful and failed).

```prisma
model Heist {
  id                Int         @id @default(autoincrement())
  attackerId        Int
  victimId          Int
  pointsStolen      Int         // Actual points stolen
  victimPointsBefore Int        // Victim's points before heist
  victimPointsAfter  Int        // Victim's points after heist
  tokenSpent        Boolean     @default(true)
  status            HeistStatus @default(SUCCESS)
  createdAt         DateTime    @default(now())
  
  attacker          User        @relation("HeistsAsAttacker", fields: [attackerId], references: [id], onDelete: Cascade)
  victim            User        @relation("HeistsAsVictim", fields: [victimId], references: [id], onDelete: Cascade)
  tokenRecord       HeistToken  @relation(fields: [attackerId], references: [userId])

  @@index([attackerId, createdAt])
  @@index([victimId, createdAt])
  @@index([createdAt])
  @@index([status])
}

enum HeistStatus {
  SUCCESS         // Heist completed successfully
  FAILED_COOLDOWN // User on cooldown
  FAILED_TARGET   // Target on protection cooldown
  FAILED_SHIELD   // Target had active shield (Phase 2)
  FAILED_INSUFFICIENT_POINTS // Target had < 20 points
}
```

#### 3. `HeistNotification`
Stores notifications for heist events.

```prisma
model HeistNotification {
  id          Int      @id @default(autoincrement())
  userId      Int
  heistId     Int
  type        HeistNotificationType
  message     String
  read        Boolean  @default(false)
  emailSent   Boolean  @default(false)
  createdAt   DateTime @default(now())
  
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, read])
  @@index([userId, createdAt])
  @@index([createdAt])
}

enum HeistNotificationType {
  HEIST_SUCCESS      // You robbed someone
  HEIST_VICTIM       // You were robbed
  TOKEN_EARNED       // You earned a token
  SHIELD_ACTIVATED   // Your shield blocked an attack (Phase 2)
  SHIELD_EXPIRED     // Your shield expired (Phase 2)
}
```

### Updates to Existing Tables

#### User Model
Add relations for heists:

```prisma
model User {
  // ... existing fields ...
  
  // Heist Relations
  heistTokens         HeistToken?
  heistsAsAttacker    Heist[]               @relation("HeistsAsAttacker")
  heistsAsVictim      Heist[]               @relation("HeistsAsVictim")
  heistNotifications  HeistNotification[]
}
```

---

## 🔧 API Endpoints

### 1. **Get Heist Token Balance**
```
GET /api/heist/tokens
```

**Auth**: Required

**Response**:
```json
{
  "balance": 3,
  "totalEarned": 10,
  "totalSpent": 7,
  "lastEarned": "2025-11-05T10:30:00.000Z"
}
```

---

### 2. **Get Heist History**
```
GET /api/heist/history
```

**Auth**: Required

**Query Params**:
- `type` (optional): `"attacker"` | `"victim"` | `"all"` (default: "all")
- `limit` (optional): number (default: 20)
- `offset` (optional): number (default: 0)

**Response**:
```json
{
  "heists": [
    {
      "id": 123,
      "type": "attacker",
      "otherUser": {
        "id": 456,
        "name": "Jane Doe",
        "avatarUrl": "https://..."
      },
      "pointsStolen": 85,
      "status": "SUCCESS",
      "createdAt": "2025-11-05T10:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 45,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

---

### 3. **Initiate Heist**
```
POST /api/heist/execute
```

**Auth**: Required

**Body**:
```json
{
  "targetUserId": 456
}
```

**Response (Success)**:
```json
{
  "success": true,
  "heist": {
    "id": 789,
    "victimName": "Jane Doe",
    "pointsStolen": 85,
    "victimPointsBefore": 1700,
    "victimPointsAfter": 1615,
    "yourNewPoints": 1285,
    "tokensRemaining": 2
  },
  "message": "Success! You pulled a heist on Jane Doe and stole 85 points!"
}
```

**Response (Failure - On Cooldown)**:
```json
{
  "success": false,
  "error": "COOLDOWN_ACTIVE",
  "message": "You can perform another heist in 18 hours",
  "cooldownEndsAt": "2025-11-06T04:30:00.000Z"
}
```

**Response (Failure - Target Protected)**:
```json
{
  "success": false,
  "error": "TARGET_PROTECTED",
  "message": "Jane Doe was recently robbed and is under protection for 24 hours",
  "protectionEndsAt": "2025-11-06T10:30:00.000Z"
}
```

**Response (Failure - Insufficient Tokens)**:
```json
{
  "success": false,
  "error": "INSUFFICIENT_TOKENS",
  "message": "You need 1 Heist Token to perform a heist",
  "tokensNeeded": 1,
  "tokensAvailable": 0
}
```

**Response (Failure - Invalid Target)**:
```json
{
  "success": false,
  "error": "INVALID_TARGET",
  "message": "This player doesn't have enough points to rob (minimum 20 points)",
  "targetPoints": 15
}
```

---

### 4. **Check Heist Eligibility**
```
GET /api/heist/can-rob/:targetUserId
```

**Auth**: Required

**Response**:
```json
{
  "eligible": true,
  "potentialSteal": 85,
  "targetPoints": 1700,
  "tokensAvailable": 3,
  "cooldownStatus": {
    "onCooldown": false,
    "canRobAt": null
  },
  "targetStatus": {
    "protected": false,
    "protectionEndsAt": null
  }
}
```

---

### 5. **Get Heist Notifications**
```
GET /api/heist/notifications
```

**Auth**: Required

**Query Params**:
- `unreadOnly` (optional): boolean (default: false)
- `limit` (optional): number (default: 20)

**Response**:
```json
{
  "notifications": [
    {
      "id": 1,
      "type": "HEIST_VICTIM",
      "message": "Oh no! John Doe just pulled a heist on you and stole 85 of your monthly points!",
      "read": false,
      "createdAt": "2025-11-05T10:30:00.000Z",
      "heistDetails": {
        "attackerName": "John Doe",
        "pointsLost": 85
      }
    }
  ],
  "unreadCount": 3
}
```

---

### 6. **Mark Notifications as Read**
```
POST /api/heist/notifications/read
```

**Auth**: Required

**Body**:
```json
{
  "notificationIds": [1, 2, 3]  // or "all" to mark all as read
}
```

---

## 🔄 Integration Points

### 1. **Referral System Integration**

Update the referral success handler in `src/routes/auth.routes.ts`:

```typescript
// After successful referral signup, award heist token
await prisma.heistToken.upsert({
  where: { userId: referrerId },
  update: {
    balance: { increment: 1 },
    totalEarned: { increment: 1 }
  },
  create: {
    userId: referrerId,
    balance: 1,
    totalEarned: 1
  }
});

// Create notification for token earned
await prisma.heistNotification.create({
  data: {
    userId: referrerId,
    type: 'TOKEN_EARNED',
    message: `You earned a Heist Token! ${referredUserName} joined using your referral code.`
  }
});
```

---

### 2. **Leaderboard Integration**

Update leaderboard endpoints to include heist action buttons:
- Add `canRob` boolean to each leaderboard entry
- Add `heistEligibility` object with details

---

### 3. **Points System Integration**

The heist affects `monthlyPoints` which feeds into:
- Monthly leaderboards
- City-specific leaderboards
- Achievement progress
- Streak calculations (indirectly)

**Important**: Update `UserPointEvent` tracking when heist occurs:

```typescript
// Record as a special point event
await prisma.userPointEvent.create({
  data: {
    userId: attackerId,
    points: pointsStolen,
    pointEventTypeId: HEIST_GAIN_TYPE_ID, // Add new type
  }
});

await prisma.userPointEvent.create({
  data: {
    userId: victimId,
    points: -pointsStolen,
    pointEventTypeId: HEIST_LOSS_TYPE_ID, // Add new type
  }
});
```

---

### 4. **Email Notifications**

Create email templates in `src/lib/email.ts`:

**Attacker Email**:
```typescript
export async function sendHeistSuccessEmail({
  to,
  attackerName,
  victimName,
  pointsStolen,
  newTotalPoints
}: HeistSuccessEmailParams) {
  // Template with celebration and details
}
```

**Victim Email**:
```typescript
export async function sendHeistVictimEmail({
  to,
  victimName,
  attackerName,
  pointsLost,
  remainingPoints
}: HeistVictimEmailParams) {
  // Template with sympathy and encouragement
}
```

---

## 📊 Analytics & Tracking

### Key Metrics to Track:
1. **Heist Volume**:
   - Total heists per day/week/month
   - Average points stolen per heist
   - Success rate (should be ~100% if validations work)

2. **User Engagement**:
   - % of users with tokens who perform heists
   - Average time between earning token and using it
   - Top robbers and most-robbed users

3. **Referral Impact**:
   - Did heist tokens increase referral rate?
   - Tokens earned vs tokens spent ratio

4. **Economic Impact**:
   - Total points redistributed via heists
   - Effect on leaderboard volatility
   - Monthly points inflation/deflation

---

## 🧪 Testing Strategy

### Unit Tests

1. **Token Management**:
   - Award token on referral ✓
   - Deduct token on heist ✓
   - Handle concurrent heist attempts ✓

2. **Heist Logic**:
   - Calculate correct steal amount (5%, max 100) ✓
   - Enforce minimum target points (20) ✓
   - Validate cooldown periods ✓

3. **Point Transfer**:
   - Correctly deduct from victim ✓
   - Correctly add to attacker ✓
   - Create proper point events ✓

### Integration Tests

1. **Full Heist Flow**:
   - User A refers User B
   - User A receives token
   - User A robs User C
   - Both receive notifications
   - Leaderboard updates correctly

2. **Cooldown Enforcement**:
   - Attempt second heist before 24h cooldown
   - Attempt to rob same target twice

3. **Edge Cases**:
   - Rob user with exactly 20 points
   - Rob user with 10,000 points (verify cap)
   - Rob yourself (should fail)
   - Rob non-existent user

---

## 🚀 Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Database schema migration
- [ ] HeistToken model & CRUD operations
- [ ] Heist model & CRUD operations
- [ ] Basic token award on referral
- [ ] Unit tests for token management

### Phase 2: Heist Mechanics (Week 1-2)
- [ ] Heist execution logic
- [ ] Cooldown validation
- [ ] Point calculation & transfer
- [ ] Heist history tracking
- [ ] Unit tests for heist logic

### Phase 3: API Endpoints (Week 2)
- [ ] GET /api/heist/tokens
- [ ] POST /api/heist/execute
- [ ] GET /api/heist/can-rob/:targetUserId
- [ ] GET /api/heist/history
- [ ] Integration tests for all endpoints

### Phase 4: Notifications (Week 2-3)
- [ ] HeistNotification model
- [ ] In-app notification system
- [ ] Email templates
- [ ] GET /api/heist/notifications
- [ ] POST /api/heist/notifications/read

### Phase 5: Leaderboard Integration (Week 3)
- [ ] Update leaderboard API responses
- [ ] Add heist eligibility checks
- [ ] Add "Rob" action UI metadata
- [ ] Frontend integration points

### Phase 6: Analytics & Polish (Week 3-4)
- [ ] Analytics tracking setup
- [ ] Admin dashboard for heist metrics
- [ ] Performance optimization
- [ ] Comprehensive E2E testing
- [ ] Documentation updates

### Phase 7: Future Enhancements (Phase 2)
- [ ] Shield system (defense mechanism)
- [ ] Heist achievements
- [ ] Heist leaderboard
- [ ] Team heists (multi-player)
- [ ] Insurance system (pay coins to protect points)

---

## 🛡️ Security Considerations

1. **Race Conditions**:
   - Use database transactions for all heist operations
   - Implement row-level locking on User records during point transfer

2. **Validation**:
   - Always re-check eligibility server-side
   - Never trust client-provided amounts
   - Validate user authentication on every request

3. **Rate Limiting**:
   - Implement rate limiting on heist endpoints (max 10 requests/minute)
   - Block suspicious patterns (e.g., rapid failed attempts)

4. **Audit Trail**:
   - Log all heist attempts (success and failure)
   - Include IP addresses and timestamps
   - Monitor for abuse patterns

---

## 📝 Configuration

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
```

---

## 🎨 Frontend UI Considerations

### Leaderboard Enhancements:
- Add "⚔️ Rob" button next to eligible users
- Show cooldown timer for ineligible targets
- Display user's token count in header
- Show heist history modal

### Token Display:
- Heist Token icon in user profile
- Token count badge
- "Earn more tokens" CTA linking to referrals

### Notifications:
- Toast notifications for heist events
- Notification bell with badge count
- Notification center modal

---

## 🔮 Future Expansion Ideas

1. **Bounty System**: Set a "bounty" on a specific player, rewarding multiple users to rob them
2. **Heist Insurance**: Pay coins monthly to protect against heists
3. **Counter-Heist**: Catch a robber and steal double the points back
4. **Heist Alliances**: Team up with friends for bigger heists
5. **Seasonal Events**: Double heist rewards during special events
6. **Heist Achievements**: Unlock badges for successful heists

---

## ✅ Success Criteria

The feature is successful if:
1. **Adoption**: 30%+ of users with tokens perform at least 1 heist/month
2. **Engagement**: Referral rate increases by 20%+
3. **Retention**: Users check leaderboard 2x more frequently
4. **Stability**: <0.1% error rate on heist operations
5. **Fairness**: No single user loses >10% monthly points to heists

---

## 📚 Documentation Updates Needed

1. Update API_DOCUMENTATION.md with heist endpoints
2. Create HEIST_TOKEN_GUIDE.md for users
3. Add heist section to GAMIFICATION_SETUP_GUIDE.md
4. Update README.md with heist feature overview
5. Create admin guide for monitoring heist metrics

---

## 🎯 Next Steps

1. Review this plan with team
2. Get approval on:
   - Steal percentage (5%)
   - Max steal cap (100 points)
   - Cooldown periods (24h/48h)
   - Token earning rate (1 per referral)
3. Create database migration
4. Begin Phase 1 implementation
5. Set up test environment with seed data

---

**Last Updated**: November 7, 2025  
**Status**: 📋 Planning Phase  
**Owner**: TBD  
**Target Launch**: TBD

