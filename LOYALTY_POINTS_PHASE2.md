# Loyalty Points System - Phase 2: Business Logic Implementation

## ✅ Phase 2 Complete!

All business logic and API endpoints for the loyalty points system have been implemented.

---

## 📁 Files Created

### 1. **Business Logic Layer** (`src/lib/loyalty.ts`)
Complete implementation of all core loyalty functions with ~900 lines of code.

### 2. **User API Routes** (`src/routes/loyalty.routes.ts`)
User-facing endpoints for checking balances, transactions, and redemptions.

### 3. **Merchant API Routes** (`src/routes/loyalty.merchant.routes.ts`)
Merchant-facing endpoints for managing loyalty programs and customers.

---

## 🎯 Core Functions Implemented

### Loyalty Program Management

#### `initializeMerchantLoyaltyProgram(merchantId, config?)`
- Creates a new loyalty program for a merchant
- Uses default configuration or custom settings
- Prevents duplicate programs

#### `getMerchantLoyaltyProgram(merchantId)`
- Retrieves merchant's loyalty program configuration
- Includes merchant details
- Validates program is active

#### `updateMerchantLoyaltyProgram(merchantId, updates)`
- Updates program configuration
- Allows partial updates
- Returns updated program

#### `setLoyaltyProgramStatus(merchantId, isActive)`
- Activates or deactivates a loyalty program
- Controls whether customers can earn/redeem points

---

### Point Calculation

#### `calculateLoyaltyPoints(amount, pointsPerDollar)`
- **Formula**: `floor(amount × pointsPerDollar)`
- **Default**: `floor(amount × 0.4)` = 2 points per $5
- Returns detailed calculation breakdown
- Handles edge cases (negative amounts, zero amounts)

**Example:**
```typescript
calculateLoyaltyPoints(15, 0.4)
// Returns:
{
  orderAmount: 15,
  pointsEarned: 6,  // floor(15 × 0.4) = floor(6) = 6
  pointsPerDollar: 0.4,
  calculation: "floor(15 × 0.4) = 6 points"
}
```

#### `calculateRedemptionValue(pointsToRedeem, minimumRedemption, redemptionValue)`
- **Formula**: `floor(points / 25) × $5`
- **Default**: 25 points = $5 discount
- Calculates actual points used and remaining
- Validates minimum requirements

**Example:**
```typescript
calculateRedemptionValue(63, 25, 5)
// Returns:
{
  pointsToRedeem: 50,      // 2 complete units of 25
  discountValue: 10,       // 2 × $5
  remainingPoints: 13,     // 63 - 50 = 13 left over
  calculation: "2 × $5 = $10 (50 points used, 13 remaining)"
}
```

---

### User Balance Management

#### `getUserLoyaltyBalance(userId, merchantId)`
- Gets or creates user's loyalty balance for a merchant
- Returns current balance, lifetime stats, and program config
- Automatically initializes new balances as needed

#### `getAllUserLoyaltyBalances(userId)`
- Gets all loyalty balances across all merchants
- Sorted by current balance (highest first)
- Includes merchant details and program configs

---

### Point Earning

#### `awardLoyaltyPoints(userId, merchantId, orderId, amount, description?)`
- Awards points for a completed purchase
- Validates minimum purchase requirement
- Creates transaction record with audit trail
- Updates user balance atomically
- Returns complete award details

**Workflow:**
1. Get loyalty program configuration
2. Validate minimum purchase amount
3. Calculate points earned
4. Create or get user's loyalty balance
5. **Use database transaction** to:
   - Update user balance
   - Create transaction record
   - Link to order
6. Return award details

**Example:**
```typescript
await awardLoyaltyPoints(123, 456, 789, 25.50)
// Awards 10 points for $25.50 purchase
// Creates audit trail
// Updates balance atomically
```

---

### Point Redemption

#### `validateRedemption(userId, merchantId, pointsToRedeem, orderAmount?)`
- Validates if redemption is allowed
- Checks user has sufficient points
- Checks minimum redemption requirement
- Optionally validates discount doesn't exceed order amount
- Returns validation result with error messages

**Validation Checks:**
1. ✅ Loyalty program exists and is active
2. ✅ User has sufficient points
3. ✅ Points meet minimum redemption (default: 25)
4. ✅ Discount value doesn't exceed order amount
5. ✅ Returns detailed error messages if invalid

#### `redeemLoyaltyPoints(userId, merchantId, pointsToRedeem, orderId?, orderAmount?)`
- Redeems points for a discount
- Validates redemption first
- Calculates actual discount value
- Creates redemption record
- Deducts points from balance
- All in a single database transaction

**Workflow:**
1. Validate redemption is allowed
2. Calculate actual points to use and discount
3. **Use database transaction** to:
   - Update user balance (subtract points)
   - Create redemption record
   - Create transaction record
   - Link to order (if provided)
4. Return redemption details

**Example:**
```typescript
await redeemLoyaltyPoints(123, 456, 50)
// Redeems 50 points for $10 discount
// Status: PENDING if no orderId, APPLIED if orderId provided
```

#### `cancelRedemption(redemptionId, reason)`
- Cancels a redemption and refunds points
- Updates redemption status to CANCELLED
- Adds points back to user balance
- Creates refund transaction record
- All atomic in database transaction

---

### Transaction History

#### `getUserLoyaltyTransactions(userId, merchantId, limit, offset)`
- Gets user's transaction history with pagination
- Includes related orders and redemptions
- Sorted by most recent first
- Returns total count and hasMore flag

---

### Analytics

#### `getMerchantLoyaltyAnalytics(merchantId)`
- Comprehensive loyalty program statistics
- User counts (total, active, inactive %)
- Points issued, redeemed, and outstanding
- Total discount value given
- Average discount per redemption
- Recent redemptions with user details

**Returns:**
```typescript
{
  program: { /* config */ },
  users: {
    total: 150,
    active: 98,
    inactivePercent: "34.67"
  },
  points: {
    issued: 15000,
    redeemed: 5000,
    outstanding: 10000
  },
  discounts: {
    totalValue: 1000,
    averagePerRedemption: 10
  },
  recentRedemptions: [/* last 10 */]
}
```

---

## 🌐 API Endpoints

### User Endpoints (`/api/loyalty`)

All user endpoints require authentication (`protect` middleware).

#### **GET /api/loyalty/balance/:merchantId**
Get loyalty points balance for a specific merchant.

**Response:**
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
    "tier": null,
    "merchantName": "Joe's Pizza",
    "programConfig": {
      "pointsPerDollar": 0.4,
      "minimumPurchase": 0.01,
      "minimumRedemption": 25,
      "redemptionValue": 5.0
    }
  }
}
```

#### **GET /api/loyalty/balances**
Get all loyalty balances across all merchants.

**Response:**
```json
{
  "success": true,
  "balances": [
    {
      "currentBalance": 50,
      "merchantName": "Restaurant A",
      "merchantLogo": "...",
      ...
    }
  ],
  "total": 5,
  "totalPoints": 150
}
```

#### **POST /api/loyalty/calculate-points**
Calculate points for a purchase amount.

**Request:**
```json
{
  "merchantId": 456,
  "amount": 25.50
}
```

**Response:**
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

#### **POST /api/loyalty/calculate-redemption**
Calculate discount value for points.

**Request:**
```json
{
  "merchantId": 456,
  "points": 50
}
```

**Response:**
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

#### **GET /api/loyalty/redemption-options/:merchantId**
Get available redemption tiers.

**Response:**
```json
{
  "success": true,
  "currentBalance": 63,
  "merchantName": "Joe's Pizza",
  "tiers": [
    { "points": 25, "value": 5, "available": true, "pointsNeeded": 0 },
    { "points": 50, "value": 10, "available": true, "pointsNeeded": 0 },
    { "points": 75, "value": 15, "available": false, "pointsNeeded": 12 }
  ]
}
```

#### **POST /api/loyalty/validate-redemption**
Validate if redemption is possible.

**Request:**
```json
{
  "merchantId": 456,
  "points": 25,
  "orderAmount": 30
}
```

**Response:**
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

#### **GET /api/loyalty/transactions/:merchantId**
Get transaction history.

**Query Parameters:**
- `limit` (default: 50, max: 100)
- `offset` (default: 0)

**Response:**
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
      "order": { ... }
    }
  ],
  "total": 25,
  "hasMore": false
}
```

#### **GET /api/loyalty/program/:merchantId**
Get loyalty program information (public).

**Response:**
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

---

### Merchant Endpoints (`/api/merchants/loyalty`)

All merchant endpoints require authentication (`protect`) and approved merchant status (`isApprovedMerchant`).

#### **POST /api/merchants/loyalty/initialize**
Initialize loyalty program.

**Request:**
```json
{
  "pointsPerDollar": 0.4,
  "minimumRedemption": 25,
  "redemptionValue": 5.0,
  "allowCombineWithDeals": true
}
```

#### **GET /api/merchants/loyalty/program**
Get loyalty program configuration.

#### **PUT /api/merchants/loyalty/program**
Update loyalty program settings.

#### **PATCH /api/merchants/loyalty/status**
Activate/deactivate program.

**Request:**
```json
{
  "isActive": true
}
```

#### **GET /api/merchants/loyalty/analytics**
Get program analytics and statistics.

#### **GET /api/merchants/loyalty/customers**
Get customer list with balances.

**Query Parameters:**
- `limit` (default: 50, max: 100)
- `offset` (default: 0)
- `sortBy` (currentBalance, lifetimeEarned, lastEarnedAt)
- `order` (asc, desc)

#### **POST /api/merchants/loyalty/adjust-points**
Manual point adjustment (bonus, correction, etc).

**Request:**
```json
{
  "userId": 123,
  "points": 10,
  "reason": "Birthday bonus points",
  "type": "BONUS"
}
```

#### **POST /api/merchants/loyalty/cancel-redemption**
Cancel redemption and refund points.

**Request:**
```json
{
  "redemptionId": 789,
  "reason": "Order was cancelled"
}
```

#### **GET /api/merchants/loyalty/transactions**
Get recent transactions.

**Query Parameters:**
- `limit`, `offset`
- `type` (filter by transaction type)

---

## 🔒 Security & Validation

### Input Validation
- All endpoints use Zod schemas for request validation
- Type-safe inputs with clear error messages
- Range validation (limits, amounts, etc.)

### Authorization
- User endpoints: `protect` middleware (JWT authentication)
- Merchant endpoints: `protect` + `isApprovedMerchant`
- Redemption cancellation: Validates merchant owns the redemption

### Data Integrity
- All point operations use database transactions
- Atomic balance updates
- Complete audit trail
- Prevents negative balances
- Validates minimum requirements

---

## 🎨 Key Features

### ✅ Implemented

1. **Per-Merchant Balances** - Separate points for each merchant
2. **Automatic Point Calculation** - Based on configurable rates
3. **Flexible Redemption** - Multi-tier redemption options
4. **Complete Audit Trail** - Every transaction logged
5. **Balance Validation** - Prevents invalid operations
6. **Transaction Atomicity** - Database transactions ensure consistency
7. **Merchant Configuration** - Full control over program settings
8. **Analytics Dashboard** - Comprehensive statistics
9. **Manual Adjustments** - Merchant can award/adjust points
10. **Redemption Lifecycle** - PENDING → APPLIED → CANCELLED states
11. **Pagination Support** - For transactions and customer lists
12. **Error Handling** - Detailed error messages and proper HTTP codes

---

## 💡 Usage Examples

### User Flow: Earning Points

```typescript
// 1. User completes $15 order
const order = { amount: 15, merchantId: 456 };

// 2. Award points automatically
const award = await awardLoyaltyPoints(
  123,           // userId
  456,           // merchantId  
  789,           // orderId
  15             // amount
);

// Result: User earns 6 points (floor(15 × 0.4) = 6)
```

### User Flow: Redeeming Points

```typescript
// 1. Check balance
const balance = await getUserLoyaltyBalance(123, 456);
// balance.currentBalance = 28

// 2. Validate redemption
const validation = await validateRedemption(123, 456, 25, 30);
// validation.valid = true
// validation.discountValue = 5

// 3. Redeem points
const redemption = await redeemLoyaltyPoints(123, 456, 25);
// Redeems 25 points for $5 discount
// Remaining balance: 3 points
```

### Merchant Flow: Configure Program

```typescript
// 1. Initialize program
await initializeMerchantLoyaltyProgram(456, {
  pointsPerDollar: 0.5,      // More generous: 2.5 pts per $5
  minimumRedemption: 20,     // Lower barrier
  redemptionValue: 4.0       // 20 pts = $4
});

// 2. Award bonus points
await awardLoyaltyPoints(123, 456, null, 0, "Birthday bonus +10 points");

// 3. View analytics
const analytics = await getMerchantLoyaltyAnalytics(456);
```

---

## 🔄 Integration Points

### Order/Payment System
```typescript
// After order completion:
if (order.status === 'COMPLETED') {
  await awardLoyaltyPoints(
    order.userId,
    order.merchantId,
    order.id,
    order.finalAmount
  );
}
```

### Checkout Process
```typescript
// During checkout:
const validation = await validateRedemption(
  userId,
  merchantId,
  pointsToRedeem,
  orderSubtotal
);

if (validation.valid) {
  const redemption = await redeemLoyaltyPoints(
    userId,
    merchantId,
    pointsToRedeem,
    orderId
  );
  
  // Apply discount to order
  order.loyaltyDiscount = redemption.discountValue;
  order.finalAmount -= redemption.discountValue;
}
```

---

## 📊 Database Operations

### Transactions Used
All critical operations use Prisma transactions:

1. **Award Points**: Update balance + Create transaction
2. **Redeem Points**: Update balance + Create redemption + Create transaction
3. **Cancel Redemption**: Update balance + Update redemption + Create refund transaction
4. **Manual Adjustment**: Update balance + Create transaction

### Performance Optimization
- Strategic indexes on frequently queried fields
- Pagination for large result sets
- Efficient queries with proper includes
- Atomic operations prevent race conditions

---

## ✅ Phase 2 Checklist

- [x] Business logic layer (`loyalty.ts`)
- [x] User API routes (`loyalty.routes.ts`)
- [x] Merchant API routes (`loyalty.merchant.routes.ts`)
- [x] Routes registered in `app.ts`
- [x] Prisma client generated
- [x] Point calculation functions
- [x] Point earning functions
- [x] Point redemption functions
- [x] Balance management
- [x] Transaction history
- [x] Analytics functions
- [x] Input validation (Zod schemas)
- [x] Error handling
- [x] Authorization checks
- [x] Database transactions
- [x] Documentation

---

## 🚀 Next Steps (Phase 3)

**Testing & Integration:**
1. Create test suite for loyalty functions
2. Integration tests for API endpoints
3. Test edge cases and error scenarios
4. Create order/payment integration
5. Build frontend components
6. User documentation and guides

---

**Status:** Phase 2 Complete ✅  
**Files Created:** 3 (loyalty.ts, loyalty.routes.ts, loyalty.merchant.routes.ts)  
**Lines of Code:** ~1,500 lines  
**API Endpoints:** 17 endpoints (8 user, 9 merchant)  
**Date:** November 3, 2025
