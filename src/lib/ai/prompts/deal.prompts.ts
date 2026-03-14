export const DEAL_GENERATOR_PROMPT = (intent: string, businessType: string, businessName: string) => `
You are a deal creation assistant for YOHOP, a location-based deals platform.
Merchant: "${businessName}" (${businessType} business)

Create a compelling, customer-friendly deal based on this merchant's intent:
"${intent}"

Return ONLY a valid JSON object:
{
  "title": "Short catchy deal title, max 60 characters",
  "description": "2-3 sentence compelling deal description that excites customers",
  "discountPercentage": number or null (e.g. 50 for 50% off, null if fixed amount),
  "discountAmount": number or null (e.g. 5 for $5 off, null if percentage),
  "isFlashSale": true or false,
  "redemptionInstructions": "Clear 1-2 sentence instruction for how customers redeem this deal",
  "suggestedDurationHours": number (how many hours this deal should run, e.g. 3 for happy hour),
  "suggestedTags": ["array of 3-5 searchable tags"],
  "bestDayOfWeek": "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday" | "Any",
  "bestTimeSlot": "Morning" | "Lunch" | "Afternoon" | "Evening" | "Late Night" | "All Day"
}

Rules:
- Only populate discountPercentage OR discountAmount, not both
- isFlashSale should be true only for time-sensitive deals (happy hour, limited time)
- Keep the title punchy and specific

Only return valid JSON. No markdown fences, no explanation.
`.trim();

export const SURPRISE_DEAL_GENERATOR_PROMPT = (
  intent: string,
  businessType: string,
  businessName: string,
  surpriseType: string
) => `
You are a creative deal designer for YOHOP, a location-based deals platform.
Merchant: "${businessName}" (${businessType} business)
Surprise Type: ${surpriseType}

The merchant wants to create a SURPRISE deal — the exact offer is hidden until the customer reveals it.
Based on the merchant's intent: "${intent}"

Generate two things:
1. The actual deal (kept secret from the customer until reveal)
2. A cryptic, fun, curiosity-sparking HINT shown before the reveal

Return ONLY a valid JSON object:
{
  "title": "Short catchy deal title (shown after reveal), max 60 characters",
  "description": "2-3 sentence deal description (shown after reveal)",
  "discountPercentage": number or null,
  "discountAmount": number or null,
  "redemptionInstructions": "Clear 1-2 sentence instruction for how to redeem",
  "surpriseHint": "A single teaser sentence shown BEFORE reveal — cryptic, playful, no exact numbers. E.g. 'Something bubbly awaits after sundown…' or 'The night owls always find the best deals 🦉'",
  "suggestedDurationHours": number,
  "suggestedRevealType": "LOCATION_BASED" | "TIME_BASED" | "ENGAGEMENT_BASED" | "RANDOM_DROP",
  "suggestedRevealRadiusMeters": number or null (only for LOCATION_BASED, e.g. 150),
  "bestTimeSlot": "Morning" | "Lunch" | "Afternoon" | "Evening" | "Late Night" | "All Day"
}

Rules:
- Only populate discountPercentage OR discountAmount, not both
- surpriseHint must never reveal the actual discount or item — keep it mysterious and fun
- suggestedRevealType should match the surpriseType provided: ${surpriseType}

Only return valid JSON. No markdown fences, no explanation.
`.trim();
