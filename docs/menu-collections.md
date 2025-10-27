# Menu Collections Feature

Date: 2025-10-27  
Status: Implemented

## Purpose

Allow merchants to create, save, and reuse specific menu combinations (like "Happy Hour Menu", "Weekend Specials", "Brunch Menu") for easy deal creation and consistent menu management.

## Database Models

### MenuCollection
```prisma
model MenuCollection {
  id          Int       @id @default(autoincrement())
  merchantId  Int
  name        String    // "Happy Hour Menu", "Weekend Specials", "Brunch Menu"
  description String?   // Optional description of the collection
  isActive    Boolean   @default(true) // Whether the collection is active
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  merchant    Merchant  @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  items       MenuCollectionItem[]

  @@index([merchantId])
  @@index([merchantId, isActive])
  @@index([name])
}
```

### MenuCollectionItem
```prisma
model MenuCollectionItem {
  collectionId Int
  menuItemId   Int
  sortOrder    Int       @default(0) // For ordering items within collection
  isActive     Boolean   @default(true) // Whether this item is active in this collection
  customPrice  Float?    // Override price for this collection (optional)
  customDiscount Float?  // Custom discount for this collection (optional)
  notes        String?   // Optional notes for this item in this collection
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  collection   MenuCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  menuItem     MenuItem       @relation(fields: [menuItemId], references: [id], onDelete: Cascade)

  @@id([collectionId, menuItemId])
  @@index([collectionId])
  @@index([menuItemId])
  @@index([collectionId, sortOrder])
}
```

## API Endpoints

### Merchant Menu Collections (Protected Routes)

#### GET `/api/merchants/me/menu-collections`
Get all menu collections for the authenticated merchant.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "collections": [
    {
      "id": 1,
      "name": "Happy Hour Menu",
      "description": "Special drinks and appetizers",
      "isActive": true,
      "createdAt": "2025-10-27T12:00:00Z",
      "updatedAt": "2025-10-27T12:00:00Z",
      "items": [
        {
          "collectionId": 1,
          "menuItemId": 5,
          "sortOrder": 0,
          "isActive": true,
          "customPrice": 5.00,
          "customDiscount": null,
          "notes": "Special happy hour price",
          "menuItem": {
            "id": 5,
            "name": "Craft Beer",
            "price": 8.00,
            "category": "Drinks",
            "imageUrl": "https://example.com/beer.jpg",
            "description": "Local IPA",
            "dealType": "HAPPY_HOUR_BOUNTY",
            "isHappyHour": true,
            "happyHourPrice": 5.00
          }
        }
      ],
      "_count": {
        "items": 3
      }
    }
  ]
}
```

#### POST `/api/merchants/me/menu-collections`
Create a new menu collection.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "Happy Hour Menu",
  "description": "Special drinks and appetizers for happy hour",
  "menuItems": [
    {
      "id": 5,
      "sortOrder": 0,
      "customPrice": 5.00,
      "customDiscount": null,
      "notes": "Special happy hour price"
    },
    {
      "id": 8,
      "sortOrder": 1,
      "customPrice": null,
      "customDiscount": 20,
      "notes": "20% off regular price"
    }
  ]
}
```

**Response (201):**
```json
{
  "collection": {
    "id": 1,
    "name": "Happy Hour Menu",
    "description": "Special drinks and appetizers for happy hour",
    "isActive": true,
    "createdAt": "2025-10-27T12:00:00Z",
    "updatedAt": "2025-10-27T12:00:00Z",
    "items": [...],
    "_count": {
      "items": 2
    }
  }
}
```

#### GET `/api/merchants/me/menu-collections/:collectionId`
Get a specific menu collection with its items.

**Headers:** `Authorization: Bearer <token>`

#### PUT `/api/merchants/me/menu-collections/:collectionId`
Update a menu collection.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "Updated Happy Hour Menu",
  "description": "Updated description",
  "isActive": true
}
```

#### DELETE `/api/merchants/me/menu-collections/:collectionId`
Delete a menu collection (soft delete by setting isActive to false).

**Headers:** `Authorization: Bearer <token>`

**Response:** 204 No Content

### Menu Collection Items Management

#### POST `/api/merchants/me/menu-collections/:collectionId/items`
Add menu items to a collection.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "menuItems": [
    {
      "id": 10,
      "sortOrder": 0,
      "customPrice": 12.00,
      "customDiscount": null,
      "notes": "Special collection price"
    }
  ]
}
```

#### PUT `/api/merchants/me/menu-collections/:collectionId/items/:itemId`
Update a specific item in a collection.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "sortOrder": 2,
  "customPrice": 15.00,
  "customDiscount": 10,
  "notes": "Updated notes",
  "isActive": true
}
```

#### DELETE `/api/merchants/me/menu-collections/:collectionId/items/:itemId`
Remove an item from a collection.

**Headers:** `Authorization: Bearer <token>`

**Response:** 204 No Content

#### PUT `/api/merchants/me/menu-collections/:collectionId/items/reorder`
Reorder items in a collection.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "itemOrders": [
    { "itemId": 5, "sortOrder": 0 },
    { "itemId": 8, "sortOrder": 1 },
    { "itemId": 10, "sortOrder": 2 }
  ]
}
```

### Public Endpoints

#### GET `/api/menu-collections/:merchantId`
Get menu collections for a specific approved merchant (public endpoint).

**Response:**
```json
{
  "collections": [
    {
      "id": 1,
      "name": "Happy Hour Menu",
      "description": "Special drinks and appetizers",
      "isActive": true,
      "items": [...],
      "_count": {
        "items": 3
      }
    }
  ]
}
```

## Deal Creation with Menu Collections

### Enhanced Deal Creation

The deal creation endpoint now supports using menu collections:

**POST** `/api/deals`

**Request Body:**
```json
{
  "title": "Happy Hour Special",
  "description": "Great deals on drinks and appetizers",
  "activeDateRange": {
    "startDate": "2025-10-27T17:00:00Z",
    "endDate": "2025-10-27T19:00:00Z"
  },
  "menuCollectionId": 1,
  "discountPercentage": 20,
  "category": "FOOD_AND_BEVERAGE",
  "dealType": "HAPPY_HOUR"
}
```

When `menuCollectionId` is provided:
- All active items from the collection are automatically added to the deal
- Custom prices and discounts from the collection are applied
- Items are set as visible by default
- The collection must belong to the authenticated merchant

## Usage Examples

### Creating a Happy Hour Menu Collection

1. **Create Menu Items** (if not already created):
```bash
curl -X POST http://localhost:3000/api/merchants/me/menu/item \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Craft Beer",
    "price": 8.00,
    "category": "Drinks",
    "isHappyHour": true,
    "happyHourPrice": 5.00,
    "dealType": "HAPPY_HOUR_BOUNTY"
  }'
```

2. **Create Menu Collection**:
```bash
curl -X POST http://localhost:3000/api/merchants/me/menu-collections \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Happy Hour Menu",
    "description": "Special drinks and appetizers",
    "menuItems": [
      {
        "id": 5,
        "sortOrder": 0,
        "customPrice": 5.00,
        "notes": "Happy hour special price"
      },
      {
        "id": 8,
        "sortOrder": 1,
        "customDiscount": 20,
        "notes": "20% off regular price"
      }
    ]
  }'
```

3. **Create Deal Using Collection**:
```bash
curl -X POST http://localhost:3000/api/deals \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Happy Hour Special",
    "description": "Great deals on drinks and appetizers",
    "activeDateRange": {
      "startDate": "2025-10-27T17:00:00Z",
      "endDate": "2025-10-27T19:00:00Z"
    },
    "menuCollectionId": 1,
    "discountPercentage": 20,
    "category": "FOOD_AND_BEVERAGE",
    "dealType": "HAPPY_HOUR"
  }'
```

### Managing Collection Items

**Add Items to Collection**:
```bash
curl -X POST http://localhost:3000/api/merchants/me/menu-collections/1/items \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "menuItems": [
      {
        "id": 12,
        "sortOrder": 2,
        "customPrice": 10.00,
        "notes": "New happy hour item"
      }
    ]
  }'
```

**Reorder Items**:
```bash
curl -X PUT http://localhost:3000/api/merchants/me/menu-collections/1/items/reorder \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "itemOrders": [
      { "itemId": 12, "sortOrder": 0 },
      { "itemId": 5, "sortOrder": 1 },
      { "itemId": 8, "sortOrder": 2 }
    ]
  }'
```

## Validation Rules

### Collection Creation
- `name`: Required, 1-100 characters, unique per merchant
- `description`: Optional, max 500 characters
- `menuItems`: Optional array, must belong to merchant

### Collection Items
- `menuItemId`: Must belong to the authenticated merchant
- `sortOrder`: Integer, used for ordering
- `customPrice`: Optional, must be positive number
- `customDiscount`: Optional, must be positive number
- `notes`: Optional, max 200 characters

### Deal Creation with Collections
- `menuCollectionId`: Must belong to authenticated merchant
- Collection must be active
- Only active collection items are included

## Error Handling

### Common Error Responses

**Collection Not Found (404):**
```json
{
  "error": "Menu collection not found"
}
```

**Duplicate Collection Name (409):**
```json
{
  "error": "A collection with this name already exists"
}
```

**Invalid Menu Items (400):**
```json
{
  "error": "Some menu items do not belong to this merchant"
}
```

**Duplicate Items in Collection (409):**
```json
{
  "error": "Some menu items are already in this collection",
  "duplicateIds": [5, 8]
}
```

## Benefits

1. **Reusability**: Create menu combinations once, use multiple times
2. **Consistency**: Ensure consistent menu offerings across deals
3. **Efficiency**: Quick deal creation using pre-defined menus
4. **Flexibility**: Custom pricing and discounts per collection
5. **Organization**: Better menu management and categorization
6. **Time-saving**: No need to manually select items for each deal

## Future Enhancements

1. **Collection Templates**: Pre-defined collection templates for common menu types
2. **Collection Sharing**: Share collections between merchants (franchise chains)
3. **Collection Analytics**: Track performance of different collections
4. **Bulk Operations**: Bulk update prices across collections
5. **Collection Categories**: Categorize collections (Happy Hour, Brunch, etc.)
6. **Collection Scheduling**: Automatic activation/deactivation based on time

---

Generated: 2025-10-27  
Updated automatically as features are enhanced.
