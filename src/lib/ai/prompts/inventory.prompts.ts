export interface InventoryAnalysisData {
  businessName: string;
  totalItems: number;
  trackedItems: number;
  untrackedItems: number;
  categories: {
    name: string;
    itemCount: number;
    lowCount: number;
    outCount: number;
    avgQty: number;
  }[];
  criticalItems: {
    name: string;
    category: string;
    qty: number;
    threshold: number;
    status: 'LOW_STOCK' | 'OUT_OF_STOCK';
    price: number;
    allowBackorder: boolean;
  }[];
  healthyItemCount: number;
}

export interface BulkSetupData {
  businessName: string;
  trackedItemExamples: { name: string; category: string; qty: number; threshold: number }[];
  untrackedItems: { id: number; name: string; category: string; price: number }[];
}

export const INVENTORY_ANALYSIS_PROMPT = (data: InventoryAnalysisData) => `
You are an inventory management advisor for "${data.businessName}" on YOHOP, a local commerce platform.

Analyze this inventory snapshot and provide actionable insights.

Inventory Overview:
- Total items: ${data.totalItems}
- Tracked: ${data.trackedItems}
- Untracked: ${data.untrackedItems}
- Healthy (in stock): ${data.healthyItemCount}

Category Breakdown:
${data.categories.map(c => `- ${c.name}: ${c.itemCount} items, ${c.lowCount} low, ${c.outCount} out, avg qty ${c.avgQty}`).join('\n')}

Critical Items (need attention):
${data.criticalItems.length > 0
    ? data.criticalItems.map(i => `- "${i.name}" [${i.category}]: ${i.qty} left (threshold: ${i.threshold}), $${i.price}, status: ${i.status}${i.allowBackorder ? ', backorder ON' : ''}`).join('\n')
    : '- None — all tracked items are above their thresholds.'}

Return ONLY a valid JSON object:
{
  "healthScore": 0-100,
  "healthLabel": "Excellent" | "Good" | "Fair" | "Poor" | "Critical",
  "summary": "2-3 sentence overview of inventory health",
  "categoryHealth": [
    {
      "category": "category name",
      "status": "healthy" | "warning" | "critical",
      "insight": "one sentence about this category's inventory status",
      "itemsNeedingAttention": 0
    }
  ],
  "restockSuggestions": [
    {
      "itemName": "exact item name from the data above",
      "currentQty": 0,
      "suggestedRestockQty": 0,
      "urgency": "high" | "medium" | "low",
      "reason": "short explanation"
    }
  ],
  "actionItems": ["array of 2-5 prioritized action items"],
  "tips": ["array of 1-3 general inventory management tips relevant to this business"]
}

Rules:
- healthScore: 90+ if no issues, 70-89 if minor issues, 40-69 if several items need attention, below 40 if critical.
- Only suggest restock for items that are LOW_STOCK or OUT_OF_STOCK.
- suggestedRestockQty should be a reasonable restock amount (not the total target, but the amount to add).
- Use exact item names from the data — do not invent items.
- Keep insights specific and actionable, not generic.

Only return valid JSON. No markdown, no explanation.
`.trim();

export const BULK_SETUP_PROMPT = (data: BulkSetupData) => `
You are an inventory setup assistant for "${data.businessName}" on YOHOP.

The merchant has ${data.untrackedItems.length} items without inventory tracking. Suggest initial settings for each.

${data.trackedItemExamples.length > 0 ? `Reference — items already tracked:
${data.trackedItemExamples.map(e => `- "${e.name}" [${e.category}]: qty ${e.qty}, threshold ${e.threshold}`).join('\n')}
` : ''}
Items needing setup:
${data.untrackedItems.map(i => `- id:${i.id} "${i.name}" [${i.category}] $${i.price}`).join('\n')}

Return ONLY a valid JSON array:
[
  {
    "itemId": 0,
    "inventoryTrackingEnabled": true,
    "inventoryQuantity": 0,
    "lowStockThreshold": 0,
    "allowBackorder": false,
    "rationale": "short reason for these values"
  }
]

Rules:
- Return one entry per untracked item, using the exact itemId from the data.
- inventoryQuantity should be a reasonable starting stock (10-50 for most items, adjust by price and category).
- lowStockThreshold should be 15-25% of inventoryQuantity.
- allowBackorder: true for high-price or unique items, false for common consumables.
- Use the tracked item examples as a reference for similar categories.

Only return valid JSON. No markdown, no explanation.
`.trim();
