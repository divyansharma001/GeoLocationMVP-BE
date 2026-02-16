// Switched from Brevo API to direct SMTP via Nodemailer. Previous Brevo implementation retained in comments for easy revert.
// import axios from 'axios';
import nodemailer from 'nodemailer';
import logger from './logging/logger';

export interface SendEmailOptions {
  to: string | { email: string; name?: string } | Array<string | { email: string; name?: string }>;
  subject: string;
  html: string;
  text?: string;
  tags?: string[];
}

function normalizeRecipients(to: SendEmailOptions['to']) {
  const arr = Array.isArray(to) ? to : [to];
  return arr.map(r => (typeof r === 'string' ? { email: r } : r));
}

// Environment variables for SMTP:
// SMTP_HOST, SMTP_PORT, SMTP_SECURE (true/false), SMTP_USER, SMTP_PASS
let _transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (_transporter) return _transporter;
  let host = process.env.SMTP_HOST || '';
  let port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  let secure = (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  // Convenience Gmail support
  const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase();
  // Allow alternate var names for ease of config
  // Support alternate env var names (SMTP_PASSWORD) for convenience
  let user = process.env.SMTP_USER || process.env.GMAIL_USER;
  let pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASS;

  if (!host && provider === 'gmail') {
    host = 'smtp.gmail.com';
    port = 465; // recommended implicit TLS
    secure = true;
  }

  if (!host) {
    throw new Error('SMTP_HOST not configured (set SMTP_HOST or EMAIL_PROVIDER=gmail)');
  }
  if (user && pass) {
    _transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  } else {
    _transporter = nodemailer.createTransport({ host, port, secure });
  }
  return _transporter;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const enabled = (process.env.EMAIL_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) {
    logger.debug('[email] EMAIL_ENABLED not true – skipping send.');
    return;
  }
  // Allow alias env names FROM_EMAIL / FROM_NAME for ergonomics
  const fromEmail = process.env.EMAIL_FROM_ADDRESS || process.env.FROM_EMAIL;
  const fromName = process.env.EMAIL_FROM_NAME || process.env.FROM_NAME || 'NoReply';
  if (!fromEmail) {
    logger.warn('[email] Missing EMAIL_FROM_ADDRESS – email disabled.');
    return;
  }
  try {
    const toList = normalizeRecipients(options.to);
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: toList.map(t => (t.name ? `${t.name} <${t.email}>` : t.email)).join(', '),
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]+>/g, ''),
      headers: options.tags ? { 'X-Tags': options.tags.join(',') } : undefined,
    });
    logger.info(`[email] Sent email to ${toList.map(t=>t.email).join(', ')} subject="${options.subject}"`);
  } catch (err: any) {
    logger.error(`[email] SMTP send failed: err=${err.message}`);
  }
}

// Convenience helpers (extend as needed)
export async function sendWelcomeEmail(to: string, name?: string) {
  const subject = 'Welcome to YOHOP! 🎉';
  const safeName = name ? name.split(/\s+/)[0] : '';
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
            <p style="margin-top:0;">Hi ${safeName || 'there'},</p>
            <p style="margin:16px 0;">Welcome to <strong>YOHOP</strong> — we’re excited to have you on board! Your account is set up and you’ve already earned your signup points.</p>
            <p style="margin:16px 0;">Here’s what you can do next:</p>
            <ol style="padding-left:20px;margin:16px 0;">
              <li><strong>Explore deals</strong> near you and start checking in.</li>
              <li><strong>Earn points</strong> for check-ins and activity.</li>
              <li><strong>Share your referral code</strong> (find it in your profile) to earn bonus points when friends join.</li>
            </ol>
            <p style="margin:16px 0;">Need help? Just reply to this email — we actually read these.</p>
            <p style="margin:24px 0 0;">Cheers,<br/>The YOHOP Team</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f3f4f6;padding:16px 24px;font-size:12px;color:#6b7280;">
            <p style="margin:0;">You’re receiving this because you created a YOHOP account. If this wasn’t you, ignore this email.</p>
          </td>
        </tr>
      </table>
    </div>
  `;
  await sendEmail({ to: { email: to }, subject, html, tags: ['welcome'] });
}

// Notify a referrer that someone used their code successfully.
export async function sendReferralSuccessEmail(params: { to: string; referrerName?: string; referredEmail: string; referralCode: string }) {
  const { to, referrerName, referredEmail, referralCode } = params;
  const safeName = referrerName ? referrerName.split(/\s+/)[0] : '';
  const subject = 'Your referral just joined YOHOP! 🎉';
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
            <p style="margin-top:0;">Hi ${safeName || 'there'},</p>
            <p style="margin:16px 0;">Great news — <strong>${referredEmail}</strong> just signed up using your referral code <code style="background:#f3f4f6;padding:2px 4px;border-radius:4px;">${referralCode}</code>.</p>
            <p style="margin:16px 0;">You’ve earned referral progress toward rewards. Keep sharing your code to climb the leaderboard and unlock more points.</p>
            <p style="margin:16px 0;">Need your code again? You can always find it in your profile.</p>
            <p style="margin:24px 0 0;">Thanks for growing the community!<br/>The YOHOP Team</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f3f4f6;padding:16px 24px;font-size:12px;color:#6b7280;">
            <p style="margin:0;">You’re receiving this because someone joined YOHOP using your referral code.</p>
          </td>
        </tr>
      </table>
    </div>
  `;
  await sendEmail({ to: { email: to }, subject, html, tags: ['referral-success'] });
}

// Simple birthday greeting email
export async function sendBirthdayEmail(params: { to: string; name?: string }) {
  const { to, name } = params;
  const first = name ? name.split(/\s+/)[0] : 'there';
  const subject = 'Happy Birthday from YOHOP! 🎂';
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
            <p style="margin-top:0;">Hi ${first},</p>
            <p style="margin:16px 0;">All of us at <strong>YOHOP</strong> wish you a very Happy Birthday! 🎉</p>
            <p style="margin:16px 0;">We hope you discover great deals and earn tons of points today. Treat yourself!</p>
            <p style="margin:24px 0 0;">Cheers,<br/>The YOHOP Team</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f3f4f6;padding:16px 24px;font-size:12px;color:#6b7280;">
            <p style="margin:0;">You’re receiving this because your birthday is set in YOHOP. If this seems wrong you can update your profile.</p>
          </td>
        </tr>
      </table>
    </div>`;
  await sendEmail({ to: { email: to }, subject, html, tags: ['birthday'] });
}

// Notify merchant that their verification document was received
export async function sendVerificationSubmittedEmail(params: { to: string; merchantName: string; stepType: string }) {
  const { to, merchantName, stepType } = params;
  const safeName = merchantName ? merchantName.split(/\s+/).slice(0, 3).join(' ') : 'there';
  const subject = `Verification Document Submitted - ${stepType.replace(/_/g, ' ')}`;
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
            <p style="margin-top:0;">Hi ${safeName},</p>
            <p style="margin:16px 0;">We've received your <strong>${stepType.replace(/_/g, ' ').toLowerCase()}</strong> verification document. Our team will review it within 24-48 hours.</p>
            <p style="margin:16px 0;">You'll receive an email once the review is complete. No action is needed from you at this time.</p>
            <p style="margin:24px 0 0;">Thanks,<br/>The YOHOP Team</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f3f4f6;padding:16px 24px;font-size:12px;color:#6b7280;">
            <p style="margin:0;">You're receiving this because you submitted a verification document for ${merchantName}.</p>
          </td>
        </tr>
      </table>
    </div>`;
  await sendEmail({ to: { email: to }, subject, html, tags: ['verification-submitted'] });
}

// Notify merchant of verification step review result
export async function sendVerificationReviewedEmail(params: {
  to: string; merchantName: string; stepType: string; approved: boolean; rejectionReason?: string;
}) {
  const { to, merchantName, stepType, approved, rejectionReason } = params;
  const safeName = merchantName ? merchantName.split(/\s+/).slice(0, 3).join(' ') : 'there';
  const stepLabel = stepType.replace(/_/g, ' ').toLowerCase();
  const subject = approved
    ? `Verification Approved: ${stepType.replace(/_/g, ' ')}`
    : `Verification Update Required: ${stepType.replace(/_/g, ' ')}`;
  const bodyContent = approved
    ? `<p style="margin:16px 0;">Your <strong>${stepLabel}</strong> verification has been <span style="color:#16a34a;font-weight:600;">approved</span>. You're one step closer to unlocking all features.</p>`
    : `<p style="margin:16px 0;">Your <strong>${stepLabel}</strong> verification was <span style="color:#dc2626;font-weight:600;">not approved</span>.</p>
       ${rejectionReason ? `<p style="margin:16px 0;padding:12px;background:#fef2f2;border-radius:6px;"><strong>Reason:</strong> ${rejectionReason}</p>` : ''}
       <p style="margin:16px 0;">Please review the feedback and resubmit your document.</p>`;
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
            <p style="margin-top:0;">Hi ${safeName},</p>
            ${bodyContent}
            <p style="margin:24px 0 0;">Thanks,<br/>The YOHOP Team</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f3f4f6;padding:16px 24px;font-size:12px;color:#6b7280;">
            <p style="margin:0;">You're receiving this because a verification step for ${merchantName} was reviewed.</p>
          </td>
        </tr>
      </table>
    </div>`;
  await sendEmail({ to: { email: to }, subject, html, tags: ['verification-reviewed'] });
}

// Notify merchant that all verification steps are complete
export async function sendVerificationCompleteEmail(params: { to: string; merchantName: string }) {
  const { to, merchantName } = params;
  const safeName = merchantName ? merchantName.split(/\s+/).slice(0, 3).join(' ') : 'there';
  const subject = 'Your Business is Fully Verified!';
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
            <p style="margin-top:0;">Hi ${safeName},</p>
            <p style="margin:16px 0;">All your verification steps have been <span style="color:#16a34a;font-weight:600;">approved</span>! Your business is now fully verified on YOHOP.</p>
            <p style="margin:16px 0;">You can now:</p>
            <ul style="padding-left:20px;margin:16px 0;">
              <li>Create and activate <strong>venue rewards</strong> for your customers</li>
              <li>Set up <strong>geo-fenced rewards</strong> at your venue</li>
              <li>Access all premium merchant features</li>
            </ul>
            <p style="margin:24px 0 0;">Congratulations!<br/>The YOHOP Team</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f3f4f6;padding:16px 24px;font-size:12px;color:#6b7280;">
            <p style="margin:0;">You're receiving this because all verification steps for ${merchantName} have been approved.</p>
          </td>
        </tr>
      </table>
    </div>`;
  await sendEmail({ to: { email: to }, subject, html, tags: ['verification-complete'] });
}
