/**
 * Module `image`: image representation. Exposes `GrayImage`, `fromImageData`,
 * `createGrayImage`; `fromJpeg` (Node/tests) lives in `./jpeg.ts` so that `jpeg-js` stays out of the browser bundle.
 * The grayscale formula and the decoder are module internals.
 */
import type { GrayImage } from '../../types/contracts';
import { rgbaToGray } from './gray';

export type { GrayImage };

/** Structurally compatible with DOM `ImageData` (row-major RGBA), but does not require the DOM in Node. */
export interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Grayscale image of the given size filled with a single brightness (white by default). */
export function createGrayImage(width: number, height: number, fill = 255): GrayImage {
  const data = new Uint8Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

/** RGBA (canvas `ImageData`) → grayscale. */
export function fromImageData(image: ImageDataLike): GrayImage {
  const { width, height } = image;
  return { width, height, data: rgbaToGray(image.data, width, height) };
}
