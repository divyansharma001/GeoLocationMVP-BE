import prisma from './prisma';
import { SocialProviderName } from '../config/oauth';
import { SocialProfile, TokenResult } from './oauth/providers';

type UpsertInput = {
  provider: SocialProviderName;
  profile: SocialProfile;
  tokens: TokenResult;
};

export const upsertSocialUser = async ({ provider, profile, tokens }: UpsertInput) => {
  const providerEnum = provider.toUpperCase();

  // @ts-ignore Prisma client may be stale until regenerate
  const existingLink = await prisma.socialAccount.findFirst({
    where: {
      provider: providerEnum as any,
      providerUserId: profile.providerUserId,
    },
    include: { user: true },
  });

  const updateAccountTokens = async (socialAccountId: number) => {
    // @ts-ignore Prisma client may be stale until regenerate
    await prisma.socialAccount.update({
      where: { id: socialAccountId },
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? undefined,
        expiresAt: tokens.expiresAt ?? undefined,
        profile,
      },
    });
  };

  if (existingLink) {
    await updateAccountTokens(existingLink.id);
    // @ts-ignore Prisma client may be stale until regenerate
    const updatedUser = await prisma.user.update({
      where: { id: existingLink.userId },
      // @ts-ignore Prisma client may be stale until regenerate
      data: {
        lastLoginAt: new Date(),
        avatarUrl: profile.avatarUrl ?? existingLink.user.avatarUrl ?? undefined,
        emailVerifiedAt: profile.emailVerified ? existingLink.user.emailVerifiedAt ?? new Date() : existingLink.user.emailVerifiedAt,
        name: profile.name ?? existingLink.user.name ?? undefined,
      },
    });
    return updatedUser;
  }

  if (profile.email) {
    const userByEmail = await prisma.user.findUnique({ where: { email: profile.email.toLowerCase() } });
    if (userByEmail) {
      // @ts-ignore Prisma client may be stale until regenerate
      await prisma.socialAccount.create({
        data: {
          provider: providerEnum as any,
          providerUserId: profile.providerUserId,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? undefined,
          expiresAt: tokens.expiresAt ?? undefined,
          profile,
          userId: userByEmail.id,
        },
      });
      // @ts-ignore Prisma client may be stale until regenerate
      const updatedUser = await prisma.user.update({
        where: { id: userByEmail.id },
        // @ts-ignore Prisma client may be stale until regenerate
        data: {
          lastLoginAt: new Date(),
          avatarUrl: profile.avatarUrl ?? userByEmail.avatarUrl ?? undefined,
          emailVerifiedAt: profile.emailVerified ? (userByEmail as any).emailVerifiedAt ?? new Date() : (userByEmail as any).emailVerifiedAt,
          name: profile.name ?? userByEmail.name ?? undefined,
        },
      });
      return updatedUser;
    }
  }

  // @ts-ignore Prisma client may be stale until regenerate
  const createdUser = await prisma.user.create({
    // @ts-ignore Prisma client may be stale until regenerate
    data: {
      email: (profile.email || `user-${provider}-${profile.providerUserId}@placeholder.local`).toLowerCase(),
      name: profile.name ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      password: null,
      emailVerifiedAt: profile.emailVerified ? new Date() : null,
      lastLoginAt: new Date(),
      socialAccounts: {
        create: {
          provider: providerEnum as any,
          providerUserId: profile.providerUserId,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? undefined,
          expiresAt: tokens.expiresAt ?? undefined,
          profile,
        },
      },
    },
  });

  return createdUser;
};
