// apps/api/src/modules/page-sections/index.ts
// Управление CMS-секциями страниц (Конструктор страниц)

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { adminMiddleware, requireAdminRole } from '../../lib/adminMiddleware';
import { AdminRole, Prisma } from '@prisma/client';

const createSectionSchema = z.object({
  pageKey: z.string().default('home'),
  sectionType: z.string().min(2),
  title: z.string().optional(),
  order: z.number().int().default(0),
  isVisible: z.boolean().default(true),
  layoutRow: z.number().int().min(1).max(10).optional(),
  width: z.number().int().min(1).max(12).optional(),
  content: z.record(z.unknown()),
});

const updateSectionSchema = z.object({
  title: z.string().optional(),
  order: z.number().int().optional(),
  isVisible: z.boolean().optional(),
  layoutRow: z.number().int().min(1).max(10).optional(),
  width: z.number().int().min(1).max(12).optional(),
  content: z.record(z.unknown()).optional(),
});

const reorderSectionsSchema = z.object({
  pageKey: z.string().default('home'),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      order: z.number().int(),
    }),
  ),
});

export const pageSectionsModule: FastifyPluginAsync = async (server) => {
  const REDIS_CACHE_PREFIX = 'page_sections:public:';
  const cmsHandler = [requireAdminRole(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)];

  const invalidateCache = async (pageKey: string) => {
    try {
      await server.redis.del(
        `${REDIS_CACHE_PREFIX}${pageKey}`,
        `${REDIS_CACHE_PREFIX}${pageKey}:ru`,
        `${REDIS_CACHE_PREFIX}${pageKey}:uz`,
        `${REDIS_CACHE_PREFIX}${pageKey}:en`,
      );
    } catch (err) {
      server.log.warn({ err }, 'Failed to invalidate page sections Redis cache');
    }
  };

  /**
   * GET /page-sections/public?pageKey=home&locale=ru — публичный эндпоинт для фронтенда с Redis-кэшированием
   */
  server.get('/public', async (request: FastifyRequest, reply: FastifyReply) => {
    const { pageKey = 'home', locale = 'ru' } = request.query as { pageKey?: string; locale?: string };
    const cacheKey = `${REDIS_CACHE_PREFIX}${pageKey}:${locale}`;

    // 1. Проверяем Redis кэш
    try {
      const cached = await server.redis.get(cacheKey);
      if (cached) {
        return reply.header('X-Cache', 'HIT').send(JSON.parse(cached));
      }
    } catch (err) {
      server.log.warn({ err }, 'Redis get error');
    }

    // 2. Запрос в БД
    const sections = await server.prisma.pageSection.findMany({
      where: {
        pageKey,
        isVisible: true,
      },
      orderBy: {
        order: 'asc',
      },
      select: {
        id: true,
        pageKey: true,
        sectionType: true,
        title: true,
        order: true,
        content: true,
        updatedAt: true,
      },
    });

    const localizedSections = sections.map((section) => {
      const raw = section.content as Record<string, any> | null;
      const localized =
        raw && typeof raw[locale] === 'object' ? raw[locale] : raw || {};
      return {
        ...section,
        content: localized,
      };
    });

    // 3. Сохраняем в кэш на 5 минут
    try {
      await server.redis.setex(cacheKey, 300, JSON.stringify(localizedSections));
    } catch (err) {
      server.log.warn({ err }, 'Redis set error');
    }

    return reply.header('X-Cache', 'MISS').send(localizedSections);
  });

  // ─── ADMIN ENDPOINTS ──────────────────────────────────────────────────────────

  /**
   * GET /admin/page-sections — список всех секций страницы для админки
   */
  server.get('/', { preHandler: [adminMiddleware] }, async (request: FastifyRequest) => {
    const { pageKey = 'home' } = request.query as { pageKey?: string };

    const sections = await server.prisma.pageSection.findMany({
      where: { pageKey },
      orderBy: { order: 'asc' },
      include: {
        updatedBy: { select: { id: true, name: true, email: true } },
      },
    });

    return sections;
  });

  /**
   * POST /admin/page-sections — добавить новую секцию
   */
  server.post('/', { preHandler: cmsHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const dto = createSectionSchema.parse(request.body);

    const section = await server.prisma.pageSection.create({
      data: {
        pageKey: dto.pageKey,
        sectionType: dto.sectionType,
        title: dto.title || dto.sectionType,
        order: dto.order,
        isVisible: dto.isVisible,
        layoutRow: dto.layoutRow,
        width: dto.width,
        content: dto.content as Prisma.InputJsonValue,
        updatedById: request.user.userId,
      },
    });

    await invalidateCache(dto.pageKey);

    await server.prisma.auditLog.create({
      data: {
        userId: request.user.userId,
        action: 'PAGE_SECTION_CREATED',
        resource: 'page_section',
        resourceId: section.id,
        meta: { pageKey: dto.pageKey, sectionType: dto.sectionType },
        ip: request.ip,
      },
    });

    return reply.status(201).send(section);
  });

  /**
   * PATCH /admin/page-sections/reorder — пакетное обновление порядка отображения
   */
  server.patch('/reorder', { preHandler: cmsHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const dto = reorderSectionsSchema.parse(request.body);

    await server.prisma.$transaction(
      dto.items.map((item) =>
        server.prisma.pageSection.update({
          where: { id: item.id },
          data: { order: item.order, updatedById: request.user.userId },
        }),
      ),
    );

    await invalidateCache(dto.pageKey);

    return reply.send({ ok: true });
  });

  /**
   * PATCH /admin/page-sections/:id — обновить содержимое / видимость секции
   */
  server.patch<{ Params: { id: string } }>('/:id', { preHandler: cmsHandler }, async (request, reply) => {
    const { id } = request.params;
    const dto = updateSectionSchema.parse(request.body);

    const existing = await server.prisma.pageSection.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ message: 'Page section not found' });
    }

    const updated = await server.prisma.pageSection.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.isVisible !== undefined && { isVisible: dto.isVisible }),
        ...(dto.layoutRow !== undefined && { layoutRow: dto.layoutRow }),
        ...(dto.width !== undefined && { width: dto.width }),
        ...(dto.content !== undefined && { content: dto.content as Prisma.InputJsonValue }),
        updatedById: request.user.userId,
      },
    });

    await invalidateCache(existing.pageKey);

    await server.prisma.auditLog.create({
      data: {
        userId: request.user.userId,
        action: 'PAGE_SECTION_UPDATED',
        resource: 'page_section',
        resourceId: id,
        meta: { isVisible: dto.isVisible },
        ip: request.ip,
      },
    });

    return reply.send(updated);
  });

  /**
   * DELETE /admin/page-sections/:id — удалить секцию
   */
  server.delete<{ Params: { id: string } }>('/:id', { preHandler: cmsHandler }, async (request, reply) => {
    const { id } = request.params;

    const existing = await server.prisma.pageSection.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ message: 'Page section not found' });
    }

    await server.prisma.pageSection.delete({ where: { id } });
    await invalidateCache(existing.pageKey);

    await server.prisma.auditLog.create({
      data: {
        userId: request.user.userId,
        action: 'PAGE_SECTION_DELETED',
        resource: 'page_section',
        resourceId: id,
        meta: { pageKey: existing.pageKey, sectionType: existing.sectionType },
        ip: request.ip,
      },
    });

    return reply.status(204).send();
  });
};
