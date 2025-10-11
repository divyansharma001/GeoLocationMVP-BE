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
7. [User Interactions](#user-interactions)
8. [Leaderboard](#leaderboard)
9. [Admin Functions](#admin-functions)
10. [Media Upload](#media-upload)
11. [Health & Monitoring](#health--monitoring)
12. [Data Models](#data-models)
13. [Error Handling](#error-handling)

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
  "latitude": 40.7128,
  "longitude": -74.0060,
  "cityId": 1
}
```

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

#### PUT /api/merchants/me/menu/item/:itemId
Update a menu item.

#### DELETE /api/merchants/me/menu/item/:itemId
Delete a menu item.

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
Get detailed information about a specific deal.

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

## Leaderboard

### GET /api/leaderboard
Get leaderboard rankings.

**Query Parameters:**
- `period` (string): Time period (day, week, month, year, all_time)
- `limit` (number): Number of entries (1-50, default 10)
- `includeSelf` (boolean): Include current user if not in top (default true)
- `year` (number): Specific year for custom period
- `month` (number): Specific month for custom period

**Response:**
```json
{
  "period": {
    "granularity": "month",
    "start": "2024-01-01T00:00:00Z",
    "endExclusive": "2024-02-01T00:00:00Z",
    "label": "January 2024"
  },
  "top": [
    {
      "userId": 1,
      "name": "John Doe",
      "periodPoints": 150,
      "totalPoints": 300,
      "rank": 1
    }
  ],
  "me": {
    "userId": 2,
    "name": "Jane Smith",
    "periodPoints": 75,
    "totalPoints": 200,
    "rank": 5,
    "inTop": false
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
Get all merchants with pagination and filtering.

**Query Parameters:**
- `page` (number): Page number
- `limit` (number): Items per page
- `status` (string): Filter by merchant status
- `search` (string): Search by business name, description, or address

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






