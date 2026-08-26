// apps/api/src/config/index.ts

import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis URL'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  REFRESH_SECRET: z.string().min(32, 'REFRESH_SECRET must be at least 32 characters'),
  GOOGLE_CLIENT_ID: z.string().optional(),

  // Telegram 2FA Bot
  TELEGRAM_BOT_TOKEN: z.string().default('8948945605:AAEuAw2oPTRChsWJU5fyu7D53pb4gtCXpKg'),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),

  // CORS — список доменов через запятую, например: https://ijarauz.uz,https://www.ijarauz.uz
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((val) => val.split(',').map((s) => s.trim()).filter(Boolean)),

  // AI
  OLLAMA_BASE_URL: z.string().url('OLLAMA_BASE_URL must be a valid URL').default('http://localhost:11434'),
  AI_SERVICE_URL: z.string().url('AI_SERVICE_URL must be a valid URL').default('http://localhost:8000'),
  OLLAMA_MODEL: z.string().default('llama3'),

  // Media storage
  STORAGE_DRIVER: z.enum(['local', 'cloudinary']).default('local'),
  STORAGE_PATH: z.string().default('/tmp/uploads'),
  MAX_FILE_SIZE: z.coerce.number().int().positive().default(10 * 1024 * 1024), // 10 MB

  // Cloudinary (используется при STORAGE_DRIVER=cloudinary)
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default('ijarauz/listings'),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
});

function parseConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  • ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    console.error('❌ Invalid environment configuration:\n' + errors);
    process.exit(1);
  }
  return result.data;
}

export const config = parseConfig();
export type Config = typeof config;