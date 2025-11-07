# 🏗️ Heist Token Feature - Architecture Review Document

## Document Information
- **Version**: 1.0
- **Date**: November 7, 2025
- **Review Status**: 🟡 Pending Architecture Review
- **Reviewers**: Senior Backend Engineers, Database Architects, DevOps

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Architecture Patterns](#architecture-patterns)
3. [System Integration Points](#system-integration-points)
4. [Data Flow Diagrams](#data-flow-diagrams)
5. [Scalability Analysis](#scalability-analysis)
6. [Failure Modes & Resilience](#failure-modes--resilience)
7. [Deployment Architecture](#deployment-architecture)
8. [Monitoring & Observability](#monitoring--observability)
9. [Cost Analysis](#cost-analysis)
10. [Alternative Architectures Considered](#alternative-architectures-considered)
11. [Technical Debt Assessment](#technical-debt-assessment)
12. [Architecture Decision Records](#architecture-decision-records)

---

## Executive Summary

### Feature Overview
The Heist Token feature adds a gamified "robbery" mechanic to the leaderboard system, allowing users to earn tokens via referrals and spend them to steal points from other players.

### Architecture Highlights
- **Pattern**: Monolithic backend with transactional consistency
- **Database**: PostgreSQL with ACID guarantees
- **Integration**: Minimal changes to existing codebase
- **Scalability**: Supports 10K users, 100K heists/month
- **Risk Level**: 🟢 Low - Well-isolated, reversible, feature-flagged

### Key Architectural Decisions
1. **Transaction-based execution** (not event-sourced) for simplicity
2. **Synchronous notifications** (in-transaction) for consistency
3. **No caching layer** initially (optimize later if needed)
4. **Feature flag** for instant rollback without deployment

---

## Architecture Patterns

### 1. Layered Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Presentation Layer                    │
│              (Future Frontend - Not in Scope)           │
└────────────────────────┬────────────────────────────────┘
                         │ REST API
┌────────────────────────▼────────────────────────────────┐
│                    API/Route Layer                      │
│  • Express.js routing                                   │
│  • Request validation (Zod)                             │
│  • Response formatting                                  │
│  • Error handling middleware                            │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                   Business Logic Layer                  │
│  • Heist execution orchestration                        │
│  • Token management                                     │
│  • Validation rules                                     │
│  • Notification generation                              │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                   Data Access Layer                     │
│  • Prisma ORM                                           │
│  • Transaction management                               │
│  • Query optimization                                   │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                   Persistence Layer                     │
│  • PostgreSQL database                                  │
│  • ACID transactions                                    │
│  • Row-level locking                                    │
└─────────────────────────────────────────────────────────┘
```

**Rationale**:
- ✅ Familiar pattern to existing codebase
- ✅ Easy to test (layer isolation)
- ✅ Clear separation of concerns
- ✅ No learning curve for team

**Alternatives Considered**:
- Microservices: Overkill for MVP, adds complexity
- Event-driven: Harder to ensure consistency
- Serverless: Not compatible with existing infrastructure

---

### 2. Transaction Script Pattern

**Pattern**: Business logic organized as procedural scripts with database transactions.

**Example**:
```typescript
async function executeHeist(attackerId: number, victimId: number) {
  return await prisma.$transaction(async (tx) => {
    // 1. Validate
    const validation = await validateHeist(tx, attackerId, victimId);
    if (!validation.eligible) throw new Error(validation.reason);
    
    // 2. Calculate
    const stealAmount = calculateStealAmount(validation.victim.monthlyPoints);
    
    // 3. Execute
    await transferPoints(tx, victimId, attackerId, stealAmount);
    await spendToken(tx, attackerId);
    
    // 4. Record
    const heist = await recordHeist(tx, attackerId, victimId, stealAmount);
    
    // 5. Notify (in-transaction for consistency)
    await createNotifications(tx, heist);
    
    return heist;
  });
}
```

**Pros**:
- ✅ Simple and direct
- ✅ Easy to debug
- ✅ Strong consistency guarantees
- ✅ Atomic operations

**Cons**:
- ⚠️ Not as modular as domain models
- ⚠️ Can grow complex if feature expands significantly

**Verdict**: ✅ Appropriate for this feature scope

---

### 3. Repository Pattern (via Prisma)

**Pattern**: Data access abstracted through Prisma's generated client.

```typescript
// Implicit repository - Prisma provides this
prisma.heist.create(...)
prisma.heistToken.update(...)
prisma.user.findUnique(...)
```

**Pros**:
- ✅ Type-safe queries
- ✅ Database-agnostic (theoretically)
- ✅ Built-in connection pooling
- ✅ Migration management

**Cons**:
- ⚠️ Vendor lock-in to Prisma
- ⚠️ Limited control over complex queries

**Verdict**: ✅ Already used in project, no change needed

---

## System Integration Points

### Integration Map

```
┌─────────────────────────────────────────────────────────┐
│                    Heist Feature                        │
└──┬────────┬─────────┬──────────┬───────────┬───────────┘
   │        │         │          │           │
   │        │         │          │           │
   ▼        ▼         ▼          ▼           ▼
┌──────┐┌────────┐┌───────┐┌──────────┐┌──────────┐
│ User ││Referral││Leaderb││  Email   ││  Points  │
│System││ System ││oard   ││  Service ││  System  │
└──────┘└────────┘└───────┘└──────────┘└──────────┘
```

### 1. User System Integration

**Touch Points**:
- Read: User ID, name, email, monthly points
- Write: Monthly points (during heist)

**Schema Dependencies**:
```prisma
model User {
  heistToken         HeistToken?        // NEW: 1-to-1
  heistsAsAttacker   Heist[]           // NEW: 1-to-many
  heistsAsVictim     Heist[]           // NEW: 1-to-many
  heistNotifications HeistNotification[] // NEW: 1-to-many
}
```

**Risk Assessment**: 🟢 Low
- No changes to existing User fields
- Only adds new relations
- Migrations are additive

**Rollback Plan**: Drop HeistToken, Heist, HeistNotification tables → User unchanged

---

### 2. Referral System Integration

**Touch Points**:
- Hook: `auth.routes.ts` - After successful referral signup
- Action: Award heist token to referrer

**Code Changes**:
```typescript
// In auth.routes.ts - /signup endpoint
// EXISTING CODE:
if (referredByUser) {
  await prisma.user.update({
    where: { id: userId },
    data: { referredByUserId: referredByUser.id }
  });
}

// NEW CODE:
if (referredByUser) {
  await prisma.user.update({
    where: { id: userId },
    data: { referredByUserId: referredByUser.id }
  });
  
  // Award heist token
  await heistTokenService.awardToken(referredByUser.id, {
    referredName: newUser.name,
    referredId: newUser.id
  });
}
```

**Risk Assessment**: 🟡 Medium
- Adds logic to critical signup flow
- Could slow down signup if poorly implemented
- Must not break signup if heist system fails

**Mitigation**:
- Wrap in try-catch (don't fail signup if token award fails)
- Log errors for manual retry
- Make async if possible (after signup transaction commits)

**Testing Requirements**:
- Test signup with heist feature enabled
- Test signup with heist feature disabled
- Test signup when heist service throws error
- Test concurrent signups with same referral code

---

### 3. Leaderboard Integration

**Touch Points**:
- Read: Display heist eligibility indicators
- Read: Show token balance in leaderboard UI
- Update trigger: Invalidate cache after heist

**Code Changes**:
```typescript
// In leaderboard.routes.ts - GET /leaderboard endpoint
// EXISTING CODE:
const leaderboard = await prisma.user.findMany({
  select: { id, name, monthlyPoints },
  orderBy: { monthlyPoints: 'desc' },
  take: 50
});

// NEW CODE (optional enrichment):
const leaderboard = await prisma.user.findMany({
  select: { 
    id, name, monthlyPoints,
    heistToken: { select: { balance: true } } // NEW
  },
  orderBy: { monthlyPoints: 'desc' },
  take: 50
});

// Add eligibility indicators
const enriched = await Promise.all(
  leaderboard.map(async (user) => ({
    ...user,
    canBeRobbed: await heistService.canBeRobbed(user.id, currentUserId)
  }))
);
```

**Risk Assessment**: 🟢 Low
- Optional enhancement (not required for MVP)
- Read-only operation
- Can be added later

**Performance Consideration**:
- If enriching with eligibility: Adds N queries (one per leaderboard user)
- Solution: Batch query or cache cooldown data

---

### 4. Email Service Integration

**Touch Points**:
- Trigger: Send heist notifications via email
- Dependency: Existing SendGrid integration

**Code Changes**:
```typescript
// In src/lib/heist/notifications.ts
import { sendEmail } from '../email/service'; // EXISTING

async function sendHeistNotificationEmail(userId: number, notification: Notification) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user.email) return;
  
  const template = getTemplateForNotificationType(notification.type);
  
  await sendEmail({
    to: user.email,
    subject: notification.title,
    template: template,
    data: notification.metadata
  });
}
```

**Risk Assessment**: 🟢 Low
- Uses existing email infrastructure
- Async operation (doesn't block heist)
- Failures don't affect heist success

**Configuration**:
- `HEIST_EMAIL_ENABLED=true` to enable
- Uses existing SendGrid API keys

---

### 5. Points System Integration

**Touch Points**:
- Write: Create UserPointEvent records for heists
- Read: Validate minimum points threshold

**Schema Dependencies**:
```prisma
model UserPointEvent {
  pointEventTypeId Int
  // NEW VALUES: HEIST_GAIN, HEIST_LOSS
}

model PointEventTypeMaster {
  // NEW ROWS: 
  // { name: "HEIST_GAIN", description: "Points gained from heist" }
  // { name: "HEIST_LOSS", description: "Points lost from being robbed" }
}
```

**Code Changes**:
```typescript
// After heist execution
await prisma.userPointEvent.createMany({
  data: [
    {
      userId: attackerId,
      points: stealAmount,
      pointEventTypeId: POINT_EVENT_TYPE.HEIST_GAIN,
      description: `Stole ${stealAmount} points from ${victimName}`
    },
    {
      userId: victimId,
      points: -stealAmount,
      pointEventTypeId: POINT_EVENT_TYPE.HEIST_LOSS,
      description: `Lost ${stealAmount} points to ${attackerName}`
    }
  ]
});
```

**Risk Assessment**: 🟢 Low
- Existing point event system already supports this pattern
- Just adding new event types

**Seed Data Required**:
```sql
INSERT INTO "PointEventTypeMaster" (name, description) VALUES
  ('HEIST_GAIN', 'Points gained from successful heist'),
  ('HEIST_LOSS', 'Points lost from being robbed');
```

---

## Data Flow Diagrams

### 1. Token Earning Flow

```
┌─────────┐                    ┌──────────┐
│ User B  │                    │ User A   │
│ (New)   │                    │(Referrer)│
└────┬────┘                    └────┬─────┘
     │                              │
     │ 1. Sign up with              │
     │    User A's code             │
     ├─────────────────────────────►│
     │                              │
     │                         ┌────▼─────┐
     │                         │  Signup  │
     │                         │  API     │
     │                         └────┬─────┘
     │                              │
     │                         2. Create User
     │                              │
     │                         ┌────▼─────┐
     │                         │   User   │
     │                         │   Table  │
     │                         └────┬─────┘
     │                              │
     │                         3. Award Token
     │                              │
     │                         ┌────▼─────────┐
     │                         │  HeistToken  │
     │◄────────────────────────┤  Service     │
     │ 4. Notification         └────┬─────────┘
     │   "Token Earned"             │
     │                         5. Update balance
     │                              │
     │                         ┌────▼──────────┐
     │                         │  HeistToken   │
     │                         │  Table        │
     │                         │  balance += 1 │
     │                         └───────────────┘
```

**Steps**:
1. User B signs up with User A's referral code
2. Signup API creates User B in database
3. System calls `awardToken(User A)`
4. User A receives in-app + email notification
5. User A's token balance increases by 1

**Transaction Boundaries**:
- Signup transaction: User creation + referral link
- Token award transaction: Token balance + notification (separate)

**Failure Scenarios**:
- Signup succeeds, token award fails → User A doesn't get token (acceptable, can be retried)
- Token award succeeds, notification fails → User A has token but no notification (acceptable)

---

### 2. Heist Execution Flow

```
┌─────────┐                                      ┌─────────┐
│Attacker │                                      │ Victim  │
│User A   │                                      │ User B  │
└────┬────┘                                      └────┬────┘
     │                                                │
     │ 1. POST /api/heist/execute                    │
     │    { targetUserId: B }                        │
     ├──────────────────────►┌──────────────────┐   │
     │                       │   Heist API      │   │
     │                       └────────┬─────────┘   │
     │                                │              │
     │                       2. Validate eligibility│
     │                                │              │
     │                       ┌────────▼─────────┐   │
     │                       │  Validation      │   │
     │                       │  Service         │   │
     │                       └────────┬─────────┘   │
     │                                │              │
     │                       3. BEGIN TRANSACTION   │
     │                                │              │
     │                       ┌────────▼─────────┐   │
     │                       │  PostgreSQL      │   │
     │                       │  Transaction     │   │
     │                       │                  │   │
     │                       │ a. Lock User A   │   │
     │                       │ b. Lock User B   │   │
     │                       │ c. Re-validate   │   │
     │                       │ d. Calculate     │   │
     │                       │    steal amount  │   │
     │                       │ e. Update points │   │
     │                       │ f. Spend token   │   │
     │                       │ g. Create Heist  │   │
     │                       │    record        │   │
     │                       │ h. Create point  │   │
     │                       │    events        │   │
     │                       │ i. Create        │   │
     │                       │    notifications │   │
     │                       │                  │   │
     │                       │ COMMIT           │   │
     │                       └────────┬─────────┘   │
     │                                │              │
     │ ◄──────────────────────────────┘              │
     │ 4. Response:                                  │
     │    { success: true,                           │
     │      pointsStolen: 85 }                       │
     │                                                │
     │ 5. Notification:                              │
     │    "Heist successful!"                        │
     ├───────────────────────────────────────────────┤
     │                                                │
     │                           6. Notification:     │
     │                              "You were robbed!"│
     │                                                │
     │                       7. Optional: Email       │
     │                          notifications         │
     │                          (async)               │
```

**Critical Section**: Steps 3a-3i execute atomically in a single transaction.

**Locks**:
- User A row: `SELECT ... FOR UPDATE` (prevents double-spending)
- User B row: `SELECT ... FOR UPDATE` (prevents concurrent robberies)

**Rollback Triggers**:
- Validation fails (cooldown, protection, insufficient points)
- Database constraint violation
- Network error during transaction

**Post-Commit**:
- Emails sent asynchronously (don't block response)
- Leaderboard cache invalidated

---

### 3. Notification Delivery Flow

```
┌──────────────┐
│   Heist      │
│  Completed   │
└──────┬───────┘
       │
       │ 1. Create notification records (in transaction)
       │
┌──────▼────────────────────────────────────────────┐
│         HeistNotification Table                   │
│  { userId: A, type: HEIST_SUCCESS, read: false }│
│  { userId: B, type: HEIST_VICTIM, read: false }  │
└──────┬────────────────────────────────────────────┘
       │
       ├────────────────────┬─────────────────────┐
       │                    │                     │
       ▼                    ▼                     ▼
┌─────────────┐      ┌──────────────┐     ┌──────────────┐
│   In-App    │      │    Email     │     │   Future:    │
│Notification │      │   Service    │     │   Push       │
│             │      │              │     │   Notification│
│ • Immediate │      │ • Async      │     │              │
│ • Real-time │      │ • Queued     │     │ • Not in MVP │
│ • GET /api/ │      │ • Retry on   │     └──────────────┘
│   heist/    │      │   failure    │
│   notifications    │              │
└─────────────┘      └──────────────┘
```

**Delivery Guarantees**:
- In-app: At-least-once (may see notification multiple times if polling)
- Email: At-most-once (SendGrid handles deduplication)

**Read Status**:
- Client calls POST `/notifications/read` to mark as read
- Affects unread count in UI

---

## Scalability Analysis

### Current Scale Assumptions
- **Users**: 10,000 active users
- **Heists**: ~100,000 per month (~40 per hour)
- **Referrals**: ~5,000 per month (~7 per hour)
- **Notifications**: ~200,000 per month (2x heists)

### Bottleneck Analysis

#### 1. Database Connections
**Current**:
- Prisma connection pool: 10 connections (default)
- Each heist holds 2 connections (attacker + victim locks) for ~100ms

**Capacity**:
- Max concurrent heists: 5 (10 connections / 2)
- At 100ms per heist: 50 heists/second = 180,000 heists/hour

**Verdict**: ✅ No bottleneck at current scale

**Future**: Increase pool size if concurrent users grow

---

#### 2. Database Write Throughput
**Current**:
- Each heist: 6 writes (2 user updates, 1 token update, 1 heist record, 2 point events)
- At 40 heists/hour: 240 writes/hour

**Postgres Capacity**:
- PostgreSQL can handle 10,000+ writes/second on modest hardware
- We're at <1 write/second

**Verdict**: ✅ No bottleneck

---

#### 3. Leaderboard Cache Invalidation
**Current**:
- No cache implemented (direct database queries)
- Each heist changes 2 users' points

**Future Concern**:
- If leaderboard is cached (Redis), each heist invalidates cache
- At high frequency, cache constantly stale

**Solution**:
- Option A: Don't cache leaderboard (acceptable at <1000 users)
- Option B: Update cache in-place instead of invalidating
- Option C: Use TTL-based cache (10 second expiry)

**Recommendation**: Implement caching only when leaderboard queries exceed 50ms

---

#### 4. Email Throughput
**Current**:
- 2 emails per heist = ~80 emails/hour
- SendGrid free tier: 100 emails/day

**Issue**: ⚠️ Will exceed free tier quickly

**Solution**:
- Upgrade to SendGrid paid plan ($15/month for 40,000 emails)
- OR: Make emails optional (`HEIST_EMAIL_ENABLED=false`)
- OR: Batch daily digest emails instead of real-time

**Recommendation**: Start with emails disabled, enable after beta

---

### Horizontal Scaling

**Current Architecture**: Single Node

```
┌─────────────────┐
│   Express.js    │
│   Single Node   │
└────────┬────────┘
         │
┌────────▼────────┐
│   PostgreSQL    │
│   Single DB     │
└─────────────────┘
```

**Future Architecture**: Load Balanced

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ Express.js  │   │ Express.js  │   │ Express.js  │
│   Node 1    │   │   Node 2    │   │   Node 3    │
└──────┬──────┘   └──────┬──────┘   └──────�┬──────┘
       │                 │                  │
       └─────────────────┼──────────────────┘
                         │
                  ┌──────▼──────┐
                  │   Load      │
                  │   Balancer  │
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │ PostgreSQL  │
                  │  Primary    │
                  └──────┬──────┘
                         │
               ┌─────────┴─────────┐
               │                   │
        ┌──────▼──────┐     ┌──────▼──────┐
        │ PostgreSQL  │     │ PostgreSQL  │
        │  Replica 1  │     │  Replica 2  │
        └─────────────┘     └─────────────┘
```

**Considerations**:
- ✅ API layer is stateless (scales horizontally)
- ✅ Database transactions work across load-balanced nodes
- ⚠️ Need session affinity for JWT tokens (or use shared Redis)

**When to Scale**: When response times exceed SLAs (>500ms p95)

---

## Failure Modes & Resilience

### Failure Mode Analysis

#### FM-1: Database Connection Lost During Heist

**Scenario**: Network interruption between API server and database mid-transaction

**Impact**: 
- Heist transaction rolls back automatically
- No points transferred
- Token not spent
- No notifications created

**User Experience**:
- Receives HTTP 500 error
- Client shows generic error message
- User can retry immediately

**Recovery**:
- Automatic (transaction rollback)
- No data inconsistency
- No manual intervention needed

**Mitigation**:
- Prisma retry logic (built-in)
- Connection pool health checks
- Database failover (if replica available)

**Monitoring**:
- Alert on transaction rollback rate >1%
- Alert on database connection failures

---

#### FM-2: Email Service Unavailable

**Scenario**: SendGrid API is down or rate-limited

**Impact**:
- Heist succeeds (already committed)
- In-app notifications created
- Emails not sent

**User Experience**:
- Sees in-app notification
- Doesn't receive email
- No impact on core functionality

**Recovery**:
- Automatic retry (if SendGrid recovers within 24h)
- Manual resend script (if needed)

**Mitigation**:
- Email sending is async (doesn't block heist)
- Queue failed emails for retry
- Log email failures for manual review

**Monitoring**:
- Alert on email failure rate >10%
- Dashboard for email queue depth

---

#### FM-3: Concurrent Heists on Same Victim

**Scenario**: User A and User B both try to rob User C simultaneously

**Expected Behavior**:
- Both heists should succeed (if eligible)
- User C's points updated twice
- Each heist calculates from latest value

**Actual Behavior** (with row locks):
1. User A's transaction locks User C
2. User B's transaction waits for lock
3. User A's transaction commits (User C: 1000 → 950)
4. User B's transaction acquires lock
5. User B's transaction calculates from 950 (not 1000)
6. User B's transaction commits (User C: 950 → 903)

**Result**: ✅ Correct behavior, no race condition

**Monitoring**:
- Track lock wait times
- Alert if lock waits exceed 1 second (indicates deadlock risk)

---

#### FM-4: User Has 0 Points After Heist Calculation

**Scenario**: User C has 10 monthly points, someone tries to rob them

**Validation**:
- Pre-check: User C has <20 points → Heist rejected before transaction
- Edge case: User C has exactly 20 points
  - Steal amount = `FLOOR(20 * 0.05)` = 1 point
  - After heist: User C has 19 points (valid)

**Mitigation**:
- Minimum points check (20) prevents issues
- Database constraint: `CHECK (monthlyPoints >= 0)`

---

#### FM-5: Feature Disabled Mid-Heist

**Scenario**: Admin sets `HEIST_ENABLED=false` while heists in progress

**Behavior**:
- In-progress transactions complete normally
- New heist attempts rejected with `FEATURE_DISABLED` error

**Recovery**:
- Re-enable feature: Set `HEIST_ENABLED=true`
- No database changes needed

**Testing**:
- Verify feature flag checked before transaction starts
- Verify existing transactions not interrupted

---

### Chaos Engineering Scenarios

#### Test 1: Database Failover During Heist
```bash
# Simulate database failure
docker stop postgres-primary

# Expected:
# - Heist fails with connection error
# - Transaction rolls back
# - User can retry after failover completes
```

#### Test 2: High Contention on Single Victim
```bash
# 10 concurrent heists on same victim
for i in {1..10}; do
  curl -X POST /api/heist/execute -d '{"targetUserId": 999}' &
done

# Expected:
# - All heists succeed (if victim has enough points)
# - No race conditions
# - Lock waits logged
```

#### Test 3: Email Service Timeout
```bash
# Mock SendGrid with 30-second timeout
SENDGRID_TIMEOUT=30000

# Expected:
# - Heist completes successfully
# - Email marked as failed in logs
# - No user-facing impact
```

---

## Deployment Architecture

### Development Environment

```
┌──────────────────────────────────────┐
│     Developer Machine (Local)       │
│                                      │
│  ┌────────────┐   ┌──────────────┐ │
│  │ Express.js │   │ PostgreSQL   │ │
│  │ Port 3000  │───│ Port 5432    │ │
│  └────────────┘   │ (Docker)     │ │
│                   └──────────────┘ │
│                                      │
│  .env.development                    │
│  HEIST_ENABLED=true                 │
│  HEIST_EMAIL_ENABLED=false          │
└──────────────────────────────────────┘
```

---

### Staging Environment

```
┌──────────────────────────────────────┐
│        Staging Server (Cloud)        │
│                                      │
│  ┌────────────────────────────────┐ │
│  │      Express.js Container      │ │
│  │      Port 80 (HTTPS)           │ │
│  └────────────┬───────────────────┘ │
│               │                      │
│  ┌────────────▼───────────────────┐ │
│  │    PostgreSQL Container        │ │
│  │    (Separate volume)           │ │
│  └────────────────────────────────┘ │
│                                      │
│  .env.staging                        │
│  HEIST_ENABLED=true                 │
│  HEIST_EMAIL_ENABLED=true           │
│  DATABASE_URL=postgres://staging    │
└──────────────────────────────────────┘
```

---

### Production Environment (Future)

```
┌─────────────────────────────────────────────────────────┐
│                   Production (Cloud)                    │
│                                                         │
│  ┌──────────────────────────────────────────────────┐ │
│  │            Load Balancer (Nginx/AWS ALB)         │ │
│  │                  HTTPS (Port 443)                │ │
│  └──────────┬────────────────────┬──────────────────┘ │
│             │                    │                     │
│  ┌──────────▼──────────┐  ┌──────▼──────────┐        │
│  │  Express Container  │  │ Express Container│        │
│  │       (Node 1)      │  │     (Node 2)     │        │
│  └──────────┬──────────┘  └──────┬───────────┘        │
│             │                    │                     │
│             └────────────┬───────┘                     │
│                          │                             │
│              ┌───────────▼───────────┐                 │
│              │   PostgreSQL Primary  │                 │
│              │   (Managed Service)   │                 │
│              └───────────┬───────────┘                 │
│                          │                             │
│                ┌─────────┴─────────┐                   │
│                │                   │                   │
│         ┌──────▼──────┐     ┌──────▼──────┐          │
│         │  Replica 1  │     │  Replica 2  │          │
│         │ (Read Only) │     │ (Read Only) │          │
│         └─────────────┘     └─────────────┘          │
│                                                         │
│  .env.production                                        │
│  HEIST_ENABLED=true                                    │
│  DATABASE_URL=postgres://prod-primary                  │
└─────────────────────────────────────────────────────────┘
```

---

### Deployment Steps

#### 1. Database Migration
```bash
# Run on staging first
npx prisma migrate deploy

# Verify migration
npx prisma migrate status

# If successful, run on production
```

#### 2. Application Deployment
```bash
# Build Docker image
docker build -t heist-api:v1.0.0 .

# Push to registry
docker push registry/heist-api:v1.0.0

# Deploy (blue-green)
kubectl apply -f k8s/deployment-blue.yaml

# Verify health
curl https://api.example.com/health

# Switch traffic
kubectl apply -f k8s/service-blue.yaml
```

#### 3. Rollback Plan
```bash
# If issues detected
kubectl apply -f k8s/service-green.yaml # Switch back

# If database issues
npx prisma migrate reset # STAGING ONLY

# Feature flag rollback (no deployment)
# Set HEIST_ENABLED=false in environment
```

---

## Monitoring & Observability

### Key Metrics

#### Business Metrics
| Metric | Target | Alert Threshold |
|--------|--------|----------------|
| Heists per day | >100 | <10 (indicates low adoption) |
| Token usage rate | >30% | <10% (indicates poor UX) |
| Heist success rate | >95% | <90% (indicates bugs) |
| Referrals per day | >50 | <5 (indicates low growth) |

#### Technical Metrics
| Metric | Target | Alert Threshold |
|--------|--------|----------------|
| API response time (p95) | <100ms | >500ms |
| Transaction rollback rate | <1% | >5% |
| Database connection errors | 0 | >0 |
| Email delivery rate | >95% | <80% |
| Lock wait time (avg) | <10ms | >100ms |

---

### Logging Strategy

#### Log Levels
- **DEBUG**: Validation checks, eligibility calculations
- **INFO**: Successful heists, token awards
- **WARN**: Validation failures, rate limits
- **ERROR**: Transaction rollbacks, email failures
- **FATAL**: Database connection loss, critical errors

#### Structured Logging Example
```json
{
  "timestamp": "2025-11-07T10:00:00.000Z",
  "level": "INFO",
  "event": "HEIST_SUCCESS",
  "attackerId": 123,
  "victimId": 456,
  "pointsStolen": 85,
  "duration_ms": 87,
  "ipAddress": "192.168.1.1",
  "requestId": "uuid-v4"
}
```

---

### Alerting Rules

#### Critical Alerts (Pager Duty)
1. Transaction rollback rate >5% for 5 minutes
2. Database connection pool exhausted
3. API error rate >1% for 5 minutes

#### Warning Alerts (Email/Slack)
1. Heist success rate <90% for 1 hour
2. Email delivery rate <80% for 15 minutes
3. Response time p95 >500ms for 10 minutes

#### Info Alerts (Dashboard)
1. Daily heist count milestone (100, 500, 1000)
2. New user referral rate changes >20%

---

## Cost Analysis

### Infrastructure Costs (Monthly)

| Component | Current | With Heist | Increase |
|-----------|---------|------------|----------|
| Database storage | $20 | $22 | $2 |
| Database IOPS | $10 | $15 | $5 |
| API compute | $30 | $30 | $0 |
| Email service | $0 (free) | $15 (paid) | $15 |
| **Total** | **$60** | **$82** | **$22/month** |

### Cost Breakdown

#### Database Storage
- 3 new tables: HeistToken, Heist, HeistNotification
- Estimated rows (monthly): 5,000 tokens + 100,000 heists + 200,000 notifications
- Storage per row: ~200 bytes average
- Monthly storage: ~60MB
- Annual storage: ~700MB
- Cost: ~$2/month additional

#### Database IOPS
- Each heist: 6 writes + 4 reads = 10 operations
- 100,000 heists/month = 1,000,000 operations
- Cost: ~$5/month additional

#### Email Service
- 2 emails per heist = 200,000 emails/month
- SendGrid pricing: $14.95/month for 40,000 emails
- Need 5x = $75/month
- **OR**: Use daily digests = $14.95/month
- **Recommendation**: Start with emails disabled, enable selectively

---

### Cost Optimization Strategies

1. **Delay Email Implementation**
   - Start with in-app notifications only
   - Add emails in Phase 2
   - Saves $15/month initially

2. **Implement Email Digests**
   - Daily digest instead of real-time
   - Reduces email count by 10x
   - Same user experience for non-urgent notifications

3. **Database Partitioning** (future)
   - Archive heists older than 90 days
   - Move to cold storage ($0.01/GB)
   - Reduces active database size

4. **Connection Pooling**
   - Optimize pool size (current: 10)
   - Reduces idle connection costs
   - Minimal impact on current scale

**Total Optimized Cost**: $67/month (+$7 instead of +$22)

---

## Alternative Architectures Considered

### Alternative 1: Event-Driven Architecture

**Design**:
```
Heist Request → Event Bus → Processors
                    ↓
          ┌────────┼────────┐
          ▼        ▼        ▼
    Point      Token    Notification
    Processor  Processor  Processor
```

**Pros**:
- ✅ Decoupled components
- ✅ Easier to add new processors
- ✅ Better for high-scale distributed systems

**Cons**:
- ❌ Eventual consistency (points updated later)
- ❌ More complex error handling
- ❌ Requires message queue (Kafka/RabbitMQ)
- ❌ Harder to debug

**Verdict**: ❌ Overkill for MVP, adds unnecessary complexity

---

### Alternative 2: Microservices

**Design**:
```
┌───────────┐  ┌───────────┐  ┌───────────┐
│   User    │  │   Heist   │  │   Points  │
│  Service  │  │  Service  │  │  Service  │
└─────┬─────┘  └─────┬─────┘  └─────┬─────┘
      │              │              │
      └──────────────┼──────────────┘
                     │
              ┌──────▼──────┐
              │   API       │
              │   Gateway   │
              └─────────────┘
```

**Pros**:
- ✅ Independent scaling
- ✅ Technology flexibility
- ✅ Team autonomy

**Cons**:
- ❌ Network latency between services
- ❌ Distributed transaction complexity
- ❌ More infrastructure to manage
- ❌ Overkill for team size

**Verdict**: ❌ Not appropriate for current scale

---

### Alternative 3: Serverless

**Design**:
```
API Gateway → Lambda Functions → DynamoDB
```

**Pros**:
- ✅ Auto-scaling
- ✅ Pay-per-use
- ✅ No server management

**Cons**:
- ❌ Cold start latency
- ❌ Vendor lock-in
- ❌ Difficult to test locally
- ❌ Not compatible with existing infrastructure

**Verdict**: ❌ Incompatible with current monolithic architecture

---

## Technical Debt Assessment

### Debt Introduced

#### TD-1: No Caching Layer
**Description**: Leaderboard queries hit database directly

**Impact**: May slow down at >1000 users

**Mitigation Plan**:
- Phase 2: Add Redis cache
- Invalidate on heist completion
- TTL: 10 seconds

**Estimated Effort**: 1 week

---

#### TD-2: Synchronous Email Sending
**Description**: Emails sent in API request cycle (with async queue)

**Impact**: May delay response if email service slow

**Mitigation Plan**:
- Phase 3: Move to background job queue (Bull/BullMQ)
- Retry logic for failures

**Estimated Effort**: 3 days

---

#### TD-3: No Rate Limiting on Database Level
**Description**: Rate limiting only at API layer

**Impact**: Malicious actor could bypass API and hit DB directly

**Mitigation Plan**:
- Add database-level rate limits (Postgres extensions)
- OR: Move rate limiting to API gateway (Nginx)

**Estimated Effort**: 2 days

---

### Debt Paid Off

#### Improvement 1: Eliminated N+1 Queries
- Previous leaderboard code had N+1 issue
- Heist feature uses Prisma includes (single query)

#### Improvement 2: Added Database Indexes
- Heist feature adds 12 new indexes
- Improves query performance across entire app

---

## Architecture Decision Records

### ADR-001: Use PostgreSQL Transactions (Not Event Sourcing)

**Date**: 2025-11-07

**Status**: ✅ Accepted

**Context**: Need to ensure atomic heist execution

**Decision**: Use PostgreSQL ACID transactions with row-level locking

**Rationale**:
- Simpler to implement
- Guaranteed consistency
- Team familiarity
- Adequate for scale

**Consequences**:
- Cannot replay events
- Harder to audit history
- Acceptable trade-off for MVP

---

### ADR-002: Feature Flag for Instant Rollback

**Date**: 2025-11-07

**Status**: ✅ Accepted

**Context**: Need ability to disable feature without deployment

**Decision**: Use environment variable `HEIST_ENABLED=true/false`

**Rationale**:
- Zero-downtime rollback
- No code changes needed
- Safe testing in production

**Consequences**:
- Must check flag in all endpoints
- Slight performance overhead (negligible)

---

### ADR-003: In-App Notifications Before Emails

**Date**: 2025-11-07

**Status**: ✅ Accepted

**Context**: Email costs may exceed budget at scale

**Decision**: Launch with in-app notifications, add emails later

**Rationale**:
- Reduces initial costs
- Faster time-to-market
- User experience still good

**Consequences**:
- Users may miss notifications if not active
- Need to add emails in Phase 2

---

## Review Checklist

### Architecture Review
- [ ] Pattern appropriateness validated
- [ ] Integration points documented
- [ ] Data flow diagrams accurate
- [ ] Scalability analysis complete
- [ ] Failure modes identified
- [ ] Deployment plan feasible

### Security Review
- [ ] Authentication enforced
- [ ] Authorization correct
- [ ] Input validation comprehensive
- [ ] Transaction integrity guaranteed
- [ ] Audit logging sufficient

### Performance Review
- [ ] Database indexes optimal
- [ ] Query performance acceptable
- [ ] API response times meet SLAs
- [ ] Scalability targets achievable

### Cost Review
- [ ] Infrastructure costs estimated
- [ ] Cost optimization strategies identified
- [ ] Budget approved by finance

---

## Sign-Off

| Role | Name | Approval | Date |
|------|------|----------|------|
| Tech Lead | _________ | [ ] | _____ |
| Senior Engineer | _________ | [ ] | _____ |
| Database Architect | _________ | [ ] | _____ |
| DevOps Engineer | _________ | [ ] | _____ |
| Security Lead | _________ | [ ] | _____ |
| Product Manager | _________ | [ ] | _____ |

---

**Document Status**: 🟡 Pending Architecture Review & Approval

