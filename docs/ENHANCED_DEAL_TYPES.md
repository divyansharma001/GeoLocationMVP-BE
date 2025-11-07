# Enhanced Deal Types - Implementation Complete

## Overview

The system now supports **6 different deal types**, each with specific business logic and requirements:

1. **Standard Deal** - Regular promotions
2. **Happy Hour** - Time-based deals from Happy Hour menu only
3. **Bounty Deal** - Cash back rewards for bringing friends (QR verification)
4. **Hidden Deal** - Secret VIP deals with access codes
5. **Redeem Now** - Flash sales with customizable discounts
6. **Recurring Deal** - Weekly deals on specific days

---

## Deal Type Details

### 1. Standard Deal 🏷️

**Purpose:** Regular one-time promotional deals

**Requirements:**
- Start and end date
- At least one menu item
- Optional discount (percentage or fixed amount)

**Example:**
```json
{
  "title": "Spring Sale",
  "dealType": "Standard",
  "discountPercentage": 20,
  "startTime": "2025-03-01T00:00:00Z",
  "endTime": "2025-03-31T23:59:59Z",
  "menuItems": [{ "id": 1 }, { "id": 2 }]
}
```

---

### 2. Happy Hour Deal 🕐

**Purpose:** Time-based specials using only Happy Hour menu items

**Requirements:**
- All selected menu items MUST have `isHappyHour = true`
- Time range (typically 2-4 hours)
- At least one discount

**Validation:**
- Backend validates that ALL items are from Happy Hour menu
- Returns error if non-Happy Hour items are included

**Example:**
```json
{
  "title": "Happy Hour - All Drinks",
  "dealType": "Happy Hour",
  "discountPercentage": 30,
  "startTime": "2025-11-07T17:00:00Z",
  "endTime": "2025-12-31T19:00:00Z",
  "menuItems": [{ "id": 5 }, { "id": 6 }]  // Must be Happy Hour items
}
```

**Response includes:**
```json
{
  "success": true,
  "message": "Happy Hour created successfully",
  "deal": { /* deal data */ }
}
```

---

### 3. Bounty Deal 🏆

**Purpose:** Reward customers with cash back when they bring friends

**Requirements:**
- `bountyRewardAmount` - Cash back amount per referral (required)
- `minReferralsRequired` - Minimum friends to bring (required)
- QR code auto-generated for verification

**Auto-enabled:**
- `kickbackEnabled = true`

**Example:**
```json
{
  "title": "Bring Your Friends - Earn Cash!",
  "dealType": "Bounty Deal",
  "bountyRewardAmount": 10.00,  // $10 per friend
  "minReferralsRequired": 2,     // Must bring at least 2 friends
  "discountPercentage": 15,
  "menuItems": [{ "id": 1 }, { "id": 2 }]
}
```

**Response includes:**
```json
{
  "success": true,
  "message": "Bounty Deal created successfully",
  "deal": { /* deal data */ },
  "bounty": {
    "rewardAmount": 10,
    "minReferrals": 2,
    "qrCode": "BOUNTY:123:456:1699999999:abc12345"
  }
}
```

**Redemption:**
- Customers scan QR code at merchant location
- Merchant verifies number of friends brought
- System creates `KickbackEvent` with cash back amount
- Cash back = `bountyRewardAmount × actualReferralCount`

---

### 4. Hidden Deal 🔒

**Purpose:** Secret VIP deals accessible only via code/link/QR

**Requirements:**
- `accessCode` - Auto-generated (e.g., "VIP-A7F2") or custom
- All menu items forced to `isHidden = true`
- Optional bounty rewards

**Access Methods:**
1. **Access Code:** Users enter code in app
2. **Direct Link:** `https://yohop.com/deals/hidden/VIP-A7F2`
3. **QR Code:** Scan QR to access deal

**Example:**
```json
{
  "title": "VIP Members Only",
  "dealType": "Hidden Deal",
  "accessCode": "VIP2025",  // Optional, auto-generated if not provided
  "discountPercentage": 50,
  "bountyRewardAmount": 5,   // Optional bounty
  "minReferralsRequired": 1,
  "menuItems": [{ "id": 10 }, { "id": 11 }]  // Auto-set to hidden
}
```

**Response includes:**
```json
{
  "success": true,
  "message": "Hidden Deal created successfully",
  "deal": { /* deal data */ },
  "hidden": {
    "accessCode": "VIP2025",
    "directLink": "https://yohop.com/deals/hidden/VIP2025",
    "qrCodeLink": "https://yohop.com/qr/deal/VIP2025"
  },
  "bounty": {  // If bounty enabled
    "rewardAmount": 5,
    "minReferrals": 1,
    "qrCode": "BOUNTY:123:456:..."
  }
}
```

**Public Access:**
- Hidden deals do NOT appear in `GET /api/deals` (filtered out)
- Accessible only via `GET /api/deals/hidden/:code`
- Or `GET /api/deals?accessCode=VIP2025`

---

### 5. Redeem Now ⚡

**Purpose:** Flash sales with instant discounts

**Requirements:**
- `discountPercentage` - Must select from: **15%, 30%, 45%, 50%, 75%**, or custom (1-100%)
- Duration ≤ 24 hours
- Optional `maxRedemptions` limit

**Auto-enabled:**
- `isFlashSale = true`

**Example:**
```json
{
  "title": "Flash Sale - 50% OFF!",
  "dealType": "Redeem Now",
  "discountPercentage": 50,  // Choose from presets or custom
  "maxRedemptions": 100,      // Optional limit
  "startTime": "2025-11-07T14:00:00Z",
  "endTime": "2025-11-07T18:00:00Z",  // Max 24 hours
  "menuItems": [{ "id": 1 }]
}
```

**Response includes:**
```json
{
  "success": true,
  "message": "Redeem Now created successfully",
  "deal": { /* deal data */ },
  "flashSale": {
    "discountPercentage": 50,
    "maxRedemptions": 100,
    "currentRedemptions": 0
  }
}
```

**Redemption Tracking:**
- `currentRedemptions` increments on each redemption
- Deal becomes unavailable when `currentRedemptions >= maxRedemptions`

---

### 6. Recurring Deal 🔄

**Purpose:** Weekly deals on specific days (e.g., "Taco Tuesday")

**Requirements:**
- `recurringDays` - Array of days: MONDAY, TUESDAY, ..., SUNDAY
- At least one day required

**Filtering:**
- Deal only appears on specified days
- Backend auto-filters by current day of week

**Example:**
```json
{
  "title": "Taco Tuesday",
  "dealType": "Recurring Deal",
  "recurringDays": ["TUESDAY"],
  "discountPercentage": 25,
  "startTime": "2025-11-01T00:00:00Z",
  "endTime": "2025-12-31T23:59:59Z",
  "menuItems": [{ "id": 3 }]
}
```

**Multi-day Example:**
```json
{
  "title": "Weekend Brunch Special",
  "dealType": "Recurring Deal",
  "recurringDays": ["SATURDAY", "SUNDAY"],
  "discountPercentage": 20
}
```

---

## API Endpoints

### Create Deal
**POST** `/api/deals`

Headers:
```
Authorization: Bearer {merchant_token}
```

Body varies by deal type (see examples above)

---

### Get All Deals (Public)
**GET** `/api/deals`

Query params:
- `latitude`, `longitude`, `radius` - Geolocation filtering
- `category` - Filter by category
- `search` - Search in title/description
- `cityId` - Filter by city
- `accessCode` - Access specific hidden deal

**Note:** Hidden deals (with `accessCode`) are filtered out unless `accessCode` param is provided

---

### Get Hidden Deal
**GET** `/api/deals/hidden/:code`

Example: `GET /api/deals/hidden/VIP2025`

Returns deal if code matches and deal is active

---

### Redeem Deal
**POST** `/api/deals/:id/redeem`

Body:
```json
{
  "qrCodeData": "BOUNTY:123:456:1699999999:abc12345",  // For bounty deals
  "referralCount": 3  // Number of friends brought
}
```

**For Bounty Deals:**
- Verifies QR code
- Validates referral count ≥ `minReferralsRequired`
- Creates `KickbackEvent` with cash back
- Returns bounty earned

**For Flash Sales:**
- Increments `currentRedemptions`
- Checks against `maxRedemptions`

**Regular Deals:**
- Simply confirms redemption

---

## Database Schema Changes

### Deal Model (New Fields)

```prisma
model Deal {
  // ... existing fields ...
  
  // Bounty Deal fields
  bountyRewardAmount     Float?   // Cash back per referral
  minReferralsRequired   Int?     // Min friends to bring
  bountyQRCode           String?  // QR code for verification
  
  // Hidden Deal fields
  accessCode             String?  // Secret access code
  
  // Flash Sale fields
  isFlashSale            Boolean  @default(false)
  maxRedemptions         Int?     // Max redemption limit
  currentRedemptions     Int      @default(0)
  
  // Indexes
  @@index([accessCode])
  @@index([merchantId, dealTypeId])
  @@index([isFlashSale, endTime])
}
```

---

## Utility Functions

Located in `src/lib/dealUtils.ts`:

- `generateAccessCode()` - Creates unique access codes (VIP-XXXX)
- `generateBountyQRCode(dealId, merchantId)` - Creates QR data for bounty verification
- `verifyBountyQRCode(qrCodeData)` - Validates QR code and extracts deal info
- `validateDealTypeRequirements(dealType, data)` - Validates deal-specific requirements
- `generateHiddenDealLink(dealId, accessCode)` - Creates shareable link

---

## Validation Rules Summary

| Deal Type | Required Fields | Auto-Set Fields | Constraints |
|-----------|----------------|-----------------|-------------|
| **Standard** | title, dates, items | - | - |
| **Happy Hour** | title, dates, items | - | Items must be `isHappyHour=true` |
| **Bounty Deal** | bountyRewardAmount, minReferralsRequired | kickbackEnabled=true | Amount > 0, Min ≥ 1 |
| **Hidden Deal** | - | isHidden=true on items | accessCode unique |
| **Redeem Now** | discountPercentage | isFlashSale=true | Discount in [15,30,45,50,75,1-100], Duration ≤ 24h |
| **Recurring Deal** | recurringDays[] | - | At least 1 day selected |

---

## Error Handling

### Happy Hour - Non-HH Items
```json
{
  "error": "All items must be from Happy Hour menu",
  "hint": "Toggle 'Happy Hour' on menu items first"
}
```

### Bounty - Missing Requirements
```json
{
  "error": "Bounty reward amount is required and must be positive",
  "hint": "Specify how much cash back customers earn per friend"
}
```

### Hidden - Duplicate Code
```json
{
  "error": "Access code already in use",
  "generatedCode": "VIP-B3F7"  // Suggested alternative
}
```

### Redeem Now - Duration Exceeded
```json
{
  "error": "Redeem Now deals must be 24 hours or less",
  "currentDuration": "36.5 hours"
}
```

### Recurring - No Days Selected
```json
{
  "error": "Please select at least one day for recurring deals",
  "hint": "Specify which days this deal should appear"
}
```

---

## Testing

Run seed script:
```bash
npx ts-node scripts/seed-deal-types.ts
```

Test deal creation with each type using Postman/API client.

---

## Frontend Integration Guide

### Happy Hour
1. Show filter: "Happy Hour Items Only"
2. Filter menu items where `isHappyHour === true`
3. Prevent selection of non-HH items

### Bounty Deal
1. Input fields:
   - Bounty reward amount ($)
   - Min referrals required (#)
2. Show bounty preview: "Earn $X per friend (min Y friends)"
3. Display QR code in response for printing

### Hidden Deal
1. Optional: Custom access code input (or auto-generate)
2. Display access methods in response:
   - Access code (for manual entry)
   - Direct link (for sharing)
   - QR code link (for printing)
3. Optional: Bounty settings (combine with hidden)

### Redeem Now
1. Discount selector: Buttons for [15%, 30%, 45%, 50%, 75%, Custom]
2. If custom: Number input (1-100)
3. Duration picker: Max 24 hours
4. Optional: Max redemptions input

### Recurring Deal
1. Day selector: Checkboxes for Mon-Sun
2. At least one required
3. Show: "This deal appears on: Tuesday, Thursday"

---

## Migration Applied

```bash
npx prisma migrate dev --name add_bounty_flash_sale_hidden_deal_features
```

Generated migration: `20251107130136_add_bounty_flash_sale_hidden_deal_features`

---

## Summary

✅ **6 Deal Types** fully implemented with validation  
✅ **QR Code** bounty verification system  
✅ **Hidden Deals** with multiple access methods  
✅ **Flash Sales** with redemption tracking  
✅ **Happy Hour** menu enforcement  
✅ **Recurring Deals** with day-of-week filtering  
✅ **Comprehensive API** with error handling  
✅ **Database Schema** updated and migrated  

All deal types are now production-ready! 🎉
