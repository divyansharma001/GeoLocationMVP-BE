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

async function setupTestData() {
  // Create test users
  const users = [];
  for (let i = 1; i <= 5; i++) {
    const reg = await register(`testuser${i}@example.com`);
    expect(reg.status).toBe(201);
    users.push({ email: `testuser${i}@example.com`, userId: reg.body.user.id });
  }

  // Create test city
  // @ts-ignore
  const city = await prisma.city.create({
    data: {
      name: 'Test City',
      state: 'TC',
      active: true
    }
  });

  // Create test merchants
  const merchants = [];
  for (let i = 1; i <= 3; i++) {
    const token = await login(`testuser${i}@example.com`);
    const merchantRes = await request(app)
      .post('/api/merchants/register')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: `Test Merchant ${i}`,
        address: `${i} Test St`,
        cityId: city.id
      });
    expect(merchantRes.status).toBe(201);
    
    // @ts-ignore
    await prisma.merchant.update({
      where: { id: merchantRes.body.merchant.id },
      data: { status: 'APPROVED' }
    });
    
    merchants.push(merchantRes.body.merchant.id);
  }

  // Create test deals
  // @ts-ignore
  const category = await prisma.dealCategoryMaster.findFirst();
  // @ts-ignore
  const dealType = await prisma.dealTypeMaster.findFirst();
  
  const deals = [];
  for (let i = 0; i < 3; i++) {
    // @ts-ignore
    const deal = await prisma.deal.create({
      data: {
        title: `Test Deal ${i + 1}`,
        description: `Test Deal Description ${i + 1}`,
        imageUrls: [`https://example.com/test${i + 1}.jpg`],
        categoryId: category?.id || 1,
        dealTypeId: dealType?.id || 1,
        startTime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        endTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        redemptionInstructions: 'Show this deal to redeem',
        merchantId: merchants[i],
        kickbackEnabled: true
      }
    });
    deals.push(deal.id);
  }

  // Create point events and check-ins
  const now = new Date();
  for (let userIndex = 0; userIndex < users.length; userIndex++) {
    const userId = users[userIndex].userId;
    
    // Create point events
    // @ts-ignore
    const pointEventType = await prisma.pointEventTypeMaster.findFirst();
    
    for (let i = 0; i < (userIndex + 1) * 3; i++) {
      // @ts-ignore
      await prisma.userPointEvent.create({
        data: {
          userId: userId,
          dealId: deals[i % deals.length],
          pointEventTypeId: pointEventType?.id || 1,
          points: 10,
          createdAt: new Date(now.getTime() - (i * 24 * 60 * 60 * 1000))
        }
      });
    }

    // Create check-ins
    for (let i = 0; i < (userIndex + 1) * 2; i++) {
      // @ts-ignore
      await prisma.checkIn.create({
        data: {
          userId: userId,
          dealId: deals[i % deals.length],
          merchantId: merchants[i % merchants.length],
          latitude: 40.7128 + (i * 0.01),
          longitude: -74.0060 + (i * 0.01),
          distanceMeters: 100 + (i * 10),
          createdAt: new Date(now.getTime() - (i * 24 * 60 * 60 * 1000))
        }
      });
    }

    // Update user points
    // @ts-ignore
    await prisma.user.update({
      where: { id: userId },
      data: {
        points: (userIndex + 1) * 30,
        monthlyPoints: (userIndex + 1) * 15
      }
    });
  }

  return {
    users,
    city,
    merchants,
    deals,
    tokens: await Promise.all(users.map(u => login(u.email)))
  };
}

describe('Enhanced Leaderboard API', () => {
  let testData: any;

  beforeAll(async () => {
    testData = await setupTestData();
  });

  afterAll(async () => {
    // Cleanup test data
    if (testData) {
      // @ts-ignore
      await prisma.userPointEvent.deleteMany({
        where: { userId: { in: testData.users.map((u: any) => u.userId) } }
      });
      
      // @ts-ignore
      await prisma.checkIn.deleteMany({
        where: { userId: { in: testData.users.map((u: any) => u.userId) } }
      });
      
      // @ts-ignore
      await prisma.deal.deleteMany({
        where: { id: { in: testData.deals } }
      });
      
      // @ts-ignore
      await prisma.merchant.deleteMany({
        where: { id: { in: testData.merchants } }
      });
      
      // @ts-ignore
      await prisma.city.delete({
        where: { id: testData.city.id }
      });
      
      // @ts-ignore
      await prisma.user.deleteMany({
        where: { id: { in: testData.users.map((u: any) => u.userId) } }
      });
    }
  });

  describe('GET /api/leaderboard/global', () => {
    it('returns enhanced global leaderboard with detailed analytics', async () => {
      const res = await request(app)
        .get('/api/leaderboard/global?period=last_30_days&limit=10&includeStats=true')
        .set('Authorization', `Bearer ${testData.tokens[0]}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.leaderboard).toBeDefined();
      expect(res.body.globalStats).toBeDefined();
      expect(res.body.personalPosition).toBeDefined();
      expect(res.body.metadata).toBeDefined();

      // Check leaderboard structure
      expect(Array.isArray(res.body.leaderboard)).toBe(true);
      if (res.body.leaderboard.length > 0) {
        const user = res.body.leaderboard[0];
        expect(user).toHaveProperty('rank');
        expect(user).toHaveProperty('userId');
        expect(user).toHaveProperty('name');
        expect(user).toHaveProperty('totalPoints');
        expect(user).toHaveProperty('periodPoints');
        expect(user).toHaveProperty('monthlyPoints');
        expect(user).toHaveProperty('eventCount');
        expect(user).toHaveProperty('checkInCount');
        expect(user).toHaveProperty('uniqueDealsCheckedIn');
      }

      // Check global stats structure
      if (res.body.globalStats) {
        expect(res.body.globalStats).toHaveProperty('totalUsers');
        expect(res.body.globalStats).toHaveProperty('activeUsers');
        expect(res.body.globalStats).toHaveProperty('avgPointsPerUser');
        expect(res.body.globalStats).toHaveProperty('maxPoints');
        expect(res.body.globalStats).toHaveProperty('distribution');
      }
    });

    it('handles different time periods', async () => {
      const periods = ['today', 'this_week', 'this_month', 'last_7_days', 'last_90_days'];
      
      for (const period of periods) {
        const res = await request(app)
          .get(`/api/leaderboard/global?period=${period}&limit=5`)
          .set('Authorization', `Bearer ${testData.tokens[0]}`);

        expect(res.status).toBe(200);
        expect(res.body.period).toBe(period);
        expect(res.body.dateRange).toBeDefined();
      }
    });

    it('respects limit parameter', async () => {
      const res = await request(app)
        .get('/api/leaderboard/global?limit=3')
        .set('Authorization', `Bearer ${testData.tokens[0]}`);

      expect(res.status).toBe(200);
      expect(res.body.leaderboard.length).toBeLessThanOrEqual(3);
      expect(res.body.metadata.limit).toBe(3);
    });

    it('works without authentication', async () => {
      const res = await request(app)
        .get('/api/leaderboard/global?limit=5');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.personalPosition).toBeNull();
    });
  });

  describe('GET /api/leaderboard/cities', () => {
    it('returns city comparison leaderboard', async () => {
      const res = await request(app)
        .get('/api/leaderboard/cities?period=last_30_days&limit=10');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.cities).toBeDefined();
      expect(Array.isArray(res.body.cities)).toBe(true);

      if (res.body.cities.length > 0) {
        const city = res.body.cities[0];
        expect(city).toHaveProperty('rank');
        expect(city).toHaveProperty('cityId');
        expect(city).toHaveProperty('cityName');
        expect(city).toHaveProperty('state');
        expect(city).toHaveProperty('totalUsers');
        expect(city).toHaveProperty('activeUsers');
        expect(city).toHaveProperty('avgPointsPerUser');
        expect(city).toHaveProperty('totalPointsEarned');
        expect(city).toHaveProperty('totalCheckIns');
        expect(city).toHaveProperty('activeMerchants');
        expect(city).toHaveProperty('engagementRate');
      }
    });

    it('filters by active cities by default', async () => {
      const res = await request(app)
        .get('/api/leaderboard/cities?includeInactive=false');

      expect(res.status).toBe(200);
      res.body.cities.forEach((city: any) => {
        expect(city.active).toBe(true);
      });
    });

    it('can include inactive cities', async () => {
      const res = await request(app)
        .get('/api/leaderboard/cities?includeInactive=true');

      expect(res.status).toBe(200);
      // Should not filter by active status
    });
  });

  describe('GET /api/leaderboard/cities/:cityId', () => {
    it('returns detailed city-specific leaderboard', async () => {
      const res = await request(app)
        .get(`/api/leaderboard/cities/${testData.city.id}?period=last_30_days&limit=10&includeStats=true`)
        .set('Authorization', `Bearer ${testData.tokens[0]}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.city).toBeDefined();
      expect(res.body.leaderboard).toBeDefined();
      expect(res.body.personalPosition).toBeDefined();
      expect(res.body.cityStats).toBeDefined();

      // Check city information
      expect(res.body.city.cityId).toBe(testData.city.id);
      expect(res.body.city.cityName).toBe(testData.city.name);
      expect(res.body.city.activeMerchants).toBeGreaterThan(0);

      // Check leaderboard structure
      expect(Array.isArray(res.body.leaderboard)).toBe(true);
      if (res.body.leaderboard.length > 0) {
        const user = res.body.leaderboard[0];
        expect(user).toHaveProperty('uniqueMerchantsVisited');
      }
    });

    it('handles non-existent city', async () => {
      const res = await request(app)
        .get('/api/leaderboard/cities/99999');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('City not found');
    });

    it('handles city with no merchants', async () => {
      // Create a city with no merchants
      // @ts-ignore
      const emptyCity = await prisma.city.create({
        data: { name: 'Empty City', state: 'EC', active: true }
      });

      const res = await request(app)
        .get(`/api/leaderboard/cities/${emptyCity.id}`);

      expect(res.status).toBe(200);
      expect(res.body.leaderboard).toEqual([]);
      expect(res.body.city.activeMerchants).toBe(0);

      // Cleanup
      // @ts-ignore
      await prisma.city.delete({ where: { id: emptyCity.id } });
    });

    it('handles invalid city ID', async () => {
      const res = await request(app)
        .get('/api/leaderboard/cities/invalid');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid city ID');
    });
  });

  describe('GET /api/leaderboard/analytics', () => {
    it('returns comprehensive analytics with point distribution', async () => {
      const res = await request(app)
        .get('/api/leaderboard/analytics?period=last_30_days&includeDistribution=true&includeTrends=true');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.analytics).toBeDefined();
      expect(res.body.analytics.summary).toBeDefined();
      expect(res.body.analytics.distribution).toBeDefined();
      expect(res.body.analytics.trends).toBeDefined();

      // Check summary structure
      const summary = res.body.analytics.summary;
      expect(summary).toHaveProperty('totalUsers');
      expect(summary).toHaveProperty('activeUsers');
      expect(summary).toHaveProperty('inactiveUsers');
      expect(summary).toHaveProperty('avgPoints');
      expect(summary).toHaveProperty('medianPoints');
      expect(summary).toHaveProperty('maxPoints');
      expect(summary).toHaveProperty('stdDevPoints');
      expect(summary).toHaveProperty('p25');
      expect(summary).toHaveProperty('p50');
      expect(summary).toHaveProperty('p75');
      expect(summary).toHaveProperty('p90');
      expect(summary).toHaveProperty('p95');
      expect(summary).toHaveProperty('p99');

      // Check distribution structure
      if (res.body.analytics.distribution) {
        expect(Array.isArray(res.body.analytics.distribution)).toBe(true);
        if (res.body.analytics.distribution.length > 0) {
          const dist = res.body.analytics.distribution[0];
          expect(dist).toHaveProperty('pointRange');
          expect(dist).toHaveProperty('userCount');
        }
      }
    });

    it('filters analytics by city', async () => {
      const res = await request(app)
        .get(`/api/leaderboard/analytics?cityId=${testData.city.id}&period=last_30_days`);

      expect(res.status).toBe(200);
      expect(res.body.cityId).toBe(testData.city.id);
    });

    it('handles city with no merchants in analytics', async () => {
      // Create a city with no merchants
      // @ts-ignore
      const emptyCity = await prisma.city.create({
        data: { name: 'Empty Analytics City', state: 'EAC', active: true }
      });

      const res = await request(app)
        .get(`/api/leaderboard/analytics?cityId=${emptyCity.id}`);

      expect(res.status).toBe(200);
      expect(res.body.analytics).toBeNull();
      expect(res.body.message).toBe('No active merchants found in this city');

      // Cleanup
      // @ts-ignore
      await prisma.city.delete({ where: { id: emptyCity.id } });
    });
  });

  describe('GET /api/leaderboard/categories', () => {
    it('returns category-based leaderboards', async () => {
      const res = await request(app)
        .get('/api/leaderboard/categories?period=last_30_days&limit=5');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.categories).toBeDefined();
      expect(Array.isArray(res.body.categories)).toBe(true);

      if (res.body.categories.length > 0) {
        const category = res.body.categories[0];
        expect(category).toHaveProperty('categoryId');
        expect(category).toHaveProperty('categoryName');
        expect(category).toHaveProperty('categoryColor');
        expect(category).toHaveProperty('leaderboard');
        expect(Array.isArray(category.leaderboard)).toBe(true);

        if (category.leaderboard.length > 0) {
          const user = category.leaderboard[0];
          expect(user).toHaveProperty('rank');
          expect(user).toHaveProperty('userId');
          expect(user).toHaveProperty('name');
          expect(user).toHaveProperty('periodPoints');
        }
      }
    });

    it('filters by specific category', async () => {
      // @ts-ignore
      const category = await prisma.dealCategoryMaster.findFirst();
      if (category) {
        const res = await request(app)
          .get(`/api/leaderboard/categories?categoryId=${category.id}&period=last_30_days`);

        expect(res.status).toBe(200);
        expect(res.body.categoryId).toBe(category.id);
        expect(res.body.categories.length).toBeLessThanOrEqual(1);
      }
    });

    it('respects limit parameter', async () => {
      const res = await request(app)
        .get('/api/leaderboard/categories?limit=3');

      expect(res.status).toBe(200);
      res.body.categories.forEach((category: any) => {
        expect(category.leaderboard.length).toBeLessThanOrEqual(3);
      });
    });
  });

  describe('GET /api/leaderboard/insights', () => {
    it('returns advanced insights and user segments', async () => {
      const res = await request(app)
        .get('/api/leaderboard/insights?period=last_30_days&includePredictions=true');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.insights).toBeDefined();
      expect(res.body.insights.engagementSegments).toBeDefined();
      expect(res.body.insights.topPerformers).toBeDefined();

      // Check engagement segments
      expect(Array.isArray(res.body.insights.engagementSegments)).toBe(true);
      if (res.body.insights.engagementSegments.length > 0) {
        const segment = res.body.insights.engagementSegments[0];
        expect(segment).toHaveProperty('engagementSegment');
        expect(segment).toHaveProperty('userCount');
        expect(segment).toHaveProperty('avgPoints');
        expect(segment).toHaveProperty('avgCheckIns');
      }

      // Check top performers
      expect(Array.isArray(res.body.insights.topPerformers)).toBe(true);
      if (res.body.insights.topPerformers.length > 0) {
        const performer = res.body.insights.topPerformers[0];
        expect(performer).toHaveProperty('rank');
        expect(performer).toHaveProperty('periodPoints');
        expect(performer).toHaveProperty('uniqueMerchantsVisited');
        expect(performer).toHaveProperty('uniqueDealsCheckedIn');
      }
    });

    it('filters insights by city', async () => {
      const res = await request(app)
        .get(`/api/leaderboard/insights?cityId=${testData.city.id}&period=last_30_days`);

      expect(res.status).toBe(200);
      expect(res.body.cityId).toBe(testData.city.id);
    });

    it('handles city with no merchants in insights', async () => {
      // Create a city with no merchants
      // @ts-ignore
      const emptyCity = await prisma.city.create({
        data: { name: 'Empty Insights City', state: 'EIC', active: true }
      });

      const res = await request(app)
        .get(`/api/leaderboard/insights?cityId=${emptyCity.id}`);

      expect(res.status).toBe(200);
      expect(res.body.insights).toBeNull();
      expect(res.body.message).toBe('No active merchants found in this city');

      // Cleanup
      // @ts-ignore
      await prisma.city.delete({ where: { id: emptyCity.id } });
    });
  });

  describe('Error Handling', () => {
    it('handles invalid period parameters gracefully', async () => {
      const res = await request(app)
        .get('/api/leaderboard/global?period=invalid_period');

      expect(res.status).toBe(200); // Should default to last_30_days
      expect(res.body.period).toBe('invalid_period');
    });

    it('handles extremely high limit values', async () => {
      const res = await request(app)
        .get('/api/leaderboard/global?limit=1000');

      expect(res.status).toBe(200);
      expect(res.body.leaderboard.length).toBeLessThanOrEqual(100); // Should be capped
      expect(res.body.metadata.limit).toBeLessThanOrEqual(100);
    });

    it('handles negative limit values', async () => {
      const res = await request(app)
        .get('/api/leaderboard/global?limit=-5');

      expect(res.status).toBe(200);
      expect(res.body.metadata.limit).toBeGreaterThan(0); // Should default to positive
    });
  });

  describe('Performance', () => {
    it('returns results within reasonable time', async () => {
      const startTime = Date.now();
      const res = await request(app)
        .get('/api/leaderboard/global?limit=20&includeStats=true');
      const endTime = Date.now();

      expect(res.status).toBe(200);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
      expect(res.body.metadata.queryTime).toBeLessThan(5000);
    });

    it('handles concurrent requests', async () => {
      const promises = Array.from({ length: 5 }, () =>
        request(app).get('/api/leaderboard/global?limit=5')
      );

      const results = await Promise.all(promises);
      
      results.forEach(res => {
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });
    });
  });
});
