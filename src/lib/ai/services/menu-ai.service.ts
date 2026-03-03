import { proModel, isAIEnabled, cleanJSON } from '../gemini.client';
import { MENU_PARSER_PROMPT } from '../prompts/menu.prompts';

export interface ParsedMenuItem {
  name: string;
  description: string | null;
  price: number | null;
  category: string;
  isAvailable: boolean;
  preparationTime: number | null;
}

export class MenuAIService {
  /**
   * Parse free-text or pasted menu content and return structured menu items
   * ready to be inserted into the database.
   */
  async parseMenu(rawText: string): Promise<ParsedMenuItem[]> {
    if (!isAIEnabled()) throw new Error('AI features are not configured on this server.');

    if (!rawText || rawText.trim().length < 10) {
      throw new Error('Menu text is too short to parse.');
    }

    const prompt = MENU_PARSER_PROMPT(rawText);
    const result = await proModel.generateContent(prompt);
    const raw = result.response.text();
    const parsed = JSON.parse(cleanJSON(raw));

    if (!Array.isArray(parsed)) {
      throw new Error('AI returned unexpected format for menu items.');
    }

    return parsed;
  }
}
