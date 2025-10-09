import prisma from '../src/lib/prisma';

async function seedMasterData() {
  try {
    console.log('🌱 Seeding master data tables...\n');

    // 1. Seed PointEventTypeMaster
    console.log('📊 Seeding PointEventTypeMaster...');
    const pointEventTypes = [
      {
        name: 'SIGNUP',
        description: 'Points awarded for user signup',
        points: 100,
        active: true
      },
      {
        name: 'FIRST_CHECKIN_DEAL',
        description: 'Points awarded for first deal check-in',
        points: 50,
        active: true
      },
      {
        name: 'CHECKIN',
        description: 'Points awarded for regular deal check-ins',
        points: 10,
        active: true
      }
    ];

    for (const pointEventType of pointEventTypes) {
      const existing = await prisma.pointEventTypeMaster.findFirst({
        where: { name: pointEventType.name }
      });

      if (!existing) {
        await prisma.pointEventTypeMaster.create({
          data: pointEventType
        });
        console.log(`  ✅ Created point event type: ${pointEventType.name}`);
      } else {
        console.log(`  ⏭️  Point event type already exists: ${pointEventType.name}`);
      }
    }

    // 2. Seed DealCategoryMaster
    console.log('\n📂 Seeding DealCategoryMaster...');
    const dealCategories = [
      {
        name: 'Food & Beverage',
        description: 'Restaurants, cafes, bars, and food-related deals',
        icon: '🍽️',
        color: '#FF6B6B',
        sortOrder: 1,
        active: true
      },
      {
        name: 'Retail',
        description: 'Shopping, fashion, electronics, and retail deals',
        icon: '🛍️',
        color: '#4ECDC4',
        sortOrder: 2,
        active: true
      },
      {
        name: 'Entertainment',
        description: 'Movies, shows, events, and entertainment deals',
        icon: '🎬',
        color: '#45B7D1',
        sortOrder: 3,
        active: true
      },
      {
        name: 'Health & Fitness',
        description: 'Gyms, spas, wellness, and health-related deals',
        icon: '💪',
        color: '#96CEB4',
        sortOrder: 4,
        active: true
      },
      {
        name: 'Beauty & Spa',
        description: 'Salons, spas, beauty treatments, and wellness deals',
        icon: '💄',
        color: '#FFEAA7',
        sortOrder: 5,
        active: true
      },
      {
        name: 'Automotive',
        description: 'Car services, repairs, and automotive deals',
        icon: '🚗',
        color: '#DDA0DD',
        sortOrder: 6,
        active: true
      },
      {
        name: 'Travel',
        description: 'Hotels, flights, tours, and travel deals',
        icon: '✈️',
        color: '#98D8C8',
        sortOrder: 7,
        active: true
      },
      {
        name: 'Education',
        description: 'Courses, training, and educational deals',
        icon: '📚',
        color: '#F7DC6F',
        sortOrder: 8,
        active: true
      },
      {
        name: 'Technology',
        description: 'Software, gadgets, and tech-related deals',
        icon: '💻',
        color: '#BB8FCE',
        sortOrder: 9,
        active: true
      },
      {
        name: 'Home & Garden',
        description: 'Furniture, home improvement, and garden deals',
        icon: '🏠',
        color: '#85C1E9',
        sortOrder: 10,
        active: true
      },
      {
        name: 'Other',
        description: 'Miscellaneous deals and services',
        icon: '📦',
        color: '#F8C471',
        sortOrder: 11,
        active: true
      }
    ];

    for (const category of dealCategories) {
      const existing = await prisma.dealCategoryMaster.findFirst({
        where: { name: category.name }
      });

      if (!existing) {
        await prisma.dealCategoryMaster.create({
          data: category
        });
        console.log(`  ✅ Created deal category: ${category.name}`);
      } else {
        console.log(`  ⏭️  Deal category already exists: ${category.name}`);
      }
    }

    // 3. Seed DealTypeMaster
    console.log('\n🎯 Seeding DealTypeMaster...');
    const dealTypes = [
      {
        name: 'Standard',
        description: 'Regular deals and promotions',
        active: true
      },
      {
        name: 'Happy Hour',
        description: 'Special discounts during specific hours',
        active: true
      },
      {
        name: 'Recurring',
        description: 'Deals that repeat on specific days',
        active: true
      }
    ];

    for (const dealType of dealTypes) {
      const existing = await prisma.dealTypeMaster.findFirst({
        where: { name: dealType.name }
      });

      if (!existing) {
        await prisma.dealTypeMaster.create({
          data: dealType
        });
        console.log(`  ✅ Created deal type: ${dealType.name}`);
      } else {
        console.log(`  ⏭️  Deal type already exists: ${dealType.name}`);
      }
    }

    // 4. Create admin user if it doesn't exist
    console.log('\n👤 Creating admin user...');
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash('Admin@1234', 10);
    
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin@gmail.com' },
      update: {
        password: hashedPassword,
        role: 'ADMIN',
        name: 'Admin User',
      },
      create: {
        email: 'admin@gmail.com',
        password: hashedPassword,
        role: 'ADMIN',
        name: 'Admin User',
      },
    });

    console.log(`  ✅ Admin user ready: ${adminUser.email}`);

    console.log('\n🎉 Master data seeding completed successfully!');
    console.log('\n📋 Summary:');
    console.log('  - Point event types: Ready for user signup points');
    console.log('  - Deal categories: Ready for deal creation');
    console.log('  - Deal types: Ready for different deal formats');
    console.log('  - Admin user: Ready for admin access');

  } catch (error) {
    console.error('❌ Error seeding master data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedMasterData();
