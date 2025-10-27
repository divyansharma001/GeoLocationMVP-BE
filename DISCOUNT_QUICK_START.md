# Quick Start: Using the Deal Discount System

## Overview

You can now apply discounts in **TWO ways** when creating deals:

1. **Global Discount** → Applied to ALL menu items
2. **Item-Specific Discount** → Applied to individual items

## Basic Usage

### 1. Global Discount (20% off everything)

```bash
curl -X POST http://localhost:3000/api/deals \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Happy Hour - 20% Off All Drinks",
    "description": "Join us for happy hour!",
    "activeDateRange": {
      "startDate": "2025-10-28T17:00:00Z",
      "endDate": "2025-12-31T19:00:00Z"
    },
    "category": "FOOD_AND_BEVERAGE",
    "discountPercentage": 20,
    "menuItems": [
      { "id": 1 },
      { "id": 2 },
      { "id": 3 }
    ],
    "redemptionInstructions": "Show this deal at checkout"
  }'
```

**Result:** All 3 items get 20% off ✅

---

### 2. Item-Specific Discounts

```bash
curl -X POST http://localhost:3000/api/deals \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Featured Specials",
    "description": "Special pricing on select items",
    "activeDateRange": {
      "startDate": "2025-10-28T00:00:00Z",
      "endDate": "2025-12-31T23:59:59Z"
    },
    "category": "FOOD_AND_BEVERAGE",
    "menuItems": [
      { "id": 1, "customDiscount": 50 },
      { "id": 2, "customPrice": 5.99 },
      { "id": 3, "discountAmount": 2.00 }
    ],
    "redemptionInstructions": "Show this deal at checkout"
  }'
```

**Result:**
- Item 1: 50% off its regular price ✅
- Item 2: Fixed at $5.99 ✅
- Item 3: $2.00 off its regular price ✅

---

### 3. Mixed Discounts (Recommended!)

```bash
curl -X POST http://localhost:3000/api/deals \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Weekend Special",
    "description": "15% off everything, 50% off featured items",
    "activeDateRange": {
      "startDate": "2025-10-28T00:00:00Z",
      "endDate": "2025-12-31T23:59:59Z"
    },
    "category": "FOOD_AND_BEVERAGE",
    "discountPercentage": 15,
    "menuItems": [
      { "id": 1 },
      { "id": 2 },
      { "id": 3, "customDiscount": 50 },
      { "id": 4, "customDiscount": 50 }
    ],
    "redemptionInstructions": "Show this deal at checkout"
  }'
```

**Result:**
- Items 1 & 2: Get 15% off (global) ✅
- Items 3 & 4: Get 50% off (item-specific) ✅

---

## Field Reference

### Deal-Level Discount Fields

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `discountPercentage` | number | 0-100 | Percentage off ALL items |
| `discountAmount` | number | ≥ 0 | Fixed dollar amount off |

### Item-Level Discount Fields (in `menuItems` array)

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `id` | number | - | Menu item ID (required) |
| `customPrice` | number | ≥ 0 | Override base price |
| `customDiscount` | number | 0-100 | Percentage off THIS item |
| `discountAmount` | number | ≥ 0 | Fixed amount off THIS item |
| `isHidden` | boolean | - | Hide item in deal UI |

## Common Scenarios

### Scenario 1: Simple Happy Hour
**Goal:** 25% off all drinks from 5-7 PM

```json
{
  "discountPercentage": 25,
  "menuItems": [
    { "id": 1 },  // Beer
    { "id": 2 },  // Wine
    { "id": 3 }   // Cocktail
  ]
}
```

---

### Scenario 2: Loss Leader Strategy
**Goal:** Aggressive discount on 1-2 items to drive traffic

```json
{
  "discountPercentage": 10,
  "menuItems": [
    { "id": 1, "customDiscount": 75 },  // 75% off featured item!
    { "id": 2 },                        // 10% off
    { "id": 3 }                         // 10% off
  ]
}
```

---

### Scenario 3: Combo Pricing
**Goal:** Fixed price combo meal

```json
{
  "menuItems": [
    { "id": 1, "customPrice": 4.99 },  // Burger
    { "id": 2, "customPrice": 1.99 },  // Fries
    { "id": 3, "customPrice": 1.99 }   // Drink
  ]
}
// Total: $8.97 combo
```

---

### Scenario 4: Secret Menu Items
**Goal:** Hidden items with special pricing

```json
{
  "discountPercentage": 15,
  "menuItems": [
    { "id": 1 },                                    // Visible, 15% off
    { "id": 2 },                                    // Visible, 15% off
    { "id": 3, "customDiscount": 50, "isHidden": true }  // Hidden, 50% off
  ]
}
```

---

## Validation Rules

✅ **Valid Configurations:**
- Global discount only
- Item-specific discounts only
- Mix of both
- No discount (just menu listing)

❌ **Will Be Rejected:**
- `discountPercentage` < 0 or > 100
- `discountAmount` < 0
- `customPrice` < 0
- `customDiscount` < 0 or > 100

## How It Works

### Priority Order (when calculating final price):

1. **Custom Price** (if set) → Use this exact price
2. **Item-Specific Discount** (if set) → Apply custom discount/amount
3. **Global Discount** (if set) → Apply deal's discount
4. **No Discount** → Use regular menu price

### Auto-Assignment Logic:

```javascript
// System automatically sets useGlobalDiscount:
useGlobalDiscount = !(customPrice || customDiscount || discountAmount)

// Examples:
{ "id": 1 }                           // useGlobalDiscount: true
{ "id": 2, "customDiscount": 50 }     // useGlobalDiscount: false
{ "id": 3, "customPrice": 5.99 }      // useGlobalDiscount: false
```

## Response Format

```json
{
  "success": true,
  "message": "Deal created successfully with enhanced features",
  "deal": {
    "id": 123,
    "title": "Happy Hour Special",
    "description": "Best deals in town",
    "discountPercentage": 20,
    "discountAmount": null,
    "startTime": "2025-10-28T17:00:00.000Z",
    "endTime": "2025-12-31T19:00:00.000Z",
    "imageUrls": [],
    "offerTerms": null,
    "kickbackEnabled": false,
    "createdAt": "2025-10-27T16:20:00.000Z",
    "updatedAt": "2025-10-27T16:20:00.000Z"
  },
  "normalization": {
    "dealTypeId": 2,
    "recurringDays": null
  }
}
```

## Frontend Display Logic

### Calculate Final Price:

```typescript
function calculateDisplayPrice(
  basePrice: number,
  dealMenuItem: DealMenuItem,
  deal: Deal
): number {
  // 1. Custom price (highest priority)
  if (dealMenuItem.customPrice) return dealMenuItem.customPrice;
  
  // 2. Item-specific discount
  if (!dealMenuItem.useGlobalDiscount) {
    if (dealMenuItem.customDiscount) {
      return basePrice * (1 - dealMenuItem.customDiscount / 100);
    }
    if (dealMenuItem.discountAmount) {
      return Math.max(0, basePrice - dealMenuItem.discountAmount);
    }
  }
  
  // 3. Global discount
  if (deal.discountPercentage) {
    return basePrice * (1 - deal.discountPercentage / 100);
  }
  if (deal.discountAmount) {
    return Math.max(0, basePrice - deal.discountAmount);
  }
  
  // 4. No discount
  return basePrice;
}
```

### Display Discount Badge:

```typescript
function getDiscountBadge(
  dealMenuItem: DealMenuItem,
  deal: Deal
): string {
  if (dealMenuItem.customPrice) {
    return `$${dealMenuItem.customPrice.toFixed(2)}`;
  }
  
  if (!dealMenuItem.useGlobalDiscount) {
    if (dealMenuItem.customDiscount) {
      return `${dealMenuItem.customDiscount}% OFF`;
    }
    if (dealMenuItem.discountAmount) {
      return `Save $${dealMenuItem.discountAmount}`;
    }
  }
  
  if (deal.discountPercentage) {
    return `${deal.discountPercentage}% OFF`;
  }
  if (deal.discountAmount) {
    return `$${deal.discountAmount} OFF`;
  }
  
  return '';
}
```

## Testing

### Test Your Deal:

```bash
# 1. Create a deal with mixed discounts
curl -X POST http://localhost:3000/api/deals \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d @your-deal.json

# 2. Run the test script
npx ts-node scripts/test-deal-discounts.ts
```

### Expected Output:

```
🧪 Testing Deal Discount System
================================================================================

📋 Testing Deal: "Happy Hour Special"
   Deal ID: 123
   Global Discount: 20%

--------------------------------------------------------------------------------

📊 Menu Items Pricing:

1. Beer
   Original Price:  $8.00
   Final Price:     $6.40
   You Save:        $1.60 (20.0%)
   Discount Type:   20% OFF (Global)
   Uses Global:     Yes

2. Premium Cocktail
   Original Price:  $12.00
   Final Price:     $6.00
   You Save:        $6.00 (50.0%)
   Discount Type:   50% OFF (Item Specific)
   Uses Global:     No

--------------------------------------------------------------------------------

💰 Total Savings Summary:
   Total Original:  $20.00
   Total Final:     $12.40
   Total Savings:   $7.60 (38.0%)

================================================================================

✅ Discount system test completed successfully!
```

## Documentation

- **Full Documentation:** `docs/deal-discount-system.md`
- **Implementation Summary:** `DEAL_DISCOUNT_IMPLEMENTATION.md`
- **API Docs:** `API_DOCUMENTATION.md`

## Need Help?

If Prisma client regeneration fails, see: `PRISMA_GENERATE_FIX.md`

---

**🎉 You're all set! Start creating powerful, flexible deals with fine-grained discount control!**
