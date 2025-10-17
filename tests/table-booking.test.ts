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
    data: { name: `City-${email}`.slice(0,20), state: 'ST', active: true } 
  });
  
  const token = await login(email);
  const mRes = await request(app)
    .post('/api/merchants/register')
    .set('Authorization', `Bearer ${token}`)
    .send({ 
      businessName: `Biz-${email}`.slice(0,20), 
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
  
  return { token, merchantId, city };
}

async function setupTestData() {
  // Create merchant
  const { token: merchantToken, merchantId, city } = await setupApprovedMerchant('merchant@test.com');
  
  // Create regular user
  const userReg = await register('user@test.com');
  expect(userReg.status).toBe(201);
  const userToken = await login('user@test.com');
  
  // Create tables
  // @ts-ignore
  const table1 = await prisma.table.create({
    data: {
      merchantId,
      name: 'Table 1',
      capacity: 4,
      features: ['window', 'outdoor']
    }
  });
  
  // @ts-ignore
  const table2 = await prisma.table.create({
    data: {
      merchantId,
      name: 'Table 2',
      capacity: 6,
      features: ['private']
    }
  });
  
  // Create time slots
  // @ts-ignore
  const timeSlot1 = await prisma.timeSlot.create({
    data: {
      merchantId,
      dayOfWeek: 1, // Monday
      startTime: '18:00',
      endTime: '19:00',
      duration: 60,
      maxBookings: 2
    }
  });
  
  // @ts-ignore
  const timeSlot2 = await prisma.timeSlot.create({
    data: {
      merchantId,
      dayOfWeek: 1, // Monday
      startTime: '19:00',
      endTime: '20:00',
      duration: 60,
      maxBookings: 1
    }
  });
  
  // Create booking settings
  // @ts-ignore
  const bookingSettings = await prisma.bookingSettings.create({
    data: {
      merchantId,
      advanceBookingDays: 30,
      minPartySize: 1,
      maxPartySize: 10,
      requiresConfirmation: true,
      allowsModifications: true,
      allowsCancellations: true,
      cancellationHours: 24
    }
  });
  
  return {
    merchantToken,
    userToken,
    merchantId,
    city,
    tables: [table1, table2],
    timeSlots: [timeSlot1, timeSlot2],
    bookingSettings
  };
}

describe('Table Booking System', () => {
  let testData: any;

  beforeAll(async () => {
    testData = await setupTestData();
  });

  afterAll(async () => {
    // Cleanup test data
    if (testData) {
      // @ts-ignore
      await prisma.booking.deleteMany({
        where: { merchantId: testData.merchantId }
      });
      
      // @ts-ignore
      await prisma.timeSlot.deleteMany({
        where: { merchantId: testData.merchantId }
      });
      
      // @ts-ignore
      await prisma.table.deleteMany({
        where: { merchantId: testData.merchantId }
      });
      
      // @ts-ignore
      await prisma.bookingSettings.deleteMany({
        where: { merchantId: testData.merchantId }
      });
      
      // @ts-ignore
      await prisma.merchant.delete({
        where: { id: testData.merchantId }
      });
      
      // @ts-ignore
      await prisma.city.delete({
        where: { id: testData.city.id }
      });
      
      // @ts-ignore
      await prisma.user.deleteMany({
        where: { email: { in: ['merchant@test.com', 'user@test.com'] } }
      });
    }
  });

  describe('Merchant Table Management', () => {
    describe('GET /api/table-booking/merchant/tables', () => {
      it('returns merchant tables', async () => {
        const res = await request(app)
          .get('/api/table-booking/merchant/tables')
          .set('Authorization', `Bearer ${testData.merchantToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.tables).toHaveLength(2);
        expect(res.body.tables[0]).toHaveProperty('name');
        expect(res.body.tables[0]).toHaveProperty('capacity');
        expect(res.body.tables[0]).toHaveProperty('features');
      });

      it('requires authentication', async () => {
        const res = await request(app)
          .get('/api/table-booking/merchant/tables');

        expect(res.status).toBe(401);
      });
    });

    describe('POST /api/table-booking/merchant/tables', () => {
      it('creates a new table', async () => {
        const tableData = {
          name: 'Table 3',
          capacity: 8,
          features: ['booth', 'window']
        };

        const res = await request(app)
          .post('/api/table-booking/merchant/tables')
          .set('Authorization', `Bearer ${testData.merchantToken}`)
          .send(tableData);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.table.name).toBe('Table 3');
        expect(res.body.table.capacity).toBe(8);
        expect(res.body.table.features).toEqual(['booth', 'window']);
      });

      it('validates table data', async () => {
        const invalidData = {
          name: '',
          capacity: 0,
          features: 'invalid'
        };

        const res = await request(app)
          .post('/api/table-booking/merchant/tables')
          .set('Authorization', `Bearer ${testData.merchantToken}`)
          .send(invalidData);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation error');
      });
    });

    describe('PUT /api/table-booking/merchant/tables/:tableId', () => {
      it('updates a table', async () => {
        const updateData = {
          name: 'Updated Table 1',
          capacity: 5
        };

        const res = await request(app)
          .put(`/api/table-booking/merchant/tables/${testData.tables[0].id}`)
          .set('Authorization', `Bearer ${testData.merchantToken}`)
          .send(updateData);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.table.name).toBe('Updated Table 1');
        expect(res.body.table.capacity).toBe(5);
      });

      it('handles non-existent table', async () => {
        const res = await request(app)
          .put('/api/table-booking/merchant/tables/99999')
          .set('Authorization', `Bearer ${testData.merchantToken}`)
          .send({ name: 'Test' });

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Table not found');
      });
    });
  });

  describe('Merchant Time Slot Management', () => {
    describe('GET /api/table-booking/merchant/time-slots', () => {
      it('returns merchant time slots', async () => {
        const res = await request(app)
          .get('/api/table-booking/merchant/time-slots')
          .set('Authorization', `Bearer ${testData.merchantToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.timeSlots).toHaveLength(2);
        expect(res.body.timeSlots[0]).toHaveProperty('dayOfWeek');
        expect(res.body.timeSlots[0]).toHaveProperty('startTime');
        expect(res.body.timeSlots[0]).toHaveProperty('endTime');
      });

      it('filters by day of week', async () => {
        const res = await request(app)
          .get('/api/table-booking/merchant/time-slots?dayOfWeek=1')
          .set('Authorization', `Bearer ${testData.merchantToken}`);

        expect(res.status).toBe(200);
        expect(res.body.timeSlots).toHaveLength(2);
        expect(res.body.timeSlots.every((slot: any) => slot.dayOfWeek === 1)).toBe(true);
      });
    });

    describe('POST /api/table-booking/merchant/time-slots', () => {
      it('creates a new time slot', async () => {
        const slotData = {
          dayOfWeek: 2, // Tuesday
          startTime: '20:00',
          endTime: '21:00',
          duration: 60,
          maxBookings: 1
        };

        const res = await request(app)
          .post('/api/table-booking/merchant/time-slots')
          .set('Authorization', `Bearer ${testData.merchantToken}`)
          .send(slotData);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.timeSlot.dayOfWeek).toBe(2);
        expect(res.body.timeSlot.startTime).toBe('20:00');
      });

      it('validates time slot data', async () => {
        const invalidData = {
          dayOfWeek: 8, // Invalid day
          startTime: '25:00', // Invalid time
          endTime: '18:00',
          duration: 10 // Too short
        };

        const res = await request(app)
          .post('/api/table-booking/merchant/time-slots')
          .set('Authorization', `Bearer ${testData.merchantToken}`)
          .send(invalidData);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation error');
      });
    });
  });

  describe('Merchant Booking Management', () => {
    let bookingId: number;

    beforeAll(async () => {
      // Create a test booking
      const bookingData = {
        tableId: testData.tables[0].id,
        timeSlotId: testData.timeSlots[0].id,
        bookingDate: '2024-02-05', // Monday
        partySize: 2,
        specialRequests: 'Birthday celebration',
        contactPhone: '+1234567890',
        contactEmail: 'user@test.com'
      };

      const res = await request(app)
        .post('/api/table-booking/bookings')
        .set('Authorization', `Bearer ${testData.userToken}`)
        .send(bookingData);

      expect(res.status).toBe(201);
      bookingId = res.body.booking.id;
    });

    describe('GET /api/table-booking/merchant/bookings', () => {
      it('returns merchant bookings', async () => {
        const res = await request(app)
          .get('/api/table-booking/merchant/bookings')
          .set('Authorization', `Bearer ${testData.merchantToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.bookings).toHaveLength(1);
        expect(res.body.bookings[0]).toHaveProperty('partySize');
        expect(res.body.bookings[0]).toHaveProperty('status');
        expect(res.body.bookings[0]).toHaveProperty('table');
        expect(res.body.bookings[0]).toHaveProperty('timeSlot');
        expect(res.body.bookings[0]).toHaveProperty('user');
      });

      it('filters by status', async () => {
        const res = await request(app)
          .get('/api/table-booking/merchant/bookings?status=PENDING')
          .set('Authorization', `Bearer ${testData.merchantToken}`);

        expect(res.status).toBe(200);
        expect(res.body.bookings).toHaveLength(1);
        expect(res.body.bookings[0].status).toBe('PENDING');
      });
    });

    describe('PUT /api/table-booking/merchant/bookings/:bookingId/status', () => {
      it('updates booking status', async () => {
        const res = await request(app)
          .put(`/api/table-booking/merchant/bookings/${bookingId}/status`)
          .set('Authorization', `Bearer ${testData.merchantToken}`)
          .send({ status: 'CONFIRMED', notes: 'Confirmed via phone' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.booking.status).toBe('CONFIRMED');
        expect(res.body.booking.notes).toBe('Confirmed via phone');
        expect(res.body.booking.confirmedAt).toBeDefined();
      });

      it('validates status values', async () => {
        const res = await request(app)
          .put(`/api/table-booking/merchant/bookings/${bookingId}/status`)
          .set('Authorization', `Bearer ${testData.merchantToken}`)
          .send({ status: 'INVALID_STATUS' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid status');
      });
    });
  });

  describe('Merchant Booking Settings', () => {
    describe('GET /api/table-booking/merchant/settings', () => {
      it('returns booking settings', async () => {
        const res = await request(app)
          .get('/api/table-booking/merchant/settings')
          .set('Authorization', `Bearer ${testData.merchantToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.settings).toHaveProperty('advanceBookingDays');
        expect(res.body.settings).toHaveProperty('minPartySize');
        expect(res.body.settings).toHaveProperty('maxPartySize');
        expect(res.body.settings).toHaveProperty('requiresConfirmation');
      });
    });

    describe('PUT /api/table-booking/merchant/settings', () => {
      it('updates booking settings', async () => {
        const settingsData = {
          advanceBookingDays: 14,
          minPartySize: 2,
          maxPartySize: 8,
          requiresConfirmation: false,
          autoConfirm: true
        };

        const res = await request(app)
          .put('/api/table-booking/merchant/settings')
          .set('Authorization', `Bearer ${testData.merchantToken}`)
          .send(settingsData);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.settings.advanceBookingDays).toBe(14);
        expect(res.body.settings.minPartySize).toBe(2);
        expect(res.body.settings.maxPartySize).toBe(8);
        expect(res.body.settings.requiresConfirmation).toBe(false);
        expect(res.body.settings.autoConfirm).toBe(true);
      });

      it('validates settings data', async () => {
        const invalidData = {
          advanceBookingDays: -1,
          minPartySize: 0,
          maxPartySize: 100
        };

        const res = await request(app)
          .put('/api/table-booking/merchant/settings')
          .set('Authorization', `Bearer ${testData.merchantToken}`)
          .send(invalidData);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation error');
      });
    });
  });

  describe('Public Booking System', () => {
    describe('GET /api/table-booking/merchants/:merchantId/availability', () => {
      it('returns available time slots', async () => {
        const res = await request(app)
          .get(`/api/table-booking/merchants/${testData.merchantId}/availability?date=2024-02-05&partySize=2`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.date).toBe('2024-02-05');
        expect(res.body.partySize).toBe(2);
        expect(res.body.availableTimeSlots).toBeDefined();
        expect(res.body.availableTables).toBeDefined();
      });

      it('requires date parameter', async () => {
        const res = await request(app)
          .get(`/api/table-booking/merchants/${testData.merchantId}/availability`);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Date is required');
      });

      it('handles non-existent merchant', async () => {
        const res = await request(app)
          .get('/api/table-booking/merchants/99999/availability?date=2024-02-05');

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Merchant not found or not approved');
      });
    });

    describe('POST /api/table-booking/bookings', () => {
      it('creates a new booking', async () => {
        const bookingData = {
          tableId: testData.tables[1].id,
          timeSlotId: testData.timeSlots[1].id,
          bookingDate: '2024-02-05',
          partySize: 3,
          specialRequests: 'Anniversary dinner',
          contactPhone: '+1234567890',
          contactEmail: 'user@test.com'
        };

        const res = await request(app)
          .post('/api/table-booking/bookings')
          .set('Authorization', `Bearer ${testData.userToken}`)
          .send(bookingData);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.booking).toHaveProperty('confirmationCode');
        expect(res.body.booking.partySize).toBe(3);
        expect(res.body.booking.status).toBe('PENDING');
        expect(res.body.booking.table).toBeDefined();
        expect(res.body.booking.timeSlot).toBeDefined();
        expect(res.body.booking.merchant).toBeDefined();
      });

      it('validates booking data', async () => {
        const invalidData = {
          tableId: 0,
          timeSlotId: 0,
          bookingDate: 'invalid-date',
          partySize: 0
        };

        const res = await request(app)
          .post('/api/table-booking/bookings')
          .set('Authorization', `Bearer ${testData.userToken}`)
          .send(invalidData);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation error');
      });

      it('requires authentication', async () => {
        const res = await request(app)
          .post('/api/table-booking/bookings')
          .send({ tableId: 1, timeSlotId: 1, bookingDate: '2024-02-05', partySize: 2 });

        expect(res.status).toBe(401);
      });
    });

    describe('GET /api/table-booking/bookings', () => {
      it('returns user bookings', async () => {
        const res = await request(app)
          .get('/api/table-booking/bookings')
          .set('Authorization', `Bearer ${testData.userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.bookings).toBeDefined();
        expect(res.body.pagination).toBeDefined();
      });

      it('filters by status', async () => {
        const res = await request(app)
          .get('/api/table-booking/bookings?status=PENDING')
          .set('Authorization', `Bearer ${testData.userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.bookings.every((booking: any) => booking.status === 'PENDING')).toBe(true);
      });
    });

    describe('GET /api/table-booking/bookings/:confirmationCode', () => {
      let confirmationCode: string;

      beforeAll(async () => {
        // Get a booking's confirmation code
        const res = await request(app)
          .get('/api/table-booking/bookings')
          .set('Authorization', `Bearer ${testData.userToken}`);

        confirmationCode = res.body.bookings[0].confirmationCode;
      });

      it('returns booking by confirmation code', async () => {
        const res = await request(app)
          .get(`/api/table-booking/bookings/${confirmationCode}`)
          .set('Authorization', `Bearer ${testData.userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.booking.confirmationCode).toBe(confirmationCode);
      });

      it('handles non-existent confirmation code', async () => {
        const res = await request(app)
          .get('/api/table-booking/bookings/INVALID')
          .set('Authorization', `Bearer ${testData.userToken}`);

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Booking not found');
      });
    });

    describe('PUT /api/table-booking/bookings/:bookingId', () => {
      let bookingId: number;

      beforeAll(async () => {
        // Get a booking ID
        const res = await request(app)
          .get('/api/table-booking/bookings')
          .set('Authorization', `Bearer ${testData.userToken}`);

        bookingId = res.body.bookings[0].id;
      });

      it('updates booking details', async () => {
        const updateData = {
          partySize: 4,
          specialRequests: 'Updated special requests',
          contactPhone: '+9876543210'
        };

        const res = await request(app)
          .put(`/api/table-booking/bookings/${bookingId}`)
          .set('Authorization', `Bearer ${testData.userToken}`)
          .send(updateData);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.booking.partySize).toBe(4);
        expect(res.body.booking.specialRequests).toBe('Updated special requests');
        expect(res.body.booking.contactPhone).toBe('+9876543210');
      });

      it('validates party size constraints', async () => {
        const updateData = {
          partySize: 15 // Exceeds max party size
        };

        const res = await request(app)
          .put(`/api/table-booking/bookings/${bookingId}`)
          .set('Authorization', `Bearer ${testData.userToken}`)
          .send(updateData);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Maximum party size');
      });
    });

    describe('DELETE /api/table-booking/bookings/:bookingId', () => {
      let bookingId: number;

      beforeAll(async () => {
        // Create a new booking for cancellation test
        const bookingData = {
          tableId: testData.tables[0].id,
          timeSlotId: testData.timeSlots[0].id,
          bookingDate: '2024-12-31', // Future date
          partySize: 2
        };

        const res = await request(app)
          .post('/api/table-booking/bookings')
          .set('Authorization', `Bearer ${testData.userToken}`)
          .send(bookingData);

        bookingId = res.body.booking.id;
      });

      it('cancels a booking', async () => {
        const res = await request(app)
          .delete(`/api/table-booking/bookings/${bookingId}`)
          .set('Authorization', `Bearer ${testData.userToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.booking.status).toBe('CANCELLED');
        expect(res.body.booking.cancelledAt).toBeDefined();
        expect(res.body.booking.cancelledBy).toBeDefined();
      });

      it('handles already cancelled booking', async () => {
        const res = await request(app)
          .delete(`/api/table-booking/bookings/${bookingId}`)
          .set('Authorization', `Bearer ${testData.userToken}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Booking is already cancelled');
      });
    });
  });

  describe('Error Handling', () => {
    it('handles invalid merchant ID', async () => {
      const res = await request(app)
        .get('/api/table-booking/merchants/invalid/availability?date=2024-02-05');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid merchant ID');
    });

    it('handles invalid table ID', async () => {
      const res = await request(app)
        .put('/api/table-booking/merchant/tables/invalid')
        .set('Authorization', `Bearer ${testData.merchantToken}`)
        .send({ name: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid table ID');
    });

    it('handles invalid booking ID', async () => {
      const res = await request(app)
        .put('/api/table-booking/bookings/invalid')
        .set('Authorization', `Bearer ${testData.userToken}`)
        .send({ partySize: 3 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid booking ID');
    });
  });

  describe('Business Logic Validation', () => {
    it('prevents booking for past dates', async () => {
      const bookingData = {
        tableId: testData.tables[0].id,
        timeSlotId: testData.timeSlots[0].id,
        bookingDate: '2020-01-01', // Past date
        partySize: 2
      };

      const res = await request(app)
        .post('/api/table-booking/bookings')
        .set('Authorization', `Bearer ${testData.userToken}`)
        .send(bookingData);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot book for past dates');
    });

    it('prevents booking beyond advance limit', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 35); // Beyond 30-day limit
      const bookingDate = futureDate.toISOString().split('T')[0];

      const bookingData = {
        tableId: testData.tables[0].id,
        timeSlotId: testData.timeSlots[0].id,
        bookingDate,
        partySize: 2
      };

      const res = await request(app)
        .post('/api/table-booking/bookings')
        .set('Authorization', `Bearer ${testData.userToken}`)
        .send(bookingData);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot book more than');
    });

    it('prevents double booking', async () => {
      // Create first booking
      const bookingData = {
        tableId: testData.tables[0].id,
        timeSlotId: testData.timeSlots[0].id,
        bookingDate: '2024-02-05',
        partySize: 2
      };

      await request(app)
        .post('/api/table-booking/bookings')
        .set('Authorization', `Bearer ${testData.userToken}`)
        .send(bookingData);

      // Try to create second booking for same table and time slot
      const res = await request(app)
        .post('/api/table-booking/bookings')
        .set('Authorization', `Bearer ${testData.userToken}`)
        .send(bookingData);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Time slot is fully booked');
    });
  });
});

