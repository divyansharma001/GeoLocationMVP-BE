import request from 'supertest';
import app from '../src/app';
import prisma from '../src/lib/prisma';

async function register(email: string, password = 'Password123!') {
  return request(app).post('/api/auth/register').send({ email, password });
}

async function login(email: string, password = 'Password123!') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function setupApprovedMerchant(email: string) {
  const reg = await register(email);
  expect(reg.status).toBe(201);
  
  // @ts-ignore
  const city = await prisma.city.create({ 
    data: { 
      name: `City-${email}`.slice(0, 20), 
      state: 'ST', 
      active: true 
    } 
  });
  
  const token = await login(email);
  const mRes = await request(app)
    .post('/api/merchants/register')
    .set('Authorization', `Bearer ${token}`)
    .send({ 
      businessName: `Biz-${email}`.slice(0, 20), 
      address: '1 Test Way', 
      cityId: city.id 
    });
  expect(mRes.status).toBe(201);
  const merchantId = mRes.body.merchant.id;
  
  // @ts-ignore
  await prisma.merchant.update({ 
    where: { id: merchantId }, 
    data: { status: 'APPROVED' } 
  });
  
  return { token, merchantId, cityId: city.id };
}

describe('Custom Performance Comparison Endpoint', () => {
  let merchant: any;
  let testUser: any;
  let testDeal: any;

  beforeAll(async () => {
    // Setup approved merchant
    merchant = await setupApprovedMerchant('performance-test@example.com');
    
    // Create a test user
    // @ts-ignore
    testUser = await prisma.user.create({
      data: {
        email: 'testuser@example.com',
        password: 'hashedpassword',
        name: 'Test User'
      }
    });

    // Create a test deal
    // @ts-ignore
    const category = await prisma.dealCategoryMaster.findFirst();
    // @ts-ignore
    const dealType = await prisma.dealTypeMaster.findFirst();
    
    testDeal = await prisma.deal.create({
      data: {
        title: 'Test Deal',
        description: 'Test Deal Description',
        imageUrls: ['https://example.com/test.jpg'],
        categoryId: category?.id || 1,
        dealTypeId: dealType?.id || 1,
        startTime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
        endTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        redemptionInstructions: 'Show this deal to redeem',
        merchantId: merchant.merchantId,
        kickbackEnabled: true
      }
    });

    // Create some test data for different time periods
    const now = new Date();
    
    // Current period data (last 30 days)
    for (let i = 0; i < 10; i++) {
      // @ts-ignore
      await prisma.checkIn.create({
        data: {
          userId: testUser.id,
          merchantId: merchant.merchantId,
          dealId: testDeal.id,
          createdAt: new Date(now.getTime() - (i * 2 * 24 * 60 * 60 * 1000)) // Every 2 days
        }
      });
      
      // @ts-ignore
      await prisma.userDeal.create({
        data: {
          userId: testUser.id,
          dealId: testDeal.id,
          savedAt: new Date(now.getTime() - (i * 2 * 24 * 60 * 60 * 1000))
        }
      });
    }

    // Comparison period data (previous 30 days)
    for (let i = 0; i < 5; i++) {
      // @ts-ignore
      await prisma.checkIn.create({
        data: {
          userId: testUser.id,
          merchantId: merchant.merchantId,
          dealId: testDeal.id,
          createdAt: new Date(now.getTime() - ((30 + i * 2) * 24 * 60 * 60 * 1000))
        }
      });
      
      // @ts-ignore
      await prisma.userDeal.create({
        data: {
          userId: testUser.id,
          dealId: testDeal.id,
          savedAt: new Date(now.getTime() - ((30 + i * 2) * 24 * 60 * 60 * 1000))
        }
      });
    }

    // Create kickback events
    // @ts-ignore
    await prisma.kickbackEvent.createMany({
      data: [
        {
          merchantId: merchant.merchantId,
          dealId: testDeal.id,
          userId: testUser.id,
          amountEarned: 10.0,
          sourceAmountSpent: 100.0,
          inviteeCount: 1,
          createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
        },
        {
          merchantId: merchant.merchantId,
          dealId: testDeal.id,
          userId: testUser.id,
          amountEarned: 15.0,
          sourceAmountSpent: 150.0,
          inviteeCount: 1,
          createdAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000)
        }
      ]
    });
  });

  afterAll(async () => {
    // Cleanup
    // @ts-ignore
    await prisma.kickbackEvent.deleteMany({
      where: { merchantId: merchant.merchantId }
    });
    
    // @ts-ignore
    await prisma.userDeal.deleteMany({
      where: { dealId: testDeal.id }
    });
    
    // @ts-ignore
    await prisma.checkIn.deleteMany({
      where: { merchantId: merchant.merchantId }
    });
    
    // @ts-ignore
    await prisma.deal.delete({
      where: { id: testDeal.id }
    });
    
    // @ts-ignore
    await prisma.user.delete({
      where: { id: testUser.id }
    });
    
    // @ts-ignore
    await prisma.merchant.delete({
      where: { id: merchant.merchantId }
    });
    
    // @ts-ignore
    await prisma.city.deleteMany({
      where: { name: { contains: 'City-performance-test' } }
    });
  });

  describe('GET /api/merchants/dashboard/performance-comparison-custom', () => {
    it('returns performance comparison with default parameters', async () => {
      const res = await request(app)
        .get('/api/merchants/dashboard/performance-comparison-custom')
        .set('Authorization', `Bearer ${merchant.token}`);

      expect(res.status).toBe(200);
      expect(res.body.currentMetrics).toBeDefined();
      expect(res.body.compareMetrics).toBeDefined();
      expect(res.body.changes).toBeDefined();
      expect(res.body.trends).toBeDefined();
      expect(res.body.dateRanges).toBeDefined();
      expect(res.body.filters).toBeDefined();
      expect(res.body.summary).toBeDefined();
    });

    it('handles predefined period comparisons', async () => {
      const testCases = [
        { currentPeriod: 'last_7_days', comparePeriod: 'previous_7_days' },
        { currentPeriod: 'last_30_days', comparePeriod: 'previous_30_days' },
        { currentPeriod: 'this_month', comparePeriod: 'previous_month' },
        { currentPeriod: 'last_month', comparePeriod: 'same_month_last_year' },
        { currentPeriod: 'this_quarter', comparePeriod: 'previous_quarter' },
        { currentPeriod: 'this_year', comparePeriod: 'previous_year' }
      ];

      for (const testCase of testCases) {
        const res = await request(app)
          .get(`/api/merchants/dashboard/performance-comparison-custom?currentPeriod=${testCase.currentPeriod}&comparePeriod=${testCase.comparePeriod}`)
          .set('Authorization', `Bearer ${merchant.token}`);

        expect(res.status).toBe(200);
        expect(res.body.currentPeriod).toBe(testCase.currentPeriod);
        expect(res.body.comparePeriod).toBe(testCase.comparePeriod);
        expect(res.body.customDates).toBe(false);
      }
    });

    it('handles custom date ranges', async () => {
      const now = new Date();
      const currentFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const currentTo = now;
      const compareFrom = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const compareTo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const res = await request(app)
        .get(`/api/merchants/dashboard/performance-comparison-custom?currentFrom=${currentFrom.toISOString()}&currentTo=${currentTo.toISOString()}&compareFrom=${compareFrom.toISOString()}&compareTo=${compareTo.toISOString()}`)
        .set('Authorization', `Bearer ${merchant.token}`);

      expect(res.status).toBe(200);
      expect(res.body.customDates).toBe(true);
      expect(res.body.dateRanges.current.from).toBeDefined();
      expect(res.body.dateRanges.current.to).toBeDefined();
      expect(res.body.dateRanges.compare.from).toBeDefined();
      expect(res.body.dateRanges.compare.to).toBeDefined();
    });

    it('filters metrics correctly', async () => {
      const testCases = [
        { metrics: 'checkins' },
        { metrics: 'deals' },
        { metrics: 'sales' },
        { metrics: 'users' },
        { metrics: 'all' }
      ];

      for (const testCase of testCases) {
        const res = await request(app)
          .get(`/api/merchants/dashboard/performance-comparison-custom?metrics=${testCase.metrics}`)
          .set('Authorization', `Bearer ${merchant.token}`);

        expect(res.status).toBe(200);
        expect(res.body.filters.metrics).toBe(testCase.metrics);
        
        if (testCase.metrics !== 'all') {
          // For specific metrics, verify that other metrics are 0 or not included
          if (testCase.metrics === 'checkins') {
            expect(res.body.currentMetrics.checkIns).toBeGreaterThan(0);
          } else if (testCase.metrics === 'deals') {
            expect(res.body.currentMetrics.dealSaves).toBeGreaterThan(0);
          } else if (testCase.metrics === 'sales') {
            expect(res.body.currentMetrics.grossSales).toBeGreaterThan(0);
          }
        }
      }
    });

    it('handles different granularity options', async () => {
      const testCases = ['day', 'week', 'month'];

      for (const granularity of testCases) {
        const res = await request(app)
          .get(`/api/merchants/dashboard/performance-comparison-custom?granularity=${granularity}`)
          .set('Authorization', `Bearer ${merchant.token}`);

        expect(res.status).toBe(200);
        expect(res.body.filters.granularity).toBe(granularity);
        expect(res.body.timeSeriesData).toBeDefined();
        expect(Array.isArray(res.body.timeSeriesData)).toBe(true);
      }
    });

    it('calculates percentage changes correctly', async () => {
      const res = await request(app)
        .get('/api/merchants/dashboard/performance-comparison-custom')
        .set('Authorization', `Bearer ${merchant.token}`);

      expect(res.status).toBe(200);
      
      // Verify that changes are calculated
      expect(typeof res.body.changes.checkIns).toBe('number');
      expect(typeof res.body.changes.dealSaves).toBe('number');
      expect(typeof res.body.changes.grossSales).toBe('number');
      expect(typeof res.body.changes.uniqueUsers).toBe('number');
      
      // Verify trends are set correctly
      expect(['up', 'down', 'stable']).toContain(res.body.trends.checkIns);
      expect(['up', 'down', 'stable']).toContain(res.body.trends.dealSaves);
      expect(['up', 'down', 'stable']).toContain(res.body.trends.grossSales);
    });

    it('validates custom date parameters', async () => {
      const now = new Date();
      const invalidTests = [
        {
          params: 'currentFrom=invalid&currentTo=2024-01-01T00:00:00Z&compareFrom=2023-01-01T00:00:00Z&compareTo=2023-01-31T00:00:00Z',
          expectedError: 'Invalid date format'
        },
        {
          params: 'currentFrom=2024-01-01T00:00:00Z&currentTo=2023-01-01T00:00:00Z&compareFrom=2023-01-01T00:00:00Z&compareTo=2023-01-31T00:00:00Z',
          expectedError: 'Start date must be before end date'
        },
        {
          params: 'currentFrom=2025-01-01T00:00:00Z&currentTo=2025-01-31T00:00:00Z&compareFrom=2023-01-01T00:00:00Z&compareTo=2023-01-31T00:00:00Z',
          expectedError: 'Current period end date cannot be in the future'
        }
      ];

      for (const test of invalidTests) {
        const res = await request(app)
          .get(`/api/merchants/dashboard/performance-comparison-custom?${test.params}`)
          .set('Authorization', `Bearer ${merchant.token}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain(test.expectedError);
      }
    });

    it('validates parameter values', async () => {
      const invalidTests = [
        {
          params: 'granularity=invalid',
          expectedError: 'Invalid granularity'
        },
        {
          params: 'metrics=invalid',
          expectedError: 'Invalid metrics'
        },
        {
          params: 'groupBy=invalid',
          expectedError: 'Invalid groupBy'
        }
      ];

      for (const test of invalidTests) {
        const res = await request(app)
          .get(`/api/merchants/dashboard/performance-comparison-custom?${test.params}`)
          .set('Authorization', `Bearer ${merchant.token}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain(test.expectedError);
      }
    });

    it('returns time series data with correct structure', async () => {
      const res = await request(app)
        .get('/api/merchants/dashboard/performance-comparison-custom?granularity=day')
        .set('Authorization', `Bearer ${merchant.token}`);

      expect(res.status).toBe(200);
      expect(res.body.timeSeriesData).toBeDefined();
      expect(Array.isArray(res.body.timeSeriesData)).toBe(true);
      
      if (res.body.timeSeriesData.length > 0) {
        const dataPoint = res.body.timeSeriesData[0];
        expect(dataPoint.period).toMatch(/^(current|compare)$/);
        expect(dataPoint.date).toBeDefined();
        expect(typeof dataPoint.checkIns).toBe('number');
        expect(typeof dataPoint.dealSaves).toBe('number');
        expect(typeof dataPoint.grossSales).toBe('number');
      }
    });

    it('provides summary information', async () => {
      const res = await request(app)
        .get('/api/merchants/dashboard/performance-comparison-custom')
        .set('Authorization', `Bearer ${merchant.token}`);

      expect(res.status).toBe(200);
      expect(res.body.summary).toBeDefined();
      expect(typeof res.body.summary.totalDaysCurrent).toBe('number');
      expect(typeof res.body.summary.totalDaysCompare).toBe('number');
      expect(typeof res.body.summary.periodDifference).toBe('number');
      expect(res.body.summary.totalDaysCurrent).toBeGreaterThan(0);
      expect(res.body.summary.totalDaysCompare).toBeGreaterThan(0);
    });

    it('handles edge case with no data', async () => {
      // Create a new merchant with no data
      const newMerchant = await setupApprovedMerchant('no-data-merchant@example.com');
      
      const res = await request(app)
        .get('/api/merchants/dashboard/performance-comparison-custom')
        .set('Authorization', `Bearer ${newMerchant.token}`);

      expect(res.status).toBe(200);
      expect(res.body.currentMetrics.checkIns).toBe(0);
      expect(res.body.currentMetrics.dealSaves).toBe(0);
      expect(res.body.currentMetrics.grossSales).toBe(0);
      expect(res.body.compareMetrics.checkIns).toBe(0);
      expect(res.body.compareMetrics.dealSaves).toBe(0);
      expect(res.body.compareMetrics.grossSales).toBe(0);
      
      // Cleanup
      // @ts-ignore
      await prisma.merchant.delete({
        where: { id: newMerchant.merchantId }
      });
    });

    it('requires authentication', async () => {
      const res = await request(app)
        .get('/api/merchants/dashboard/performance-comparison-custom');

      expect(res.status).toBe(401);
    });

    it('requires approved merchant status', async () => {
      // Create a pending merchant
      const reg = await register('pending-merchant@example.com');
      expect(reg.status).toBe(201);
      
      const token = await login('pending-merchant@example.com');
      
      const res = await request(app)
        .get('/api/merchants/dashboard/performance-comparison-custom')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });
});
