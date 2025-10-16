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
  const city = await prisma.city.create({ data: { name: `City-${email}`.slice(0,20), state: 'ST', active: true } });
  const token = await login(email);
  const mRes = await request(app)
    .post('/api/merchants/register')
    .set('Authorization', `Bearer ${token}`)
    .send({ businessName: `Biz-${email}`.slice(0,20), address: '1 Test Way', cityId: city.id });
  expect(mRes.status).toBe(201);
  const merchantId = mRes.body.merchant.id;
  await prisma.merchant.update({ where: { id: merchantId }, data: { status: 'APPROVED' } });
  return { token, merchantId };
}

async function setupPendingMerchant(email: string) {
  const reg = await register(email);
  expect(reg.status).toBe(201);
  // @ts-ignore
  const city = await prisma.city.create({ data: { name: `City-${email}`.slice(0,20), state: 'ST', active: true } });
  const token = await login(email);
  const mRes = await request(app)
    .post('/api/merchants/register')
    .set('Authorization', `Bearer ${token}`)
    .send({ businessName: `Biz-${email}`.slice(0,20), address: '1 Test Way', cityId: city.id });
  expect(mRes.status).toBe(201);
  const merchantId = mRes.body.merchant.id;
  // Keep status as PENDING (default)
  return { token, merchantId };
}

describe('Menu Item CRUD', () => {
  it('creates, updates and deletes a menu item', async () => {
    const { token } = await setupApprovedMerchant('crud1@example.com');

    // Create
    const createRes = await request(app)
      .post('/api/merchants/me/menu/item')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Margherita Pizza', price: 18.0, category: 'Mains', description: 'Classic', imageUrl: 'https://example.com/pizza.png' });
    expect(createRes.status).toBe(201);
    const id = createRes.body.menuItem.id;
    expect(createRes.body.menuItem.name).toBe('Margherita Pizza');

    // Update
    const updateRes = await request(app)
      .put(`/api/merchants/me/menu/item/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 19.5, category: 'Mains', name: 'Margherita Pizza Large' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.menuItem.price).toBe(19.5);
    expect(updateRes.body.menuItem.name).toBe('Margherita Pizza Large');

    // Delete
    const delRes = await request(app)
      .delete(`/api/merchants/me/menu/item/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(200);

    // Ensure gone
    // @ts-ignore
    const exists = await prisma.menuItem.findUnique({ where: { id } });
    expect(exists).toBeNull();
  });

  it('prevents creating with invalid data', async () => {
    const { token } = await setupApprovedMerchant('crud2@example.com');
    const res = await request(app)
      .post('/api/merchants/me/menu/item')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '', price: -5, category: '' });
    expect(res.status).toBe(400);
  });

  it('blocks access to another merchant\'s item', async () => {
    const { token: t1 } = await setupApprovedMerchant('crud3a@example.com');
    const { token: t2 } = await setupApprovedMerchant('crud3b@example.com');

    const createRes = await request(app)
      .post('/api/merchants/me/menu/item')
      .set('Authorization', `Bearer ${t1}`)
      .send({ name: 'Item1', price: 5, category: 'Bites' });
    expect(createRes.status).toBe(201);
    const id = createRes.body.menuItem.id;

    const updateRes = await request(app)
      .put(`/api/merchants/me/menu/item/${id}`)
      .set('Authorization', `Bearer ${t2}`)
      .send({ name: 'Hacked' });
    expect(updateRes.status).toBe(404);

    const deleteRes = await request(app)
      .delete(`/api/merchants/me/menu/item/${id}`)
      .set('Authorization', `Bearer ${t2}`);
    expect(deleteRes.status).toBe(404);
  });

  it('allows pending merchants to create menu items', async () => {
    const { token } = await setupPendingMerchant('pending1@example.com');

    // Create menu item as pending merchant
    const createRes = await request(app)
      .post('/api/merchants/me/menu/item')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Pending Pizza', price: 15.0, category: 'Mains', description: 'Created before approval' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.menuItem.name).toBe('Pending Pizza');

    // Get menu items
    const getRes = await request(app)
      .get('/api/merchants/me/menu')
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.menuItems).toHaveLength(1);
    expect(getRes.body.menuItems[0].name).toBe('Pending Pizza');

    // Update menu item
    const id = createRes.body.menuItem.id;
    const updateRes = await request(app)
      .put(`/api/merchants/me/menu/item/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 16.0, name: 'Pending Pizza Large' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.menuItem.price).toBe(16.0);
    expect(updateRes.body.menuItem.name).toBe('Pending Pizza Large');
  });
});
