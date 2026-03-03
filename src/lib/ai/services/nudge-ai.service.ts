import { flashModel, isAIEnabled, cleanJSON } from '../gemini.client';
import { NUDGE_PERSONALIZATION_PROMPT } from '../prompts/nudge.prompts';
import prisma from '../../prisma';

export interface PersonalizedNudge {
  title: string;
  body: string;
  emoji: string;
}

export class NudgeAIService {
  /**
   * Generate a personalized push notification message for a user based on nudge type and their context.
   */
  async personalizeNudge(
    userId: number,
    nudgeType: string,
    dealContext?: { title: string; merchant: string; discount: string }
  ): Promise<PersonalizedNudge> {
    if (!isAIEnabled()) throw new Error('AI features are not configured on this server.');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        loyaltyTier: true,
        streak: { select: { currentStreak: true, lastCheckInAt: true } },
      },
    });

    if (!user) throw new Error('User not found.');

    const daysSinceLastCheckIn = user.streak?.lastCheckInAt
      ? Math.floor((Date.now() - user.streak.lastCheckInAt.getTime()) / (1000 * 60 * 60 * 24))
      : 99;

    const prompt = NUDGE_PERSONALIZATION_PROMPT({
      nudgeType,
      userName: user.name || 'there',
      loyaltyTier: user.loyaltyTier,
      daysSinceLastCheckIn,
      currentStreak: user.streak?.currentStreak ?? 0,
      nearestDeal: dealContext,
    });

    const result = await flashModel.generateContent(prompt);
    const raw = result.response.text();
    return JSON.parse(cleanJSON(raw));
  }
}
