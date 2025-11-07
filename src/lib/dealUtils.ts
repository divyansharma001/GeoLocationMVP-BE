/**
 * Utility functions for deal management
 * Includes QR code generation, access code creation, and validation helpers
 */

import crypto from 'crypto';

/**
 * Generate a unique access code for hidden deals
 * Format: VIP-XXXX (e.g., VIP-A7F2)
 */
export function generateAccessCode(): string {
  const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `VIP-${randomPart}`;
}

/**
 * Generate QR code data for bounty verification
 * Contains: dealId, merchantId, timestamp, signature
 * This data will be encoded in a QR code that customers scan
 */
export function generateBountyQRCode(dealId: number, merchantId: number): string {
  const timestamp = Date.now();
  const data = `${dealId}:${merchantId}:${timestamp}`;
  
  // Create a simple signature to prevent tampering
  const secret = process.env.BOUNTY_QR_SECRET || 'your-secret-key-change-in-production';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex')
    .substring(0, 8); // Use first 8 chars for brevity
  
  return `BOUNTY:${data}:${signature}`;
}

/**
 * Verify bounty QR code data
 * Returns dealId and merchantId if valid, or null if invalid
 */
export function verifyBountyQRCode(qrCodeData: string): { dealId: number; merchantId: number } | null {
  try {
    if (!qrCodeData.startsWith('BOUNTY:')) {
      return null;
    }

    const parts = qrCodeData.substring(7).split(':'); // Remove 'BOUNTY:' prefix
    
    if (parts.length !== 4) {
      return null;
    }

    const [dealIdStr, merchantIdStr, timestampStr, providedSignature] = parts;
    const dealId = parseInt(dealIdStr);
    const merchantId = parseInt(merchantIdStr);
    const timestamp = parseInt(timestampStr);

    // Verify signature
    const data = `${dealIdStr}:${merchantIdStr}:${timestampStr}`;
    const secret = process.env.BOUNTY_QR_SECRET || 'your-secret-key-change-in-production';
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex')
      .substring(0, 8);

    if (providedSignature !== expectedSignature) {
      console.warn('QR code signature mismatch');
      return null;
    }

    // Check if QR code is not too old (e.g., 30 days)
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    if (Date.now() - timestamp > maxAge) {
      console.warn('QR code expired');
      return null;
    }

    return { dealId, merchantId };
  } catch (error) {
    console.error('Error verifying QR code:', error);
    return null;
  }
}

/**
 * Validate deal type specific requirements
 */
export function validateDealTypeRequirements(
  dealTypeName: string,
  data: any
): { valid: boolean; error?: string } {
  
  switch (dealTypeName) {
    case 'Happy Hour':
      // Will be validated against menu items in the route
      return { valid: true };
      
    case 'Bounty Deal':
      if (!data.bountyRewardAmount || data.bountyRewardAmount <= 0) {
        return { valid: false, error: 'Bounty reward amount is required and must be positive' };
      }
      if (!data.minReferralsRequired || data.minReferralsRequired < 1) {
        return { valid: false, error: 'Minimum referrals required must be at least 1' };
      }
      return { valid: true };
      
    case 'Hidden Deal':
      // accessCode will be auto-generated if not provided
      return { valid: true };
      
    case 'Redeem Now':
      const validDiscounts = [15, 30, 45, 50, 75];
      if (data.discountPercentage && !validDiscounts.includes(data.discountPercentage)) {
        // Allow custom percentage if it's not one of the presets
        if (data.discountPercentage < 1 || data.discountPercentage > 100) {
          return { valid: false, error: 'Discount percentage must be between 1 and 100' };
        }
      }
      return { valid: true };
      
    case 'Recurring Deal':
      if (!data.recurringDays || data.recurringDays.length === 0) {
        return { valid: false, error: 'Please select at least one day for recurring deals' };
      }
      return { valid: true };
      
    default:
      return { valid: true };
  }
}

/**
 * Get suggested discount percentage for Redeem Now deals
 */
export function getRedeemNowDiscountOptions(): number[] {
  return [15, 30, 45, 50, 75];
}

/**
 * Calculate maximum duration for Redeem Now deals (in hours)
 */
export function getRedeemNowMaxDuration(): number {
  return 24; // 24 hours max for flash sales
}

/**
 * Format access code for display
 */
export function formatAccessCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

/**
 * Generate a shareable link for hidden deals
 */
export function generateHiddenDealLink(dealId: number, accessCode: string): string {
  const baseUrl = process.env.FRONTEND_URL || 'https://yohop.com';
  return `${baseUrl}/deals/hidden/${accessCode}?dealId=${dealId}`;
}

/**
 * Calculate bounty reward total
 */
export function calculateBountyReward(
  bountyRewardAmount: number,
  referralCount: number
): number {
  return bountyRewardAmount * referralCount;
}
