/**
 * Seed script for DealTypeMaster table
 * Creates/updates the 6 core deal types with proper descriptions
 * 
 * Run with: npx ts-node scripts/seed-deal-types.ts
 */

import prisma from '../src/lib/prisma';

const dealTypes = [
  {
    name: 'Standard',
    description: 'Standard promotional deal - one-time promotions with fixed start/end dates',
    active: true
  },
  {
    name: 'Happy Hour',
    description: 'Time-based daily specials from Happy Hour menu items only',
    active: true
  },
  {
    name: 'Bounty Deal',
    description: 'Rewards customers with cash back when they bring friends (verified via QR code)',
    active: true
  },
  {
    name: 'Hidden Deal',
    description: 'Secret VIP deals accessible via code, link, or QR - with optional bounty rewards',
    active: true
  },
  {
    name: 'Redeem Now',
    description: 'Flash sale with customizable discount (15%, 30%, 45%, 50%, 75%, or custom)',
    active: true
  },
  {
    name: 'Recurring Deal',
    description: 'Daily deals that recur on specific days of the week (e.g., Taco Tuesday)',
    active: true
  }
];

async function seedDealTypes() {
  console.log('🌱 Starting DealTypeMaster seed...\n');

  for (const dealType of dealTypes) {
    try {
      const result = await prisma.dealTypeMaster.upsert({
        where: { name: dealType.name },
        update: {
          description: dealType.description,
          active: dealType.active,
          updatedAt: new Date()
        },
        create: dealType
      });

      console.log(`✅ ${dealType.name}: ${result.id ? 'Created' : 'Updated'}`);
    } catch (error) {
      console.error(`❌ Error seeding ${dealType.name}:`, error);
    }
  }

  console.log('\n🎉 DealTypeMaster seed completed!\n');

  // Display all deal types
  const allDealTypes = await prisma.dealTypeMaster.findMany({
    where: { active: true },
    orderBy: { id: 'asc' }
  });

  console.log('📋 Active Deal Types:');
  console.table(allDealTypes.map(dt => ({
    ID: dt.id,
    Name: dt.name,
    Description: dt.description
  })));
}

seedDealTypes()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
