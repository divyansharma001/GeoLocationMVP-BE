import { flashModel, isAIEnabled, cleanJSON } from '../gemini.client';
import { DEAL_GENERATOR_PROMPT } from '../prompts/deal.prompts';

export interface DealSuggestion {
  title: string;
  description: string;
  discountPercentage: number | null;
  discountAmount: number | null;
  isFlashSale: boolean;
  redemptionInstructions: string;
  suggestedDurationHours: number;
  suggestedTags: string[];
  bestDayOfWeek: string;
  bestTimeSlot: string;
}

export class DealAIService {
  /**
   * Generate a structured deal from a merchant's plain-text description of what they want to offer.
   */
  async generateDeal(
    intent: string,
    businessType: string,
    businessName: string
  ): Promise<DealSuggestion> {
    if (!isAIEnabled()) throw new Error('AI features are not configured on this server.');

    const prompt = DEAL_GENERATOR_PROMPT(intent, businessType, businessName);
    const result = await flashModel.generateContent(prompt);
    const raw = result.response.text();
    return JSON.parse(cleanJSON(raw));
  }
}
