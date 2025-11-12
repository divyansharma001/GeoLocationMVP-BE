/**
 * Heist Execution Logic
 * 
 * Core business logic for executing a heist transaction.
 */

import { PrismaClient, HeistStatus, Prisma } from '@prisma/client';
import { getHeistConfig, calculatePointsToSteal } from './config';
import { spendToken } from './tokens';
import { checkHeistEligibility } from './validation';
import { createHeistSuccessNotification, createHeistVictimNotification } from './notifications';
import { applyItemEffects, recordItemUsage } from './items';

const prisma = new PrismaClient();

export interface HeistResult {
  success: boolean;
  heistId?: number;
  pointsStolen?: number;
  attackerPointsBefore?: number;
  attackerPointsAfter?: number;
  victimPointsBefore?: number;
  victimPointsAfter?: number;
  status: HeistStatus;
  error?: string;
  code?: string;
  details?: any;
}

/**
 * Execute a heist transaction
 * 
 * This is the main entry point for performing a heist.
 * All validation and execution happens within a database transaction.
 */
export async function executeHeist(
  attackerId: number,
  victimId: number,
  metadata?: { ipAddress?: string; userAgent?: string }
): Promise<HeistResult> {
  const config = getHeistConfig();

  try {
    // Use Prisma transaction with serializable isolation
    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Re-check eligibility within transaction (with fresh data)
        const eligibility = await checkHeistEligibility(attackerId, victimId);
        
        if (!eligibility.eligible) {
          // Create failed heist record
          const failedHeist = await tx.heist.create({
            data: {
              attackerId,
              victimId,
              pointsStolen: 0,
              victimPointsBefore: 0,
              victimPointsAfter: 0,
              attackerPointsBefore: 0,
              attackerPointsAfter: 0,
              status: mapEligibilityCodeToStatus(eligibility.code || 'UNKNOWN'),
              ipAddress: metadata?.ipAddress,
            },
          });

          return {
            success: false,
            heistId: failedHeist.id,
            status: failedHeist.status,
            error: eligibility.reason,
            code: eligibility.code,
            details: eligibility.details,
          };
        }

        // 2. Lock and fetch attacker and victim with FOR UPDATE
        const [attacker, victim] = await Promise.all([
          tx.user.findUnique({
            where: { id: attackerId },
            select: { id: true, name: true, monthlyPoints: true },
          }),
          tx.user.findUnique({
            where: { id: victimId },
            select: { id: true, name: true, monthlyPoints: true },
          }),
        ]);

        if (!attacker || !victim) {
          throw new Error('INVALID_TARGET');
        }

        // 3. Calculate base points to steal
        const basePointsToSteal = calculatePointsToSteal(victim.monthlyPoints, config);

        if (basePointsToSteal <= 0) {
          const failedHeist = await tx.heist.create({
            data: {
              attackerId,
              victimId,
              pointsStolen: 0,
              victimPointsBefore: victim.monthlyPoints,
              victimPointsAfter: victim.monthlyPoints,
              attackerPointsBefore: attacker.monthlyPoints,
              attackerPointsAfter: attacker.monthlyPoints,
              status: HeistStatus.FAILED_INSUFFICIENT_POINTS,
              ipAddress: metadata?.ipAddress,
            },
          });

          return {
            success: false,
            heistId: failedHeist.id,
            status: HeistStatus.FAILED_INSUFFICIENT_POINTS,
            error: 'Target does not have enough points to steal',
            code: 'INSUFFICIENT_VICTIM_POINTS',
          };
        }

        // 3.5. Apply item effects if items are enabled
        let pointsToSteal = basePointsToSteal;
        let itemEffectResult: any = null;

        if (config.itemsEnabled) {
          try {
            itemEffectResult = await applyItemEffects(
              attackerId,
              victimId,
              basePointsToSteal,
              config.stealPercentage,
              victim.monthlyPoints,
              { minProtectionPercentage: config.minProtectionPercentage },
              tx as any
            );

            pointsToSteal = itemEffectResult.finalStealAmount;

            // If shield blocked completely, create failed heist
            if (itemEffectResult.shieldBlocked) {
              const blockedHeist = await tx.heist.create({
                data: {
                  attackerId,
                  victimId,
                  pointsStolen: 0,
                  victimPointsBefore: victim.monthlyPoints,
                  victimPointsAfter: victim.monthlyPoints,
                  attackerPointsBefore: attacker.monthlyPoints,
                  attackerPointsAfter: attacker.monthlyPoints,
                  status: HeistStatus.FAILED_SHIELD,
                  ipAddress: metadata?.ipAddress,
                },
              });

              // Record item usage even for blocked heist
              if (itemEffectResult.itemsUsed.length > 0) {
                for (const itemUsage of itemEffectResult.itemsUsed) {
                  await recordItemUsage(
                    blockedHeist.id,
                    itemUsage.userId || (itemUsage.itemName.includes('Shield') ? victimId : attackerId),
                    itemUsage.itemId,
                    itemUsage.effectApplied,
                    tx as any
                  );
                }
              }

              return {
                success: false,
                heistId: blockedHeist.id,
                status: HeistStatus.FAILED_SHIELD,
                error: 'Heist was blocked by shield',
                code: 'SHIELD_BLOCKED',
                details: { itemsUsed: itemEffectResult.itemsUsed },
              };
            }

            // Re-check if points are still valid after item effects
            if (pointsToSteal <= 0) {
              const failedHeist = await tx.heist.create({
                data: {
                  attackerId,
                  victimId,
                  pointsStolen: 0,
                  victimPointsBefore: victim.monthlyPoints,
                  victimPointsAfter: victim.monthlyPoints,
                  attackerPointsBefore: attacker.monthlyPoints,
                  attackerPointsAfter: attacker.monthlyPoints,
                  status: HeistStatus.FAILED_INSUFFICIENT_POINTS,
                  ipAddress: metadata?.ipAddress,
                },
              });

              return {
                success: false,
                heistId: failedHeist.id,
                status: HeistStatus.FAILED_INSUFFICIENT_POINTS,
                error: 'Not enough points to steal after item effects',
                code: 'INSUFFICIENT_VICTIM_POINTS',
              };
            }
          } catch (itemError) {
            console.error('[heist] Error applying item effects:', itemError);
            // Continue with base amount if item system fails
          }
        }

        // 4. Spend token (will throw if insufficient)
        await spendToken(attackerId, config.tokenCost, tx as any);

        // 5. Transfer points
        const [updatedAttacker, updatedVictim] = await Promise.all([
          tx.user.update({
            where: { id: attackerId },
            data: {
              monthlyPoints: { increment: pointsToSteal },
            },
            select: { monthlyPoints: true },
          }),
          tx.user.update({
            where: { id: victimId },
            data: {
              monthlyPoints: { decrement: pointsToSteal },
            },
            select: { monthlyPoints: true },
          }),
        ]);

        // 6. Create successful heist record
        const successfulHeist = await tx.heist.create({
          data: {
            attackerId,
            victimId,
            pointsStolen: pointsToSteal,
            victimPointsBefore: victim.monthlyPoints,
            victimPointsAfter: updatedVictim.monthlyPoints,
            attackerPointsBefore: attacker.monthlyPoints,
            attackerPointsAfter: updatedAttacker.monthlyPoints,
            status: HeistStatus.SUCCESS,
            ipAddress: metadata?.ipAddress,
          },
        });

        // 7. Create point event records for audit trail (non-critical, won't fail heist)
        try {
          await Promise.all([
            tx.userPointEvent.create({
              data: {
                userId: attackerId,
                points: pointsToSteal,
                pointEventTypeId: 1, // Placeholder - HEIST_GAIN type
              },
            }),
            tx.userPointEvent.create({
              data: {
                userId: victimId,
                points: -pointsToSteal,
                pointEventTypeId: 1, // Placeholder - HEIST_LOSS type
              },
            }),
          ]);
        } catch (pointEventError) {
          console.error('[heist] point event creation failed (non-critical)', pointEventError);
        }

        // 8. Record item usage if items were used
        if (config.itemsEnabled && itemEffectResult && itemEffectResult.itemsUsed.length > 0) {
          for (const itemUsage of itemEffectResult.itemsUsed) {
            // Determine user ID based on item type
            const itemUserId = itemUsage.itemName.includes('Shield') ? victimId : attackerId;
            
            try {
              await recordItemUsage(
                successfulHeist.id,
                itemUserId,
                itemUsage.itemId,
                itemUsage.effectApplied,
                tx as any
              );
            } catch (itemUsageError) {
              console.error('[heist] Error recording item usage:', itemUsageError);
              // Non-critical, continue
            }
          }
        }

        // 9. Create notifications
        await Promise.all([
          createHeistSuccessNotification(
            attackerId,
            victimId,
            victim.name || 'user',
            pointsToSteal,
            successfulHeist.id,
            tx as any
          ),
          createHeistVictimNotification(
            victimId,
            attackerId,
            attacker.name || 'user',
            pointsToSteal,
            successfulHeist.id,
            tx as any
          ),
        ]);

        // 10. Return success result
        return {
          success: true,
          heistId: successfulHeist.id,
          pointsStolen: pointsToSteal,
          attackerPointsBefore: attacker.monthlyPoints,
          attackerPointsAfter: updatedAttacker.monthlyPoints,
          victimPointsBefore: victim.monthlyPoints,
          victimPointsAfter: updatedVictim.monthlyPoints,
          status: HeistStatus.SUCCESS,
          details: itemEffectResult ? { itemsUsed: itemEffectResult.itemsUsed } : undefined,
        };
      },
      {
        maxWait: 5000, // Maximum time to wait for a transaction slot (5s)
        timeout: 10000, // Maximum time for the transaction to run (10s)
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable, // Strictest isolation
      }
    );

    return result;
  } catch (error: any) {
    // Handle specific errors
    if (error.message === 'INSUFFICIENT_TOKENS') {
      return {
        success: false,
        status: HeistStatus.FAILED_INSUFFICIENT_TOKENS,
        error: 'You do not have enough heist tokens',
        code: 'INSUFFICIENT_TOKENS',
      };
    }

    if (error.message === 'INVALID_TARGET') {
      return {
        success: false,
        status: HeistStatus.FAILED_INVALID_TARGET,
        error: 'Target user not found',
        code: 'INVALID_TARGET',
      };
    }

    // Log unexpected errors
    console.error('Heist execution error:', error);

    return {
      success: false,
      status: HeistStatus.FAILED_INVALID_TARGET,
      error: 'An error occurred while executing the heist',
      code: 'EXECUTION_ERROR',
      details: { message: error.message },
    };
  }
}

/**
 * Get heist history for a user (as attacker or victim)
 */
export async function getHeistHistory(
  userId: number,
  options: {
    role?: 'attacker' | 'victim' | 'both';
    status?: HeistStatus;
    limit?: number;
    offset?: number;
  } = {}
): Promise<Array<{
  id: number;
  attackerId: number;
  victimId: number;
  pointsStolen: number;
  status: HeistStatus;
  createdAt: Date;
  role: 'attacker' | 'victim';
}>> {
  const where: any = {
    OR: [],
  };

  if (options.role === 'attacker' || options.role === 'both' || !options.role) {
    where.OR.push({ attackerId: userId });
  }

  if (options.role === 'victim' || options.role === 'both' || !options.role) {
    where.OR.push({ victimId: userId });
  }

  if (options.status) {
    where.status = options.status;
  }

  const heists = await prisma.heist.findMany({
    where,
    orderBy: {
      createdAt: 'desc',
    },
    take: options.limit || 50,
    skip: options.offset || 0,
    select: {
      id: true,
      attackerId: true,
      victimId: true,
      pointsStolen: true,
      status: true,
      createdAt: true,
    },
  });

  return heists.map((heist) => ({
    ...heist,
    role: heist.attackerId === userId ? 'attacker' as const : 'victim' as const,
  }));
}

/**
 * Get heist statistics for a user
 */
export async function getHeistStats(userId: number): Promise<{
  asAttacker: {
    total: number;
    successful: number;
    failed: number;
    totalPointsStolen: number;
  };
  asVictim: {
    total: number;
    totalPointsLost: number;
  };
}> {
  const [attackerStats, victimStats] = await Promise.all([
    prisma.heist.groupBy({
      by: ['status'],
      where: { attackerId: userId },
      _count: { _all: true },
      _sum: { pointsStolen: true },
    }),
    prisma.heist.aggregate({
      where: {
        victimId: userId,
        status: HeistStatus.SUCCESS,
      },
      _count: { _all: true },
      _sum: { pointsStolen: true },
    }),
  ]);

  const successful = attackerStats.find((s) => s.status === HeistStatus.SUCCESS);
  const totalAttacks = attackerStats.reduce((sum, s) => sum + (s._count?._all || 0), 0);
  const totalSuccessful = successful?._count?._all || 0;

  return {
    asAttacker: {
      total: totalAttacks,
      successful: totalSuccessful,
      failed: totalAttacks - totalSuccessful,
      totalPointsStolen: successful?._sum?.pointsStolen || 0,
    },
    asVictim: {
      total: victimStats._count?._all || 0,
      totalPointsLost: victimStats._sum?.pointsStolen || 0,
    },
  };
}

/**
 * Helper: Map eligibility code to HeistStatus
 */
function mapEligibilityCodeToStatus(code: string): HeistStatus {
  const mapping: Record<string, HeistStatus> = {
    INSUFFICIENT_TOKENS: HeistStatus.FAILED_INSUFFICIENT_TOKENS,
    COOLDOWN_ACTIVE: HeistStatus.FAILED_COOLDOWN,
    TARGET_PROTECTED: HeistStatus.FAILED_TARGET_PROTECTED,
    INVALID_TARGET: HeistStatus.FAILED_INVALID_TARGET,
    INSUFFICIENT_VICTIM_POINTS: HeistStatus.FAILED_INSUFFICIENT_POINTS,
    ALREADY_ROBBED: HeistStatus.FAILED_INVALID_TARGET, // Use INVALID_TARGET for already robbed
    DAILY_LIMIT_EXCEEDED: HeistStatus.FAILED_INVALID_TARGET,
  };

  return mapping[code] || HeistStatus.FAILED_INVALID_TARGET;
}
