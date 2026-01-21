import crypto from 'crypto';

const base64url = (input: Buffer | string) =>
  (typeof input === 'string' ? Buffer.from(input) : input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

type StatePayload = {
  provider: string;
  nonce: string;
  redirectUri?: string;
  codeVerifier?: string;
};

export const createState = (payload: StatePayload, secret: string) => {
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  return `${base64url(Buffer.from(data))}.${base64url(sig)}`;
};

export const verifyState = (state: string, secret: string): StatePayload | null => {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  const data = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const expected = Buffer.from(expectedSig);
  const provided = Buffer.from(providedSig);
  if (expected.length !== provided.length) return null;
  if (!crypto.timingSafeEqual(expected, provided)) {
    return null;
  }
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
};
