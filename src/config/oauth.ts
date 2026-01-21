import { z } from 'zod';

const envSchema = z.object({
  OAUTH_REDIRECT_BASE: z.string().min(1),
  OAUTH_STATE_SECRET: z.string().min(16),
  OAUTH_PKCE_SECRET: z.string().min(16),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  FACEBOOK_CLIENT_ID: z.string().min(1),
  FACEBOOK_CLIENT_SECRET: z.string().min(1),
  INSTAGRAM_CLIENT_ID: z.string().min(1),
  INSTAGRAM_CLIENT_SECRET: z.string().min(1),
});

const parsedEnv = envSchema.safeParse({
  OAUTH_REDIRECT_BASE: process.env.OAUTH_REDIRECT_BASE,
  OAUTH_STATE_SECRET: process.env.OAUTH_STATE_SECRET,
  OAUTH_PKCE_SECRET: process.env.OAUTH_PKCE_SECRET,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  FACEBOOK_CLIENT_ID: process.env.FACEBOOK_CLIENT_ID,
  FACEBOOK_CLIENT_SECRET: process.env.FACEBOOK_CLIENT_SECRET,
  INSTAGRAM_CLIENT_ID: process.env.INSTAGRAM_CLIENT_ID,
  INSTAGRAM_CLIENT_SECRET: process.env.INSTAGRAM_CLIENT_SECRET,
});

export const getOauthEnv = () => {
  if (!parsedEnv.success) {
    const missing = parsedEnv.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Missing OAuth env vars: ${missing}`);
  }
  return parsedEnv.data;
};

export type SocialProviderName = 'google' | 'facebook' | 'instagram';

type ProviderConfig = {
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string[];
  responseType?: string;
  audience?: string;
};

export const providerConfigs: Record<SocialProviderName, ProviderConfig> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: ['openid', 'email', 'profile'],
    responseType: 'code',
  },
  facebook: {
    authUrl: 'https://www.facebook.com/v20.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v20.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/me',
    scope: ['public_profile', 'email'],
    responseType: 'code',
  },
  instagram: {
    authUrl: 'https://api.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    userInfoUrl: 'https://graph.instagram.com/me',
    scope: ['user_profile'],
    responseType: 'code',
  },
};

export const redirectUriFor = (provider: SocialProviderName) =>
  `${getOauthEnv().OAUTH_REDIRECT_BASE.replace(/\/$/, '')}/api/auth/${provider}/callback`;
