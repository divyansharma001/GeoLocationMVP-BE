# Bounty System & "Guess the Kitty" Game

**Status:** Implemented
**Date:** February 11, 2026
**Related Plan:** DAY 2 of 3_WEEK_MVP_IMPLEMENTATION_PLAN.md

---

## Overview

Two gamification features designed to drive user engagement and foot traffic to venues:

1. **Enhanced Bounty System** — Users earn rewards by referring friends to bounty deals. Progress is tracked per-user-per-deal, and rewards are auto-distributed when the referral threshold is met.

2. **"Guess the Kitty" Game** — A venue-based guessing game where users pay coins to guess a secret number (1–1000). The closest guess wins the entire prize pool.

---

## Database Models

### BountyProgress

Tracks a user's referral progress toward completing a bounty deal.

| Field | Type | Description |
|-------|------|-------------|
| id | Int (PK) | Auto-increment |
| userId | Int (FK → User) | The user working on this bounty |
| dealId | Int (FK → Deal) | The bounty deal |
| referralCount | Int | Number of friends referred so far |
| rewardsEarned | Float | Dollar amount earned on completion |
| isCompleted | Boolean | Whether the bounty is fulfilled |
| completedAt | DateTime? | When the bounty was completed |
| qrCodeScannedAt | DateTime? | When the merchant QR code was scanned |

**Unique constraint:** `(userId, dealId)` — one progress record per user per deal.

### KittyGame

Represents a single game session tied to a merchant venue.

| Field | Type | Description |
|-------|------|-------------|
| id | Int (PK) | Auto-increment |
| merchantId | Int (FK → Merchant) | The venue hosting the game |
| title | String | Game display name |
| prizePool | Float | Accumulated coins from entry fees |
| entryFee | Int | Cost in coins to submit a guess (default: 10) |
| secretValue | Float? | Cryptographically random number (1–1000) |
| guessWindowStart | DateTime | When guessing opens |
| guessWindowEnd | DateTime | When guessing closes |
| status | KittyGameStatus | PENDING → ACTIVE → RESOLVED / CANCELLED |
| winnerId | Int? (FK → User) | The winning user |
| winnerGuessId | Int? | The winning guess record |
| minPlayers | Int | Minimum players required (default: 2) |
| maxPlayers | Int? | Optional player cap |
| createdBy | Int (FK → User) | Admin/merchant who created the game |
| resolvedAt | DateTime? | When the winner was determined |

### KittyGuess

Each player's guess entry.

| Field | Type | Description |
|-------|------|-------------|
| id | Int (PK) | Auto-increment |
| gameId | Int (FK → KittyGame) | The game |
| userId | Int (FK → User) | The player |
| guessValue | Float | Player's guess (1–1000) |
| coinsSpent | Int | Entry fee paid |
| isWinner | Boolean | Set to true for the winning guess |

**Unique constraint:** `(gameId, userId)` — one guess per user per game.

### KittyGameStatus Enum

```
PENDING    → Created, not yet accepting guesses
ACTIVE     → Accepting guesses within the time window
CLOSED     → Guess window expired, awaiting resolution
RESOLVED   → Winner determined, prize awarded
CANCELLED  → Game cancelled, entry fees refunded
```

---

## API Endpoints

### User Endpoints — `/api/kitty`

All endpoints require Bearer token authentication.

#### Kitty Game

| Method | Path | Description |
|--------|------|-------------|
| GET | `/games` | List active/pending games. Optional `?merchantId=` filter |
| GET | `/games/:gameId` | Get game details. Secret value hidden until resolved |
| POST | `/games/:gameId/guess` | Submit a guess. Body: `{ "guessValue": 500 }` |

#### Bounty

| Method | Path | Description |
|--------|------|-------------|
| GET | `/bounty/dashboard` | User's active & completed bounties with stats |
| POST | `/bounty/start` | Join a bounty deal. Body: `{ "dealId": 1 }` |
| POST | `/bounty/referral` | Record a referral. Body: `{ "referredUserId": 2, "dealId": 1 }` |
| POST | `/bounty/verify-qr` | Scan a bounty QR code. Body: `{ "qrCodeData": "BOUNTY:..." }` |

### Admin/Merchant Endpoints — `/api/admin/games`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/kitty/create` | Merchant | Create a game for own venue |
| POST | `/kitty/admin-create` | Admin | Create a game for any merchant |
| PATCH | `/kitty/:gameId/activate` | Admin | PENDING → ACTIVE |
| PATCH | `/kitty/:gameId/resolve` | Admin | Determine winner, award prize |
| PATCH | `/kitty/:gameId/cancel` | Admin | Cancel game, refund all players |
| GET | `/kitty/all` | Admin | List all games |
| GET | `/kitty/:gameId` | Admin | Full game details |
| GET | `/kitty/analytics/:merchantId` | Admin | Venue game statistics |
| POST | `/bounty/refresh-qr` | Merchant | Generate fresh bounty QR code |

---

## Game Flow: "Guess the Kitty"

```
1. CREATION
   Admin/Merchant creates a game with:
   - title, entryFee, guessWindowStart, guessWindowEnd
   - System generates a cryptographically secure random number (1-1000)
   - Game starts in PENDING status

2. ACTIVATION
   Admin activates the game → status becomes ACTIVE
   Users can now see the game in the active games list

3. GUESSING PHASE
   - Users call POST /games/:gameId/guess with their guess (1-1000)
   - Entry fee (coins) is deducted from user's balance
   - Prize pool grows with each entry
   - One guess per user per game
   - Window enforced by guessWindowStart and guessWindowEnd

4. RESOLUTION
   Admin calls PATCH /kitty/:gameId/resolve:
   - System compares all guesses to the secret value
   - Closest guess wins (absolute difference)
   - Winner receives the entire prize pool as bonus coins
   - Game status → RESOLVED
   - All guess values and the secret are revealed

5. CANCELLATION (alternative)
   Admin calls PATCH /kitty/:gameId/cancel:
   - All entry fees are refunded to players
   - Game status → CANCELLED

   Auto-cancel: If resolve is called with fewer players than
   minPlayers, the game is automatically cancelled with refunds.
```

---

## Bounty Flow

```
1. USER JOINS
   POST /bounty/start with a bounty deal ID
   → Creates a BountyProgress record (referralCount = 0)

2. REFERRALS
   POST /bounty/referral with referredUserId + dealId
   → Increments referralCount on the referrer's progress
   → If referralCount >= deal.minReferralsRequired → auto-completes

3. COMPLETION (automatic)
   When threshold is met:
   - BountyProgress.isCompleted = true
   - Deal.currentRedemptions incremented
   - User awarded bountyRewardAmount × 10 as bonus coins
     (e.g., $5 reward = 50 coins)

4. QR VERIFICATION (optional in-venue step)
   POST /bounty/verify-qr with scanned QR data
   → Validates HMAC signature and expiration (30-day window)
   → Records scan timestamp on the progress record

5. DASHBOARD
   GET /bounty/dashboard returns:
   - Active bounties with % progress
   - Completed bounties with rewards earned
   - Summary stats (total active, completed, rewards earned)
```

---

## File Structure

```
src/
├── services/
│   ├── bounty.service.ts          # Bounty business logic
│   └── kitty-game.service.ts      # Kitty Game business logic
├── routes/
│   ├── kitty.routes.ts            # User-facing endpoints (/api/kitty)
│   └── admin-games.routes.ts      # Admin/merchant endpoints (/api/admin/games)
├── lib/
│   └── dealUtils.ts               # QR code generation/verification (pre-existing)
prisma/
└── schema.prisma                  # BountyProgress, KittyGame, KittyGuess models
```

---

## Example API Requests

### Create a Kitty Game (Merchant)

```http
POST /api/admin/games/kitty/create
Authorization: Bearer <merchant-token>
Content-Type: application/json

{
  "title": "Friday Night Kitty Game",
  "entryFee": 15,
  "guessWindowStart": "2026-02-14T18:00:00Z",
  "guessWindowEnd": "2026-02-14T22:00:00Z",
  "minPlayers": 3,
  "maxPlayers": 50
}
```

### Submit a Guess (User)

```http
POST /api/kitty/games/1/guess
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "guessValue": 427
}
```

### Response — Game Details After Resolution

```json
{
  "success": true,
  "data": {
    "id": 1,
    "title": "Friday Night Kitty Game",
    "secretValue": 433,
    "prizePool": 150,
    "playerCount": 10,
    "status": "RESOLVED",
    "winner": { "id": 5, "name": "Alice" },
    "leaderboard": [
      { "name": "Alice", "guessValue": 427, "difference": 6, "isWinner": true },
      { "name": "Bob", "guessValue": 440, "difference": 7, "isWinner": false },
      { "name": "Charlie", "guessValue": 500, "difference": 67, "isWinner": false }
    ]
  }
}
```

### Start a Bounty

```http
POST /api/kitty/bounty/start
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "dealId": 12
}
```

### Bounty Dashboard Response

```json
{
  "success": true,
  "data": {
    "active": [
      {
        "dealTitle": "Bring 3 Friends, Get $10 Back",
        "merchant": { "businessName": "Joe's Bar" },
        "referralCount": 1,
        "minReferralsRequired": 3,
        "bountyRewardAmount": 10,
        "progress": 33.3
      }
    ],
    "completed": [],
    "stats": {
      "totalActive": 1,
      "totalCompleted": 0,
      "totalRewardsEarned": 0
    }
  }
}
```

---

## Configuration

| Env Variable | Purpose | Default |
|---|---|---|
| `BOUNTY_QR_SECRET` | HMAC key for signing bounty QR codes | Fallback key (change in production!) |

---

## Migration

Run after pulling these changes:

```bash
npx prisma migrate dev --name add_bounty_progress_and_kitty
npx prisma generate
```
