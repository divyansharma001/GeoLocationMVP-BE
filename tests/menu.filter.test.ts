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
    data: { 
      status: 'APPROVED',
      latitude: 40.7128,
      longitude: -74.0060
    } 
  });
  
  return { token, merchantId, cityId: city.id };
}

describe('Menu Filtering Endpoints', () => {
  let merchant1: any, merchant2: any;
  let menuItems: any[] = [];

  beforeAll(async () => {
    // Setup two approved merchants with menu items
    merchant1 = await setupApprovedMerchant('menu-filter-1@example.com');
    merchant2 = await setupApprovedMerchant('menu-filter-2@example.com');

    // Create diverse menu items for testing
    const menuData = [
      // Merchant 1 items
      { merchantId: merchant1.merchantId, name: 'Margherita Pizza', category: 'Mains', price: 18.0, description: 'Classic tomato and mozzarella' },
      { merchantId: merchant1.merchantId, name: 'Caesar Salad', category: 'Appetizers', price: 12.0, description: 'Fresh romaine lettuce' },
      { merchantId: merchant1.merchantId, name: 'Chocolate Cake', category: 'Desserts', price: 8.0, description: 'Rich chocolate dessert' },
      { merchantId: merchant1.merchantId, name: 'Pepperoni Pizza', category: 'Mains', price: 20.0, description: 'Spicy pepperoni pizza' },
      
      // Merchant 2 items
      { merchantId: merchant2.merchantId, name: 'Burger Deluxe', category: 'Mains', price: 15.0, description: 'Beef burger with fries' },
      { merchantId: merchant2.merchantId, name: 'Chicken Wings', category: 'Appetizers', price: 14.0, description: 'Spicy buffalo wings' },
      { merchantId: merchant2.merchantId, name: 'Ice Cream Sundae', category: 'Desserts', price: 6.0, description: 'Vanilla ice cream' },
      { merchantId: merchant2.merchantId, name: 'Fish Tacos', category: 'Mains', price: 16.0, description: 'Fresh fish tacos' },
    ];

    // @ts-ignore
    menuItems = await Promise.all(
      menuData.map(item => 
        prisma.menuItem.create({
          data: item,
          select: { id: true, name: true, category: true, price: true, merchantId: true }
        })
      )
    );
  });

  afterAll(async () => {
    // Cleanup
    // @ts-ignore
    await prisma.menuItem.deleteMany({
      where: { merchantId: { in: [merchant1.merchantId, merchant2.merchantId] } }
    });
    
    // @ts-ignore
    await prisma.merchant.deleteMany({
      where: { id: { in: [merchant1.merchantId, merchant2.merchantId] } }
    });
    
    // @ts-ignore
    await prisma.city.deleteMany({
      where: { name: { contains: 'City-menu-filter' } }
    });
  });

  describe('GET /api/menu/items', () => {
    it('returns all menu items from approved merchants', async () => {
      const res = await request(app).get('/api/menu/items');
      
      expect(res.status).toBe(200);
      expect(res.body.menuItems).toBeDefined();
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(8);
      expect(res.body.menuItems.length).toBeGreaterThanOrEqual(8);
    });

    it('filters by category', async () => {
      const res = await request(app).get('/api/menu/items?category=Mains');
      
      expect(res.status).toBe(200);
      expect(res.body.menuItems.length).toBeGreaterThanOrEqual(4);
      res.body.menuItems.forEach((item: any) => {
        expect(item.category.toLowerCase()).toContain('mains');
      });
    });

    it('filters by subcategory', async () => {
      const res = await request(app).get('/api/menu/items?subcategory=Pizza');
      
      expect(res.status).toBe(200);
      expect(res.body.menuItems.length).toBeGreaterThanOrEqual(2);
      res.body.menuItems.forEach((item: any) => {
        expect(item.name.toLowerCase()).toContain('pizza');
      });
    });

    it('filters by merchant ID', async () => {
      const res = await request(app).get(`/api/menu/items?merchantId=${merchant1.merchantId}`);
      
      expect(res.status).toBe(200);
      expect(res.body.menuItems.length).toBeGreaterThanOrEqual(4);
      res.body.menuItems.forEach((item: any) => {
        expect(item.merchant.id).toBe(merchant1.merchantId);
      });
    });

    it('filters by price range', async () => {
      const res = await request(app).get('/api/menu/items?minPrice=10&maxPrice=15');
      
      expect(res.status).toBe(200);
      res.body.menuItems.forEach((item: any) => {
        expect(item.price).toBeGreaterThanOrEqual(10);
        expect(item.price).toBeLessThanOrEqual(15);
      });
    });

    it('searches by name and description', async () => {
      const res = await request(app).get('/api/menu/items?search=pizza');
      
      expect(res.status).toBe(200);
      expect(res.body.menuItems.length).toBeGreaterThanOrEqual(2);
      res.body.menuItems.forEach((item: any) => {
        const searchTerm = item.name.toLowerCase() + ' ' + (item.description || '').toLowerCase();
        expect(searchTerm).toContain('pizza');
      });
    });

    it('handles pagination', async () => {
      const res = await request(app).get('/api/menu/items?limit=3&offset=0');
      
      expect(res.status).toBe(200);
      expect(res.body.menuItems.length).toBeLessThanOrEqual(3);
      expect(res.body.pagination.limit).toBe(3);
      expect(res.body.pagination.offset).toBe(0);
      expect(res.body.pagination.hasMore).toBeDefined();
    });

    it('validates invalid parameters', async () => {
      const invalidTests = [
        { params: '?merchantId=invalid', expectedError: 'Invalid merchantId parameter' },
        { params: '?minPrice=-5', expectedError: 'Invalid minPrice parameter' },
        { params: '?maxPrice=invalid', expectedError: 'Invalid maxPrice parameter' },
        { params: '?search=', expectedError: 'Search term cannot be empty' },
        { params: '?cityId=invalid', expectedError: 'Invalid cityId parameter' },
        { params: '?latitude=invalid&longitude=-74.0060&radius=10', expectedError: 'Invalid latitude, longitude, or radius parameters' },
        { params: '?latitude=91&longitude=-74.0060&radius=10', expectedError: 'Latitude must be between -90 and 90, longitude between -180 and 180' },
        { params: '?latitude=40.7128&longitude=-74.0060&radius=-5', expectedError: 'Radius must be between 0 and 1000 kilometers' },
        { params: '?limit=1000', expectedError: undefined }, // Should be capped to 100
      ];

      for (const test of invalidTests) {
        const res = await request(app).get(`/api/menu/items${test.params}`);
        
        if (test.expectedError) {
          expect(res.status).toBe(400);
          expect(res.body.error).toContain(test.expectedError);
        } else {
          // For limit test, should succeed but be capped
          expect(res.status).toBe(200);
          expect(res.body.pagination.limit).toBeLessThanOrEqual(100);
        }
      }
    });

    it('returns merchant information with menu items', async () => {
      const res = await request(app).get('/api/menu/items?limit=1');
      
      expect(res.status).toBe(200);
      expect(res.body.menuItems.length).toBeGreaterThanOrEqual(1);
      
      const menuItem = res.body.menuItems[0];
      expect(menuItem.merchant).toBeDefined();
      expect(menuItem.merchant.id).toBeDefined();
      expect(menuItem.merchant.businessName).toBeDefined();
      expect(menuItem.merchant.stores).toBeDefined();
      expect(Array.isArray(menuItem.merchant.stores)).toBe(true);
    });

    it('filters by city ID', async () => {
      const res = await request(app).get(`/api/menu/items?cityId=${merchant1.cityId}`);
      
      expect(res.status).toBe(200);
      // Should return items from merchants in that city
      expect(res.body.menuItems.length).toBeGreaterThanOrEqual(4);
    });

    it('filters by geolocation', async () => {
      // Test with coordinates near merchant1 (NYC area)
      const res = await request(app).get('/api/menu/items?latitude=40.7128&longitude=-74.0060&radius=1');
      
      expect(res.status).toBe(200);
      // Should return items from merchants within 1km of the coordinates
      expect(res.body.menuItems.length).toBeGreaterThanOrEqual(4);
      
      // All returned items should have merchant coordinates
      res.body.menuItems.forEach((item: any) => {
        expect(item.merchant.latitude).toBeDefined();
        expect(item.merchant.longitude).toBeDefined();
      });
    });

    it('combines multiple filters', async () => {
      const res = await request(app).get(`/api/menu/items?category=Mains&minPrice=15&maxPrice=20&merchantId=${merchant1.merchantId}`);
      
      expect(res.status).toBe(200);
      res.body.menuItems.forEach((item: any) => {
        expect(item.merchant.id).toBe(merchant1.merchantId);
        expect(item.category.toLowerCase()).toContain('mains');
        expect(item.price).toBeGreaterThanOrEqual(15);
        expect(item.price).toBeLessThanOrEqual(20);
      });
    });

    it('returns proper pagination metadata', async () => {
      const res = await request(app).get('/api/menu/items?limit=3&offset=0');
      
      expect(res.status).toBe(200);
      expect(res.body.pagination).toBeDefined();
      expect(typeof res.body.pagination.total).toBe('number');
      expect(res.body.pagination.limit).toBe(3);
      expect(res.body.pagination.offset).toBe(0);
      expect(typeof res.body.pagination.hasMore).toBe('boolean');
      expect(typeof res.body.pagination.currentPage).toBe('number');
      expect(typeof res.body.pagination.totalPages).toBe('number');
    });

    it('returns applied filters in response', async () => {
      const res = await request(app).get('/api/menu/items?category=Mains&minPrice=10&search=pizza');
      
      expect(res.status).toBe(200);
      expect(res.body.filters).toBeDefined();
      expect(res.body.filters.category).toBe('Mains');
      expect(res.body.filters.minPrice).toBe(10);
      expect(res.body.filters.search).toBe('pizza');
    });
  });

  describe('GET /api/menu/categories', () => {
    it('returns all unique menu categories', async () => {
      const res = await request(app).get('/api/menu/categories');
      
      expect(res.status).toBe(200);
      expect(res.body.categories).toBeDefined();
      expect(Array.isArray(res.body.categories)).toBe(true);
      expect(res.body.total).toBeDefined();
      
      // Should include our test categories
      const categoryNames = res.body.categories.map((cat: any) => cat.name);
      expect(categoryNames).toContain('Mains');
      expect(categoryNames).toContain('Appetizers');
      expect(categoryNames).toContain('Desserts');
    });

    it('returns categories with item counts', async () => {
      const res = await request(app).get('/api/menu/categories');
      
      expect(res.status).toBe(200);
      res.body.categories.forEach((category: any) => {
        expect(category.name).toBeDefined();
        expect(typeof category.count).toBe('number');
        expect(category.count).toBeGreaterThan(0);
      });
    });

    it('filters categories by merchant', async () => {
      const res = await request(app).get(`/api/menu/categories?merchantId=${merchant1.merchantId}`);
      
      expect(res.status).toBe(200);
      expect(res.body.categories.length).toBeGreaterThanOrEqual(3); // Mains, Appetizers, Desserts
      
      // Verify all categories belong to the specified merchant by checking counts
      const totalItems = res.body.categories.reduce((sum: number, cat: any) => sum + cat.count, 0);
      expect(totalItems).toBeGreaterThanOrEqual(4); // At least our test items
    });

    it('filters categories by city', async () => {
      const res = await request(app).get(`/api/menu/categories?cityId=${merchant1.cityId}`);
      
      expect(res.status).toBe(200);
      expect(res.body.categories.length).toBeGreaterThanOrEqual(3);
    });

    it('validates merchant ID parameter', async () => {
      const res = await request(app).get('/api/menu/categories?merchantId=invalid');
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid merchantId parameter');
    });

    it('validates city ID parameter', async () => {
      const res = await request(app).get('/api/menu/categories?cityId=invalid');
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid cityId parameter');
    });

    it('returns empty categories when no merchant matches', async () => {
      const res = await request(app).get('/api/menu/categories?merchantId=99999');
      
      expect(res.status).toBe(200);
      expect(res.body.categories).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });
});
