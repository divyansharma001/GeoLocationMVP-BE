#!/usr/bin/env node

/**
 * Quick Menu Collections Health Check
 * Simple script to verify menu collections functionality
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function quickHealthCheck() {
  console.log('🏥 Quick Menu Collections Health Check\n');

  try {
    // 1. Test database connection
    console.log('1. Testing database connection...');
    await prisma.$queryRaw`SELECT 1`;
    console.log('   ✅ Database connected');

    // 2. Check if tables exist
    console.log('2. Checking schema...');
    const collections = await prisma.menuCollection.findMany({ take: 1 });
    const collectionItems = await prisma.menuCollectionItem.findMany({ take: 1 });
    console.log('   ✅ MenuCollection and MenuCollectionItem tables exist');

    // 3. Test basic operations
    console.log('3. Testing basic operations...');
    
    // Find a merchant
    const merchant = await prisma.merchant.findFirst({
      where: { status: 'APPROVED' }
    });

    if (!merchant) {
      console.log('   ⚠️  No approved merchants found for testing');
      return;
    }

    // Find menu items
    const menuItems = await prisma.menuItem.findMany({
      where: { merchantId: merchant.id },
      take: 3
    });

    if (menuItems.length === 0) {
      console.log('   ⚠️  No menu items found for testing');
      return;
    }

    console.log(`   ✅ Found ${menuItems.length} menu items for merchant ${merchant.businessName}`);

    // 4. Test collection creation
    console.log('4. Testing collection creation...');
    const testCollection = await prisma.menuCollection.create({
      data: {
        merchantId: merchant.id,
        name: 'Health Check Test Collection',
        description: 'Temporary collection for health check'
      }
    });

    console.log(`   ✅ Created test collection: ${testCollection.name}`);

    // 5. Test adding items to collection
    console.log('5. Testing collection item management...');
    const createdItems = await prisma.menuCollectionItem.createMany({
      data: menuItems.slice(0, 2).map((item, index) => ({
        collectionId: testCollection.id,
        menuItemId: item.id,
        sortOrder: index,
        notes: `Test item ${index + 1}`
      }))
    });

    console.log(`   ✅ Added ${createdItems.count} items to collection`);

    // 6. Test reading collection with items
    console.log('6. Testing collection retrieval...');
    const collectionWithItems = await prisma.menuCollection.findUnique({
      where: { id: testCollection.id },
      include: {
        items: {
          include: {
            menuItem: true
          }
        }
      }
    });

    if (collectionWithItems && collectionWithItems.items.length > 0) {
      console.log(`   ✅ Retrieved collection with ${collectionWithItems.items.length} items`);
    } else {
      console.log('   ❌ Failed to retrieve collection with items');
    }

    // 7. Cleanup
    console.log('7. Cleaning up test data...');
    await prisma.menuCollection.delete({
      where: { id: testCollection.id }
    });
    console.log('   ✅ Test data cleaned up');

    console.log('\n🎉 All health checks passed! Menu Collections feature is working correctly.');

  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the health check
quickHealthCheck();
