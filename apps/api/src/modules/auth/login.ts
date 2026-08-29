import { FastifyReply, FastifyRequest } from 'fastify';
import argon2 from 'argon2';
import crypto from 'crypto';
import { LoginDto, loginSchema } from './schemas';
import { AuthService } from './service';
import { generateTokens } from '../../lib/jwt';
import { refreshCookieOptions } from '../../lib/cookies';
import { sendTelegram2FACode } from '../../lib/telegram';

export const loginHandler = async (
  request: FastifyRequest<{ Body: LoginDto }>,
  reply: FastifyReply,
) => {
  const dto = loginSchema.parse(request.body);
  const authService = new AuthService(request.server.prisma);

  // Поиск пользователя
  const user = await authService.findByEmail(dto.email);
  if (!user) {
    return reply.status(401).send({ message: 'Invalid credentials' });
  }

  // Проверка пароля
  const isValid = await authService.verifyPassword(user.passwordHash, dto.password);
  if (!isValid) {
    return reply.status(401).send({ message: 'Invalid credentials' });
  }

  // Проверка блокировки
  if (user.isBlocked) {
    return reply.status(403).send({ message: 'User account is blocked' });
  }

  // Если включена глобальная 2FA или пользователь является SUPER_ADMIN
  const settings = await request.server.prisma.siteSettings.findUnique({
    where: { id: 'singleton' },
  });

  const require2FA =
    user.adminRole === 'SUPER_ADMIN' ||
    (settings?.twoFactorAuthEnabled === true && (user.role === 'ADMIN' || !!user.adminRole));

  if (require2FA) {
    // Генерируем 6-значный код
    const code = Math.floor(100000 + crypto.randomInt(900000)).toString();
    const tempToken = crypto.randomBytes(32).toString('hex');

    // Сохраняем код и userId во временное хранилище Redis на 5 минут (300 сек)
    await request.server.redis.set(
      `2fa:${tempToken}`,
      JSON.stringify({ userId: user.id, code, email: user.email }),
      'EX',
      300,
    );

    // Отправляем код в Telegram Bot
    const tgResult = await sendTelegram2FACode(
      request.server.redis,
      code,
      user.email,
      request.ip,
    );

    return reply.send({
      require2fa: true,
      tempToken,
      message: tgResult.success
        ? 'Код подтверждения отправлен в Telegram бот.'
        : 'Код сгенерирован. ' + (tgResult.message || 'Проверьте Telegram бот.'),
    });
  }

  // Для обычных пользователей — стандартная генерация токенов
  const { accessToken, refreshToken } = generateTokens(user, request);

  // Сохраняем хэш refreshToken и обновляем lastLoginAt
  try {
    const refreshTokenHash = await argon2.hash(refreshToken);
    await request.server.prisma.user.update({
      where: { id: user.id },
      data: {
        refreshTokenHash,
        lastLoginAt: new Date(),
      },
    });
  } catch (err) {
    request.log.error({ err }, 'Failed to hash and save refresh token or update lastLoginAt');
  }

  // Устанавливаем refreshToken в httpOnly cookie
  reply.setCookie('refreshToken', refreshToken, refreshCookieOptions());

  const { logUserActivity } = await import('../../lib/activityLogger');
  void logUserActivity(request.server.prisma, user.id, 'LOGIN', request, {
    email: user.email,
  });

  return reply.send({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      adminRole: user.adminRole,
    },
  });
};