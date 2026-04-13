import { flashModel, isAIEnabled, cleanJSON } from '../gemini.client';
import { BLOG_DRAFT_PROMPT } from '../prompts/blog.prompts';

export interface BlogDraftSuggestion {
  title: string;
  excerpt: string;
  content: string;
  tags: string[];
  suggestedCategory: string;
}

export class BlogAIService {
  async generateDraft(
    topic: string,
    businessName: string,
    businessType: string,
    tone?: string,
  ): Promise<BlogDraftSuggestion> {
    if (!isAIEnabled()) throw new Error('AI features are not configured on this server.');

    const prompt = BLOG_DRAFT_PROMPT(topic, businessName, businessType, tone);
    const result = await flashModel.generateContent(prompt);
    const raw = result.response.text();
    const parsed = JSON.parse(cleanJSON(raw));

    return {
      title: parsed.title || '',
      excerpt: parsed.excerpt || '',
      content: parsed.content || '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      suggestedCategory: parsed.suggestedCategory || '',
    };
  }
}
