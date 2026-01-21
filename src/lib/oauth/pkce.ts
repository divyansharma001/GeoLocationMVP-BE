import crypto from 'crypto';

const base64url = (input: Buffer) => input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const generateCodeVerifier = () => base64url(crypto.randomBytes(64));

export const generateCodeChallenge = (verifier: string) => {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64url(hash);
};
