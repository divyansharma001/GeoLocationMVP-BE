import Queue from 'bull';
import { redis } from '../redis';
import { getIO } from '../websocket/socket.server';
import { sendEmail } from '../email';
import logger from '../logging/logger';
import prisma from '../prisma';

export const nudgeQueue = new Queue('nudges', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379')
  }
});

export interface NudgeJobData {
  userId: number;
  nudgeId: number;
  nudgeType: string;
  title: string;
  message: string;
  contextData?: any;
  userNudgeId: number;
}

nudgeQueue.process(async (job) => {
  const { userId, nudgeId, nudgeType, title, message, contextData, userNudgeId } = job.data as NudgeJobData;
  
  logger.info(`Processing nudge for user ${userId}, type: ${nudgeType}`);

  // Check if user is online
  const isOnline = await redis.sismember('online_users', userId.toString());

  try {
    if (isOnline) {
      // Send via WebSocket (instant!)
      const io = getIO();
      io.to(`user:${userId}`).emit('nudge', {
        id: userNudgeId,
        type: nudgeType,
        title,
        message,
        data: contextData,
        timestamp: new Date().toISOString()
      });

      // Update UserNudge record
      await prisma.userNudge.update({
        where: { id: userNudgeId },
        data: {
          delivered: true,
          deliveredVia: 'websocket'
        }
      });

      logger.info(`Nudge sent via WebSocket to user ${userId}`);
      return { delivered: 'websocket', success: true };
      
    } else {
      // Fallback to email
      const user = await prisma.user.findUnique({ where: { id: userId } });
      
      if (user?.email) {
        await sendEmail({
          to: user.email,
          subject: title,
          text: message,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">${title}</h2>
              <p style="font-size: 16px; color: #666;">${message}</p>
              <a href="${process.env.CLIENT_URL}/deals" 
                 style="display: inline-block; background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin-top: 20px;">
                View Deals
              </a>
            </div>
          `
        });

        await prisma.userNudge.update({
          where: { id: userNudgeId },
          data: {
            delivered: true,
            deliveredVia: 'email'
          }
        });

        logger.info(`Nudge sent via email to user ${userId}`);
        return { delivered: 'email', success: true };
      }
    }

    throw new Error('No delivery method available');

  } catch (error) {
    logger.error(`Failed to deliver nudge to user ${userId}:`, error);
    
    await prisma.userNudge.update({
      where: { id: userNudgeId },
      data: {
        delivered: false,
        deliveredVia: 'failed'
      }
    });

    throw error;
  }
});

// Error handling
nudgeQueue.on('failed', (job, err) => {
  logger.error(`Nudge job ${job.id} failed:`, err);
});

nudgeQueue.on('completed', (job) => {
  logger.info(`Nudge job ${job.id} completed`);
});

export default nudgeQueue;
