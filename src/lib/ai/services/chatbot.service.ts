import { flashModel, isAIEnabled } from '../gemini.client';
import { CHATBOT_SYSTEM_PROMPT } from '../prompts/chatbot.prompts';
import prisma from '../../prisma';

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export class ChatbotService {
  /**
   * Send a message to the AI receptionist and get a response.
   * Optionally pass conversation history for multi-turn context and user's coordinates for nearby deal lookup.
   */
  async chat(
    userId: number,
    message: string,
    history: ChatMessage[] = [],
    userLocation?: { lat: number; lng: number }
  ): Promise<string> {
    if (!isAIEnabled()) throw new Error('AI features are not configured on this server.');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        points: true,
        coins: true,
        loyaltyTier: true,
        savedDeals: { select: { id: true } },
      },
    });

    if (!user) throw new Error('User not found.');

    // Fetch nearby deals if location provided (approx 0.1° ≈ 11km bounding box)
    let nearbyDeals: { title: string; merchant: string; discount: string }[] = [];
    let nearbyEvents: { title: string; type: string; venue: string | null; date: string }[] = [];

    if (userLocation) {
      const { lat, lng } = userLocation;
      const delta = 0.1;

      const deals = await prisma.deal.findMany({
        where: {
          endTime: { gte: new Date() },
          merchant: {
            stores: {
              some: {
                latitude: { gte: lat - delta, lte: lat + delta },
                longitude: { gte: lng - delta, lte: lng + delta },
              },
            },
          },
        },
        include: { merchant: { select: { businessName: true } } },
        take: 5,
      });

      nearbyDeals = deals.map(d => ({
        title: d.title,
        merchant: d.merchant.businessName,
        discount: d.discountPercentage
          ? `${d.discountPercentage}% off`
          : d.discountAmount
          ? `$${d.discountAmount} off`
          : 'Special deal',
      }));

      const events = await prisma.event.findMany({
        where: {
          status: 'PUBLISHED',
          startDate: { gte: new Date() },
          latitude: { gte: lat - delta, lte: lat + delta },
          longitude: { gte: lng - delta, lte: lng + delta },
        },
        select: { title: true, eventType: true, venueName: true, startDate: true },
        take: 3,
      });

      nearbyEvents = events.map(e => ({
        title: e.title,
        type: e.eventType,
        venue: e.venueName ?? null,
        date: e.startDate ? e.startDate.toLocaleDateString() : 'TBD',
      }));
    }

    const systemPrompt = CHATBOT_SYSTEM_PROMPT({
      userName: user.name || 'there',
      points: user.points,
      coins: user.coins,
      loyaltyTier: user.loyaltyTier,
      savedDealsCount: user.savedDeals.length,
      nearbyDeals,
      nearbyEvents,
    });

    // Build Gemini chat history from prior conversation turns
    const geminiHistory = history.map(h => ({
      role: h.role,
      parts: [{ text: h.content }],
    }));

    const chat = flashModel.startChat({
      history: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: "Got it! I'm ready to help YOHOP users." }] },
        ...geminiHistory,
      ],
    });

    const result = await chat.sendMessage(message);
    return result.response.text().trim();
  }
}
