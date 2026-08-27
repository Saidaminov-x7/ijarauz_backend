// apps/api/src/modules/saved-searches/index.ts

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../lib/authMiddleware';
import { SavedSearchesService } from './service';
import { createSavedSearchSchema, CreateSavedSearchDto } from './schemas';

export const savedSearchesModule: FastifyPluginAsync = async (server) => {
  const getService = (req: FastifyRequest) => new SavedSearchesService(req.server.prisma, req.log);

  /**
   * GET /saved-searches — список сохранённых поисков текущего пользователя
   */
  server.get('/', { preHandler: [authMiddleware] }, async (request: FastifyRequest) => {
    const service = getService(request);
    return service.findByUser(request.user.userId);
  });

  /**
   * POST /saved-searches — сохранить новый поиск
   */
  server.post<{ Body: CreateSavedSearchDto }>('/', { preHandler: [authMiddleware] }, async (request, reply: FastifyReply) => {
    const dto = createSavedSearchSchema.parse(request.body);
    const service = getService(request);
    const result = await service.create(request.user.userId, dto);
    return reply.status(201).send(result);
  });

  /**
   * DELETE /saved-searches/:id — удалить сохранённый поиск
   */
  server.delete<{ Params: { id: string } }>('/:id', { preHandler: [authMiddleware] }, async (request, reply: FastifyReply) => {
    const service = getService(request);
    try {
      await service.delete(request.params.id, request.user.userId);
      return reply.status(204).send();
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      return reply.status(error.statusCode ?? 500).send({ message: error.message });
    }
  });
};
