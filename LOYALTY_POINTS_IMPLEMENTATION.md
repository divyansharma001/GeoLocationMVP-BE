# Loyalty Points System Implementation

## 🎯 Overview

A comprehensive merchant-specific loyalty points system where users earn points for purchases and can redeem them for discounts.

**Core Formula:**
- **Earning**: $5 spent = 2 loyalty points (0.4 points per dollar)
- **Redemption**: 25 points = $5 discount minimum

---

## ✅ Phase 1: Database Schema - COMPLETED

### New Database Models

#### 1. **MerchantLoyaltyProgram**
Configuration for each merchant's loyalty program.

**Fields:**
- `merchantId` - Links to merchant (1-to-1)
- `isActive` - Program enabled/disabled
- `pointsPerDollar` - Default: 0.4 (2 points per $5)
- `minimumPurchase` - Min purchase to earn points (default $0.01)
- `minimumRedemption` - Min points to redeem (default 25)
- `redemptionValue` - Dollar value for min redemption (default $5)
- `pointExpirationDays` - Optional expiration policy
- `allowCombineWithDeals` - Can use with other deals?
- `earnOnDiscounted` - Earn on discounted or original amount?

#### 2. **UserMerchantLoyalty**
Tracks each user's loyalty point balance per merchant.

**Fields:**
- `userId` - User reference
- `merchantId` - Merchant reference
- `loyaltyProgramId` - Program configuration reference
- `currentBalance` - Available points now
- `lifetimeEarned` - Total points ever earned
- `lifetimeRedeemed` - Total points ever redeemed
- `lastEarnedAt` - Last earning date
- `lastRedeemedAt` - Last redemption date
- `tier` - Optional tier level (Bronze, Silver, Gold, etc.)

**Indexes:**
- Unique constraint on (userId, merchantId)
- Performance indexes on balance lookups

#### 3. **LoyaltyPointTransaction**
Complete audit trail of all loyalty point activities.

**Fields:**
- `userId`, `merchantId`, `loyaltyProgramId`, `userLoyaltyId`
- `type` - EARNED, REDEEMED, EXPIRED, ADJUSTED, BONUS, REFUNDED
- `points` - Amount of points (positive or negative)
- `balanceBefore` - Balance before transaction
- `balanceAfter` - Balance after transaction
- `description` - Human-readable description
- `metadata` - JSON for additional context
- `relatedOrderId` - Link to order if applicable
- `relatedRedemptionId` - Link to redemption if applicable

**Indexes:**
- Time-based queries (userId, merchantId, createdAt)
- Transaction type filtering
- Order correlation

#### 4. **LoyaltyRedemption**
Tracks redemption events and their lifecycle.

**Fields:**
- `userId`, `merchantId`, `loyaltyProgramId`, `userLoyaltyId`
- `pointsUsed` - Number of points redeemed
- `discountValue` - Dollar amount of discount
- `orderId` - Related order (optional)
- `status` - PENDING, APPLIED, CANCELLED, EXPIRED
- `redeemedAt` - When redemption was initiated
- `appliedAt` - When discount was actually used
- `cancelledAt` - If cancelled, when
- `cancellationReason` - Why it was cancelled
- `metadata` - Additional context

**Relationships:**
- One-to-many with Order (multiple redemptions per order possible)
- One-to-many with LoyaltyPointTransaction (tracks point deductions)

#### 5. **Order**
New model to track purchases and loyalty point activities.

**Fields:**
- `orderNumber` - Unique identifier (UUID or custom format)
- `userId`, `merchantId`, `loyaltyProgramId`
- `subtotal` - Original amount before discounts
- `discountAmount` - Total discounts applied
- `loyaltyDiscount` - Specific discount from loyalty
- `finalAmount` - Amount after all discounts
- `loyaltyPointsEarned` - Points earned from this order
- `loyaltyPointsRedeemed` - Points used for this order
- `status` - PENDING, CONFIRMED, PREPARING, READY, COMPLETED, CANCELLED, REFUNDED
- `orderItems` - JSON array of items
- `paymentMethod`, `paymentTransactionId`
- `notes`, `metadata`
- `completedAt`, `cancelledAt`

**Relationships:**
- Many-to-one with User, Merchant, LoyaltyProgram
- One-to-many with LoyaltyRedemption
- One-to-many with LoyaltyPointTransaction

---

### New Enums

#### **LoyaltyTransactionType**
```prisma
enum LoyaltyTransactionType {
  EARNED       // Points earned from purchase
  REDEEMED     // Points used for discount
  EXPIRED      // Points expired
  ADJUSTED     // Manual adjustment (refund, correction)
  BONUS        // Bonus points (promotions, events)
  REFUNDED     // Points returned (order cancelled)
}
```

#### **LoyaltyRedemptionStatus**
```prisma
enum LoyaltyRedemptionStatus {
  PENDING      // Redemption created but not yet applied
  APPLIED      // Discount has been applied to order
  CANCELLED    // Redemption was cancelled
  EXPIRED      // Redemption expired (not used in time)
}
```

#### **OrderStatus**
```prisma
enum OrderStatus {
  PENDING      // Order created
  CONFIRMED    // Payment confirmed
  PREPARING    // Being prepared
  READY        // Ready for pickup/delivery
  COMPLETED    // Successfully completed
  CANCELLED    // Cancelled by user/merchant
  REFUNDED     // Refunded after completion
}
```

---

### Updated Models

#### **User Model**
Added relations:
```prisma
loyaltyBalances    UserMerchantLoyalty[]      // Points per merchant
loyaltyTransactions LoyaltyPointTransaction[]  // Transaction history
loyaltyRedemptions  LoyaltyRedemption[]        // Redemption history
orders              Order[]                     // Order history
```

#### **Merchant Model**
Added relations:
```prisma
loyaltyProgram       MerchantLoyaltyProgram?        // 1-to-1 program config
userLoyaltyBalances  UserMerchantLoyalty[]          // All user balances
loyaltyTransactions  LoyaltyPointTransaction[]      // All transactions
loyaltyRedemptions   LoyaltyRedemption[]            // All redemptions
orders               Order[]                         // All orders
```

---

## 📊 Database Indexes

Performance-optimized indexes created:

### MerchantLoyaltyProgram
- `(merchantId, isActive)` - Active program lookup
- `(isActive)` - All active programs

### UserMerchantLoyalty
- `UNIQUE (userId, merchantId)` - Prevent duplicates
- `(userId)` - User's all balances
- `(merchantId)` - Merchant's all users
- `(currentBalance)` - High-balance queries
- `(userId, merchantId, currentBalance)` - Combined queries

### LoyaltyPointTransaction
- `(userId, createdAt)` - User transaction history
- `(merchantId, createdAt)` - Merchant transaction history
- `(type)` - Filter by transaction type
- `(createdAt)` - Time-based queries
- `(userId, merchantId, createdAt)` - Combined history

### LoyaltyRedemption
- `(userId, status)` - User's pending/active redemptions
- `(merchantId, status)` - Merchant's redemption tracking
- `(status)` - Global status filtering
- `(redeemedAt)` - Time-based analysis
- `(userId, merchantId, redeemedAt)` - Combined queries

### Order
- `(userId)` - User order history
- `(merchantId)` - Merchant order history
- `(status)` - Order status filtering
- `(createdAt)` - Time-based queries
- `(userId, merchantId, createdAt)` - Combined history
- `UNIQUE (orderNumber)` - Unique order identification

---

## 🗄️ Migration Details

**Migration Name:** `20251103124652_add_loyalty_points_system`

**Migration File Location:**
```
prisma/migrations/20251103124652_add_loyalty_points_system/migration.sql
```

**Applied:** ✅ Successfully applied to database

**Prisma Client:** Generated with new models

---

## 🔄 Data Relationships

```
User ←→ UserMerchantLoyalty ←→ Merchant
                ↓
        MerchantLoyaltyProgram
                ↓
    LoyaltyPointTransaction
                ↓
        LoyaltyRedemption ←→ Order
```

**Key Points:**
1. Each user can have loyalty balances with multiple merchants
2. Each merchant has ONE loyalty program configuration
3. All point changes are tracked in transactions (audit trail)
4. Redemptions link to transactions and optionally to orders
5. Orders track both points earned and points redeemed

---

## 📝 Example Data Flow

### Earning Points
```
1. User completes $15 order at Restaurant A
2. System calculates: floor(15 / 5) * 2 = 4 points
3. Creates Order record (status: COMPLETED)
4. Creates LoyaltyPointTransaction (type: EARNED, points: +4)
5. Updates UserMerchantLoyalty (currentBalance += 4, lifetimeEarned += 4)
```

### Redeeming Points
```
1. User has 28 points at Restaurant A
2. User redeems 25 points for $5 discount
3. Creates LoyaltyRedemption (pointsUsed: 25, discountValue: 5.00, status: PENDING)
4. Creates LoyaltyPointTransaction (type: REDEEMED, points: -25)
5. Updates UserMerchantLoyalty (currentBalance -= 25, lifetimeRedeemed += 25)
6. User places $30 order
7. Order created with loyaltyDiscount: 5.00, finalAmount: 25.00
8. Updates LoyaltyRedemption (status: APPLIED, appliedAt: NOW)
```

---

## ✅ What's Been Completed

- [x] Database schema design
- [x] Prisma models created
- [x] Relations defined
- [x] Indexes optimized
- [x] Enums added
- [x] Migration created and applied
- [x] Prisma client generated

---

## 🚀 Next Steps (Phase 2)

**Business Logic Layer:**
1. Create `src/lib/loyalty.ts` - Core loyalty functions
2. Implement point calculation logic
3. Implement earning/redemption functions
4. Add validation rules
5. Create helper utilities

**Functions to Build:**
- `calculateLoyaltyPointsForPurchase(amount, merchantId)`
- `awardLoyaltyPoints(userId, merchantId, orderId, amount)`
- `calculateRedemptionValue(points)`
- `redeemLoyaltyPoints(userId, merchantId, points)`
- `getUserLoyaltyBalance(userId, merchantId)`
- `validateRedemption(userId, merchantId, points, orderAmount)`
- `getMerchantLoyaltyProgram(merchantId)`
- `initializeMerchantLoyaltyProgram(merchantId, config?)`

---

## 💡 Design Decisions

1. **Per-Merchant Balances**: Users have separate point balances for each merchant (not a global pool)
2. **Flexible Configuration**: Each merchant can customize their loyalty program
3. **Complete Audit Trail**: Every point transaction is logged with before/after balances
4. **Redemption Lifecycle**: Redemptions have states (PENDING → APPLIED) for better tracking
5. **Order Integration**: Orders are central to both earning and redemption
6. **Performance First**: Extensive indexing for fast queries
7. **JSON Flexibility**: Metadata fields allow for future expansion without schema changes
8. **Cascade Deletes**: Proper cleanup when users/merchants are deleted

---

## 🔧 Technical Notes

- All monetary values use `Float` type (consider `Decimal` for production)
- All dates use `DateTime` with automatic timezone handling
- JSON fields allow for flexible data storage
- Unique constraints prevent duplicate balances
- Foreign keys ensure referential integrity
- Cascade deletes maintain data consistency

---

**Status:** Phase 1 Complete ✅  
**Date:** November 3, 2025  
**Next Phase:** Business Logic Layer
