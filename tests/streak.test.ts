/**
 * Streak Feature Tests
 * Tests for user check-in streaks and discount calculations
 */

import request from 'supertest';
import app, { resetDatabase } from '../src/app';
import prisma from '../src/lib/prisma';
import jwt from 'jsonwebtoken';
import {
  calculateDiscountPercentage,
  applyStreakDiscount,
  updateStreakAfterCheckIn,
  getStreakInfo,
} from '../src/lib/streak';

describe('Streak Feature Tests', () => {
  let userToken: string;
  let userId: number;
  let merchantId: number;
  let dealId: number;

  beforeAll(async () => {
    await resetDatabase();

    // Create test user
    const user = await prisma.user.create({
      data: {
        email: 'streakuser@test.com',
        name: 'Streak User',
        password: 'hashedpassword123',
      },
    });
    userId = user.id;

    // Generate token
    const jwtSecret = process.env.JWT_SECRET || 'test-secret';
    userToken = jwt.sign({ userId: user.id, email: user.email }, jwtSecret);

    // Create merchant user
    const merchantUser = await prisma.user.create({
      data: {
        email: 'merchant@test.com',
        name: 'Merchant',
        password: 'hashedpassword123',
      },
    });

    // Create merchant
    const merchant = await prisma.merchant.create({
      data: {
        businessName: 'Test Merchant',
        address: '123 Test St',
        ownerId: merchantUser.id,
        status: 'APPROVED',
        latitude: 40.7128,
        longitude: -74.0060,
      },
    });
    merchantId = merchant.id;

    // Create deal category and type
    const category = await prisma.dealCategoryMaster.create({
      data: {
        name: 'Food & Beverage',
        description: 'Food and drinks',
      },
    });

    const dealType = await prisma.dealTypeMaster.create({
      data: {
        name: 'Standard',
        description: 'Standard deals',
      },
    });

    // Create deal
    const deal = await prisma.deal.create({
      data: {
        title: 'Test Deal',
        description: 'Test deal for streaks',
        merchantId: merchant.id,
        categoryId: category.id,
        dealTypeId: dealType.id,
        startTime: new Date(Date.now() - 86400000), // Yesterday
        endTime: new Date(Date.now() + 86400000), // Tomorrow
        redemptionInstructions: 'Show this at checkout',
      },
    });
    dealId = deal.id;
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  describe('Discount Calculation', () => {
    it('should calculate 10% for week 1', () => {
      const discount = calculateDiscountPercentage(1);
      expect(discount).toBe(10);
    });

    it('should calculate 15% for week 2', () => {
      const discount = calculateDiscountPercentage(2);
      expect(discount).toBe(15);
    });

    it('should calculate 20% for week 3', () => {
      const discount = calculateDiscountPercentage(3);
      expect(discount).toBe(20);
    });

    it('should calculate maximum 45% for week 7+', () => {
      expect(calculateDiscountPercentage(7)).toBe(45);
      expect(calculateDiscountPercentage(8)).toBe(45);
      expect(calculateDiscountPercentage(10)).toBe(45);
    });

    it('should return 0% for 0 weeks', () => {
      const discount = calculateDiscountPercentage(0);
      expect(discount).toBe(0);
    });
  });

  describe('Apply Discount', () => {
    it('should correctly apply 20% discount to order', () => {
      const result = applyStreakDiscount(100, 20);
      expect(result.originalAmount).toBe(100);
      expect(result.discountPercent).toBe(20);
      expect(result.discountAmount).toBe(20);
      expect(result.finalAmount).toBe(80);
    });

    it('should handle decimal amounts correctly', () => {
      const result = applyStreakDiscount(49.99, 15);
      expect(result.originalAmount).toBe(49.99);
      expect(result.discountPercent).toBe(15);
      expect(result.discountAmount).toBe(7.5);
      expect(result.finalAmount).toBe(42.49);
    });

    it('should handle 0% discount', () => {
      const result = applyStreakDiscount(50, 0);
      expect(result.discountAmount).toBe(0);
      expect(result.finalAmount).toBe(50);
    });
  });

  describe('GET /api/streak/discount-tiers', () => {
    it('should return all discount tiers', async () => {
      const res = await request(app).get('/api/streak/discount-tiers');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tiers).toHaveLength(7);
      expect(res.body.maxWeeks).toBe(7);
      expect(res.body.maxDiscount).toBe(45);

      // Check first and last tiers
      expect(res.body.tiers[0]).toMatchObject({
        week: 1,
        discountPercent: 10,
      });
      expect(res.body.tiers[6]).toMatchObject({
        week: 7,
        discountPercent: 45,
      });
    });
  });

  describe('GET /api/streak', () => {
    it('should return streak info for authenticated user', async () => {
      const res = await request(app)
        .get('/api/streak')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.streak).toHaveProperty('currentStreak');
      expect(res.body.streak).toHaveProperty('longestStreak');
      expect(res.body.streak).toHaveProperty('currentDiscountPercent');
      expect(res.body.streak).toHaveProperty('maxDiscountReached');
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/api/streak');

      expect(res.status).toBe(401);
    });
  });

  describe('Check-In with Streak Update', () => {
    it('should start streak at 1 on first check-in', async () => {
      const res = await request(app)
        .post('/api/users/check-in')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          dealId,
          latitude: 40.7128,
          longitude: -74.0060,
        });

      expect(res.status).toBe(200);
      expect(res.body.withinRange).toBe(true);
      expect(res.body.streak).toBeDefined();
      expect(res.body.streak.currentStreak).toBe(1);
      expect(res.body.streak.currentDiscountPercent).toBe(10);
      expect(res.body.streak.newWeek).toBe(true);
    });

    it('should not increase streak for same week check-in', async () => {
      // First check-in of the week
      await request(app)
        .post('/api/users/check-in')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          dealId,
          latitude: 40.7128,
          longitude: -74.0060,
        });

      // Second check-in same week (should not increase)
      const res = await request(app)
        .post('/api/users/check-in')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          dealId,
          latitude: 40.7128,
          longitude: -74.0060,
        });

      expect(res.body.streak.newWeek).toBe(false);
      expect(res.body.streak.currentStreak).toBe(1);
    });
  });

  describe('POST /api/streak/calculate-discount', () => {
    it('should calculate discount for current streak', async () => {
      // Ensure user has a streak
      await updateStreakAfterCheckIn(userId);

      const res = await request(app)
        .post('/api/streak/calculate-discount')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          orderAmount: 100,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.discount).toHaveProperty('originalAmount');
      expect(res.body.discount).toHaveProperty('discountPercent');
      expect(res.body.discount).toHaveProperty('discountAmount');
      expect(res.body.discount).toHaveProperty('finalAmount');
      expect(res.body.streak).toBeDefined();
    });

    it('should validate order amount is positive', async () => {
      const res = await request(app)
        .post('/api/streak/calculate-discount')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          orderAmount: -10,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/streak/calculate-discount')
        .send({
          orderAmount: 100,
        });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/streak/leaderboard', () => {
    it('should return streak leaderboard', async () => {
      const res = await request(app)
        .get('/api/streak/leaderboard')
        .query({ limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.leaderboard)).toBe(true);
      expect(res.body).toHaveProperty('total');
    });

    it('should respect limit parameter', async () => {
      const res = await request(app)
        .get('/api/streak/leaderboard')
        .query({ limit: 5 });

      expect(res.status).toBe(200);
      expect(res.body.leaderboard.length).toBeLessThanOrEqual(5);
    });

    it('should reject invalid limit', async () => {
      const res = await request(app)
        .get('/api/streak/leaderboard')
        .query({ limit: 150 });

      expect(res.status).toBe(400);
    });
  });

  describe('Streak Logic', () => {
    it('should update longest streak correctly', async () => {
      const testUserId = userId;

      // Simulate 5 consecutive weeks
      const dates = [];
      const startDate = new Date('2025-01-01'); // A Monday
      for (let i = 0; i < 5; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i * 7); // Add 7 days each iteration
        dates.push(date);
      }

      for (const date of dates) {
        await updateStreakAfterCheckIn(testUserId, date);
      }

      const streakInfo = await getStreakInfo(testUserId);
      expect(streakInfo.currentStreak).toBe(5);
      expect(streakInfo.longestStreak).toBe(5);
      expect(streakInfo.currentDiscountPercent).toBe(30);
    });

    it('should reset streak when week is missed', async () => {
      const testUser = await prisma.user.create({
        data: {
          email: 'streaktest2@test.com',
          name: 'Streak Test 2',
          password: 'hashedpassword123',
        },
      });

      // Week 1 check-in
      await updateStreakAfterCheckIn(testUser.id, new Date('2025-01-01'));

      // Week 2 check-in (consecutive)
      await updateStreakAfterCheckIn(testUser.id, new Date('2025-01-08'));

      // Miss week 3, check in week 4 (streak should reset)
      const result = await updateStreakAfterCheckIn(
        testUser.id,
        new Date('2025-01-22')
      );

      expect(result.streakBroken).toBe(true);
      expect(result.streak.currentStreak).toBe(1);
      expect(result.discountPercent).toBe(10);
    });

    it('should cap discount at 45%', async () => {
      const testUser = await prisma.user.create({
        data: {
          email: 'streaktest3@test.com',
          name: 'Streak Test 3',
          password: 'hashedpassword123',
        },
      });

      // Simulate 10 consecutive weeks
      const startDate = new Date('2025-01-01');
      for (let i = 0; i < 10; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i * 7);
        await updateStreakAfterCheckIn(testUser.id, date);
      }

      const streakInfo = await getStreakInfo(testUser.id);
      expect(streakInfo.currentStreak).toBe(10);
      expect(streakInfo.currentDiscountPercent).toBe(45); // Capped at 45%
      expect(streakInfo.maxDiscountReached).toBe(true);
    });

    it('should track total check-ins correctly', async () => {
      const testUser = await prisma.user.create({
        data: {
          email: 'streaktest4@test.com',
          name: 'Streak Test 4',
          password: 'hashedpassword123',
        },
      });

      // Multiple check-ins in the same week
      const date = new Date('2025-01-01');
      await updateStreakAfterCheckIn(testUser.id, date);
      await updateStreakAfterCheckIn(testUser.id, date);
      await updateStreakAfterCheckIn(testUser.id, date);

      const streakInfo = await getStreakInfo(testUser.id);
      expect(streakInfo.currentStreak).toBe(1); // Still 1 week
      expect(streakInfo.totalCheckIns).toBe(3); // But 3 total check-ins
      expect(streakInfo.currentWeekCheckIns).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle year boundary correctly', async () => {
      const testUser = await prisma.user.create({
        data: {
          email: 'yeartest@test.com',
          name: 'Year Test',
          password: 'hashedpassword123',
        },
      });

      // Last week of 2024
      await updateStreakAfterCheckIn(testUser.id, new Date('2024-12-30'));

      // First week of 2025 (should be consecutive)
      const result = await updateStreakAfterCheckIn(
        testUser.id,
        new Date('2025-01-06')
      );

      expect(result.streak.currentStreak).toBe(2);
      expect(result.streakBroken).toBe(false);
    });
  });
});
