# 🎯 Heist Token Feature - Implementation Checklist

This checklist tracks all tasks needed to implement the complete Heist Token gamification feature.

---

## ✅ Phase 1: Database & Schema (CURRENT)

### Database Schema
- [x] Design HeistToken model
- [x] Design Heist model  
- [x] Design HeistNotification model
- [x] Add HeistStatus enum
- [x] Add HeistNotificationType enum
- [x] Update PointEventType enum (add HEIST_GAIN, HEIST_LOSS)
- [x] Add User model relations
- [x] Create schema documentation
- [ ] Create migration file: `npx prisma migrate dev --name add_heist_token_feature`
- [ ] Run migration
- [ ] Generate Prisma client: `npx prisma generate`
- [ ] Verify schema in database

### Seed Data
- [ ] Create `scripts/seed-heist.ts`
- [ ] Add HEIST_GAIN point event type to PointEventTypeMaster
- [ ] Add HEIST_LOSS point event type to PointEventTypeMaster
- [ ] Run seed script
- [ ] Verify seed data

---

## 📦 Phase 2: Core Business Logic

### Token Management (`src/lib/heist/tokens.ts`)
- [ ] Create `getTokenBalance()` - Get user's token balance
- [ ] Create `awardToken()` - Award token on referral
- [ ] Create `spendToken()` - Spend token on heist
- [ ] Create `getTokenHistory()` - Get token earning/spending history
- [ ] Add unit tests for token operations

### Heist Validation (`src/lib/heist/validation.ts`)
- [ ] Create `canPerformHeist()` - Check attacker cooldown
- [ ] Create `isValidTarget()` - Validate target user
- [ ] Create `checkTargetProtection()` - Check victim cooldown
- [ ] Create `calculateStealAmount()` - Calculate points to steal (5%, max 100)
- [ ] Create `checkMinimumPoints()` - Ensure victim has ≥20 points
- [ ] Add unit tests for validation logic

### Heist Execution (`src/lib/heist/execution.ts`)
- [ ] Create `executeHeist()` - Main heist execution function
- [ ] Implement transaction handling (atomic point transfer)
- [ ] Create point event records (HEIST_GAIN, HEIST_LOSS)
- [ ] Update victim monthlyPoints
- [ ] Update attacker monthlyPoints
- [ ] Spend heist token
- [ ] Create heist record
- [ ] Handle rollback on failure
- [ ] Add comprehensive unit tests

### Cooldown Management (`src/lib/heist/cooldowns.ts`)
- [ ] Create `getAttackerCooldown()` - Get user's next available heist time
- [ ] Create `getVictimProtection()` - Get victim's protection end time
- [ ] Create `setCooldown()` - Set cooldown after heist
- [ ] Create `setProtection()` - Set protection after being robbed
- [ ] Add Redis caching for cooldowns (optional performance boost)
- [ ] Add unit tests

---

## 🔔 Phase 3: Notifications

### Notification System (`src/lib/heist/notifications.ts`)
- [ ] Create `createHeistNotification()` - Create in-app notification
- [ ] Create `sendHeistSuccessNotification()` - Notify attacker
- [ ] Create `sendHeistVictimNotification()` - Notify victim
- [ ] Create `sendTokenEarnedNotification()` - Notify token earned
- [ ] Create `markNotificationsRead()` - Mark as read
- [ ] Create `getUnreadNotifications()` - Get unread count
- [ ] Add unit tests

### Email Templates (`src/lib/email.ts`)
- [ ] Create `sendHeistSuccessEmail()` template
  - Include: victim name, points stolen, new total
  - Celebration tone
- [ ] Create `sendHeistVictimEmail()` template
  - Include: attacker name, points lost, remaining points
  - Sympathetic but encouraging tone
- [ ] Create `sendTokenEarnedEmail()` template
  - Include: referral name, tokens available
- [ ] Test email rendering
- [ ] Add email sending tests

---

## 🌐 Phase 4: API Endpoints

### Create Route Files
- [ ] Create `src/routes/heist.routes.ts`
- [ ] Add route to Express app (`src/app.ts`)

### Implement Endpoints

#### GET /api/heist/tokens
- [ ] Implement endpoint
- [ ] Add authentication middleware
- [ ] Return: balance, totalEarned, totalSpent, lastEarned
- [ ] Add error handling
- [ ] Add unit tests
- [ ] Add integration tests

#### GET /api/heist/history
- [ ] Implement endpoint
- [ ] Add authentication middleware
- [ ] Support query params: type, limit, offset
- [ ] Return paginated heist history
- [ ] Add error handling
- [ ] Add unit tests
- [ ] Add integration tests

#### POST /api/heist/execute
- [ ] Implement endpoint
- [ ] Add authentication middleware
- [ ] Validate request body (targetUserId)
- [ ] Check eligibility
- [ ] Execute heist
- [ ] Send notifications
- [ ] Return heist result
- [ ] Add comprehensive error handling
- [ ] Add unit tests
- [ ] Add integration tests
- [ ] Add rate limiting (max 10 req/min)

#### GET /api/heist/can-rob/:targetUserId
- [ ] Implement endpoint
- [ ] Add authentication middleware
- [ ] Check eligibility without executing
- [ ] Return: eligible, potentialSteal, cooldown status, etc.
- [ ] Add error handling
- [ ] Add unit tests
- [ ] Add integration tests

#### GET /api/heist/notifications
- [ ] Implement endpoint
- [ ] Add authentication middleware
- [ ] Support query params: unreadOnly, limit
- [ ] Return notifications with pagination
- [ ] Include unread count
- [ ] Add error handling
- [ ] Add unit tests
- [ ] Add integration tests

#### POST /api/heist/notifications/read
- [ ] Implement endpoint
- [ ] Add authentication middleware
- [ ] Support marking single or all notifications
- [ ] Add error handling
- [ ] Add unit tests
- [ ] Add integration tests

---

## 🔗 Phase 5: Integration with Existing Systems

### Referral System Integration
- [ ] Update `src/routes/auth.routes.ts` - Award token on referral signup
- [ ] Add token notification on referral
- [ ] Test referral flow with token award
- [ ] Update API documentation

### Leaderboard Integration
- [ ] Update `src/routes/leaderboard.routes.ts`
- [ ] Add `canRob` boolean to leaderboard entries
- [ ] Add `heistEligibility` object with details
- [ ] Add token count to user profile in leaderboard
- [ ] Test leaderboard with heist data
- [ ] Update API documentation

### Points System Integration
- [ ] Ensure heists create UserPointEvent records
- [ ] Verify points affect leaderboards correctly
- [ ] Verify points affect achievements
- [ ] Test point calculation accuracy
- [ ] Invalidate leaderboard cache on heist

### User Profile Integration
- [ ] Add heist stats to profile endpoint
- [ ] Show: tokens, heists performed, times robbed
- [ ] Show: total points stolen, total points lost
- [ ] Test profile endpoint

---

## 🧪 Phase 6: Testing

### Unit Tests
- [ ] Token management tests (15+ test cases)
- [ ] Heist validation tests (20+ test cases)
- [ ] Heist execution tests (25+ test cases)
- [ ] Cooldown management tests (10+ test cases)
- [ ] Notification tests (15+ test cases)
- [ ] API endpoint tests (30+ test cases)
- [ ] Target: >90% code coverage

### Integration Tests
- [ ] Full heist flow (referral → token → heist → notifications)
- [ ] Cooldown enforcement tests
- [ ] Concurrent heist attempt tests (race conditions)
- [ ] Edge case tests (0 points, max points, etc.)
- [ ] Error handling tests
- [ ] Target: All critical paths covered

### Load Tests (Optional)
- [ ] Test 100 concurrent heist requests
- [ ] Test database transaction performance
- [ ] Test notification system under load
- [ ] Optimize slow queries

---

## 📊 Phase 7: Analytics & Monitoring

### Analytics Setup
- [ ] Add heist event tracking
  - Track: heist_executed, heist_failed, token_earned, token_spent
- [ ] Create analytics dashboard queries
  - Daily heist volume
  - Average points stolen
  - Top robbers
  - Most robbed users
- [ ] Set up monitoring alerts
  - High failure rate
  - Database errors
  - Email delivery failures

### Admin Tools
- [ ] Create admin endpoint: GET /api/admin/heist/stats
- [ ] Create admin endpoint: GET /api/admin/heist/users/:userId
- [ ] Add heist data to admin dashboard
- [ ] Create manual intervention tools (refund heist, adjust tokens)

---

## 📝 Phase 8: Documentation

### API Documentation
- [ ] Update `API_DOCUMENTATION.md` with all heist endpoints
- [ ] Add request/response examples
- [ ] Document error codes
- [ ] Add authentication requirements

### User Guides
- [ ] Create `HEIST_TOKEN_USER_GUIDE.md`
- [ ] Explain how to earn tokens
- [ ] Explain how to perform heists
- [ ] Explain cooldowns and protections
- [ ] Add FAQ section

### Developer Documentation
- [ ] Document heist business logic
- [ ] Document database schema
- [ ] Add code comments
- [ ] Create architecture diagrams
- [ ] Document testing strategy

### Configuration Documentation
- [ ] Document environment variables
- [ ] Create configuration examples
- [ ] Document feature flags
- [ ] Add deployment notes

---

## 🔒 Phase 9: Security & Performance

### Security Audit
- [ ] Review authentication on all endpoints
- [ ] Verify authorization checks (can't rob yourself)
- [ ] Test for SQL injection vulnerabilities
- [ ] Test for race conditions
- [ ] Review audit logging
- [ ] Test rate limiting
- [ ] Verify input validation

### Performance Optimization
- [ ] Add database indexes (already in schema)
- [ ] Optimize expensive queries
- [ ] Add caching where appropriate
- [ ] Test with realistic data volume
- [ ] Profile slow endpoints
- [ ] Optimize transaction size

---

## 🚀 Phase 10: Deployment

### Pre-Deployment
- [ ] Code review (all team members)
- [ ] Security review
- [ ] Performance review
- [ ] Test coverage review (ensure >90%)
- [ ] Documentation review
- [ ] Create deployment plan

### Staging Deployment
- [ ] Deploy to staging environment
- [ ] Run migration on staging
- [ ] Seed test data
- [ ] Run full test suite
- [ ] Manual QA testing
- [ ] Load testing
- [ ] Fix any issues found

### Production Deployment
- [ ] Create database backup
- [ ] Deploy code to production
- [ ] Run migration on production
- [ ] Seed PointEventTypeMaster data
- [ ] Verify migration success
- [ ] Monitor error logs (first 24 hours)
- [ ] Monitor performance metrics
- [ ] Monitor user adoption

### Post-Deployment
- [ ] Announce feature to users
- [ ] Monitor adoption metrics
- [ ] Gather user feedback
- [ ] Create iteration plan based on feedback

---

## 🔮 Phase 11: Future Enhancements (Backlog)

### Shield System (Defense Mechanism)
- [ ] Design shield model
- [ ] Implement shield purchase with coins
- [ ] Implement shield activation
- [ ] Implement shield expiration (7 days)
- [ ] Add shield blocked notification
- [ ] Update heist validation to check shields
- [ ] Test shield functionality

### Heist Achievements
- [ ] "First Heist" achievement
- [ ] "Master Thief" - 10 successful heists
- [ ] "Untouchable" - No heists against you for 30 days
- [ ] "Robin Hood" - Steal from top 3 players
- [ ] Add achievement rewards

### Heist Leaderboard
- [ ] Track heist statistics per user
- [ ] Create monthly heist leaderboard
- [ ] Show: most points stolen, most successful heists
- [ ] Add heist leaderboard API endpoint

### Team Heists
- [ ] Allow multiple users to team up
- [ ] Split stolen points among team
- [ ] Require multiple tokens
- [ ] Add team heist endpoints

### Insurance System
- [ ] Allow users to buy insurance with coins
- [ ] Insurance protects % of points
- [ ] Monthly subscription model
- [ ] Add insurance purchase endpoint

---

## 📋 Environment Variables Checklist

Add to `.env` file:

```env
# Heist Feature Configuration
HEIST_ENABLED=true
HEIST_COOLDOWN_HOURS=24
HEIST_TARGET_COOLDOWN_HOURS=48
HEIST_STEAL_PERCENTAGE=5
HEIST_MAX_STEAL_POINTS=100
HEIST_MIN_TARGET_POINTS=20
HEIST_EMAIL_ENABLED=true
HEIST_RATE_LIMIT_PER_MINUTE=10
```

- [ ] Add variables to `.env.example`
- [ ] Add variables to production environment
- [ ] Add variables to staging environment
- [ ] Document each variable

---

## 🎯 Success Metrics

Track these KPIs after launch:

### Adoption Metrics
- [ ] % users with tokens who perform heists (target: 30%+)
- [ ] Average heists per user per month
- [ ] Token usage rate (tokens spent / tokens earned)

### Engagement Metrics
- [ ] Referral rate change (target: +20%)
- [ ] Leaderboard visit frequency (target: 2x increase)
- [ ] Daily active users change
- [ ] Session duration change

### Technical Metrics
- [ ] Heist API error rate (target: <0.1%)
- [ ] Average heist execution time (target: <50ms)
- [ ] Database transaction success rate (target: >99.9%)
- [ ] Email delivery rate (target: >95%)

### Fairness Metrics
- [ ] Average points lost per user per month
- [ ] Max % points lost by any user (target: <10%)
- [ ] Distribution of heist targets (ensure no single user targeted excessively)

---

## 🐛 Known Issues / Tech Debt

Track issues here:

- [ ] None yet

---

## 📞 Rollback Plan

If critical issues arise:

1. **Immediate Actions**:
   - [ ] Set `HEIST_ENABLED=false` in environment
   - [ ] Restart application servers
   - [ ] Monitor error rate decrease

2. **Full Rollback**:
   - [ ] Revert code deployment
   - [ ] Restore database from backup
   - [ ] Run down migration (if safe)
   - [ ] Verify system stability

3. **Post-Rollback**:
   - [ ] Analyze root cause
   - [ ] Fix issues
   - [ ] Test fix thoroughly
   - [ ] Create new deployment plan

---

## 📅 Timeline Estimate

- **Phase 1**: 2 days (Database & Schema)
- **Phase 2**: 5 days (Core Business Logic)
- **Phase 3**: 3 days (Notifications)
- **Phase 4**: 5 days (API Endpoints)
- **Phase 5**: 3 days (Integration)
- **Phase 6**: 5 days (Testing)
- **Phase 7**: 2 days (Analytics)
- **Phase 8**: 2 days (Documentation)
- **Phase 9**: 3 days (Security & Performance)
- **Phase 10**: 2 days (Deployment)

**Total: ~30 working days (6 weeks)**

---

## 👥 Team Assignments

- **Backend Lead**: [Name] - Core business logic, API endpoints
- **Database**: [Name] - Schema design, migrations, optimization
- **Testing**: [Name] - Unit tests, integration tests, load tests
- **Frontend**: [Name] - UI integration (future phase)
- **DevOps**: [Name] - Deployment, monitoring, infrastructure
- **Product**: [Name] - Requirements, documentation, user guides

---

## 🎉 Launch Checklist

Final checks before announcing feature:

- [ ] All tests passing (100%)
- [ ] Code coverage >90%
- [ ] Documentation complete
- [ ] Security audit complete
- [ ] Performance benchmarks met
- [ ] Production deployment successful
- [ ] No critical errors in logs (24 hour check)
- [ ] Analytics tracking working
- [ ] Email notifications working
- [ ] Admin tools working
- [ ] Rollback plan tested

---

**Last Updated**: November 7, 2025  
**Current Phase**: Phase 1 (Database & Schema)  
**Progress**: 10% (Schema design complete, migration pending)  
**Next Milestone**: Complete migration and begin Phase 2

