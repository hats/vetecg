/**
 * Content fingerprint of a `PageResult` — fallback hash for finding byte-identical duplicates when the caller did not
 * pass file hashes: the same image gives the same sheet result (the core is pure functions), and a fingerprint over the
 * header crop, time labels, HR row and signal samples matches exactly for copies. FNV-1a 32-bit.
 */
import type { PageResult } from '../../types/contracts';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function pageFingerprint(page: PageResult): string {
  let h = FNV_OFFSET;
  const mix = (bytes: ArrayLike<number>): void => {
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i] & 0xff;
      h = Math.imul(h, FNV_PRIME) >>> 0;
    }
  };
  const text = (s: string): void => mix(new TextEncoder().encode(s));

  const crop = page.meta.headerNameCrop;
  text(`${crop.width}x${crop.height}`);
  mix(crop.data);
  text(JSON.stringify(page.meta.timeLabels));
  text(JSON.stringify(page.meta.hrRow));
  text(page.meta.headerDate ?? '');
  for (const s of page.signals) {
    text(`${s.id}:${s.mv.length}:${s.baselineY}`);
    mix(new Uint8Array(s.mv.buffer, s.mv.byteOffset, s.mv.byteLength));
  }
  return `fp:${h.toString(16).padStart(8, '0')}`;
}
