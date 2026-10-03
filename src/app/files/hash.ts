/**
 * File byte hash for byte-identical duplicates (story 3): length + two independent 32-bit FNV-1a hashes with different
 * offsets and multipliers. Deterministic, does not depend on `crypto.subtle` (unavailable outside a secure
 * context — the app may be opened over http from local hosting); a 270 KB sheet takes a fraction of a millisecond.
 */
const OFFSET_A = 0x811c9dc5;
const PRIME_A = 0x01000193;
const OFFSET_B = 0x9747b28c;
const PRIME_B = 0x5bd1e995;

const hex8 = (value: number): string => (value >>> 0).toString(16).padStart(8, '0');

export function hashBytes(bytes: Uint8Array): string {
  let a = OFFSET_A;
  let b = OFFSET_B;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    a = Math.imul(a ^ byte, PRIME_A);
    b = Math.imul((b ^ byte) >>> 0, PRIME_B) ^ (byte << 13);
  }
  return `${bytes.length.toString(16)}:${hex8(a)}:${hex8(b)}`;
}
