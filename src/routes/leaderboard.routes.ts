import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { getLeaderboard } from '../lib/leaderboard/leaderboard';
import prisma from '../lib/prisma';

const router = Router();

// Optional auth: attaches user if token valid; silently continues if not.
async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer')) return next();
  const token = header.split(' ')[1];
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return next();
  try {
    const jwtLib = (await import('jsonwebtoken')).default;
    const decoded: any = jwtLib.verify(token, jwtSecret) as { userId: number; email: string };
    req.user = { id: decoded.userId, email: decoded.email };
  } catch { /* ignore */ }
  next();
}

// GET /api/leaderboard
router.get('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { period, limit, includeSelf, year, month, from, to, showMore, includeBreakdown } = req.query;
    const selfUserId = req.user?.id;

    // Default to 5 entries unless showMore is true or limit is explicitly set
    const showMoreBool = showMore === 'true';
    const defaultLimit = showMoreBool ? 50 : 5;
    const limitNum = limit ? parseInt(String(limit), 10) : defaultLimit;
    const includeSelfBool = includeSelf === undefined ? true : String(includeSelf).toLowerCase() === 'true';
    const includeBreakdownBool = includeBreakdown === 'true';

    const yearNum = year ? parseInt(String(year), 10) : undefined;
    const monthNum = month ? parseInt(String(month), 10) : undefined;

    const result = await getLeaderboard({
      period: period as string | undefined,
      limit: limitNum,
      includeSelf: includeSelfBool,
      selfUserId,
      year: yearNum,
      month: monthNum,
      from: from as string | undefined,
      to: to as string | undefined,
    });

    // Get point breakdowns for all users if requested
    let pointBreakdowns: Record<number, Array<{ eventType: string; eventTypeName: string; points: number; count: number }>> = {};
    if (includeBreakdownBool && result.top) {
      const userIds = result.top.map(u => u.userId);
      if (result.me && !result.me.inTop) {
        userIds.push(result.me.userId);
      }

      // Resolve period dates
      const { resolvePeriod } = await import('../lib/leaderboard/period');
      const periodData = resolvePeriod({
        period: period as string | undefined,
        year: yearNum,
        month: monthNum,
        from: from as string | undefined,
        to: to as string | undefined,
      });

      // Get point breakdown grouped by event type for all users
      // Use Prisma's IN query for better compatibility
      const breakdownData = await prisma.userPointEvent.groupBy({
        by: ['userId', 'pointEventTypeId'],
        where: {
          userId: { in: userIds },
          createdAt: {
            gte: periodData.start,
            lt: periodData.endExclusive,
          },
        },
        _sum: {
          points: true,
        },
        _count: {
          id: true,
        },
      });

      // Fetch event type names
      const eventTypeIds = [...new Set(breakdownData.map(d => d.pointEventTypeId))];
      const eventTypes = await prisma.pointEventTypeMaster.findMany({
        where: { id: { in: eventTypeIds } },
        select: { id: true, name: true },
      });
      const eventTypeMap = new Map(eventTypes.map(et => [et.id, et.name]));

      // Transform to the expected format
      const formattedBreakdown = breakdownData.map((row) => ({
        userId: row.userId,
        eventTypeName: eventTypeMap.get(row.pointEventTypeId) || 'Unknown',
        eventTypeId: row.pointEventTypeId,
        totalPoints: row._sum.points || 0,
        eventCount: row._count.id,
      }));

      // Group by userId
      formattedBreakdown.forEach((row) => {
        if (!pointBreakdowns[row.userId]) {
          pointBreakdowns[row.userId] = [];
        }
        pointBreakdowns[row.userId].push({
          eventType: row.eventTypeName,
          eventTypeName: row.eventTypeName,
          points: row.totalPoints,
          count: row.eventCount,
        });
      });
    }

    // Add pagination metadata
    const response: any = {
      ...result,
      pagination: {
        defaultLimit: 5,
        currentLimit: limitNum,
        showMore: showMoreBool,
        hasMore: limitNum < 50 && result.top && result.top.length >= limitNum
      }
    };

    if (includeBreakdownBool) {
      response.pointBreakdowns = pointBreakdowns;
    }

    res.status(200).json(response);
  } catch (e: any) {
    if (/period/i.test(e.message) || /custom period/i.test(e.message) || /limit/i.test(e.message) || /month must be/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    console.error('Leaderboard error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to calculate date ranges
function calculateDateRange(period: string): { from: Date; to: Date } {
  const now = new Date();
  let from: Date, to: Date;

  switch (period) {
    case 'today':
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      break;
    case 'this_week':
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      from = startOfWeek;
      to = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    case 'this_month':
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      break;
    case 'this_quarter':
      const quarterStart = Math.floor(now.getMonth() / 3) * 3;
      from = new Date(now.getFullYear(), quarterStart, 1);
      to = new Date(now.getFullYear(), quarterStart + 3, 1);
      break;
    case 'this_year':
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now.getFullYear() + 1, 0, 1);
      break;
    case 'last_7_days':
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      to = now;
      break;
    case 'last_30_days':
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      to = now;
      break;
    case 'last_90_days':
      from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      to = now;
      break;
    default:
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      to = now;
  }

  return { from, to };
}

// Helper function to get merchant IDs for a city
async function getMerchantIdsForCity(cityId: number): Promise<number[]> {
  const stores = await prisma.store.findMany({
    where: { cityId, active: true },
    select: { merchantId: true }
  });
  return [...new Set(stores.map(store => store.merchantId))];
}

// GET /api/leaderboard/global - Enhanced global leaderboard with detailed analytics
router.get('/global', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const startTime = Date.now();
    const { 
      period = 'last_30_days', 
      limit, 
      includeSelf = 'true',
      includeStats = 'true',
      showMore
    } = req.query as any;
    
    const selfUserId = req.user?.id;
    
    // Default to 5 entries unless showMore is true or limit is explicitly set
    const showMoreBool = showMore === 'true';
    const defaultLimit = showMoreBool ? 50 : 5;
    const limitNum = Math.min(parseInt(limit) || defaultLimit, 100);
    const includeSelfBool = includeSelf === 'true';
    const includeStatsBool = includeStats === 'true';

    const { from, to } = calculateDateRange(period);

    // Get global leaderboard data
    const leaderboardData = await prisma.$queryRawUnsafe(`
      SELECT 
        u.id as "userId",
        u.name,
        u.email,
        u.points as "totalPoints",
        u."monthlyPoints",
        u."avatarUrl",
        u."createdAt" as "memberSince",
        COALESCE(SUM(e.points), 0) as "periodPoints",
        COUNT(e.id) as "eventCount",
        COUNT(DISTINCT c.id) as "checkInCount",
        COUNT(DISTINCT c."dealId") as "uniqueDealsCheckedIn"
      FROM "User" u
      LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
        AND e."createdAt" >= $1 AND e."createdAt" <= $2
      LEFT JOIN "CheckIn" c ON u.id = c."userId" 
        AND c."createdAt" >= $1 AND c."createdAt" <= $2
      WHERE u.role = 'USER'
      GROUP BY u.id, u.name, u.email, u.points, u."monthlyPoints", u."avatarUrl", u."createdAt"
      ORDER BY "periodPoints" DESC, u.id ASC
      LIMIT $3
    `, from, to, limitNum);

    // Get user's personal position if authenticated
    let personalPosition = null;
    if (selfUserId && includeSelfBool) {
      const personalData = await prisma.$queryRawUnsafe(`
        SELECT 
          u.id as "userId",
          u.name,
          u.email,
          u.points as "totalPoints",
          u."monthlyPoints",
          u."avatarUrl",
          COALESCE(SUM(e.points), 0) as "periodPoints",
          COUNT(e.id) as "eventCount",
          COUNT(DISTINCT c.id) as "checkInCount",
          COUNT(DISTINCT c."dealId") as "uniqueDealsCheckedIn"
        FROM "User" u
        LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
          AND e."createdAt" >= $1 AND e."createdAt" <= $2
        LEFT JOIN "CheckIn" c ON u.id = c."userId" 
          AND c."createdAt" >= $1 AND c."createdAt" <= $2
        WHERE u.id = $3
        GROUP BY u.id, u.name, u.email, u.points, u."monthlyPoints", u."avatarUrl"
      `, from, to, selfUserId);

      if (personalData && (personalData as any[]).length > 0) {
        const personal = (personalData as any[])[0] as any;
        
        // Calculate rank
        const rankQuery = await prisma.$queryRawUnsafe(`
          SELECT COUNT(*) + 1 as rank
          FROM (
            SELECT u.id, COALESCE(SUM(e.points), 0) as "periodPoints"
            FROM "User" u
            LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
              AND e."createdAt" >= $1 AND e."createdAt" <= $2
            WHERE u.role = 'USER'
            GROUP BY u.id
            HAVING COALESCE(SUM(e.points), 0) > $3
          ) t
        `, from, to, personal.periodPoints);

        personalPosition = {
          ...personal,
          rank: Number((rankQuery as any[])[0]?.rank || 1),
          inTop: false
        };
      }
    }

    // Get global statistics if requested
    let globalStats = null;
    if (includeStatsBool) {
      const statsData = await prisma.$queryRawUnsafe(`
        WITH user_period_points AS (
          SELECT 
            u.id,
            COALESCE(SUM(e.points), 0) as "periodPoints"
          FROM "User" u
          LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
            AND e."createdAt" >= $1 AND e."createdAt" <= $2
          WHERE u.role = 'USER'
          GROUP BY u.id
        )
        SELECT 
          COUNT(*) as "totalUsers",
          COUNT(CASE WHEN "periodPoints" > 0 THEN 1 END) as "activeUsers",
          AVG("periodPoints") as "avgPointsPerUser",
          MAX("periodPoints") as "maxPoints",
          MIN("periodPoints") as "minPoints",
          SUM("periodPoints") as "totalPointsEarned",
          (SELECT COUNT(DISTINCT c.id) FROM "CheckIn" c WHERE c."createdAt" >= $1 AND c."createdAt" <= $2) as "totalCheckIns",
          (SELECT COUNT(DISTINCT c."dealId") FROM "CheckIn" c WHERE c."createdAt" >= $1 AND c."createdAt" <= $2) as "uniqueDealsUsed"
        FROM user_period_points
      `, from, to);

      // Get point distribution percentiles
      const percentileData = await prisma.$queryRawUnsafe(`
        WITH user_points AS (
          SELECT COALESCE(SUM(e.points), 0) as "periodPoints"
          FROM "User" u
          LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
            AND e."createdAt" >= $1 AND e."createdAt" <= $2
          WHERE u.role = 'USER'
          GROUP BY u.id
        )
        SELECT 
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "periodPoints") as "p25",
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "periodPoints") as "p50",
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "periodPoints") as "p75",
          PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY "periodPoints") as "p90",
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "periodPoints") as "p95",
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY "periodPoints") as "p99"
        FROM user_points
      `, from, to);

      globalStats = {
        ...(statsData as any[])[0],
        distribution: (percentileData as any[])[0]
      };
    }

    // Format leaderboard with rankings
    const formattedLeaderboard = (leaderboardData as any[]).map((user, index) => ({
      rank: index + 1,
      userId: user.userId,
      name: user.name || 'Anonymous',
      email: user.email,
      avatarUrl: user.avatarUrl,
      totalPoints: Number(user.totalPoints),
      periodPoints: Number(user.periodPoints),
      monthlyPoints: Number(user.monthlyPoints),
      eventCount: Number(user.eventCount),
      checkInCount: Number(user.checkInCount),
      uniqueDealsCheckedIn: Number(user.uniqueDealsCheckedIn),
      memberSince: user.memberSince.toISOString().split('T')[0],
      inTop: true
    }));

    const response = {
      success: true,
      period,
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      leaderboard: formattedLeaderboard,
      personalPosition,
      globalStats,
      pagination: {
        defaultLimit: 5,
        currentLimit: limitNum,
        showMore: showMoreBool,
        hasMore: limitNum < 100 && formattedLeaderboard.length >= limitNum
      },
      metadata: {
        totalShown: formattedLeaderboard.length,
        limit: limitNum,
        includeSelf: includeSelfBool,
        includeStats: includeStatsBool,
        queryTime: Date.now() - startTime
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Global leaderboard error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: 'Failed to fetch global leaderboard'
    });
  }
});

// GET /api/leaderboard/cities - City comparison leaderboard
router.get('/cities', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const startTime = Date.now();
    const { 
      period = 'last_30_days', 
      limit,
      includeInactive = 'false',
      showMore
    } = req.query as any;

    // Default to 5 entries unless showMore is true or limit is explicitly set
    const showMoreBool = showMore === 'true';
    const defaultLimit = showMoreBool ? 20 : 5;
    const limitNum = Math.min(parseInt(limit) || defaultLimit, 50);
    const includeInactiveBool = includeInactive === 'true';
    const { from, to } = calculateDateRange(period);

    // Get city leaderboard data
    const cityData = await prisma.$queryRawUnsafe(`
      SELECT 
        c.id as "cityId",
        c.name as "cityName",
        c.state,
        c.active,
        COUNT(DISTINCT u.id) as "totalUsers",
        COUNT(DISTINCT CASE WHEN COALESCE(SUM(e.points), 0) > 0 THEN u.id END) as "activeUsers",
        AVG(COALESCE(SUM(e.points), 0)) as "avgPointsPerUser",
        MAX(COALESCE(SUM(e.points), 0)) as "maxPoints",
        SUM(COALESCE(SUM(e.points), 0)) as "totalPointsEarned",
        COUNT(DISTINCT c2.id) as "totalCheckIns",
        COUNT(DISTINCT c2."dealId") as "uniqueDealsUsed",
        COUNT(DISTINCT st."merchantId") as "activeMerchants"
      FROM "City" c
      LEFT JOIN "Store" st ON c.id = st."cityId" AND st.active = true
      LEFT JOIN "Merchant" m ON st."merchantId" = m.id AND m.status = 'APPROVED'
      LEFT JOIN "CheckIn" c2 ON m.id = c2."merchantId" 
        AND c2."createdAt" >= $1 AND c2."createdAt" <= $2
      LEFT JOIN "User" u ON c2."userId" = u.id AND u.role = 'USER'
      LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
        AND e."createdAt" >= $1 AND e."createdAt" <= $2
      WHERE ${includeInactiveBool ? '1=1' : 'c.active = true'}
      GROUP BY c.id, c.name, c.state, c.active
      HAVING COUNT(DISTINCT u.id) > 0
      ORDER BY "totalPointsEarned" DESC, "activeUsers" DESC
      LIMIT $3
    `, from, to, limitNum);

    // Format city leaderboard
    const formattedCities = (cityData as any[]).map((city, index) => ({
      rank: index + 1,
      cityId: city.cityId,
      cityName: city.cityName,
      state: city.state,
      active: city.active,
      totalUsers: Number(city.totalUsers),
      activeUsers: Number(city.activeUsers),
      avgPointsPerUser: Number(city.avgPointsPerUser || 0),
      maxPoints: Number(city.maxPoints || 0),
      totalPointsEarned: Number(city.totalPointsEarned || 0),
      totalCheckIns: Number(city.totalCheckIns || 0),
      uniqueDealsUsed: Number(city.uniqueDealsUsed || 0),
      activeMerchants: Number(city.activeMerchants || 0),
      engagementRate: city.totalUsers > 0 ? (city.activeUsers / city.totalUsers) : 0
    }));

    res.status(200).json({
      success: true,
      period,
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      cities: formattedCities,
      pagination: {
        defaultLimit: 5,
        currentLimit: limitNum,
        showMore: showMoreBool,
        hasMore: limitNum < 50 && formattedCities.length >= limitNum
      },
      metadata: {
        totalShown: formattedCities.length,
        limit: limitNum,
        includeInactive: includeInactiveBool,
        queryTime: Date.now() - startTime
      }
    });

  } catch (error) {
    console.error('City leaderboard error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: 'Failed to fetch city leaderboard'
    });
  }
});

// GET /api/leaderboard/cities/:cityId - Specific city detailed leaderboard
router.get('/cities/:cityId', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const startTime = Date.now();
    const cityId = parseInt(req.params.cityId);
    const { 
      period = 'last_30_days', 
      limit, 
      includeSelf = 'true',
      includeStats = 'true',
      showMore
    } = req.query as any;

    if (isNaN(cityId)) {
      return res.status(400).json({ error: 'Invalid city ID' });
    }

    // Default to 5 entries unless showMore is true or limit is explicitly set
    const showMoreBool = showMore === 'true';
    const defaultLimit = showMoreBool ? 50 : 5;
    const limitNum = Math.min(parseInt(limit) || defaultLimit, 100);
    const includeSelfBool = includeSelf === 'true';
    const includeStatsBool = includeStats === 'true';
    const selfUserId = req.user?.id;
    const { from, to } = calculateDateRange(period);

    // Get city information
    const city = await prisma.city.findUnique({
      where: { id: cityId },
      select: { id: true, name: true, state: true, active: true }
    });

    if (!city) {
      return res.status(404).json({ error: 'City not found' });
    }

    // Get merchant IDs for this city
    const merchantIds = await getMerchantIdsForCity(cityId);

    if (merchantIds.length === 0) {
      return res.status(200).json({
        success: true,
        period,
        dateRange: { from: from.toISOString(), to: to.toISOString() },
        city: { ...city, activeMerchants: 0 },
        leaderboard: [],
        personalPosition: null,
        cityStats: null,
        metadata: { message: 'No active merchants found in this city' }
      });
    }

    // Get city leaderboard data
    const leaderboardData = await prisma.$queryRawUnsafe(`
      SELECT 
        u.id as "userId",
        u.name,
        u.email,
        u.points as "totalPoints",
        u."monthlyPoints",
        u."avatarUrl",
        u."createdAt" as "memberSince",
        COALESCE(SUM(e.points), 0) as "periodPoints",
        COUNT(e.id) as "eventCount",
        COUNT(DISTINCT c.id) as "checkInCount",
        COUNT(DISTINCT c."dealId") as "uniqueDealsCheckedIn",
        COUNT(DISTINCT c."merchantId") as "uniqueMerchantsVisited"
      FROM "User" u
      LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
        AND e."createdAt" >= $1 AND e."createdAt" <= $2
      LEFT JOIN "CheckIn" c ON u.id = c."userId" 
        AND c."merchantId" = ANY($3)
        AND c."createdAt" >= $1 AND c."createdAt" <= $2
      WHERE u.role = 'USER'
      GROUP BY u.id, u.name, u.email, u.points, u."monthlyPoints", u."avatarUrl", u."createdAt"
      ORDER BY "periodPoints" DESC, u.id ASC
      LIMIT $4
    `, from, to, merchantIds, limitNum);

    // Get personal position if authenticated
    let personalPosition = null;
    if (selfUserId && includeSelfBool) {
      const personalData = await prisma.$queryRawUnsafe(`
        SELECT 
          u.id as "userId",
          u.name,
          u.email,
          u.points as "totalPoints",
          u."monthlyPoints",
          u."avatarUrl",
          COALESCE(SUM(e.points), 0) as "periodPoints",
          COUNT(e.id) as "eventCount",
          COUNT(DISTINCT c.id) as "checkInCount",
          COUNT(DISTINCT c."dealId") as "uniqueDealsCheckedIn",
          COUNT(DISTINCT c."merchantId") as "uniqueMerchantsVisited"
        FROM "User" u
        LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
          AND e."createdAt" >= $1 AND e."createdAt" <= $2
        LEFT JOIN "CheckIn" c ON u.id = c."userId" 
          AND c."merchantId" = ANY($3)
          AND c."createdAt" >= $1 AND c."createdAt" <= $2
        WHERE u.id = $4
        GROUP BY u.id, u.name, u.email, u.points, u."monthlyPoints", u."avatarUrl"
      `, from, to, merchantIds, selfUserId);

      if (personalData && (personalData as any[]).length > 0) {
        const personal = (personalData as any[])[0] as any;
        
        // Calculate rank within city
        const rankQuery = await prisma.$queryRawUnsafe(`
          SELECT COUNT(*) + 1 as rank
          FROM (
            SELECT u.id, COALESCE(SUM(e.points), 0) as "periodPoints"
            FROM "User" u
            LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
              AND e."createdAt" >= $1 AND e."createdAt" <= $2
            WHERE u.role = 'USER'
            GROUP BY u.id
            HAVING COALESCE(SUM(e.points), 0) > $3
          ) t
        `, from, to, personal.periodPoints);

        personalPosition = {
          ...personal,
          rank: Number((rankQuery as any[])[0]?.rank || 1),
          inTop: false
        };
      }
    }

    // Get city statistics if requested
    let cityStats = null;
    if (includeStatsBool) {
      const statsData = await prisma.$queryRawUnsafe(`
        SELECT 
          COUNT(DISTINCT u.id) as "totalUsers",
          COUNT(DISTINCT CASE WHEN COALESCE(SUM(e.points), 0) > 0 THEN u.id END) as "activeUsers",
          AVG(COALESCE(SUM(e.points), 0)) as "avgPointsPerUser",
          MAX(COALESCE(SUM(e.points), 0)) as "maxPoints",
          SUM(COALESCE(SUM(e.points), 0)) as "totalPointsEarned",
          COUNT(DISTINCT c.id) as "totalCheckIns",
          COUNT(DISTINCT c."dealId") as "uniqueDealsUsed",
          COUNT(DISTINCT c."merchantId") as "uniqueMerchantsUsed"
        FROM "User" u
        LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
          AND e."createdAt" >= $1 AND e."createdAt" <= $2
        LEFT JOIN "CheckIn" c ON u.id = c."userId" 
          AND c."merchantId" = ANY($3)
          AND c."createdAt" >= $1 AND c."createdAt" <= $2
        WHERE u.role = 'USER'
        GROUP BY u.id
      `, from, to, merchantIds);

      cityStats = (statsData as any[])[0];
    }

    // Format leaderboard
    const formattedLeaderboard = (leaderboardData as any[]).map((user, index) => ({
      rank: index + 1,
      userId: user.userId,
      name: user.name || 'Anonymous',
      email: user.email,
      avatarUrl: user.avatarUrl,
      totalPoints: Number(user.totalPoints),
      periodPoints: Number(user.periodPoints),
      monthlyPoints: Number(user.monthlyPoints),
      eventCount: Number(user.eventCount),
      checkInCount: Number(user.checkInCount),
      uniqueDealsCheckedIn: Number(user.uniqueDealsCheckedIn),
      uniqueMerchantsVisited: Number(user.uniqueMerchantsVisited),
      memberSince: user.memberSince.toISOString().split('T')[0],
      inTop: true
    }));

    res.status(200).json({
      success: true,
      period,
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      city: { ...city, activeMerchants: merchantIds.length },
      leaderboard: formattedLeaderboard,
      personalPosition,
      cityStats,
      pagination: {
        defaultLimit: 5,
        currentLimit: limitNum,
        showMore: showMoreBool,
        hasMore: limitNum < 100 && formattedLeaderboard.length >= limitNum
      },
      metadata: {
        totalShown: formattedLeaderboard.length,
        limit: limitNum,
        includeSelf: includeSelfBool,
        includeStats: includeStatsBool,
        queryTime: Date.now() - startTime
      }
    });

  } catch (error) {
    console.error('City leaderboard error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: 'Failed to fetch city leaderboard'
    });
  }
});

// GET /api/leaderboard/analytics - Point distribution and advanced analytics
router.get('/analytics', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const startTime = Date.now();
    const { 
      period = 'last_30_days',
      cityId,
      includeDistribution = 'true',
      includeTrends = 'true'
    } = req.query as any;

    const { from, to } = calculateDateRange(period);
    const includeDistributionBool = includeDistribution === 'true';
    const includeTrendsBool = includeTrends === 'true';

    let whereClause = 'WHERE u.role = \'USER\'';
    let params: any[] = [from, to];
    let paramIndex = 3;

    if (cityId) {
      const merchantIds = await getMerchantIdsForCity(parseInt(cityId));
      if (merchantIds.length === 0) {
        return res.status(200).json({
          success: true,
          period,
          dateRange: { from: from.toISOString(), to: to.toISOString() },
          analytics: null,
          message: 'No active merchants found in this city'
        });
      }
      whereClause += ` AND EXISTS (
        SELECT 1 FROM "CheckIn" c2 
        WHERE c2."userId" = u.id 
        AND c2."merchantId" = ANY($${paramIndex})
        AND c2."createdAt" >= $1 AND c2."createdAt" <= $2
      )`;
      params.push(merchantIds);
      paramIndex++;
    }

    // Get comprehensive analytics
    const analyticsData = await prisma.$queryRawUnsafe(`
      WITH user_analytics AS (
        SELECT 
          u.id,
          u.name,
          u."createdAt" as "memberSince",
          COALESCE(SUM(e.points), 0) as "periodPoints",
          COUNT(e.id) as "eventCount",
          COUNT(DISTINCT c.id) as "checkInCount",
          COUNT(DISTINCT c."dealId") as "uniqueDealsCheckedIn",
          COUNT(DISTINCT c."merchantId") as "uniqueMerchantsVisited",
          COUNT(DISTINCT d."categoryId") as "categoriesUsed"
        FROM "User" u
        LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
          AND e."createdAt" >= $1 AND e."createdAt" <= $2
        LEFT JOIN "CheckIn" c ON u.id = c."userId" 
          AND c."createdAt" >= $1 AND c."createdAt" <= $2
        LEFT JOIN "Deal" d ON c."dealId" = d.id
        ${whereClause}
        GROUP BY u.id, u.name, u."createdAt"
      )
      SELECT 
        COUNT(*) as "totalUsers",
        COUNT(CASE WHEN "periodPoints" > 0 THEN 1 END) as "activeUsers",
        COUNT(CASE WHEN "periodPoints" = 0 THEN 1 END) as "inactiveUsers",
        AVG("periodPoints") as "avgPoints",
        MEDIAN("periodPoints") as "medianPoints",
        MAX("periodPoints") as "maxPoints",
        MIN("periodPoints") as "minPoints",
        STDDEV("periodPoints") as "stdDevPoints",
        AVG("eventCount") as "avgEvents",
        AVG("checkInCount") as "avgCheckIns",
        AVG("uniqueDealsCheckedIn") as "avgUniqueDeals",
        AVG("uniqueMerchantsVisited") as "avgUniqueMerchants",
        AVG("categoriesUsed") as "avgCategoriesUsed",
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "periodPoints") as "p25",
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "periodPoints") as "p50",
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "periodPoints") as "p75",
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY "periodPoints") as "p90",
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "periodPoints") as "p95",
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY "periodPoints") as "p99"
      FROM user_analytics
    `, ...params);

    // Get point distribution histogram if requested
    let distributionHistogram = null;
    if (includeDistributionBool) {
      const histogramData = await prisma.$queryRawUnsafe(`
        WITH user_points AS (
          SELECT COALESCE(SUM(e.points), 0) as "periodPoints"
          FROM "User" u
          LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
            AND e."createdAt" >= $1 AND e."createdAt" <= $2
          ${whereClause}
          GROUP BY u.id
        ),
        point_ranges AS (
          SELECT 
            CASE 
              WHEN "periodPoints" = 0 THEN '0'
              WHEN "periodPoints" BETWEEN 1 AND 10 THEN '1-10'
              WHEN "periodPoints" BETWEEN 11 AND 25 THEN '11-25'
              WHEN "periodPoints" BETWEEN 26 AND 50 THEN '26-50'
              WHEN "periodPoints" BETWEEN 51 AND 100 THEN '51-100'
              WHEN "periodPoints" BETWEEN 101 AND 250 THEN '101-250'
              WHEN "periodPoints" BETWEEN 251 AND 500 THEN '251-500'
              WHEN "periodPoints" BETWEEN 501 AND 1000 THEN '501-1000'
              ELSE '1000+'
            END as "pointRange",
            COUNT(*) as "userCount"
          FROM user_points
          GROUP BY 
            CASE 
              WHEN "periodPoints" = 0 THEN '0'
              WHEN "periodPoints" BETWEEN 1 AND 10 THEN '1-10'
              WHEN "periodPoints" BETWEEN 11 AND 25 THEN '11-25'
              WHEN "periodPoints" BETWEEN 26 AND 50 THEN '26-50'
              WHEN "periodPoints" BETWEEN 51 AND 100 THEN '51-100'
              WHEN "periodPoints" BETWEEN 101 AND 250 THEN '101-250'
              WHEN "periodPoints" BETWEEN 251 AND 500 THEN '251-500'
              WHEN "periodPoints" BETWEEN 501 AND 1000 THEN '501-1000'
              ELSE '1000+'
            END
        )
        SELECT "pointRange", "userCount"
        FROM point_ranges
        ORDER BY 
          CASE "pointRange"
            WHEN '0' THEN 1
            WHEN '1-10' THEN 2
            WHEN '11-25' THEN 3
            WHEN '26-50' THEN 4
            WHEN '51-100' THEN 5
            WHEN '101-250' THEN 6
            WHEN '251-500' THEN 7
            WHEN '501-1000' THEN 8
            WHEN '1000+' THEN 9
          END
      `, ...params);

      distributionHistogram = histogramData;
    }

    // Get trend data if requested
    let trendData = null;
    if (includeTrendsBool) {
      const trendQuery = await prisma.$queryRawUnsafe(`
        WITH daily_stats AS (
          SELECT 
            DATE(e."createdAt") as "date",
            COUNT(DISTINCT u.id) as "activeUsers",
            COUNT(e.id) as "totalEvents",
            SUM(e.points) as "totalPointsEarned",
            COUNT(DISTINCT c.id) as "totalCheckIns"
          FROM "User" u
          LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
            AND e."createdAt" >= $1 AND e."createdAt" <= $2
          LEFT JOIN "CheckIn" c ON u.id = c."userId" 
            AND c."createdAt" >= $1 AND c."createdAt" <= $2
          ${whereClause}
          GROUP BY DATE(e."createdAt")
          ORDER BY "date"
        )
        SELECT 
          "date",
          "activeUsers",
          "totalEvents",
          "totalPointsEarned",
          "totalCheckIns",
          AVG("activeUsers") OVER (ORDER BY "date" ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as "avgActiveUsers7d",
          AVG("totalPointsEarned") OVER (ORDER BY "date" ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as "avgPointsEarned7d"
        FROM daily_stats
      `, ...params);

      trendData = trendQuery;
    }

    const analytics = {
      summary: (analyticsData as any[])[0],
      distribution: distributionHistogram,
      trends: trendData
    };

    res.status(200).json({
      success: true,
      period,
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      cityId: cityId ? parseInt(cityId) : null,
      analytics,
      metadata: {
        includeDistribution: includeDistributionBool,
        includeTrends: includeTrendsBool,
        queryTime: Date.now() - startTime
      }
    });

  } catch (error) {
    console.error('Leaderboard analytics error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: 'Failed to fetch leaderboard analytics'
    });
  }
});

// GET /api/leaderboard/categories - Category-based leaderboards
router.get('/categories', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const startTime = Date.now();
    const { 
      period = 'last_30_days',
      categoryId,
      limit,
      showMore
    } = req.query as any;

    const { from, to } = calculateDateRange(period);
    
    // Default to 5 entries unless showMore is true or limit is explicitly set
    const showMoreBool = showMore === 'true';
    const defaultLimit = showMoreBool ? 20 : 5;
    const limitNum = Math.min(parseInt(limit) || defaultLimit, 50);

    let whereClause = 'WHERE u.role = \'USER\'';
    let params: any[] = [from, to];
    let paramIndex = 3;

    if (categoryId) {
      whereClause += ` AND d."categoryId" = $${paramIndex}`;
      params.push(parseInt(categoryId));
      paramIndex++;
    }

    // Get category leaderboard data
    const categoryData = await prisma.$queryRawUnsafe(`
      WITH category_stats AS (
        SELECT 
          u.id as "userId",
          u.name,
          u.email,
          u."avatarUrl",
          u.points as "totalPoints",
          u."monthlyPoints",
          d."categoryId",
          dc.name as "categoryName",
          dc.color as "categoryColor",
          COALESCE(SUM(e.points), 0) as "periodPoints",
          COUNT(DISTINCT e.id) as "eventCount",
          COUNT(DISTINCT c.id) as "checkInCount",
          COUNT(DISTINCT c."dealId") as "uniqueDealsCheckedIn"
        FROM "User" u
        LEFT JOIN "CheckIn" c ON u.id = c."userId" 
          AND c."createdAt" >= $1 AND c."createdAt" <= $2
        LEFT JOIN "Deal" d ON c."dealId" = d.id
        LEFT JOIN "DealCategoryMaster" dc ON d."categoryId" = dc.id
        LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
          AND e."createdAt" >= $1 AND e."createdAt" <= $2
          AND e."dealId" = d.id
        ${whereClause}
        GROUP BY u.id, u.name, u.email, u."avatarUrl", u.points, u."monthlyPoints", d."categoryId", dc.name, dc.color
      ),
      category_rankings AS (
        SELECT 
          *,
          ROW_NUMBER() OVER (PARTITION BY "categoryId" ORDER BY "periodPoints" DESC, "userId" ASC) as "categoryRank"
        FROM category_stats
      )
      SELECT 
        "categoryId",
        "categoryName",
        "categoryColor",
        "userId",
        "name",
        "email",
        "avatarUrl",
        "totalPoints",
        "monthlyPoints",
        "periodPoints",
        "eventCount",
        "checkInCount",
        "uniqueDealsCheckedIn",
        "categoryRank"
      FROM category_rankings
      WHERE "categoryRank" <= $${paramIndex}
      ORDER BY "categoryId", "categoryRank"
    `, ...params, limitNum);

    // Group by category
    const categoriesMap = new Map();
    (categoryData as any[]).forEach((item: any) => {
      const categoryId = item.categoryId;
      if (!categoriesMap.has(categoryId)) {
        categoriesMap.set(categoryId, {
          categoryId: item.categoryId,
          categoryName: item.categoryName,
          categoryColor: item.categoryColor,
          leaderboard: []
        });
      }
      
      categoriesMap.get(categoryId).leaderboard.push({
        rank: item.categoryRank,
        userId: item.userId,
        name: item.name || 'Anonymous',
        email: item.email,
        avatarUrl: item.avatarUrl,
        totalPoints: Number(item.totalPoints),
        periodPoints: Number(item.periodPoints),
        monthlyPoints: Number(item.monthlyPoints),
        eventCount: Number(item.eventCount),
        checkInCount: Number(item.checkInCount),
        uniqueDealsCheckedIn: Number(item.uniqueDealsCheckedIn)
      });
    });

    const categories = Array.from(categoriesMap.values());

    res.status(200).json({
      success: true,
      period,
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      categoryId: categoryId ? parseInt(categoryId) : null,
      categories,
      pagination: {
        defaultLimit: 5,
        currentLimit: limitNum,
        showMore: showMoreBool,
        hasMore: limitNum < 50 && categories.length >= limitNum
      },
      metadata: {
        totalCategories: categories.length,
        limit: limitNum,
        queryTime: Date.now() - startTime
      }
    });

  } catch (error) {
    console.error('Category leaderboard error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: 'Failed to fetch category leaderboards'
    });
  }
});

// GET /api/leaderboard/insights - Advanced insights and trends
router.get('/insights', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const startTime = Date.now();
    const { 
      period = 'last_30_days',
      cityId,
      includePredictions = 'true'
    } = req.query as any;

    const { from, to } = calculateDateRange(period);
    const includePredictionsBool = includePredictions === 'true';

    let whereClause = 'WHERE u.role = \'USER\'';
    let params: any[] = [from, to];
    let paramIndex = 3;

    if (cityId) {
      const merchantIds = await getMerchantIdsForCity(parseInt(cityId));
      if (merchantIds.length === 0) {
        return res.status(200).json({
          success: true,
          period,
          dateRange: { from: from.toISOString(), to: to.toISOString() },
          insights: null,
          message: 'No active merchants found in this city'
        });
      }
      whereClause += ` AND EXISTS (
        SELECT 1 FROM "CheckIn" c2 
        WHERE c2."userId" = u.id 
        AND c2."merchantId" = ANY($${paramIndex})
        AND c2."createdAt" >= $1 AND c2."createdAt" <= $2
      )`;
      params.push(merchantIds);
      paramIndex++;
    }

    // Get comprehensive insights
    const insightsData = await prisma.$queryRawUnsafe(`
      WITH user_engagement AS (
        SELECT 
          u.id,
          u."createdAt" as "memberSince",
          COALESCE(SUM(e.points), 0) as "periodPoints",
          COUNT(e.id) as "eventCount",
          COUNT(DISTINCT c.id) as "checkInCount",
          COUNT(DISTINCT c."dealId") as "uniqueDealsCheckedIn",
          COUNT(DISTINCT c."merchantId") as "uniqueMerchantsVisited",
          COUNT(DISTINCT DATE(c."createdAt")) as "activeDays",
          EXTRACT(DAYS FROM (MAX(c."createdAt") - MIN(c."createdAt"))) as "activitySpan"
        FROM "User" u
        LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
          AND e."createdAt" >= $1 AND e."createdAt" <= $2
        LEFT JOIN "CheckIn" c ON u.id = c."userId" 
          AND c."createdAt" >= $1 AND c."createdAt" <= $2
        ${whereClause}
        GROUP BY u.id, u."createdAt"
      ),
      engagement_segments AS (
        SELECT 
          CASE 
            WHEN "periodPoints" = 0 THEN 'Inactive'
            WHEN "periodPoints" BETWEEN 1 AND 25 THEN 'Low Activity'
            WHEN "periodPoints" BETWEEN 26 AND 100 THEN 'Moderate Activity'
            WHEN "periodPoints" BETWEEN 101 AND 500 THEN 'High Activity'
            ELSE 'Power Users'
          END as "engagementSegment",
          COUNT(*) as "userCount",
          AVG("periodPoints") as "avgPoints",
          AVG("checkInCount") as "avgCheckIns",
          AVG("uniqueDealsCheckedIn") as "avgUniqueDeals",
          AVG("uniqueMerchantsVisited") as "avgUniqueMerchants"
        FROM user_engagement
        GROUP BY 
          CASE 
            WHEN "periodPoints" = 0 THEN 'Inactive'
            WHEN "periodPoints" BETWEEN 1 AND 25 THEN 'Low Activity'
            WHEN "periodPoints" BETWEEN 26 AND 100 THEN 'Moderate Activity'
            WHEN "periodPoints" BETWEEN 101 AND 500 THEN 'High Activity'
            ELSE 'Power Users'
          END
      ),
      top_performers AS (
        SELECT 
          u.id,
          u.name,
          u."avatarUrl",
          COALESCE(SUM(e.points), 0) as "periodPoints",
          COUNT(DISTINCT c."merchantId") as "uniqueMerchantsVisited",
          COUNT(DISTINCT c."dealId") as "uniqueDealsCheckedIn",
          ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(e.points), 0) DESC) as "rank"
        FROM "User" u
        LEFT JOIN "UserPointEvent" e ON u.id = e."userId" 
          AND e."createdAt" >= $1 AND e."createdAt" <= $2
        LEFT JOIN "CheckIn" c ON u.id = c."userId" 
          AND c."createdAt" >= $1 AND c."createdAt" <= $2
        ${whereClause}
        GROUP BY u.id, u.name, u."avatarUrl"
        ORDER BY "periodPoints" DESC
        LIMIT 10
      )
      SELECT 
        (SELECT json_agg(row_to_json(engagement_segments)) FROM engagement_segments) as "engagementSegments",
        (SELECT json_agg(row_to_json(top_performers)) FROM top_performers) as "topPerformers"
    `, ...params);

    const insights = {
      engagementSegments: (insightsData as any[])[0]?.engagementSegments || [],
      topPerformers: (insightsData as any[])[0]?.topPerformers || []
    };

    res.status(200).json({
      success: true,
      period,
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      cityId: cityId ? parseInt(cityId) : null,
      insights,
      metadata: {
        includePredictions: includePredictionsBool,
        queryTime: Date.now() - startTime
      }
    });

  } catch (error) {
    console.error('Leaderboard insights error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: 'Failed to fetch leaderboard insights'
    });
  }
});

export default router;
