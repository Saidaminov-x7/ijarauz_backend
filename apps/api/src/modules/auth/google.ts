// apps/api/src/modules/auth/google.ts
// Google OAuth: verifies ID token server-side. Phone is required only for new users.

import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { generateTokens } from '../../lib/jwt';
import { refreshCookieOptions } from '../../lib/cookies';
import { config } from '../../config';
import crypto from 'crypto';

const googleAuthSchema = z.object({
  idToken: z.string().min(20),
  phone: z.string().regex(/^\+?[0-9\s\-]{9,20}$/).optional(),
});

export type GoogleAuthDto = z.infer<typeof googleAuthSchema>;

interface GoogleTokenInfo {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleTokenInfo> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!res.ok) {
    throw Object.assign(new Error('Invalid Google ID token'), { statusCode: 401 });
  }
  const payload = (await res.json()) as GoogleTokenInfo;
  if (config.GOOGLE_CLIENT_ID && payload.aud && payload.aud !== config.GOOGLE_CLIENT_ID) {
    throw Object.assign(new Error('Google token audience mismatch'), { statusCode: 401 });
  }
  if (!payload.sub || !payload.email) {
    throw Object.assign(new Error('Google token missing profile'), { statusCode: 401 });
  }
  return payload;
}

export const googleAuthHandler = async (
  request: FastifyRequest<{ Body: GoogleAuthDto }>,
  reply: FastifyReply,
) => {
  const dto = googleAuthSchema.parse(request.body);
  const prisma = request.server.prisma;

  const settings = await prisma.siteSettings.findUnique({
    where: { id: 'singleton' },
    select: { googleAuthEnabled: true },
  });
  if (settings && settings.googleAuthEnabled === false) {
    return reply.status(403).send({ message: 'Google login is disabled' });
  }

  const payload = await verifyGoogleIdToken(dto.idToken);
  const googleId = payload.sub;
  const email = payload.email;
  const name = payload.name || email?.split('@')[0];
  const avatar = payload.picture;

  if (!email || !googleId || !name) {
    return reply.status(400).send({ message: 'Google profile is incomplete. Send a valid idToken.' });
  }

  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    if (!dto.phone) {
      return reply.status(400).send({
        code: 'PHONE_REQUIRED',
        message: 'Phone number is required for new accounts',
      });
    }

    const phoneExists = await prisma.user.findFirst({ where: { phone: dto.phone } });
    if (phoneExists) {
      return reply.status(409).send({ message: 'This phone number is already registered' });
    }

    const randomPassword = crypto.randomBytes(32).toString('hex');
    const argon2 = await import('argon2');
    const passwordHash = await argon2.hash(randomPassword);

    user = await prisma.user.create({
      data: {
        email,
        name,
        phone: dto.phone,
        passwordHash,
        avatar,
        verified: true,
        role: 'USER',
      },
    });
  }

  if (user.isBlocked) {
    return reply.status(403).send({ message: 'User account is blocked' });
  }

  const { accessToken, refreshToken } = generateTokens(user, request);

  const argon2 = await import('argon2');
  const refreshTokenHash = await argon2.hash(refreshToken);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      refreshTokenHash,
      lastLoginAt: new Date(),
      ...(avatar && !user.avatar ? { avatar } : {}),
    },
  });

  reply.setCookie('refreshToken', refreshToken, refreshCookieOptions());

  return reply.send({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      phone: user.phone,
      role: user.role,
      adminRole: user.adminRole,
    },
  });
};
