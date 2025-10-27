#!/usr/bin/env ts-node

/**
 * Menu Collections Health Check Script
 * Tests all menu collection endpoints and functionality
 */

import prisma from '../src/lib/prisma';
import logger from '../src/lib/logging/logger';

interface TestResult {
  test: string;
  status: 'PASS' | 'FAIL';
  message: string;
  duration?: number;
}

class MenuCollectionsHealthCheck {
  private results: TestResult[] = [];
  private testMerchantId?: number;
  private testMenuItemIds: number[] = [];
  private testCollectionId?: number;

  async runAllTests(): Promise<void> {
    console.log('🏥 Starting Menu Collections Health Check...\n');

    try {
      // Test 1: Database Connection
      await this.testDatabaseConnection();

      // Test 2: Schema Validation
      await this.testSchemaValidation();

      // Test 3: Create Test Data
      await this.createTestData();

      // Test 4: Menu Item Filtering
      await this.testMenuFiltering();

      // Test 5: Collection CRUD Operations
      await this.testCollectionCRUD();

      // Test 6: Collection Item Management
      await this.testCollectionItemManagement();

      // Test 7: Deal Integration
      await this.testDealIntegration();

      // Test 8: Public Endpoints
      await this.testPublicEndpoints();

      // Cleanup
      await this.cleanupTestData();

      // Print Results
      this.printResults();

    } catch (error) {
      logger.error('Health check failed:', error);
      console.error('❌ Health check failed:', error);
    } finally {
      await prisma.$disconnect();
    }
  }

  private async testDatabaseConnection(): Promise<void> {
    const startTime = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      const duration = Date.now() - startTime;
      
      this.addResult({
        test: 'Database Connection',
        status: 'PASS',
        message: `Connected successfully`,
        duration
      });
    } catch (error) {
      this.addResult({
        test: 'Database Connection',
        status: 'FAIL',
        message: `Connection failed: ${error}`
      });
    }
  }

  private async testSchemaValidation(): Promise<void> {
    try {
      // Check if MenuCollection table exists
      const collections = await prisma.menuCollection.findMany({ take: 1 });
      
      // Check if MenuCollectionItem table exists
      const collectionItems = await prisma.menuCollectionItem.findMany({ take: 1 });

      this.addResult({
        test: 'Schema Validation',
        status: 'PASS',
        message: 'MenuCollection and MenuCollectionItem tables exist'
      });
    } catch (error) {
      this.addResult({
        test: 'Schema Validation',
        status: 'FAIL',
        message: `Schema validation failed: ${error}`
      });
    }
  }

  private async createTestData(): Promise<void> {
    try {
      // Find or create a test merchant
      let merchant = await prisma.merchant.findFirst({
        where: { status: 'APPROVED' }
      });

      if (!merchant) {
        // Create a test user and merchant
        const user = await prisma.user.create({
          data: {
            email: 'test-merchant@example.com',
            password: 'hashedpassword',
            role: 'MERCHANT'
          }
        });

        merchant = await prisma.merchant.create({
          data: {
            businessName: 'Test Restaurant',
            address: '123 Test St',
            description: 'Test merchant for health checks',
            ownerId: user.id,
            status: 'APPROVED'
          }
        });
      }

      this.testMerchantId = merchant.id;

      // Create test menu items
      const menuItems = await Promise.all([
        prisma.menuItem.create({
          data: {
            merchantId: merchant.id,
            name: 'Test Craft Beer',
            price: 8.00,
            category: 'Drinks',
            description: 'Test beer for health check',
            dealType: 'HAPPY_HOUR_BOUNTY',
            isHappyHour: true,
            happyHourPrice: 5.00
          }
        }),
        prisma.menuItem.create({
          data: {
            merchantId: merchant.id,
            name: 'Test Pizza',
            price: 15.00,
            category: 'Food',
            description: 'Test pizza for health check',
            dealType: 'HAPPY_HOUR_BOUNTY',
            isHappyHour: true,
            happyHourPrice: 12.00
          }
        }),
        prisma.menuItem.create({
          data: {
            merchantId: merchant.id,
            name: 'Test Wings',
            price: 12.00,
            category: 'Appetizers',
            description: 'Test wings for health check',
            dealType: 'HAPPY_HOUR_LATE_NIGHT',
            isHappyHour: true,
            happyHourPrice: 8.00
          }
        })
      ]);

      this.testMenuItemIds = menuItems.map(item => item.id);

      this.addResult({
        test: 'Test Data Creation',
        status: 'PASS',
        message: `Created test merchant and ${menuItems.length} menu items`
      });
    } catch (error) {
      this.addResult({
        test: 'Test Data Creation',
        status: 'FAIL',
        message: `Failed to create test data: ${error}`
      });
    }
  }

  private async testMenuFiltering(): Promise<void> {
    try {
      // Test filtering by deal type
      const happyHourItems = await prisma.menuItem.findMany({
        where: {
          merchantId: this.testMerchantId!,
          dealType: 'HAPPY_HOUR_BOUNTY'
        }
      });

      const lateNightItems = await prisma.menuItem.findMany({
        where: {
          merchantId: this.testMerchantId!,
          dealType: 'HAPPY_HOUR_LATE_NIGHT'
        }
      });

      if (happyHourItems.length >= 2 && lateNightItems.length >= 1) {
        this.addResult({
          test: 'Menu Filtering by Deal Type',
          status: 'PASS',
          message: `Found ${happyHourItems.length} Happy Hour items, ${lateNightItems.length} Late Night items`
        });
      } else {
        this.addResult({
          test: 'Menu Filtering by Deal Type',
          status: 'FAIL',
          message: `Expected at least 2 Happy Hour items and 1 Late Night item`
        });
      }
    } catch (error) {
      this.addResult({
        test: 'Menu Filtering by Deal Type',
        status: 'FAIL',
        message: `Filtering test failed: ${error}`
      });
    }
  }

  private async testCollectionCRUD(): Promise<void> {
    try {
      // Test CREATE
      const collection = await prisma.menuCollection.create({
        data: {
          merchantId: this.testMerchantId!,
          name: 'Test Happy Hour Collection',
          description: 'Test collection for health check'
        }
      });

      this.testCollectionId = collection.id;

      // Test READ
      const foundCollection = await prisma.menuCollection.findUnique({
        where: { id: collection.id }
      });

      if (!foundCollection) {
        throw new Error('Collection not found after creation');
      }

      // Test UPDATE
      const updatedCollection = await prisma.menuCollection.update({
        where: { id: collection.id },
        data: { description: 'Updated test collection' }
      });

      if (updatedCollection.description !== 'Updated test collection') {
        throw new Error('Collection update failed');
      }

      this.addResult({
        test: 'Collection CRUD Operations',
        status: 'PASS',
        message: 'Create, Read, Update operations successful'
      });
    } catch (error) {
      this.addResult({
        test: 'Collection CRUD Operations',
        status: 'FAIL',
        message: `CRUD test failed: ${error}`
      });
    }
  }

  private async testCollectionItemManagement(): Promise<void> {
    try {
      if (!this.testCollectionId) {
        throw new Error('No test collection ID available');
      }

      // Test adding items to collection
      const collectionItems = this.testMenuItemIds.map((itemId, index) => ({
        collectionId: this.testCollectionId!,
        menuItemId: itemId,
        sortOrder: index,
        customPrice: index === 0 ? 4.00 : null,
        notes: `Test item ${index + 1}`
      }));

      await prisma.menuCollectionItem.createMany({
        data: collectionItems
      });

      // Test reading collection with items
      const collectionWithItems = await prisma.menuCollection.findUnique({
        where: { id: this.testCollectionId },
        include: {
          items: {
            include: {
              menuItem: true
            },
            orderBy: { sortOrder: 'asc' }
          }
        }
      });

      if (!collectionWithItems || collectionWithItems.items.length !== this.testMenuItemIds.length) {
        throw new Error('Collection items not properly associated');
      }

      // Test updating collection item
      await prisma.menuCollectionItem.updateMany({
        where: {
          collectionId: this.testCollectionId,
          menuItemId: this.testMenuItemIds[0]
        },
        data: {
          customPrice: 3.50,
          notes: 'Updated test item'
        }
      });

      this.addResult({
        test: 'Collection Item Management',
        status: 'PASS',
        message: `Successfully managed ${collectionItems.length} collection items`
      });
    } catch (error) {
      this.addResult({
        test: 'Collection Item Management',
        status: 'FAIL',
        message: `Collection item management failed: ${error}`
      });
    }
  }

  private async testDealIntegration(): Promise<void> {
    try {
      if (!this.testCollectionId) {
        throw new Error('No test collection ID available');
      }

      // Test creating a deal with menu collection
      const deal = await prisma.deal.create({
        data: {
          title: 'Test Deal with Collection',
          description: 'Test deal for health check',
          startTime: new Date(),
          endTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
          redemptionInstructions: 'Test instructions',
          imageUrls: [],
          categoryId: 1, // Assuming category 1 exists
          dealTypeId: 1, // Assuming deal type 1 exists
          merchantId: this.testMerchantId!
        }
      });

      // Add collection items to deal
      const collectionItems = await prisma.menuCollectionItem.findMany({
        where: { collectionId: this.testCollectionId }
      });

      const dealMenuItems = collectionItems.map(item => ({
        dealId: deal.id,
        menuItemId: item.menuItemId,
        isHidden: false,
        customPrice: item.customPrice,
        customDiscount: item.customDiscount
      }));

      await prisma.dealMenuItem.createMany({
        data: dealMenuItems
      });

      // Verify deal has menu items
      const dealWithItems = await prisma.deal.findUnique({
        where: { id: deal.id },
        include: {
          menuItems: true
        }
      });

      if (!dealWithItems || dealWithItems.menuItems.length !== collectionItems.length) {
        throw new Error('Deal menu items not properly associated');
      }

      // Cleanup test deal
      await prisma.deal.delete({
        where: { id: deal.id }
      });

      this.addResult({
        test: 'Deal Integration',
        status: 'PASS',
        message: `Successfully integrated collection with deal (${collectionItems.length} items)`
      });
    } catch (error) {
      this.addResult({
        test: 'Deal Integration',
        status: 'FAIL',
        message: `Deal integration failed: ${error}`
      });
    }
  }

  private async testPublicEndpoints(): Promise<void> {
    try {
      // Test public menu collections endpoint (simulate)
      const publicCollections = await prisma.menuCollection.findMany({
        where: {
          merchantId: this.testMerchantId!,
          isActive: true,
          merchant: {
            status: 'APPROVED'
          }
        },
        include: {
          items: {
            where: { isActive: true },
            include: {
              menuItem: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  category: true,
                  imageUrl: true,
                  description: true,
                  dealType: true,
                  isHappyHour: true,
                  happyHourPrice: true
                }
              }
            }
          }
        }
      });

      this.addResult({
        test: 'Public Endpoints Simulation',
        status: 'PASS',
        message: `Public collections query successful (${publicCollections.length} collections)`
      });
    } catch (error) {
      this.addResult({
        test: 'Public Endpoints Simulation',
        status: 'FAIL',
        message: `Public endpoints test failed: ${error}`
      });
    }
  }

  private async cleanupTestData(): Promise<void> {
    try {
      if (this.testCollectionId) {
        await prisma.menuCollection.delete({
          where: { id: this.testCollectionId }
        });
      }

      if (this.testMenuItemIds.length > 0) {
        await prisma.menuItem.deleteMany({
          where: { id: { in: this.testMenuItemIds } }
        });
      }

      this.addResult({
        test: 'Cleanup',
        status: 'PASS',
        message: 'Test data cleaned up successfully'
      });
    } catch (error) {
      this.addResult({
        test: 'Cleanup',
        status: 'FAIL',
        message: `Cleanup failed: ${error}`
      });
    }
  }

  private addResult(result: TestResult): void {
    this.results.push(result);
  }

  private printResults(): void {
    console.log('\n📊 Health Check Results:');
    console.log('=' .repeat(50));

    let passCount = 0;
    let failCount = 0;

    this.results.forEach(result => {
      const status = result.status === 'PASS' ? '✅' : '❌';
      const duration = result.duration ? ` (${result.duration}ms)` : '';
      
      console.log(`${status} ${result.test}: ${result.message}${duration}`);
      
      if (result.status === 'PASS') {
        passCount++;
      } else {
        failCount++;
      }
    });

    console.log('=' .repeat(50));
    console.log(`📈 Summary: ${passCount} passed, ${failCount} failed`);
    
    if (failCount === 0) {
      console.log('🎉 All tests passed! Menu Collections feature is healthy.');
    } else {
      console.log('⚠️  Some tests failed. Please check the issues above.');
    }
  }
}

// Run the health check
async function main() {
  const healthCheck = new MenuCollectionsHealthCheck();
  await healthCheck.runAllTests();
}

if (require.main === module) {
  main().catch(console.error);
}

export default MenuCollectionsHealthCheck;
