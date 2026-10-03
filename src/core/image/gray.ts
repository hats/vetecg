/**
 * Grayscale formula — an internal of the `image` module. Integer BT.601
 * (77·R + 150·G + 29·B) / 256 with rounding; the coefficients sum to exactly 256,
 * so a neutral pixel R=G=B=v maps to exactly v. Alpha is ignored.
 */
export function rgbaToGray(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const count = width * height;
  if (rgba.length < count * 4) {
    throw new Error(`RGBA-буфер короче, чем ${width}×${height}×4: ${rgba.length}`);
  }
  const gray = new Uint8Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    gray[i] = (77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2] + 128) >> 8;
  }
  return gray;
}
