import cron from 'node-cron';
import prisma from '../lib/prisma';
import { nudgeService } from '../lib/nudge.service';
import logger from '../lib/logging/logger';

export function startNudgeCronJobs() {
  logger.info('Initializing nudge cron jobs...');

  // Check inactivity nudges - every hour
  cron.schedule('0 * * * *', async () => {
    logger.info('Running inactivity nudge check');
    
    try {
      const inactiveThreshold = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days
      
      const inactiveUsers = await prisma.user.findMany({
        where: {
          lastLoginAt: { lt: inactiveThreshold }
        },
        select: { id: true }
      });

      const inactivityNudge = await prisma.nudge.findFirst({
        where: { type: 'INACTIVITY', active: true }
      });

      if (inactivityNudge) {
        for (const user of inactiveUsers) {
          await nudgeService.sendNudge(user.id, inactivityNudge.id);
        }
      }
      
      logger.info(`Checked ${inactiveUsers.length} inactive users`);
    } catch (error) {
      logger.error('Error in inactivity nudge job:', error);
    }
  });

  // Check streak reminders - every hour
  cron.schedule('0 * * * *', async () => {
    logger.info('Running streak reminder check');
    
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      
      const usersWithStreaks = await prisma.userStreak.findMany({
        where: {
          currentStreak: { gte: 3 },
          lastCheckInDate: {
            gte: twoDaysAgo,
            lt: yesterday
          }
        },
        select: { userId: true, currentStreak: true }
      });

      const streakNudge = await prisma.nudge.findFirst({
        where: { type: 'STREAK_REMINDER', active: true }
      });

      if (streakNudge) {
        for (const streak of usersWithStreaks) {
          await nudgeService.sendNudge(streak.userId, streakNudge.id, {
            currentStreak: streak.currentStreak
          });
        }
      }
      
      logger.info(`Checked ${usersWithStreaks.length} users with streaks at risk`);
    } catch (error) {
      logger.error('Error in streak reminder job:', error);
    }
  });

  // Check happy hour alerts - every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('Running happy hour alert check');
    
    try {
      const now = new Date();
      const in30Minutes = new Date(now.getTime() + 30 * 60 * 1000);
      const in15Minutes = new Date(now.getTime() + 15 * 60 * 1000);
      
      // Find deals starting in the next 15-30 minutes
      const upcomingDeals = await prisma.deal.findMany({
        where: {
          startTime: {
            gte: in15Minutes,
            lte: in30Minutes
          }
        },
        include: {
          merchant: true,
          savedByUsers: {
            select: { userId: true }
          }
        }
      });

      const happyHourNudge = await prisma.nudge.findFirst({
        where: { type: 'HAPPY_HOUR_ALERT', active: true }
      });

      if (happyHourNudge && upcomingDeals.length > 0) {
        for (const deal of upcomingDeals) {
          // Send to users who saved this deal
          const userIds = deal.savedByUsers.map((u: { userId: number }) => u.userId);
          
          if (userIds.length > 0) {
            for (const userId of userIds) {
              await nudgeService.sendNudge(userId, happyHourNudge.id, {
                dealId: deal.id,
                dealTitle: deal.title,
                merchantName: deal.merchant.businessName,
                startTime: deal.startTime
              });
            }
          }
        }
        
        logger.info(`Found ${upcomingDeals.length} upcoming deals`);
      }
    } catch (error) {
      logger.error('Error in happy hour alert job:', error);
    }
  });

  // Check nearby deals - every 15 minutes
  // This is a placeholder - requires real-time user location tracking
  cron.schedule('*/15 * * * *', async () => {
    logger.info('Running nearby deal check');
    // TODO: Implement when we have user location tracking
    // For now, this can be triggered when user updates their location
  });

  // Weather-based nudges - every 2 hours
  cron.schedule('0 */2 * * *', async () => {
    logger.info('Running weather-based nudge check');
    // TODO: Implement with weather API integration
    // For now, this is a placeholder
  });

  logger.info('Nudge cron jobs started successfully');
}
