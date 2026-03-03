export const MENU_PARSER_PROMPT = (rawText: string) => `
You are a menu data extraction assistant for YOHOP platform.

Extract all menu items from the text below and return structured data.

Menu Text:
"""
${rawText}
"""

Return ONLY a valid JSON array:
[
  {
    "name": "Item name",
    "description": "One sentence description, or null if not mentioned",
    "price": price as a number in dollars (e.g. 12.99), or null if not mentioned,
    "category": "Suggested category: Appetizers | Main Course | Desserts | Drinks | Sides | Breakfast | Lunch | Dinner | Specials | Other",
    "isAvailable": true,
    "preparationTime": estimated prep time in minutes as a number, or null
  }
]

Rules:
- Extract every item you can identify
- Use null for any field not present in the text
- Do not invent items not mentioned in the text
- Keep descriptions concise (under 20 words)

Only return a valid JSON array. No markdown fences, no explanation.
`.trim();
