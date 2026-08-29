// apps/api/src/modules/admin/theme.ts
// Управление дизайн-токенами темы сайта

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdminRole } from '../../lib/adminMiddleware';
import { AdminService } from './service';

const updateThemeSchema = z.object({
  primaryColor: z.string().regex(/^#([0-9A-F]{3}){1,2}$/i).optional(),
  secondaryColor: z.string().regex(/^#([0-9A-F]{3}){1,2}$/i).optional(),
  backgroundColor: z.string().regex(/^#([0-9A-F]{3}){1,2}$/i).optional(),
  textColor: z.string().regex(/^#([0-9A-F]{3}){1,2}$/i).optional(),
  borderRadius: z.string().optional(),
  fontFamily: z.string().optional(),
});

export const themeModule: FastifyPluginAsync = async (server) => {
  const getService = (req: FastifyRequest) => new AdminService(req.server.prisma);

  /**
   * GET /admin/theme — получить текущие дизайн-токены
   */
  server.get('/theme', { preHandler: [requireAdminRole('SUPER_ADMIN')] }, async (request: FastifyRequest) => {
    const service = getService(request);
    return service.getThemeSettings();
  });

  /**
   * PATCH /admin/theme — обновить дизайн-токены
   */
  server.patch('/theme', { preHandler: [requireAdminRole('SUPER_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const dto = updateThemeSchema.parse(request.body);
    const service = getService(request);
    const settings = await service.updateThemeSettings(dto, request.user.userId, request.ip);
    // C2: Инвалидируем публичный Redis-кэш темы после обновления
    await request.server.redis.del('site:theme:public').catch(() => {});
    return settings;
  });
};