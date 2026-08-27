// apps/api/src/modules/media/storage/index.ts

import { IStorageAdapter } from './storage.interface';
import { LocalStorageAdapter } from './local.adapter';
import { CloudinaryStorageAdapter } from './cloudinary.adapter';
import { config } from '../../../config';

export * from './storage.interface';
export * from './local.adapter';
export * from './cloudinary.adapter';

import { FastifyBaseLogger } from 'fastify';

/**
 * Фабрика хранилища: возвращает адаптер согласно переменной STORAGE_DRIVER
 */
export function createStorageAdapter(logger?: FastifyBaseLogger): IStorageAdapter {
  if (config.STORAGE_DRIVER === 'cloudinary') {
    return new CloudinaryStorageAdapter(logger);
  }
  return new LocalStorageAdapter(config.STORAGE_PATH, logger);
}
