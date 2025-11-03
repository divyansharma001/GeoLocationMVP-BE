# 🎁 Loyalty Points System - Complete Guide

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [System Architecture](#system-architecture)
- [Database Schema](#database-schema)
- [API Documentation](#api-documentation)
- [Usage Examples](#usage-examples)
- [Integration Guide](#integration-guide)
- [Configuration](#configuration)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## Overview

The Loyalty Points System allows merchants to reward customers with points for purchases, which customers can then redeem for discounts on future orders.

### Key Features

- **Per-Merchant Balances**: Each user maintains separate point balances for each merchant
- **Flexible Earning**: Merchants can configure their own point earning rates
- **Multi-Tier Redemption**: Redeem points in multiples of the minimum threshold
- **Complete Audit Trail**: Every point transaction is logged with detailed metadata
- **Merchant Control**: Full program configuration and customer management
- **Analytics Dashboard**: Comprehensive statistics for merchants

### Default Configuration

```
Earning Rate:     $5 spent = 2 loyalty points (0.4 points per dollar)
Minimum Redemption: 25 points
Redemption Value:   25 points = $5 discount
```

---

## How It Works

### For Customers

#### 1. **Earning Points**

Points are automatically awarded when you complete a purchase at a merchant with an active loyalty program.

**Formula**: `floor(purchase_amount × points_per_dollar)`

**Examples**:
- $5.00 purchase → 2 points
- $10.00 purchase → 4 points
- $15.00 purchase → 6 points
- $4.99 purchase → 0 points (rounds down)

#### 2. **Checking Balance**

View your point balance for any merchant through the API or mobile app. You can see:
- Current available points
- Total points earned (lifetime)
- Total points redeemed (lifetime)
- Last earning/redemption dates

#### 3. **Redeeming Points**

Once you have at least 25 points, you can redeem them for discounts:

| Points | Discount |
|--------|----------|
| 25     | $5       |
| 50     | $10      |
| 75     | $15      |
| 100    | $20      |

**Important**: Unused points remain in your account. If you redeem 50 points from a balance of 63, you'll have 13 points remaining.

### For Merchants

#### 1. **Program Setup**

Initialize your loyalty program with custom or default settings:

```json
{
  "pointsPerDollar": 0.4,
  "minimumPurchase": 0.01,
  "minimumRedemption": 25,
  "redemptionValue": 5.0,
  "allowCombineWithDeals": true,
  "earnOnDiscounted": false
}
```

#### 2. **Customer Management**

- View all customers with loyalty balances
- Sort by balance, lifetime earned, or last activity
- Award bonus points manually
- Adjust points for corrections or refunds

#### 3. **Analytics**

Track your loyalty program performance:
- Total active users
- Points issued vs. redeemed
- Outstanding point liability
- Total discount value given
- Recent redemption activity

---

## System Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend/Client                       │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│                   API Layer                              │
│  ┌────────────────────┐  ┌─────────────────────────┐   │
│  │  User Endpoints    │  │  Merchant Endpoints     │   │
│  │  /api/loyalty      │  │  /api/merchants/loyalty │   │
│  └────────────────────┘  └─────────────────────────┘   │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│              Business Logic Layer                        │
│  src/lib/loyalty.ts                                      │
│  - Point calculation                                     │
│  - Balance management                                    │
│  - Transaction processing                                │
│  - Analytics generation                                  │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│                 Database Layer                           │
│  - MerchantLoyaltyProgram                               │
│  - UserMerchantLoyalty                                  │
│  - LoyaltyPointTransaction                              │
│  - LoyaltyRedemption                                    │
│  - Order                                                │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

#### Earning Points Flow

```
1. Customer completes order
2. Order system calls awardLoyaltyPoints()
3. System validates merchant has active program
4. Calculate points: floor(amount × rate)
5. BEGIN TRANSACTION
   a. Update user balance (+points)
   b. Create transaction record
   c. Link to order
6. COMMIT TRANSACTION
7. Return success with points awarded
```

#### Redemption Flow

```
1. Customer initiates redemption
2. System validates:
   - Sufficient points
   - Minimum threshold met
   - Program is active
3. Calculate discount value
4. BEGIN TRANSACTION
   a. Deduct points from balance
   b. Create redemption record
   c. Create transaction record
5. COMMIT TRANSACTION
6. Apply discount to order
7. Return redemption details
```

---

## Database Schema

### Core Models

#### MerchantLoyaltyProgram

Configuration for each merchant's loyalty program.

```prisma
model MerchantLoyaltyProgram {
  id                    Int       @id @default(autoincrement())
  merchantId            Int       @unique
  isActive              Boolean   @default(true)
  pointsPerDollar       Float     @default(0.4)
  minimumPurchase       Float     @default(0.01)
  minimumRedemption     Int       @default(25)
  redemptionValue       Float     @default(5.0)
  pointExpirationDays   Int?
  allowCombineWithDeals Boolean   @default(true)
  earnOnDiscounted      Boolean   @default(false)
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
}
```

#### UserMerchantLoyalty

Tracks each user's point balance per merchant.

```prisma
model UserMerchantLoyalty {
  id                Int       @id @default(autoincrement())
  userId            Int
  merchantId        Int
  loyaltyProgramId  Int
  currentBalance    Int       @default(0)
  lifetimeEarned    Int       @default(0)
  lifetimeRedeemed  Int       @default(0)
  lastEarnedAt      DateTime?
  lastRedeemedAt    DateTime?
  tier              String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  
  @@unique([userId, merchantId])
}
```

#### LoyaltyPointTransaction

Complete audit trail of all point activities.

```prisma
model LoyaltyPointTransaction {
  id                   Int                    @id @default(autoincrement())
  userId               Int
  merchantId           Int
  loyaltyProgramId     Int
  userLoyaltyId        Int
  type                 LoyaltyTransactionType
  points               Int
  balanceBefore        Int
  balanceAfter         Int
  description          String
  metadata             Json?
  relatedOrderId       Int?
  relatedRedemptionId  Int?
  createdAt            DateTime               @default(now())
}
```

#### LoyaltyRedemption

Tracks redemption events and their lifecycle.

```prisma
model LoyaltyRedemption {
  id                 Int                     @id @default(autoincrement())
  userId             Int
  merchantId         Int
  loyaltyProgramId   Int
  userLoyaltyId      Int
  pointsUsed         Int
  discountValue      Float
  orderId            Int?
  status             LoyaltyRedemptionStatus @default(PENDING)
  redeemedAt         DateTime                @default(now())
  appliedAt          DateTime?
  cancelledAt        DateTime?
  cancellationReason String?
  metadata           Json?
  createdAt          DateTime                @default(now())
  updatedAt          DateTime                @updatedAt
}
```

#### Order

Purchase records with loyalty integration.

```prisma
model Order {
  id                    Int         @id @default(autoincrement())
  userId                Int
  merchantId            Int
  loyaltyProgramId      Int?
  orderNumber           String      @unique
  subtotal              Float
  discountAmount        Float       @default(0)
  loyaltyDiscount       Float       @default(0)
  finalAmount           Float
  loyaltyPointsEarned   Int         @default(0)
  loyaltyPointsRedeemed Int         @default(0)
  status                OrderStatus @default(PENDING)
  orderItems            Json
  createdAt             DateTime    @default(now())
  updatedAt             DateTime    @updatedAt
  completedAt           DateTime?
  cancelledAt           DateTime?
}
```

### Enums

```prisma
enum LoyaltyTransactionType {
  EARNED
  REDEEMED
  EXPIRED
  ADJUSTED
  BONUS
  REFUNDED
}

enum LoyaltyRedemptionStatus {
  PENDING
  APPLIED
  CANCELLED
  EXPIRED
}

enum OrderStatus {
  PENDING
  CONFIRMED
  PREPARING
  READY
  COMPLETED
  CANCELLED
  REFUNDED
}
```

---

## API Documentation

### User Endpoints

All user endpoints require authentication via JWT token in the `Authorization: Bearer <token>` header.

#### Get Loyalty Balance

```http
GET /api/loyalty/balance/:merchantId
```

**Response**:

```json
{
  "success": true,
  "balance": {
    "userId": 123,
    "merchantId": 456,
    "currentBalance": 28,
    "lifetimeEarned": 100,
    "lifetimeRedeemed": 72,
    "lastEarnedAt": "2025-11-03T12:00:00Z",
    "lastRedeemedAt": "2025-11-01T10:00:00Z",
    "merchantName": "Joe's Pizza",
    "programConfig": {
      "pointsPerDollar": 0.4,
      "minimumRedemption": 25,
      "redemptionValue": 5.0
    }
  }
}
```

#### Get All Balances

```http
GET /api/loyalty/balances
```

**Response**:

```json
{
  "success": true,
  "balances": [
    {
      "currentBalance": 50,
      "merchantName": "Restaurant A",
      "merchantLogo": "https://...",
      "lifetimeEarned": 150,
      "lifetimeRedeemed": 100
    }
  ],
  "total": 5,
  "totalPoints": 150
}
```

#### Calculate Points for Purchase

```http
POST /api/loyalty/calculate-points
Content-Type: application/json

{
  "merchantId": 456,
  "amount": 25.50
}
```

**Response**:

```json
{
  "success": true,
  "calculation": {
    "orderAmount": 25.50,
    "pointsEarned": 10,
    "pointsPerDollar": 0.4,
    "calculation": "floor(25.50 × 0.4) = 10 points"
  }
}
```

#### Calculate Redemption Value

```http
POST /api/loyalty/calculate-redemption
Content-Type: application/json

{
  "merchantId": 456,
  "points": 50
}
```

**Response**:

```json
{
  "success": true,
  "calculation": {
    "pointsToRedeem": 50,
    "discountValue": 10,
    "remainingPoints": 0,
    "calculation": "2 × $5 = $10 (50 points used, 0 remaining)"
  }
}
```

#### Get Redemption Options

```http
GET /api/loyalty/redemption-options/:merchantId
```

**Response**:

```json
{
  "success": true,
  "currentBalance": 63,
  "merchantName": "Joe's Pizza",
  "tiers": [
    {
      "points": 25,
      "value": 5,
      "available": true,
      "pointsNeeded": 0
    },
    {
      "points": 50,
      "value": 10,
      "available": true,
      "pointsNeeded": 0
    },
    {
      "points": 75,
      "value": 15,
      "available": false,
      "pointsNeeded": 12
    }
  ]
}
```

#### Validate Redemption

```http
POST /api/loyalty/validate-redemption
Content-Type: application/json

{
  "merchantId": 456,
  "points": 25,
  "orderAmount": 30
}
```

**Response**:

```json
{
  "success": true,
  "validation": {
    "valid": true,
    "availablePoints": 50,
    "discountValue": 5
  }
}
```

#### Get Transaction History

```http
GET /api/loyalty/transactions/:merchantId?limit=50&offset=0
```

**Response**:

```json
{
  "success": true,
  "transactions": [
    {
      "id": 1,
      "type": "EARNED",
      "points": 10,
      "balanceBefore": 40,
      "balanceAfter": 50,
      "description": "Earned 10 points from $25.00 purchase",
      "createdAt": "2025-11-03T12:00:00Z",
      "order": {
        "id": 789,
        "orderNumber": "ORD-123",
        "finalAmount": 25.00
      }
    }
  ],
  "total": 25,
  "limit": 50,
  "offset": 0,
  "hasMore": false
}
```

#### Get Program Information

```http
GET /api/loyalty/program/:merchantId
```

**Response**:

```json
{
  "success": true,
  "program": {
    "merchantId": 456,
    "merchantName": "Joe's Pizza",
    "isActive": true,
    "pointsPerDollar": 0.4,
    "minimumRedemption": 25,
    "redemptionValue": 5,
    "description": "Earn 2 points for every $5 spent. Redeem 25 points for $5 off your order!"
  }
}
```

### Merchant Endpoints

All merchant endpoints require authentication and approved merchant status.

#### Initialize Loyalty Program

```http
POST /api/merchants/loyalty/initialize
Content-Type: application/json

{
  "pointsPerDollar": 0.4,
  "minimumPurchase": 0.01,
  "minimumRedemption": 25,
  "redemptionValue": 5.0,
  "pointExpirationDays": null,
  "allowCombineWithDeals": true,
  "earnOnDiscounted": false
}
```

**Response**:

```json
{
  "success": true,
  "program": {
    "id": 1,
    "merchantId": 456,
    "isActive": true,
    "pointsPerDollar": 0.4,
    "minimumRedemption": 25,
    "redemptionValue": 5.0
  },
  "message": "Loyalty program initialized successfully!"
}
```

#### Get Program Configuration

```http
GET /api/merchants/loyalty/program
```

#### Update Program Configuration

```http
PUT /api/merchants/loyalty/program
Content-Type: application/json

{
  "pointsPerDollar": 0.5,
  "minimumRedemption": 20
}
```

#### Activate/Deactivate Program

```http
PATCH /api/merchants/loyalty/status
Content-Type: application/json

{
  "isActive": true
}
```

#### Get Analytics

```http
GET /api/merchants/loyalty/analytics
```

**Response**:

```json
{
  "success": true,
  "analytics": {
    "program": {
      "isActive": true,
      "pointsPerDollar": 0.4,
      "minimumRedemption": 25,
      "redemptionValue": 5
    },
    "users": {
      "total": 150,
      "active": 98,
      "inactivePercent": "34.67"
    },
    "points": {
      "issued": 15000,
      "redeemed": 5000,
      "outstanding": 10000
    },
    "discounts": {
      "totalValue": 1000,
      "averagePerRedemption": 10
    },
    "recentRedemptions": []
  }
}
```

#### Get Customer List

```http
GET /api/merchants/loyalty/customers?limit=50&offset=0&sortBy=currentBalance&order=desc
```

**Query Parameters**:
- `limit` (1-100, default: 50)
- `offset` (default: 0)
- `sortBy` (currentBalance, lifetimeEarned, lifetimeRedeemed, lastEarnedAt)
- `order` (asc, desc)

**Response**:

```json
{
  "success": true,
  "customers": [
    {
      "userId": 123,
      "userName": "John Doe",
      "userEmail": "john@example.com",
      "currentBalance": 50,
      "lifetimeEarned": 200,
      "lifetimeRedeemed": 150,
      "lastEarnedAt": "2025-11-03T12:00:00Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

#### Adjust Points Manually

```http
POST /api/merchants/loyalty/adjust-points
Content-Type: application/json

{
  "userId": 123,
  "points": 10,
  "reason": "Birthday bonus points",
  "type": "BONUS"
}
```

**Response**:

```json
{
  "success": true,
  "adjustment": {
    "points": 10,
    "balanceBefore": 40,
    "balanceAfter": 50,
    "reason": "Birthday bonus points"
  },
  "message": "Successfully adjusted points by +10"
}
```

#### Cancel Redemption

```http
POST /api/merchants/loyalty/cancel-redemption
Content-Type: application/json

{
  "redemptionId": 789,
  "reason": "Order was cancelled by customer"
}
```

**Response**:

```json
{
  "success": true,
  "pointsRefunded": 25,
  "balanceBefore": 15,
  "balanceAfter": 40,
  "message": "Redemption cancelled. 25 points refunded."
}
```

#### Get Transactions

```http
GET /api/merchants/loyalty/transactions?limit=50&offset=0&type=EARNED
```

---

## Usage Examples

### Customer Journey Example

#### Step 1: Check Balance Before Purchase

```bash
curl -X GET https://api.example.com/api/loyalty/balance/456 \
  -H "Authorization: Bearer <token>"
```

Response: Current balance is 28 points

#### Step 2: Complete Purchase

Customer orders $27.50 worth of food. System automatically awards points:

```typescript
// Backend automatically calls:
await awardLoyaltyPoints(123, 456, 789, 27.50);
// Awards 11 points: floor(27.50 × 0.4) = 11
```

New balance: 39 points

#### Step 3: Redeem Points on Next Order

Customer decides to redeem 25 points for $5 off:

```bash
curl -X POST https://api.example.com/api/loyalty/validate-redemption \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": 456,
    "points": 25,
    "orderAmount": 20
  }'
```

Validation passes, customer proceeds to checkout with discount applied.

### Merchant Setup Example

#### Step 1: Initialize Program

```bash
curl -X POST https://api.example.com/api/merchants/loyalty/initialize \
  -H "Authorization: Bearer <merchant_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "pointsPerDollar": 0.5,
    "minimumRedemption": 20,
    "redemptionValue": 4.0
  }'
```

Program created with custom configuration:
- More generous: 2.5 points per $5 (0.5 × $5)
- Lower redemption threshold: 20 points
- 20 points = $4 discount

#### Step 2: View Analytics

```bash
curl -X GET https://api.example.com/api/merchants/loyalty/analytics \
  -H "Authorization: Bearer <merchant_token>"
```

#### Step 3: Award Bonus Points

```bash
curl -X POST https://api.example.com/api/merchants/loyalty/adjust-points \
  -H "Authorization: Bearer <merchant_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 123,
    "points": 50,
    "reason": "Valued customer appreciation bonus",
    "type": "BONUS"
  }'
```

---

## Integration Guide

### Integrating with Order System

#### On Order Completion

```typescript
import { awardLoyaltyPoints } from './lib/loyalty';

// After order is marked as completed
async function handleOrderCompletion(order: Order) {
  // 1. Update order status
  await prisma.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.COMPLETED }
  });

  // 2. Award loyalty points
  try {
    const loyaltyResult = await awardLoyaltyPoints(
      order.userId,
      order.merchantId,
      order.id,
      order.finalAmount,
      `Purchase at ${merchantName}`
    );

    // 3. Update order with points earned
    await prisma.order.update({
      where: { id: order.id },
      data: { loyaltyPointsEarned: loyaltyResult.pointsEarned }
    });

    // 4. Notify user
    await sendNotification(order.userId, {
      title: 'Points Earned!',
      message: `You earned ${loyaltyResult.pointsEarned} loyalty points!`
    });
  } catch (error) {
    // Log error but don't fail the order
    console.error('Failed to award loyalty points:', error);
  }
}
```

#### During Checkout

```typescript
import { validateRedemption, redeemLoyaltyPoints } from './lib/loyalty';

async function applyLoyaltyDiscount(
  userId: number,
  merchantId: number,
  pointsToRedeem: number,
  orderSubtotal: number
) {
  // 1. Validate redemption
  const validation = await validateRedemption(
    userId,
    merchantId,
    pointsToRedeem,
    orderSubtotal
  );

  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // 2. Redeem points
  const redemption = await redeemLoyaltyPoints(
    userId,
    merchantId,
    pointsToRedeem
  );

  // 3. Apply discount to order
  return {
    discountAmount: redemption.discountValue,
    finalAmount: orderSubtotal - redemption.discountValue,
    pointsRedeemed: redemption.pointsRedeemed,
    redemptionId: redemption.redemption.id
  };
}
```

#### On Order Cancellation

```typescript
import { cancelRedemption } from './lib/loyalty';

async function handleOrderCancellation(order: Order) {
  // If points were redeemed, refund them
  if (order.loyaltyRedemptionId) {
    await cancelRedemption(
      order.loyaltyRedemptionId,
      'Order cancelled by customer'
    );
  }

  // If points were earned, reverse them
  if (order.loyaltyPointsEarned > 0) {
    // Create manual adjustment to reverse
    await adjustLoyaltyPoints(
      order.userId,
      order.merchantId,
      -order.loyaltyPointsEarned,
      'Points reversed due to order cancellation',
      'REFUNDED'
    );
  }
}
```

### Frontend Integration Examples

#### React Component: Loyalty Balance Display

```typescript
import { useState, useEffect } from 'react';

function LoyaltyBalance({ merchantId }: { merchantId: number }) {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBalance() {
      try {
        const response = await fetch(
          `/api/loyalty/balance/${merchantId}`,
          {
            headers: {
              'Authorization': `Bearer ${getToken()}`
            }
          }
        );
        const data = await response.json();
        setBalance(data.balance);
      } catch (error) {
        console.error('Failed to fetch balance:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchBalance();
  }, [merchantId]);

  if (loading) return <div>Loading...</div>;
  if (!balance) return null;

  return (
    <div className="loyalty-balance">
      <h3>Your Loyalty Points</h3>
      <p className="points">{balance.currentBalance} points</p>
      <p className="merchant">{balance.merchantName}</p>
      {balance.currentBalance >= balance.programConfig.minimumRedemption && (
        <button>Redeem Points</button>
      )}
    </div>
  );
}
```

#### React Component: Redemption Options

```typescript
function RedemptionOptions({ merchantId }: { merchantId: number }) {
  const [options, setOptions] = useState([]);

  useEffect(() => {
    async function fetchOptions() {
      const response = await fetch(
        `/api/loyalty/redemption-options/${merchantId}`,
        {
          headers: {
            'Authorization': `Bearer ${getToken()}`
          }
        }
      );
      const data = await response.json();
      setOptions(data.tiers);
    }

    fetchOptions();
  }, [merchantId]);

  return (
    <div className="redemption-options">
      <h3>Redeem Your Points</h3>
      {options.map(tier => (
        <div 
          key={tier.points} 
          className={`tier ${tier.available ? 'available' : 'locked'}`}
        >
          <div className="points">{tier.points} points</div>
          <div className="value">${tier.value} discount</div>
          {tier.available ? (
            <button onClick={() => handleRedeem(tier.points)}>
              Redeem
            </button>
          ) : (
            <span>Need {tier.pointsNeeded} more points</span>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

## Configuration

### Environment Variables

No additional environment variables required. The system uses the existing database connection.

### Default Configuration Values

```typescript
const DEFAULT_LOYALTY_CONFIG = {
  pointsPerDollar: 0.4,        // 2 points per $5
  minimumPurchase: 0.01,       // Min $0.01 to earn points
  minimumRedemption: 25,       // Min 25 points to redeem
  redemptionValue: 5.0,        // 25 points = $5
  pointExpirationDays: null,   // No expiration by default
  allowCombineWithDeals: true, // Can combine with deals
  earnOnDiscounted: false      // Earn points on original amount
};
```

### Customization Options

Merchants can customize:

1. **Points Per Dollar** (0.1 - 2.0)
   - Lower = slower earning
   - Higher = faster earning, more generous

2. **Minimum Redemption** (10 - 100 points)
   - Lower = easier redemption, faster usage
   - Higher = delayed gratification, builds loyalty

3. **Redemption Value** ($1 - $10)
   - Determines dollar value per redemption unit
   - Should balance with earning rate

4. **Point Expiration** (null or 30-365 days)
   - null = points never expire
   - Set days to encourage usage

5. **Combine with Deals** (true/false)
   - true = points can be used with other discounts
   - false = must choose one or the other

6. **Earn on Discounted** (true/false)
   - true = earn points on final discounted amount
   - false = earn points on original amount (more generous)

---

## Testing

### Manual Testing Checklist

#### User Flow

- [ ] Register new user
- [ ] Complete purchase at merchant with loyalty program
- [ ] Verify points awarded correctly
- [ ] Check balance via API
- [ ] Attempt redemption with insufficient points (should fail)
- [ ] Redeem valid amount of points
- [ ] Verify discount applied
- [ ] Check remaining balance
- [ ] View transaction history

#### Merchant Flow

- [ ] Initialize loyalty program
- [ ] Update program configuration
- [ ] Deactivate program (users can't earn/redeem)
- [ ] Reactivate program
- [ ] View analytics dashboard
- [ ] View customer list
- [ ] Award bonus points to customer
- [ ] Cancel a redemption
- [ ] View transaction history

#### Edge Cases

- [ ] Purchase amount too small to earn points ($0.50)
- [ ] Attempt to redeem with exact minimum (25 points)
- [ ] Attempt to redeem 63 points (should use 50, leave 13)
- [ ] Redemption value exceeds order amount (should fail)
- [ ] Concurrent redemption attempts
- [ ] Order cancellation after points awarded
- [ ] Program deactivated mid-transaction

### Automated Test Examples

```typescript
import { calculateLoyaltyPoints, calculateRedemptionValue } from './lib/loyalty';

describe('Loyalty Points Calculation', () => {
  it('should calculate points correctly', () => {
    const result = calculateLoyaltyPoints(25, 0.4);
    expect(result.pointsEarned).toBe(10);
  });

  it('should round down to whole points', () => {
    const result = calculateLoyaltyPoints(12.75, 0.4);
    expect(result.pointsEarned).toBe(5); // floor(5.1) = 5
  });

  it('should return 0 for amounts too small', () => {
    const result = calculateLoyaltyPoints(1.0, 0.4);
    expect(result.pointsEarned).toBe(0); // floor(0.4) = 0
  });
});

describe('Redemption Calculation', () => {
  it('should calculate redemption correctly', () => {
    const result = calculateRedemptionValue(50, 25, 5);
    expect(result.discountValue).toBe(10);
    expect(result.pointsToRedeem).toBe(50);
    expect(result.remainingPoints).toBe(0);
  });

  it('should handle partial redemption', () => {
    const result = calculateRedemptionValue(63, 25, 5);
    expect(result.discountValue).toBe(10); // 2 units × $5
    expect(result.pointsToRedeem).toBe(50);
    expect(result.remainingPoints).toBe(13);
  });

  it('should reject below minimum', () => {
    const result = calculateRedemptionValue(20, 25, 5);
    expect(result.discountValue).toBe(0);
  });
});
```

---

## Troubleshooting

### Common Issues

#### Issue: "Loyalty program not found"

**Cause**: Merchant hasn't initialized their loyalty program

**Solution**: Merchant must call `POST /api/merchants/loyalty/initialize`

#### Issue: "Insufficient points"

**Cause**: User trying to redeem more points than they have

**Solution**: 
- Check balance: `GET /api/loyalty/balance/:merchantId`
- Redemption must be within available balance

#### Issue: "Minimum 25 points required"

**Cause**: Trying to redeem less than minimum threshold

**Solution**: Must redeem at least `minimumRedemption` points (default: 25)

#### Issue: Points not awarded after purchase

**Possible Causes**:
1. Loyalty program not active
2. Purchase amount below minimum
3. Order status not COMPLETED
4. Integration error in order completion flow

**Debugging Steps**:
```bash
# Check if program is active
GET /api/loyalty/program/:merchantId

# Check user's transaction history
GET /api/loyalty/transactions/:merchantId

# Check order details
GET /api/orders/:orderId
```

#### Issue: "Discount exceeds order amount"

**Cause**: Trying to redeem points worth more than the order

**Solution**: Validate redemption amount before applying:
```typescript
const orderAmount = 8.00;
const pointsToRedeem = 50; // Would give $10 discount

// This will fail
await validateRedemption(userId, merchantId, pointsToRedeem, orderAmount);
```

### Database Troubleshooting

#### Check for orphaned records

```sql
-- Find users with balances but no program
SELECT * FROM "UserMerchantLoyalty" uml
LEFT JOIN "MerchantLoyaltyProgram" mlp ON uml."loyaltyProgramId" = mlp.id
WHERE mlp.id IS NULL;

-- Find transactions with mismatched balances
SELECT * FROM "LoyaltyPointTransaction"
WHERE "balanceAfter" != "balanceBefore" + points;
```

#### Reset user balance (admin only)

```typescript
// Recalculate balance from transactions
const transactions = await prisma.loyaltyPointTransaction.findMany({
  where: { userId, merchantId },
  orderBy: { createdAt: 'asc' }
});

let balance = 0;
for (const tx of transactions) {
  balance += tx.points;
}

// Update balance
await prisma.userMerchantLoyalty.update({
  where: { userId_merchantId: { userId, merchantId } },
  data: { currentBalance: balance }
});
```

### Performance Issues

#### Slow balance queries

**Solution**: Indexes are already in place. Check query execution:
```sql
EXPLAIN ANALYZE 
SELECT * FROM "UserMerchantLoyalty" 
WHERE "userId" = 123 AND "merchantId" = 456;
```

#### High transaction volume

**Solution**: Consider archiving old transactions:
```typescript
// Archive transactions older than 1 year
const oneYearAgo = new Date();
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

await prisma.loyaltyPointTransaction.updateMany({
  where: {
    createdAt: { lt: oneYearAgo }
  },
  data: {
    archived: true
  }
});
```

### Support

For additional support:
- Check API error responses for detailed messages
- Review transaction history for audit trail
- Contact development team with:
  - User ID
  - Merchant ID
  - Timestamp of issue
  - Error messages received

---

## Appendix

### Migration Commands

```bash
# Apply migration
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

# View migration status
npx prisma migrate status
```

### Useful SQL Queries

```sql
-- Total points outstanding by merchant
SELECT 
  m."businessName",
  SUM(uml."currentBalance") as "totalPoints"
FROM "UserMerchantLoyalty" uml
JOIN "Merchant" m ON uml."merchantId" = m.id
GROUP BY m.id, m."businessName"
ORDER BY "totalPoints" DESC;

-- Top 10 customers by points earned
SELECT 
  u.name,
  u.email,
  uml."lifetimeEarned",
  m."businessName"
FROM "UserMerchantLoyalty" uml
JOIN "User" u ON uml."userId" = u.id
JOIN "Merchant" m ON uml."merchantId" = m.id
ORDER BY uml."lifetimeEarned" DESC
LIMIT 10;

-- Recent redemptions
SELECT 
  u.name,
  m."businessName",
  lr."pointsUsed",
  lr."discountValue",
  lr."redeemedAt"
FROM "LoyaltyRedemption" lr
JOIN "User" u ON lr."userId" = u.id
JOIN "Merchant" m ON lr."merchantId" = m.id
WHERE lr.status = 'APPLIED'
ORDER BY lr."redeemedAt" DESC
LIMIT 20;
```

### API Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created (program initialized) |
| 400 | Bad request (validation error) |
| 401 | Unauthorized (not logged in) |
| 403 | Forbidden (not approved merchant) |
| 404 | Not found (program doesn't exist) |
| 409 | Conflict (program already exists) |
| 500 | Internal server error |

---

**Version**: 1.0.0  
**Last Updated**: November 3, 2025  
**Maintained By**: Development Team
