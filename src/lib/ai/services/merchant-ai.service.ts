import { proModel, flashModel, isAIEnabled, cleanJSON } from '../gemini.client';
import { MERCHANT_ONBOARDING_PROMPT, MERCHANT_INSIGHTS_PROMPT } from '../prompts/merchant.prompts';
import prisma from '../../prisma';

export interface MerchantSuggestion {
  businessType: 'LOCAL' | 'NATIONAL';
  description: string;
  vibeTags: string[];
  amenities: string[];
  priceRange: string;
  suggestedCategory: string;
  keywords: string[];
}

export interface MerchantInsights {
  summary: string;
  topInsights: string[];
  recommendations: { type: string; title: string; description: string }[];
  bestPerformingDealType: string;
  growthOpportunity: string;
}

export class MerchantAIService {
  /**
   * Given a free-text business description, suggest structured merchant profile data.
   */
  async suggestOnboardingData(description: string): Promise<MerchantSuggestion> {
    if (!isAIEnabled()) throw new Error('AI features are not configured on this server.');

    const prompt = MERCHANT_ONBOARDING_PROMPT(description);
    const result = await proModel.generateContent(prompt);
    const raw = result.response.text();
    return JSON.parse(cleanJSON(raw));
  }

  /**
   * Analyze a merchant's deal and loyalty data and return AI-generated insights.
   */
  async getMerchantInsights(merchantId: number): Promise<MerchantInsights> {
    if (!isAIEnabled()) throw new Error('AI features are not configured on this server.');

    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        deals: {
          include: { _count: { select: { savedByUsers: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        loyaltyProgram: { select: { pointsPerDollar: true } },
        _count: { select: { deals: true, stores: true } },
      },
    });

    if (!merchant) throw new Error('Merchant not found.');

    const topDeals = merchant.deals.slice(0, 5).map(d => ({
      title: d.title,
      saves: d._count.savedByUsers,
      isFlashSale: d.isFlashSale ?? false,
      discountPercentage: d.discountPercentage ?? null,
    }));

    const prompt = MERCHANT_INSIGHTS_PROMPT({
      businessName: merchant.businessName,
      dealStats: { total: merchant._count.deals, stores: merchant._count.stores },
      topDeals,
      loyaltyStats: merchant.loyaltyProgram
        ? { active: true, pointsPerDollar: merchant.loyaltyProgram.pointsPerDollar }
        : { active: false },
    });

    const result = await flashModel.generateContent(prompt);
    const raw = result.response.text();
    return JSON.parse(cleanJSON(raw));
  }
}
