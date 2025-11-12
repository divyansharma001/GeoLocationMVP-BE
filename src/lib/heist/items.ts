/**
 * Heist Item Management
 * 
 * Functions for managing heist items (Sword, Hammer, Shield) and their effects.
 */

import { PrismaClient, HeistItemType, HeistItemEffectType, Prisma, CoinTransactionType } from '@prisma/client';
import prisma from '../prisma';

export interface ItemEffect {
  type: HeistItemEffectType;
  value: number;
}

export interface ActiveItem {
  id: number;
  itemId: number;
  name: string;
  type: HeistItemType;
  effectType: HeistItemEffectType;
  effectValue: number;
  usesRemaining: number | null;
  expiresAt: Date | null;
}

export interface ItemEffectResult {
  finalStealAmount: number;
  itemsUsed: Array<{
    itemId: number;
    itemName: string;
    effectApplied: any;
  }>;
  shieldBlocked: boolean;
}

/**
 * Get all available items for purchase
 */
export async function getAvailableItems() {
  return prisma.heistItem.findMany({
    where: { isActive: true },
    orderBy: { coinCost: 'asc' },
  });
}

/**
 * Get user's active inventory
 */
export async function getUserInventory(userId: number): Promise<ActiveItem[]> {
  const now = new Date();
  
  const userItems = await prisma.userHeistItem.findMany({
    where: {
      userId,
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
      AND: [
        {
          OR: [
            { usesRemaining: null },
            { usesRemaining: { gt: 0 } },
          ],
        },
      ],
    },
    include: {
      item: true,
    },
    orderBy: {
      item: {
        type: 'asc',
      },
    },
  });

  // Filter out expired items and update them
  const activeItems: ActiveItem[] = [];
  const itemsToDeactivate: number[] = [];

  for (const userItem of userItems) {
    // Check expiration
    if (userItem.expiresAt && userItem.expiresAt <= now) {
      itemsToDeactivate.push(userItem.id);
      continue;
    }

    // Check uses
    if (userItem.usesRemaining !== null && userItem.usesRemaining <= 0) {
      itemsToDeactivate.push(userItem.id);
      continue;
    }

    activeItems.push({
      id: userItem.id,
      itemId: userItem.itemId,
      name: userItem.item.name,
      type: userItem.item.type,
      effectType: userItem.item.effectType,
      effectValue: userItem.item.effectValue,
      usesRemaining: userItem.usesRemaining,
      expiresAt: userItem.expiresAt,
    });
  }

  // Deactivate expired/used items
  if (itemsToDeactivate.length > 0) {
    await prisma.userHeistItem.updateMany({
      where: { id: { in: itemsToDeactivate } },
      data: { isActive: false },
    });
  }

  return activeItems;
}

/**
 * Purchase an item with coins
 */
export async function purchaseItem(
  userId: number,
  itemId: number,
  tx?: Prisma.TransactionClient
): Promise<{ success: boolean; error?: string; inventory?: ActiveItem[] }> {
  const client = tx || prisma;

  try {
    // Get item details
    const item = await client.heistItem.findUnique({
      where: { id: itemId },
    });

    if (!item || !item.isActive) {
      return { success: false, error: 'Item not found or not available' };
    }

    // Get user's coin balance
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { coins: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    if (user.coins < item.coinCost) {
      return { success: false, error: 'Insufficient coins' };
    }

    // Deduct coins
    await client.user.update({
      where: { id: userId },
      data: { coins: { decrement: item.coinCost } },
    });

    // Create coin transaction record
    const balanceAfter = user.coins - item.coinCost;
    await client.coinTransaction.create({
      data: {
        userId,
        type: CoinTransactionType.SPENT,
        amount: item.coinCost,
        balanceBefore: user.coins,
        balanceAfter,
        description: `Purchased ${item.name}`,
        metadata: {
          itemId: item.id,
          itemName: item.name,
        },
      },
    });

    // Add item to inventory
    const expiresAt = item.durationHours
      ? new Date(Date.now() + item.durationHours * 60 * 60 * 1000)
      : null;

    const usesRemaining = item.maxUses || null;

    // Check if user already has this item
    const existingItem = await client.userHeistItem.findUnique({
      where: {
        userId_itemId: {
          userId,
          itemId,
        },
      },
    });

    if (existingItem) {
      // Update quantity or create new entry if time-limited
      if (item.durationHours) {
        // Time-limited items get separate entries
        await client.userHeistItem.create({
          data: {
            userId,
            itemId,
            quantity: 1,
            expiresAt,
            usesRemaining,
            isActive: true,
          },
        });
      } else {
        // Unlimited items increase quantity
        await client.userHeistItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: { increment: 1 },
            usesRemaining: usesRemaining
              ? (existingItem.usesRemaining || 0) + usesRemaining
              : null,
          },
        });
      }
    } else {
      // Create new inventory entry
      await client.userHeistItem.create({
        data: {
          userId,
          itemId,
          quantity: 1,
          expiresAt,
          usesRemaining,
          isActive: true,
        },
      });
    }

    // Get updated inventory
    const inventory = await getUserInventory(userId);

    return { success: true, inventory };
  } catch (error: any) {
    console.error('Error purchasing item:', error);
    return { success: false, error: error.message || 'Failed to purchase item' };
  }
}

/**
 * Get active items for attacker (Sword, Hammer)
 */
export async function getAttackerItems(userId: number): Promise<ActiveItem[]> {
  const inventory = await getUserInventory(userId);
  return inventory.filter(
    (item) => item.type === HeistItemType.SWORD || item.type === HeistItemType.HAMMER
  );
}

/**
 * Get active items for victim (Shield)
 */
export async function getVictimItems(userId: number): Promise<ActiveItem[]> {
  const inventory = await getUserInventory(userId);
  return inventory.filter((item) => item.type === HeistItemType.SHIELD);
}

/**
 * Apply item effects to calculate final steal amount
 * This function can work with or without a transaction context
 */
export async function applyItemEffects(
  attackerId: number,
  victimId: number,
  baseStealAmount: number,
  baseStealPercentage: number,
  victimMonthlyPoints: number,
  config: { minProtectionPercentage: number },
  tx?: Prisma.TransactionClient
): Promise<ItemEffectResult> {
  const client = tx || prisma;
  
  // Get active items directly from database within transaction
  const now = new Date();
  const [attackerItemsData, victimItemsData] = await Promise.all([
    client.userHeistItem.findMany({
      where: {
        userId: attackerId,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
        AND: [
          {
            OR: [
              { usesRemaining: null },
              { usesRemaining: { gt: 0 } },
            ],
          },
        ],
        item: {
          type: { in: [HeistItemType.SWORD, HeistItemType.HAMMER] },
          isActive: true,
        },
      },
      include: { item: true },
    }),
    client.userHeistItem.findMany({
      where: {
        userId: victimId,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
        AND: [
          {
            OR: [
              { usesRemaining: null },
              { usesRemaining: { gt: 0 } },
            ],
          },
        ],
        item: {
          type: HeistItemType.SHIELD,
          isActive: true,
        },
      },
      include: { item: true },
    }),
  ]);

  const attackerItems: ActiveItem[] = attackerItemsData.map(ui => ({
    id: ui.id,
    itemId: ui.itemId,
    name: ui.item.name,
    type: ui.item.type,
    effectType: ui.item.effectType,
    effectValue: ui.item.effectValue,
    usesRemaining: ui.usesRemaining,
    expiresAt: ui.expiresAt,
  }));

  const victimItems: ActiveItem[] = victimItemsData.map(ui => ({
    id: ui.id,
    itemId: ui.itemId,
    name: ui.item.name,
    type: ui.item.type,
    effectType: ui.item.effectType,
    effectValue: ui.item.effectValue,
    usesRemaining: ui.usesRemaining,
    expiresAt: ui.expiresAt,
  }));

  let finalStealAmount = baseStealAmount;
  const itemsUsed: Array<{ itemId: number; itemName: string; effectApplied: any }> = [];
  let shieldBlocked = false;

  // Apply attacker items (Sword, Hammer)
  // Only use the highest effect of each type (no stacking)
  let highestStealPercentageBoost = 0;
  let highestStealBonus = 0;

  for (const item of attackerItems) {
    if (item.effectType === HeistItemEffectType.INCREASE_STEAL_PERCENTAGE) {
      if (item.effectValue > highestStealPercentageBoost) {
        highestStealPercentageBoost = item.effectValue;
      }
    } else if (item.effectType === HeistItemEffectType.INCREASE_STEAL_BONUS) {
      if (item.effectValue > highestStealBonus) {
        highestStealBonus = item.effectValue;
      }
    }
  }

  // Apply percentage boost (e.g., +20% means 5% becomes 6%)
  if (highestStealPercentageBoost > 0) {
    const boostedPercentage = baseStealPercentage * (1 + highestStealPercentageBoost / 100);
    finalStealAmount = Math.floor(victimMonthlyPoints * boostedPercentage);
    
    const swordItem = attackerItems.find(
      (i) => i.effectType === HeistItemEffectType.INCREASE_STEAL_PERCENTAGE
    );
    if (swordItem) {
      itemsUsed.push({
        itemId: swordItem.itemId,
        itemName: swordItem.name,
        effectApplied: { boost: highestStealPercentageBoost, newPercentage: boostedPercentage },
      });
    }
  }

  // Apply bonus points (flat addition)
  if (highestStealBonus > 0) {
    finalStealAmount += highestStealBonus;
    
    const hammerItem = attackerItems.find(
      (i) => i.effectType === HeistItemEffectType.INCREASE_STEAL_BONUS
    );
    if (hammerItem) {
      itemsUsed.push({
        itemId: hammerItem.itemId,
        itemName: hammerItem.name,
        effectApplied: { bonus: highestStealBonus },
      });
    }
  }

  // Apply victim shield (reduces theft)
  let highestTheftReduction = 0;
  let highestBlockChance = 0;

  for (const item of victimItems) {
    if (item.effectType === HeistItemEffectType.REDUCE_THEFT_PERCENTAGE) {
      if (item.effectValue > highestTheftReduction) {
        highestTheftReduction = item.effectValue;
      }
    } else if (item.effectType === HeistItemEffectType.BLOCK_THEFT_CHANCE) {
      if (item.effectValue > highestBlockChance) {
        highestBlockChance = item.effectValue;
      }
    }
  }

  // Check for block chance
  if (highestBlockChance > 0) {
    const blockRoll = Math.random() * 100;
    if (blockRoll < highestBlockChance) {
      shieldBlocked = true;
      finalStealAmount = 0;
      
      const shieldItem = victimItems.find(
        (i) => i.effectType === HeistItemEffectType.BLOCK_THEFT_CHANCE
      );
      if (shieldItem) {
        itemsUsed.push({
          itemId: shieldItem.itemId,
          itemName: shieldItem.name,
          effectApplied: { blocked: true, blockChance: highestBlockChance },
        });
      }
      
      return { finalStealAmount: 0, itemsUsed, shieldBlocked: true };
    }
  }

  // Apply theft reduction (e.g., -40% means reduce by 40%)
  if (highestTheftReduction > 0 && !shieldBlocked) {
    finalStealAmount = Math.floor(finalStealAmount * (1 - highestTheftReduction / 100));
    
    const shieldItem = victimItems.find(
      (i) => i.effectType === HeistItemEffectType.REDUCE_THEFT_PERCENTAGE
    );
    if (shieldItem) {
      itemsUsed.push({
        itemId: shieldItem.itemId,
        itemName: shieldItem.name,
        effectApplied: { reduction: highestTheftReduction },
      });
    }
  }

  // Ensure minimum protection (victim keeps at least X% of points)
  const minProtectedPoints = Math.floor(victimMonthlyPoints * config.minProtectionPercentage);
  const maxStealable = victimMonthlyPoints - minProtectedPoints;
  
  if (finalStealAmount > maxStealable) {
    finalStealAmount = maxStealable;
  }

  // Ensure non-negative
  if (finalStealAmount < 0) {
    finalStealAmount = 0;
  }

  return { finalStealAmount, itemsUsed, shieldBlocked };
}

/**
 * Record item usage and decrement uses
 */
export async function recordItemUsage(
  heistId: number,
  userId: number,
  itemId: number,
  effectApplied: any,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx || prisma;

  // Record usage
  await client.heistItemUsage.create({
    data: {
      heistId,
      userId,
      itemId,
      effectApplied,
    },
  });

  // Decrement uses if limited-use item
  const userItem = await client.userHeistItem.findFirst({
    where: {
      userId,
      itemId,
      isActive: true,
      OR: [
        { usesRemaining: null },
        { usesRemaining: { gt: 0 } },
      ],
    },
  });

  if (userItem && userItem.usesRemaining !== null && userItem.usesRemaining > 0) {
    const newUses = userItem.usesRemaining - 1;
    
    if (newUses <= 0) {
      // Deactivate if no uses left
      await client.userHeistItem.update({
        where: { id: userItem.id },
        data: { isActive: false, usesRemaining: 0 },
      });
    } else {
      // Decrement uses
      await client.userHeistItem.update({
        where: { id: userItem.id },
        data: { usesRemaining: newUses },
      });
    }
  }
}

/**
 * Check if item is active and usable
 */
export async function checkItemActive(
  userId: number,
  itemId: number
): Promise<boolean> {
  const now = new Date();
  
  const userItem = await prisma.userHeistItem.findFirst({
    where: {
      userId,
      itemId,
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
      AND: [
        {
          OR: [
            { usesRemaining: null },
            { usesRemaining: { gt: 0 } },
          ],
        },
      ],
    },
  });

  return !!userItem;
}

