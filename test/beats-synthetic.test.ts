import { describe, expect, it } from 'vitest';
import { detectBeats } from '../src/analysis/beats';
import type { LeadSignal, Species } from '../src/types/contracts';
import { renderSixLeads } from './synthetic/signal';

describe('detectBeats: Pan-Tompkins on the normalized lead sum, per-lead position consensus, R in II', () => {
  it.each<Species>(['dog', 'cat'])('%s: six synthetic leads — every beat and only it is found; tMs and perLead.II.tMs — R peak within ±4 ms', (species) => {
    const { signals, beats: truth } = renderSixLeads({ species, durationMs: 5000, noiseMv: 0.01 });
    const beats = detectBeats(signals, species);
    expect(beats.map((b) => b.index)).toEqual(truth.map((_, k) => k));
    expect(beats.length).toBe(truth.length);
    beats.forEach((beat, k) => {
      expect(Math.abs(beat.tMs - truth[k].rPeak)).toBeLessThanOrEqual(4);
      expect(beat.perLead.II).toBeDefined();
      expect(Math.abs(beat.perLead.II!.tMs - truth[k].rPeak)).toBeLessThanOrEqual(4);
      expect(beat.confidence).toBeGreaterThanOrEqual(0.8);
      expect(beat.reasons).toEqual([]);
    });
  });

  it('HR outside 30…320: a 165 ms interval (364 bpm) and a 2.2 s pause (27 bpm) flag both adjacent beats hr_implausible, beats are kept', () => {
    // Dog rhythm of 500 ms with a premature beat (RR 165 ms) and a compensatory pause of 2200 ms.
    const { signals, beats: truth } = renderSixLeads({ species: 'dog', durationMs: 6000, firstBeatMs: 300, rrMs: [500, 500, 165, 2200, 500, 500, 500], noiseMv: 0.005 });
    const beats = detectBeats(signals, 'dog');
    expect(beats.length).toBe(truth.length);
    const flagged = beats.filter((b) => b.reasons.includes('hr_implausible')).map((b) => b.index);
    // Beats 2–3 bound the short interval, 3–4 bound the pause.
    expect(flagged).toEqual([2, 3, 4]);
    for (const b of beats) expect(b.confidence).toBeGreaterThan(0);
  });

  it('clipped span in all leads: the beat inside is not detected; clipped in one lead only — beat found without that lead in perLead', () => {
    const base = renderSixLeads({ species: 'dog', durationMs: 5000, noiseMv: 0.005 });
    const target = base.beats[3];
    const i0 = Math.round((target.qOn - 40) / 2);
    const i1 = Math.round((target.sOff + 40) / 2);
    const clip = (s: LeadSignal): LeadSignal => ({ ...s, unreliable: [{ i0, i1, kind: 'clipped' }] });
    // All six leads are clipped on this beat — the beat is gone, the rest are in place.
    const allClipped = detectBeats(base.signals.map(clip), 'dog');
    expect(allClipped.length).toBe(base.beats.length - 1);
    expect(allClipped.some((b) => Math.abs(b.tMs - target.rPeak) <= 20)).toBe(false);
    // Only aVF is clipped — the beat is found from the others, aVF is missing from perLead, II is in place.
    const oneClipped = detectBeats(base.signals.map((s) => (s.id === 'aVF' ? clip(s) : s)), 'dog');
    expect(oneClipped.length).toBe(base.beats.length);
    const found = oneClipped.find((b) => Math.abs(b.tMs - target.rPeak) <= 4)!;
    expect(found).toBeDefined();
    expect(found.perLead.aVF).toBeUndefined();
    expect(found.perLead.II).toBeDefined();
  });

  it('empty signal set and signals without samples — empty beat list, no exceptions', () => {
    expect(detectBeats([], 'dog')).toEqual([]);
    const empty: LeadSignal = { id: 'II', fs: 500, t0: 0, mv: new Float32Array(0), baselineY: 0, confidence: 0, unreliable: [] };
    expect(detectBeats([empty], 'cat')).toEqual([]);
  });
});
