/**
 * Butterworth biquad sections (bilinear transform) and two-pass zero-phase filtering — an in-house
 * implementation without external libraries; used by the signal filter (`filterSignal`)
 * and by the band-pass filter of the beat detector.
 *
 * An order-N (even) filter is a cascade of N/2 2nd-order sections with Butterworth quality factors
 * Q_k = 1 / (2·sin((2k − 1)·π / (2N))). Each section is direct form II (transposed):
 *   y[n] = b0·x[n] + z1;  z1 ← b1·x[n] − a1·y[n] + z2;  z2 ← b2·x[n] − a2·y[n].
 *
 * Two-pass (`filtfilt`): the signal is extended by odd reflection at both ends (2·x[0] − x[k]),
 * filtered forward, then backward; the initial section state is the steady-state response to the first sample.
 * The result is the squared magnitude response and zero phase: peaks are not shifted.
 */

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Quality factors of Butterworth sections for an even order. */
function butterworthQs(order: number): number[] {
  if (order < 2 || order % 2 !== 0) throw new Error(`Порядок Баттерворта должен быть чётным ≥ 2, получено ${order}`);
  const qs: number[] = [];
  for (let k = 1; k <= order / 2; k++) qs.push(1 / (2 * Math.sin(((2 * k - 1) * Math.PI) / (2 * order))));
  return qs;
}

function section(fc: number, fs: number, q: number, kind: 'lowpass' | 'highpass'): Biquad {
  const K = Math.tan((Math.PI * fc) / fs);
  const norm = 1 / (1 + K / q + K * K);
  const a1 = 2 * (K * K - 1) * norm;
  const a2 = (1 - K / q + K * K) * norm;
  if (kind === 'lowpass') {
    const b0 = K * K * norm;
    return { b0, b1: 2 * b0, b2: b0, a1, a2 };
  }
  return { b0: norm, b1: -2 * norm, b2: norm, a1, a2 };
}

/** Butterworth low-pass of order `order` (default 2) with cutoff `fc` Hz at sampling rate `fs`. */
export function designLowpass(fc: number, fs: number, order = 2): Biquad[] {
  return butterworthQs(order).map((q) => section(fc, fs, q, 'lowpass'));
}

/** Butterworth high-pass of order `order` (default 2). */
export function designHighpass(fc: number, fs: number, order = 2): Biquad[] {
  return butterworthQs(order).map((q) => section(fc, fs, q, 'highpass'));
}

/**
 * Section stability: poles inside the unit circle (|a2| < 1, |a1| < 1 + a2) and finite coefficients.
 * A cutoff at or above the Nyquist frequency gives K ≤ 0 or infinity — such a section is unstable or degenerate.
 */
export function isStable(sections: Biquad[]): boolean {
  return sections.every(
    (s) =>
      [s.b0, s.b1, s.b2, s.a1, s.a2].every(Number.isFinite) && Math.abs(s.a2) < 1 && Math.abs(s.a1) < 1 + s.a2,
  );
}

/** One pass of a section over the array (in place); the initial state is steady-state for a constant input x[0]. */
function runSection(x: Float64Array, s: Biquad): void {
  const n = x.length;
  if (n === 0) return;
  const dc = (s.b0 + s.b1 + s.b2) / (1 + s.a1 + s.a2);
  let z1 = (dc - s.b0) * x[0];
  let z2 = (s.b2 - s.a2 * dc) * x[0];
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const y = s.b0 * xi + z1;
    z1 = s.b1 * xi - s.a1 * y + z2;
    z2 = s.b2 * xi - s.a2 * y;
    x[i] = y;
  }
}

function reverse(x: Float64Array): void {
  for (let i = 0, j = x.length - 1; i < j; i++, j--) {
    const t = x[i];
    x[i] = x[j];
    x[j] = t;
  }
}

/**
 * Two-pass filtering by a cascade of sections with odd extension of `padLen` samples (default — the
 * whole signal length minus one: the transient of a 0.5 Hz high-pass is longer than any short padding).
 */
export function filtfilt(x: ArrayLike<number>, sections: Biquad[], padLen?: number): Float32Array {
  const n = x.length;
  if (n < 2 || sections.length === 0) return Float32Array.from(x);
  const pad = Math.max(0, Math.min(n - 1, padLen ?? n - 1));
  const ext = new Float64Array(n + 2 * pad);
  for (let k = 0; k < pad; k++) ext[k] = 2 * x[0] - x[pad - k];
  for (let i = 0; i < n; i++) ext[pad + i] = x[i];
  for (let k = 0; k < pad; k++) ext[pad + n + k] = 2 * x[n - 1] - x[n - 2 - k];
  for (const s of sections) runSection(ext, s);
  reverse(ext);
  for (const s of sections) runSection(ext, s);
  reverse(ext);
  return Float32Array.from(ext.subarray(pad, pad + n));
}
