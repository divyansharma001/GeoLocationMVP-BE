# 🎯 Heist Token Feature - Detailed Technical Specifications

## Document Status
- **Version**: 1.0
- **Date**: November 7, 2025
- **Status**: 📋 Pending Approval
- **Review Required By**: Product, Engineering, Security, Database Teams

---

## Table of Contents
1. [Business Requirements](#business-requirements)
2. [Technical Architecture](#technical-architecture)
3. [Data Models & Relationships](#data-models--relationships)
4. [API Specifications](#api-specifications)
5. [Business Logic Specifications](#business-logic-specifications)
6. [Security Specifications](#security-specifications)
7. [Performance Requirements](#performance-requirements)
8. [Error Handling](#error-handling)
9. [Testing Requirements](#testing-requirements)
10. [Rollout Strategy](#rollout-strategy)

---

## Business Requirements

### BR-1: Token Acquisition
**Requirement**: Users must earn Heist Tokens through successful referrals.

**Acceptance Criteria**:
- ✓ User A shares referral code with User B
- ✓ User B signs up using referral code
- ✓ System validates referral code exists and belongs to User A
- ✓ User A receives exactly 1 Heist Token
- ✓ User A receives notification of token earned
- ✓ Token appears in User A's balance immediately

**Business Rules**:
- One token per successful referral signup (not per app download)
- Tokens are awarded at signup completion, not email verification
- Self-referrals are blocked at signup (existing rule)
- No token expiration initially (Phase 1)

**Edge Cases**:
- Multiple users sign up with same code simultaneously → Each awards 1 token
- User signs up but never activates account → Still awards token (signup = commitment)
- Referral code reused 100+ times → All valid, no limit

---

### BR-2: Heist Execution
**Requirement**: Users can spend tokens to steal points from leaderboard players.

**Acceptance Criteria**:
- ✓ User selects target from leaderboard
- ✓ System validates eligibility (see BR-3)
- ✓ User confirms heist action
- ✓ System deducts 1 token from user
- ✓ System calculates steal amount (5% of victim's monthlyPoints, max 100)
- ✓ System transfers points atomically
- ✓ Both users receive notifications
- ✓ Leaderboard updates immediately

**Business Rules**:
- **Token Cost**: Exactly 1 token per heist attempt
- **Steal Calculation**: `MIN(FLOOR(victimMonthlyPoints * 0.05), 100)`
- **Point Transfer**: From victim's `monthlyPoints` to attacker's `monthlyPoints`
- **Total Points**: User's `points` field is NOT affected (only monthly)
- **Minimum Steal**: If calculation results in 0, heist is rejected

**Edge Cases**:
- Victim's points change between selection and execution → Use latest value
- Network error during execution → Transaction rollback, no points transferred
- Attacker and victim on same device → Still allowed (different accounts)

---

### BR-3: Heist Eligibility
**Requirement**: Multiple rules govern who can be robbed and when.

**Acceptance Criteria**:
- ✓ Attacker must have ≥1 token
- ✓ Attacker must not be on cooldown (24 hours since last heist)
- ✓ Target must not be attacker (no self-robbery)
- ✓ Target must exist and be active
- ✓ Target must have ≥20 monthly points
- ✓ Target must not be protected (48 hours since last robbed)
- ✓ Feature must be enabled globally (HEIST_ENABLED=true)

**Business Rules**:
| Rule | Type | Duration | Rationale |
|------|------|----------|-----------|
| Attacker Cooldown | Time | 24 hours | Prevents spam, encourages strategic timing |
| Victim Protection | Time | 48 hours | Prevents repeated targeting, reduces frustration |
| Minimum Points | Threshold | 20 points | Protects new/inactive users |
| Maximum Steal | Cap | 100 points | Protects top players, maintains fairness |

**Edge Cases**:
- Eligibility changes after check but before execution → Revalidate in transaction
- Two users try to rob same person simultaneously → Both allowed if eligible
- User drops below 20 points during heist → Transaction fails gracefully

---

### BR-4: Notifications
**Requirement**: All heist events must notify affected users.

**Acceptance Criteria**:
- ✓ Successful heist notifies attacker and victim
- ✓ Token earned notifies referrer
- ✓ Notifications appear in-app immediately
- ✓ Emails sent if HEIST_EMAIL_ENABLED=true
- ✓ Notifications include all relevant details
- ✓ Unread count updates in real-time

**Notification Types**:

#### HEIST_SUCCESS (Attacker)
```json
{
  "type": "HEIST_SUCCESS",
  "title": "Heist Successful!",
  "message": "Success! You pulled a heist on {victimName} and stole {pointsStolen} points!",
  "metadata": {
    "victimName": "string",
    "victimId": "number",
    "pointsStolen": "number",
    "newTotalPoints": "number"
  },
  "icon": "🎯",
  "priority": "high"
}
```

#### HEIST_VICTIM (Victim)
```json
{
  "type": "HEIST_VICTIM",
  "title": "You Were Robbed!",
  "message": "Oh no! {attackerName} just pulled a heist on you and stole {pointsLost} of your monthly points!",
  "metadata": {
    "attackerName": "string",
    "attackerId": "number",
    "pointsLost": "number",
    "remainingPoints": "number",
    "protectionUntil": "ISO8601 datetime"
  },
  "icon": "🚨",
  "priority": "high",
  "actionable": true,
  "actions": [
    {
      "label": "View Leaderboard",
      "route": "/leaderboard"
    },
    {
      "label": "Refer Friends for Tokens",
      "route": "/referrals"
    }
  ]
}
```

#### TOKEN_EARNED (Referrer)
```json
{
  "type": "TOKEN_EARNED",
  "title": "Token Earned!",
  "message": "You earned a Heist Token! {referredName} joined using your referral code.",
  "metadata": {
    "referredName": "string",
    "referredId": "number",
    "totalTokens": "number"
  },
  "icon": "🪙",
  "priority": "medium",
  "actionable": true,
  "actions": [
    {
      "label": "Use Token",
      "route": "/leaderboard"
    }
  ]
}
```

---

## Technical Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Layer                            │
│  (Future: React/Next.js - Not in scope for backend)        │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS/REST
                         │
┌────────────────────────▼────────────────────────────────────┐
│                  API Gateway Layer                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Express.js Middleware Stack                         │  │
│  │  • Authentication (JWT)                              │  │
│  │  • Rate Limiting (express-rate-limit)               │  │
│  │  • Request Validation (Zod)                         │  │
│  │  • Error Handling                                    │  │
│  │  • Logging (Winston/Morgan)                         │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                   Route Layer                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  /api/heist/*                                        │  │
│  │  • heist.routes.ts (NEW)                            │  │
│  │    - GET    /tokens                                  │  │
│  │    - POST   /execute                                 │  │
│  │    - GET    /can-rob/:id                            │  │
│  │    - GET    /history                                 │  │
│  │    - GET    /notifications                           │  │
│  │    - POST   /notifications/read                      │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Existing Routes (Modified)                          │  │
│  │  • auth.routes.ts - Add token award on referral     │  │
│  │  • leaderboard.routes.ts - Add heist eligibility    │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                Business Logic Layer                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  /src/lib/heist/                                     │  │
│  │  ┌────────────────┐  ┌────────────────┐            │  │
│  │  │  tokens.ts     │  │ validation.ts  │            │  │
│  │  │  • getBalance  │  │ • canPerform   │            │  │
│  │  │  • award       │  │ • isProtected  │            │  │
│  │  │  • spend       │  │ • isValid      │            │  │
│  │  │  • hasTokens   │  │ • checkAll     │            │  │
│  │  └────────────────┘  └────────────────┘            │  │
│  │  ┌────────────────┐  ┌────────────────┐            │  │
│  │  │ execution.ts   │  │ notifications  │            │  │
│  │  │  • execute     │  │ • sendHeist    │            │  │
│  │  │  • rollback    │  │ • sendToken    │            │  │
│  │  │  • record      │  │ • markRead     │            │  │
│  │  └────────────────┘  └────────────────┘            │  │
│  │  ┌────────────────┐  ┌────────────────┐            │  │
│  │  │  config.ts     │  │ cooldowns.ts   │            │  │
│  │  │  • getConfig   │  │ • getAttacker  │            │  │
│  │  │  • validate    │  │ • getVictim    │            │  │
│  │  └────────────────┘  └────────────────┘            │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                  Data Access Layer                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Prisma ORM                                          │  │
│  │  • Query Builder                                     │  │
│  │  • Transaction Management                            │  │
│  │  • Connection Pooling                                │  │
│  │  • Type Safety                                       │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                   Database Layer                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  PostgreSQL                                          │  │
│  │  ┌────────────┐  ┌────────────┐  ┌──────────────┐  │  │
│  │  │    User    │  │ HeistToken │  │    Heist     │  │  │
│  │  ├────────────┤  ├────────────┤  ├──────────────┤  │  │
│  │  │ monthlyPts │◄─┤ userId     │◄─┤ attackerId   │  │  │
│  │  │ points     │  │ balance    │  │ victimId     │  │  │
│  │  └────────────┘  │ totalEarned│  │ pointsStolen │  │  │
│  │                  └────────────┘  └──────────────┘  │  │
│  │  ┌──────────────────┐  ┌────────────────────┐      │  │
│  │  │HeistNotification │  │ UserPointEvent     │      │  │
│  │  ├──────────────────┤  ├────────────────────┤      │  │
│  │  │ userId           │  │ userId             │      │  │
│  │  │ heistId          │  │ points (+/-)       │      │  │
│  │  │ message          │  │ pointEventTypeId   │      │  │
│  │  └──────────────────┘  └────────────────────┘      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
┌────────▼──────────┐         ┌──────────▼──────────┐
│  Email Service    │         │  Cache Layer        │
│  (SendGrid)       │         │  (Optional Redis)   │
│  • Async queue    │         │  • Cooldowns        │
│  • Retry logic    │         │  • Token balances   │
│  • Templates      │         │  • Leaderboard      │
└───────────────────┘         └─────────────────────┘
```

---

## Data Models & Relationships

### Entity Relationship Diagram

```
┌─────────────────────────────────────────┐
│                 User                    │
├─────────────────────────────────────────┤
│ PK │ id: Int                            │
│    │ email: String                      │
│    │ monthlyPoints: Int                 │◄─────┐
│    │ points: Int                        │      │
│    │ referralCode: String               │      │
│    │ referredByUserId: Int              │      │
│    │ ...                                │      │
└──────┬──────────────────────┬───────────┘      │
       │ 1                    │ 1                │
       │                      │                  │
       │ 1                    │ *                │
       │                      │                  │
┌──────▼──────────────┐   ┌───▼──────────────────┐
│   HeistToken        │   │     Heist            │
├─────────────────────┤   ├──────────────────────┤
│ PK │ id: Int        │   │ PK │ id: Int         │
│ UK │ userId: Int    │   │ FK │ attackerId: Int │──┐
│    │ balance: Int   │   │ FK │ victimId: Int   │  │
│    │ totalEarned    │   │    │ pointsStolen    │  │ Points
│    │ totalSpent     │   │    │ victimPtsBefore │  │ Transfer
│    │ lastEarnedAt   │   │    │ victimPtsAfter  │  │
│    │ lastSpentAt    │   │    │ attackerPtsBefore│ │
└─────────────────────┘   │    │ attackerPtsAfter │─┘
                          │    │ status: HeistStatus│
                          │    │ createdAt        │
                          └──────┬─────────────────┘
                                 │ 1
                                 │
                                 │ *
                          ┌──────▼──────────────────┐
                          │ HeistNotification       │
                          ├─────────────────────────┤
                          │ PK │ id: Int            │
                          │ FK │ userId: Int        │
                          │ FK │ heistId: Int?      │
                          │    │ type: NotifType    │
                          │    │ message: String    │
                          │    │ read: Boolean      │
                          │    │ metadata: Json     │
                          │    │ createdAt          │
                          └─────────────────────────┘

Legend:
PK = Primary Key
FK = Foreign Key
UK = Unique Key
* = Many
1 = One
```

### Database Constraints & Indexes

#### HeistToken
```sql
-- Constraints
PRIMARY KEY (id)
UNIQUE (userId)
FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE

-- Indexes
CREATE INDEX idx_heist_token_user ON HeistToken(userId);
CREATE INDEX idx_heist_token_balance ON HeistToken(balance);
CREATE INDEX idx_heist_token_last_spent ON HeistToken(lastSpentAt);

-- Check Constraints
CHECK (balance >= 0)
CHECK (totalEarned >= totalSpent)
CHECK (totalSpent >= 0)
```

#### Heist
```sql
-- Constraints
PRIMARY KEY (id)
FOREIGN KEY (attackerId) REFERENCES User(id) ON DELETE CASCADE
FOREIGN KEY (victimId) REFERENCES User(id) ON DELETE CASCADE
FOREIGN KEY (attackerId) REFERENCES HeistToken(userId) -- Ensure token exists

-- Indexes (Performance Critical)
CREATE INDEX idx_heist_attacker_created ON Heist(attackerId, createdAt DESC);
CREATE INDEX idx_heist_victim_created ON Heist(victimId, createdAt DESC);
CREATE INDEX idx_heist_created ON Heist(createdAt DESC);
CREATE INDEX idx_heist_status ON Heist(status);
CREATE INDEX idx_heist_attacker_status ON Heist(attackerId, status);
CREATE INDEX idx_heist_victim_status ON Heist(victimId, status);

-- Check Constraints
CHECK (pointsStolen >= 0)
CHECK (pointsStolen <= 100) -- Enforces max cap
CHECK (attackerId != victimId) -- Prevents self-robbery at DB level
CHECK (victimPointsAfter >= 0)
CHECK (attackerPointsAfter >= 0)
```

#### HeistNotification
```sql
-- Constraints
PRIMARY KEY (id)
FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
FOREIGN KEY (heistId) REFERENCES Heist(id) ON DELETE SET NULL

-- Indexes
CREATE INDEX idx_heist_notif_user_read ON HeistNotification(userId, read);
CREATE INDEX idx_heist_notif_user_created ON HeistNotification(userId, createdAt DESC);
CREATE INDEX idx_heist_notif_created ON HeistNotification(createdAt DESC);
CREATE INDEX idx_heist_notif_type ON HeistNotification(type);

-- Partial Index for Unread (Performance Optimization)
CREATE INDEX idx_heist_notif_unread ON HeistNotification(userId) 
WHERE read = false;
```

---

## API Specifications

### Authentication
All heist endpoints require JWT authentication via `Authorization: Bearer <token>` header.

### Rate Limiting
```javascript
{
  windowMs: 60000, // 1 minute
  max: 10, // 10 requests per minute
  message: "Too many heist attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
}
```

### API Endpoint Specifications

#### 1. GET /api/heist/tokens

**Purpose**: Get user's token balance and history

**Authentication**: Required

**Rate Limit**: 60/minute

**Request**:
```http
GET /api/heist/tokens HTTP/1.1
Host: api.example.com
Authorization: Bearer <jwt_token>
```

**Response 200**:
```json
{
  "balance": 3,
  "totalEarned": 10,
  "totalSpent": 7,
  "lastEarnedAt": "2025-11-06T15:30:00.000Z",
  "lastSpentAt": "2025-11-05T10:00:00.000Z"
}
```

**Response 401** (Unauthorized):
```json
{
  "error": "Unauthorized",
  "message": "Authentication required"
}
```

**Performance SLA**: < 10ms (database indexed query)

---

#### 2. POST /api/heist/execute

**Purpose**: Execute a heist against a target user

**Authentication**: Required

**Rate Limit**: 10/minute

**Request**:
```http
POST /api/heist/execute HTTP/1.1
Host: api.example.com
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "targetUserId": 456
}
```

**Validation Rules**:
- `targetUserId`: Required, integer, positive, exists in database

**Success Response 200**:
```json
{
  "success": true,
  "heistId": 789,
  "pointsStolen": 85,
  "victimName": "Jane Doe",
  "newTotalPoints": 1285,
  "tokensRemaining": 2,
  "message": "Success! You pulled a heist on Jane Doe and stole 85 points!",
  "cooldownEndsAt": "2025-11-08T10:00:00.000Z"
}
```

**Error Response 400** (Insufficient Tokens):
```json
{
  "success": false,
  "error": "INSUFFICIENT_TOKENS",
  "message": "You need at least 1 Heist Token to perform a heist",
  "tokensNeeded": 1,
  "tokensAvailable": 0,
  "howToEarn": "Refer friends to earn tokens"
}
```

**Error Response 400** (On Cooldown):
```json
{
  "success": false,
  "error": "COOLDOWN_ACTIVE",
  "message": "You can perform another heist in 18 hours",
  "cooldownEndsAt": "2025-11-08T04:00:00.000Z",
  "hoursRemaining": 18
}
```

**Error Response 400** (Target Protected):
```json
{
  "success": false,
  "error": "TARGET_PROTECTED",
  "message": "Jane Doe was recently robbed and is under protection for 24 hours",
  "protectionEndsAt": "2025-11-08T10:00:00.000Z",
  "hoursRemaining": 24
}
```

**Error Response 400** (Invalid Target):
```json
{
  "success": false,
  "error": "INVALID_TARGET",
  "message": "Target must have at least 20 points (currently has 15)",
  "minimumRequired": 20,
  "targetPoints": 15
}
```

**Error Response 400** (Self Target):
```json
{
  "success": false,
  "error": "INVALID_TARGET",
  "message": "You cannot rob yourself"
}
```

**Error Response 404** (Target Not Found):
```json
{
  "success": false,
  "error": "TARGET_NOT_FOUND",
  "message": "User not found"
}
```

**Error Response 503** (Feature Disabled):
```json
{
  "success": false,
  "error": "FEATURE_DISABLED",
  "message": "Heist feature is currently disabled"
}
```

**Performance SLA**: < 100ms (includes transaction)

**Transaction Guarantees**:
- Atomicity: All or nothing (points, tokens, records)
- Consistency: Balance checks enforced
- Isolation: Row-level locks prevent concurrent heists on same victim
- Durability: Committed before response sent

---

#### 3. GET /api/heist/can-rob/:targetUserId

**Purpose**: Check if user can rob a specific target (pre-check before execution)

**Authentication**: Required

**Rate Limit**: 60/minute

**Request**:
```http
GET /api/heist/can-rob/456 HTTP/1.1
Host: api.example.com
Authorization: Bearer <jwt_token>
```

**Response 200** (Eligible):
```json
{
  "eligible": true,
  "targetUserId": 456,
  "targetName": "Jane Doe",
  "targetPoints": 1700,
  "potentialSteal": 85,
  "tokensAvailable": 3,
  "cooldownStatus": {
    "onCooldown": false,
    "canRobAt": null,
    "hoursRemaining": 0
  },
  "targetStatus": {
    "protected": false,
    "protectionEndsAt": null,
    "hoursRemaining": 0
  }
}
```

**Response 200** (Not Eligible - Cooldown):
```json
{
  "eligible": false,
  "reason": "You can perform another heist in 18 hours",
  "errorCode": "COOLDOWN_ACTIVE",
  "cooldownStatus": {
    "onCooldown": true,
    "canRobAt": "2025-11-08T04:00:00.000Z",
    "hoursRemaining": 18
  }
}
```

**Performance SLA**: < 20ms

---

#### 4. GET /api/heist/history

**Purpose**: Get user's heist history (as attacker and victim)

**Authentication**: Required

**Rate Limit**: 60/minute

**Query Parameters**:
- `type` (optional): `"attacker"` | `"victim"` | `"all"` (default: "all")
- `limit` (optional): 1-100 (default: 20)
- `offset` (optional): ≥0 (default: 0)
- `status` (optional): `"SUCCESS"` | `"FAILED"` (default: all)

**Request**:
```http
GET /api/heist/history?type=all&limit=20&offset=0 HTTP/1.1
Host: api.example.com
Authorization: Bearer <jwt_token>
```

**Response 200**:
```json
{
  "heists": [
    {
      "id": 789,
      "type": "attacker",
      "otherUser": {
        "id": 456,
        "name": "Jane Doe",
        "avatarUrl": "https://..."
      },
      "pointsStolen": 85,
      "status": "SUCCESS",
      "createdAt": "2025-11-05T10:00:00.000Z",
      "yourPointsBefore": 1200,
      "yourPointsAfter": 1285
    },
    {
      "id": 788,
      "type": "victim",
      "otherUser": {
        "id": 123,
        "name": "John Smith",
        "avatarUrl": "https://..."
      },
      "pointsLost": 50,
      "status": "SUCCESS",
      "createdAt": "2025-11-04T14:30:00.000Z",
      "yourPointsBefore": 1000,
      "yourPointsAfter": 950
    }
  ],
  "pagination": {
    "total": 45,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  },
  "stats": {
    "totalHeistsAsAttacker": 25,
    "totalHeistsAsVictim": 20,
    "totalPointsStolen": 1250,
    "totalPointsLost": 980,
    "netPoints": 270
  }
}
```

**Performance SLA**: < 50ms

---

#### 5. GET /api/heist/notifications

**Purpose**: Get user's heist-related notifications

**Authentication**: Required

**Rate Limit**: 60/minute

**Query Parameters**:
- `unreadOnly` (optional): `true` | `false` (default: false)
- `limit` (optional): 1-100 (default: 20)
- `offset` (optional): ≥0 (default: 0)

**Request**:
```http
GET /api/heist/notifications?unreadOnly=true&limit=20 HTTP/1.1
Host: api.example.com
Authorization: Bearer <jwt_token>
```

**Response 200**:
```json
{
  "notifications": [
    {
      "id": 1,
      "type": "HEIST_VICTIM",
      "message": "Oh no! John Doe just pulled a heist on you and stole 85 of your monthly points!",
      "metadata": {
        "attackerName": "John Doe",
        "attackerId": 123,
        "pointsLost": 85,
        "protectionUntil": "2025-11-08T10:00:00.000Z"
      },
      "read": false,
      "createdAt": "2025-11-06T10:00:00.000Z",
      "actions": [
        {
          "label": "View Leaderboard",
          "route": "/leaderboard"
        }
      ]
    }
  ],
  "unreadCount": 3,
  "pagination": {
    "total": 50,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

**Performance SLA**: < 20ms

---

#### 6. POST /api/heist/notifications/read

**Purpose**: Mark notifications as read

**Authentication**: Required

**Rate Limit**: 60/minute

**Request** (Specific IDs):
```http
POST /api/heist/notifications/read HTTP/1.1
Host: api.example.com
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "notificationIds": [1, 2, 3]
}
```

**Request** (All):
```http
POST /api/heist/notifications/read HTTP/1.1
Host: api.example.com
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "markAllRead": true
}
```

**Response 200**:
```json
{
  "success": true,
  "markedCount": 3
}
```

**Performance SLA**: < 30ms

---

## Business Logic Specifications

### Token Management Logic

#### Function: `awardToken(userId: number)`

**Purpose**: Award a heist token when a referral signs up

**Preconditions**:
- User must exist
- Called after successful referral signup

**Logic**:
```typescript
1. BEGIN TRANSACTION
2. UPSERT HeistToken
   - If exists: INCREMENT balance, totalEarned
   - If not exists: CREATE with balance=1, totalEarned=1
3. UPDATE lastEarnedAt = NOW()
4. CREATE HeistNotification (TOKEN_EARNED type)
5. IF email enabled: Queue email (async, don't block)
6. COMMIT TRANSACTION
7. RETURN token balance
```

**Postconditions**:
- User's token balance increased by 1
- Notification created
- Email queued (if enabled)

**Error Handling**:
- User not found → Throw error, rollback
- Database error → Rollback, return error

**Performance**: < 20ms

---

#### Function: `spendToken(userId: number): boolean`

**Purpose**: Deduct a token during heist execution

**Preconditions**:
- User must have ≥1 token
- Called within heist transaction

**Logic**:
```typescript
1. SELECT balance FROM HeistToken WHERE userId = ? FOR UPDATE
2. IF balance < 1: RETURN false
3. UPDATE HeistToken SET
   - balance = balance - 1
   - totalSpent = totalSpent + 1
   - lastSpentAt = NOW()
4. RETURN true
```

**Postconditions**:
- Token balance decreased by 1
- totalSpent increased by 1

**Error Handling**:
- Insufficient balance → Return false (no exception)
- Database error → Throw error (trigger transaction rollback)

**Performance**: < 5ms

---

### Heist Validation Logic

#### Function: `checkHeistEligibility(attackerId, victimId)`

**Purpose**: Comprehensive pre-heist validation

**Logic Flow**:
```
1. Check feature enabled (HEIST_ENABLED)
   ├─ False → RETURN ineligible("Feature disabled")
   └─ True → Continue

2. Check attacker has tokens
   ├─ < 1 → RETURN ineligible("Insufficient tokens")
   └─ ≥ 1 → Continue

3. Check not self-robbery
   ├─ attackerId == victimId → RETURN ineligible("Cannot rob self")
   └─ Different → Continue

4. Check victim exists
   ├─ Not found → RETURN ineligible("User not found")
   └─ Found → Continue

5. Check victim has minimum points
   ├─ < 20 → RETURN ineligible("Insufficient points")
   └─ ≥ 20 → Continue

6. Check attacker cooldown
   ├─ Last heist < 24h ago → RETURN ineligible("On cooldown")
   └─ No recent heist → Continue

7. Check victim protection
   ├─ Last robbed < 48h ago → RETURN ineligible("Protected")
   └─ No recent robbery → Continue

8. All checks passed
   └─ RETURN eligible(true)
```

**Performance**: < 30ms (multiple database queries)

**Optimization**: Consider Redis cache for cooldowns

---

### Heist Execution Logic

#### Function: `executeHeist(attackerId, victimId, ipAddress?)`

**Purpose**: Execute the complete heist process atomically

**Transaction Isolation**: READ COMMITTED with row-level locks

**Logic**:
```typescript
BEGIN TRANSACTION

1. LOCK victim row
   SELECT * FROM User WHERE id = victimId FOR UPDATE

2. LOCK attacker row
   SELECT * FROM User WHERE id = attackerId FOR UPDATE

3. Re-validate eligibility (CRITICAL - state may have changed)
   IF not eligible: ROLLBACK + RETURN error

4. Calculate steal amount
   stealAmount = MIN(FLOOR(victim.monthlyPoints * 0.05), 100)
   IF stealAmount == 0: ROLLBACK + RETURN error

5. Update victim points
   UPDATE User SET monthlyPoints = monthlyPoints - stealAmount
   WHERE id = victimId

6. Update attacker points
   UPDATE User SET monthlyPoints = monthlyPoints + stealAmount
   WHERE id = attackerId

7. Spend token
   UPDATE HeistToken SET balance = balance - 1, ...
   WHERE userId = attackerId

8. Create Heist record
   INSERT INTO Heist (attackerId, victimId, pointsStolen, ...)

9. Create point events (2x)
   INSERT INTO UserPointEvent (userId=attackerId, points=+stealAmount, type=HEIST_GAIN)
   INSERT INTO UserPointEvent (userId=victimId, points=-stealAmount, type=HEIST_LOSS)

10. Invalidate leaderboard cache
    invalidateLeaderboardCache()

COMMIT TRANSACTION

11. Send notifications (ASYNC - after commit)
    - Create in-app notifications (2x)
    - Queue emails (2x)

RETURN success result
```

**Rollback Triggers**:
- Any database error
- Validation failure
- Insufficient points calculation
- Constraint violation

**Performance**: < 100ms (transaction with 10+ operations)

**Concurrency Handling**:
- Row locks prevent double-spending
- Re-validation inside transaction prevents race conditions
- Deadlock detection with auto-retry (Prisma built-in)

---

## Security Specifications

### SEC-1: Authentication & Authorization

**Requirements**:
- All heist endpoints require valid JWT token
- Token must contain valid user ID
- User must exist and be active
- No role restrictions (all users can participate)

**Implementation**:
```typescript
// Middleware stack
app.use('/api/heist', [
  protect, // JWT validation
  // Rate limiting applied per endpoint
]);
```

**Attack Prevention**:
- Invalid tokens → 401 Unauthorized
- Expired tokens → 401 Unauthorized
- Suspended users → 403 Forbidden

---

### SEC-2: Input Validation

**Requirements**:
- All inputs validated with Zod schemas
- Type safety enforced
- Range checks on numeric values
- SQL injection prevented (Prisma parameterized queries)

**Validation Schema Example**:
```typescript
const executeHeistSchema = z.object({
  targetUserId: z.number()
    .int("Must be integer")
    .positive("Must be positive")
    .max(2147483647, "Invalid user ID")
});
```

---

### SEC-3: Rate Limiting

**Requirements**:
- Heist execution: 10 requests/minute per user
- Other endpoints: 60 requests/minute per user
- Implemented with express-rate-limit
- Based on user ID (not IP) to prevent bypass

**Configuration**:
```typescript
const heistLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  keyGenerator: (req) => req.user.id, // Per-user limit
  handler: (req, res) => res.status(429).json({
    error: "RATE_LIMIT_EXCEEDED",
    message: "Too many heist attempts",
    retryAfter: 60
  })
});
```

---

### SEC-4: Transaction Integrity

**Requirements**:
- All heists in atomic transactions
- Row-level locks prevent race conditions
- Validation re-run inside transaction
- Rollback on any error

**Attack Scenarios Prevented**:

1. **Double-Spending Attack**:
   ```
   User A attempts heist with 1 token
   Two requests sent simultaneously
   → Row lock ensures only one succeeds
   → Second request fails (insufficient tokens)
   ```

2. **Point Manipulation**:
   ```
   Victim's points change during heist
   → Re-validation in transaction
   → Uses latest value
   → Prevents stale data exploitation
   ```

3. **Cooldown Bypass**:
   ```
   User attempts heist before cooldown ends
   → Server-side time check
   → No client input for timestamps
   → Cooldown enforced regardless of client manipulation
   ```

---

### SEC-5: Audit Logging

**Requirements**:
- All heist attempts logged (success + failure)
- IP address recorded
- Timestamps in UTC
- Logs retained 90 days

**Log Format**:
```json
{
  "timestamp": "2025-11-07T10:00:00.000Z",
  "event": "HEIST_ATTEMPT",
  "attackerId": 123,
  "victimId": 456,
  "result": "SUCCESS",
  "pointsStolen": 85,
  "ipAddress": "192.168.1.1",
  "userAgent": "Mozilla/5.0..."
}
```

**Monitoring Alerts**:
- Trigger alert if same user fails >10 heists in 1 hour
- Trigger alert if same victim targeted >5 times in 24h
- Trigger alert if heist success rate <90% (indicates bug)

---

### SEC-6: Data Privacy

**Requirements**:
- Email addresses not exposed in API responses
- User IDs sanitized (no internal IDs exposed)
- IP addresses hashed before storage (optional)
- GDPR compliance for EU users

**PII Handling**:
- Names: Public (shown in notifications)
- Emails: Private (only for notifications)
- Points: Public (leaderboard data)
- Heist history: User's own data only

---

## Performance Requirements

### Database Query Performance

| Query Type | SLA | Index Required |
|------------|-----|----------------|
| Get token balance | <5ms | idx_heist_token_user |
| Check cooldown | <10ms | idx_heist_attacker_created |
| Check protection | <10ms | idx_heist_victim_created |
| Execute heist transaction | <100ms | Multiple indexes |
| Get notifications | <20ms | idx_heist_notif_user_read |
| Get history | <50ms | idx_heist_attacker_created |

### API Response Times (95th Percentile)

| Endpoint | Target | Maximum Acceptable |
|----------|--------|-------------------|
| GET /tokens | <10ms | 50ms |
| POST /execute | <100ms | 500ms |
| GET /can-rob/:id | <20ms | 100ms |
| GET /history | <50ms | 200ms |
| GET /notifications | <20ms | 100ms |
| POST /notifications/read | <30ms | 150ms |

### Throughput Requirements

| Metric | Target | Notes |
|--------|--------|-------|
| Concurrent heists | 100/second | With database connection pool |
| Notifications sent | 1000/minute | Async queue |
| Email throughput | 500/minute | SendGrid limit |

### Scalability Targets

- Support 10,000 active users
- Support 100,000 total users
- Handle 1 million heists/month
- Database size: ~1GB/year (heist data)

---

## Error Handling

### Error Response Format (Standard)

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable error message",
  "details": {
    // Optional additional context
  },
  "timestamp": "2025-11-07T10:00:00.000Z",
  "requestId": "uuid-v4"
}
```

### Error Code Catalog

| Code | HTTP Status | Meaning | User Action |
|------|-------------|---------|-------------|
| `INSUFFICIENT_TOKENS` | 400 | User has 0 tokens | Refer friends |
| `COOLDOWN_ACTIVE` | 400 | Attacker on cooldown | Wait |
| `TARGET_PROTECTED` | 400 | Victim recently robbed | Choose different target |
| `INVALID_TARGET` | 400 | Self-robbery or <20 points | Choose valid target |
| `TARGET_NOT_FOUND` | 404 | User doesn't exist | Report bug |
| `FEATURE_DISABLED` | 503 | Heist disabled globally | Wait for re-enable |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Slow down |
| `UNAUTHORIZED` | 401 | Invalid/missing auth | Login again |
| `INTERNAL_ERROR` | 500 | Server error | Retry later |

### Retry Logic (Client Guidelines)

| Error Code | Retry? | Backoff | Max Retries |
|------------|--------|---------|-------------|
| `INSUFFICIENT_TOKENS` | No | N/A | 0 |
| `COOLDOWN_ACTIVE` | After cooldown | N/A | 0 |
| `TARGET_PROTECTED` | After protection | N/A | 0 |
| `RATE_LIMIT_EXCEEDED` | Yes | 60s | 1 |
| `INTERNAL_ERROR` | Yes | Exponential | 3 |

---

## Testing Requirements

### Unit Test Coverage

| Component | Target Coverage | Critical Tests |
|-----------|----------------|----------------|
| Token management | 100% | Award, spend, balance checks |
| Validation logic | 100% | All eligibility rules |
| Heist execution | 95% | Success, all failure modes |
| Notifications | 90% | All notification types |
| API endpoints | 95% | All status codes |

### Integration Test Scenarios

1. **Complete Heist Flow**
   - User A refers User B
   - User A receives token
   - User A robs User C
   - Both receive notifications
   - Points transferred correctly
   - Leaderboard updates

2. **Concurrent Heists**
   - Two users rob same victim simultaneously
   - Both succeed if eligible
   - Points calculated from latest values
   - No race conditions

3. **Cooldown Enforcement**
   - User performs heist
   - User attempts second heist immediately
   - Second attempt rejected
   - After 24 hours, attempt succeeds

4. **Edge Cases**
   - Rob user with exactly 20 points
   - Rob user with 10,000 points (verify cap)
   - Multiple referrals complete simultaneously
   - Database connection loss during heist

### Performance Tests

1. **Load Test**
   - 100 concurrent users
   - Each performs 10 heists
   - Response time < 100ms (95th percentile)
   - No errors

2. **Stress Test**
   - 500 concurrent users
   - System graceful degradation
   - Rate limiting effective
   - Database connection pool stable

3. **Endurance Test**
   - 1000 heists/minute for 1 hour
   - No memory leaks
   - No connection leaks
   - Consistent performance

---

## Rollout Strategy

### Phase 1: Internal Alpha (Week 1)
- Deploy to staging environment
- Team testing only
- Monitor error rates
- Fix critical bugs

**Success Criteria**:
- 0 P0 bugs
- <1% error rate
- All core flows working

### Phase 2: Closed Beta (Week 2)
- Enable for 100 opted-in users
- Monitor adoption metrics
- Gather user feedback
- Tune configuration if needed

**Success Criteria**:
- >30% token usage rate
- <0.1% error rate
- Positive user feedback

### Phase 3: Gradual Rollout (Week 3)
- Day 1: 10% of users
- Day 3: 25% of users
- Day 5: 50% of users
- Day 7: 100% of users

**Kill Switch**:
- `HEIST_ENABLED=false` disables feature instantly
- No code deployment needed
- Existing heists remain in database

### Phase 4: Full Launch (Week 4)
- All users enabled
- Marketing announcement
- Monitor metrics daily
- Iterate based on data

**Success Metrics**:
- 20%+ increase in referrals
- 30%+ token usage rate
- 2x leaderboard engagement
- <0.1% error rate

---

## Approval Checklist

### Product Team
- [ ] Feature requirements approved
- [ ] User flows validated
- [ ] Success metrics agreed
- [ ] Rollout plan approved

### Engineering Team
- [ ] Technical architecture reviewed
- [ ] Database schema approved
- [ ] API specifications validated
- [ ] Performance targets feasible

### Security Team
- [ ] Authentication mechanism approved
- [ ] Input validation sufficient
- [ ] Transaction integrity verified
- [ ] Audit logging adequate

### Database Team
- [ ] Schema changes reviewed
- [ ] Indexes optimized
- [ ] Migration plan safe
- [ ] Rollback plan tested

### QA Team
- [ ] Test plan reviewed
- [ ] Coverage targets agreed
- [ ] Test environments ready
- [ ] Automation scope defined

---

## Open Questions & Decisions Needed

### Q1: Token Expiration
**Question**: Should tokens expire after X days?

**Options**:
- A) No expiration (current plan)
- B) 30-day expiration
- C) 90-day expiration

**Recommendation**: Start with A, add expiration in Phase 2 if hoarding becomes an issue.

**Decision**: _____________

---

### Q2: Heist Notifications - Push vs Email
**Question**: Should we add push notifications (mobile)?

**Options**:
- A) Email only (current plan)
- B) Add push notifications (requires mobile app changes)
- C) Add SMS notifications

**Recommendation**: Start with A, add B in Phase 2 when mobile app is ready.

**Decision**: _____________

---

### Q3: Maximum Tokens Per User
**Question**: Should there be a cap on token balance?

**Options**:
- A) No cap (current plan)
- B) Cap at 10 tokens
- C) Cap at 25 tokens

**Recommendation**: Start with A, monitor distribution, add cap if extreme hoarding occurs.

**Decision**: _____________

---

### Q4: Heist Animation/Sound
**Question**: Should frontend play special effects on heist?

**Options**:
- A) No effects (current plan - backend only)
- B) Success sound + animation
- C) Full heist cutscene

**Recommendation**: B (future frontend work, not backend concern).

**Decision**: _____________

---

## Appendix A: Configuration Reference

```env
# Feature Toggle
HEIST_ENABLED=true

# Timing
HEIST_COOLDOWN_HOURS=24
HEIST_TARGET_COOLDOWN_HOURS=48

# Economics
HEIST_STEAL_PERCENTAGE=5
HEIST_MAX_STEAL_POINTS=100
HEIST_MIN_TARGET_POINTS=20

# Notifications
HEIST_EMAIL_ENABLED=true

# Rate Limiting
HEIST_RATE_LIMIT_PER_MINUTE=10
```

---

## Appendix B: Database Migration Script

See `HEIST_SCHEMA_CHANGES.md` for complete migration SQL.

---

## Document Change Log

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-11-07 | 1.0 | Initial detailed specification | AI Assistant |

---

**Status**: 📋 Awaiting Team Review & Approval

**Next Steps**:
1. Schedule review meeting with all teams
2. Address open questions
3. Get sign-offs from all stakeholders
4. Begin implementation after approval

