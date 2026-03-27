import prisma from '../lib/prisma';
import redis from '../lib/redis';
import { awardCoins } from '../lib/gamification';

type LotteryRewardType = 'CASH' | 'FREE_REWARD' | 'COINS';
type LotteryStatus = 'SCHEDULED' | 'ACTIVE' | 'DRAWN' | 'CANCELLED';

interface CheckInLotteryGame {
  id: string;
  title: string;
  startAt: string;
  cutoffAt: string;
  drawAt: string;
  rewardType: LotteryRewardType;
  rewardValue: number;
  rewardLabel?: string;
  status: LotteryStatus;
  winnerUserId?: number;
  winnerCheckInId?: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  totalEntries: number;
}

const CURRENT_GAME_KEY = 'checkin_lottery:current_game_id';
const GAME_INDEX_KEY = 'checkin_lottery:game_ids';

function gameKey(gameId: string): string {
  return `checkin_lottery:game:${gameId}`;
}

function entrySetKey(gameId: string): string {
  return `checkin_lottery:game:${gameId}:entries`;
}

function entryCheckInMapKey(gameId: string): string {
  return `checkin_lottery:game:${gameId}:entry_checkins`;
}

function parseGame(raw: string | null): CheckInLotteryGame | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CheckInLotteryGame;
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStatus(game: CheckInLotteryGame): CheckInLotteryGame {
  const now = Date.now();
  if (game.status === 'SCHEDULED') {
    const startAt = new Date(game.startAt).getTime();
    if (now >= startAt) {
      return { ...game, status: 'ACTIVE', updatedAt: nowIso() };
    }
  }
  return game;
}

async function saveGame(game: CheckInLotteryGame): Promise<CheckInLotteryGame> {
  const normalized = normalizeStatus(game);
  await redis.set(gameKey(normalized.id), JSON.stringify(normalized));
  return normalized;
}

async function getGameById(gameId: string): Promise<CheckInLotteryGame | null> {
  const game = parseGame(await redis.get(gameKey(gameId)));
  if (!game) return null;
  const normalized = normalizeStatus(game);
  if (normalized.status !== game.status) {
    await saveGame(normalized);
  }
  return normalized;
}

async function setCurrentIfActive(game: CheckInLotteryGame): Promise<void> {
  const now = Date.now();
  const startAt = new Date(game.startAt).getTime();
  const cutoffAt = new Date(game.cutoffAt).getTime();
  if (game.status === 'ACTIVE' && now >= startAt && now <= cutoffAt) {
    await redis.set(CURRENT_GAME_KEY, game.id);
  }
}

export async function createCheckInLotteryGame(params: {
  title: string;
  startAt: Date;
  cutoffAt: Date;
  drawAt: Date;
  rewardType: LotteryRewardType;
  rewardValue: number;
  rewardLabel?: string;
  createdBy: number;
}) {
  if (params.cutoffAt <= params.startAt) {
    throw new Error('cutoffAt must be after startAt');
  }
  if (params.drawAt <= params.cutoffAt) {
    throw new Error('drawAt must be after cutoffAt');
  }
  if (params.rewardValue <= 0) {
    throw new Error('rewardValue must be positive');
  }

  const id = randomId();
  const now = nowIso();
  const initialStatus: LotteryStatus = params.startAt <= new Date() ? 'ACTIVE' : 'SCHEDULED';

  const game: CheckInLotteryGame = {
    id,
    title: params.title,
    startAt: params.startAt.toISOString(),
    cutoffAt: params.cutoffAt.toISOString(),
    drawAt: params.drawAt.toISOString(),
    rewardType: params.rewardType,
    rewardValue: params.rewardValue,
    rewardLabel: params.rewardLabel,
    status: initialStatus,
    createdBy: params.createdBy,
    createdAt: now,
    updatedAt: now,
    totalEntries: 0,
  };

  await saveGame(game);
  await redis.lpush(GAME_INDEX_KEY, game.id);
  await setCurrentIfActive(game);

  return game;
}

export async function getCurrentCheckInLotteryGame() {
  const currentId = await redis.get(CURRENT_GAME_KEY);
  if (!currentId) return null;

  const game = await getGameById(currentId);
  if (!game) {
    await redis.del(CURRENT_GAME_KEY);
    return null;
  }

  const now = Date.now();
  if (game.status !== 'ACTIVE' || now > new Date(game.cutoffAt).getTime()) {
    return game;
  }

  return game;
}

export async function listCheckInLotteryGames(limit = 20) {
  const gameIds = await redis.lrange(GAME_INDEX_KEY, 0, Math.max(0, limit - 1));
  if (gameIds.length === 0) return [];

  const games = await Promise.all(gameIds.map((id: string) => getGameById(id)));
  return games.filter((g: CheckInLotteryGame | null): g is CheckInLotteryGame => !!g);
}

export async function cancelCheckInLotteryGame(gameId: string) {
  const game = await getGameById(gameId);
  if (!game) throw new Error('Game not found');
  if (game.status === 'DRAWN') throw new Error('Cannot cancel a drawn game');

  const cancelled: CheckInLotteryGame = {
    ...game,
    status: 'CANCELLED',
    updatedAt: nowIso(),
  };

  await saveGame(cancelled);
  const currentId = await redis.get(CURRENT_GAME_KEY);
  if (currentId === gameId) {
    await redis.del(CURRENT_GAME_KEY);
  }

  return cancelled;
}

export async function registerCheckInLotteryEntry(params: {
  userId: number;
  checkInId: number;
  checkInAt: Date;
}) {
  const game = await getCurrentCheckInLotteryGame();
  if (!game || game.status !== 'ACTIVE') {
    return null;
  }

  const checkInTime = params.checkInAt.getTime();
  const startAt = new Date(game.startAt).getTime();
  const cutoffAt = new Date(game.cutoffAt).getTime();
  if (checkInTime < startAt || checkInTime > cutoffAt) {
    return null;
  }

  const added = await redis.sadd(entrySetKey(game.id), String(params.userId));
  if (added === 1) {
    await redis.hset(entryCheckInMapKey(game.id), String(params.userId), String(params.checkInId));
    const nextTotalEntries = await redis.scard(entrySetKey(game.id));
    const updated = { ...game, totalEntries: nextTotalEntries, updatedAt: nowIso() };
    await saveGame(updated);
    return {
      gameId: game.id,
      entered: true,
      newEntry: true,
      totalEntries: nextTotalEntries,
      drawAt: game.drawAt,
    };
  }

  return {
    gameId: game.id,
    entered: true,
    newEntry: false,
    totalEntries: await redis.scard(entrySetKey(game.id)),
    drawAt: game.drawAt,
  };
}

export async function resolveCheckInLotteryGame(gameId: string) {
  const game = await getGameById(gameId);
  if (!game) throw new Error('Game not found');
  if (game.status === 'DRAWN') throw new Error('Game already drawn');
  if (game.status === 'CANCELLED') throw new Error('Game is cancelled');

  const participants = await redis.smembers(entrySetKey(game.id));
  if (participants.length === 0) {
    const noWinner = {
      ...game,
      status: 'DRAWN' as LotteryStatus,
      updatedAt: nowIso(),
    };
    await saveGame(noWinner);
    const currentId = await redis.get(CURRENT_GAME_KEY);
    if (currentId === game.id) await redis.del(CURRENT_GAME_KEY);
    return { game: noWinner, winner: null, totalEntries: 0 };
  }

  const winnerIdx = Math.floor(Math.random() * participants.length);
  const winnerUserId = Number(participants[winnerIdx]);
  const winnerCheckInIdRaw = await redis.hget(entryCheckInMapKey(game.id), String(winnerUserId));
  const winnerCheckInId = winnerCheckInIdRaw ? Number(winnerCheckInIdRaw) : undefined;

  if (game.rewardType === 'COINS') {
    await awardCoins(
      winnerUserId,
      Math.floor(game.rewardValue),
      'BONUS' as any,
      `Check-in lottery winner: ${game.title}`,
      { checkInLotteryGameId: game.id }
    );
  }

  const updatedGame: CheckInLotteryGame = {
    ...game,
    status: 'DRAWN',
    winnerUserId,
    winnerCheckInId,
    updatedAt: nowIso(),
    totalEntries: participants.length,
  };

  await saveGame(updatedGame);
  const currentId = await redis.get(CURRENT_GAME_KEY);
  if (currentId === game.id) {
    await redis.del(CURRENT_GAME_KEY);
  }

  const winnerUser = await prisma.user.findUnique({
    where: { id: winnerUserId },
    select: { id: true, name: true, email: true },
  });

  return {
    game: updatedGame,
    winner: winnerUser,
    totalEntries: participants.length,
  };
}

export async function getCheckInLotteryStatusForUser(userId: number) {
  const game = await getCurrentCheckInLotteryGame();
  if (!game) return { game: null, entered: false, eligible: false, totalEntries: 0 };

  const entered = (await redis.sismember(entrySetKey(game.id), String(userId))) === 1;
  const totalEntries = await redis.scard(entrySetKey(game.id));

  let eligible = false;
  if (!entered && game.status === 'ACTIVE') {
    const recentWindowCheckIn = await prisma.checkIn.findFirst({
      where: {
        userId,
        createdAt: {
          gte: new Date(game.startAt),
          lte: new Date(game.cutoffAt),
        },
      },
      select: { id: true },
    });
    eligible = !!recentWindowCheckIn;
  }

  return { game, entered, eligible: entered || eligible, totalEntries };
}
