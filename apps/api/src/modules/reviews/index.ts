// apps/api/src/modules/reviews/index.ts
// Модуль отзывов об объектах и арендодателях

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../lib/authMiddleware';

const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(3).max(1000),
});

export const reviewsModule = async (server: FastifyInstance) => {
  const prisma = server.prisma;

  /**
   * GET /listings/:id/reviews
   * Получить отзывы к конкретному объявлению / арендодателю
   */
  server.get<{ Params: { id: string } }>('/listings/:id/reviews', async (request, reply) => {
    const { id: listingId } = request.params;

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, ownerId: true },
    });

    if (!listing) {
      return reply.status(404).send({ message: 'Объявление не найдено' });
    }

    const reviews = await prisma.review.findMany({
      where: {
        OR: [
          { listingId },
          { landlordId: listing.ownerId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    const totalReviews = reviews.length;
    const averageRating = totalReviews > 0
      ? Number((reviews.reduce((acc, r) => acc + r.rating, 0) / totalReviews).toFixed(1))
      : 5.0;

    // Вычисляем общий рейтинг арендодателя по всем его объектам
    const landlordAgg = await prisma.review.aggregate({
      where: { landlordId: listing.ownerId },
      _avg: { rating: true },
      _count: { id: true },
    });
    const landlordRating = landlordAgg._avg.rating
      ? Number(landlordAgg._avg.rating.toFixed(1))
      : averageRating;
    const landlordTotalReviews = landlordAgg._count.id || totalReviews;

    return reply.send({
      listingId,
      ownerId: listing.ownerId,
      averageRating,
      totalReviews,
      landlordRating,
      landlordTotalReviews,
      items: reviews.map((r) => ({
        id: r.id,
        author: r.author.name || 'Анонимный арендатор',
        authorAvatar: r.author.avatar,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

  /**
   * POST /listings/:id/reviews
   * Оставить отзыв к объявлению (требует авторизацию)
   */
  server.post<{ Params: { id: string }; Body: { rating: number; comment: string } }>(
    '/listings/:id/reviews',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id: listingId } = request.params;
      const userId = request.user.userId;

      const body = createReviewSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({
          message: 'Некорректные данные отзыва',
          errors: body.error.flatten().fieldErrors,
        });
      }

      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
        select: { id: true, ownerId: true },
      });

      if (!listing) {
        return reply.status(404).send({ message: 'Объявление не найдено' });
      }

      if (listing.ownerId === userId) {
        return reply.status(400).send({ message: 'Вы не можете оставить отзыв на собственное объявление' });
      }

      const review = await prisma.review.create({
        data: {
          listingId,
          landlordId: listing.ownerId,
          authorId: userId,
          rating: body.data.rating,
          comment: body.data.comment.trim(),
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
      });

      // Пересчитываем средний рейтинг
      const listingAgg = await prisma.review.aggregate({
        where: {
          OR: [
            { listingId },
            { landlordId: listing.ownerId },
          ],
        },
        _avg: { rating: true },
        _count: { id: true },
      });

      const updatedAverageRating = listingAgg._avg.rating
        ? Number(listingAgg._avg.rating.toFixed(1))
        : review.rating;
      const updatedTotalReviews = listingAgg._count.id || 1;

      return reply.status(201).send({
        id: review.id,
        author: review.author.name || 'Вы (Арендатор)',
        authorAvatar: review.author.avatar,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt.toISOString(),
        averageRating: updatedAverageRating,
        totalReviews: updatedTotalReviews,
      });
    },
  );

  /**
   * GET /users/:id/rating
   * Получить рейтинг и отзывы конкретного продавца/пользователя
   */
  server.get<{ Params: { id: string } }>('/users/:id/rating', async (request, reply) => {
    const { id: userId } = request.params;

    const [agg, recentReviews] = await Promise.all([
      prisma.review.aggregate({
        where: { landlordId: userId },
        _avg: { rating: true },
        _count: { id: true },
      }),
      prisma.review.findMany({
        where: { landlordId: userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          author: {
            select: { id: true, name: true, avatar: true },
          },
        },
      }),
    ]);

    const averageRating = agg._avg.rating ? Number(agg._avg.rating.toFixed(1)) : 5.0;
    const totalReviews = agg._count.id || 0;

    return reply.send({
      userId,
      averageRating,
      totalReviews,
      items: recentReviews.map((r) => ({
        id: r.id,
        author: r.author.name || 'Арендатор',
        authorAvatar: r.author.avatar,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });
};
