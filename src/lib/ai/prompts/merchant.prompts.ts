export const MERCHANT_ONBOARDING_PROMPT = (description: string) => `
You are an assistant helping merchants onboard to YOHOP, a location-based deals and events platform.

Based on the business description below, generate structured merchant profile data.

Business Description: "${description}"

Return ONLY a valid JSON object with exactly these fields:
{
  "businessType": "LOCAL" or "NATIONAL",
  "description": "A compelling 2-3 sentence business description written in third person",
  "vibeTags": ["array of 3-6 atmosphere or vibe tags, e.g. 'cozy', 'lively', 'rooftop', 'sports bar'"],
  "amenities": ["array of relevant amenities, e.g. 'outdoor seating', 'live music', 'parking', 'wifi'"],
  "priceRange": "$" or "$$" or "$$$" or "$$$$",
  "suggestedCategory": "Best match from: Restaurants, Bar & Nightlife, Cafe & Coffee, Fast Food, Retail, Health & Fitness, Beauty & Spa, Entertainment, Sports & Recreation, Other",
  "keywords": ["array of 4-8 search keywords customers might use to find this business"]
}

Only return valid JSON. No markdown fences, no explanation, no extra text.
`.trim();

export const MERCHANT_INSIGHTS_PROMPT = (data: {
  businessName: string;
  dealStats: { total: number; stores: number };
  topDeals: { title: string; saves: number; isFlashSale: boolean; discountPercentage: number | null }[];
  loyaltyStats: { active: boolean; pointsPerDollar?: number | null };
}) => `
You are a business analytics assistant for YOHOP, a location-based deals platform.
Analyze this merchant's performance data and provide actionable insights.

Business: "${data.businessName}"

Deal Stats:
- Total deals created: ${data.dealStats.total}
- Store locations: ${data.dealStats.stores}

Top Deals (by customer saves):
${data.topDeals.map((d, i) => `${i + 1}. "${d.title}" — ${d.saves} saves${d.isFlashSale ? ' (flash sale)' : ''}${d.discountPercentage ? `, ${d.discountPercentage}% off` : ''}`).join('\n')}

Loyalty Program: ${data.loyaltyStats.active ? `Active (${data.loyaltyStats.pointsPerDollar} pts/$)` : 'Not set up'}

Return ONLY a valid JSON object:
{
  "summary": "2-3 sentence performance summary",
  "topInsights": ["array of 3-5 key insights based on the data"],
  "recommendations": [
    {
      "type": "deal | loyalty | event | timing",
      "title": "Short recommendation title",
      "description": "Specific, actionable description"
    }
  ],
  "bestPerformingDealType": "e.g. Flash Sales, Happy Hour, Weekend Specials",
  "growthOpportunity": "One specific growth opportunity sentence"
}

Only return valid JSON. No markdown, no explanation.
`.trim();
