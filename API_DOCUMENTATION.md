# GeolocationMVPBackend API Documentation

## Overview

The GeolocationMVPBackend is a Node.js/TypeScript backend for a geolocation-based deals platform using Express, Prisma, and PostgreSQL. It provides APIs for user management, merchant operations, deal discovery, gamification, and admin functions.

**Base URL**: `http://localhost:3000/api`  
**Version**: 1.0.0  
**Authentication**: JWT Bearer Token

## Table of Contents

1. [Authentication](#authentication)
2. [User Management](#user-management)
3. [Merchant Operations](#merchant-operations)
4. [Merchant Dashboard](#merchant-dashboard)
5. [Enhanced Merchant Dashboard Analytics](#enhanced-merchant-dashboard-analytics)
6. [Deal Discovery](#deal-discovery)
7. [Public Menu Discovery](#public-menu-discovery)
8. [User Interactions](#user-interactions)
9. [Leaderboard](#leaderboard)
10. [Admin Functions](#admin-functions)
11. [Admin Performance Analytics](#admin-performance-analytics)
12. [Customer Management](#customer-management)
13. [Media Upload](#media-upload)
14. [Health & Monitoring](#health--monitoring)
15. [Data Models](#data-models)
16. [Error Handling](#error-handling)

## Authentication

### POST /api/auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe",
  "referralCode": "ABC12345" // optional
}
```

**Response:**
```json
{
  "message": "User created successfully",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "points": 50,
    "referralCode": "XYZ78901",
    "role": "USER"
  }
}
```

### POST /api/auth/login
Authenticate user and get JWT token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### GET /api/auth/me
Get current user profile.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "id": 1,
  "email": "user@example.com",
  "name": "John Doe",
  "points": 150,
  "referralCode": "XYZ78901",
  "role": "USER"
}
```

## User Management

### POST /api/users/save-deal
Save a deal for the authenticated user.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "dealId": 123
}
```

### POST /api/users/check-in
Check in at a merchant location for a deal.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "dealId": 123,
  "latitude": 40.7128,
  "longitude": -74.0060
}
```

**Response:**
```json
{
  "dealId": 123,
  "merchantId": 456,
  "userId": 1,
  "distanceMeters": 45.2,
  "withinRange": true,
  "thresholdMeters": 100,
  "dealActive": true,
  "pointsAwarded": 35,
  "firstCheckIn": true
}
```

### GET /api/users/saved-deals
Get all saved deals for the authenticated user.

**Headers:** `Authorization: Bearer <token>`

### DELETE /api/users/save-deal/:dealId
Remove a saved deal.

**Headers:** `Authorization: Bearer <token>`

### GET /api/users/referrals
Get referral statistics for the authenticated user.

**Headers:** `Authorization: Bearer <token>`

## Merchant Operations

### POST /api/merchants/register
Register as a merchant (requires authentication).

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "businessName": "Joe's Pizza",
  "address": "123 Main St, New York, NY",
  "description": "Best pizza in town",
  "logoUrl": "https://example.com/logo.jpg",
  "phoneNumber": "+1-555-123-4567",
  "businessType": "LOCAL",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "cityId": 1
}
```

**Note:** `businessType` must be either `"NATIONAL"` (for chains like McDonald's) or `"LOCAL"` (for local restaurants). Defaults to `"LOCAL"` if not provided.

### GET /api/merchants/status
Get merchant status for the authenticated user.

**Headers:** `Authorization: Bearer <token>`

### POST /api/deals
Create a new deal (requires approved merchant status).

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "title": "50% Off Pizza",
  "description": "Get half off any pizza",
  "activeDateRange": {
    "startDate": "2024-01-01T00:00:00Z",
    "endDate": "2024-01-31T23:59:59Z"
  },
  "imageUrls": ["https://example.com/pizza.jpg"],
  "discountPercentage": 50,
  "category": "FOOD_AND_BEVERAGE",
  "dealType": "STANDARD",
  "redemptionInstructions": "Show this deal at checkout"
}
```

### GET /api/merchants/deals
Get all deals created by the authenticated merchant.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `activeOnly` (boolean): Filter for active deals only
- `includeExpired` (boolean): Include expired deals

### PUT /api/merchants/coordinates
Update merchant coordinates.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "latitude": 40.7128,
  "longitude": -74.0060
}
```

### Menu Management

#### GET /api/merchants/me/menu
Get menu items for the authenticated merchant.

#### POST /api/merchants/me/menu/item
Create a new menu item.

**Request Body:**
```json
{
  "name": "Margherita Pizza",
  "price": 15.99,
  "category": "Pizza",
  "description": "Classic tomato and mozzarella",
  "imageUrl": "https://example.com/margherita.jpg"
}
```

#### POST /api/merchants/me/menu/bulk-upload
**NEW** Bulk upload menu items from Excel/CSV file.

**Headers:** 
- `Authorization: Bearer <token>`
- `Content-Type: multipart/form-data`

**Form Data:**
- `file`: Excel file (.xlsx, .xls) or CSV file containing menu items

**Excel/CSV Format:**

Required columns:
- `name` - Menu item name
- `price` - Item price (positive number)
- `category` - Menu category

Optional columns:
- `description` - Item description
- `imageUrl` - URL to item image
- `isHappyHour` - Boolean (true/false, yes/no, 1/0)
- `happyHourPrice` - Happy Hour price
- `dealType` - Deal type (STANDARD, HAPPY_HOUR_BOUNTY, REDEEM_NOW_SURPRISE, etc.)
- `validStartTime` - Start time in HH:MM format (e.g., 17:00)
- `validEndTime` - End time in HH:MM format (e.g., 19:00)
- `validDays` - Comma-separated days (e.g., MONDAY,TUESDAY,FRIDAY)
- `isSurprise` - Boolean for surprise deals
- `surpriseRevealTime` - Reveal time in HH:MM format

**Example cURL:**
```bash
curl -X POST http://localhost:3000/api/merchants/me/menu/bulk-upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@menu_items.xlsx"
```

**Success Response (201):**
```json
{
  "message": "Successfully uploaded 25 menu items",
  "created": 25,
  "totalRows": 25,
  "skipped": 0
}
```

**Validation Error Response (400):**
```json
{
  "error": "Validation failed for some rows",
  "errors": [
    {
      "row": 3,
      "field": "price",
      "message": "Price must be a positive number"
    }
  ],
  "totalRows": 25,
  "validRows": 23,
  "errorRows": 2
}
```

**Notes:**
- Maximum file size: 10MB
- Supported formats: .xlsx, .xls, .csv
- All or nothing upload - if any row fails validation, entire upload is rejected
- Detailed error messages include row numbers and field names
- See `docs/menu-bulk-upload.md` for complete documentation and examples

#### PUT /api/merchants/me/menu/item/:itemId
Update a menu item.

#### DELETE /api/merchants/me/menu/item/:itemId
Delete a menu item.

## Public Menu Discovery

### GET /api/menu/items
Public endpoint to filter and search menu items from approved merchants.

**Query Parameters:**
- `merchantId` (optional): Filter by specific merchant ID
- `category` (optional): Filter by menu category (e.g., "Appetizers", "Mains", "Desserts")
- `subcategory` (optional): Filter by subcategory within a category
- `minPrice` (optional): Minimum price filter
- `maxPrice` (optional): Maximum price filter
- `search` (optional): Text search in name and description
- `cityId` (optional): Filter by city ID
- `latitude` (optional): Latitude for location-based filtering (requires longitude and radius)
- `longitude` (optional): Longitude for location-based filtering (requires latitude and radius)
- `radius` (optional): Radius in kilometers for location-based filtering (requires latitude and longitude)
- `isHappyHour` (optional): Filter by Happy Hour items (true/false)
- `limit` (optional): Number of results per page (default: 50, max: 100)
- `offset` (optional): Pagination offset (default: 0)

**Example Request:**
```
GET /api/menu/items?category=Mains&minPrice=10&maxPrice=20&search=pizza&limit=20
```

**Response:**
```json
{
  "menuItems": [
    {
      "id": 1,
      "name": "Margherita Pizza",
      "description": "Classic tomato and mozzarella",
      "price": 18.0,
      "category": "Mains",
      "imageUrl": "https://example.com/pizza.jpg",
      "isHappyHour": true,
      "happyHourPrice": 12.0,
      "createdAt": "2024-01-15T10:30:00Z",
      "merchant": {
        "id": 1,
        "businessName": "Mario's Pizza",
        "address": "123 Main St",
        "latitude": 40.7128,
        "longitude": -74.0060,
        "logoUrl": "https://example.com/logo.jpg",
        "description": "Authentic Italian pizza",
        "stores": [
          {
            "id": 1,
            "address": "123 Main St",
            "city": {
              "id": 1,
              "name": "New York",
              "state": "NY"
            }
          }
        ]
      }
    }
  ],
  "pagination": {
    "total": 45,
    "limit": 20,
    "offset": 0,
    "hasMore": true,
    "currentPage": 1,
    "totalPages": 3
  },
  "filters": {
    "category": "Mains",
    "subcategory": null,
    "merchantId": null,
    "minPrice": 10,
    "maxPrice": 20,
    "search": "pizza",
    "cityId": null,
    "location": null
  }
}
```

### GET /api/menu/happy-hour
Dedicated endpoint for Happy Hour menu items from approved merchants.

**Query Parameters:**
- `merchantId` (optional): Filter by specific merchant ID
- `category` (optional): Filter by menu category
- `minPrice` (optional): Minimum price filter
- `maxPrice` (optional): Maximum price filter
- `search` (optional): Text search in name and description
- `cityId` (optional): Filter by city ID
- `latitude` (optional): Latitude for location-based filtering (requires longitude and radius)
- `longitude` (optional): Longitude for location-based filtering (requires latitude and radius)
- `radius` (optional): Radius in kilometers for location-based filtering (requires latitude and longitude)
- `limit` (optional): Number of results per page (default: 50, max: 100)
- `offset` (optional): Pagination offset (default: 0)

**Example Request:**
```
GET /api/menu/happy-hour?category=Drinks&minPrice=5&maxPrice=15
```

**Response:**
```json
{
  "menuItems": [
    {
      "id": 2,
      "name": "Craft Beer",
      "description": "Local IPA",
      "price": 8.0,
      "category": "Drinks",
      "imageUrl": "https://example.com/beer.jpg",
      "isHappyHour": true,
      "happyHourPrice": 5.0,
      "createdAt": "2024-01-15T10:30:00Z",
      "merchant": {
        "id": 2,
        "businessName": "The Local Pub",
        "address": "456 Oak St",
        "latitude": 40.7589,
        "longitude": -73.9851,
        "logoUrl": "https://example.com/pub-logo.jpg",
        "description": "Neighborhood pub",
        "stores": []
      }
    }
  ],
  "pagination": {
    "total": 12,
    "limit": 50,
    "offset": 0,
    "hasMore": false,
    "currentPage": 1,
    "totalPages": 1
  },
  "filters": {
    "merchantId": null,
    "category": "Drinks",
    "search": null,
    "cityId": null,
    "isHappyHour": true
  }
}
```

### GET /api/menu/categories
Returns all unique menu categories from approved merchants with item counts.

**Query Parameters:**
- `merchantId` (optional): Filter categories by specific merchant ID
- `cityId` (optional): Filter categories by city ID

**Example Request:**
```
GET /api/menu/categories?cityId=1
```

**Response:**
```json
{
  "categories": [
    {
      "name": "Appetizers",
      "count": 15
    },
    {
      "name": "Mains",
      "count": 42
    },
    {
      "name": "Desserts",
      "count": 18
    }
  ],
  "total": 3
}
```

### Store Management

#### GET /api/merchants/stores
List stores for the authenticated merchant.

#### POST /api/merchants/stores
Create a new store.

**Request Body:**
```json
{
  "address": "456 Oak Ave, New York, NY",
  "latitude": 40.7589,
  "longitude": -73.9851,
  "cityId": 1,
  "active": true
}
```

## Merchant Dashboard

### GET /api/merchants/dashboard/stats
Get key performance indicators for the merchant dashboard.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `period` (string): Time period for data - `last_7_days`, `last_30_days`, `this_month`, `this_year`, `all_time` (default: `all_time`)

**Response:**
```json
{
  "period": "all_time",
  "kpis": {
    "grossSales": 1250.75,
    "orderVolume": 45,
    "averageOrderValue": 27.79,
    "totalKickbackHandout": 125.08
  },
  "metrics": {
    "activeDeals": 3,
    "totalSavedDeals": 89,
    "totalKickbackEvents": 15
  },
  "dateRange": {
    "from": null,
    "to": "2024-01-15T10:30:00.000Z"
  }
}
```

### GET /api/merchants/dashboard/city-performance
Get performance metrics by city for the merchant.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `period` (string): Time period for data - `last_7_days`, `last_30_days`, `this_month`, `this_year`, `all_time` (default: `all_time`)

**Response:**
```json
{
  "period": "all_time",
  "cities": [
    {
      "cityId": 1,
      "cityName": "New York",
      "state": "NY",
      "stores": [
        {
          "storeId": 1,
          "address": "123 Main St, New York, NY"
        }
      ],
      "totalPerformance": {
        "grossSales": 850.50,
        "orderVolume": 28,
        "averageOrderValue": 30.38,
        "activeDeals": 2,
        "kickbackEarnings": 85.05
      }
    }
  ],
  "summary": {
    "totalCities": 2,
    "totalStores": 3,
    "totalGrossSales": 1250.75,
    "totalOrderVolume": 45
  },
  "dateRange": {
    "from": null,
    "to": "2024-01-15T10:30:00.000Z"
  }
}
```

### GET /api/merchants/dashboard/analytics
Get detailed analytics for the merchant dashboard.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `period` (string): Time period for data - `last_7_days`, `last_30_days`, `this_month`, `this_year` (default: `last_30_days`)
- `groupBy` (string): Grouping for time series - `day`, `week`, `month` (default: `day`)

**Response:**
```json
{
  "period": "last_30_days",
  "groupBy": "day",
  "timeSeries": [
    {
      "date": "2024-01-01",
      "checkIns": 5,
      "grossSales": 150.25,
      "kickbackEarnings": 15.03
    }
  ],
  "dealsPerformance": [
    {
      "id": 123,
      "title": "50% Off Pizza",
      "checkIns": 25,
      "saves": 45,
      "kickbackEvents": 8,
      "isActive": true,
      "kickbackEnabled": true
    }
  ],
  "userEngagement": {
    "totalUsers": 67,
    "returningUsers": 23,
    "newUsers": 44
  },
  "summary": {
    "totalDeals": 5,
    "activeDeals": 3,
    "totalCheckIns": 45,
    "totalSaves": 89,
    "totalKickbackEvents": 15
  },
  "dateRange": {
    "from": "2023-12-16T10:30:00.000Z",
    "to": "2024-01-15T10:30:00.000Z"
  }
}
```

### GET /api/merchants/me/kickback-earnings
Get detailed kickback earnings data with real database queries.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `period` (string): Time period for data - `last_7_days`, `last_30_days`, `this_month`, `this_year`, `all_time` (default: `all_time`)

**Response:**
```json
{
  "period": "all_time",
  "summary": {
    "revenue": 1250.75,
    "totalKickbackHandout": 125.08,
    "totalEvents": 15,
    "uniqueUsers": 8
  },
  "details": [
    {
      "user": {
        "id": 123,
        "name": "John Doe",
        "avatarUrl": "https://example.com/avatar.jpg"
      },
      "earned": 25.50,
      "invitedCount": 5,
      "totalSpentByInvitees": 255.00,
      "spendingDetail": [
        {
          "dealTitle": "50% Off Pizza",
          "dealId": 123,
          "amountSpent": 85.00,
          "amountEarned": 8.50,
          "inviteeCount": 3,
          "date": "2024-01-10T15:30:00.000Z"
        }
      ]
    }
  ],
  "timeSeries": [
    {
      "date": "2024-01-01",
      "revenue": 150.25,
      "kickbackHandout": 15.03,
      "eventCount": 2
    }
  ],
  "dateRange": {
    "from": null,
    "to": "2024-01-15T10:30:00.000Z"
  },
  "merchantId": 456
}
```

## Enhanced Merchant Dashboard Analytics

### GET /api/merchants/dashboard/deal-performance
Get detailed performance analytics for individual deals with comprehensive metrics.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `period` (string): Time period - `last_7_days`, `last_30_days`, `this_month`, `this_year` (default: `last_30_days`)
- `dealId` (number): Optional specific deal ID for detailed analysis
- `limit` (number): Number of deals to return (default: 10)

**Response:**
```json
{
  "period": "last_30_days",
  "deals": [
    {
      "id": 123,
      "title": "50% Off Pizza",
      "description": "Get half off any pizza",
      "category": {
        "id": 1,
        "name": "Food & Beverage",
        "icon": "🍽️"
      },
      "dealType": {
        "id": 1,
        "name": "Standard"
      },
      "isActive": true,
      "kickbackEnabled": true,
      "performance": {
        "checkIns": 45,
        "saves": 89,
        "kickbackEvents": 12,
        "uniqueUsers": 67,
        "returningUsers": 23,
        "conversionRates": {
          "saveToCheckIn": 50.56,
          "checkInToKickback": 26.67
        }
      },
      "timeSeries": [
        {
          "date": "2024-01-01",
          "checkIns": 5,
          "saves": 8,
          "revenue": 85.50,
          "kickbackEarnings": 8.55
        }
      ],
      "menuItems": [
        {
          "id": 1,
          "name": "Margherita Pizza",
          "price": 15.99,
          "category": "Pizza",
          "isHidden": false
        }
      ]
    }
  ],
  "summary": {
    "totalDeals": 5,
    "activeDeals": 3,
    "totalCheckIns": 125,
    "totalSaves": 234,
    "totalKickbackEvents": 45,
    "averageSaveToCheckInRate": 53.42
  }
}
```

### GET /api/merchants/dashboard/customer-insights
Get detailed customer behavior and engagement analytics.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `period` (string): Time period - `last_7_days`, `last_30_days`, `this_month`, `this_year` (default: `last_30_days`)

**Response:**
```json
{
  "period": "last_30_days",
  "customerOverview": {
    "totalCustomers": 156,
    "newCustomers": 45,
    "returningCustomers": 111,
    "customerRetentionRate": 71.15
  },
  "activityLevels": {
    "high": 23,
    "medium": 67,
    "low": 66
  },
  "customerValue": {
    "averageCustomerValue": 45.75,
    "topCustomers": [
      {
        "user": {
          "id": 123,
          "name": "John Doe",
          "avatarUrl": "https://example.com/avatar.jpg",
          "createdAt": "2024-01-01T00:00:00.000Z"
        },
        "totalSpent": 285.50,
        "totalEarned": 28.55,
        "kickbackEvents": 8
      }
    ]
  },
  "referralInsights": {
    "referredCustomers": 34,
    "referralEngagement": [
      {
        "customer": {
          "id": 124,
          "name": "Jane Smith",
          "avatarUrl": "https://example.com/avatar2.jpg"
        },
        "referrer": {
          "id": 123,
          "name": "John Doe",
          "avatarUrl": "https://example.com/avatar.jpg"
        },
        "checkIns": 3,
        "savedDeals": 7
      }
    ]
  },
  "activityPatterns": {
    "hourlyDistribution": [0, 1, 2, 15, 8, 12, 18, 22, 5, 3, 1, 0],
    "peakHours": [
      { "hour": 12, "count": 18 },
      { "hour": 18, "count": 15 },
      { "hour": 19, "count": 12 }
    ]
  }
}
```

### GET /api/merchants/dashboard/revenue-analytics
Get detailed revenue breakdown and financial analytics.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `period` (string): Time period - `last_7_days`, `last_30_days`, `this_month`, `this_year` (default: `last_30_days`)

**Response:**
```json
{
  "period": "last_30_days",
  "summary": {
    "totalRevenue": 2845.75,
    "totalKickbackPaid": 284.58,
    "totalTransactions": 156,
    "averageTransactionValue": 18.24,
    "kickbackRate": 10.0
  },
  "revenueByCategory": [
    {
      "category": {
        "name": "Food & Beverage",
        "icon": "🍽️"
      },
      "revenue": 1845.50,
      "kickbackPaid": 184.55,
      "transactions": 89
    }
  ],
  "revenueByDealType": [
    {
      "dealType": "Standard",
      "revenue": 1645.25,
      "kickbackPaid": 164.53,
      "transactions": 78
    }
  ],
  "topDeals": [
    {
      "deal": {
        "id": 123,
        "title": "50% Off Pizza",
        "category": {
          "name": "Food & Beverage",
          "icon": "🍽️"
        },
        "dealType": {
          "name": "Standard"
        }
      },
      "revenue": 485.75,
      "kickbackPaid": 48.58,
      "transactions": 23,
      "uniqueCustomers": 18
    }
  ],
  "dailyTrends": [
    {
      "date": "2024-01-01",
      "revenue": 125.50,
      "kickbackPaid": 12.55,
      "transactions": 8
    }
  ]
}
```

### GET /api/merchants/dashboard/engagement-metrics
Get detailed user engagement and behavior analytics.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `period` (string): Time period - `last_7_days`, `last_30_days`, `this_month`, `this_year` (default: `last_30_days`)

**Response:**
```json
{
  "period": "last_30_days",
  "funnelMetrics": {
    "totalDealViews": 1250,
    "totalDealSaves": 234,
    "totalCheckIns": 156,
    "totalKickbackEvents": 45,
    "conversionRates": {
      "saveRate": 18.72,
      "checkInRate": 66.67,
      "kickbackRate": 28.85
    }
  },
  "userEngagement": {
    "totalEngagedUsers": 189,
    "engagementLevels": {
      "high": 23,
      "medium": 67,
      "low": 99
    },
    "customerRetentionRate": 58.73,
    "averageEngagementPerUser": 3.42
  },
  "dailyEngagement": [
    {
      "date": "2024-01-01",
      "saves": 8,
      "checkIns": 5,
      "kickbackEvents": 2,
      "engagementScore": 19
    }
  ],
  "topEngagingDeals": [
    {
      "id": 123,
      "title": "50% Off Pizza",
      "category": {
        "name": "Food & Beverage",
        "icon": "🍽️"
      },
      "engagementScore": 145,
      "saves": 89,
      "checkIns": 45,
      "kickbackEvents": 12
    }
  ]
}
```

### GET /api/merchants/dashboard/performance-comparison
Get period-over-period performance comparisons with trend analysis.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `currentPeriod` (string): Current period - `last_7_days`, `last_30_days`, `this_month`, `this_year` (default: `last_30_days`)
- `comparePeriod` (string): Comparison period - `previous_30_days`, `previous_month`, `previous_year` (default: `previous_30_days`)

**Response:**
```json
{
  "currentPeriod": "last_30_days",
  "comparePeriod": "previous_30_days",
  "currentMetrics": {
    "checkIns": 156,
    "dealSaves": 234,
    "grossSales": 2845.75,
    "kickbackPaid": 284.58,
    "uniqueUsers": 189
  },
  "compareMetrics": {
    "checkIns": 134,
    "dealSaves": 198,
    "grossSales": 2156.25,
    "kickbackPaid": 215.63,
    "uniqueUsers": 156
  },
  "changes": {
    "checkIns": 16.42,
    "dealSaves": 18.18,
    "grossSales": 31.99,
    "kickbackPaid": 31.99,
    "uniqueUsers": 21.15
  },
  "trends": {
    "checkIns": "up",
    "dealSaves": "up",
    "grossSales": "up",
    "kickbackPaid": "up",
    "uniqueUsers": "up"
  },
  "dateRanges": {
    "current": {
      "from": "2023-12-16T10:30:00.000Z",
      "to": "2024-01-15T10:30:00.000Z"
    },
    "compare": {
      "from": "2023-11-16T10:30:00.000Z",
      "to": "2023-12-15T10:30:00.000Z"
    }
  }
}
```

### GET /api/merchants/dashboard/performance-comparison-custom
Get customizable period-over-period performance comparisons with flexible time periods and advanced filtering options.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `currentPeriod` (optional): Predefined current period (default: 'last_30_days')
- `comparePeriod` (optional): Predefined comparison period (default: 'previous_30_days')
- `currentFrom` (optional): Custom current period start date (ISO 8601 format)
- `currentTo` (optional): Custom current period end date (ISO 8601 format)
- `compareFrom` (optional): Custom comparison period start date (ISO 8601 format)
- `compareTo` (optional): Custom comparison period end date (ISO 8601 format)
- `metrics` (optional): Filter specific metrics (default: 'all')
- `granularity` (optional): Time granularity for time series data (default: 'day')
- `groupBy` (optional): Grouping option for data (default: 'date')

**Available Current Periods:**
- `last_7_days`, `last_30_days`, `last_90_days`
- `this_month`, `last_month`
- `this_quarter`, `last_quarter`
- `this_year`, `last_year`

**Available Comparison Periods:**
- `previous_7_days`, `previous_30_days`, `previous_90_days`
- `previous_month`, `same_month_last_year`
- `previous_quarter`, `same_quarter_last_year`
- `previous_year`

**Available Metrics Filters:**
- `all`: All metrics (default)
- `checkins`: Check-in data only
- `deals`: Deal saves and active deals only
- `sales`: Sales and kickback data only
- `kickbacks`: Kickback events only
- `users`: Unique user data only

**Available Granularity Options:**
- `day`: Daily data points
- `week`: Weekly data points
- `month`: Monthly data points

**Example Requests:**
```
# Predefined periods
GET /api/merchants/dashboard/performance-comparison-custom?currentPeriod=last_30_days&comparePeriod=same_month_last_year

# Custom date ranges
GET /api/merchants/dashboard/performance-comparison-custom?currentFrom=2024-01-01T00:00:00Z&currentTo=2024-01-31T23:59:59Z&compareFrom=2023-01-01T00:00:00Z&compareTo=2023-01-31T23:59:59Z

# Filtered metrics with weekly granularity
GET /api/merchants/dashboard/performance-comparison-custom?metrics=sales&granularity=week&currentPeriod=last_90_days&comparePeriod=previous_90_days
```

**Response:**
```json
{
  "currentPeriod": "last_30_days",
  "comparePeriod": "previous_30_days",
  "customDates": false,
  "currentMetrics": {
    "checkIns": 45,
    "dealSaves": 23,
    "grossSales": 1250.75,
    "kickbackPaid": 125.08,
    "uniqueUsers": 18,
    "activeDeals": 5
  },
  "compareMetrics": {
    "checkIns": 32,
    "dealSaves": 18,
    "grossSales": 980.50,
    "kickbackPaid": 98.05,
    "uniqueUsers": 15,
    "activeDeals": 4
  },
  "changes": {
    "checkIns": 40.63,
    "dealSaves": 27.78,
    "grossSales": 27.57,
    "kickbackPaid": 27.57,
    "uniqueUsers": 20.00,
    "activeDeals": 25.00
  },
  "trends": {
    "checkIns": "up",
    "dealSaves": "up",
    "grossSales": "up",
    "kickbackPaid": "up",
    "uniqueUsers": "up",
    "activeDeals": "up"
  },
  "dateRanges": {
    "current": {
      "from": "2024-01-01T00:00:00Z",
      "to": "2024-01-31T23:59:59Z"
    },
    "compare": {
      "from": "2023-12-02T00:00:00Z",
      "to": "2024-01-01T00:00:00Z"
    }
  },
  "timeSeriesData": [
    {
      "period": "current",
      "date": "2024-01-01",
      "checkIns": 5,
      "dealSaves": 3,
      "grossSales": 125.50
    },
    {
      "period": "compare",
      "date": "2023-12-02",
      "checkIns": 4,
      "dealSaves": 2,
      "grossSales": 98.25
    }
  ],
  "filters": {
    "metrics": "all",
    "granularity": "day",
    "groupBy": "date"
  },
  "summary": {
    "totalDaysCurrent": 30,
    "totalDaysCompare": 30,
    "periodDifference": 0
  }
}
```

## Deal Discovery

### GET /api/deals
Discover deals with optional filtering.

**Query Parameters:**
- `latitude` (number): User's latitude for distance filtering
- `longitude` (number): User's longitude for distance filtering
- `radius` (number): Search radius in kilometers
- `category` (string): Filter by deal category
- `search` (string): Search in title and description
- `cityId` (number): Filter by city

**Response:**
```json
{
  "deals": [
    {
      "id": 123,
      "title": "50% Off Pizza",
      "description": "Get half off any pizza",
      "imageUrl": "https://example.com/pizza.jpg",
      "images": ["https://example.com/pizza.jpg"],
      "offerDisplay": "50% OFF",
      "merchant": {
        "id": 456,
        "businessName": "Joe's Pizza",
        "address": "123 Main St",
        "latitude": 40.7128,
        "longitude": -74.0060,
        "logoUrl": "https://example.com/logo.jpg"
      },
      "distance": 0.5,
      "claimedBy": {
        "totalCount": 15,
        "visibleUsers": [
          {"avatarUrl": "https://example.com/avatar1.jpg"}
        ]
      }
    }
  ],
  "total": 1,
  "filters": {
    "latitude": 40.7128,
    "longitude": -74.0060,
    "radius": 5,
    "category": "FOOD_AND_BEVERAGE",
    "search": null,
    "cityId": 1
  }
}
```

### GET /api/deals/categories
Get all available deal categories.

### POST /api/deals/:id/share
Track deal sharing for analytics and social proof.

**Request Body:**
```json
{
  "shareMethod": "link",
  "platform": "whatsapp"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Deal shared successfully",
  "shareData": {
    "dealId": 123,
    "title": "50% Off Pizza",
    "description": "Get half off any pizza",
    "imageUrl": "https://example.com/pizza.jpg",
    "merchantName": "Joe's Pizza",
    "shareUrl": "https://your-app.com/deals/123",
    "shareMethod": "link",
    "platform": "whatsapp"
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Response:**
```json
{
  "categories": [
    {
      "value": "FOOD_AND_BEVERAGE",
      "label": "Food & Beverage",
      "description": "Restaurants, cafes, bars, food delivery",
      "icon": "🍽️"
    }
  ],
  "total": 11
}
```

### GET /api/deals/featured
Get featured deals for homepage.

**Query Parameters:**
- `limit` (number): Number of deals to return (max 20, default 8)

### GET /api/deals/:id
Get comprehensive deal details for detailed view with enhanced social proof, user interaction, and action URLs.

**Query Parameters:**
- `userId` (optional): User ID for personalized interaction data

**Response:**
```json
{
  "success": true,
  "deal": {
    "id": 123,
    "title": "50% Off Pizza",
    "description": "Get half off any pizza",
    "category": {
      "value": "FOOD_AND_BEVERAGE",
      "label": "Food & Beverage",
      "description": "Restaurants, cafes, bars",
      "icon": "🍽️",
      "color": "#FF5733"
    },
    "imageUrl": "https://example.com/pizza.jpg",
    "images": ["https://example.com/pizza.jpg"],
    "offerDisplay": "50% OFF",
    "discountPercentage": 50,
    "startTime": "2024-01-01T00:00:00Z",
    "endTime": "2024-01-31T23:59:59Z",
    "status": {
      "isActive": true,
      "isExpired": false,
      "isUpcoming": false,
      "timeRemaining": {
        "total": 2592000000,
        "hours": 720,
        "minutes": 0,
        "formatted": "720h 0m"
      }
    },
    "merchant": {
      "id": 456,
      "businessName": "Joe's Pizza",
      "description": "Best pizza in town",
      "address": "123 Main St",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "logoUrl": "https://example.com/logo.jpg",
      "totalDeals": 5,
      "totalStores": 2
    },
    "socialProof": {
      "totalSaves": 25,
      "recentSavers": [
        {
          "id": 1,
          "name": "John Doe",
          "avatarUrl": "https://example.com/avatar1.jpg",
          "savedAt": "2024-01-15T10:30:00Z"
        }
      ]
    }
  }
}
```

## Enhanced Leaderboard System

### GET /api/leaderboard
Get basic leaderboard rankings with optional authentication and period filtering.

**Headers:** `Authorization: Bearer <token>` (optional)

**Query Parameters:**
- `period` (string): Time period - `day`, `week`, `month`, `all-time`, `custom`
- `limit` (number): Number of users to return (1-50, default: 5)
- `showMore` (boolean): Show more entries (default: false, shows 5 entries by default)
- `includeSelf` (boolean): Include authenticated user's position (default: true)
- `year` (number): Specific year for period
- `month` (number): Specific month for period (1-12)
- `from` (string): Custom start date (ISO 8601 format)
- `to` (string): Custom end date (ISO 8601 format)

**Response:**
```json
{
  "period": {
    "granularity": "month",
    "start": "2024-01-01T00:00:00.000Z",
    "endExclusive": "2024-02-01T00:00:00.000Z",
    "label": "January 2024"
  },
  "top": [
    {
      "userId": 123,
      "name": "John Doe",
      "periodPoints": 450,
      "totalPoints": 1250,
      "rank": 1
    }
  ],
  "me": {
    "userId": 456,
    "name": "Jane Smith",
    "periodPoints": 320,
    "totalPoints": 980,
    "rank": 15,
    "inTop": false
  },
  "pagination": {
    "defaultLimit": 5,
    "currentLimit": 5,
    "showMore": false,
    "hasMore": true
  }
}
```

### GET /api/leaderboard/global
Get enhanced global leaderboard with detailed analytics and statistics.

**Headers:** `Authorization: Bearer <token>` (optional)

**Query Parameters:**
- `period` (string): Time period (default: 'last_30_days')
  - Available: `today`, `this_week`, `this_month`, `this_quarter`, `this_year`
  - Available: `last_7_days`, `last_30_days`, `last_90_days`
- `limit` (number): Number of users to return (default: 5, max: 100)
- `showMore` (boolean): Show more entries (default: false, shows 5 entries by default)
- `includeSelf` (boolean): Include authenticated user's position (default: true)
- `includeStats` (boolean): Include global statistics (default: true)

**Response:**
```json
{
  "success": true,
  "period": "last_30_days",
  "dateRange": {
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-01-31T23:59:59.999Z"
  },
  "leaderboard": [
    {
      "rank": 1,
      "userId": 123,
      "name": "John Doe",
      "email": "john@example.com",
      "avatarUrl": "https://example.com/avatar.jpg",
      "totalPoints": 1250,
      "periodPoints": 450,
      "monthlyPoints": 450,
      "eventCount": 45,
      "checkInCount": 30,
      "uniqueDealsCheckedIn": 25,
      "memberSince": "2023-06-15",
      "inTop": true
    }
  ],
  "personalPosition": {
    "rank": 15,
    "userId": 456,
    "name": "Jane Smith",
    "email": "jane@example.com",
    "avatarUrl": null,
    "totalPoints": 980,
    "periodPoints": 320,
    "monthlyPoints": 320,
    "eventCount": 32,
    "checkInCount": 20,
    "uniqueDealsCheckedIn": 15,
    "inTop": false
  },
  "globalStats": {
    "totalUsers": 1250,
    "activeUsers": 890,
    "avgPointsPerUser": 125.5,
    "maxPoints": 1250,
    "minPoints": 0,
    "totalPointsEarned": 156875,
    "totalCheckIns": 4450,
    "uniqueDealsUsed": 125,
    "distribution": {
      "p25": 25.0,
      "p50": 75.0,
      "p75": 150.0,
      "p90": 300.0,
      "p95": 500.0,
      "p99": 1000.0
    }
  },
  "pagination": {
    "defaultLimit": 5,
    "currentLimit": 5,
    "showMore": false,
    "hasMore": true
  },
  "metadata": {
    "totalShown": 5,
    "limit": 5,
    "includeSelf": true,
    "includeStats": true,
    "queryTime": 245
  }
}
```

### GET /api/leaderboard/cities
Get city comparison leaderboard with performance metrics.

**Headers:** `Authorization: Bearer <token>` (optional)

**Query Parameters:**
- `period` (string): Time period (default: 'last_30_days')
- `limit` (number): Number of cities to return (default: 5, max: 50)
- `showMore` (boolean): Show more entries (default: false, shows 5 entries by default)
- `includeInactive` (boolean): Include inactive cities (default: false)

**Response:**
```json
{
  "success": true,
  "period": "last_30_days",
  "dateRange": {
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-01-31T23:59:59.999Z"
  },
  "cities": [
    {
      "rank": 1,
      "cityId": 1,
      "cityName": "New York",
      "state": "NY",
      "active": true,
      "totalUsers": 450,
      "activeUsers": 320,
      "avgPointsPerUser": 145.5,
      "maxPoints": 1250,
      "totalPointsEarned": 65475,
      "totalCheckIns": 1800,
      "uniqueDealsUsed": 85,
      "activeMerchants": 25,
      "engagementRate": 0.711
    }
  ],
  "pagination": {
    "defaultLimit": 5,
    "currentLimit": 5,
    "showMore": false,
    "hasMore": true
  },
  "metadata": {
    "totalShown": 5,
    "limit": 5,
    "includeInactive": false,
    "queryTime": 180
  }
}
```

### GET /api/leaderboard/cities/:cityId
Get detailed city-specific leaderboard with local analytics.

**Headers:** `Authorization: Bearer <token>` (optional)

**Query Parameters:**
- `period` (string): Time period (default: 'last_30_days')
- `limit` (number): Number of users to return (default: 5, max: 100)
- `showMore` (boolean): Show more entries (default: false, shows 5 entries by default)
- `includeSelf` (boolean): Include authenticated user's position (default: true)
- `includeStats` (boolean): Include city statistics (default: true)

**Response:**
```json
{
  "success": true,
  "period": "last_30_days",
  "dateRange": {
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-01-31T23:59:59.999Z"
  },
  "city": {
    "id": 1,
    "name": "New York",
    "state": "NY",
    "active": true,
    "activeMerchants": 25
  },
  "leaderboard": [
    {
      "rank": 1,
      "userId": 123,
      "name": "John Doe",
      "email": "john@example.com",
      "avatarUrl": "https://example.com/avatar.jpg",
      "totalPoints": 1250,
      "periodPoints": 450,
      "monthlyPoints": 450,
      "eventCount": 45,
      "checkInCount": 30,
      "uniqueDealsCheckedIn": 25,
      "uniqueMerchantsVisited": 15,
      "memberSince": "2023-06-15",
      "inTop": true
    }
  ],
  "personalPosition": {
    "rank": 8,
    "userId": 456,
    "name": "Jane Smith",
    "periodPoints": 320,
    "uniqueMerchantsVisited": 10,
    "inTop": false
  },
  "cityStats": {
    "totalUsers": 450,
    "activeUsers": 320,
    "avgPointsPerUser": 145.5,
    "maxPoints": 1250,
    "totalPointsEarned": 65475,
    "totalCheckIns": 1800,
    "uniqueDealsUsed": 85,
    "uniqueMerchantsUsed": 25
  },
  "pagination": {
    "defaultLimit": 5,
    "currentLimit": 5,
    "showMore": false,
    "hasMore": true
  },
  "metadata": {
    "totalShown": 5,
    "limit": 5,
    "includeSelf": true,
    "includeStats": true,
    "queryTime": 195
  }
}
```

### GET /api/leaderboard/analytics
Get comprehensive point distribution and statistical analytics.

**Headers:** `Authorization: Bearer <token>` (optional)

**Query Parameters:**
- `period` (string): Time period (default: 'last_30_days')
- `cityId` (number): Filter by specific city (optional)
- `includeDistribution` (boolean): Include point distribution histogram (default: true)
- `includeTrends` (boolean): Include trend analysis (default: true)

**Response:**
```json
{
  "success": true,
  "period": "last_30_days",
  "dateRange": {
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-01-31T23:59:59.999Z"
  },
  "cityId": null,
  "analytics": {
    "summary": {
      "totalUsers": 1250,
      "activeUsers": 890,
      "inactiveUsers": 360,
      "avgPoints": 125.5,
      "medianPoints": 75.0,
      "maxPoints": 1250,
      "minPoints": 0,
      "stdDevPoints": 180.2,
      "avgEvents": 12.5,
      "avgCheckIns": 8.2,
      "avgUniqueDeals": 6.8,
      "avgUniqueMerchants": 4.5,
      "avgCategoriesUsed": 3.2,
      "p25": 25.0,
      "p50": 75.0,
      "p75": 150.0,
      "p90": 300.0,
      "p95": 500.0,
      "p99": 1000.0
    },
    "distribution": [
      {
        "pointRange": "0",
        "userCount": 360
      },
      {
        "pointRange": "1-10",
        "userCount": 150
      },
      {
        "pointRange": "11-25",
        "userCount": 200
      },
      {
        "pointRange": "26-50",
        "userCount": 180
      },
      {
        "pointRange": "51-100",
        "userCount": 160
      },
      {
        "pointRange": "101-250",
        "userCount": 120
      },
      {
        "pointRange": "251-500",
        "userCount": 50
      },
      {
        "pointRange": "501-1000",
        "userCount": 20
      },
      {
        "pointRange": "1000+",
        "userCount": 10
      }
    ],
    "trends": [
      {
        "date": "2024-01-01",
        "activeUsers": 45,
        "totalEvents": 120,
        "totalPointsEarned": 1250,
        "totalCheckIns": 80,
        "avgActiveUsers7d": 42.5,
        "avgPointsEarned7d": 1150.0
      }
    ]
  },
  "metadata": {
    "includeDistribution": true,
    "includeTrends": true,
    "queryTime": 320
  }
}
```

### GET /api/leaderboard/categories
Get category-based leaderboards showing top users by deal categories.

**Headers:** `Authorization: Bearer <token>` (optional)

**Query Parameters:**
- `period` (string): Time period (default: 'last_30_days')
- `categoryId` (number): Filter by specific deal category (optional)
- `limit` (number): Number of users per category (default: 5, max: 50)
- `showMore` (boolean): Show more entries (default: false, shows 5 entries by default)

**Response:**
```json
{
  "success": true,
  "period": "last_30_days",
  "dateRange": {
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-01-31T23:59:59.999Z"
  },
  "categoryId": null,
  "categories": [
    {
      "categoryId": 1,
      "categoryName": "Food & Beverage",
      "categoryColor": "#FF5733",
      "leaderboard": [
        {
          "rank": 1,
          "userId": 123,
          "name": "John Doe",
          "email": "john@example.com",
          "avatarUrl": "https://example.com/avatar.jpg",
          "totalPoints": 1250,
          "periodPoints": 200,
          "monthlyPoints": 200,
          "eventCount": 20,
          "checkInCount": 15,
          "uniqueDealsCheckedIn": 12
        }
      ]
    }
  ],
  "pagination": {
    "defaultLimit": 5,
    "currentLimit": 5,
    "showMore": false,
    "hasMore": true
  },
  "metadata": {
    "totalCategories": 5,
    "limit": 5,
    "queryTime": 280
  }
}
```

### GET /api/leaderboard/insights
Get advanced insights including user engagement segments and top performers.

**Headers:** `Authorization: Bearer <token>` (optional)

**Query Parameters:**
- `period` (string): Time period (default: 'last_30_days')
- `cityId` (number): Filter by specific city (optional)
- `includePredictions` (boolean): Include predictive insights (default: true)

**Response:**
```json
{
  "success": true,
  "period": "last_30_days",
  "dateRange": {
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-01-31T23:59:59.999Z"
  },
  "cityId": null,
  "insights": {
    "engagementSegments": [
      {
        "engagementSegment": "Inactive",
        "userCount": 360,
        "avgPoints": 0,
        "avgCheckIns": 0,
        "avgUniqueDeals": 0,
        "avgUniqueMerchants": 0
      },
      {
        "engagementSegment": "Low Activity",
        "userCount": 350,
        "avgPoints": 15.5,
        "avgCheckIns": 2.1,
        "avgUniqueDeals": 1.8,
        "avgUniqueMerchants": 1.2
      },
      {
        "engagementSegment": "Moderate Activity",
        "userCount": 300,
        "avgPoints": 65.0,
        "avgCheckIns": 8.5,
        "avgUniqueDeals": 6.2,
        "avgUniqueMerchants": 3.8
      },
      {
        "engagementSegment": "High Activity",
        "userCount": 200,
        "avgPoints": 250.0,
        "avgCheckIns": 25.0,
        "avgUniqueDeals": 18.5,
        "avgUniqueMerchants": 12.0
      },
      {
        "engagementSegment": "Power Users",
        "userCount": 40,
        "avgPoints": 850.0,
        "avgCheckIns": 85.0,
        "avgUniqueDeals": 65.0,
        "avgUniqueMerchants": 35.0
      }
    ],
    "topPerformers": [
      {
        "rank": 1,
        "id": 123,
        "name": "John Doe",
        "avatarUrl": "https://example.com/avatar.jpg",
        "periodPoints": 1250,
        "uniqueMerchantsVisited": 25,
        "uniqueDealsCheckedIn": 30
      }
    ]
  },
  "metadata": {
    "includePredictions": true,
    "queryTime": 250
  }
}
```

## Admin Functions

### City Management

#### GET /api/admin/cities
Get all cities with pagination and filtering.

**Headers:** `Authorization: Bearer <admin_token>`

**Query Parameters:**
- `page` (number): Page number (default 1)
- `limit` (number): Items per page (default 50)
- `active` (boolean): Filter by active status
- `search` (string): Search by name or state
- `state` (string): Filter by state

#### PUT /api/admin/cities/:cityId/active
Update a city's active status.

**Request Body:**
```json
{
  "active": true
}
```

#### POST /api/admin/cities
Create a new city.

**Request Body:**
```json
{
  "name": "New York",
  "state": "NY",
  "active": true
}
```

### Merchant Management

#### GET /api/admin/merchants
Get all merchants with pagination and filtering. Returns dynamic deal counts including total, active, upcoming, and expired deals.

**Query Parameters:**
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 50)
- `status` (string): Filter by merchant status (PENDING, APPROVED, REJECTED, SUSPENDED)
- `search` (string): Search by business name, description, or address

**Response:**
```json
{
  "message": "Merchants retrieved successfully",
  "merchants": [
    {
      "id": 1,
      "businessName": "Joe's Coffee Shop",
      "description": "Local coffee shop with great atmosphere",
      "address": "123 Main St, Atlanta, GA",
      "logoUrl": "https://example.com/logo.jpg",
      "latitude": 33.7490,
      "longitude": -84.3880,
      "status": "APPROVED",
      "phoneNumber": "+1-555-0100",
      "createdAt": "2024-01-15T10:00:00.000Z",
      "updatedAt": "2024-01-20T14:30:00.000Z",
      "owner": {
        "id": 5,
        "email": "joe@coffee.com",
        "name": "Joe Smith"
      },
      "stores": [
        {
          "id": 1,
          "merchantId": 1,
          "cityId": 1,
          "address": "123 Main St",
          "latitude": 33.7490,
          "longitude": -84.3880,
          "active": true,
          "city": {
            "id": 1,
            "name": "Atlanta",
            "state": "GA"
          }
        }
      ],
      "totalDeals": 5,
      "activeDeals": 3,
      "upcomingDeals": 1,
      "expiredDeals": 1,
      "totalStores": 1
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "totalCount": 25,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  }
}
```

**Deal Count Breakdown:**
- `totalDeals`: All deals associated with the merchant
- `activeDeals`: Deals currently valid (current time between startTime and endTime)
- `upcomingDeals`: Deals that haven't started yet (startTime in the future)
- `expiredDeals`: Deals that have ended (endTime in the past)

#### POST /api/admin/merchants/:merchantId/approve
Approve a merchant application.

#### POST /api/admin/merchants/:merchantId/reject
Reject a merchant application.

**Request Body:**
```json
{
  "reason": "Incomplete business information"
}
```

### Admin Performance Analytics

#### Performance Overview
- `GET /api/admin/performance/overview` - Platform-wide performance metrics
- `GET /api/admin/performance/cities` - City performance metrics  
- `GET /api/admin/performance/weekly-chart` - Weekly activity charts
- `GET /api/admin/performance/sales-by-store` - Sales by store ranking
- `GET /api/admin/performance/top-merchants` - Top performing merchants
- `GET /api/admin/performance/top-cities` - Top cities by revenue
- `GET /api/admin/performance/top-categories` - Top categories by deals

#### GET /api/admin/performance/overview
Get platform-wide performance metrics for admin dashboard.

**Query Parameters:**
- `period` (string): Time period - '1d', '7d', '30d', '90d' (default: '7d')
- `cityId` (number): Filter by specific city (optional)
- `merchantId` (number): Filter by specific merchant (optional)

**Response:**
```json
{
  "success": true,
  "period": "7d",
  "dateRange": {
    "from": "2024-01-20T00:00:00.000Z",
    "to": "2024-01-27T00:00:00.000Z"
  },
  "metrics": {
    "grossSales": {
      "value": 12500.50,
      "change": 12.5,
      "trend": "up"
    },
    "orderVolume": {
      "value": 245,
      "change": 8.2,
      "trend": "up"
    },
    "averageOrderValue": {
      "value": 51.02,
      "change": 4.1,
      "trend": "up"
    },
    "totalApprovedMerchants": {
      "value": 15,
      "change": 1.0,
      "trend": "up"
    }
  },
  "filters": {
    "cityId": null,
    "merchantId": null
  }
}
```

#### GET /api/admin/performance/cities
Get city performance metrics with check-in data.

**Query Parameters:**
- `period` (string): Time period - '1d', '7d', '30d' (default: '7d')

**Response:**
```json
{
  "success": true,
  "period": "7d",
  "cities": [
    {
      "id": 1,
      "name": "Atlanta",
      "state": "GA",
      "value": 45,
      "change": 12.5,
      "trend": "up"
    },
    {
      "id": 2,
      "name": "Houston",
      "state": "TX", 
      "value": 32,
      "change": 5.2,
      "trend": "up"
    }
  ]
}
```

#### GET /api/admin/performance/weekly-chart
Get weekly activity chart data for specific city or merchant.

**Query Parameters:**
- `cityId` (number): Filter by city (required if merchantId not provided)
- `merchantId` (number): Filter by merchant (required if cityId not provided)
- `metric` (string): Metric type - 'checkins', 'saves', 'sales' (default: 'checkins')

**Response:**
```json
{
  "success": true,
  "cityId": 1,
  "merchantId": null,
  "metric": "checkins",
  "chartData": {
    "days": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    "data": [12, 15, 8, 22, 18, 25, 14]
  }
}
```

#### GET /api/admin/performance/sales-by-store
Get sales by store ranking with performance metrics.

**Query Parameters:**
- `cityId` (number): Filter by specific city (optional)
- `limit` (number): Number of stores to return (default: 10)
- `period` (string): Time period - '1d', '7d', '30d' (default: '7d')

**Response:**
```json
{
  "success": true,
  "period": "7d",
  "stores": [
    {
      "id": 1,
      "name": "Garden Grove Café & Bistro",
      "city": "Atlanta, GA",
      "sales": 45,
      "change": 15.2,
      "trend": "up"
    },
    {
      "id": 2,
      "name": "Olive & Thyme Ristorante",
      "city": "Atlanta, GA",
      "sales": 32,
      "change": 8.5,
      "trend": "up"
    }
  ]
}
```

#### GET /api/admin/performance/top-merchants
Get top performing merchants by revenue.

**Query Parameters:**
- `limit` (number): Number of merchants to return (default: 10)
- `period` (string): Time period - '1d', '7d', '30d' (default: '7d')

**Response:**
```json
{
  "success": true,
  "period": "7d",
  "merchants": [
    {
      "id": 1,
      "name": "The Corner Bistro",
      "description": "Fine dining restaurant",
      "logoUrl": "https://example.com/logo.jpg",
      "revenue": 2500.75,
      "change": 18.5,
      "trend": "up"
    },
    {
      "id": 2,
      "name": "Zahav",
      "description": "Mediterranean cuisine",
      "logoUrl": null,
      "revenue": 1850.25,
      "change": 12.2,
      "trend": "up"
    }
  ]
}
```

#### GET /api/admin/performance/top-cities
Get top cities by revenue.

**Query Parameters:**
- `limit` (number): Number of cities to return (default: 10)
- `period` (string): Time period - '1d', '7d', '30d' (default: '7d')

**Response:**
```json
{
  "success": true,
  "period": "7d",
  "cities": [
    {
      "id": 1,
      "name": "New York",
      "state": "NY",
      "revenue": 12500.50,
      "change": 22.1,
      "trend": "up"
    },
    {
      "id": 2,
      "name": "Los Angeles",
      "state": "CA",
      "revenue": 8750.25,
      "change": 15.8,
      "trend": "up"
    }
  ]
}
```

#### GET /api/admin/performance/top-categories
Get top categories by deals count.

**Query Parameters:**
- `limit` (number): Number of categories to return (default: 10)
- `period` (string): Time period - '1d', '7d', '30d' (default: '7d')

**Response:**
```json
{
  "success": true,
  "period": "7d",
  "categories": [
    {
      "id": 1,
      "name": "Food & Beverage",
      "description": "Restaurants and food-related deals",
      "icon": "🍽️",
      "color": "#FF6B6B",
      "deals": 45,
      "change": 25.5,
      "trend": "up"
    },
    {
      "id": 2,
      "name": "Entertainment",
      "description": "Movies, shows, and entertainment deals",
      "icon": "🎬",
      "color": "#4ECDC4",
      "deals": 28,
      "change": 12.3,
      "trend": "up"
    }
  ]
}

### Master Data Management

#### Categories
- `GET /api/admin/master-data/categories` - List categories
- `POST /api/admin/master-data/categories` - Create category
- `GET /api/admin/master-data/categories/:id` - Get category
- `PUT /api/admin/master-data/categories/:id` - Update category
- `DELETE /api/admin/master-data/categories/:id` - Delete category

#### Deal Types
- `GET /api/admin/master-data/deal-types` - List deal types
- `POST /api/admin/master-data/deal-types` - Create deal type

#### Point Event Types
- `GET /api/admin/master-data/point-event-types` - List point event types
- `POST /api/admin/master-data/point-event-types` - Create point event type

## Customer Management

### GET /api/admin/customers/overview
Get customer management KPIs for admin dashboard.

**Query Parameters:**
- `period` (optional): Time period - `1d`, `7d`, `30d`, `90d` (default: `30d`)
- `cityId` (optional): Filter by city ID
- `state` (optional): Filter by state

**Response:**
```json
{
  "success": true,
  "period": "30d",
  "dateRange": {
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-01-31T00:00:00.000Z"
  },
  "metrics": {
    "totalCustomers": {
      "value": 1247,
      "change": 12.5,
      "trend": "up"
    },
    "paidMembers": {
      "value": 324,
      "change": 8.2,
      "trend": "up"
    },
    "totalSpend": {
      "value": 45230.50,
      "change": 15.3,
      "trend": "up"
    },
    "averageSpend": {
      "value": 36.28,
      "change": 2.1,
      "trend": "up"
    }
  },
  "filters": {
    "cityId": null,
    "state": null
  }
}
```

**Description:** Returns key performance indicators for customer management including total customers, paid members, total spend, and average spend with period-over-period comparison.

### GET /api/admin/customers
Get customer list with search and filtering capabilities.

**Query Parameters:**
- `page` (optional): Page number (default: `1`)
- `limit` (optional): Items per page (default: `50`)
- `search` (optional): Search by name or email
- `cityId` (optional): Filter by city ID
- `state` (optional): Filter by state
- `memberType` (optional): Filter by member type - `all`, `paid`, `free` (default: `all`)
- `sortBy` (optional): Sort field - `lastActive`, `totalSpend`, `points`, `createdAt` (default: `lastActive`)
- `sortOrder` (optional): Sort order - `asc`, `desc` (default: `desc`)

**Response:**
```json
{
  "success": true,
  "customers": [
    {
      "id": 1,
      "name": "John Doe",
      "email": "john@gmail.com",
      "location": "New York, NY",
      "totalSpend": 150.75,
      "points": 1250,
      "memberType": "paid",
      "lastActive": "2024-01-20",
      "createdAt": "2023-12-15"
    },
    {
      "id": 2,
      "name": "Jane Smith",
      "email": "jane@gmail.com",
      "location": "Atlanta, GA",
      "totalSpend": 80.20,
      "points": 650,
      "memberType": "free",
      "lastActive": "2024-01-19",
      "createdAt": "2024-01-10"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "totalCount": 1247,
    "totalPages": 25,
    "hasNext": true,
    "hasPrev": false
  },
  "filters": {
    "search": null,
    "cityId": null,
    "state": null,
    "memberType": "all",
    "sortBy": "lastActive",
    "sortOrder": "desc"
  }
}
```

**Description:** Returns a paginated list of customers with comprehensive filtering, sorting, and search capabilities. Supports searching by name or email and filtering by location and member type.

### GET /api/admin/customers/:customerId
Get detailed information about a specific customer.

**Path Parameters:**
- `customerId`: Customer ID

**Response:**
```json
{
  "success": true,
  "customer": {
    "id": 1,
    "name": "John Doe",
    "email": "john@gmail.com",
    "location": "New York, NY",
    "memberType": "paid",
    "points": 1250,
    "monthlyPoints": 850,
    "totalSpend": 150.75,
    "monthlySpend": 45.20,
    "totalTransactions": 8,
    "totalDealSaves": 12,
    "totalCheckIns": 15,
    "lastActive": "2024-01-20T10:30:00.000Z",
    "createdAt": "2023-12-15T08:00:00.000Z",
    "updatedAt": "2024-01-20T10:30:00.000Z"
  },
  "activity": {
    "recentSaves": [
      {
        "id": 45,
        "title": "50% Off Pizza",
        "merchant": "Tony's Pizzeria",
        "savedAt": "2024-01-20T10:30:00.000Z"
      }
    ],
    "recentCheckIns": [
      {
        "id": 23,
        "title": "Free Coffee with Purchase",
        "merchant": "Coffee Corner",
        "checkedInAt": "2024-01-19T15:20:00.000Z"
      }
    ],
    "recentTransactions": [
      {
        "id": 12,
        "deal": "50% Off Pizza",
        "merchant": "Tony's Pizzeria",
        "amount": 25.50,
        "transactionDate": "2024-01-18T19:45:00.000Z"
      }
    ]
  }
}
```

**Description:** Returns comprehensive details about a specific customer including profile information, spending metrics, engagement data, and recent activity history.

### GET /api/admin/customers/analytics
Get customer analytics and insights for admin dashboard.

**Query Parameters:**
- `period` (optional): Time period - `1d`, `7d`, `30d`, `90d` (default: `30d`)

**Response:**
```json
{
  "success": true,
  "period": "30d",
  "dateRange": {
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-01-31T00:00:00.000Z"
  },
  "overview": {
    "totalCustomers": 1247,
    "newCustomers": 89,
    "activeCustomers": 456,
    "inactiveCustomers": 791,
    "engagementRate": "36.6"
  },
  "topCustomers": [
    {
      "id": 1,
      "name": "John Doe",
      "email": "john@gmail.com",
      "points": 1250,
      "totalSpend": 450.75
    },
    {
      "id": 23,
      "name": "Sarah Wilson",
      "email": "sarah@outlook.com",
      "points": 980,
      "totalSpend": 380.20
    }
  ],
  "engagement": {
    "averagePoints": 245.6,
    "averageMonthlyPoints": 89.3,
    "maxPoints": 2500,
    "maxMonthlyPoints": 1200
  },
  "locationDistribution": [
    {
      "location": "New York, NY",
      "count": 234
    },
    {
      "location": "Los Angeles, CA",
      "count": 189
    }
  ]
}
```

**Description:** Returns comprehensive customer analytics including overview metrics, top spending customers, engagement statistics, and geographic distribution of customers.

## Media Upload

### POST /api/media/upload
Upload files to Cloudinary.

**Headers:** `Authorization: Bearer <token>`

**Content-Type:** `multipart/form-data`

**Form Data:**
- `file`: Image file
- `context`: Upload context (e.g., "user_avatar", "business_logo", "deal_image")

**Response:**
```json
{
  "message": "File uploaded successfully.",
  "url": "https://res.cloudinary.com/example/image/upload/v1234567890/context/user/1234567890.jpg",
  "publicId": "context/user/1234567890"
}
```

## Health & Monitoring

### GET /api/health
Basic health check.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "service": "GeolocationMVPBackend",
  "version": "1.0.0"
}
```

### GET /api/health/detailed
Detailed health check with metrics.

### GET /api/ready
Readiness probe for Kubernetes.

### GET /api/live
Liveness probe for Kubernetes.

### GET /api/metrics
Get application metrics.

## Data Models

### User
```typescript
{
  id: number;
  email: string;
  name?: string;
  avatarUrl?: string;
  password: string;
  role: 'USER' | 'MERCHANT' | 'ADMIN';
  points: number;
  monthlyPoints: number;
  referralCode?: string;
  referredByUserId?: number;
  birthday?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### Merchant
```typescript
{
  id: number;
  businessName: string;
  address: string;
  description?: string;
  logoUrl?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  latitude?: number;
  longitude?: number;
  city?: string;
  ownerId: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Deal
```typescript
{
  id: number;
  title: string;
  description: string;
  imageUrls: string[];
  discountPercentage?: number;
  discountAmount?: number;
  categoryId: number;
  dealTypeId: number;
  recurringDays?: string;
  startTime: Date;
  endTime: Date;
  redemptionInstructions: string;
  offerTerms?: string;
  kickbackEnabled: boolean;
  merchantId: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Deal Categories
- `FOOD_AND_BEVERAGE`
- `RETAIL`
- `ENTERTAINMENT`
- `HEALTH_AND_FITNESS`
- `BEAUTY_AND_SPA`
- `AUTOMOTIVE`
- `TRAVEL`
- `EDUCATION`
- `TECHNOLOGY`
- `HOME_AND_GARDEN`
- `OTHER`

### Deal Types
- `STANDARD`
- `HAPPY_HOUR`
- `RECURRING`

## Error Handling

### Standard Error Response
```json
{
  "error": "Error message",
  "message": "Detailed error description"
}
```

### Validation Error Response
```json
{
  "errors": [
    {
      "code": "invalid_type",
      "expected": "string",
      "received": "number",
      "path": ["email"],
      "message": "Expected string, received number"
    }
  ]
}
```

### HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `500` - Internal Server Error
- `503` - Service Unavailable

## Rate Limiting

- **Rate Limit**: 200 requests per 15 minutes per IP
- **Headers**: Rate limit information included in response headers
- **Exemptions**: Health check endpoints are not rate limited

## Environment Variables

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/geolocation_mvp
JWT_SECRET=your-secret-key
PORT=3000
SIGNUP_POINTS=50
CHECKIN_POINTS=10
FIRST_CHECKIN_BONUS_POINTS=25
CHECKIN_RADIUS_METERS=100
```

## Development

### Running the Server
```bash
npm run dev    # Development with hot reload
npm run build  # Build TypeScript
npm start      # Production start
npm test       # Run tests
```

### Database Management
```bash
npx prisma migrate dev    # Run migrations
npx prisma generate       # Generate Prisma client
npx prisma studio         # Open Prisma Studio
```






