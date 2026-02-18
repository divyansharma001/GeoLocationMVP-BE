import cron from 'node-cron';
import prisma from '../lib/prisma';
import { sendEmail } from '../lib/email';
import logger from '../lib/logging/logger';

const INTEREST_THRESHOLD = 10; // Minimum events to trigger a report

export function startInterestReportJob() {
  // Run daily at 9 AM
  cron.schedule('0 9 * * *', async () => {
    logger.info('Running daily interest report job');

    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Group interest logs by merchantId from the last 24 hours
      const interestCounts = await prisma.businessInterestLog.groupBy({
        by: ['merchantId', 'eventType'],
        where: { createdAt: { gte: yesterday } },
        _count: true,
      });

      if (interestCounts.length === 0) {
        logger.info('No interest events in the last 24 hours');
        return;
      }

      // Aggregate per merchant
      const merchantStats = new Map<number, Record<string, number>>();
      for (const row of interestCounts) {
        const existing = merchantStats.get(row.merchantId) || {};
        existing[row.eventType] = row._count;
        merchantStats.set(row.merchantId, existing);
      }

      for (const [merchantId, stats] of merchantStats) {
        const totalEvents = Object.values(stats).reduce((sum, count) => sum + count, 0);
        if (totalEvents < INTEREST_THRESHOLD) continue;

        const merchant = await prisma.merchant.findUnique({
          where: { id: merchantId },
          select: { businessName: true, owner: { select: { email: true, name: true } } },
        });

        if (!merchant?.owner?.email) continue;

        const statsLines = Object.entries(stats)
          .map(([type, count]) => `<li><strong>${type.replace(/_/g, ' ')}</strong>: ${count}</li>`)
          .join('');

        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;background:#f9fafb;padding:24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr>
                <td style="background:#111827;padding:18px 24px;">
                  <h1 style="margin:0;font-size:20px;color:#ffffff;font-weight:600;">YOHOP</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:24px;">
                  <p style="margin-top:0;">Hi ${merchant.owner.name?.split(/\s+/)[0] || 'there'},</p>
                  <p style="margin:16px 0;">Here's your daily interest report for <strong>${merchant.businessName}</strong>:</p>
                  <p style="margin:16px 0;font-size:24px;font-weight:700;color:#111827;">${totalEvents} total interactions</p>
                  <ul style="padding-left:20px;margin:16px 0;">${statsLines}</ul>
                  <p style="margin:16px 0;">Keep up the momentum! Consider creating venue rewards to convert this interest into visits.</p>
                  <p style="margin:24px 0 0;">Cheers,<br/>The YOHOP Team</p>
                </td>
              </tr>
              <tr>
                <td style="background:#f3f4f6;padding:16px 24px;font-size:12px;color:#6b7280;">
                  <p style="margin:0;">You're receiving this because your business had significant activity on YOHOP.</p>
                </td>
              </tr>
            </table>
          </div>`;

        await sendEmail({
          to: { email: merchant.owner.email },
          subject: `Daily Interest Report: ${totalEvents} interactions for ${merchant.businessName}`,
          html,
          tags: ['interest-report'],
        });

        logger.info(`Sent interest report to merchant ${merchantId} (${totalEvents} events)`);
      }
    } catch (error) {
      logger.error('Interest report job error:', error);
    }
  });

  logger.info('Interest report cron job started');
}
