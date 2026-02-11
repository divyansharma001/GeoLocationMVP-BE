import prisma from '../lib/prisma';
import { KittyGameStatus, CoinTransactionType } from '@prisma/client';
import { awardCoins, spendCoins } from '../lib/gamification';
import crypto from 'crypto';

/**
 * Create a new Kitty Game for a venue
 */
export async function createKittyGame(params: {
  merchantId: number;
  title: string;
  entryFee?: number;
  guessWindowStart: Date;
  guessWindowEnd: Date;
  minPlayers?: number;
  maxPlayers?: number;
  createdBy: number;
}) {
  const {
    merchantId,
    title,
    entryFee = 10,
    guessWindowStart,
    guessWindowEnd,
    minPlayers = 2,
    maxPlayers,
    createdBy,
  } = params;

  if (guessWindowEnd <= guessWindowStart) {
    throw new Error('Guess window end must be after start');
  }

  if (entryFee < 0) {
    throw new Error('Entry fee cannot be negative');
  }

  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) {
    throw new Error('Merchant not found');
  }

  // Generate a secret random value between 1-1000
  const secretValue = generateSecretValue();

  const game = await prisma.kittyGame.create({
    data: {
      merchantId,
      title,
      entryFee,
      secretValue,
      guessWindowStart,
      guessWindowEnd,
      minPlayers,
      maxPlayers,
      createdBy,
      status: KittyGameStatus.PENDING,
    },
    include: {
      merchant: { select: { id: true, businessName: true } },
    },
  });

  return {
    id: game.id,
    title: game.title,
    merchant: game.merchant,
    entryFee: game.entryFee,
    guessWindowStart: game.guessWindowStart,
    guessWindowEnd: game.guessWindowEnd,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    status: game.status,
    createdAt: game.createdAt,
  };
}

/**
 * Activate a pending game (admin action)
 */
export async function activateGame(gameId: number) {
  const game = await prisma.kittyGame.findUnique({ where: { id: gameId } });
  if (!game) throw new Error('Game not found');
  if (game.status !== KittyGameStatus.PENDING) {
    throw new Error('Only pending games can be activated');
  }

  return prisma.kittyGame.update({
    where: { id: gameId },
    data: { status: KittyGameStatus.ACTIVE },
    include: {
      merchant: { select: { id: true, businessName: true } },
    },
  });
}

/**
 * Submit a guess for a Kitty Game
 */
export async function submitGuess(userId: number, gameId: number, guessValue: number) {
  const game = await prisma.kittyGame.findUnique({
    where: { id: gameId },
    include: { guesses: { select: { userId: true } } },
  });

  if (!game) throw new Error('Game not found');

  if (game.status !== KittyGameStatus.ACTIVE) {
    throw new Error('Game is not currently active');
  }

  const now = new Date();
  if (now < game.guessWindowStart) {
    throw new Error('Guess window has not opened yet');
  }
  if (now > game.guessWindowEnd) {
    throw new Error('Guess window has closed');
  }

  // Check if user already guessed
  const existingGuess = game.guesses.find((g) => g.userId === userId);
  if (existingGuess) {
    throw new Error('You have already submitted a guess for this game');
  }

  // Check max players
  if (game.maxPlayers && game.guesses.length >= game.maxPlayers) {
    throw new Error('This game has reached the maximum number of players');
  }

  // Validate guess range
  if (guessValue < 1 || guessValue > 1000) {
    throw new Error('Guess must be between 1 and 1000');
  }

  // Charge entry fee in coins
  if (game.entryFee > 0) {
    await spendCoins(
      userId,
      game.entryFee,
      `Entry fee for Kitty Game: ${game.title}`,
      { gameId: game.id }
    );
  }

  // Create the guess and update prize pool
  const [guess] = await prisma.$transaction([
    prisma.kittyGuess.create({
      data: {
        gameId,
        userId,
        guessValue,
        coinsSpent: game.entryFee,
      },
    }),
    prisma.kittyGame.update({
      where: { id: gameId },
      data: { prizePool: { increment: game.entryFee } },
    }),
  ]);

  return {
    id: guess.id,
    guessValue: guess.guessValue,
    coinsSpent: guess.coinsSpent,
    gameTitle: game.title,
    message: 'Guess submitted successfully!',
  };
}

/**
 * Close the guess window and resolve the game
 */
export async function resolveGame(gameId: number) {
  const game = await prisma.kittyGame.findUnique({
    where: { id: gameId },
    include: {
      guesses: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  if (!game) throw new Error('Game not found');

  if (game.status === KittyGameStatus.RESOLVED) {
    throw new Error('Game has already been resolved');
  }

  if (game.status === KittyGameStatus.CANCELLED) {
    throw new Error('Game has been cancelled');
  }

  // Check minimum players
  if (game.guesses.length < game.minPlayers) {
    // Not enough players - cancel and refund
    await cancelAndRefund(game);
    throw new Error(
      `Not enough players (${game.guesses.length}/${game.minPlayers}). Game cancelled and entry fees refunded.`
    );
  }

  if (!game.secretValue) {
    throw new Error('Game has no secret value set');
  }

  // Find closest guess to the secret value
  let closestGuess = game.guesses[0];
  let smallestDiff = Math.abs(game.guesses[0].guessValue - game.secretValue);

  for (const guess of game.guesses) {
    const diff = Math.abs(guess.guessValue - game.secretValue);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closestGuess = guess;
    }
  }

  // Update the game with the winner
  await prisma.$transaction(async (tx) => {
    await tx.kittyGame.update({
      where: { id: gameId },
      data: {
        status: KittyGameStatus.RESOLVED,
        winnerId: closestGuess.userId,
        winnerGuessId: closestGuess.id,
        resolvedAt: new Date(),
      },
    });

    await tx.kittyGuess.update({
      where: { id: closestGuess.id },
      data: { isWinner: true },
    });
  });

  // Award prize pool to winner
  const prizeCoins = Math.floor(game.prizePool);
  if (prizeCoins > 0) {
    await awardCoins(
      closestGuess.userId,
      prizeCoins,
      CoinTransactionType.BONUS,
      `Won Kitty Game: ${game.title}`,
      { gameId: game.id, secretValue: game.secretValue, guessValue: closestGuess.guessValue }
    );
  }

  const winner = closestGuess.user;

  return {
    gameId: game.id,
    title: game.title,
    secretValue: game.secretValue,
    totalPlayers: game.guesses.length,
    prizePool: game.prizePool,
    winner: {
      userId: winner.id,
      name: winner.name,
      guessValue: closestGuess.guessValue,
      difference: smallestDiff,
      prizeCoins,
    },
    allGuesses: game.guesses.map((g) => ({
      userId: g.user.id,
      name: g.user.name,
      guessValue: g.guessValue,
      difference: Math.abs(g.guessValue - game.secretValue!),
      isWinner: g.id === closestGuess.id,
    })).sort((a, b) => a.difference - b.difference),
  };
}

/**
 * Cancel a game and refund all entry fees
 */
async function cancelAndRefund(game: any) {
  await prisma.kittyGame.update({
    where: { id: game.id },
    data: { status: KittyGameStatus.CANCELLED },
  });

  // Refund entry fees to all participants
  for (const guess of game.guesses) {
    if (guess.coinsSpent > 0) {
      await awardCoins(
        guess.userId,
        guess.coinsSpent,
        CoinTransactionType.REFUND,
        `Refund for cancelled Kitty Game: ${game.title}`,
        { gameId: game.id }
      );
    }
  }
}

/**
 * Cancel a game by admin
 */
export async function cancelGame(gameId: number) {
  const game = await prisma.kittyGame.findUnique({
    where: { id: gameId },
    include: { guesses: true },
  });

  if (!game) throw new Error('Game not found');

  if (game.status === KittyGameStatus.RESOLVED) {
    throw new Error('Cannot cancel a resolved game');
  }

  if (game.status === KittyGameStatus.CANCELLED) {
    throw new Error('Game is already cancelled');
  }

  await cancelAndRefund(game);

  return { gameId, status: 'CANCELLED', refundedPlayers: game.guesses.length };
}

/**
 * Get active games for a merchant/venue
 */
export async function getActiveGames(merchantId?: number) {
  const where: any = {
    status: { in: [KittyGameStatus.ACTIVE, KittyGameStatus.PENDING] },
  };

  if (merchantId) {
    where.merchantId = merchantId;
  }

  const games = await prisma.kittyGame.findMany({
    where,
    include: {
      merchant: { select: { id: true, businessName: true, logoUrl: true } },
      _count: { select: { guesses: true } },
    },
    orderBy: { guessWindowEnd: 'asc' },
  });

  return games.map((g) => ({
    id: g.id,
    title: g.title,
    merchant: g.merchant,
    entryFee: g.entryFee,
    prizePool: g.prizePool,
    playerCount: g._count.guesses,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    guessWindowStart: g.guessWindowStart,
    guessWindowEnd: g.guessWindowEnd,
    status: g.status,
  }));
}

/**
 * Get a specific game's details (user view - no secret value)
 */
export async function getGameDetails(gameId: number, userId?: number) {
  const game = await prisma.kittyGame.findUnique({
    where: { id: gameId },
    include: {
      merchant: { select: { id: true, businessName: true, logoUrl: true } },
      guesses: {
        select: {
          id: true,
          userId: true,
          guessValue: true,
          isWinner: true,
          createdAt: true,
          user: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      winner: { select: { id: true, name: true } },
    },
  });

  if (!game) throw new Error('Game not found');

  const isResolved = game.status === KittyGameStatus.RESOLVED;
  const userGuess = userId ? game.guesses.find((g) => g.userId === userId) : null;

  return {
    id: game.id,
    title: game.title,
    merchant: game.merchant,
    entryFee: game.entryFee,
    prizePool: game.prizePool,
    playerCount: game.guesses.length,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    guessWindowStart: game.guessWindowStart,
    guessWindowEnd: game.guessWindowEnd,
    status: game.status,
    // Only reveal secret value after resolution
    secretValue: isResolved ? game.secretValue : undefined,
    winner: isResolved ? game.winner : undefined,
    resolvedAt: game.resolvedAt,
    userGuess: userGuess
      ? { guessValue: userGuess.guessValue, isWinner: userGuess.isWinner }
      : null,
    hasUserGuessed: !!userGuess,
    // Only show all guesses after the game is resolved
    leaderboard: isResolved
      ? game.guesses
          .map((g) => ({
            userId: g.user.id,
            name: g.user.name,
            guessValue: g.guessValue,
            difference: Math.abs(g.guessValue - (game.secretValue || 0)),
            isWinner: g.isWinner,
          }))
          .sort((a, b) => a.difference - b.difference)
      : undefined,
  };
}

/**
 * Get game analytics for a merchant
 */
export async function getGameAnalytics(merchantId: number) {
  const [totalGames, activeGames, resolvedGames, totalPrizeAwarded, totalPlayers] =
    await Promise.all([
      prisma.kittyGame.count({ where: { merchantId } }),
      prisma.kittyGame.count({
        where: { merchantId, status: KittyGameStatus.ACTIVE },
      }),
      prisma.kittyGame.count({
        where: { merchantId, status: KittyGameStatus.RESOLVED },
      }),
      prisma.kittyGame.aggregate({
        where: { merchantId, status: KittyGameStatus.RESOLVED },
        _sum: { prizePool: true },
      }),
      prisma.kittyGuess.count({
        where: { game: { merchantId } },
      }),
    ]);

  const recentGames = await prisma.kittyGame.findMany({
    where: { merchantId },
    include: {
      _count: { select: { guesses: true } },
      winner: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return {
    summary: {
      totalGames,
      activeGames,
      resolvedGames,
      totalPrizeAwarded: totalPrizeAwarded._sum.prizePool || 0,
      totalPlayers,
      averagePlayersPerGame: totalGames > 0 ? Math.round(totalPlayers / totalGames) : 0,
    },
    recentGames: recentGames.map((g) => ({
      id: g.id,
      title: g.title,
      status: g.status,
      prizePool: g.prizePool,
      playerCount: g._count.guesses,
      winner: g.winner,
      createdAt: g.createdAt,
      resolvedAt: g.resolvedAt,
    })),
  };
}

/**
 * Generate cryptographically secure random value between 1-1000
 */
function generateSecretValue(): number {
  const buf = crypto.randomBytes(4);
  const num = buf.readUInt32BE(0);
  return (num % 1000) + 1; // 1-1000
}
