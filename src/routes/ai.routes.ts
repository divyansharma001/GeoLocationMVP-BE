import { Router } from 'express';
import { protect, isApprovedMerchant, isMerchant, requireAdmin, AuthRequest } from '../middleware/auth.middleware';
import { isAIEnabled } from '../lib/ai/gemini.client';
import { MerchantAIService } from '../lib/ai/services/merchant-ai.service';
import { DealAIService } from '../lib/ai/services/deal-ai.service';
import { ChatbotService } from '../lib/ai/services/chatbot.service';
import { NudgeAIService } from '../lib/ai/services/nudge-ai.service';
import { MenuAIService } from '../lib/ai/services/menu-ai.service';
import prisma from '../lib/prisma';

const router = Router();

const merchantAI = new MerchantAIService();
const dealAI = new DealAIService();
const chatbot = new ChatbotService();
const nudgeAI = new NudgeAIService();
const menuAI = new MenuAIService();

// Health check — tells client whether AI features are available
router.get('/status', (_req, res) => {
  res.json({ aiEnabled: isAIEnabled() });
});

// ─────────────────────────────────────────────
// MERCHANT — Onboarding Suggestion
// POST /api/ai/merchant/suggest
// Body: { description: string }
// Returns structured merchant profile fields
// ─────────────────────────────────────────────
router.post('/merchant/suggest', protect, async (req: AuthRequest, res) => {
  try {
    const { description } = req.body;

    if (!description || typeof description !== 'string' || description.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a description of at least 10 characters.' });
    }

    const suggestion = await merchantAI.suggestOnboardingData(description.trim());
    res.json({ suggestion });
  } catch (error: any) {
    if (error.message?.includes('not configured')) {
      return res.status(503).json({ error: 'AI features are not available right now.' });
    }
    console.error('[AI] merchant/suggest error:', error);
    res.status(500).json({ error: 'Failed to generate merchant suggestions.' });
  }
});

// ─────────────────────────────────────────────
// MERCHANT — Business Insights
// GET /api/ai/merchant/insights
// Requires: approved merchant
// Returns AI analysis of the merchant's performance
// ─────────────────────────────────────────────
router.get('/merchant/insights', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant!.id;
    const insights = await merchantAI.getMerchantInsights(merchantId);
    res.json({ insights });
  } catch (error: any) {
    if (error.message?.includes('not configured')) {
      return res.status(503).json({ error: 'AI features are not available right now.' });
    }
    console.error('[AI] merchant/insights error:', error);
    res.status(500).json({ error: 'Failed to generate business insights.' });
  }
});

// ─────────────────────────────────────────────
// DEALS — AI Deal Generator
// POST /api/ai/deals/generate
// Body: { intent: string }
// Requires: merchant (any status, for drafting purposes)
// Returns structured deal fields ready to populate the deal creation form
// ─────────────────────────────────────────────
router.post('/deals/generate', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const { intent } = req.body;

    if (!intent || typeof intent !== 'string' || intent.trim().length < 5) {
      return res.status(400).json({ error: 'Please describe what deal you want to create.' });
    }

    // Get merchant details for better context
    const merchant = await prisma.merchant.findUnique({
      where: { id: req.merchant!.id },
      select: { businessName: true, businessType: true },
    });

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found.' });
    }

    const suggestion = await dealAI.generateDeal(
      intent.trim(),
      merchant.businessType || 'LOCAL',
      merchant.businessName
    );

    res.json({ suggestion });
  } catch (error: any) {
    if (error.message?.includes('not configured')) {
      return res.status(503).json({ error: 'AI features are not available right now.' });
    }
    console.error('[AI] deals/generate error:', error);
    res.status(500).json({ error: 'Failed to generate deal suggestion.' });
  }
});

// ─────────────────────────────────────────────
// CHATBOT — AI Receptionist
// POST /api/ai/chat
// Body: {
//   message: string,
//   lat?: number,
//   lng?: number,
//   history?: { role: 'user' | 'model', content: string }[]
// }
// Requires: authenticated user
// ─────────────────────────────────────────────
router.post('/chat', protect, async (req: AuthRequest, res) => {
  try {
    const { message, lat, lng, history = [] } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    if (message.trim().length > 500) {
      return res.status(400).json({ error: 'Message is too long (max 500 characters).' });
    }

    const userLocation = lat !== undefined && lng !== undefined
      ? { lat: Number(lat), lng: Number(lng) }
      : undefined;

    const reply = await chatbot.chat(
      req.user!.id,
      message.trim(),
      Array.isArray(history) ? history : [],
      userLocation
    );

    res.json({ reply });
  } catch (error: any) {
    if (error.message?.includes('not configured')) {
      return res.status(503).json({ error: 'AI features are not available right now.' });
    }
    console.error('[AI] chat error:', error);
    res.status(500).json({ error: 'AI assistant is temporarily unavailable.' });
  }
});

// ─────────────────────────────────────────────
// MENU — AI Menu Parser
// POST /api/ai/menu/parse
// Body: { text: string }
// Requires: merchant (any status)
// Returns array of structured menu items
// ─────────────────────────────────────────────
router.post('/menu/parse', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide menu text to parse.' });
    }

    if (text.length > 10000) {
      return res.status(400).json({ error: 'Menu text is too long (max 10,000 characters).' });
    }

    const items = await menuAI.parseMenu(text.trim());
    res.json({ items, count: items.length });
  } catch (error: any) {
    if (error.message?.includes('not configured')) {
      return res.status(503).json({ error: 'AI features are not available right now.' });
    }
    console.error('[AI] menu/parse error:', error);
    res.status(500).json({ error: 'Failed to parse menu.' });
  }
});

// ─────────────────────────────────────────────
// NUDGE — Personalize a nudge message (admin / server-side use)
// POST /api/ai/nudge/personalize
// Body: { userId: number, nudgeType: string, deal?: { title, merchant, discount } }
// Requires: admin
// ─────────────────────────────────────────────
router.post('/nudge/personalize', protect, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { userId, nudgeType, deal } = req.body;

    if (!userId || !nudgeType) {
      return res.status(400).json({ error: 'userId and nudgeType are required.' });
    }

    const nudge = await nudgeAI.personalizeNudge(Number(userId), nudgeType, deal);
    res.json({ nudge });
  } catch (error: any) {
    if (error.message?.includes('not configured')) {
      return res.status(503).json({ error: 'AI features are not available right now.' });
    }
    console.error('[AI] nudge/personalize error:', error);
    res.status(500).json({ error: 'Failed to personalize nudge.' });
  }
});

export default router;
