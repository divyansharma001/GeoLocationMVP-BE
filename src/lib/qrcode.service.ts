// src/lib/qrcode.service.ts

import crypto from 'crypto';
import QRCode from 'qrcode';

/**
 * QR Code Service for Event Tickets
 * Generates secure QR codes with HMAC signing to prevent forgery
 */

const QR_SECRET = process.env.QR_CODE_SECRET || 'default-qr-secret-change-in-production';

interface TicketQRPayload {
  ticketId: number;
  eventId: number;
  userId: number;
  ticketNumber: string;
  timestamp: number;
}

/**
 * Generate HMAC signature for QR code data
 */
function generateSignature(data: string): string {
  return crypto
    .createHmac('sha256', QR_SECRET)
    .update(data)
    .digest('hex');
}

/**
 * Verify HMAC signature for QR code data
 */
function verifySignature(data: string, signature: string): boolean {
  const expectedSignature = generateSignature(data);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Generate QR code data string for a ticket
 * Format: ticketId|eventId|userId|ticketNumber|timestamp|signature
 */
export function generateTicketQRData(payload: TicketQRPayload): string {
  const { ticketId, eventId, userId, ticketNumber, timestamp } = payload;
  const dataString = `${ticketId}|${eventId}|${userId}|${ticketNumber}|${timestamp}`;
  const signature = generateSignature(dataString);
  
  return `${dataString}|${signature}`;
}

/**
 * Parse and verify QR code data
 * Returns payload if valid, null if invalid/tampered
 */
export function verifyTicketQRData(qrData: string): TicketQRPayload | null {
  try {
    const parts = qrData.split('|');
    
    if (parts.length !== 6) {
      console.error('Invalid QR code format: incorrect number of parts');
      return null;
    }

    const [ticketId, eventId, userId, ticketNumber, timestamp, signature] = parts;
    const dataString = `${ticketId}|${eventId}|${userId}|${ticketNumber}|${timestamp}`;

    // Verify signature
    if (!verifySignature(dataString, signature)) {
      console.error('Invalid QR code: signature verification failed');
      return null;
    }

    // Check timestamp (reject QR codes older than 24 hours to prevent replay attacks)
    const qrTimestamp = parseInt(timestamp);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    if (now - qrTimestamp > maxAge) {
      console.error('Invalid QR code: expired timestamp');
      return null;
    }

    return {
      ticketId: parseInt(ticketId),
      eventId: parseInt(eventId),
      userId: parseInt(userId),
      ticketNumber,
      timestamp: qrTimestamp
    };
  } catch (error) {
    console.error('QR code verification error:', error);
    return null;
  }
}

/**
 * Generate QR code image as Data URL
 * @param qrData - The QR code data string
 * @returns Promise resolving to Data URL (can be used directly in <img src="">)
 */
export async function generateQRCodeImage(qrData: string): Promise<string> {
  try {
    const qrCodeDataURL = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: 'H', // High error correction
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    return qrCodeDataURL;
  } catch (error) {
    console.error('QR code generation error:', error);
    throw new Error('Failed to generate QR code image');
  }
}

/**
 * Generate QR code image as Buffer (for file storage/email attachments)
 */
export async function generateQRCodeBuffer(qrData: string): Promise<Buffer> {
  try {
    const qrCodeBuffer = await QRCode.toBuffer(qrData, {
      errorCorrectionLevel: 'H',
      width: 300,
      margin: 2
    });
    
    return qrCodeBuffer;
  } catch (error) {
    console.error('QR code buffer generation error:', error);
    throw new Error('Failed to generate QR code buffer');
  }
}

/**
 * Generate a unique ticket number
 * Format: EVT-YYYY-XXXXXX (EVT-2026-001234)
 */
export function generateTicketNumber(eventId: number): string {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  const eventPrefix = eventId.toString().padStart(4, '0');
  
  return `EVT-${year}-${eventPrefix}-${random}`;
}

/**
 * Generate ticket with QR code
 * Returns ticket number and QR code data
 */
export async function generateTicket(
  ticketId: number,
  eventId: number,
  userId: number
): Promise<{ ticketNumber: string; qrCode: string; qrCodeImage: string }> {
  const ticketNumber = generateTicketNumber(eventId);
  const timestamp = Date.now();

  const qrData = generateTicketQRData({
    ticketId,
    eventId,
    userId,
    ticketNumber,
    timestamp
  });

  const qrCodeImage = await generateQRCodeImage(qrData);

  return {
    ticketNumber,
    qrCode: qrData,
    qrCodeImage
  };
}
