import { proModel, flashModel, isAIEnabled, cleanJSON } from '../gemini.client';
import {
  INVENTORY_ANALYSIS_PROMPT,
  BULK_SETUP_PROMPT,
  type InventoryAnalysisData,
} from '../prompts/inventory.prompts';
import prisma from '../../prisma';

export interface InventoryAnalysis {
  healthScore: number;
  healthLabel: string;
  summary: string;
  categoryHealth: { category: string; status: string; insight: string; itemsNeedingAttention: number }[];
  restockSuggestions: { itemName: string; currentQty: number; suggestedRestockQty: number; urgency: string; reason: string }[];
  actionItems: string[];
  tips: string[];
}

export interface BulkSetupSuggestion {
  itemId: number;
  inventoryTrackingEnabled: boolean;
  inventoryQuantity: number;
  lowStockThreshold: number;
  allowBackorder: boolean;
  rationale: string;
}

function getItemStatus(item: {
  isAvailable?: boolean | null;
  inventoryTrackingEnabled?: boolean | null;
  inventoryQuantity?: number | null;
  lowStockThreshold?: number | null;
  allowBackorder?: boolean | null;
}): 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'UNTRACKED' {
  if (!item.isAvailable) return 'OUT_OF_STOCK';
  if (!item.inventoryTrackingEnabled) return 'UNTRACKED';
  if ((item.inventoryQuantity ?? 0) <= 0 && !item.allowBackorder) return 'OUT_OF_STOCK';
  if (
    item.lowStockThreshold != null &&
    item.inventoryQuantity != null &&
    item.inventoryQuantity <= item.lowStockThreshold
  ) {
    return 'LOW_STOCK';
  }
  return 'IN_STOCK';
}

export class InventoryAIService {
  async analyzeInventory(merchantId: number): Promise<InventoryAnalysis> {
    if (!isAIEnabled()) throw new Error('AI features are not configured on this server.');

    // @ts-ignore
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { businessName: true },
    });
    if (!merchant) throw new Error('Merchant not found.');

    // @ts-ignore
    const items = await prisma.menuItem.findMany({
      where: { merchantId },
      select: {
        name: true,
        category: true,
        price: true,
        isAvailable: true,
        inventoryTrackingEnabled: true,
        inventoryQuantity: true,
        lowStockThreshold: true,
        allowBackorder: true,
        hasVariants: true,
        variants: {
          select: {
            label: true,
            price: true,
            inventoryQuantity: true,
            lowStockThreshold: true,
            isAvailable: true,
          },
        },
      },
    });

    // Aggregate data
    const categoryMap = new Map<string, { items: number; low: number; out: number; totalQty: number; trackedCount: number }>();
    const criticalItems: InventoryAnalysisData['criticalItems'] = [];
    let trackedItems = 0;
    let untrackedItems = 0;
    let healthyItemCount = 0;

    for (const item of items) {
      const cat = item.category || 'Uncategorized';
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, { items: 0, low: 0, out: 0, totalQty: 0, trackedCount: 0 });
      }
      const catData = categoryMap.get(cat)!;
      catData.items += 1;

      const status = getItemStatus(item);

      if (status === 'UNTRACKED') {
        untrackedItems += 1;
      } else {
        trackedItems += 1;
        catData.trackedCount += 1;
        catData.totalQty += item.inventoryQuantity ?? 0;

        if (status === 'LOW_STOCK') {
          catData.low += 1;
          if (criticalItems.length < 20) {
            criticalItems.push({
              name: item.name,
              category: cat,
              qty: item.inventoryQuantity ?? 0,
              threshold: item.lowStockThreshold ?? 0,
              status: 'LOW_STOCK',
              price: item.price,
              allowBackorder: item.allowBackorder ?? false,
            });
          }
        } else if (status === 'OUT_OF_STOCK') {
          catData.out += 1;
          if (criticalItems.length < 20) {
            criticalItems.push({
              name: item.name,
              category: cat,
              qty: item.inventoryQuantity ?? 0,
              threshold: item.lowStockThreshold ?? 0,
              status: 'OUT_OF_STOCK',
              price: item.price,
              allowBackorder: item.allowBackorder ?? false,
            });
          }
        } else {
          healthyItemCount += 1;
        }
      }
    }

    const categories = Array.from(categoryMap.entries()).map(([name, d]) => ({
      name,
      itemCount: d.items,
      lowCount: d.low,
      outCount: d.out,
      avgQty: d.trackedCount > 0 ? Math.round(d.totalQty / d.trackedCount) : 0,
    }));

    const summaryData: InventoryAnalysisData = {
      businessName: merchant.businessName,
      totalItems: items.length,
      trackedItems,
      untrackedItems,
      categories,
      criticalItems,
      healthyItemCount,
    };

    const prompt = INVENTORY_ANALYSIS_PROMPT(summaryData);
    const result = await proModel.generateContent(prompt);
    const raw = result.response.text();
    const parsed = JSON.parse(cleanJSON(raw));

    // Defensive validation
    return {
      healthScore: typeof parsed.healthScore === 'number' ? Math.min(100, Math.max(0, parsed.healthScore)) : 50,
      healthLabel: parsed.healthLabel || 'Unknown',
      summary: parsed.summary || 'Unable to generate summary.',
      categoryHealth: Array.isArray(parsed.categoryHealth) ? parsed.categoryHealth : [],
      restockSuggestions: Array.isArray(parsed.restockSuggestions) ? parsed.restockSuggestions : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      tips: Array.isArray(parsed.tips) ? parsed.tips : [],
    };
  }

  async suggestBulkSetup(merchantId: number): Promise<BulkSetupSuggestion[]> {
    if (!isAIEnabled()) throw new Error('AI features are not configured on this server.');

    // @ts-ignore
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { businessName: true },
    });
    if (!merchant) throw new Error('Merchant not found.');

    // @ts-ignore
    const allItems = await prisma.menuItem.findMany({
      where: { merchantId },
      select: {
        id: true,
        name: true,
        category: true,
        price: true,
        inventoryTrackingEnabled: true,
        inventoryQuantity: true,
        lowStockThreshold: true,
      },
    });

    const untrackedItems = allItems
      .filter((i: any) => !i.inventoryTrackingEnabled)
      .slice(0, 30)
      .map((i: any) => ({ id: i.id, name: i.name, category: i.category, price: i.price }));

    if (untrackedItems.length === 0) return [];

    const trackedItemExamples = allItems
      .filter((i: any) => i.inventoryTrackingEnabled)
      .slice(0, 5)
      .map((i: any) => ({
        name: i.name,
        category: i.category,
        qty: i.inventoryQuantity ?? 0,
        threshold: i.lowStockThreshold ?? 0,
      }));

    const prompt = BULK_SETUP_PROMPT({
      businessName: merchant.businessName,
      trackedItemExamples,
      untrackedItems,
    });

    const result = await flashModel.generateContent(prompt);
    const raw = result.response.text();
    const parsed = JSON.parse(cleanJSON(raw));

    if (!Array.isArray(parsed)) return [];

    // Validate: only return suggestions for items we actually sent
    const validIds = new Set(untrackedItems.map((i) => i.id));
    return parsed
      .filter((s: any) => validIds.has(s.itemId))
      .map((s: any) => ({
        itemId: s.itemId,
        inventoryTrackingEnabled: true,
        inventoryQuantity: typeof s.inventoryQuantity === 'number' && s.inventoryQuantity >= 0 ? s.inventoryQuantity : 20,
        lowStockThreshold: typeof s.lowStockThreshold === 'number' && s.lowStockThreshold >= 0 ? s.lowStockThreshold : 5,
        allowBackorder: typeof s.allowBackorder === 'boolean' ? s.allowBackorder : false,
        rationale: s.rationale || '',
      }));
  }
}
