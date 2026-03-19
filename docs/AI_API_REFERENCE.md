# YOHOP AI API Reference

> Base URL: `/api/ai`
> All endpoints (except `/status`) require Bearer token authentication.

---

## 1. AI Status Check

```
GET /api/ai/status
```

**Auth:** None

**Response:**
```json
{
  "aiEnabled": true
}
```

---

## 2. Merchant Onboarding Suggestion

Auto-fills merchant profile fields from a free-text business description.

```
POST /api/ai/merchant/suggest
```

**Auth:** Bearer token (any authenticated user)

**Request Body:**
```json
{
  "description": "I run a rooftop bar in downtown Manhattan, cocktails and tapas, lively vibe, open till 2am"
}
```

**Response:**
```json
{
  "suggestion": {
    "businessType": "LOCAL",
    "description": "A vibrant rooftop bar offering handcrafted cocktails and artisan tapas with stunning city views. Open late into the night for an unforgettable nightlife experience.",
    "vibeTags": ["rooftop", "nightlife", "cocktails", "lively", "late night"],
    "amenities": ["outdoor seating", "bar", "late night", "city views"],
    "priceRange": "$$$",
    "suggestedCategory": "Bar & Nightlife",
    "keywords": ["rooftop bar", "cocktails", "tapas", "manhattan", "nightlife", "late night drinks"]
  }
}
```

**Frontend Usage:** Pre-fill the merchant registration form. User can edit any field before submitting.

---

## 3. AI Deal Generator

Generates a structured deal from a merchant's plain-text description of what they want to offer.

```
POST /api/ai/deals/generate
```

**Auth:** Bearer token (must have merchant profile)

**Request Body:**
```json
{
  "intent": "Happy hour, half price cocktails, 5pm to 8pm on weekdays"
}
```

**Response:**
```json
{
  "suggestion": {
    "title": "Happy Hour Cocktails - 50% Off",
    "description": "Beat the evening rush with half-price cocktails every weekday. Enjoy our full cocktail menu at 50% off from 5 PM to 8 PM.",
    "discountPercentage": 50,
    "discountAmount": null,
    "isFlashSale": true,
    "redemptionInstructions": "Show this deal on your phone to your bartender before ordering.",
    "suggestedDurationHours": 3,
    "suggestedTags": ["happy hour", "cocktails", "drinks", "weekday special"],
    "bestDayOfWeek": "Any",
    "bestTimeSlot": "Evening"
  }
}
```

**Frontend Usage:** Pre-fill the deal creation form. Merchant reviews, edits if needed, and confirms to create.

---

## 4. AI Receptionist / Chatbot

Context-aware conversational assistant. Knows the user's points, coins, loyalty tier, and nearby deals/events.

```
POST /api/ai/chat
```

**Auth:** Bearer token (any authenticated user)

**Request Body:**
```json
{
  "message": "What deals are near me?",
  "lat": 40.7128,
  "lng": -74.0060,
  "history": [
    { "role": "user", "content": "Hey!" },
    { "role": "model", "content": "Hey there! How can I help you today?" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | User's message (max 500 chars) |
| `lat` | number | No | User latitude (enables nearby deal/event lookup) |
| `lng` | number | No | User longitude |
| `history` | array | No | Previous conversation turns for multi-turn context |

**History item format:**
```json
{ "role": "user" | "model", "content": "message text" }
```

**Response:**
```json
{
  "reply": "Hey! There are a couple of great deals near you right now. Marco's Italian has 30% off all pasta dishes, and The Rooftop Lounge is running a happy hour with half-price cocktails until 8 PM. Want me to tell you more about either one?"
}
```

**Frontend Usage:**
- Build a chat UI with message bubbles
- Send `lat`/`lng` from device GPS for location-aware responses
- Maintain `history` array client-side and pass it with each request
- Each user message: `{ role: "user", content: "..." }`
- Each AI response: `{ role: "model", content: "..." }`

---

## 5. AI Menu Parser

Extracts structured menu items from raw text (pasted, typed, or copied from another source).

```
POST /api/ai/menu/parse
```

**Auth:** Bearer token (must have merchant profile)

**Request Body:**
```json
{
  "text": "Margherita Pizza $12.99\nCaesar Salad $8.50\nGarlic Bread $5\nTiramisu $7.99\nEspresso $3.50\nCoke $2"
}
```

**Response:**
```json
{
  "items": [
    {
      "name": "Margherita Pizza",
      "description": "Classic pizza with tomato sauce, mozzarella, and fresh basil",
      "price": 12.99,
      "category": "Main Course",
      "isAvailable": true,
      "preparationTime": 15
    },
    {
      "name": "Caesar Salad",
      "description": "Romaine lettuce with Caesar dressing and croutons",
      "price": 8.50,
      "category": "Appetizers",
      "isAvailable": true,
      "preparationTime": 5
    }
  ],
  "count": 6
}
```

**Frontend Usage:** Show parsed items in a table/list. Merchant reviews, edits prices/descriptions, then bulk-adds to their menu.

---

## 6. Merchant Business Insights

AI-generated analysis of merchant's deal performance, loyalty stats, and actionable recommendations.

```
GET /api/ai/merchant/insights
```

**Auth:** Bearer token (must be approved merchant)

**Response:**
```json
{
  "insights": {
    "summary": "Your business has created 15 deals across 3 locations. Flash sales perform 3x better than regular deals based on customer saves.",
    "topInsights": [
      "Flash sale deals get 3x more saves than regular deals",
      "Your top deal 'Half Price Wings' has been saved 245 times",
      "You have no loyalty program set up — merchants with loyalty programs see 40% more repeat visits"
    ],
    "recommendations": [
      {
        "type": "loyalty",
        "title": "Launch a Loyalty Program",
        "description": "Set up a points-per-dollar loyalty program to drive repeat visits. Start with 10 points per $1 spent."
      },
      {
        "type": "deal",
        "title": "Run a Weekend Flash Sale",
        "description": "Your flash sales outperform regular deals. Try a Saturday afternoon flash sale on your best-selling items."
      }
    ],
    "bestPerformingDealType": "Flash Sales",
    "growthOpportunity": "Consider creating a bounty deal — referral-based deals can bring in new customers at zero upfront cost."
  }
}
```

**Frontend Usage:** Display as a dashboard card or insights page for the merchant panel.

---

## 7. AI Nudge Personalization (Admin Only)

Generates personalized push notification content using user context.

```
POST /api/ai/nudge/personalize
```

**Auth:** Bearer token (admin only)

**Request Body:**
```json
{
  "userId": 42,
  "nudgeType": "INACTIVITY",
  "deal": {
    "title": "2-for-1 Pasta Night",
    "merchant": "Marco's Italian",
    "discount": "50% off"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | number | Yes | Target user ID |
| `nudgeType` | string | Yes | One of: `INACTIVITY`, `NEARBY_DEAL`, `STREAK_REMINDER`, `HAPPY_HOUR_ALERT`, `WEATHER_BASED` |
| `deal` | object | No | Optional nearby deal context for richer messages |

**Response:**
```json
{
  "nudge": {
    "title": "We miss you!",
    "body": "Marco's Italian has 2-for-1 pasta tonight — you're 200 pts from Platinum!",
    "emoji": "🍝✨"
  }
}
```

---

## Error Responses

All endpoints return consistent error format:

```json
{ "error": "Error message string" }
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request (missing/invalid fields) |
| 401 | Not authenticated |
| 403 | Not authorized (wrong role) |
| 500 | AI generation failed |
| 503 | AI features not configured (no API key) |

---

## Environment Setup

Backend requires this env variable for AI features:

```
GEMINI_API_KEY=your-google-gemini-api-key
```

Get a free key at: https://aistudio.google.com/app/apikey

When the key is not set, `GET /api/ai/status` returns `{ "aiEnabled": false }` and all other endpoints return 503.
