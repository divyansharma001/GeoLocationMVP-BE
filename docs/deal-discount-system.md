# Deal Discount System Documentation

## Overview

The deal creation system now supports **dual-layer discounts**: global discounts applied to all items and item-specific discounts that can override the global settings.

## Discount Architecture

### 1. Global Discounts (Deal Level)

Applied to **ALL** menu items in the deal that have `useGlobalDiscount: true`:

```json
{
  "discountPercentage": 20,  // 20% off all items
  "discountAmount": 5.00      // OR $5 off the deal
}
```

**Fields:**
- `discountPercentage` (Float, 0-100): Percentage discount applied to all items
- `discountAmount` (Float): Fixed dollar amount discount for the deal

### 2. Item-Specific Discounts (Menu Item Level)

Override the global discount for specific menu items:

```json
{
  "menuItems": [
    {
      "id": 1,
      "customPrice": 9.99,        // Override base price
      "customDiscount": 50,        // 50% off THIS item only
      "discountAmount": 2.00,      // OR $2 off THIS item
      "isHidden": false            // Show/hide in deal UI
    }
  ]
}
```

**Fields in `DealMenuItem`:**
- `customPrice` (Float?): Override the menu item's base price for this deal
- `customDiscount` (Float?, 0-100): Percentage discount applied only to this item
- `discountAmount` (Float?): Fixed amount discount applied only to this item
- `useGlobalDiscount` (Boolean): Auto-set to `false` when item has custom pricing
- `isHidden` (Boolean): Whether to hide this item in the deal UI

## Usage Examples

### Example 1: Global Discount Only

**Scenario:** 20% off all drinks during Happy Hour

```json
{
  "title": "Happy Hour - All Drinks",
  "discountPercentage": 20,
  "menuItems": [
    { "id": 1 },  // Beer - gets 20% off
    { "id": 2 },  // Wine - gets 20% off
    { "id": 3 }   // Cocktail - gets 20% off
  ]
}
```

**Result:** All items use the global 20% discount.

---

### Example 2: Mixed Discounts

**Scenario:** 15% off everything, but premium cocktails get 50% off

```json
{
  "title": "Happy Hour - Premium Specials",
  "discountPercentage": 15,  // Global discount
  "menuItems": [
    { "id": 1 },                          // Beer - gets 15% off (global)
    { "id": 2 },                          // Wine - gets 15% off (global)
    { "id": 3, "customDiscount": 50 },    // Premium Cocktail - gets 50% off
    { "id": 4, "customDiscount": 50 }     // Margarita - gets 50% off
  ]
}
```

**Result:**
- Items 1 & 2: Use global 15% discount
- Items 3 & 4: Use item-specific 50% discount

---

### Example 3: Fixed Price Overrides

**Scenario:** Special pricing for select items

```json
{
  "title": "Weekend Special",
  "discountPercentage": 10,  // Global discount
  "menuItems": [
    { "id": 1, "customPrice": 4.99 },     // Beer - fixed at $4.99
    { "id": 2 },                          // Wine - gets 10% off (global)
    { "id": 3, "customPrice": 7.99 },     // Burger - fixed at $7.99
    { "id": 4, "discountAmount": 2.00 }   // Pizza - $2 off regular price
  ]
}
```

**Result:**
- Item 1: Sold at fixed price $4.99
- Item 2: Gets 10% off (global)
- Item 3: Sold at fixed price $7.99
- Item 4: Gets $2 off its regular price

---

### Example 4: Hidden Items with Discounts

**Scenario:** Secret menu items with special pricing

```json
{
  "title": "VIP Happy Hour",
  "discountPercentage": 20,
  "menuItems": [
    { "id": 1 },                                       // Visible, 20% off
    { "id": 2 },                                       // Visible, 20% off
    { "id": 3, "customDiscount": 50, "isHidden": true }  // Hidden, 50% off
  ]
}
```

**Result:**
- Items 1 & 2: Visible in UI, 20% discount
- Item 3: Hidden in UI, 50% discount (for secret orders)

---

## Discount Priority Logic

When calculating the final price for a menu item:

1. **Check `useGlobalDiscount` flag**
   - `true`: Apply deal's `discountPercentage` or `discountAmount`
   - `false`: Use item-specific pricing

2. **If item has `customPrice`**: Use that as the final price
3. **If item has `customDiscount`**: Apply percentage to base price
4. **If item has `discountAmount`**: Subtract from base price
5. **Otherwise**: Use global discount from deal

## Database Schema

```prisma
model DealMenuItem {
  dealId      Int
  menuItemId  Int
  isHidden    Boolean  @default(false)
  assignedAt  DateTime @default(now())
  
  // Discount options
  customPrice       Float?   // Override base price
  customDiscount    Float?   // Percentage (0-100)
  discountAmount    Float?   // Fixed amount
  useGlobalDiscount Boolean  @default(true)

  deal        Deal     @relation(...)
  menuItem    MenuItem @relation(...)

  @@id([dealId, menuItemId])
}
```

## API Request Format

### Creating a Deal with Discounts

**Endpoint:** `POST /api/deals`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "title": "Happy Hour Special",
  "description": "Best deals in town",
  "activeDateRange": {
    "startDate": "2025-10-27T17:00:00Z",
    "endDate": "2025-12-31T19:00:00Z"
  },
  "category": "FOOD_AND_BEVERAGE",
  "dealType": "HAPPY_HOUR",
  
  // Global discount (applies to all items with useGlobalDiscount=true)
  "discountPercentage": 20,
  
  // Menu items with optional per-item discounts
  "menuItems": [
    { "id": 1 },                               // Uses global 20%
    { "id": 2, "customDiscount": 50 },         // Gets 50% off
    { "id": 3, "customPrice": 5.99 },          // Fixed at $5.99
    { "id": 4, "discountAmount": 2.00 },       // $2 off
    { "id": 5, "isHidden": true }              // Hidden, uses global 20%
  ],
  
  "redemptionInstructions": "Show this deal at checkout"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Deal created successfully with enhanced features",
  "deal": {
    "id": 123,
    "title": "Happy Hour Special",
    "discountPercentage": 20,
    // ... other deal fields
  }
}
```

## Frontend Integration

### Calculating Display Prices

```typescript
function calculateDisplayPrice(
  menuItem: MenuItem, 
  dealMenuItem: DealMenuItem, 
  deal: Deal
): number {
  const basePrice = menuItem.price;
  
  // Use custom price if set
  if (dealMenuItem.customPrice !== null) {
    return dealMenuItem.customPrice;
  }
  
  // Use item-specific discount if set
  if (!dealMenuItem.useGlobalDiscount) {
    if (dealMenuItem.customDiscount !== null) {
      return basePrice * (1 - dealMenuItem.customDiscount / 100);
    }
    if (dealMenuItem.discountAmount !== null) {
      return Math.max(0, basePrice - dealMenuItem.discountAmount);
    }
  }
  
  // Use global discount
  if (deal.discountPercentage !== null) {
    return basePrice * (1 - deal.discountPercentage / 100);
  }
  if (deal.discountAmount !== null) {
    return Math.max(0, basePrice - deal.discountAmount);
  }
  
  return basePrice;
}
```

### Display Logic

```typescript
function getDiscountLabel(
  dealMenuItem: DealMenuItem,
  deal: Deal
): string {
  if (dealMenuItem.customPrice !== null) {
    return `Special Price: $${dealMenuItem.customPrice}`;
  }
  
  if (!dealMenuItem.useGlobalDiscount) {
    if (dealMenuItem.customDiscount !== null) {
      return `${dealMenuItem.customDiscount}% OFF`;
    }
    if (dealMenuItem.discountAmount !== null) {
      return `Save $${dealMenuItem.discountAmount}`;
    }
  }
  
  if (deal.discountPercentage !== null) {
    return `${deal.discountPercentage}% OFF ALL ITEMS`;
  }
  if (deal.discountAmount !== null) {
    return `$${deal.discountAmount} OFF`;
  }
  
  return '';
}
```

## Validation Rules

### Global Discount Validation
- `discountPercentage`: Must be between 0 and 100
- `discountAmount`: Must be non-negative

### Item-Specific Validation
- `customPrice`: Must be non-negative
- `customDiscount`: Must be between 0 and 100
- `discountAmount`: Must be non-negative

### Auto-Assignment Rules
- If item has `customPrice`, `customDiscount`, or `discountAmount`, then `useGlobalDiscount` = `false`
- Otherwise, `useGlobalDiscount` = `true`

## Menu Collection Support

When using `menuCollectionId` instead of individual `menuItems`:

```json
{
  "title": "Happy Hour",
  "discountPercentage": 20,
  "menuCollectionId": 5  // Existing collection
}
```

**Behavior:**
- All items from the collection are added to the deal
- If collection items have `customPrice` or `customDiscount`, they're preserved
- Items without custom pricing use the deal's global discount
- All items are visible by default (`isHidden: false`)

## Best Practices

1. **Use Global Discounts** for simple deals (e.g., "20% off everything")
2. **Use Item-Specific Discounts** for:
   - Featured items with deeper discounts
   - Premium items with special pricing
   - Loss leaders to drive traffic
3. **Use `isHidden`** for:
   - Secret menu items
   - VIP-only deals
   - Limited availability items
4. **Validate Total Savings** to ensure profitability
5. **Clear Naming** helps users understand the deal quickly

## Migration Notes

**Migration:** `20251027161731_add_deal_menu_item_discount_fields`

**Changes:**
- Added `customPrice` (Float?)
- Added `customDiscount` (Float?)
- Added `discountAmount` (Float?)
- Added `useGlobalDiscount` (Boolean, default: true)

**Backward Compatibility:**
- Existing deals continue to work
- `useGlobalDiscount` defaults to `true` for existing records
- No data migration required

## Testing

### Test Case 1: Global Discount
```bash
curl -X POST http://localhost:3000/api/deals \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Global",
    "discountPercentage": 25,
    "menuItems": [{"id": 1}, {"id": 2}]
  }'
```

### Test Case 2: Mixed Discounts
```bash
curl -X POST http://localhost:3000/api/deals \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Mixed",
    "discountPercentage": 10,
    "menuItems": [
      {"id": 1},
      {"id": 2, "customDiscount": 50}
    ]
  }'
```

## Support

For questions or issues, refer to:
- API Documentation: `API_DOCUMENTATION.md`
- Menu System: `docs/menu-items.md`
- Deal Creation: `docs/merchant-approval.md`
