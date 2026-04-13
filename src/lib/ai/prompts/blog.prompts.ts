export const BLOG_DRAFT_PROMPT = (
  topic: string,
  businessName: string,
  businessType: string,
  tone?: string,
) => `
You are a blog content writer for "${businessName}", a ${businessType} business on YOHOP, a local discovery platform.

Write a blog post about this topic:
"${topic}"

Tone: ${tone || 'friendly and informative'}

Return ONLY a valid JSON object:
{
  "title": "Compelling blog post title, max 100 characters",
  "excerpt": "1-2 sentence summary for previews, max 200 characters",
  "content": "Full blog post in clean HTML (use <h2>, <p>, <ul>, <li>, <strong>, <em> tags). 400-800 words. Use multiple paragraphs and at least one subheading.",
  "tags": ["array of 3-5 relevant tags"],
  "suggestedCategory": "A category name that fits this post"
}

Rules:
- Write from the merchant's perspective using "we" language
- Include actionable tips or interesting information for customers
- Use proper HTML formatting with paragraphs, subheadings, and lists
- Keep it engaging and locally relevant
- Do not use markdown, only HTML tags
- Do not wrap the HTML content in a root tag — just use <h2>, <p>, <ul> etc. directly

Only return valid JSON. No markdown fences, no explanation.
`.trim();
