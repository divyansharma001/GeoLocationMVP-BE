import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn('[AI] GEMINI_API_KEY not set. AI features will be disabled.');
}

export const genAI = new GoogleGenerativeAI(apiKey || '');

// Fast model — chatbot, quick suggestions, nudge personalization
export const flashModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Pro model — structured JSON extraction, business insights, menu parsing
export const proModel = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

export const isAIEnabled = (): boolean => !!apiKey;

/**
 * Strips markdown code fences that Gemini sometimes wraps around JSON responses.
 */
export const cleanJSON = (text: string): string =>
  text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
