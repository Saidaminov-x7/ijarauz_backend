// apps/api/src/modules/site-settings/index.ts
// Публичный эндпоинт настроек сайта — без авторизации, кэшируется в Redis

import { FastifyPluginAsync } from 'fastify';

const CACHE_KEY = 'site:settings:public';
const CACHE_TTL = 30; // 30 секунд — короткий TTL для быстрого отклика на изменения

export const siteSettingsPublicModule: FastifyPluginAsync = async (server) => {
  /**
   * GET /site-settings/public — публичный эндпоинт без авторизации
   * Используется основным фронтендом для проверки maintenance mode.
   * Кэшируется в Redis с TTL 30 секунд.
   */
  server.get('/public', async (_request, reply) => {
    // 1. Пробуем взять из Redis
    const cached = await server.redis.get(CACHE_KEY);
    if (cached) {
      reply.header('X-Cache', 'HIT');
      return JSON.parse(cached);
    }

    // 2. Берём из БД
    let settings = await server.prisma.siteSettings.findUnique({
      where: { id: 'singleton' },
      select: {
        maintenanceMode: true,
        maintenanceMessage: true,
        siteName: true,
        contactEmail: true,
        contactPhone: true,
        googleAuthEnabled: true,
        autoModerationEnabled: true,
        maxImagesPerListing: true,
        listingsPerPage: true,
        logoUrl: true,
        navLinks: true,
      },
    });

    // Если записи нет — дефолтные значения
    if (!settings) {
      settings = {
        maintenanceMode: false,
        maintenanceMessage: null,
        siteName: 'Ijarauz',
        contactEmail: 'support@ijarauz.uz',
        contactPhone: '+998 71 200-00-00',
        googleAuthEnabled: true,
        autoModerationEnabled: false,
        maxImagesPerListing: 10,
        listingsPerPage: 10,
        logoUrl: null,
        navLinks: null,
      };
    }

    // 3. Кэшируем в Redis
    await server.redis.set(CACHE_KEY, JSON.stringify(settings), 'EX', CACHE_TTL);

    reply.header('X-Cache', 'MISS');
    return settings;
  });

  /**
   * GET /site-settings/public/theme — публичный эндпоинт дизайн-токенов
   * Используется Next.js фронтендом для генерации CSS-переменных :root.
   */
  server.get('/public/theme', async (_request, reply) => {
    const THEME_CACHE_KEY = 'site:theme:public';
    const THEME_CACHE_TTL = 60; // 1 минута

    // 1. Redis кэш
    const cached = await server.redis.get(THEME_CACHE_KEY);
    if (cached) {
      reply.header('X-Cache', 'HIT');
      return JSON.parse(cached);
    }

    // 2. БД
    const theme = await server.prisma.themeSettings.findUnique({
      where: { id: 'singleton' },
    });

    const tokens = {
      primaryColor: theme?.primaryColor ?? '#14b8a6',
      secondaryColor: theme?.secondaryColor ?? '#0f766e',
      backgroundColor: theme?.backgroundColor ?? '#f9fafb',
      textColor: theme?.textColor ?? '#111827',
      borderRadius: theme?.borderRadius ?? '0.75rem',
      fontFamily: theme?.fontFamily ?? 'Inter, sans-serif',
    };

    // 3. Кэшируем
    await server.redis.set(THEME_CACHE_KEY, JSON.stringify(tokens), 'EX', THEME_CACHE_TTL);

    reply.header('X-Cache', 'MISS');
    return tokens;
  });
};
