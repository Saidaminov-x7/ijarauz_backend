// apps/api/src/modules/listings/promotions.service.ts

import { PrismaClient } from '@prisma/client';

export class PromotionsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Снимает VIP-статус и продвижение у объявлений с истёкшим сроком действия
   */
  async expirePromotions(now: Date = new Date()) {
    return this.prisma.listing.updateMany({
      where: {
        isPromoted: true,
        promotedUntil: { lte: now },
      },
      data: {
        isPromoted: false,
        promotedUntil: null,
        promotionTier: null,
      },
    });
  }
}
