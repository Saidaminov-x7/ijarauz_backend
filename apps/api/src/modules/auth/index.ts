// apps/api/src/modules/auth/index.ts

import { FastifyPluginAsync } from 'fastify';
import { registerHandler } from './register';
import { loginHandler } from './login';
import { verify2faHandler, resend2faHandler } from './verify-2fa';
import { refreshHandler } from './refresh';
import { logoutHandler } from './logout';
import { meHandler } from './me';
import { googleAuthHandler } from './google';
import { authMiddleware } from '../../lib/authMiddleware';

export const authModule: FastifyPluginAsync = async (server) => {
  // Регистрация нового пользователя (лимит 5 попыток в минуту)
  server.post('/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, registerHandler);

  // Google OAuth — sign in or sign up with phone verification
  server.post('/google', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, googleAuthHandler);

  // Вход / получение токенов (защита от брутфорса: 5 попыток в минуту)
  server.post('/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, loginHandler);

  // Верификация 2FA кода из Telegram
  server.post('/verify-2fa', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, verify2faHandler);

  // Повторная отправка 2FA кода в Telegram
  server.post('/resend-2fa', {
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
  }, resend2faHandler);

  // Обновление токенов по refreshToken (лимит 30 запросов в минуту)
  server.post('/refresh', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, refreshHandler);

  // Выход (требует auth)
  server.post('/logout', { preHandler: [authMiddleware] }, logoutHandler);

  // Текущий пользователь (требует auth)
  server.get('/me', { preHandler: [authMiddleware] }, meHandler);
};