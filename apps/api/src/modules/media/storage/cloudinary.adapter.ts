// apps/api/src/modules/media/storage/cloudinary.adapter.ts

import { IStorageAdapter, StorageUploadResult } from './storage.interface';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import sharp from 'sharp';
import { config } from '../../../config';

/**
 * Облачный адаптер Cloudinary (S3-совместимое медиахранилище для Production)
 */
export class CloudinaryStorageAdapter implements IStorageAdapter {
  constructor() {
    if (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET) {
      throw new Error(
        'Cloudinary adapter requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET environment variables',
      );
    }

    cloudinary.config({
      cloud_name: config.CLOUDINARY_CLOUD_NAME,
      api_key: config.CLOUDINARY_API_KEY,
      api_secret: config.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  async upload(file: {
    filename: string;
    mimetype: string;
    data: Buffer;
    hash: string;
  }): Promise<StorageUploadResult> {
    // 1. Клиентская пред-оптимизация через sharp перед загрузкой в облако
    const sharpInstance = sharp(file.data);
    const metadata = await sharpInstance.metadata();

    const optimized = await sharpInstance
      .resize({
        width: 1920,
        height: 1080,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();

    // 2. Потоковая загрузка в Cloudinary
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: config.CLOUDINARY_FOLDER || 'ijarauz/listings',
          resource_type: 'image',
          format: 'webp',
          public_id: file.hash.slice(0, 32),
        },
        (error, result: UploadApiResponse | undefined) => {
          if (error || !result) {
            return reject(new Error(`Cloudinary upload failed: ${error?.message || 'Unknown error'}`));
          }

          resolve({
            url: result.secure_url,
            key: result.public_id,
            mimeType: 'image/webp',
            size: result.bytes || optimized.length,
            width: result.width || metadata.width,
            height: result.height || metadata.height,
          });
        },
      );

      uploadStream.end(optimized);
    });
  }

  async delete(key: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(key);
    } catch (err) {
      // TODO: Pass FastifyBaseLogger to CloudinaryStorageAdapter constructor when DI container is introduced
      console.warn(`[CloudinaryStorageAdapter] Failed to delete file: ${key}`, err);
    }
  }
}
