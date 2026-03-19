# 🔔 PHASE 1: NUDGES & NOTIFICATIONS SYSTEM
**Implementation Approach:** WebSocket + Queue (Real-time + Fallback)  
**Duration:** 2-3 days  
**Tech Stack:** Socket.IO + Bull Queue + Redis + Email Fallback

---

## 🎯 OBJECTIVES

Build an intelligent, real-time notification system that:
- ✅ Sends instant notifications to online users via WebSocket
- ✅ Falls back to email for offline users
- ✅ Supports 5 core nudge types
- ✅ Prevents notification spam with frequency limits
- ✅ Provides admin controls and analytics

---

## 🏗️ ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────┐
│  TRIGGER SOURCES                                         │
│  • Cron Jobs (hourly checks)                            │
│  • Real-time Events (user location updates)             │
│  • Admin Manual Triggers                                 │
└─────────────────┬───────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────────────┐
│  NUDGE SERVICE                                           │
│  • Validate frequency limits                             │
│  • Check user preferences                                │
│  • Create UserNudge record                               │
└─────────────────┬───────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────────────┐
│  BULL QUEUE (Redis-backed)                               │
│  • Job: { userId, nudgeType, message, data }            │
│  • Retry logic (3 attempts)                             │
│  • Rate limiting                                         │
└─────────────────┬───────────────────────────────────────┘
                  ↓
         ┌────────┴────────┐
         ↓                 ↓
┌──────────────────┐  ┌──────────────────┐
│  WebSocket       │  │  Email           │
│  (Online users)  │  │  (Offline users) │
│  INSTANT ⚡      │  │  FALLBACK 📧     │
└──────────────────┘  └──────────────────┘
```

---

## 📊 DATABASE SCHEMA

### **New Models to Add:**

```prisma
enum NudgeType {
  INACTIVITY              // User hasn't logged in for X days
  NEARBY_DEAL             // User is near venue with active deal
  STREAK_REMINDER         // User about to lose streak
  HAPPY_HOUR_ALERT        // Happy hour starting soon
  WEATHER_BASED           // Weather-triggered deals
}

enum NudgeFrequency {
  ONCE               // Send only once ever
  DAILY              // Max once per day
  WEEKLY             // Max once per week
  UNLIMITED          // No frequency limit
}

model Nudge {
  id                Int             @id @default(autoincrement())
  type              NudgeType
  title             String          @db.VarChar(100)
  message           String          @db.VarChar(500)
  
  // Trigger Conditions (JSON)
  triggerCondition  Json            // e.g., { daysInactive: 3, radiusMeters: 500 }
  
  // Frequency Control
  frequency         NudgeFrequency  @default(WEEKLY)
  cooldownHours     Int             @default(24)    // Min hours between same nudge
  
  // Scheduling
  activeStartTime   DateTime?       // When nudge becomes active
  activeEndTime     DateTime?       // When nudge becomes inactive
  timeWindowStart   String?         // e.g., "09:00" - don't send before this
  timeWindowEnd     String?         // e.g., "22:00" - don't send after this
  
  // Status
  active            Boolean         @default(true)
  priority          Int             @default(0)     // Higher priority = sent first
  
  // Metadata
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  createdBy         Int?            // Admin who created it
  
  // Relations
  userNudges        UserNudge[]
  
  @@index([active, type])
  @@index([priority])
}

model UserNudge {
  id                Int             @id @default(autoincrement())
  userId            Int
  nudgeId           Int
  
  // Delivery Info
  sentAt            DateTime        @default(now())
  deliveredVia      String          @db.VarChar(20) // "websocket", "email", "failed"
  delivered         Boolean         @default(false)
  
  // Engagement
  opened            Boolean         @default(false)
  openedAt          DateTime?
  clicked           Boolean         @default(false)
  clickedAt         DateTime?
  dismissed         Boolean         @default(false)
  
  // Context Data (JSON)
  contextData       Json?           // e.g., { dealId: 123, distance: 450 }
  
  // Relations
  user              User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  nudge             Nudge           @relation(fields: [nudgeId], references: [id], onDelete: Cascade)
  
  @@index([userId, sentAt])
  @@index([nudgeId, sentAt])
  @@index([userId, nudgeId, sentAt])
  @@index([opened, clicked])
}

model UserNudgePreferences {
  id                    Int       @id @default(autoincrement())
  userId                Int       @unique
  
  // Global Settings
  enabled               Boolean   @default(true)
  
  // Per-Type Settings
  inactivityEnabled     Boolean   @default(true)
  nearbyDealEnabled     Boolean   @default(true)
  streakReminderEnabled Boolean   @default(true)
  happyHourAlertEnabled Boolean   @default(true)
  weatherBasedEnabled   Boolean   @default(true)
  
  // Quiet Hours
  quietHoursStart       String?   // e.g., "22:00"
  quietHoursEnd         String?   // e.g., "08:00"
  
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId, enabled])
}

// Add to existing User model:
model User {
  // ... existing fields ...
  userNudges            UserNudge[]
  nudgePreferences      UserNudgePreferences?
}
```

---

## 🛠️ IMPLEMENTATION STEPS

### **DAY 1: Foundation & Infrastructure**

#### **Step 1.1: Database Setup** ⏱️ 30 mins
- [ ] Add Nudge models to `prisma/schema.prisma`
- [ ] Run migration: `npx prisma migrate dev --name add_nudge_system`
- [ ] Seed initial nudges with `scripts/seed-nudges.ts`

#### **Step 1.2: Install Dependencies** ⏱️ 15 mins
```bash
npm install socket.io bull ioredis node-cron
npm install -D @types/bull
```

#### **Step 1.3: Redis Setup** ⏱️ 30 mins
- [ ] Add Redis to `docker-compose.yml` (if not exists)
- [ ] Create Redis client: `src/lib/redis.ts`
- [ ] Test connection

#### **Step 1.4: WebSocket Server Setup** ⏱️ 2 hours
- [ ] Create `src/lib/websocket/socket.server.ts`
- [ ] Create authentication middleware: `src/lib/websocket/auth.middleware.ts`
- [ ] Integrate with Express server in `src/index.ts`
- [ ] Track online users in Redis Set

**Files to Create:**
```
src/lib/redis.ts
src/lib/websocket/socket.server.ts
src/lib/websocket/auth.middleware.ts
src/lib/websocket/types.ts
```

---

### **DAY 2: Queue System & Nudge Service**

#### **Step 2.1: Queue Setup** ⏱️ 1.5 hours
- [ ] Create `src/lib/queue/nudge.queue.ts`
- [ ] Create queue processor with WebSocket + Email fallback
- [ ] Add retry logic (3 attempts with exponential backoff)
- [ ] Add queue monitoring dashboard (Bull Board)

#### **Step 2.2: Nudge Service** ⏱️ 3 hours
- [ ] Create `src/lib/nudge.service.ts`
- [ ] Implement core methods:
  - `canSendNudge(userId, nudgeType)` - Check frequency limits
  - `sendNudge(userId, nudgeId, contextData)` - Add to queue
  - `getUserNudgeHistory(userId)` - Get past nudges
  - `trackNudgeEngagement(userNudgeId, action)` - Track opens/clicks

#### **Step 2.3: Trigger Logic** ⏱️ 2 hours
- [ ] Create `src/lib/nudge-triggers/inactivity.trigger.ts`
- [ ] Create `src/lib/nudge-triggers/nearby-deal.trigger.ts`
- [ ] Create `src/lib/nudge-triggers/streak.trigger.ts`
- [ ] Create `src/lib/nudge-triggers/happy-hour.trigger.ts`
- [ ] Create `src/lib/nudge-triggers/weather.trigger.ts`

**Files to Create:**
```
src/lib/queue/nudge.queue.ts
src/lib/queue/queue-config.ts
src/lib/nudge.service.ts
src/lib/nudge-triggers/base.trigger.ts
src/lib/nudge-triggers/inactivity.trigger.ts
src/lib/nudge-triggers/nearby-deal.trigger.ts
src/lib/nudge-triggers/streak.trigger.ts
src/lib/nudge-triggers/happy-hour.trigger.ts
src/lib/nudge-triggers/weather.trigger.ts
```

---

### **DAY 3: Cron Jobs, API & Testing**

#### **Step 3.1: Cron Jobs** ⏱️ 2 hours
- [ ] Create `src/jobs/checkNudges.ts`
- [ ] Schedule jobs:
  - Every hour: Check inactivity, streaks
  - Every 15 mins: Check nearby deals, happy hours
  - Every 2 hours: Check weather
- [ ] Add job monitoring and error handling

#### **Step 3.2: API Endpoints** ⏱️ 2 hours
- [ ] Create `src/routes/nudges.routes.ts`:
  - `GET /api/nudges/history` - User's nudge history
  - `GET /api/nudges/preferences` - Get user preferences
  - `PUT /api/nudges/preferences` - Update preferences
  - `POST /api/nudges/:id/engage` - Track open/click/dismiss

- [ ] Create `src/routes/admin-nudges.routes.ts`:
  - `GET /admin/nudges` - List all nudge templates
  - `POST /admin/nudges` - Create new nudge
  - `PUT /admin/nudges/:id` - Update nudge
  - `DELETE /admin/nudges/:id` - Delete nudge
  - `POST /admin/nudges/:id/test/:userId` - Test send to user
  - `GET /admin/nudges/analytics` - Nudge performance metrics

#### **Step 3.3: Client Event Handlers** ⏱️ 1 hour
- [ ] Document client-side WebSocket events
- [ ] Create example React/Vue component
- [ ] Add engagement tracking on client

#### **Step 3.4: Testing** ⏱️ 2 hours
- [ ] Write tests: `tests/nudge.test.ts`
- [ ] Test WebSocket connection
- [ ] Test queue processing
- [ ] Test email fallback
- [ ] Test frequency limits
- [ ] End-to-end test for each nudge type

**Files to Create:**
```
src/jobs/checkNudges.ts
src/routes/nudges.routes.ts
src/routes/admin-nudges.routes.ts
tests/nudge.test.ts
scripts/seed-nudges.ts
```

---

## 📝 CODE EXAMPLES

### **1. WebSocket Server (`src/lib/websocket/socket.server.ts`)**

```typescript
import { Server, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { redis } from '../redis';
import { logger } from '../logging/logger';

export function setupWebSocket(httpServer: HTTPServer) {
  const io = new Server(httpServer, {
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
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      socket.data.userId = decoded.id;
      socket.data.email = decoded.email;
      
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.userId;
    logger.info(`User ${userId} connected via WebSocket`);

    // Join user-specific room
    socket.join(`user:${userId}`);

    // Track online status in Redis
    await redis.sadd('online_users', userId.toString());
    await redis.hset(`user:${userId}:socket`, 'socketId', socket.id);
    await redis.hset(`user:${userId}:socket`, 'connectedAt', Date.now());

    // Handle disconnection
    socket.on('disconnect', async () => {
      logger.info(`User ${userId} disconnected`);
      await redis.srem('online_users', userId.toString());
      await redis.del(`user:${userId}:socket`);
    });

    // Handle nudge engagement
    socket.on('nudge:opened', async (data: { userNudgeId: number }) => {
      await prisma.userNudge.update({
        where: { id: data.userNudgeId },
        data: { opened: true, openedAt: new Date() }
      });
    });

    socket.on('nudge:clicked', async (data: { userNudgeId: number }) => {
      await prisma.userNudge.update({
        where: { id: data.userNudgeId },
        data: { clicked: true, clickedAt: new Date() }
      });
    });

    socket.on('nudge:dismissed', async (data: { userNudgeId: number }) => {
      await prisma.userNudge.update({
        where: { id: data.userNudgeId },
        data: { dismissed: true }
      });
    });
  });

  return io;
}
```

### **2. Queue Processor (`src/lib/queue/nudge.queue.ts`)**

```typescript
import Queue from 'bull';
import { redis } from '../redis';
import { io } from '../websocket/socket.server';
import { sendEmail } from '../email';
import { logger } from '../logging/logger';
import { prisma } from '../prisma';

export const nudgeQueue = new Queue('nudges', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379')
  }
});

interface NudgeJobData {
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
            <div style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>${title}</h2>
              <p>${message}</p>
              <a href="${process.env.CLIENT_URL}/deals" 
                 style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
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
```

### **3. Nudge Service (`src/lib/nudge.service.ts`)**

```typescript
import { prisma } from './prisma';
import { nudgeQueue } from './queue/nudge.queue';
import { NudgeType, NudgeFrequency } from '@prisma/client';
import { logger } from './logging/logger';

export class NudgeService {
  /**
   * Check if a nudge can be sent to a user (frequency limits)
   */
  async canSendNudge(userId: number, nudgeId: number): Promise<boolean> {
    const nudge = await prisma.nudge.findUnique({
      where: { id: nudgeId }
    });

    if (!nudge || !nudge.active) {
      return false;
    }

    // Check user preferences
    const prefs = await prisma.userNudgePreferences.findUnique({
      where: { userId }
    });

    if (prefs && !prefs.enabled) {
      return false;
    }

    // Check type-specific preferences
    if (prefs) {
      const typeEnabled = this.isNudgeTypeEnabled(nudge.type, prefs);
      if (!typeEnabled) return false;
    }

    // Check frequency limits
    const lastNudge = await prisma.userNudge.findFirst({
      where: {
        userId,
        nudgeId,
        sentAt: {
          gte: new Date(Date.now() - nudge.cooldownHours * 60 * 60 * 1000)
        }
      },
      orderBy: { sentAt: 'desc' }
    });

    if (lastNudge) {
      logger.info(`Nudge ${nudgeId} blocked by cooldown for user ${userId}`);
      return false;
    }

    // Check time window
    if (nudge.timeWindowStart && nudge.timeWindowEnd) {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      
      if (currentTime < nudge.timeWindowStart || currentTime > nudge.timeWindowEnd) {
        logger.info(`Nudge ${nudgeId} blocked by time window for user ${userId}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Send a nudge to a user
   */
  async sendNudge(userId: number, nudgeId: number, contextData?: any): Promise<void> {
    const canSend = await this.canSendNudge(userId, nudgeId);
    if (!canSend) {
      logger.info(`Cannot send nudge ${nudgeId} to user ${userId}`);
      return;
    }

    const nudge = await prisma.nudge.findUnique({
      where: { id: nudgeId }
    });

    if (!nudge) {
      throw new Error(`Nudge ${nudgeId} not found`);
    }

    // Create UserNudge record
    const userNudge = await prisma.userNudge.create({
      data: {
        userId,
        nudgeId,
        contextData,
        delivered: false,
        deliveredVia: 'pending'
      }
    });

    // Add to queue for processing
    await nudgeQueue.add(
      {
        userId,
        nudgeId,
        nudgeType: nudge.type,
        title: nudge.title,
        message: nudge.message,
        contextData,
        userNudgeId: userNudge.id
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    );

    logger.info(`Nudge ${nudgeId} queued for user ${userId}`);
  }

  /**
   * Get user's nudge history
   */
  async getUserNudgeHistory(userId: number, limit = 50) {
    return prisma.userNudge.findMany({
      where: { userId },
      include: { nudge: true },
      orderBy: { sentAt: 'desc' },
      take: limit
    });
  }

  /**
   * Track nudge engagement
   */
  async trackEngagement(userNudgeId: number, action: 'opened' | 'clicked' | 'dismissed') {
    const data: any = { [action]: true };
    if (action === 'opened') data.openedAt = new Date();
    if (action === 'clicked') data.clickedAt = new Date();

    return prisma.userNudge.update({
      where: { id: userNudgeId },
      data
    });
  }

  private isNudgeTypeEnabled(type: NudgeType, prefs: any): boolean {
    const mapping = {
      INACTIVITY: prefs.inactivityEnabled,
      NEARBY_DEAL: prefs.nearbyDealEnabled,
      STREAK_REMINDER: prefs.streakReminderEnabled,
      HAPPY_HOUR_ALERT: prefs.happyHourAlertEnabled,
      WEATHER_BASED: prefs.weatherBasedEnabled
    };
    return mapping[type] ?? true;
  }
}

export const nudgeService = new NudgeService();
```

### **4. Cron Job (`src/jobs/checkNudges.ts`)**

```typescript
import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { nudgeService } from '../lib/nudge.service';
import { logger } from '../lib/logging/logger';

// Run every hour
export function startNudgeCronJobs() {
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
      
      const usersWithStreaks = await prisma.userStreak.findMany({
        where: {
          currentStreak: { gte: 3 },
          lastCheckInDate: { lt: yesterday }
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
      
      logger.info(`Checked ${usersWithStreaks.length} users with streaks`);
    } catch (error) {
      logger.error('Error in streak reminder job:', error);
    }
  });

  // Check nearby deals - every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('Running nearby deal check');
    // TODO: Implement geolocation-based nearby deal detection
    // This requires user location tracking which can be added later
  });

  // Check happy hour alerts - every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('Running happy hour alert check');
    
    try {
      const now = new Date();
      const in30Minutes = new Date(now.getTime() + 30 * 60 * 1000);
      
      // Find deals starting in the next 30 minutes
      const upcomingDeals = await prisma.deal.findMany({
        where: {
          startTime: {
            gte: now,
            lte: in30Minutes
          }
        },
        include: {
          merchant: true
        }
      });

      const happyHourNudge = await prisma.nudge.findFirst({
        where: { type: 'HAPPY_HOUR_ALERT', active: true }
      });

      if (happyHourNudge && upcomingDeals.length > 0) {
        // TODO: Send to users who have saved these deals or are nearby
        logger.info(`Found ${upcomingDeals.length} upcoming deals`);
      }
    } catch (error) {
      logger.error('Error in happy hour alert job:', error);
    }
  });

  logger.info('Nudge cron jobs started');
}
```

---

## 🧪 TESTING CHECKLIST

- [ ] WebSocket connection with valid JWT
- [ ] WebSocket connection with invalid JWT (should fail)
- [ ] WebSocket disconnection (Redis cleanup)
- [ ] Queue job processing (online user → WebSocket)
- [ ] Queue job processing (offline user → Email)
- [ ] Queue retry on failure
- [ ] Frequency limit enforcement
- [ ] Time window enforcement
- [ ] User preferences respected
- [ ] Each nudge type trigger logic
- [ ] Engagement tracking (open/click/dismiss)
- [ ] Admin API endpoints
- [ ] Cron job execution

---

## 📈 SUCCESS METRICS

### **Technical Metrics:**
- ✅ WebSocket delivery: < 100ms latency
- ✅ Queue processing: < 1000 jobs/second capacity
- ✅ Email fallback: < 5 second delivery
- ✅ 99.9% delivery success rate

### **Business Metrics:**
- 🎯 User retention: +30% (Week 2 vs Week 1)
- 🎯 Check-in frequency: +25%
- 🎯 Nudge open rate: > 40%
- 🎯 Nudge click rate: > 15%
- 🎯 Opt-out rate: < 5%

---

## 🚀 DEPLOYMENT CHECKLIST

- [ ] Redis running in production
- [ ] WebSocket server configured with CORS
- [ ] Environment variables set:
  - `REDIS_HOST`
  - `REDIS_PORT`
  - `CLIENT_URL` (for WebSocket CORS)
- [ ] Bull dashboard exposed (optional, for monitoring)
- [ ] Cron jobs registered
- [ ] Email service configured
- [ ] Database migrations applied
- [ ] Initial nudges seeded

---

## 📚 CLIENT-SIDE INTEGRATION EXAMPLE

```typescript
// React/Vue/Mobile component
import io from 'socket.io-client';
import { useEffect, useState } from 'react';

function useNudges() {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('jwt');
    
    const socketInstance = io('http://localhost:3000', {
      auth: { token }
    });

    socketInstance.on('connect', () => {
      console.log('Connected to nudge system');
    });

    socketInstance.on('nudge', (data) => {
      // Show toast notification
      showToast({
        title: data.title,
        message: data.message,
        type: data.type,
        onClick: () => {
          // Track click
          socketInstance.emit('nudge:clicked', { userNudgeId: data.id });
          
          // Navigate based on type
          if (data.data?.dealId) {
            router.push(`/deals/${data.data.dealId}`);
          }
        },
        onDismiss: () => {
          socketInstance.emit('nudge:dismissed', { userNudgeId: data.id });
        }
      });

      // Track opened
      socketInstance.emit('nudge:opened', { userNudgeId: data.id });
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  return socket;
}
```

---

## 🎯 NEXT STEPS AFTER PHASE 1

1. **P1.2: Check-in Surprises** - Random rewards on check-in
2. **P1.3: Enhanced Bounty System** - Group check-ins with friends
3. **P1.4: "Guess the Kitty" Game** - Venue prize pool game

---

## 📞 SUPPORT & TROUBLESHOOTING

### **Common Issues:**

**Issue:** WebSocket connections failing
- Check CORS configuration
- Verify JWT token is being sent
- Check firewall/proxy settings

**Issue:** Nudges not being delivered
- Check Redis connection
- Check Bull queue is running
- Check email service configuration
- View logs: `docker logs -f <container>`

**Issue:** Too many nudges being sent
- Review frequency settings in Nudge table
- Check cooldownHours values
- Review user preferences

---

**Ready to start implementation!** 🚀
