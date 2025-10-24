# Check-In API Documentation

## Overview

The Check-In API allows merchants to view detailed information about users who have tapped in (checked in) at their locations. This includes user profile pictures, check-in history, and analytics.

## Authentication

All merchant check-in endpoints require:
- Valid JWT token in Authorization header: `Bearer <token>`
- User must be a merchant (have a merchant profile)

## Endpoints

### 1. Get Check-Ins List

**Endpoint:** `GET /api/merchants/check-ins`

**Description:** Get a paginated list of all check-ins for the merchant with complete user details including profile pictures.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | number | No | 1 | Page number for pagination |
| `limit` | number | No | 20 | Items per page (max: 100) |
| `dealId` | number | No | - | Filter by specific deal ID |
| `startDate` | string | No | - | Filter check-ins from this date (ISO format) |
| `endDate` | string | No | - | Filter check-ins until this date (ISO format) |
| `sortBy` | string | No | createdAt | Sort field (`createdAt`, `distanceMeters`) |
| `sortOrder` | string | No | desc | Sort order (`asc`, `desc`) |

**Example Request:**
```bash
GET /api/merchants/check-ins?page=1&limit=20&sortBy=createdAt&sortOrder=desc
Authorization: Bearer <your-jwt-token>
```

**Example Response:**
```json
{
  "success": true,
  "checkIns": [
    {
      "id": 123,
      "userId": 456,
      "user": {
        "id": 456,
        "name": "John Doe",
        "email": "john@example.com",
        "avatarUrl": "https://cloudinary.com/user/profile.jpg",
        "profilePicture": "https://cloudinary.com/user/profile.jpg",
        "points": 250
      },
      "deal": {
        "id": 789,
        "title": "50% Off Lunch Special",
        "description": "Get 50% off on all lunch items",
        "imageUrl": "https://cloudinary.com/deal/image.jpg",
        "category": "FOOD_AND_BEVERAGE"
      },
      "location": {
        "latitude": 40.7128,
        "longitude": -74.0060,
        "distanceMeters": 45.67
      },
      "checkedInAt": "2025-10-25T14:30:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalCount": 100,
    "limit": 20,
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "filters": {
    "dealId": null,
    "startDate": null,
    "endDate": null,
    "sortBy": "createdAt",
    "sortOrder": "desc"
  }
}
```

**Response Fields:**

- `checkIns`: Array of check-in objects
  - `id`: Check-in ID
  - `userId`: User's ID
  - `user`: User information object
    - `id`: User ID
    - `name`: User's display name
    - `email`: User's email
    - `avatarUrl`: User's profile picture URL (null if not set)
    - `profilePicture`: Alias for avatarUrl (for easier frontend use)
    - `points`: User's total points
  - `deal`: Deal information
    - `id`: Deal ID
    - `title`: Deal title
    - `description`: Deal description
    - `imageUrl`: First image of the deal
    - `category`: Deal category name
  - `location`: Check-in location data
    - `latitude`: User's check-in latitude
    - `longitude`: User's check-in longitude
    - `distanceMeters`: Distance from merchant location in meters
  - `checkedInAt`: ISO timestamp of check-in
- `pagination`: Pagination metadata
- `filters`: Applied filters

---

### 2. Get Check-In Statistics

**Endpoint:** `GET /api/merchants/check-ins/stats`

**Description:** Get analytics and statistics about check-ins including total count, unique users, top deals, and recent activity.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dealId` | number | No | Filter stats by specific deal |
| `startDate` | string | No | Filter from this date (ISO format) |
| `endDate` | string | No | Filter until this date (ISO format) |

**Example Request:**
```bash
GET /api/merchants/check-ins/stats?startDate=2025-10-01&endDate=2025-10-31
Authorization: Bearer <your-jwt-token>
```

**Example Response:**
```json
{
  "success": true,
  "stats": {
    "totalCheckIns": 250,
    "uniqueUsers": 85,
    "averageCheckInsPerUser": 2.94
  },
  "topDeals": [
    {
      "dealId": 789,
      "dealTitle": "50% Off Lunch Special",
      "dealImageUrl": "https://cloudinary.com/deal/image.jpg",
      "checkInCount": 45
    },
    {
      "dealId": 790,
      "dealTitle": "Happy Hour 2-for-1",
      "dealImageUrl": "https://cloudinary.com/deal/happy-hour.jpg",
      "checkInCount": 38
    }
  ],
  "recentCheckIns": [
    {
      "id": 500,
      "user": {
        "id": 456,
        "name": "John Doe",
        "avatarUrl": "https://cloudinary.com/user/profile.jpg"
      },
      "deal": {
        "id": 789,
        "title": "50% Off Lunch Special"
      },
      "checkedInAt": "2025-10-25T14:30:00.000Z"
    }
  ],
  "filters": {
    "dealId": null,
    "startDate": "2025-10-01",
    "endDate": "2025-10-31"
  }
}
```

**Response Fields:**

- `stats`: Overall statistics
  - `totalCheckIns`: Total number of check-ins
  - `uniqueUsers`: Number of unique users who checked in
  - `averageCheckInsPerUser`: Average check-ins per user
- `topDeals`: Array of top 10 deals by check-in count
  - `dealId`: Deal ID
  - `dealTitle`: Deal title
  - `dealImageUrl`: Deal image URL
  - `checkInCount`: Number of check-ins for this deal
- `recentCheckIns`: Array of 5 most recent check-ins
  - `id`: Check-in ID
  - `user`: Basic user info (id, name, avatarUrl)
  - `deal`: Basic deal info (id, title)
  - `checkedInAt`: ISO timestamp
- `filters`: Applied filters

---

## Use Cases

### 1. Display Check-In Feed
Use the list endpoint to show a real-time feed of customers checking in:
```javascript
// Fetch recent check-ins
const response = await fetch('/api/merchants/check-ins?limit=10&sortBy=createdAt&sortOrder=desc', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const data = await response.json();

// Display each check-in with user profile picture
data.checkIns.forEach(checkIn => {
  displayCheckInCard({
    userName: checkIn.user.name,
    userAvatar: checkIn.user.profilePicture || '/default-avatar.png',
    dealTitle: checkIn.deal.title,
    time: checkIn.checkedInAt,
    distance: checkIn.location.distanceMeters
  });
});
```

### 2. Deal Performance Analysis
```javascript
// Get stats for a specific deal
const response = await fetch('/api/merchants/check-ins/stats?dealId=789', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const data = await response.json();
console.log(`Deal has ${data.stats.totalCheckIns} check-ins from ${data.stats.uniqueUsers} users`);
```

### 3. Date Range Reports
```javascript
// Get check-ins for October 2025
const response = await fetch('/api/merchants/check-ins?startDate=2025-10-01&endDate=2025-10-31', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

---

## Error Responses

### 401 Unauthorized
```json
{
  "error": "Merchant authentication required"
}
```

### 400 Bad Request
```json
{
  "error": "Invalid page number"
}
```
or
```json
{
  "error": "Limit must be between 1 and 100"
}
```
or
```json
{
  "error": "Invalid deal ID"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

---

## Best Practices

1. **Profile Pictures**: Always provide a fallback/default avatar image if `avatarUrl` or `profilePicture` is `null`
2. **Pagination**: Use pagination for large datasets to improve performance
3. **Filtering**: Combine filters (dealId, date range) for specific insights
4. **Caching**: Consider caching stats data on the frontend for dashboard views
5. **Real-time Updates**: Poll the endpoint periodically (e.g., every 30 seconds) for live check-in feeds

---

## Related APIs

- **User Check-In API**: `POST /api/users/check-in` - Users tap in at merchant locations
- **Deals API**: `GET /api/merchants/deals` - View and manage deals
- **Analytics API**: `GET /api/merchants/analytics/performance-custom` - Comprehensive performance metrics

---

## Notes

- Check-in distance is calculated using the Haversine formula
- User profile pictures are stored in Cloudinary
- Check-ins are associated with both deals and merchants for detailed tracking
- The `profilePicture` field is an alias for `avatarUrl` to make frontend integration easier
