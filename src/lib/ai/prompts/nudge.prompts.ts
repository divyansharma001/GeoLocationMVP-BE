export const NUDGE_PERSONALIZATION_PROMPT = (data: {
  nudgeType: string;
  userName: string;
  loyaltyTier: string;
  daysSinceLastCheckIn: number;
  currentStreak: number;
  nearestDeal?: { title: string; merchant: string; discount: string };
  pointsToNextTier?: number;
}) => `
Generate a personalized push notification for a YOHOP user.

User:
- Name: ${data.userName}
- Loyalty Tier: ${data.loyaltyTier}
- Days since last check-in: ${data.daysSinceLastCheckIn}
- Current streak: ${data.currentStreak} days
${data.nearestDeal ? `- Nearest deal: "${data.nearestDeal.title}" at ${data.nearestDeal.merchant} (${data.nearestDeal.discount})` : ''}
${data.pointsToNextTier ? `- Points needed for next tier: ${data.pointsToNextTier}` : ''}

Notification type: ${data.nudgeType}

Return ONLY a valid JSON object:
{
  "title": "Notification title, max 50 characters",
  "body": "Notification body, max 100 characters. Personal, specific, action-oriented.",
  "emoji": "1-2 relevant emojis"
}

Make it feel human, not template-like. Reference the user's actual context.
Only return valid JSON. No markdown, no explanation.
`.trim();
