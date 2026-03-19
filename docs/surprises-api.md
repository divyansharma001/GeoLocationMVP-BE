# Surprises API — Frontend Integration Guide

> **Base URL:** `/api`
> **Auth:** All endpoints require `Authorization: Bearer <token>` unless noted.

---

## Overview

A **Surprise Deal** is a deal where the exact offer is hidden until the user unlocks it. Users see a teaser hint and must satisfy a trigger condition (proximity, time, check-in, or random slot) to reveal the full deal. After revealing, they have a limited redemption window.

### Surprise Types

| Type | How it Unlocks |
|------|----------------|
| `LOCATION_BASED` | User must be within `revealRadiusMeters` of the merchant |
| `TIME_BASED` | Automatically unlockable after `revealAt` datetime |
| `ENGAGEMENT_BASED` | User must have checked in at the merchant within 24 hours |
| `RANDOM_DROP` | First-come-first-served slot pool (`surpriseTotalSlots`) |

---

## User-Facing Endpoints

---

### 1. Get Nearby Surprises

```
GET /api/surprises/nearby
```

Returns teaser cards for active surprise deals near the user. **No deal details are exposed** — only hints.

**Query Parameters**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `lat` | number | Yes | User's latitude |
| `lng` | number | Yes | User's longitude |
| `radius` | number | No | Search radius in km (default: `10`) |

**Example Request**
```
GET /api/surprises/nearby?lat=40.7128&lng=-74.0060&radius=5
```

**Example Response**
```json
{
  "surprises": [
    {
      "id": 42,
      "hint": "Something bubbly awaits after sundown… 🍾",
      "surpriseType": "TIME_BASED",
      "merchantName": "The Rooftop Bar",
      "merchantLogoUrl": "https://cdn.example.com/logo.jpg",
      "distanceMeters": 320,
      "isRevealed": false,
      "isExpired": false,
      "isRedeemed": false,
      "revealAt": "2026-03-14T18:00:00.000Z"
    },
    {
      "id": 55,
      "hint": "Get close enough and the secret is yours 📍",
      "surpriseType": "LOCATION_BASED",
      "merchantName": "Burger Joint",
      "merchantLogoUrl": "https://cdn.example.com/burger.jpg",
      "distanceMeters": 87,
      "isRevealed": false,
      "isExpired": false,
      "isRedeemed": false,
      "revealRadiusMeters": 100
    },
    {
      "id": 60,
      "hint": "You cracked it! Tap to claim your reward 🎉",
      "surpriseType": "RANDOM_DROP",
      "merchantName": "Sushi Palace",
      "merchantLogoUrl": "https://cdn.example.com/sushi.jpg",
      "distanceMeters": 210,
      "isRevealed": true,
      "isExpired": false,
      "isRedeemed": false,
      "expiresAt": "2026-03-14T20:30:00.000Z"
    }
  ],
  "count": 3
}
```

**Frontend Usage**

- Poll or call this on map load / location update.
- Render each item as a mystery card showing only `hint`, `merchantName`, and distance.
- Use `isRevealed` to determine whether to show a "Reveal" CTA or a "Redeem" CTA.
- For `TIME_BASED`: show a countdown to `revealAt`.
- For `LOCATION_BASED`: show a "Get closer!" prompt with `revealRadiusMeters` and current distance.

---

### 2. Reveal a Surprise

```
POST /api/surprises/:dealId/reveal
```

Validates the unlock condition and, if met, returns the full deal details. Creates a timed redemption window.

**URL Params**

| Param | Type | Description |
|-------|------|-------------|
| `dealId` | number | The surprise deal ID from the nearby list |

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `lat` | number | Conditional | Required for `LOCATION_BASED` surprises |
| `lng` | number | Conditional | Required for `LOCATION_BASED` surprises |

```json
{
  "lat": 40.7128,
  "lng": -74.0060
}
```

**Success Response `200`**
```json
{
  "message": "Surprise revealed!",
  "revealId": 301,
  "expiresAt": "2026-03-14T20:00:00.000Z",
  "deal": {
    "id": 42,
    "title": "50% Off All Cocktails",
    "description": "Half-price cocktails all evening. Valid on the full menu bar selection.",
    "discountPercentage": 50,
    "discountAmount": null,
    "redemptionInstructions": "Show this screen to your server before ordering.",
    "startTime": "2026-03-14T17:00:00.000Z",
    "endTime": "2026-03-14T23:00:00.000Z",
    "merchant": {
      "id": 7,
      "businessName": "The Rooftop Bar",
      "latitude": 40.7130,
      "longitude": -74.0065
    },
    "category": { "name": "Drinks", "icon": "🍹" },
    "dealType": { "name": "Happy Hour" }
  }
}
```

**Error Responses**

| Status | Reason |
|--------|--------|
| `400` | Trigger condition not met (e.g., too far away, time not reached) |
| `400` | All slots claimed (`RANDOM_DROP`) |
| `200` + `alreadyRevealed: true` | User already revealed this deal and it's still active |
| `404` | Deal not found |

**Error body example**
```json
{
  "error": "You need to be within 100m of Burger Joint to reveal this surprise. You are 312m away."
}
```

**Frontend Usage**

- Call this when user taps "Reveal" on a mystery card.
- On success: animate the reveal (flip card / confetti), show full deal details, and start a countdown timer to `expiresAt`.
- On `400`: show the reason (e.g., "Move closer!", "Come back at 6pm").
- Store `expiresAt` locally to drive the countdown UI.

---

### 3. Get a Revealed Surprise Deal

```
GET /api/surprises/:dealId
```

Returns full deal details for a deal the user has already revealed. Use this to re-fetch deal info (e.g., on app resume).

**Requires:** An active, non-expired reveal for this user.

**Success Response `200`**
```json
{
  "deal": {
    "id": 42,
    "title": "50% Off All Cocktails",
    "description": "Half-price cocktails all evening.",
    "discountPercentage": 50,
    "redemptionInstructions": "Show this screen to your server before ordering.",
    "merchant": {
      "id": 7,
      "businessName": "The Rooftop Bar",
      "logoUrl": "https://cdn.example.com/logo.jpg",
      "latitude": 40.713,
      "longitude": -74.0065
    },
    "category": { "name": "Drinks", "icon": "🍹", "color": "#4A90E2" },
    "dealType": { "name": "Happy Hour" }
  },
  "reveal": {
    "revealedAt": "2026-03-14T19:01:00.000Z",
    "expiresAt": "2026-03-14T20:01:00.000Z",
    "redeemed": false,
    "redeemedAt": null
  }
}
```

**Error Responses**

| Status | Reason |
|--------|--------|
| `403` | User has not revealed this deal |
| `410` | Reveal window has expired |

---

### 4. Redeem a Surprise Deal

```
POST /api/surprises/:dealId/redeem
```

Marks the deal as redeemed. Call this when the user confirms they are using the deal (e.g., taps "I'm using this now").

**Requires:** An active, non-expired, non-redeemed reveal.

**Success Response `200`**
```json
{
  "message": "Surprise deal redeemed successfully!"
}
```

**Error Responses**

| Status | Reason |
|--------|--------|
| `400` | Not yet revealed |
| `400` | Already redeemed |
| `400` | Reveal window expired |

**Frontend Usage**

- Show a confirmation dialog ("Are you sure you want to redeem now? This cannot be undone.") before calling.
- On success: show a "Redeemed!" state with a checkmark. Prevent further redemption attempts.

---

### 5. My Reveal History

```
GET /api/surprises/my/reveals
```

Returns the authenticated user's full reveal history (paginated).

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Items per page (max 50) |

**Example Response `200`**
```json
{
  "reveals": [
    {
      "id": 301,
      "revealedAt": "2026-03-14T19:01:00.000Z",
      "expiresAt": "2026-03-14T20:01:00.000Z",
      "redeemed": true,
      "redeemedAt": "2026-03-14T19:45:00.000Z",
      "deal": {
        "id": 42,
        "title": "50% Off All Cocktails",
        "surpriseHint": "Something bubbly awaits after sundown… 🍾",
        "surpriseType": "TIME_BASED",
        "discountPercentage": 50,
        "discountAmount": null,
        "merchant": {
          "businessName": "The Rooftop Bar",
          "logoUrl": "https://cdn.example.com/logo.jpg"
        }
      }
    }
  ],
  "total": 12,
  "page": 1,
  "limit": 20
}
```

---

## Merchant Endpoints

---

### 6. Create a Surprise Deal

```
POST /api/merchant/surprises
```

**Auth:** Approved merchant token required.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Shown after reveal |
| `description` | string | Yes | Shown after reveal |
| `categoryId` | number | Yes | Deal category ID |
| `dealTypeId` | number | Yes | Deal type ID |
| `startTime` | ISO datetime | Yes | When the surprise becomes active |
| `endTime` | ISO datetime | Yes | When the surprise expires |
| `redemptionInstructions` | string | Yes | How to redeem |
| `surpriseType` | string | Yes | `LOCATION_BASED` \| `TIME_BASED` \| `ENGAGEMENT_BASED` \| `RANDOM_DROP` |
| `surpriseHint` | string | No | Teaser text shown before reveal |
| `discountPercentage` | number | No | e.g. `30` for 30% off |
| `discountAmount` | number | No | e.g. `5` for $5 off |
| `revealRadiusMeters` | number | Conditional | Required for `LOCATION_BASED` |
| `revealAt` | ISO datetime | Conditional | Required for `TIME_BASED` |
| `revealDurationMinutes` | number | No | How long after reveal user has to redeem (default: `60`) |
| `surpriseTotalSlots` | number | No | Max users who can reveal. Omit for unlimited |

**Example Body**
```json
{
  "title": "50% Off All Cocktails",
  "description": "Half-price cocktails all evening on our full bar menu.",
  "categoryId": 3,
  "dealTypeId": 2,
  "startTime": "2026-03-14T17:00:00.000Z",
  "endTime": "2026-03-14T23:00:00.000Z",
  "redemptionInstructions": "Show this screen to your server before ordering.",
  "surpriseType": "TIME_BASED",
  "surpriseHint": "Something bubbly awaits after sundown… 🍾",
  "discountPercentage": 50,
  "revealAt": "2026-03-14T18:00:00.000Z",
  "revealDurationMinutes": 120,
  "surpriseTotalSlots": 50
}
```

**Success Response `201`**
```json
{
  "message": "Surprise deal created.",
  "deal": { "id": 42, "title": "50% Off All Cocktails", ... }
}
```

---

### 7. List My Surprise Deals

```
GET /api/merchant/surprises
```

Returns all surprise deals for the authenticated merchant with slot usage stats.

**Example Response `200`**
```json
{
  "deals": [
    {
      "id": 42,
      "title": "50% Off All Cocktails",
      "surpriseType": "TIME_BASED",
      "surpriseHint": "Something bubbly awaits after sundown… 🍾",
      "surpriseTotalSlots": 50,
      "surpriseSlotsUsed": 23,
      "isActive": true,
      "startTime": "2026-03-14T17:00:00.000Z",
      "endTime": "2026-03-14T23:00:00.000Z",
      "revealsCount": 23,
      "category": { "name": "Drinks", "icon": "🍹" },
      "dealType": { "name": "Happy Hour" }
    }
  ],
  "count": 1
}
```

---

### 8. Update a Surprise Deal

```
PATCH /api/merchant/surprises/:dealId
```

Only allowed **before the deal's `startTime`**.

**Request Body** — all fields optional:

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | |
| `description` | string | |
| `surpriseHint` | string | |
| `revealRadiusMeters` | number | |
| `revealAt` | ISO datetime | |
| `revealDurationMinutes` | number | |
| `surpriseTotalSlots` | number | |
| `endTime` | ISO datetime | |

**Success Response `200`**
```json
{
  "message": "Surprise deal updated.",
  "deal": { ... }
}
```

---

### 9. Deactivate a Surprise Deal

```
DELETE /api/merchant/surprises/:dealId
```

Soft-deletes by setting `endTime` to now (immediately expires the deal).

**Success Response `200`**
```json
{
  "message": "Surprise deal deactivated."
}
```

---

### 10. Surprise Deal Analytics

```
GET /api/merchant/surprises/:dealId/analytics
```

**Example Response `200`**
```json
{
  "deal": {
    "id": 42,
    "title": "50% Off All Cocktails",
    "surpriseType": "TIME_BASED",
    "startTime": "2026-03-14T17:00:00.000Z",
    "endTime": "2026-03-14T23:00:00.000Z"
  },
  "analytics": {
    "totalReveals": 23,
    "totalRedeemed": 15,
    "conversionRate": "65%",
    "slotsTotal": 50,
    "slotsUsed": 23,
    "slotsRemaining": 27
  },
  "recentReveals": [
    {
      "revealedAt": "2026-03-14T18:45:00.000Z",
      "redeemed": true,
      "redeemedAt": "2026-03-14T19:10:00.000Z"
    }
  ]
}
```

---

## AI Endpoint

---

### 11. Generate a Surprise Deal with AI

```
POST /api/ai/deals/surprise/generate
```

**Auth:** Any merchant token.

Feed the merchant's plain-text intent and get back a full surprise deal structure — including a cryptic hint auto-generated by AI.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `intent` | string | Yes | What the merchant wants to offer (min 5 chars) |
| `surpriseType` | string | No | One of the 4 types (default: `LOCATION_BASED`) |

**Example Body**
```json
{
  "intent": "20% off all our handcrafted pizzas during lunch",
  "surpriseType": "TIME_BASED"
}
```

**Example Response `200`**
```json
{
  "suggestion": {
    "title": "Secret Slice Deal",
    "description": "20% off every handcrafted pizza on our menu. Made fresh, priced right — only for those in the know.",
    "discountPercentage": 20,
    "discountAmount": null,
    "redemptionInstructions": "Show this screen to your cashier when ordering your pizza.",
    "surpriseHint": "The noon sun hides a cheesy little secret… 🍕",
    "suggestedDurationHours": 3,
    "suggestedRevealType": "TIME_BASED",
    "suggestedRevealRadiusMeters": null,
    "bestTimeSlot": "Lunch"
  }
}
```

**Frontend Usage**

- Show an "Generate with AI ✨" button on the surprise deal creation form.
- Pre-fill all form fields from `suggestion`.
- Let the merchant review and edit before submitting to `POST /api/merchant/surprises`.

---

## Frontend Integration Flow

### User Flow

```
App loads / location updates
        ↓
GET /api/surprises/nearby?lat=&lng=
        ↓
Render mystery cards (hint + merchant name + distance)
        ↓
User taps "Reveal" on a card
        ↓
POST /api/surprises/:id/reveal  { lat, lng }
        ↓
  ┌─ Success ──────────────────────────────────────┐
  │  Animate reveal → show deal details            │
  │  Start countdown timer to expiresAt            │
  │  Show "Redeem Now" CTA                         │
  └────────────────────────────────────────────────┘
  ┌─ Error (400) ──────────────────────────────────┐
  │  LOCATION_BASED: "Move closer! Xm away"        │
  │  TIME_BASED:     "Unlocks at 6:00 PM"          │
  │  ENGAGEMENT:     "Check in here first"         │
  │  RANDOM_DROP:    "All slots claimed"           │
  └────────────────────────────────────────────────┘
        ↓ (after reveal)
User taps "Redeem Now"
        ↓
Show confirmation dialog
        ↓
POST /api/surprises/:id/redeem
        ↓
Show "Redeemed ✓" state
```

### Merchant Flow

```
Merchant opens "Create Surprise Deal"
        ↓
(Optional) POST /api/ai/deals/surprise/generate
  → pre-fill form fields
        ↓
Merchant fills/edits form → selects surpriseType
        ↓
POST /api/merchant/surprises
        ↓
Dashboard: GET /api/merchant/surprises
        ↓
Analytics: GET /api/merchant/surprises/:id/analytics
```

---

## Error Reference

| HTTP Status | Meaning |
|-------------|---------|
| `400` | Bad request / validation failed / trigger condition not met |
| `401` | Missing or invalid auth token |
| `403` | Not authorized (wrong merchant, not revealed yet) |
| `404` | Resource not found |
| `410` | Reveal window has expired |
| `503` | AI service unavailable |
| `500` | Server error |

---

## Notes for Frontend

1. **`isRevealed` + `isExpired` + `isRedeemed`** on the nearby list tell you exactly which state to render:

| `isRevealed` | `isExpired` | `isRedeemed` | Show |
|---|---|---|---|
| `false` | `false` | `false` | "Reveal" CTA |
| `true` | `false` | `false` | Deal details + countdown + "Redeem" CTA |
| `true` | `false` | `true` | "Redeemed ✓" |
| `true` | `true` | `false` | "Expired — missed it!" |
| `true` | `true` | `true` | Past reveal in history |

2. **Countdown timer** — use `expiresAt` (ISO string) from the reveal response. Calculate `expiresAt - Date.now()` client-side.

3. **Location permission** — request location before calling `/reveal` for `LOCATION_BASED` deals. Show a prompt if permission is denied.

4. **TIME_BASED deals** — you can show a countdown to `revealAt` on the mystery card. The reveal endpoint will accept the call once `revealAt` is in the past; no need to disable the button, just let the server reject and show the error.

5. **Polling** — if you want live slot counts for `RANDOM_DROP` deals, re-call `/api/surprises/nearby` every 30–60 seconds. Do not poll more frequently.
