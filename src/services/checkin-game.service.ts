import { randomBytes, randomUUID } from 'crypto';
import {
  CheckInGameRewardStatus,
  CheckInGameRewardType,
  CheckInGameSessionStatus,
  CheckInGameType,
  Prisma,
} from '@prisma/client';
import prisma from '../lib/prisma';

type UpsertRewardInput = {
  label: string;
  description?: string;
  rewardType: CheckInGameRewardType;
  rewardValue: number;
  rewardLabel?: string;
  probabilityWeight?: number;
  isActive?: boolean;
  maxWins?: number | null;
};

type UpsertConfigInput = {
  isEnabled: boolean;
  gameType: CheckInGameType;
  title?: string;
  subtitle?: string;
  accentColor?: string;
  cooldownMinutes?: number;
  maxPlaysPerCheckIn?: number;
  sessionExpiryMinutes?: number;
  rewardExpiryHours?: number;
  settings?: Record<string, unknown> | null;
  rewards: UpsertRewardInput[];
};

const toNullableJsonInput = (value?: Record<string, unknown> | null): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined => {
  if (value === null) {
    return Prisma.JsonNull;
  }

  return value as Prisma.InputJsonValue | undefined;
};

const DEFAULT_REWARDS: UpsertRewardInput[] = [
  { label: '5% OFF', rewardType: CheckInGameRewardType.DISCOUNT_PERCENTAGE, rewardValue: 5, rewardLabel: '5% OFF', probabilityWeight: 40 },
  { label: '10% OFF', rewardType: CheckInGameRewardType.DISCOUNT_PERCENTAGE, rewardValue: 10, rewardLabel: '10% OFF', probabilityWeight: 30 },
  { label: '15 Coins', rewardType: CheckInGameRewardType.COINS, rewardValue: 15, rewardLabel: '15 Coins', probabilityWeight: 20 },
  { label: 'Free Treat', rewardType: CheckInGameRewardType.FREE_ITEM, rewardValue: 1, rewardLabel: 'Free Treat', probabilityWeight: 10 },
];

const buildBoard = (
  rewards: Array<{ id: number; label: string; rewardType: CheckInGameRewardType }>,
  gameType: CheckInGameType,
) => {
  const slotCount = gameType === CheckInGameType.PICK_A_CARD ? 3 : 6;
  return Array.from({ length: slotCount }, (_, index) => {
    const reward = rewards[index % rewards.length];
    return {
      index,
      rewardId: reward.id,
      label: reward.label,
      rewardType: reward.rewardType,
    };
  });
};

const weightedPick = <T extends { probabilityWeight: number }>(items: T[]): T => {
  const totalWeight = items.reduce((sum, item) => sum + Math.max(1, item.probabilityWeight), 0);
  let cursor = Math.random() * totalWeight;

  for (const item of items) {
    cursor -= Math.max(1, item.probabilityWeight);
    if (cursor <= 0) {
      return item;
    }
  }

  return items[items.length - 1];
};

const formatClaimCode = () => `GAME-${randomBytes(4).toString('hex').toUpperCase()}`;

export async function getMerchantCheckInGameConfig(merchantId: number) {
  return prisma.checkInGameConfig.upsert({
    where: { merchantId },
    update: {},
    create: {
      merchantId,
      isEnabled: false,
      rewards: {
        create: DEFAULT_REWARDS,
      },
    },
    include: {
      rewards: {
        orderBy: { id: 'asc' },
      },
    },
  });
}

export async function upsertMerchantCheckInGameConfig(merchantId: number, input: UpsertConfigInput) {
  const rewards = input.rewards.length > 0 ? input.rewards : DEFAULT_REWARDS;

  return prisma.$transaction(async (tx) => {
    const config = await tx.checkInGameConfig.upsert({
      where: { merchantId },
      update: {
        isEnabled: input.isEnabled,
        gameType: input.gameType,
        title: input.title || 'Tap to win',
        subtitle: input.subtitle || null,
        accentColor: input.accentColor || null,
        cooldownMinutes: input.cooldownMinutes ?? 0,
        maxPlaysPerCheckIn: input.maxPlaysPerCheckIn ?? 1,
        sessionExpiryMinutes: input.sessionExpiryMinutes ?? 15,
        rewardExpiryHours: input.rewardExpiryHours ?? 24,
        settings: toNullableJsonInput(input.settings),
      },
      create: {
        merchantId,
        isEnabled: input.isEnabled,
        gameType: input.gameType,
        title: input.title || 'Tap to win',
        subtitle: input.subtitle || null,
        accentColor: input.accentColor || null,
        cooldownMinutes: input.cooldownMinutes ?? 0,
        maxPlaysPerCheckIn: input.maxPlaysPerCheckIn ?? 1,
        sessionExpiryMinutes: input.sessionExpiryMinutes ?? 15,
        rewardExpiryHours: input.rewardExpiryHours ?? 24,
        settings: toNullableJsonInput(input.settings),
      },
    });

    await tx.checkInGameReward.deleteMany({ where: { configId: config.id } });

    await tx.checkInGameReward.createMany({
      data: rewards.map((reward) => ({
        configId: config.id,
        label: reward.label,
        description: reward.description,
        rewardType: reward.rewardType,
        rewardValue: reward.rewardValue,
        rewardLabel: reward.rewardLabel,
        probabilityWeight: reward.probabilityWeight ?? 1,
        isActive: reward.isActive ?? true,
        maxWins: reward.maxWins ?? null,
      })),
    });

    return tx.checkInGameConfig.findUniqueOrThrow({
      where: { merchantId },
      include: { rewards: { orderBy: { id: 'asc' } } },
    });
  });
}

export async function getMerchantCheckInGameAnalytics(merchantId: number) {
  const [sessions, playedSessions, issuedRewards, config] = await Promise.all([
    prisma.checkInGameSession.count({ where: { merchantId } }),
    prisma.checkInGameSession.count({ where: { merchantId, status: CheckInGameSessionStatus.PLAYED } }),
    prisma.checkInGameIssuedReward.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.checkInGameConfig.findUnique({
      where: { merchantId },
      include: { rewards: { orderBy: { currentWins: 'desc' } } },
    }),
  ]);

  return {
    sessions,
    playedSessions,
    conversionRate: sessions > 0 ? Math.round((playedSessions / sessions) * 100) : 0,
    recentRewards: issuedRewards,
    config,
  };
}

export async function createCheckInGameSessionForCheckIn(input: {
  userId: number;
  merchantId: number;
  checkInId: number;
  checkInAt: Date;
}) {
  const config = await prisma.checkInGameConfig.findUnique({
    where: { merchantId: input.merchantId },
    include: {
      rewards: {
        where: { isActive: true },
        orderBy: { id: 'asc' },
      },
    },
  });

  if (!config || !config.isEnabled || config.rewards.length === 0) {
    return null;
  }

  if (config.cooldownMinutes > 0) {
    const cooldownSince = new Date(input.checkInAt.getTime() - config.cooldownMinutes * 60 * 1000);
    const recentPlayedSession = await prisma.checkInGameSession.findFirst({
      where: {
        merchantId: input.merchantId,
        userId: input.userId,
        playedAt: { gte: cooldownSince },
      },
      orderBy: { playedAt: 'desc' },
    });

    if (recentPlayedSession) {
      return null;
    }
  }

  const session = await prisma.checkInGameSession.create({
    data: {
      sessionToken: randomUUID(),
      configId: config.id,
      merchantId: input.merchantId,
      userId: input.userId,
      checkInId: input.checkInId,
      gameType: config.gameType,
      expiresAt: new Date(input.checkInAt.getTime() + config.sessionExpiryMinutes * 60 * 1000),
    },
  });

  return {
    sessionToken: session.sessionToken,
    gameType: session.gameType,
    title: config.title,
    subtitle: config.subtitle,
    expiresAt: session.expiresAt,
  };
}

export async function getUserCheckInGameSession(userId: number, sessionToken: string) {
  const session = await prisma.checkInGameSession.findUnique({
    where: { sessionToken },
    include: {
      config: {
        include: {
          rewards: {
            where: { isActive: true },
            orderBy: { id: 'asc' },
          },
        },
      },
      issuedReward: true,
    },
  });

  if (!session || session.userId !== userId) {
    throw new Error('Game session not found');
  }

  if (session.status === CheckInGameSessionStatus.ELIGIBLE && session.expiresAt < new Date()) {
    await prisma.checkInGameSession.update({
      where: { id: session.id },
      data: { status: CheckInGameSessionStatus.EXPIRED },
    });
    throw new Error('Game session expired');
  }

  const board = buildBoard(
    session.config.rewards.map((reward) => ({
      id: reward.id,
      label: reward.rewardLabel || reward.label,
      rewardType: reward.rewardType,
    })),
    session.gameType,
  );

  return {
    sessionToken: session.sessionToken,
    status: session.status,
    gameType: session.gameType,
    title: session.config.title,
    subtitle: session.config.subtitle,
    accentColor: session.config.accentColor,
    expiresAt: session.expiresAt,
    board,
    reward: session.issuedReward,
    resultSlot: session.resultSlot,
  };
}

export async function playUserCheckInGameSession(userId: number, sessionToken: string) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.checkInGameSession.findUnique({
      where: { sessionToken },
      include: {
        checkIn: true,
        config: {
          include: {
            rewards: {
              where: { isActive: true },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    });

    if (!session || session.userId !== userId) {
      throw new Error('Game session not found');
    }

    if (session.status !== CheckInGameSessionStatus.ELIGIBLE) {
      throw new Error('Game session already used');
    }

    if (session.expiresAt < new Date()) {
      await tx.checkInGameSession.update({
        where: { id: session.id },
        data: { status: CheckInGameSessionStatus.EXPIRED },
      });
      throw new Error('Game session expired');
    }

    const availableRewards = session.config.rewards.filter(
      (reward) => reward.maxWins == null || reward.currentWins < reward.maxWins,
    );

    if (availableRewards.length === 0) {
      throw new Error('No active rewards available');
    }

    const selectedReward = weightedPick(availableRewards);
    const board = buildBoard(
      availableRewards.map((reward) => ({
        id: reward.id,
        label: reward.rewardLabel || reward.label,
        rewardType: reward.rewardType,
      })),
      session.gameType,
    );
    const matchingSlots = board.filter((slot) => slot.rewardId === selectedReward.id);
    const resolvedSlot = matchingSlots[Math.floor(Math.random() * matchingSlots.length)]?.index ?? 0;
    const expiresAt = new Date(Date.now() + session.config.rewardExpiryHours * 60 * 60 * 1000);

    await tx.checkInGameReward.update({
      where: { id: selectedReward.id },
      data: { currentWins: { increment: 1 } },
    });

    await tx.checkInGameSession.update({
      where: { id: session.id },
      data: {
        status: CheckInGameSessionStatus.PLAYED,
        playedAt: new Date(),
        resultSlot: resolvedSlot,
        selectedRewardId: selectedReward.id,
      },
    });

    const issuedReward = await tx.checkInGameIssuedReward.create({
      data: {
        sessionId: session.id,
        rewardId: selectedReward.id,
        merchantId: session.merchantId,
        userId,
        dealId: session.checkIn.dealId,
        rewardType: selectedReward.rewardType,
        rewardValue: selectedReward.rewardValue,
        rewardLabel: selectedReward.rewardLabel || selectedReward.label,
        claimCode: formatClaimCode(),
        expiresAt,
      },
    });

    if (selectedReward.rewardType === CheckInGameRewardType.COINS) {
      await tx.user.update({
        where: { id: userId },
        data: { coins: { increment: Math.round(selectedReward.rewardValue) } },
      });
    }

    if (selectedReward.rewardType === CheckInGameRewardType.BONUS_POINTS) {
      const points = Math.round(selectedReward.rewardValue);
      await tx.user.update({
        where: { id: userId },
        data: {
          points: { increment: points },
          monthlyPoints: { increment: points },
        },
      });
    }

    return {
      sessionToken: session.sessionToken,
      gameType: session.gameType,
      resultSlot: resolvedSlot,
      board,
      reward: issuedReward,
    };
  });
}

export async function listUserCheckInGameRewards(userId: number, status?: CheckInGameRewardStatus) {
  return prisma.checkInGameIssuedReward.findMany({
    where: {
      userId,
      ...(status ? { status } : {}),
    },
    include: {
      deal: {
        select: {
          id: true,
          title: true,
        },
      },
      merchant: {
        select: {
          id: true,
          businessName: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}
