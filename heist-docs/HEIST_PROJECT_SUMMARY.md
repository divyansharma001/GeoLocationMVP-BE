# 🎯 Heist Token Gamification Feature - Project Summary

## 📋 Overview

The **Heist Token** feature is a strategic gamification layer that allows users to "rob" other players on the leaderboard. Users earn tokens through successful referrals and can spend them to steal a small percentage of another player's monthly points.

**Status**: ✅ **Planning Phase Complete - Ready to Build**

---

## 🎮 Core Mechanics Summary

### How It Works

1. **Earn Tokens**: User A refers User B → User B signs up → User A gets 1 Heist Token
2. **Rob Someone**: User A goes to leaderboard → Selects User C → Spends 1 token → Steals 5% of User C's monthly points (max 100)
3. **Notifications**: Both users get notified via in-app notification and email
4. **Cooldowns**: User A can't rob again for 24 hours; User C can't be robbed for 48 hours

### Key Constraints

- **Cost**: 1 Heist Token per robbery attempt
- **Steal Amount**: 5% of victim's `monthlyPoints`, capped at 100 points
- **Minimum Target**: Victim must have ≥20 points to be robbable
- **Cooldowns**: 
  - Attacker: 24 hours between heists
  - Victim: 48 hours protection after being robbed
- **Self-Protection**: Cannot rob yourself

---

## 📁 Documentation Structure

We've created a comprehensive set of documents to guide implementation:

### 1. **HEIST_TOKEN_FEATURE_PLAN.md** (Main Plan)
- Complete feature specification
- Database schema design
- API endpoint definitions
- Integration points
- Analytics framework
- Future enhancement ideas

### 2. **HEIST_SCHEMA_CHANGES.md** (Database)
- Detailed schema changes
- Migration SQL
- Seeding requirements
- Rollback procedures
- Performance considerations

### 3. **HEIST_IMPLEMENTATION_CHECKLIST.md** (Execution)
- Phase-by-phase implementation tasks
- Testing requirements
- Deployment steps
- Success metrics
- Timeline estimates (6 weeks total)

### 4. **HEIST_CONFIGURATION.md** (Operations)
- Environment variable reference
- Configuration examples
- Calculation formulas
- Monitoring queries
- Troubleshooting guide

---

## 🗄️ Database Changes

### New Tables Added

1. **HeistToken** - Tracks user token balances
2. **Heist** - Records all heist attempts
3. **HeistNotification** - Stores heist-related notifications

### New Enums Added

1. **HeistStatus** - SUCCESS, FAILED_COOLDOWN, FAILED_TARGET_PROTECTED, etc.
2. **HeistNotificationType** - HEIST_SUCCESS, HEIST_VICTIM, TOKEN_EARNED, etc.

### Updated Enums

- **PointEventType** - Added HEIST_GAIN and HEIST_LOSS

### Schema Update Status

✅ **Schema.prisma updated** with all new models and relations  
⏳ **Migration pending** - Run: `npx prisma migrate dev --name add_heist_token_feature`

---

## 🚀 Next Steps (Immediate Actions)

### Step 1: Review & Approve (1-2 days)
- [ ] Review feature plan with product team
- [ ] Review technical architecture with backend team
- [ ] Approve configuration values:
  - Steal percentage: 5%
  - Max steal amount: 100 points
  - Cooldown periods: 24h/48h
  - Token earning rate: 1 per referral
- [ ] Get security approval
- [ ] Get database approval

### Step 2: Create Migration (1 day)
- [ ] Run: `npx prisma migrate dev --name add_heist_token_feature`
- [ ] Verify migration file
- [ ] Test migration on local database
- [ ] Review generated SQL
- [ ] Commit migration to git

### Step 3: Seed Data (1 day)
- [ ] Create `scripts/seed-heist.ts`
- [ ] Add HEIST_GAIN and HEIST_LOSS to PointEventTypeMaster
- [ ] Run seed script
- [ ] Verify seed data in database

### Step 4: Begin Phase 2 (Week 2)
- [ ] Implement core business logic
- [ ] Token management functions
- [ ] Heist validation logic
- [ ] Heist execution logic
- [ ] Write unit tests

---

## 📊 Implementation Timeline

| Phase | Duration | Start Date | End Date | Status |
|-------|----------|------------|----------|--------|
| 1. Database & Schema | 2 days | TBD | TBD | ✅ Planning Complete |
| 2. Core Business Logic | 5 days | TBD | TBD | ⏳ Pending |
| 3. Notifications | 3 days | TBD | TBD | ⏳ Pending |
| 4. API Endpoints | 5 days | TBD | TBD | ⏳ Pending |
| 5. Integration | 3 days | TBD | TBD | ⏳ Pending |
| 6. Testing | 5 days | TBD | TBD | ⏳ Pending |
| 7. Analytics | 2 days | TBD | TBD | ⏳ Pending |
| 8. Documentation | 2 days | TBD | TBD | ⏳ Pending |
| 9. Security & Performance | 3 days | TBD | TBD | ⏳ Pending |
| 10. Deployment | 2 days | TBD | TBD | ⏳ Pending |

**Total Duration**: ~30 working days (6 weeks)

---

## 🎯 Success Criteria

The feature will be considered successful if:

1. **Adoption**: 30%+ of users with tokens perform at least 1 heist/month
2. **Engagement**: Referral rate increases by 20%+
3. **Retention**: Users check leaderboard 2x more frequently
4. **Stability**: <0.1% error rate on heist operations
5. **Fairness**: No single user loses >10% monthly points to heists

---

## 🔧 Technical Stack

### Backend
- **Framework**: Express.js + TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Authentication**: JWT middleware (already implemented)
- **Email**: Existing email service (`src/lib/email.ts`)
- **Notifications**: New notification system (to be built)

### Key Dependencies
- Prisma Client (ORM)
- Zod (validation)
- Express Rate Limit (API protection)
- Date-fns (date calculations)

---

## 🔐 Security Measures

- ✅ All endpoints require authentication
- ✅ Database transactions for atomic operations
- ✅ Row-level locking during point transfers
- ✅ Rate limiting on heist execution (10 req/min)
- ✅ Input validation with Zod schemas
- ✅ Audit logging of all heist attempts
- ✅ Prevention of self-robbery
- ✅ Cooldown enforcement server-side

---

## 📈 Expected Impact

### User Engagement
- **Referrals**: 20-30% increase expected
- **Leaderboard Views**: 2-3x increase expected
- **Daily Active Users**: 10-15% increase expected
- **Session Duration**: 15-20% increase expected

### Point Economy
- **Monthly Point Redistribution**: ~5-10% of total points
- **Average Points Lost per User**: 20-50 points/month
- **Top Players Impact**: Protected by 100-point cap

---

## 🐛 Risk Mitigation

### Technical Risks

| Risk | Mitigation |
|------|------------|
| Race conditions | Use database transactions with row locking |
| Database performance | Add indexes (already in schema) |
| Email delivery failures | Queue with retry logic, don't block API |
| High API load | Rate limiting + caching |

### Product Risks

| Risk | Mitigation |
|------|------------|
| User frustration (being robbed) | 48-hour protection, 100-point cap, encouragement emails |
| Token hoarding | Monitor usage rates, add expiration if needed |
| Referral fraud | Monitor for suspicious patterns, add verification |
| Unbalanced economy | Configuration tunable without code changes |

---

## 🔮 Future Enhancements

Ready for Phase 2 (after successful launch):

1. **Shield System**: Buy protection with coins
2. **Heist Achievements**: Gamify the heists themselves
3. **Heist Leaderboard**: Who's the best thief?
4. **Team Heists**: Collaborate with friends
5. **Insurance System**: Monthly subscription for point protection
6. **Counter-Heist**: Catch the robber and steal back double

---

## 📞 Team Contacts

- **Project Lead**: [Name] - Overall coordination
- **Backend Lead**: [Name] - Technical implementation
- **Database**: [Name] - Schema & performance
- **Product**: [Name] - Requirements & metrics
- **QA**: [Name] - Testing strategy
- **DevOps**: [Name] - Deployment & monitoring

---

## 📚 Quick Links

- [Main Feature Plan](./HEIST_TOKEN_FEATURE_PLAN.md)
- [Schema Changes](./HEIST_SCHEMA_CHANGES.md)
- [Implementation Checklist](./HEIST_IMPLEMENTATION_CHECKLIST.md)
- [Configuration Guide](./HEIST_CONFIGURATION.md)
- [API Documentation](./API_DOCUMENTATION.md) (to be updated)

---

## 🎉 Project Status

**Current Progress**: 10% (Planning Phase Complete)

### ✅ Completed
- Feature specification and design
- Database schema design
- API endpoint definitions
- Integration strategy
- Testing strategy
- Documentation framework
- Risk analysis
- Timeline estimation

### ⏳ Next Up
- Get stakeholder approval
- Create database migration
- Seed point event types
- Begin core business logic implementation

### 🎯 Target Launch Date
To be determined after team review and approval.

---

## 📝 Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2025-11-07 | 1.0.0 | Initial planning phase completed |

---

## ✅ Approval Checklist

Before proceeding to implementation:

- [ ] Product team approval
- [ ] Backend team technical review
- [ ] Database team schema approval
- [ ] Security team review
- [ ] UX team notification plan approval
- [ ] Budget approval (email costs, infrastructure)
- [ ] Timeline approval
- [ ] Success metrics agreement

---

**Ready to build! 🚀**

Start with: `npx prisma migrate dev --name add_heist_token_feature`

