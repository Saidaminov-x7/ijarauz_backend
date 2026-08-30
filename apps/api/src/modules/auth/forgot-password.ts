// apps/api/src/modules/auth/forgot-password.ts
// Эндпоинты запроса сброса пароля (forgot-password) и подтверждения нового пароля (reset-password)

import { FastifyReply, FastifyRequest } from 'fastify';
import argon2 from 'argon2';
import crypto from 'crypto';
import {
  ForgotPasswordDto,
  forgotPasswordSchema,
  ResetPasswordDto,
  resetPasswordSchema,
} from './schemas';
import { sendTelegramMessage } from '../../lib/telegram';
import { config } from '../../config';

const RESET_TOKEN_TTL_SECONDS = 3600; // 1 час

/**
 * POST /auth/forgot-password
 * Принимает email пользователя, генерирует криптостойкий токен сброса пароля,
 * сохраняет его в Redis и отправляет ссылку/уведомление.
 */
export const forgotPasswordHandler = async (
  request: FastifyRequest<{ Body: ForgotPasswordDto }>,
  reply: FastifyReply,
) => {
  const dto = forgotPasswordSchema.parse(request.body);
  const prisma = request.server.prisma;
  const redis = request.server.redis;

  const user = await prisma.user.findUnique({
    where: { email: dto.email.toLowerCase().trim() },
    select: { id: true, email: true, name: true, isBlocked: true },
  });

  // Защита от timing-атак и раскрытия существования аккаунта:
  // Если пользователь не найден или заблокирован, все равно возвращаем успешный ответ
  if (!user || user.isBlocked) {
    request.log.info({ email: dto.email }, 'Password reset requested for nonexistent or blocked user');
    return reply.send({
      message: 'Если аккаунт с таким email существует, ссылка для сброса пароля отправлена.',
    });
  }

  // Генерируем безопасный случайный токен
  const resetToken = crypto.randomBytes(32).toString('hex');
  const redisKey = `pwd_reset:${resetToken}`;

  const payload = {
    userId: user.id,
    email: user.email,
  };

  // Сохраняем в Redis с TTL 1 час
  await redis.set(redisKey, JSON.stringify(payload), 'EX', RESET_TOKEN_TTL_SECONDS);

  // Формируем ссылку на страницу сброса пароля
  // Берем первый разрешенный cors origin или дефолтный URL
  const origin = Array.isArray(config.CORS_ORIGINS) && config.CORS_ORIGINS[0]
    ? config.CORS_ORIGINS[0]
    : 'https://ijarauz.uz';
  const resetLink = `${origin}/ru/reset-password?token=${resetToken}`;

  // Логируем в консоль / логгер (особенно полезно для разработки и отладки)
  request.log.info(
    { userId: user.id, email: user.email, resetLink },
    `[ForgotPassword] Reset link generated for ${user.email}`,
  );

  // Отправляем уведомление через Telegram, если бот настроен (админу или в канал логов)
  if (config.TELEGRAM_BOT_TOKEN) {
    const adminChatId = config.TELEGRAM_ADMIN_CHAT_ID;
    if (adminChatId) {
      await sendTelegramMessage(
        adminChatId,
        `🔐 <b>Запрос на сброс пароля</b>\n\n` +
        `👤 Пользователь: <b>${user.name}</b> (${user.email})\n` +
        `🔗 Ссылка для сброса:\n<code>${resetLink}</code>\n\n` +
        `<i>Ссылка действительна 1 час.</i>`,
        'HTML',
        request.log,
      ).catch(() => {});
    }
  }

  // Если настроен Resend API для отправки почты
  if (config.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Ijarauz Security <noreply@ijarauz.uz>',
          to: [user.email],
          subject: 'Сброс пароля на сайте Ijarauz',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb; border-radius: 8px;">
              <h2 style="color: #111827;">Восстановление пароля</h2>
              <p style="color: #4b5563;">Здравствуйте, ${user.name}!</p>
              <p style="color: #4b5563;">Вы получили это письмо, потому что запросили сброс пароля для своей учетной записи на платформе Ijarauz.</p>
              <div style="margin: 28px 0;">
                <a href="${resetLink}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                  Сбросить пароль
                </a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">Или перейдите по ссылке вручную: <br><a href="${resetLink}" style="color: #2563eb;">${resetLink}</a></p>
              <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">Ссылка действительна в течение 1 часа. Если вы не запрашивали смену пароля, просто проигнорируйте это письмо.</p>
            </div>
          `,
        }),
      });
    } catch (err) {
      request.log.error({ err }, '[ForgotPassword] Error sending email via Resend');
    }
  }

  return reply.send({
    message: 'Если аккаунт с таким email существует, ссылка для сброса пароля отправлена.',
  });
};

/**
 * POST /auth/reset-password
 * Проверяет валидность токена из Redis, хэширует новый пароль и обновляет запись пользователя в БД.
 */
export const resetPasswordHandler = async (
  request: FastifyRequest<{ Body: ResetPasswordDto }>,
  reply: FastifyReply,
) => {
  const dto = resetPasswordSchema.parse(request.body);
  const prisma = request.server.prisma;
  const redis = request.server.redis;

  const redisKey = `pwd_reset:${dto.token}`;
  const dataStr = await redis.get(redisKey);

  if (!dataStr) {
    return reply.status(400).send({
      message: 'Срок действия ссылки истек или ссылка недействительна. Запросите сброс пароля повторно.',
    });
  }

  let session: { userId: string; email: string };
  try {
    session = JSON.parse(dataStr);
  } catch {
    return reply.status(400).send({
      message: 'Некорректные данные токена сброса пароля.',
    });
  }

  // Хэшируем новый пароль с помощью argon2
  const newPasswordHash = await argon2.hash(dto.password);

  // Обновляем пароль пользователя
  const updatedUser = await prisma.user.update({
    where: { id: session.userId },
    data: {
      passwordHash: newPasswordHash,
    },
    select: { id: true, email: true, name: true },
  });

  // Удаляем использованный токен из Redis
  await redis.del(redisKey);

  // Инвалидируем все активные refresh-токены пользователя для безопасности
  const userRefreshTokensKey = `user_refresh_tokens:${session.userId}`;
  const activeTokens = await redis.smembers(userRefreshTokensKey).catch(() => []);
  if (activeTokens.length > 0) {
    const pipeline = redis.pipeline();
    for (const t of activeTokens) {
      pipeline.del(`refresh_token:${t}`);
    }
    pipeline.del(userRefreshTokensKey);
    await pipeline.exec().catch(() => {});
  }

  // Записываем аудит-лог
  await prisma.auditLog.create({
    data: {
      userId: updatedUser.id,
      action: 'PASSWORD_RESET_COMPLETED',
      resource: 'user',
      resourceId: updatedUser.id,
      meta: { email: updatedUser.email },
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      timestamp: new Date(),
    },
  }).catch(() => {});

  request.log.info({ userId: updatedUser.id, email: updatedUser.email }, 'Password successfully reset');

  return reply.send({
    message: 'Пароль успешно изменен. Теперь вы можете войти с новым паролем.',
  });
};
