# Menu Items Model

Date: 2025-09-23  
Updated: 2025-10-23

Status: Initial model added to Prisma schema with comprehensive deal type system.

## Purpose

Support detailed deal creation by allowing merchants to manage structured menu items (e.g., individual dishes, drinks, bites) with comprehensive deal types including Happy Hour variants, redeem now options, and time-based promotions. Merchants can select from various deal types like Happy Hour bounty, surprise deals, late night specials, and more.

## Prisma Model

Defined in `prisma/schema.prisma`:

```prisma
model MenuItem {
  id          Int       @id @default(autoincrement())
  merchantId  Int
  name        String
  description String?
  price       Float     // Consider Decimal for currency accuracy later
  category    String
  imageUrl    String?
  
  // Comprehensive deal type system
  dealType    MenuDealType @default(STANDARD) // Type of deal/promotion
  isHappyHour Boolean   @default(false) // Legacy field - use dealType instead
  happyHourPrice Float? // Special price for Happy Hour deals (optional)
  
  // Time-based deal settings
  validStartTime String? // HH:MM format for when deal becomes valid (e.g., "17:00")
  validEndTime   String? // HH:MM format for when deal expires (e.g., "19:00")
  validDays      String? // Comma-separated days (e.g., "MONDAY,TUESDAY,WEDNESDAY")
  
  // Surprise deal settings
  isSurprise     Boolean @default(false) // Whether this is a surprise deal
  surpriseRevealTime String? // When to reveal surprise (HH:MM format)
  
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  merchant    Merchant  @relation(fields: [merchantId], references: [id], onDelete: Cascade)

  @@index([merchantId])
  @@index([merchantId, dealType])
  @@index([merchantId, isHappyHour])
  @@index([dealType])
}
```

Added relation on `Merchant`:

```prisma
menuItems MenuItem[]
```

## Deal Types Available

### Happy Hour Variants
- **HAPPY_HOUR_BOUNTY**: Happy Hour bounty - redeem now
- **HAPPY_HOUR_SURPRISE**: Happy Hour surprise deal
- **HAPPY_HOUR_LATE_NIGHT**: Happy Hour late night specials
- **HAPPY_HOUR_MID_DAY**: Happy Hour mid day specials
- **HAPPY_HOUR_MORNINGS**: Happy Hour morning specials

### Redeem Now Variants
- **REDEEM_NOW_BOUNTY**: Redeem now bounty
- **REDEEM_NOW_SURPRISE**: Redeem now surprise deal

### Standard Types
- **STANDARD**: Regular menu item
- **RECURRING**: Recurring deal

## Notes & Rationale

- `price` uses `Float` per initial spec. For production-grade currency handling, prefer `Decimal` (Prisma supports `Decimal` with `@db.Decimal(10,2)` for Postgres) to avoid floating point rounding issues.
- `category` is currently a free-form `String`. If front-end categories stabilize, convert to an enum later.
- `imageUrl` optional for performance—avoid forcing uploads at creation time.
- Indexed `merchantId` for fast filtering of a merchant's menu items.
- `dealType` provides comprehensive deal categorization for merchants to select from.
- `validStartTime` and `validEndTime` enable time-based deal activation (HH:MM format).
- `validDays` allows specifying which days of the week deals are valid.
- `isSurprise` and `surpriseRevealTime` enable surprise deal mechanics.
- Multiple indexes for efficient filtering by deal type, merchant, and Happy Hour status.

## Migration

Run (if not already run):

```bash
npx prisma migrate dev --name add_menu_item_model
npx prisma migrate dev --name add_happy_hour_menu_fields
npx prisma migrate dev --name add_comprehensive_deal_types
```

If you cannot run migrations now, the model exists in schema and will be applied next migration cycle.

## Future Enhancements (Planned)

1. Deal Association: Introduce a join table, e.g. `DealMenuItem { dealId, menuItemId, specialPrice? }` for attaching menu items to specific Happy Hour deals.
2. Category Enum: Harden `category` into a controlled list (e.g., DRINKS, BITES, MAINS, DESSERT, OTHER).
3. Soft Delete: Add `active` or `archivedAt` to allow merchants to hide items without data loss.
4. Analytics: Add usage metrics once items are linked to deal redemptions / check-ins.
5. Validation: Enforce non-negative price via application-level validation.

## Implemented Endpoint

### GET `/api/merchants/me/menu`

Returns all menu items for the authenticated approved merchant.

Response:

```json
{
  "menuItems": [
    { 
      "id": 101, 
      "name": "Spicy Tuna Roll", 
      "price": 12.5, 
      "category": "Bites", 
      "imageUrl": "https://example.com/roll.png",
      "isHappyHour": true,
      "happyHourPrice": 8.5
    },
    { 
      "id": 102, 
      "name": "Old Fashioned", 
      "price": 15.0, 
      "category": "Drinks", 
      "imageUrl": "https://example.com/drink.png",
      "isHappyHour": false,
      "happyHourPrice": null
    }
  ]
}
```

Notes:

- Now includes Happy Hour fields: `isHappyHour` and `happyHourPrice`.
- Sorted by `createdAt desc` (newest first).

### POST `/api/merchants/me/menu/item`

Creates a new menu item with comprehensive deal type support.

Request Body:

```json
{
  "name": "Craft Beer",
  "price": 8.0,
  "category": "Drinks",
  "description": "Local IPA",
  "imageUrl": "https://example.com/beer.png",
  "dealType": "HAPPY_HOUR_BOUNTY",
  "validStartTime": "17:00",
  "validEndTime": "19:00",
  "validDays": "MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY",
  "isSurprise": false,
  "happyHourPrice": 5.0
}
```

Response (201):

```json
{
  "menuItem": {
    "id": 123,
    "name": "Craft Beer",
    "price": 8.0,
    "category": "Drinks",
    "imageUrl": "https://example.com/beer.png",
    "description": "Local IPA",
    "dealType": "HAPPY_HOUR_BOUNTY",
    "validStartTime": "17:00",
    "validEndTime": "19:00",
    "validDays": "MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY",
    "isSurprise": false,
    "surpriseRevealTime": null,
    "isHappyHour": true,
    "happyHourPrice": 5.0
  }
}
```

### PUT `/api/merchants/me/menu/item/:itemId`

Updates provided fields of an existing item owned by the merchant.

Example Body:

```json
{ 
  "price": 19.5, 
  "name": "Margherita Pizza Large",
  "isHappyHour": true,
  "happyHourPrice": 14.0
}
```

### DELETE `/api/merchants/me/menu/item/:itemId`

Deletes the item (hard delete now; may become soft delete later).

## Public Endpoints

### GET `/api/menu/items`

Public endpoint to filter and search menu items from approved merchants.

Query Parameters:
- `merchantId`: Filter by specific merchant
- `category`: Filter by menu category
- `minPrice`, `maxPrice`: Price range filtering
- `search`: Text search in name and description
- `cityId`: Filter by city
- `latitude`, `longitude`, `radius`: Location-based filtering
- `isHappyHour`: Filter by Happy Hour items (true/false)
- `dealType`: Filter by specific deal type (HAPPY_HOUR_BOUNTY, HAPPY_HOUR_SURPRISE, etc.)
- `limit`: Number of results (default 50, max 100)
- `offset`: Pagination offset

Response includes comprehensive deal fields: `dealType`, `validStartTime`, `validEndTime`, `validDays`, `isSurprise`, `surpriseRevealTime`, `isHappyHour`, and `happyHourPrice`.

### GET `/api/menu/happy-hour`

Dedicated endpoint for Happy Hour menu items from approved merchants.

Query Parameters:
- `merchantId`: Filter by specific merchant
- `category`: Filter by menu category
- `minPrice`, `maxPrice`: Price range filtering
- `search`: Text search in name and description
- `cityId`: Filter by city
- `latitude`, `longitude`, `radius`: Location-based filtering
- `limit`: Number of results (default 50, max 100)
- `offset`: Pagination offset

Automatically filters for `isHappyHour: true` items only.

### GET `/api/menu/deal-types`

Get all available deal types with descriptions.

Response:
```json
{
  "dealTypes": [
    {
      "value": "HAPPY_HOUR_BOUNTY",
      "label": "Happy Hour Bounty",
      "description": "Happy Hour bounty - redeem now",
      "category": "Happy Hour"
    },
    {
      "value": "HAPPY_HOUR_SURPRISE",
      "label": "Happy Hour Surprise",
      "description": "Happy Hour surprise deal",
      "category": "Happy Hour"
    }
    // ... more deal types
  ],
  "total": 9
}
```

## Pending / Anticipated Endpoints

Attach to deals (future):

- `POST /api/deals/:dealId/menu-items` – Link selected items.
- `DELETE /api/deals/:dealId/menu-items/:menuItemId` – Unlink.

## Validation Guidelines (App Layer)

- `name`: 1–120 chars.
- `price`: > 0 and reasonably capped (e.g., < 10000) to prevent accidental large values.
- `category`: sanitize / trim; if converting to enum, validate membership.
- `imageUrl`: validate URL format and optionally restrict domain (Cloudinary, etc.).
- `dealType`: must be one of the valid deal types (HAPPY_HOUR_BOUNTY, HAPPY_HOUR_SURPRISE, etc.).
- `validStartTime`, `validEndTime`, `surpriseRevealTime`: must be in HH:MM format or null.
- `validDays`: comma-separated day names (MONDAY, TUESDAY, etc.) or null.
- `isHappyHour`: must be boolean.
- `happyHourPrice`: must be positive number or null.
- `isSurprise`: must be boolean.

## Testing Recommendations

- Create menu items for a merchant and ensure retrieval sorted (if desired) by `createdAt` or `name`.
- Ensure non-approved merchant receives 403 when accessing `/api/merchants/me/menu`.
- Simulate deletion and ensure orphaned deal references (when association exists) are handled.
- Test Happy Hour filtering: create items with `isHappyHour: true/false` and verify filtering works.
- Test Happy Hour pricing: verify `happyHourPrice` is used when available, falls back to regular `price`.
- Test deal type filtering: create items with different `dealType` values and verify filtering works.
- Test time-based validation: verify `validStartTime` and `validEndTime` work correctly.
- Test surprise deals: verify `isSurprise` and `surpriseRevealTime` functionality.
- Test public endpoints with various filter combinations including `dealType`.

## Open Questions

- Should price support locale / currency differentiation? (Currently assumes USD.)
- Should we pre-load default categories for consistent client UX?
- Will Happy Hour require time-window specific discount overrides per MenuItem? If so, extend association table instead of overloading core model.

---

Generated automatically. Update as endpoints are implemented.
