import prisma from '../lib/prisma';

/**
 * After a successful customer action (e.g. check-in), credit the user who
 * referred them — but only when:
 *   - The customer has a `referredByUserId` (was referred at signup).
 *   - The referrer is a different person (defensive — should always be true).
 *   - The merchant has at least one ACTIVE referral program.
 *   - This (program, customer, triggerType) hasn't already been credited.
 *   - The program's per-user cap (`maxRedemptionsPerUser`) for the referrer
 *     hasn't been reached.
 *
 * One attribution row is written per active program. Quietly no-ops on any
 * miss — never throws to the caller. Failures are logged but don't break the
 * triggering action (e.g. a check-in still succeeds even if attribution
 * write fails).
 */
export async function attributeReferralForAction(args: {
  referredUserId: number;
  merchantId: number;
  triggerType: 'CHECKIN' | 'CATERING_ORDER';
  triggerId?: number | null;
  dealId?: number | null;
}): Promise<void> {
  try {
    // 1. Find the customer's referrer.
    const customer = await prisma.user.findUnique({
      where: { id: args.referredUserId },
      select: { id: true, referredByUserId: true },
    });
    if (!customer || !customer.referredByUserId || customer.referredByUserId === customer.id) {
      return;
    }

    // 2. Find active programs for this merchant.
    const now = new Date();
    const programs = await prisma.merchantReferralProgram.findMany({
      where: {
        merchantId: args.merchantId,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, maxRedemptionsPerUser: true },
    });
    if (programs.length === 0) return;

    // 3. For each program, write the attribution row (idempotent via unique constraint).
    for (const program of programs) {
      // Cap check: count existing attributions for this referrer in this program.
      if (program.maxRedemptionsPerUser != null) {
        const existing = await prisma.referralAttribution.count({
          where: { programId: program.id, referrerUserId: customer.referredByUserId },
        });
        if (existing >= program.maxRedemptionsPerUser) continue;
      }

      try {
        await prisma.referralAttribution.create({
          data: {
            programId: program.id,
            merchantId: args.merchantId,
            referrerUserId: customer.referredByUserId,
            referredUserId: args.referredUserId,
            triggerType: args.triggerType,
            triggerId: args.triggerId ?? null,
            dealId: args.dealId ?? null,
          },
        });
      } catch (err: any) {
        // Unique constraint violation = already attributed for this trigger type.
        // That's fine — silently skip.
        if (err?.code !== 'P2002') {
          console.warn('[Referral attribution] write failed', {
            programId: program.id,
            referredUserId: args.referredUserId,
            triggerType: args.triggerType,
            error: err?.message ?? err,
          });
        }
      }
    }
  } catch (err) {
    // Never propagate — attribution is best-effort.
    console.warn('[Referral attribution] outer failure', err);
  }
}
