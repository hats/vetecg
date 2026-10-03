/**
 * File preparation in the browser (stories 1–2): bytes → hash, classification by signature, decoding via
 * `createImageBitmap` and canvas (the canvas is filled white under a transparent PNG — otherwise transparency becomes
 * "ink"), grayscale image `fromImageData`, thumbnail for the strip, object URL of the source for the overlay. File
 * errors go to `SheetInput.problem`, not exceptions: the remaining files proceed.
 */
import { fromImageData } from '../../core/image';
import type { SheetInput } from '../state/case-store';
import { classifyFile, MIN_SHEET_WIDTH } from './classify';
import { hashBytes } from './hash';

const THUMBNAIL_WIDTH = 240;
const HEAD_BYTES = 16;

/** Without Web Worker, `createImageBitmap` and canvas 2D the app cannot work («Техника» (technical) elaboration, failure). */
export function browserSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof document !== 'undefined' &&
    document.createElement('canvas').getContext('2d') !== null
  );
}

/** Batch file preparation (story 2): a failure to prepare one file yields an «ошибка» (error) sheet with text; the rest proceed. */
export async function prepareFiles(files: readonly File[], prepare: (file: File) => Promise<SheetInput> = prepareFile): Promise<SheetInput[]> {
  return Promise.all(
    files.map(async (file): Promise<SheetInput> => {
      try {
        return await prepare(file);
      } catch (error: unknown) {
        console.error(`Файл «${file.name}» не прочитан:`, error instanceof Error ? error.message : error);
        return { name: file.name, hash: `unreadable:${file.name}:${file.size}:${file.lastModified}`, problem: { kind: 'unreadable' } };
      }
    }),
  );
}

export async function prepareFile(file: File): Promise<SheetInput> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name;
  const hash = hashBytes(bytes);
  const kind = classifyFile({ name, type: file.type, head: bytes.subarray(0, HEAD_BYTES) });
  if (kind === 'pdf') return { name, hash, problem: { kind: 'pdf' } };
  if (kind === 'unknown') return { name, hash, problem: { kind: 'not_image' } };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: `image/${kind}` }));
  } catch {
    return { name, hash, problem: { kind: 'corrupt' } };
  }
  const { width, height } = bitmap;
  if (width < MIN_SHEET_WIDTH) {
    bitmap.close();
    return { name, hash, problem: { kind: 'too_narrow', width }, width, height };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return { name, hash, problem: { kind: 'corrupt' } };
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0);
  const image = fromImageData(ctx.getImageData(0, 0, width, height));
  canvas.width = 0;
  canvas.height = 0;

  const thumbHeight = Math.max(1, Math.round((height * THUMBNAIL_WIDTH) / width));
  const thumb = document.createElement('canvas');
  thumb.width = THUMBNAIL_WIDTH;
  thumb.height = thumbHeight;
  thumb.getContext('2d')?.drawImage(bitmap, 0, 0, THUMBNAIL_WIDTH, thumbHeight);
  const thumbnailUrl = thumb.toDataURL('image/jpeg', 0.75);
  bitmap.close();

  return { name, hash, image, imageUrl: URL.createObjectURL(file), thumbnailUrl, width, height };
}
