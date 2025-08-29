# Save Deal API Documentation

This document describes the Save Deal API endpoints that allow logged-in users to save and manage their favorite deals.

## Overview

The Save Deal API provides functionality for users to:
- Save deals to their personal collection
- Remove deals from their saved collection
- View all their saved deals
- Check if a specific deal is saved

All endpoints require authentication using a Bearer token.

## Authentication

All endpoints require a valid JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Endpoints

### 1. Save a Deal

**POST** `/api/user/deals/:dealId/save`

Saves a specific deal to the user's collection.

#### Parameters
- `dealId` (path parameter): The ID of the deal to save (integer)

#### Request Body
None required

#### Response

**Success (201 Created)**
```json
{
  "message": "Deal saved successfully!",
  "savedDeal": {
    "id": 1,
    "dealId": 123,
    "savedAt": "2024-01-15T10:30:00.000Z",
    "deal": {
      "id": 123,
      "title": "50% Off Pizza",
      "description": "Get half off any large pizza",
      "imageUrl": "https://example.com/pizza.jpg",
      "discountPercentage": 50,
      "discountAmount": null,
      "category": "FOOD_AND_BEVERAGE",
      "startTime": "2024-01-01T00:00:00.000Z",
      "endTime": "2024-12-31T23:59:59.000Z",
      "redemptionInstructions": "Show this deal to the cashier",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "merchantId": 456,
      "merchant": {
        "id": 456,
        "businessName": "Pizza Palace",
        "address": "123 Main St, City, State",
        "description": "Best pizza in town",
        "logoUrl": "https://example.com/logo.jpg",
        "latitude": 40.7128,
        "longitude": -74.0060,
        "status": "APPROVED",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    }
  }
}
```

**Error Responses**
- `400 Bad Request`: Invalid deal ID
- `401 Unauthorized`: Missing or invalid authentication token
- `404 Not Found`: Deal not found or not available
- `409 Conflict`: Deal already saved by the user
- `500 Internal Server Error`: Server error

### 2. Remove a Saved Deal

**DELETE** `/api/user/deals/:dealId/save`

Removes a deal from the user's saved collection.

#### Parameters
- `dealId` (path parameter): The ID of the deal to remove (integer)

#### Request Body
None required

#### Response

**Success (200 OK)**
```json
{
  "message": "Deal removed from saved deals successfully!",
  "removedDeal": {
    "dealId": 123,
    "removedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Error Responses**
- `400 Bad Request`: Invalid deal ID
- `401 Unauthorized`: Missing or invalid authentication token
- `404 Not Found`: Deal not found in user's saved collection
- `500 Internal Server Error`: Server error

### 3. Check if Deal is Saved

**GET** `/api/user/deals/:dealId/saved`

Checks if a specific deal is saved by the logged-in user.

#### Parameters
- `dealId` (path parameter): The ID of the deal to check (integer)

#### Response

**Success (200 OK)**
```json
{
  "isSaved": true,
  "savedDeal": {
    "id": 1,
    "dealId": 123,
    "savedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

Or if not saved:
```json
{
  "isSaved": false,
  "savedDeal": null
}
```

**Error Responses**
- `400 Bad Request`: Invalid deal ID
- `401 Unauthorized`: Missing or invalid authentication token
- `500 Internal Server Error`: Server error

### 4. Get All Saved Deals

**GET** `/api/user/deals/saved`

Retrieves all deals saved by the logged-in user.

#### Query Parameters
- `latitude` (optional): User's latitude for distance calculation
- `longitude` (optional): User's longitude for distance calculation
- `radius` (optional): Radius in kilometers for distance filtering

#### Response

**Success (200 OK)**
```json
{
  "savedDeals": [
    {
      "id": 123,
      "title": "50% Off Pizza",
      "description": "Get half off any large pizza",
      "imageUrl": "https://example.com/pizza.jpg",
      "discountPercentage": 50,
      "discountAmount": null,
      "category": "FOOD_AND_BEVERAGE",
      "startTime": "2024-01-01T00:00:00.000Z",
      "endTime": "2024-12-31T23:59:59.000Z",
      "redemptionInstructions": "Show this deal to the cashier",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "merchantId": 456,
      "merchant": {
        "id": 456,
        "businessName": "Pizza Palace",
        "address": "123 Main St, City, State",
        "description": "Best pizza in town",
        "logoUrl": "https://example.com/logo.jpg",
        "latitude": 40.7128,
        "longitude": -74.0060,
        "status": "APPROVED",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      },
      "savedAt": "2024-01-15T10:30:00.000Z",
      "distance": 2.5
    }
  ],
  "total": 1,
  "filters": {
    "latitude": 40.7589,
    "longitude": -73.9851,
    "radius": 10
  }
}
```

**Error Responses**
- `400 Bad Request`: Invalid geolocation parameters
- `401 Unauthorized`: Missing or invalid authentication token
- `500 Internal Server Error`: Server error

## Business Rules

1. **Authentication Required**: All endpoints require a valid JWT token
2. **Deal Validation**: Only active deals from approved merchants can be saved
3. **Unique Saves**: A user can only save a deal once (enforced by database constraint)
4. **Cascade Deletion**: If a deal or user is deleted, the saved relationship is automatically removed
5. **Geolocation Support**: Saved deals can be filtered and sorted by distance when coordinates are provided

## Error Codes

| Status Code | Description |
|-------------|-------------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Missing or invalid token |
| 404 | Not Found - Resource not found |
| 409 | Conflict - Deal already saved |
| 500 | Internal Server Error - Server error |

## Example Usage

### Save a Deal
```bash
curl -X POST \
  http://localhost:3000/api/user/deals/123/save \
  -H 'Authorization: Bearer your-jwt-token' \
  -H 'Content-Type: application/json'
```

### Remove a Saved Deal
```bash
curl -X DELETE \
  http://localhost:3000/api/user/deals/123/save \
  -H 'Authorization: Bearer your-jwt-token'
```

### Check if Deal is Saved
```bash
curl -X GET \
  http://localhost:3000/api/user/deals/123/saved \
  -H 'Authorization: Bearer your-jwt-token'
```

### Get All Saved Deals with Distance
```bash
curl -X GET \
  'http://localhost:3000/api/user/deals/saved?latitude=40.7589&longitude=-73.9851&radius=10' \
  -H 'Authorization: Bearer your-jwt-token'
```

## Database Schema

The Save Deal functionality uses a `SavedDeal` model with the following structure:

```sql
model SavedDeal {
  id        Int      @id @default(autoincrement())
  userId    Int
  dealId    Int
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  deal      Deal     @relation(fields: [dealId], references: [id], onDelete: Cascade)

  @@unique([userId, dealId])
}
```

## Performance Considerations

1. **Indexes**: The database includes indexes on `userId`, `dealId`, and the composite `userId_dealId` for optimal query performance
2. **Cascade Deletion**: Automatic cleanup of saved deals when users or deals are deleted
3. **Efficient Queries**: Uses Prisma's optimized queries with proper includes and selects
4. **Distance Calculation**: Optional geolocation filtering with Haversine formula for accurate distance calculations

