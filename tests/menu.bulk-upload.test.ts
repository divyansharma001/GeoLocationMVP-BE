import request from 'supertest';
import app from '../src/app';
import prisma from '../src/lib/prisma';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';

describe('Menu Bulk Upload - POST /api/merchants/me/menu/bulk-upload', () => {
  let merchantToken: string;
  let merchantId: number;
  let userId: number;

  beforeAll(async () => {
    // Create test user
    const hashedPassword = await bcrypt.hash('password123', 10);
    const user = await prisma.user.create({
      data: { email: 'bulkmerchant@test.com', password: hashedPassword, name: 'Bulk Test Merchant' }
    });
    userId = user.id;

    // Create approved merchant
    const merchant = await prisma.merchant.create({
      data: {
        businessName: 'Bulk Upload Restaurant',
        address: '123 Bulk St',
        ownerId: userId,
        status: 'APPROVED',
        latitude: 40.7128,
        longitude: -74.0060,
      }
    });
    merchantId = merchant.id;

    // Get merchant token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bulkmerchant@test.com', password: 'password123' });
    merchantToken = loginRes.body.token;
  });

  afterAll(async () => {
    // @ts-ignore
    await prisma.menuItem.deleteMany({ where: { merchantId } });
    await prisma.merchant.delete({ where: { id: merchantId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // Helper function to create Excel buffer
  const createExcelBuffer = (data: any[]): Buffer => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Menu');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  };

  describe('Valid bulk uploads', () => {
    it('should upload basic menu items successfully', async () => {
      const menuData = [
        { name: 'Pizza Margherita', price: 15.99, category: 'Pizza' },
        { name: 'Caesar Salad', price: 9.99, category: 'Salads' },
        { name: 'Craft Beer', price: 7.50, category: 'Drinks' }
      ];

      const buffer = createExcelBuffer(menuData);

      const res = await request(app)
        .post('/api/merchants/me/menu/bulk-upload')
        .set('Authorization', `Bearer ${merchantToken}`)
        .attach('file', buffer, 'menu.xlsx');

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(3);
      expect(res.body.totalRows).toBe(3);
      expect(res.body.message).toContain('Successfully uploaded');
    });

    it('should upload Happy Hour items with all fields', async () => {
      const menuData = [
        {
          name: 'Happy Hour Beer',
          price: 8.00,
          category: 'Drinks',
          description: 'Local IPA',
          isHappyHour: true,
          happyHourPrice: 5.00,
          dealType: 'HAPPY_HOUR_BOUNTY',
          validStartTime: '17:00',
          validEndTime: '19:00',
          validDays: 'MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY'
        }
      ];

      const buffer = createExcelBuffer(menuData);

      const res = await request(app)
        .post('/api/merchants/me/menu/bulk-upload')
        .set('Authorization', `Bearer ${merchantToken}`)
        .attach('file', buffer, 'happyhour.xlsx');

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(1);
    });

    it('should handle boolean values in different formats', async () => {
      const menuData = [
        { name: 'Item1', price: 10, category: 'Test', isHappyHour: 'true' },
        { name: 'Item2', price: 10, category: 'Test', isHappyHour: 'yes' },
        { name: 'Item3', price: 10, category: 'Test', isHappyHour: '1' },
        { name: 'Item4', price: 10, category: 'Test', isHappyHour: 'false' },
      ];

      const buffer = createExcelBuffer(menuData);

      const res = await request(app)
        .post('/api/merchants/me/menu/bulk-upload')
        .set('Authorization', `Bearer ${merchantToken}`)
        .attach('file', buffer, 'booleans.xlsx');

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(4);
    });
  });

  describe('Validation errors', () => {
    it('should reject upload with missing required fields', async () => {
      const menuData = [
        { name: 'Pizza', price: 15.99, category: 'Pizza' },
        { price: 9.99, category: 'Salads' }, // Missing name
        { name: 'Beer', category: 'Drinks' }, // Missing price
      ];

      const buffer = createExcelBuffer(menuData);

      const res = await request(app)
        .post('/api/merchants/me/menu/bulk-upload')
        .set('Authorization', `Bearer ${merchantToken}`)
        .attach('file', buffer, 'invalid.xlsx');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
      expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it('should reject invalid prices', async () => {
      const menuData = [
        { name: 'Item1', price: -5, category: 'Test' },
        { name: 'Item2', price: 0, category: 'Test' },
        { name: 'Item3', price: 'invalid', category: 'Test' },
      ];

      const buffer = createExcelBuffer(menuData);

      const res = await request(app)
        .post('/api/merchants/me/menu/bulk-upload')
        .set('Authorization', `Bearer ${merchantToken}`)
        .attach('file', buffer, 'invalid-prices.xlsx');

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors.some((e: any) => e.field === 'price')).toBe(true);
    });

    it('should reject invalid deal types', async () => {
      const menuData = [
        { name: 'Item', price: 10, category: 'Test', dealType: 'INVALID_TYPE' }
      ];

      const buffer = createExcelBuffer(menuData);

      const res = await request(app)
        .post('/api/merchants/me/menu/bulk-upload')
        .set('Authorization', `Bearer ${merchantToken}`)
        .attach('file', buffer, 'invalid-dealtype.xlsx');

      expect(res.status).toBe(400);
      expect(res.body.errors.some((e: any) => e.field === 'dealType')).toBe(true);
    });

    it('should reject invalid time formats', async () => {
      const menuData = [
        { name: 'Item', price: 10, category: 'Test', validStartTime: '5:00 PM' },
        { name: 'Item2', price: 10, category: 'Test', validEndTime: '25:00' },
      ];

      const buffer = createExcelBuffer(menuData);

      const res = await request(app)
        .post('/api/merchants/me/menu/bulk-upload')
        .set('Authorization', `Bearer ${merchantToken}`)
        .attach('file', buffer, 'invalid-time.xlsx');

      expect(res.status).toBe(400);
      expect(res.body.errors.some((e: any) => e.field.includes('Time'))).toBe(true);
    });

    it('should reject invalid days', async () => {
      const menuData = [
        { name: 'Item', price: 10, category: 'Test', validDays: 'MONDAY,INVALID_DAY,FRIDAY' }
      ];

      const buffer = createExcelBuffer(menuData);

      const res = await request(app)
        .post('/api/merchants/me/menu/bulk-upload')
        .set('Authorization', `Bearer ${merchantToken}`)
        .attach('file', buffer, 'invalid-days.xlsx');

      expect(res.status).toBe(400);
      expect(res.body.errors.some((e: any) => e.field === 'validDays')).toBe(true);
    });
  });

  describe('File upload errors', () => {
    it('should reject request without file', async () => {
      const res = await request(app)
        .post('/api/merchants/me/menu/bulk-upload')
        .set('Authorization', `Bearer ${merchantToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No file uploaded');
    });

    it('should reject empty Excel file', async () => {
      const buffer = createExcelBuffer([]);

      const res = await request(app)
        .post('/api/merchants/me/menu/bulk-upload')
        .set('Authorization', `Bearer ${merchantToken}`)
        .attach('file', buffer, 'empty.xlsx');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('empty');
    });
  });

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const menuData = [{ name: 'Pizza', price: 15.99, category: 'Pizza' }];
      const buffer = createExcelBuffer(menuData);

      const res = await request(app)
        .post('/api/merchants/me/menu/bulk-upload')
        .attach('file', buffer, 'menu.xlsx');

      expect(res.status).toBe(401);
    });

    it('should reject non-merchant users', async () => {
      // Create regular user
      const hashedPassword = await bcrypt.hash('password123', 10);
      const regularUser = await prisma.user.create({
        data: { email: 'regular@test.com', password: hashedPassword, name: 'Regular User' }
      });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'regular@test.com', password: 'password123' });

      const menuData = [{ name: 'Pizza', price: 15.99, category: 'Pizza' }];
      const buffer = createExcelBuffer(menuData);

      const res = await request(app)
        .post('/api/merchants/me/menu/bulk-upload')
        .set('Authorization', `Bearer ${loginRes.body.token}`)
        .attach('file', buffer, 'menu.xlsx');

      expect(res.status).toBe(403);

      // Cleanup
      await prisma.user.delete({ where: { id: regularUser.id } });
    });
  });
});
