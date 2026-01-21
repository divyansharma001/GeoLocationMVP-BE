import axios from 'axios';
import { getOauthEnv, providerConfigs, redirectUriFor, SocialProviderName } from '../../config/oauth';

export type SocialProfile = {
  providerUserId: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
};

export type TokenResult = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  idToken?: string | null;
};

type CodeExchangeInput = {
  provider: SocialProviderName;
  code: string;
  codeVerifier?: string;
};

const toDateFromExpiresIn = (seconds?: number): Date | null => {
  if (!seconds || Number.isNaN(seconds)) return null;
  return new Date(Date.now() + seconds * 1000);
};

export const exchangeAuthCode = async ({ provider, code, codeVerifier }: CodeExchangeInput): Promise<TokenResult> => {
  const redirectUri = redirectUriFor(provider);

  if (provider === 'google') {
    const body = new URLSearchParams({
      code,
      client_id: getOauthEnv().GOOGLE_CLIENT_ID,
      client_secret: getOauthEnv().GOOGLE_CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    if (codeVerifier) {
      body.set('code_verifier', codeVerifier);
    }
    const { data } = await axios.post('https://oauth2.googleapis.com/token', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: toDateFromExpiresIn(data.expires_in),
      idToken: data.id_token ?? null,
    };
  }

  if (provider === 'facebook') {
    const { data } = await axios.get(providerConfigs.facebook.tokenUrl, {
      params: {
        client_id: getOauthEnv().FACEBOOK_CLIENT_ID,
        client_secret: getOauthEnv().FACEBOOK_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code,
      },
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: toDateFromExpiresIn(data.expires_in),
    };
  }

  // instagram basic display
  const body = new URLSearchParams({
    client_id: getOauthEnv().INSTAGRAM_CLIENT_ID,
    client_secret: getOauthEnv().INSTAGRAM_CLIENT_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
  const { data } = await axios.post(providerConfigs.instagram.tokenUrl, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return {
    accessToken: data.access_token,
    refreshToken: null,
    expiresAt: toDateFromExpiresIn(data.expires_in),
  };
};

export const fetchUserProfile = async (provider: SocialProviderName, accessToken: string): Promise<SocialProfile> => {
  if (provider === 'google') {
    const { data } = await axios.get(providerConfigs.google.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return {
      providerUserId: data.sub,
      email: data.email,
      name: data.name,
      avatarUrl: data.picture,
      emailVerified: data.email_verified,
    };
  }

  if (provider === 'facebook') {
    const { data } = await axios.get(providerConfigs.facebook.userInfoUrl, {
      params: {
        access_token: accessToken,
        fields: 'id,name,email,picture',
      },
    });
    const avatar = data.picture?.data?.url ?? null;
    return {
      providerUserId: data.id,
      email: data.email,
      name: data.name,
      avatarUrl: avatar,
      emailVerified: !!data.email,
    };
  }

  // instagram basic display does not return email
  const { data } = await axios.get(providerConfigs.instagram.userInfoUrl, {
    params: {
      access_token: accessToken,
      fields: 'id,username,account_type,media_count',
    },
  });
  return {
    providerUserId: data.id?.toString(),
    email: null,
    name: data.username,
    avatarUrl: null,
    emailVerified: false,
  };
};

export const buildAuthUrl = (provider: SocialProviderName, state: string, codeChallenge: string) => {
  const cfg = providerConfigs[provider];
  const redirectUri = redirectUriFor(provider);
  const url = new URL(cfg.authUrl);
  url.searchParams.set('client_id', getClientId(provider));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', cfg.responseType || 'code');
  url.searchParams.set('scope', cfg.scope.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (provider === 'google') {
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
  }
  return url.toString();
};

export const getClientId = (provider: SocialProviderName) => {
  const env = getOauthEnv();
  if (provider === 'google') return env.GOOGLE_CLIENT_ID;
  if (provider === 'facebook') return env.FACEBOOK_CLIENT_ID;
  return env.INSTAGRAM_CLIENT_ID;
};
