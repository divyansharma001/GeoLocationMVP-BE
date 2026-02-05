import { Server, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { redis } from '../redis';
import logger from '../logging/logger';
import prisma from '../prisma';

let io: Server;

export function setupWebSocket(httpServer: HTTPServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3001',
      credentials: true
    }
  });

  // Authentication middleware
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      socket.data.userId = decoded.id;
      socket.data.email = decoded.email;
      
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.userId;
    logger.info(`User ${userId} connected via WebSocket`);

    // Join user-specific room
    socket.join(`user:${userId}`);

    // Track online status in Redis
    await redis.sadd('online_users', userId.toString());
    await redis.hset(`user:${userId}:socket`, {
      socketId: socket.id,
      connectedAt: Date.now()
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      logger.info(`User ${userId} disconnected`);
      await redis.srem('online_users', userId.toString());
      await redis.del(`user:${userId}:socket`);
    });

    // Handle nudge engagement
    socket.on('nudge:opened', async (data: { userNudgeId: number }) => {
      try {
        await prisma.userNudge.update({
          where: { id: data.userNudgeId },
          data: { opened: true, openedAt: new Date() }
        });
        logger.info(`Nudge ${data.userNudgeId} opened by user ${userId}`);
      } catch (error) {
        logger.error(`Error tracking nudge opened:`, error);
      }
    });

    socket.on('nudge:clicked', async (data: { userNudgeId: number }) => {
      try {
        await prisma.userNudge.update({
          where: { id: data.userNudgeId },
          data: { clicked: true, clickedAt: new Date() }
        });
        logger.info(`Nudge ${data.userNudgeId} clicked by user ${userId}`);
      } catch (error) {
        logger.error(`Error tracking nudge clicked:`, error);
      }
    });

    socket.on('nudge:dismissed', async (data: { userNudgeId: number }) => {
      try {
        await prisma.userNudge.update({
          where: { id: data.userNudgeId },
          data: { dismissed: true }
        });
        logger.info(`Nudge ${data.userNudgeId} dismissed by user ${userId}`);
      } catch (error) {
        logger.error(`Error tracking nudge dismissed:`, error);
      }
    });
  });

  logger.info('WebSocket server initialized');
  return io;
}

export function getIO(): Server {
  if (!io) {
    throw new Error('WebSocket server not initialized');
  }
  return io;
}

export { io };
