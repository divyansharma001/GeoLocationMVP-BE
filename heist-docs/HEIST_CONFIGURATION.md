# 🎯 Heist Token Feature - Quick Configuration Reference

## Environment Variables

```env
# Feature Toggle
HEIST_ENABLED=true                          # Enable/disable heist feature globally

# Timing & Cooldowns
HEIST_COOLDOWN_HOURS=24                     # Hours between heists for same attacker
HEIST_TARGET_COOLDOWN_HOURS=48              # Hours of protection after being robbed

# Robbery Economics
HEIST_STEAL_PERCENTAGE=5                    # Percentage of victim's monthlyPoints to steal
HEIST_MAX_STEAL_POINTS=100                  # Maximum points that can be stolen in one heist
HEIST_MIN_TARGET_POINTS=20                  # Minimum points victim must have to be robbable

# Notifications
HEIST_EMAIL_ENABLED=true                    # Send email notifications for heist events

# Rate Limiting
HEIST_RATE_LIMIT_PER_MINUTE=10             # Max API requests per minute per user
```

---

## Default Configuration Values

| Setting | Default | Description | Recommended Range |
|---------|---------|-------------|-------------------|
| Cooldown | 24 hours | Time between heists | 12-48 hours |
| Target Protection | 48 hours | Protection after being robbed | 24-72 hours |
| Steal % | 5% | Percentage stolen | 3-10% |
| Max Steal | 100 points | Cap on stolen points | 50-200 points |
| Min Target Points | 20 points | Minimum to be robbable | 10-50 points |

---

## Calculation Examples

### Steal Amount Calculation

```
stealAmount = min(
  Math.floor(victimMonthlyPoints * (HEIST_STEAL_PERCENTAGE / 100)),
  HEIST_MAX_STEAL_POINTS
)
```

**Examples:**

| Victim Points | Steal % | Calculated | Capped | Final Stolen |
|---------------|---------|------------|--------|--------------|
| 500 | 5% | 25 | 100 | **25** |
| 1,000 | 5% | 50 | 100 | **50** |
| 2,000 | 5% | 100 | 100 | **100** |
| 5,000 | 5% | 250 | 100 | **100** (capped) |
| 10,000 | 5% | 500 | 100 | **100** (capped) |
| 15 | 5% | 0.75 | 100 | **0** (below minimum) |

---

## Token Economics

### Earning Tokens
- **1 token** = 1 successful referral (referred user completes signup)
- Tokens never expire
- No maximum token limit
- Tokens are account-bound (non-transferable)

### Spending Tokens
- **1 token** = 1 heist attempt
- Tokens are consumed immediately when heist is initiated
- Failed heist attempts still consume the token (prevents spam)

### Token Balance Formula
```
currentBalance = totalEarned - totalSpent
```

---

## Cooldown System

### Attacker Cooldown
- **Duration**: 24 hours (configurable)
- **Starts**: Immediately after successful heist
- **Applies to**: The attacking user
- **Prevents**: Same user from performing another heist

### Victim Protection
- **Duration**: 48 hours (configurable)
- **Starts**: Immediately after being robbed
- **Applies to**: The victim user
- **Prevents**: Same user from being robbed again

### Cooldown Check Logic
```typescript
// Attacker cooldown check
const lastHeist = await getLastHeistByAttacker(attackerId);
const cooldownEnd = addHours(lastHeist.createdAt, HEIST_COOLDOWN_HOURS);
const onCooldown = now < cooldownEnd;

// Victim protection check
const lastRobbed = await getLastHeistAsVictim(victimId);
const protectionEnd = addHours(lastRobbed.createdAt, HEIST_TARGET_COOLDOWN_HOURS);
const isProtected = now < protectionEnd;
```

---

## Validation Rules

### Pre-Heist Checks (in order)

1. **Authentication**: User must be logged in ✓
2. **Token Balance**: User must have ≥1 token ✓
3. **Self-Target**: Cannot rob yourself ✓
4. **Target Exists**: Target user must exist ✓
5. **Target Active**: Target must not be suspended/deleted ✓
6. **Attacker Cooldown**: Must not be on cooldown ✓
7. **Victim Protection**: Victim must not be protected ✓
8. **Minimum Points**: Victim must have ≥20 points ✓

**If any check fails, heist is rejected with appropriate error message.**

---

## Notification Types

### 1. HEIST_SUCCESS (Attacker)
**Trigger**: After successful heist  
**Recipients**: Attacker only  
**Message**: "Success! You pulled a heist on {victimName} and stole {pointsStolen} points!"  
**Email**: Yes (if enabled)

### 2. HEIST_VICTIM (Victim)
**Trigger**: After successful heist  
**Recipients**: Victim only  
**Message**: "Oh no! {attackerName} just pulled a heist on you and stole {pointsLost} of your monthly points!"  
**Email**: Yes (if enabled)

### 3. TOKEN_EARNED (Referrer)
**Trigger**: After successful referral signup  
**Recipients**: Referrer only  
**Message**: "You earned a Heist Token! {referredName} joined using your referral code."  
**Email**: Yes (if enabled)

---

## Database Point Event Types

### HEIST_GAIN
- **Created for**: Attacker
- **Points**: Positive value (amount stolen)
- **Purpose**: Track points gained from heists
- **Affects**: monthlyPoints, leaderboards

### HEIST_LOSS
- **Created for**: Victim
- **Points**: Negative value (amount lost)
- **Purpose**: Track points lost to heists
- **Affects**: monthlyPoints, leaderboards

---

## API Endpoints Quick Reference

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/heist/tokens` | GET | ✓ | Get token balance |
| `/api/heist/history` | GET | ✓ | Get heist history |
| `/api/heist/execute` | POST | ✓ | Perform heist |
| `/api/heist/can-rob/:id` | GET | ✓ | Check eligibility |
| `/api/heist/notifications` | GET | ✓ | Get notifications |
| `/api/heist/notifications/read` | POST | ✓ | Mark as read |

---

## Error Codes

| Code | Message | Reason |
|------|---------|--------|
| `INSUFFICIENT_TOKENS` | You need 1 Heist Token | No tokens available |
| `COOLDOWN_ACTIVE` | You can rob again in X hours | Attacker on cooldown |
| `TARGET_PROTECTED` | User recently robbed | Victim protected |
| `INVALID_TARGET` | Cannot rob this user | Self-target or invalid |
| `INSUFFICIENT_POINTS` | Target has < 20 points | Below minimum |
| `TARGET_NOT_FOUND` | User not found | Invalid userId |
| `HEIST_DISABLED` | Feature disabled | HEIST_ENABLED=false |

---

## Tuning Recommendations

### For High Engagement (Aggressive)
```env
HEIST_COOLDOWN_HOURS=12
HEIST_TARGET_COOLDOWN_HOURS=24
HEIST_STEAL_PERCENTAGE=8
HEIST_MAX_STEAL_POINTS=150
HEIST_MIN_TARGET_POINTS=10
```

### For Balanced Gameplay (Default)
```env
HEIST_COOLDOWN_HOURS=24
HEIST_TARGET_COOLDOWN_HOURS=48
HEIST_STEAL_PERCENTAGE=5
HEIST_MAX_STEAL_POINTS=100
HEIST_MIN_TARGET_POINTS=20
```

### For Conservative (Low Impact)
```env
HEIST_COOLDOWN_HOURS=48
HEIST_TARGET_COOLDOWN_HOURS=72
HEIST_STEAL_PERCENTAGE=3
HEIST_MAX_STEAL_POINTS=50
HEIST_MIN_TARGET_POINTS=50
```

---

## Monitoring Queries

### Daily Heist Volume
```sql
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_heists,
  AVG(points_stolen) as avg_points_stolen,
  SUM(points_stolen) as total_points_stolen
FROM "Heist"
WHERE status = 'SUCCESS'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### Top Robbers
```sql
SELECT 
  u.name,
  u.email,
  COUNT(h.id) as heist_count,
  SUM(h.points_stolen) as total_stolen
FROM "Heist" h
JOIN "User" u ON h.attacker_id = u.id
WHERE h.status = 'SUCCESS'
  AND h.created_at >= NOW() - INTERVAL '30 days'
GROUP BY u.id, u.name, u.email
ORDER BY heist_count DESC
LIMIT 10;
```

### Most Robbed Users
```sql
SELECT 
  u.name,
  u.email,
  COUNT(h.id) as times_robbed,
  SUM(h.points_stolen) as total_lost
FROM "Heist" h
JOIN "User" u ON h.victim_id = u.id
WHERE h.status = 'SUCCESS'
  AND h.created_at >= NOW() - INTERVAL '30 days'
GROUP BY u.id, u.name, u.email
ORDER BY times_robbed DESC
LIMIT 10;
```

### Token Distribution
```sql
SELECT 
  balance,
  COUNT(*) as user_count
FROM "HeistToken"
GROUP BY balance
ORDER BY balance DESC;
```

---

## Performance Benchmarks

| Operation | Target Time | Notes |
|-----------|-------------|-------|
| Get token balance | <5ms | Simple SELECT |
| Check eligibility | <10ms | Multiple checks |
| Execute heist | <50ms | Transaction with updates |
| Get notifications | <10ms | Paginated SELECT |
| Send email | <100ms | Async, non-blocking |

---

## Security Checklist

- [x] All endpoints require authentication
- [x] Validate user cannot rob themselves
- [x] Use database transactions for atomic operations
- [x] Rate limit heist execution endpoint
- [x] Validate all user inputs
- [x] Log all heist attempts (success and failure)
- [x] Prevent SQL injection with parameterized queries
- [x] Test for race conditions

---

## Common Issues & Solutions

### Issue: Heists failing due to cooldown
**Solution**: Check `HEIST_COOLDOWN_HOURS` setting. Consider reducing if too restrictive.

### Issue: No one being robbed
**Solution**: Most users may have <20 points. Lower `HEIST_MIN_TARGET_POINTS`.

### Issue: Top players losing too many points
**Solution**: Lower `HEIST_STEAL_PERCENTAGE` or `HEIST_MAX_STEAL_POINTS`.

### Issue: Token usage very low
**Solution**: Reduce cooldowns, increase steal amounts, or add more incentives.

### Issue: Too many concurrent heists causing database locks
**Solution**: Implement queue system or increase connection pool size.

---

**Quick Start Command:**

```bash
# 1. Set environment variables in .env
# 2. Run migration
npx prisma migrate dev --name add_heist_token_feature

# 3. Generate Prisma client
npx prisma generate

# 4. Seed point event types
npm run seed:heist

# 5. Start server
npm run dev
```

---

**Last Updated**: November 7, 2025  
**Version**: 1.0.0  
**Status**: Initial Configuration

