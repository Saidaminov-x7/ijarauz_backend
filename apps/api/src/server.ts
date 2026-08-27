// apps/api/src/server.ts

import 'dotenv/config';
import fastify from 'fastify';
import { fastifyHelmet } from '@fastify/helmet';
import { fastifyCors } from '@fastify/cors';
import { fastifyRateLimit } from '@fastify/rate-limit';
import { fastifySwagger } from '@fastify/swagger';
import { fastifySwaggerUi } from '@fastify/swagger-ui';
import { fastifyJwt } from '@fastify/jwt';
import { fastifyCookie } from '@fastify/cookie';
import { fastifyStatic } from '@fastify/static';
import { fastifyMultipart } from '@fastify/multipart';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

import { mkdirSync } from 'fs';
import { config } from './config';
import { authModule } from './modules/auth';
import { listingsModule } from './modules/listings';
import { mediaModule } from './modules/media';
import { aiChatModule } from './modules/ai-chat';
import { adminModule } from './modules/admin';
import { staffModule } from './modules/admin/staff';
import { notificationsModule } from './modules/admin/notifications';
import { profileModule } from './modules/admin/profile';
import { themeModule } from './modules/admin/theme';
import { analyticsModule } from './modules/analytics';
import { pageSectionsModule } from './modules/page-sections';
import { pagesPublicModule } from './modules/pages-public';
import { siteSettingsPublicModule } from './modules/site-settings';
import { savedSearchesModule } from './modules/saved-searches';
import { viewingRequestsModule } from './modules/viewing-requests';

// ─── Инициализация клиентов ───────────────────────────────────────────────────

const prisma = new PrismaClient({
  log: config.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

// Убедимся, что директория для хранения файлов существует
mkdirSync(config.STORAGE_PATH, { recursive: true });

// ─── Создание сервера ─────────────────────────────────────────────────────────

const server = fastify({
  logger: {
    level: config.LOG_LEVEL,
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  },
  trustProxy: true, // Обязательно для Railway (за nginx/proxy)
  ajv: {
    customOptions: {
      strict: 'log',
      keywords: ['kind', 'modifier'],
    },
  },
});

redis.on('error', (err) => {
  server.log.error({ err }, '[Redis] Connection error');
});

// ─── Плагины безопасности ─────────────────────────────────────────────────────

server.register(fastifyHelmet, {
  contentSecurityPolicy: config.NODE_ENV === 'production',
});

server.register(fastifyCors, {
  origin: config.CORS_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

server.register(fastifyRateLimit, {
  redis,
  global: true,
  max: config.RATE_LIMIT_MAX,
  timeWindow: config.RATE_LIMIT_WINDOW,
  skipOnError: true,
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)}s`,
  }),
});

server.register(fastifyJwt, {
  secret: config.JWT_SECRET,
  cookie: {
    cookieName: 'accessToken',
    signed: false,
  },
  sign: {
    expiresIn: '60m',
  },
});

server.register(fastifyCookie);

server.register(fastifyMultipart, {
  limits: { fileSize: config.MAX_FILE_SIZE },
});

// ─── Статические файлы (загружаемые медиа) ───────────────────────────────────

server.register(fastifyStatic, {
  root: config.STORAGE_PATH,
  prefix: '/uploads/',
  decorateReply: false,
});

// ─── Swagger документация ─────────────────────────────────────────────────────

if (config.NODE_ENV !== 'production') {
  server.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Ijarauz Backend API',
        description: 'API для платформы аренды недвижимости в Узбекистане',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });
  server.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
}

// ─── Декораторы DI ────────────────────────────────────────────────────────────

server.decorate('prisma', prisma);
server.decorate('redis', redis);

// ─── Маршруты модулей ─────────────────────────────────────────────────────────

server.register(authModule, { prefix: '/auth' });
server.register(listingsModule, { prefix: '/listings' });
server.register(mediaModule, { prefix: '/media' });
server.register(aiChatModule, { prefix: '/ai-chat' });
server.register(analyticsModule, { prefix: '/analytics' });
server.register(pageSectionsModule, { prefix: '/page-sections' });
server.register(savedSearchesModule, { prefix: '/saved-searches' });
server.register(viewingRequestsModule);

// ─── Административный модуль (требует роль ADMIN/AdminRole) ───────────────────
server.register(adminModule, { prefix: '/admin' });
server.register(staffModule, { prefix: '/admin/staff' });
server.register(profileModule, { prefix: '/admin' });
server.register(themeModule, { prefix: '/admin' });
server.register(notificationsModule, { prefix: '/admin/notifications' });
server.register(pageSectionsModule, { prefix: '/admin/page-sections' });

// ─── Публичные эндпоинты (без авторизации) ───────────────────────────────────
server.register(siteSettingsPublicModule, { prefix: '/site-settings' });
server.register(pagesPublicModule, { prefix: '/pages' });

// ─── Health-check эндпоинты ───────────────────────────────────────────────────

server.get('/health', {
  schema: { tags: ['Health'] },
}, async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

server.get('/health/live', {
  schema: { tags: ['Health'] },
}, async () => ({ status: 'live', timestamp: new Date().toISOString() }));

server.get('/health/ready', {
  schema: { tags: ['Health'] },
}, async (_req, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error('Redis not responding');
    return { status: 'ready', timestamp: new Date().toISOString() };
  } catch (err) {
    server.log.error({ err }, 'Health check failed');
    return reply.status(503).send({ status: 'not_ready', error: (err as Error).message });
  }
});

// ─── Глобальный обработчик ошибок ────────────────────────────────────────────

server.setErrorHandler((error, request, reply) => {
  const isProduction = config.NODE_ENV === 'production';

  // Логируем всегда — с деталями
  request.log.error({
    err: {
      message: error.message,
      stack: error.stack,
      code: error.code,
    },
    method: request.method,
    url: request.url,
  }, 'Request error');

  // Fastify validation errors (400)
  if (error.validation) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details: isProduction ? undefined : error.validation,
    });
  }

  // Rate limit (429)
  if (error.statusCode === 429) {
    return reply.status(429).send({
      statusCode: 429,
      error: 'Too Many Requests',
      message: error.message,
    });
  }

  // Известные ошибки приложения
  const statusCode = error.statusCode ?? 500;
  return reply.status(statusCode).send({
    statusCode,
    error: statusCode === 500 ? 'Internal Server Error' : error.name,
    // В проде не отдаём детали 500-ых ошибок наружу
    message: statusCode === 500 && isProduction ? 'An unexpected error occurred' : error.message,
  });
});

// ─── Not Found handler ────────────────────────────────────────────────────────

server.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    statusCode: 404,
    error: 'Not Found',
    message: `Route ${request.method} ${request.url} not found`,
  });
});

import { startTelegramBot, stopTelegramBot } from './lib/telegram';
import { expirePromotions } from './lib/jobs/expire-promotions';

// ─── Запуск и Graceful Shutdown ───────────────────────────────────────────────

let promotionsInterval: NodeJS.Timeout | null = null;

const start = async () => {
  try {
    await server.listen({ port: config.PORT, host: '0.0.0.0' });
    server.log.info(`✅ Server listening on port ${config.PORT} (${config.NODE_ENV})`);

    // Запускаем Telegram-бота для 2FA
    startTelegramBot(redis, server.log);

    // Первичная очистка истёкших промо-акций сразу при старте
    expirePromotions(prisma, server.log).catch((err) => {
      server.log.error({ err }, '[Promotions] Error during startup expirePromotions check');
    });

    // Периодическая очистка истёкших Boost/VIP промо-акций (каждый час)
    promotionsInterval = setInterval(() => {
      expirePromotions(prisma, server.log).catch((err) => {
        server.log.error({ err }, '[Promotions] Error in expirePromotions interval');
      });
    }, 60 * 60 * 1000);
  } catch (err) {
    server.log.error(err, 'Failed to start server');
    process.exit(1);
  }
};

const shutdown = async (signal: string) => {
  server.log.info(`Received ${signal}, graceful shutdown...`);
  try {
    if (promotionsInterval) {
      clearInterval(promotionsInterval);
    }
    stopTelegramBot();
    await server.close();
    await prisma.$disconnect();
    redis.disconnect();
    server.log.info('Server closed gracefully');
    process.exit(0);
  } catch (err) {
    server.log.error(err, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();