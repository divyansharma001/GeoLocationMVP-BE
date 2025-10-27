// Test file for deal discount system
// Run with: npx ts-node scripts/test-deal-discounts.ts

import prisma from '../src/lib/prisma';

interface MenuItem {
  id: number;
  name: string;
  price: number;
  category: string;
}

interface DealMenuItem {
  menuItemId: number;
  customPrice: number | null;
  customDiscount: number | null;
  discountAmount: number | null;
  useGlobalDiscount: boolean;
  menuItem: MenuItem;
}

interface Deal {
  id: number;
  title: string;
  discountPercentage: number | null;
  discountAmount: number | null;
}

/**
 * Calculate the final price for a menu item in a deal
 */
function calculateFinalPrice(
  basePrice: number,
  dealMenuItem: DealMenuItem,
  deal: Deal
): number {
  // 1. Check for custom price (highest priority)
  if (dealMenuItem.customPrice !== null) {
    return dealMenuItem.customPrice;
  }

  // 2. Check if item uses item-specific discount
  if (!dealMenuItem.useGlobalDiscount) {
    // Apply custom discount percentage
    if (dealMenuItem.customDiscount !== null) {
      return basePrice * (1 - dealMenuItem.customDiscount / 100);
    }
    
    // Apply fixed discount amount
    if (dealMenuItem.discountAmount !== null) {
      return Math.max(0, basePrice - dealMenuItem.discountAmount);
    }
  }

  // 3. Use global deal discount
  if (deal.discountPercentage !== null) {
    return basePrice * (1 - deal.discountPercentage / 100);
  }

  if (deal.discountAmount !== null) {
    return Math.max(0, basePrice - deal.discountAmount);
  }

  // 4. No discount
  return basePrice;
}

/**
 * Get discount description for display
 */
function getDiscountDescription(
  dealMenuItem: DealMenuItem,
  deal: Deal
): string {
  if (dealMenuItem.customPrice !== null) {
    return `Fixed Price: $${dealMenuItem.customPrice.toFixed(2)}`;
  }

  if (!dealMenuItem.useGlobalDiscount) {
    if (dealMenuItem.customDiscount !== null) {
      return `${dealMenuItem.customDiscount}% OFF (Item Specific)`;
    }
    if (dealMenuItem.discountAmount !== null) {
      return `$${dealMenuItem.discountAmount.toFixed(2)} OFF (Item Specific)`;
    }
  }

  if (deal.discountPercentage !== null) {
    return `${deal.discountPercentage}% OFF (Global)`;
  }

  if (deal.discountAmount !== null) {
    return `$${deal.discountAmount.toFixed(2)} OFF (Global)`;
  }

  return 'No Discount';
}

/**
 * Test the discount system with various scenarios
 */
async function testDiscountSystem() {
  console.log('🧪 Testing Deal Discount System\n');
  console.log('=' .repeat(80));

  try {
    // Find a deal with menu items (or use a specific deal ID)
    const deal = await prisma.deal.findFirst({
      where: {
        menuItems: {
          some: {}
        }
      },
      include: {
        menuItems: {
          include: {
            menuItem: true
          }
        }
      }
    });

    if (!deal) {
      console.log('❌ No deals with menu items found in database');
      console.log('Create a deal with menu items first to test the discount system');
      return;
    }

    console.log(`\n📋 Testing Deal: "${deal.title}"`);
    console.log(`   Deal ID: ${deal.id}`);
    console.log(`   Global Discount: ${deal.discountPercentage ? `${deal.discountPercentage}%` : deal.discountAmount ? `$${deal.discountAmount}` : 'None'}`);
    console.log('\n' + '-'.repeat(80));

    // Test each menu item
    console.log('\n📊 Menu Items Pricing:\n');
    
    deal.menuItems.forEach((dealMenuItem, index) => {
      const menuItem = dealMenuItem.menuItem;
      const finalPrice = calculateFinalPrice(menuItem.price, dealMenuItem as any, deal);
      const savings = menuItem.price - finalPrice;
      const discountDesc = getDiscountDescription(dealMenuItem as any, deal);

      console.log(`${index + 1}. ${menuItem.name}`);
      console.log(`   Original Price:  $${menuItem.price.toFixed(2)}`);
      console.log(`   Final Price:     $${finalPrice.toFixed(2)}`);
      console.log(`   You Save:        $${savings.toFixed(2)} (${((savings/menuItem.price) * 100).toFixed(1)}%)`);
      console.log(`   Discount Type:   ${discountDesc}`);
      console.log(`   Uses Global:     ${dealMenuItem.useGlobalDiscount ? 'Yes' : 'No'}`);
      console.log('');
    });

    // Calculate total savings
    const totalOriginal = deal.menuItems.reduce(
      (sum, dmi) => sum + dmi.menuItem.price, 
      0
    );
    const totalFinal = deal.menuItems.reduce(
      (sum, dmi) => sum + calculateFinalPrice(dmi.menuItem.price, dmi as any, deal),
      0
    );
    const totalSavings = totalOriginal - totalFinal;

    console.log('-'.repeat(80));
    console.log('\n💰 Total Savings Summary:');
    console.log(`   Total Original:  $${totalOriginal.toFixed(2)}`);
    console.log(`   Total Final:     $${totalFinal.toFixed(2)}`);
    console.log(`   Total Savings:   $${totalSavings.toFixed(2)} (${((totalSavings/totalOriginal) * 100).toFixed(1)}%)`);
    console.log('\n' + '='.repeat(80));
    console.log('\n✅ Discount system test completed successfully!\n');

  } catch (error) {
    console.error('❌ Error testing discount system:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
if (require.main === module) {
  testDiscountSystem()
    .then(() => {
      console.log('Test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

export { calculateFinalPrice, getDiscountDescription };
