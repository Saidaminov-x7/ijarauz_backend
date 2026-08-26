// apps/api/src/modules/media/index.ts

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../lib/authMiddleware';
import { MediaService } from './service';
import { uploadQuerySchema } from './schemas';

export const mediaModule: FastifyPluginAsync = async (server) => {
  const getService = (req: FastifyRequest) => new MediaService(req.server.prisma);

  /**
   * POST /media/upload — загрузить изображение
   * Content-Type: multipart/form-data
   * Field: file (image)
   * Query: listingId? (UUID)
   */
  server.post('/upload', {
    preHandler: [authMiddleware],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = uploadQuerySchema.parse(request.query);

    // Получаем multipart-файл
    const data = await request.file({
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    });

    if (!data) {
      return reply.status(400).send({ message: 'No file provided' });
    }

    // Читаем буфер
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    const service = getService(request);
    const isAdmin = request.user.role === 'ADMIN';
    try {
      const media = await service.upload(
        { filename: data.filename, mimetype: data.mimetype, data: buffer },
        request.user.userId,
        query.listingId,
        isAdmin,
      );
      return reply.status(201).send(media);
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      return reply.status(error.statusCode ?? 500).send({ message: error.message });
    }
  });

  /**
   * DELETE /media/:id — удалить медиафайл
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
   * GET /media/listing/:listingId — медиафайлы объявления
   */
  server.get<{ Params: { listingId: string } }>('/listing/:listingId', async (
    request,
    _reply,
  ) => {
    const service = getService(request);
    const media = await service.getListingMedia(request.params.listingId);
    return media;
  });

  /**
   * PATCH /media/:id/attach — привязать файл к объявлению
   */
  server.patch<{ Params: { id: string }; Body: { listingId: string } }>('/:id/attach', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { listingId } = request.body;
    if (!listingId) {
      return reply.status(400).send({ message: 'listingId is required' });
    }
    const service = getService(request);
    const isAdmin = request.user.role === 'ADMIN';
    try {
      const media = await service.attachToListing(request.params.id, listingId, request.user.userId, isAdmin);
      return media;
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      return reply.status(error.statusCode ?? 500).send({ message: error.message });
    }
  });
};
