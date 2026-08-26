// apps/api/src/modules/media/storage/index.ts

import { IStorageAdapter } from './storage.interface';
import { LocalStorageAdapter } from './local.adapter';
import { CloudinaryStorageAdapter } from './cloudinary.adapter';
import { config } from '../../../config';

export * from './storage.interface';
export * from './local.adapter';
export * from './cloudinary.adapter';

/**
 * Фабрика хранилища: возвращает адаптер согласно переменной STORAGE_DRIVER
 */
export function createStorageAdapter(): IStorageAdapter {
  if (config.STORAGE_DRIVER === 'cloudinary') {
    return new CloudinaryStorageAdapter();
  }
  return new LocalStorageAdapter(config.STORAGE_PATH);
}
