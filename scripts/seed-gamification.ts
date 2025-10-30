import prisma from '../src/lib/prisma';
import { AchievementType, LoyaltyTier } from '@prisma/client';

async function seedGamificationData() {
  console.log('🎮 Seeding gamification data...');

  try {
    // Create achievements
    const achievements = [
      {
        name: 'Welcome Aboard!',
        description: 'Complete your first check-in and start earning coins',
        type: AchievementType.FIRST_PURCHASE,
        icon: '🎉',
        coinReward: 50,
        xpReward: 100,
        criteria: { type: 'first_checkin' },
        sortOrder: 1,
      },
      {
        name: 'Big Spender',
        description: 'Spend $50 total on deals',
        type: AchievementType.SPENDING_MILESTONE,
        icon: '💰',
        coinReward: 100,
        xpReward: 200,
        criteria: { amount: 50 },
        sortOrder: 2,
      },
      {
        name: 'Premium Player',
        description: 'Spend $150 total on deals',
        type: AchievementType.SPENDING_MILESTONE,
        icon: '💎',
        coinReward: 250,
        xpReward: 500,
        criteria: { amount: 150 },
        sortOrder: 3,
      },
      {
        name: 'Check-in Champion',
        description: 'Complete 5 check-ins in a week',
        type: AchievementType.CHECK_IN_STREAK,
        icon: '🏆',
        coinReward: 75,
        xpReward: 150,
        criteria: { streak: 5, timeframe: 'week' },
        sortOrder: 4,
      },
      {
        name: 'Social Butterfly',
        description: 'Refer 3 friends to join',
        type: AchievementType.REFERRAL_COUNT,
        icon: '🦋',
        coinReward: 200,
        xpReward: 300,
        criteria: { count: 3 },
        sortOrder: 5,
      },
      {
        name: 'Deal Collector',
        description: 'Save 10 deals to your favorites',
        type: AchievementType.DEAL_SAVER,
        icon: '❤️',
        coinReward: 50,
        xpReward: 100,
        criteria: { count: 10 },
        sortOrder: 6,
      },
      {
        name: 'Silver Status',
        description: 'Reach Silver loyalty tier',
        type: AchievementType.LOYALTY_TIER,
        icon: '🥈',
        coinReward: 100,
        xpReward: 200,
        criteria: { tier: 'SILVER' },
        sortOrder: 7,
      },
      {
        name: 'Gold Status',
        description: 'Reach Gold loyalty tier',
        type: AchievementType.LOYALTY_TIER,
        icon: '🥇',
        coinReward: 250,
        xpReward: 500,
        criteria: { tier: 'GOLD' },
        sortOrder: 8,
      },
      {
        name: 'Platinum Elite',
        description: 'Reach Platinum loyalty tier',
        type: AchievementType.LOYALTY_TIER,
        icon: '💠',
        coinReward: 500,
        xpReward: 1000,
        criteria: { tier: 'PLATINUM' },
        sortOrder: 9,
      },
      {
        name: 'Diamond Legend',
        description: 'Reach Diamond loyalty tier',
        type: AchievementType.LOYALTY_TIER,
        icon: '💎',
        coinReward: 1000,
        xpReward: 2000,
        criteria: { tier: 'DIAMOND' },
        sortOrder: 10,
      },
    ];

    for (const achievement of achievements) {
      await prisma.achievement.upsert({
        where: { name: achievement.name },
        update: achievement,
        create: achievement,
      });
    }

    console.log(`✅ Created ${achievements.length} achievements`);

    // Create loyalty tier configurations
    const loyaltyTiers = [
      {
        tier: LoyaltyTier.BRONZE,
        minSpent: 0,
        coinMultiplier: 1.0,
        discountPercentage: 0,
        specialPerks: {
          benefits: ['Standard coin earning rate', 'Access to all deals'],
        },
        tierColor: '#CD7F32',
        tierIcon: '🥉',
      },
      {
        tier: LoyaltyTier.SILVER,
        minSpent: 50,
        coinMultiplier: 1.2,
        discountPercentage: 5,
        specialPerks: {
          benefits: [
            '20% bonus coins on all activities',
            '5% additional discount on deals',
            'Priority customer support',
          ],
        },
        tierColor: '#C0C0C0',
        tierIcon: '🥈',
      },
      {
        tier: LoyaltyTier.GOLD,
        minSpent: 150,
        coinMultiplier: 1.5,
        discountPercentage: 10,
        specialPerks: {
          benefits: [
            '50% bonus coins on all activities',
            '10% additional discount on deals',
            'Early access to new deals',
            'Monthly bonus coins',
          ],
        },
        tierColor: '#FFD700',
        tierIcon: '🥇',
      },
      {
        tier: LoyaltyTier.PLATINUM,
        minSpent: 300,
        coinMultiplier: 1.8,
        discountPercentage: 15,
        specialPerks: {
          benefits: [
            '80% bonus coins on all activities',
            '15% additional discount on deals',
            'Exclusive VIP deals',
            'Personal account manager',
            'Birthday rewards',
          ],
        },
        tierColor: '#E5E4E2',
        tierIcon: '💠',
      },
      {
        tier: LoyaltyTier.DIAMOND,
        minSpent: 500,
        coinMultiplier: 2.0,
        discountPercentage: 20,
        specialPerks: {
          benefits: [
            '100% bonus coins on all activities',
            '20% additional discount on deals',
            'Access to premium merchant events',
            'Custom deal recommendations',
            'Concierge service',
            'Annual VIP package',
          ],
        },
        tierColor: '#B9F2FF',
        tierIcon: '💎',
      },
    ];

    for (const tier of loyaltyTiers) {
      await prisma.loyaltyTierConfig.upsert({
        where: { tier: tier.tier },
        update: tier,
        create: tier,
      });
    }

    console.log(`✅ Created ${loyaltyTiers.length} loyalty tier configurations`);

    console.log('🎉 Gamification data seeding completed successfully!');
  } catch (error) {
    console.error('❌ Error seeding gamification data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeding if this file is executed directly
if (require.main === module) {
  seedGamificationData()
    .then(() => {
      console.log('✅ Seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    });
}

export default seedGamificationData;