import { prisma } from '../src/lib/prisma';
import { logger } from '../src/lib/logging/logger';

async function seedNudges() {
  logger.info('Seeding initial nudges...');

  try {
    // Clear existing nudges if needed
    // await prisma.nudge.deleteMany({});

    const nudges = [
      {
        type: 'INACTIVITY',
        title: 'We miss you! 🎉',
        message: 'It\'s been a while! Check out today\'s amazing deals and keep your streak alive.',
        triggerCondition: { daysInactive: 3 },
        frequency: 'WEEKLY',
        cooldownHours: 168,
        active: true,
        priority: 10
      },
      {
        type: 'STREAK_REMINDER',
        title: 'Your streak is at risk! 🔥',
        message: 'You\'ve got a great streak going! Check in today to keep it alive.',
        triggerCondition: { minStreak: 3 },
        frequency: 'DAILY',
        cooldownHours: 24,
        active: true,
        priority: 20
      },
      {
        type: 'HAPPY_HOUR_ALERT',
        title: 'Happy Hour Alert! 🍸',
        message: 'Your favorite venue\'s happy hour starts in 30 minutes!',
        triggerCondition: { minutesBefore: 30 },
        frequency: 'UNLIMITED',
        cooldownHours: 0,
        active: true,
        priority: 15,
        timeWindowStart: '16:00',
        timeWindowEnd: '23:59'
      },
      {
        type: 'NEARBY_DEAL',
        title: 'Great deal nearby! 🎁',
        message: 'You\'re close to a venue with an amazing deal. Check it out!',
        triggerCondition: { radiusMeters: 500 },
        frequency: 'DAILY',
        cooldownHours: 24,
        active: true,
        priority: 12
      },
      {
        type: 'WEATHER_BASED',
        title: 'Weather-based deal! ☔',
        message: 'Rainy day? Cozy places have special offers for you!',
        triggerCondition: { weatherCondition: 'RAINY' },
        frequency: 'DAILY',
        cooldownHours: 24,
        active: false,
        priority: 8
      }
    ];

    for (const nudge of nudges) {
      const existing = await prisma.nudge.findFirst({
        where: { type: nudge.type }
      });

      if (!existing) {
        await prisma.nudge.create({
          data: nudge as any
        });
        logger.info(`Created nudge: ${nudge.type}`);
      } else {
        logger.info(`Nudge ${nudge.type} already exists, skipping...`);
      }
    }

    logger.info('✅ Nudge seeding completed');
  } catch (error) {
    logger.error('Error seeding nudges:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedNudges();
