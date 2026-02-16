import crypto from 'crypto';
import QRCode from 'qrcode';

const QR_SECRET = process.env.QR_CODE_SECRET || 'default-qr-secret-change-in-production';
const QR_EXPIRY_MS = 4 * 60 * 60 * 1000; // 4 hours

interface VenueRewardQRPayload {
  venueRewardId: number;
  merchantId: number;
  timestamp: number;
}

function generateSignature(data: string): string {
  return crypto.createHmac('sha256', QR_SECRET).update(data).digest('hex');
}

function verifySignature(data: string, signature: string): boolean {
  const expected = generateSignature(data);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Generate HMAC-signed QR data for a venue reward.
 * Format: VR|venueRewardId|merchantId|timestamp|signature
 */
export function generateVenueRewardQRData(payload: VenueRewardQRPayload): string {
  const { venueRewardId, merchantId, timestamp } = payload;
  const dataString = `VR|${venueRewardId}|${merchantId}|${timestamp}`;
  const signature = generateSignature(dataString);
  return `${dataString}|${signature}`;
}

/**
 * Verify and parse venue reward QR data.
 * Returns payload if valid, null if invalid/tampered/expired.
 */
export function verifyVenueRewardQRData(qrData: string): VenueRewardQRPayload | null {
  try {
    const parts = qrData.split('|');
    if (parts.length !== 5 || parts[0] !== 'VR') return null;

    const [, venueRewardIdStr, merchantIdStr, timestampStr, signature] = parts;
    const dataString = `VR|${venueRewardIdStr}|${merchantIdStr}|${timestampStr}`;

    if (!verifySignature(dataString, signature)) return null;

    const qrTimestamp = parseInt(timestampStr);
    if (Date.now() - qrTimestamp > QR_EXPIRY_MS) return null;

    return {
      venueRewardId: parseInt(venueRewardIdStr),
      merchantId: parseInt(merchantIdStr),
      timestamp: qrTimestamp,
    };
  } catch {
    return null;
  }
}

/**
 * Generate QR code image as Data URL for display at venue.
 */
export async function generateVenueRewardQRImage(qrData: string): Promise<string> {
  return QRCode.toDataURL(qrData, {
    errorCorrectionLevel: 'H',
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}
