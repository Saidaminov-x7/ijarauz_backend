// apps/api/src/modules/page-sections/schemas.ts
// Zod-схемы для конструктора страниц

import { z } from 'zod';

export const createPageSectionSchema = z.object({
  pageKey: z.string().min(1).max(50),
  sectionType: z.string().min(1).max(50),
  title: z.string().max(200).optional(),
  order: z.number().int().min(0).optional(),
  isVisible: z.boolean().optional(),
  layoutRow: z.number().int().min(1).max(10).optional(),
  width: z.number().int().min(1).max(12).optional(),
  content: z.record(z.unknown()),
});

export type CreatePageSectionDto = z.infer<typeof createPageSectionSchema>;

export const updatePageSectionSchema = createPageSectionSchema.partial().extend({
  id: z.string().uuid(),
});

export type UpdatePageSectionDto = z.infer<typeof updatePageSectionSchema>;

export const reorderPageSectionsSchema = z.object({
  pageKey: z.string().min(1).max(50),
  items: z.array(z.object({
    id: z.string().uuid(),
    order: z.number().int().min(0),
  })),
});

export type ReorderPageSectionsDto = z.infer<typeof reorderPageSectionsSchema>;