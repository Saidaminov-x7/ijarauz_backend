// apps/api/src/modules/media/schemas.ts

import { z } from 'zod';

export const uploadQuerySchema = z.object({
  listingId: z.string().uuid().optional(),
});

export type UploadQueryDto = z.infer<typeof uploadQuerySchema>;

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
