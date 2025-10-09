import prisma from '../src/lib/prisma';
import bcrypt from 'bcryptjs';

async function createTestUsers() {
  // Create test users first
  const users = [
    {
      email: 'merchant1@test.com',
      name: 'John Smith',
      password: await bcrypt.hash('password123', 10),
      role: 'MERCHANT' as const
    },
    {
      email: 'merchant2@test.com', 
      name: 'Sarah Johnson',
      password: await bcrypt.hash('password123', 10),
      role: 'MERCHANT' as const
    },
    {
      email: 'merchant3@test.com',
      name: 'Mike Wilson',
      password: await bcrypt.hash('password123', 10),
      role: 'MERCHANT' as const
    },
    {
      email: 'merchant4@test.com',
      name: 'Lisa Brown',
      password: await bcrypt.hash('password123', 10),
      role: 'MERCHANT' as const
    },
    {
      email: 'merchant5@test.com',
      name: 'David Davis',
      password: await bcrypt.hash('password123', 10),
      role: 'MERCHANT' as const
    }
  ];

  const createdUsers = [];
  for (const userData of users) {
    try {
      const user = await prisma.user.create({
        data: userData
      });
      createdUsers.push(user);
      console.log(`Created user: ${user.email}`);
    } catch (error) {
      console.log(`User ${userData.email} might already exist, skipping...`);
    }
  }

  return createdUsers;
}

async function createTestMerchants(users: any[]) {
  const merchants = [
    {
      businessName: 'Downtown Coffee Co.',
      description: 'Artisanal coffee and pastries in the heart of downtown',
      address: '123 Main St, New York, NY 10001',
      logoUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=200',
      status: 'PENDING' as const,
      ownerId: users[0]?.id,
      latitude: 40.7589,
      longitude: -73.9851
    },
    {
      businessName: 'Bella Vista Restaurant',
      description: 'Authentic Italian cuisine with a modern twist',
      address: '456 Oak Ave, Los Angeles, CA 90210',
      logoUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=200',
      status: 'APPROVED' as const,
      ownerId: users[1]?.id,
      latitude: 34.0522,
      longitude: -118.2437
    },
    {
      businessName: 'Tech Hub Cafe',
      description: 'Coffee and workspace for tech professionals',
      address: '789 Tech Blvd, San Francisco, CA 94105',
      logoUrl: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=200',
      status: 'REJECTED' as const,
      rejectionReason: 'Incomplete business documentation',
      ownerId: users[2]?.id,
      latitude: 37.7749,
      longitude: -122.4194
    },
    {
      businessName: 'Green Garden Bistro',
      description: 'Farm-to-table dining with organic ingredients',
      address: '321 Garden St, Seattle, WA 98101',
      logoUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=200',
      status: 'SUSPENDED' as const,
      suspendedReason: 'Health code violations',
      suspendedUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      ownerId: users[3]?.id,
      latitude: 47.6062,
      longitude: -122.3321
    },
    {
      businessName: 'Sunset Bar & Grill',
      description: 'Casual dining with live music and great cocktails',
      address: '654 Sunset Blvd, Miami, FL 33101',
      logoUrl: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=200',
      status: 'PENDING' as const,
      ownerId: users[4]?.id,
      latitude: 25.7617,
      longitude: -80.1918
    }
  ];

  const createdMerchants = [];
  for (const merchantData of merchants) {
    try {
      const merchant = await prisma.merchant.create({
        data: merchantData
      });
      createdMerchants.push(merchant);
      console.log(`Created merchant: ${merchant.businessName} (${merchant.status})`);
    } catch (error) {
      console.log(`Merchant ${merchantData.businessName} might already exist, skipping...`);
    }
  }

  return createdMerchants;
}

async function createTestCities() {
  const cities = [
    { name: 'New York', state: 'NY', active: true },
    { name: 'Los Angeles', state: 'CA', active: true },
    { name: 'San Francisco', state: 'CA', active: true },
    { name: 'Seattle', state: 'WA', active: true },
    { name: 'Miami', state: 'FL', active: true },
    { name: 'Chicago', state: 'IL', active: true },
    { name: 'Boston', state: 'MA', active: true },
    { name: 'Austin', state: 'TX', active: true }
  ];

  const createdCities = [];
  for (const cityData of cities) {
    try {
      const city = await prisma.city.create({
        data: cityData
      });
      createdCities.push(city);
      console.log(`Created city: ${city.name}, ${city.state}`);
    } catch (error) {
      console.log(`City ${cityData.name}, ${cityData.state} might already exist, skipping...`);
    }
  }

  return createdCities;
}

async function createTestStores(merchants: any[], cities: any[]) {
  const stores = [
    {
      merchantId: merchants[0]?.id,
      cityId: cities[0]?.id, // New York
      address: '123 Main St, New York, NY 10001',
      latitude: 40.7589,
      longitude: -73.9851,
      active: true
    },
    {
      merchantId: merchants[1]?.id,
      cityId: cities[1]?.id, // Los Angeles
      address: '456 Oak Ave, Los Angeles, CA 90210',
      latitude: 34.0522,
      longitude: -118.2437,
      active: true
    },
    {
      merchantId: merchants[1]?.id,
      cityId: cities[1]?.id, // Los Angeles - second store
      address: '789 Sunset Blvd, Los Angeles, CA 90028',
      latitude: 34.0975,
      longitude: -118.3267,
      active: true
    },
    {
      merchantId: merchants[3]?.id,
      cityId: cities[3]?.id, // Seattle
      address: '321 Garden St, Seattle, WA 98101',
      latitude: 47.6062,
      longitude: -122.3321,
      active: true
    },
    {
      merchantId: merchants[4]?.id,
      cityId: cities[4]?.id, // Miami
      address: '654 Sunset Blvd, Miami, FL 33101',
      latitude: 25.7617,
      longitude: -80.1918,
      active: true
    }
  ];

  const createdStores = [];
  for (const storeData of stores) {
    try {
      const store = await prisma.store.create({
        data: storeData
      });
      createdStores.push(store);
      console.log(`Created store for merchant ${storeData.merchantId}`);
    } catch (error) {
      console.log(`Store for merchant ${storeData.merchantId} might already exist, skipping...`);
    }
  }

  return createdStores;
}

async function createTestDeals(merchants: any[]) {
  // First, get or create default category and deal type
  let category = await prisma.dealCategoryMaster.findFirst({
    where: { name: 'Food & Beverage' }
  });
  
  if (!category) {
    category = await prisma.dealCategoryMaster.create({
      data: {
        name: 'Food & Beverage',
        description: 'Restaurants, cafes, and food-related deals',
        active: true
      }
    });
  }

  let dealType = await prisma.dealTypeMaster.findFirst({
    where: { name: 'Standard' }
  });
  
  if (!dealType) {
    dealType = await prisma.dealTypeMaster.create({
      data: {
        name: 'Standard',
        description: 'Regular deals and promotions',
        active: true
      }
    });
  }

  const deals = [
    {
      title: 'Happy Hour Special',
      description: '50% off all drinks from 4-6 PM',
      imageUrls: [],
      discountPercentage: 50,
      startTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      endTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      redemptionInstructions: 'Show this deal to your server when ordering',
      merchantId: merchants[1]?.id, // Bella Vista (approved)
      categoryId: category.id,
      dealTypeId: dealType.id
    },
    {
      title: 'Weekend Brunch Deal',
      description: 'Buy 2 get 1 free on all brunch items',
      imageUrls: [],
      discountPercentage: null,
      discountAmount: null,
      startTime: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // 1 day from now
      endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      redemptionInstructions: 'Valid on weekends only, show deal to server',
      merchantId: merchants[1]?.id, // Bella Vista (approved)
      categoryId: category.id,
      dealTypeId: dealType.id
    },
    {
      title: 'Coffee & Pastry Combo',
      description: 'Any coffee + pastry for $8.99',
      imageUrls: [],
      discountAmount: 2.00,
      startTime: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      endTime: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
      redemptionInstructions: 'Mention this deal at checkout',
      merchantId: merchants[0]?.id, // Downtown Coffee (pending)
      categoryId: category.id,
      dealTypeId: dealType.id
    }
  ];

  const createdDeals = [];
  for (const dealData of deals) {
    try {
      const deal = await prisma.deal.create({
        data: dealData
      });
      createdDeals.push(deal);
      console.log(`Created deal: ${deal.title}`);
    } catch (error) {
      console.log(`Deal ${dealData.title} might already exist, skipping...`);
    }
  }

  return createdDeals;
}

async function main() {
  console.log('🌱 Starting to seed test data...');
  
  try {
    // Create test users
    console.log('\n👥 Creating test users...');
    const users = await createTestUsers();
    
    // Create test cities
    console.log('\n🏙️ Creating test cities...');
    const cities = await createTestCities();
    
    // Create test merchants
    console.log('\n🏪 Creating test merchants...');
    const merchants = await createTestMerchants(users);
    
    // Create test stores
    console.log('\n📍 Creating test stores...');
    const stores = await createTestStores(merchants, cities);
    
    // Create test deals
    console.log('\n🎯 Creating test deals...');
    const deals = await createTestDeals(merchants);
    
    console.log('\n✅ Test data seeding completed successfully!');
    console.log(`Created: ${users.length} users, ${cities.length} cities, ${merchants.length} merchants, ${stores.length} stores, ${deals.length} deals`);
    
  } catch (error) {
    console.error('❌ Error seeding test data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
