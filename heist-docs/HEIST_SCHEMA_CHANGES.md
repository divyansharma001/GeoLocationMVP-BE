# Heist Token Feature - Schema Changes

## Overview
This document outlines all database schema changes needed for the Heist Token feature.

---

## Step 1: Add New Enums

Add these new enum types to `schema.prisma`:

```prisma
enum HeistStatus {
  SUCCESS                      // Heist completed successfully
  FAILED_COOLDOWN             // User on cooldown
  FAILED_TARGET_PROTECTED     // Target on protection cooldown
  FAILED_SHIELD               // Target had active shield (Phase 2)
  FAILED_INSUFFICIENT_POINTS  // Target had < minimum points
  FAILED_INSUFFICIENT_TOKENS  // Attacker doesn't have tokens
  FAILED_INVALID_TARGET       // Cannot rob yourself or invalid user
}

enum HeistNotificationType {
  HEIST_SUCCESS      // You robbed someone
  HEIST_VICTIM       // You were robbed
  TOKEN_EARNED       // You earned a token
  SHIELD_ACTIVATED   // Your shield blocked an attack (Phase 2)
  SHIELD_EXPIRED     // Your shield expired (Phase 2)
}
```

---

## Step 2: Add New Point Event Types

Update the `PointEventType` enum:

```prisma
enum PointEventType {
  SIGNUP
  FIRST_CHECKIN_DEAL
  CHECKIN
  COIN_PURCHASE
  ACHIEVEMENT_UNLOCK
  LOYALTY_BONUS
  REFERRAL_BONUS
  HEIST_GAIN           // ← NEW: Points gained from heist
  HEIST_LOSS           // ← NEW: Points lost to heist
}
```

---

## Step 3: Create New Models

### HeistToken Model

```prisma
model HeistToken {
  id              Int      @id @default(autoincrement())
  userId          Int      @unique
  balance         Int      @default(0)       // Current token count
  totalEarned     Int      @default(0)       // Lifetime tokens earned
  totalSpent      Int      @default(0)       // Lifetime tokens spent
  lastEarnedAt    DateTime?                  // When last token was earned
  lastSpentAt     DateTime?                  // When last token was spent
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  heistsAsAttacker Heist[] @relation("HeistTokenAttacker")

  @@index([userId])
  @@index([balance])
  @@index([lastSpentAt])
}
```

### Heist Model

```prisma
model Heist {
  id                  Int         @id @default(autoincrement())
  attackerId          Int
  victimId            Int
  pointsStolen        Int         // Actual points stolen
  victimPointsBefore  Int         // Victim's monthlyPoints before heist
  victimPointsAfter   Int         // Victim's monthlyPoints after heist
  attackerPointsBefore Int        // Attacker's monthlyPoints before heist
  attackerPointsAfter  Int        // Attacker's monthlyPoints after heist
  tokenSpent          Boolean     @default(true)
  status              HeistStatus @default(SUCCESS)
  failureReason       String?     // Human-readable failure reason
  ipAddress           String?     // For security audit trail
  createdAt           DateTime    @default(now())
  
  attacker            User        @relation("HeistsAsAttacker", fields: [attackerId], references: [id], onDelete: Cascade)
  victim              User        @relation("HeistsAsVictim", fields: [victimId], references: [id], onDelete: Cascade)
  attackerToken       HeistToken  @relation("HeistTokenAttacker", fields: [attackerId], references: [userId])
  notifications       HeistNotification[]

  @@index([attackerId, createdAt])
  @@index([victimId, createdAt])
  @@index([createdAt])
  @@index([status])
  @@index([attackerId, status])
  @@index([victimId, status])
}
```

### HeistNotification Model

```prisma
model HeistNotification {
  id          Int                    @id @default(autoincrement())
  userId      Int
  heistId     Int?                   // Can be null for non-heist notifications (e.g., TOKEN_EARNED)
  type        HeistNotificationType
  message     String
  metadata    Json?                  // Additional data (attacker name, points, etc.)
  read        Boolean                @default(false)
  emailSent   Boolean                @default(false)
  emailSentAt DateTime?
  createdAt   DateTime               @default(now())
  
  user        User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  heist       Heist?                 @relation(fields: [heistId], references: [id], onDelete: SetNull)

  @@index([userId, read])
  @@index([userId, createdAt])
  @@index([createdAt])
  @@index([type])
}
```

---

## Step 4: Update User Model

Add these relations to the existing `User` model:

```prisma
model User {
  // ... existing fields ...
  
  // Heist Relations (add these at the end)
  heistToken          HeistToken?
  heistsAsAttacker    Heist[]               @relation("HeistsAsAttacker")
  heistsAsVictim      Heist[]               @relation("HeistsAsVictim")
  heistNotifications  HeistNotification[]
}
```

---

## Step 5: Add New Point Event Types to Master Table

These need to be seeded into `PointEventTypeMaster`:

```typescript
// Add to seed script or run manually
const newPointEventTypes = [
  {
    name: 'HEIST_GAIN',
    description: 'Points gained from successfully robbing another player',
    points: 0, // Variable amount
    active: true
  },
  {
    name: 'HEIST_LOSS',
    description: 'Points lost from being robbed by another player',
    points: 0, // Variable amount (negative)
    active: true
  }
];
```

---

## Migration SQL Commands

Here's the SQL that will be generated by Prisma migrate:

```sql
-- CreateEnum
CREATE TYPE "HeistStatus" AS ENUM (
  'SUCCESS',
  'FAILED_COOLDOWN',
  'FAILED_TARGET_PROTECTED',
  'FAILED_SHIELD',
  'FAILED_INSUFFICIENT_POINTS',
  'FAILED_INSUFFICIENT_TOKENS',
  'FAILED_INVALID_TARGET'
);

-- CreateEnum
CREATE TYPE "HeistNotificationType" AS ENUM (
  'HEIST_SUCCESS',
  'HEIST_VICTIM',
  'TOKEN_EARNED',
  'SHIELD_ACTIVATED',
  'SHIELD_EXPIRED'
);

-- AlterEnum
ALTER TYPE "PointEventType" ADD VALUE 'HEIST_GAIN';
ALTER TYPE "PointEventType" ADD VALUE 'HEIST_LOSS';

-- CreateTable
CREATE TABLE "HeistToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "lastEarnedAt" TIMESTAMP(3),
    "lastSpentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeistToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Heist" (
    "id" SERIAL NOT NULL,
    "attackerId" INTEGER NOT NULL,
    "victimId" INTEGER NOT NULL,
    "pointsStolen" INTEGER NOT NULL,
    "victimPointsBefore" INTEGER NOT NULL,
    "victimPointsAfter" INTEGER NOT NULL,
    "attackerPointsBefore" INTEGER NOT NULL,
    "attackerPointsAfter" INTEGER NOT NULL,
    "tokenSpent" BOOLEAN NOT NULL DEFAULT true,
    "status" "HeistStatus" NOT NULL DEFAULT 'SUCCESS',
    "failureReason" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Heist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeistNotification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "heistId" INTEGER,
    "type" "HeistNotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeistNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HeistToken_userId_key" ON "HeistToken"("userId");

-- CreateIndex
CREATE INDEX "HeistToken_userId_idx" ON "HeistToken"("userId");

-- CreateIndex
CREATE INDEX "HeistToken_balance_idx" ON "HeistToken"("balance");

-- CreateIndex
CREATE INDEX "HeistToken_lastSpentAt_idx" ON "HeistToken"("lastSpentAt");

-- CreateIndex
CREATE INDEX "Heist_attackerId_createdAt_idx" ON "Heist"("attackerId", "createdAt");

-- CreateIndex
CREATE INDEX "Heist_victimId_createdAt_idx" ON "Heist"("victimId", "createdAt");

-- CreateIndex
CREATE INDEX "Heist_createdAt_idx" ON "Heist"("createdAt");

-- CreateIndex
CREATE INDEX "Heist_status_idx" ON "Heist"("status");

-- CreateIndex
CREATE INDEX "Heist_attackerId_status_idx" ON "Heist"("attackerId", "status");

-- CreateIndex
CREATE INDEX "Heist_victimId_status_idx" ON "Heist"("victimId", "status");

-- CreateIndex
CREATE INDEX "HeistNotification_userId_read_idx" ON "HeistNotification"("userId", "read");

-- CreateIndex
CREATE INDEX "HeistNotification_userId_createdAt_idx" ON "HeistNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "HeistNotification_createdAt_idx" ON "HeistNotification"("createdAt");

-- CreateIndex
CREATE INDEX "HeistNotification_type_idx" ON "HeistNotification"("type");

-- AddForeignKey
ALTER TABLE "HeistToken" ADD CONSTRAINT "HeistToken_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Heist" ADD CONSTRAINT "Heist_attackerId_fkey" 
    FOREIGN KEY ("attackerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Heist" ADD CONSTRAINT "Heist_victimId_fkey" 
    FOREIGN KEY ("victimId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Heist" ADD CONSTRAINT "Heist_attackerId_fkey_token" 
    FOREIGN KEY ("attackerId") REFERENCES "HeistToken"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeistNotification" ADD CONSTRAINT "HeistNotification_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeistNotification" ADD CONSTRAINT "HeistNotification_heistId_fkey" 
    FOREIGN KEY ("heistId") REFERENCES "Heist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

---

## Data Seeding Requirements

After migration, seed these new point event types:

```typescript
// Add to scripts/seed-gamification.ts or create new seed file

await prisma.pointEventTypeMaster.createMany({
  data: [
    {
      name: 'HEIST_GAIN',
      description: 'Points gained from successfully robbing another player',
      points: 0,
      active: true
    },
    {
      name: 'HEIST_LOSS',
      description: 'Points lost from being robbed by another player',
      points: 0,
      active: true
    }
  ],
  skipDuplicates: true
});
```

---

## Rollback Plan

If issues arise, rollback steps:

1. **Stop heist feature** (set `HEIST_ENABLED=false` in .env)
2. **Drop tables** (in reverse order of creation):
   ```sql
   DROP TABLE "HeistNotification";
   DROP TABLE "Heist";
   DROP TABLE "HeistToken";
   DROP TYPE "HeistNotificationType";
   DROP TYPE "HeistStatus";
   -- Remove enum values (Postgres doesn't support this easily)
   ```
3. **Revert User model** changes in schema.prisma
4. **Run prisma generate**

---

## Performance Considerations

### Indexes Created
- `HeistToken.userId` (UNIQUE) - Fast token lookups
- `HeistToken.balance` - Query users with available tokens
- `Heist.attackerId + createdAt` - User's heist history
- `Heist.victimId + createdAt` - Times user was robbed
- `Heist.createdAt` - Time-based queries
- `HeistNotification.userId + read` - Unread notifications query
- `HeistNotification.userId + createdAt` - Notification feed

### Expected Performance
- Token balance query: <5ms
- Heist eligibility check: <10ms (includes cooldown calculation)
- Heist execution: <50ms (transaction with multiple updates)
- Notification retrieval: <10ms

---

## Storage Estimates

Assuming 10,000 active users with moderate heist activity:

| Table | Rows | Size per Row | Total Size |
|-------|------|--------------|------------|
| HeistToken | 10,000 | ~100 bytes | ~1 MB |
| Heist | 50,000/month | ~200 bytes | ~10 MB/month |
| HeistNotification | 100,000/month | ~300 bytes | ~30 MB/month |

**Annual storage**: ~500 MB (negligible)

---

## Testing the Migration

After running the migration:

1. **Verify tables exist**:
   ```sql
   SELECT table_name FROM information_schema.tables 
   WHERE table_name IN ('HeistToken', 'Heist', 'HeistNotification');
   ```

2. **Verify indexes**:
   ```sql
   SELECT indexname FROM pg_indexes 
   WHERE tablename IN ('HeistToken', 'Heist', 'HeistNotification');
   ```

3. **Test foreign key constraints**:
   ```sql
   -- Should fail (non-existent user)
   INSERT INTO "HeistToken" ("userId", "balance") VALUES (999999, 1);
   ```

4. **Test enum values**:
   ```sql
   -- Should succeed
   INSERT INTO "Heist" (..., "status") VALUES (..., 'SUCCESS');
   ```

---

## Next Steps After Migration

1. ✅ Run migration: `npx prisma migrate dev --name add_heist_token_feature`
2. ✅ Generate Prisma client: `npx prisma generate`
3. ✅ Seed new point event types
4. ✅ Test schema with unit tests
5. ✅ Begin implementing heist logic

---

**Migration Name**: `add_heist_token_feature`  
**Estimated Duration**: <1 second  
**Downtime Required**: None (additive changes only)  
**Reversible**: Yes (with manual steps)

