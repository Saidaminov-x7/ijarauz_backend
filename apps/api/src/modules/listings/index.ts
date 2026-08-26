// apps/api/src/modules/listings/index.ts

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../lib/authMiddleware';
import { ListingsService } from './service';
import {
  createListingSchema,
  updateListingSchema,
  listingsFilterSchema,
  CreateListingDto,
  UpdateListingDto,
} from './schemas';

export const listingsModule: FastifyPluginAsync = async (server) => {
  const getService = (req: FastifyRequest) => new ListingsService(req.server.prisma);

  // ─── Публичные маршруты ───────────────────────────────────────────────

  /**
   * GET /listings — список с фильтрацией
   */
  server.get('/', async (request: FastifyRequest, _reply: FastifyReply) => {
    const filter = listingsFilterSchema.parse(request.query);
    const service = getService(request);
    return service.findMany(filter);
  });

  // ─── Защищённые маршруты для личного кабинета (регистрируются ДО /:id) ─

  /**
   * GET /listings/my — мои объявления (все статусы)
   */
  server.get('/my', {
    preHandler: [authMiddleware],
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { page = 1, limit = 20 } = request.query as { page?: number; limit?: number };
    const service = getService(request);
    return service.findMyListings(request.user.userId, Number(page), Number(limit));
  });

  /**
   * GET /listings/favorites — избранные объявления
   */
  server.get('/favorites', {
    preHandler: [authMiddleware],
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const { page = 1, limit = 20 } = request.query as { page?: number; limit?: number };
    const service = getService(request);
    return service.getFavorites(request.user.userId, Number(page), Number(limit));
  });

  /**
   * GET /listings/:id — детали объявления
   */
  server.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const service = getService(request);
    const listing = await service.findById(request.params.id, true);
    if (!listing) {
      return reply.status(404).send({ message: 'Listing not found' });
    }
    return listing;
  });

  // ─── Защищённые маршруты ──────────────────────────────────────────────

  /**
   * POST /listings — создать объявление
   */
  server.post<{ Body: CreateListingDto }>('/', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const dto = createListingSchema.parse(request.body);
    const service = getService(request);
    const listing = await service.create(request.user.userId, dto);
    return reply.status(201).send(listing);
  });

  /**
   * PATCH /listings/:id — обновить объявление
   */
  server.patch<{ Params: { id: string }; Body: UpdateListingDto }>('/:id', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const dto = updateListingSchema.parse(request.body);
    const service = getService(request);
    try {
      const listing = await service.update(request.params.id, request.user.userId, dto);
      return listing;
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      return reply.status(error.statusCode ?? 500).send({ message: error.message });
    }
  });

  /**
   * POST /listings/:id/publish — опубликовать (DRAFT → ACTIVE)
   */
  server.post<{ Params: { id: string } }>('/:id/publish', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const service = getService(request);
    try {
      const listing = await service.publish(request.params.id, request.user.userId);
      return listing;
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      return reply.status(error.statusCode ?? 500).send({ message: error.message });
    }
  });

  /**
   * DELETE /listings/:id — мягкое удаление
   */
  server.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const service = getService(request);
    const isAdmin = request.user.role === 'ADMIN';
    try {
      await service.delete(request.params.id, request.user.userId, isAdmin);
      return reply.status(204).send();
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      return reply.status(error.statusCode ?? 500).send({ message: error.message });
    }
  });

  /**
   * POST /listings/:id/favorite — добавить/убрать из избранного
   */
  server.post<{ Params: { id: string } }>('/:id/favorite', {
    preHandler: [authMiddleware],
  }, async (request, _reply) => {
    const service = getService(request);
    const result = await service.toggleFavorite(request.user.userId, request.params.id);
    return result;
  });
};
