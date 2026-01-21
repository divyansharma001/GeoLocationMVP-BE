import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { generateCodeChallenge, generateCodeVerifier } from '../lib/oauth/pkce';
import { buildAuthUrl, exchangeAuthCode, fetchUserProfile } from '../lib/oauth/providers';
import { createState, verifyState } from '../lib/oauth/state';
import { getOauthEnv } from '../config/oauth';
import { upsertSocialUser } from '../lib/social-auth';

const router = Router();

const providerParam = z.enum(['google', 'facebook', 'instagram']);

const sanitizeUser = (user: any) => {
  // Remove password before returning user payload
  const { password: _pw, ...rest } = user || {};
  return rest;
};

router.get('/:provider/start', async (req: Request, res: Response) => {
  try {
    const provider = providerParam.parse(req.params.provider);
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = createState(
      {
        provider,
        nonce: crypto.randomUUID(),
        redirectUri: req.query.redirectUri as string | undefined,
        codeVerifier,
      },
      getOauthEnv().OAUTH_STATE_SECRET
    );

    const url = buildAuthUrl(provider, state, codeChallenge);
    return res.redirect(url);
  } catch (error) {
    console.error('[social-start] error', error);
    return res.status(400).json({ error: 'Invalid social auth request' });
  }
});

router.get('/:provider/callback', async (req: Request, res: Response) => {
  try {
    const provider = providerParam.parse(req.params.provider);
    const { code, state, error: providerError } = req.query;

    if (providerError) {
      return res.status(400).json({ error: providerError });
    }
    if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
      return res.status(400).json({ error: 'Missing code or state' });
    }

    const parsedState = verifyState(state, getOauthEnv().OAUTH_STATE_SECRET);
    if (!parsedState || parsedState.provider !== provider || !parsedState.codeVerifier) {
      return res.status(400).json({ error: 'Invalid state' });
    }

    const tokenResult = await exchangeAuthCode({
      provider,
      code,
      codeVerifier: parsedState.codeVerifier,
    });

    const profile = await fetchUserProfile(provider, tokenResult.accessToken);
    const user = await upsertSocialUser({ provider, profile, tokens: tokenResult });

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET not configured');
    }
    const token = jwt.sign({ userId: user.id, email: user.email }, jwtSecret, { expiresIn: '24h' });

    // Optional redirect handling for web flows
    if (parsedState.redirectUri) {
      const redirectUrl = new URL(parsedState.redirectUri);
      redirectUrl.searchParams.set('token', token);
      redirectUrl.searchParams.set('provider', provider);
      return res.redirect(redirectUrl.toString());
    }

    return res.status(200).json({ token, user: sanitizeUser(user) });
  } catch (error) {
    console.error('[social-callback] error', error);
    return res.status(400).json({ error: 'Social login failed' });
  }
});

export default router;
