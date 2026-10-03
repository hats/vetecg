/**
 * Non-sinus rhythm episodes (ARRHYTHM-05): ≥ 3 consecutive ectopic beats of one sheet — a run (`ve_run` /
 * `sve_run` by majority type, focus — the most frequent, coupling — of the first beat); ≥ 3 consecutive non-ectopic
 * beats with usable delineation where P was assessed and is absent (`p-wave.ts`: a P wave hidden in T during
 * tachycardia does not count as a span without P) — a span without P waves (`no_p`). The dictionary codes `vt`/`svt`
 * are not set: the reference has no tachycardia HR threshold (research-norms gives one only for dogs from a single
 * source).
 *
 * Start — time of the episode's first beat (case time scale), duration — to the last beat plus the mean RR within
 * the episode (the last complex is included in full), not longer than the recording. `beats` — global indices.
 */
import type { Ectopic, Episode } from '../../types/contracts';
import { delineationUsable, mean, type MergedBeat } from '../measure';
import { pAbsent } from './p-wave';

export const MIN_EPISODE_BEATS = 3;

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
}

function episodeOf(run: MergedBeat[], kind: string, focus: string, couplingMs: number, pagesSpanMs: number | undefined): Episode {
  const first = run[0];
  const last = run[run.length - 1];
  const internal = run.slice(1).map((m) => m.rrPrevMs).filter((v): v is number => v !== undefined);
  let durationMs = last.tMs - first.tMs + (internal.length ? mean(internal) : 0);
  if (pagesSpanMs !== undefined && pagesSpanMs > 0) durationMs = Math.min(durationMs, Math.max(0, pagesSpanMs - first.tMs));
  return { startMs: first.tMs, durationMs: Math.round(durationMs), kind, focus, couplingMs: Math.round(couplingMs), beats: run.map((m) => m.index) };
}

/** Groups of consecutive beats of one sheet satisfying the predicate, of length ≥ `MIN_EPISODE_BEATS`. */
function runs(merged: readonly MergedBeat[], predicate: (m: MergedBeat, i: number) => boolean): MergedBeat[][] {
  const out: MergedBeat[][] = [];
  let current: MergedBeat[] = [];
  const flush = (): void => {
    if (current.length >= MIN_EPISODE_BEATS) out.push(current);
    current = [];
  };
  merged.forEach((m, i) => {
    const continues = current.length > 0 && current[current.length - 1].pageIndex === m.pageIndex;
    if (!continues) flush();
    if (predicate(m, i)) current.push(m);
    else flush();
  });
  flush();
  return out;
}

export function findEpisodes(merged: readonly MergedBeat[], premature: readonly boolean[], ectopics: readonly Ectopic[], pagesSpanMs?: number): Episode[] {
  const byBeat = new Map(ectopics.map((e) => [e.beat, e]));
  const episodes: Episode[] = [];
  for (const run of runs(merged, (_, i) => premature[i])) {
    const items = run.map((m) => byBeat.get(m.index)).filter((e): e is Ectopic => !!e);
    const ve = items.filter((e) => e.kind === 'VE').length;
    const kind = ve * 2 >= items.length ? 've_run' : 'sve_run';
    const first = items[0];
    episodes.push(episodeOf(run, kind, mode(items.map((e) => e.focus)), first?.couplingMs ?? run[0].rrPrevMs ?? 0, pagesSpanMs));
  }
  for (const run of runs(merged, (m, i) => !premature[i] && delineationUsable(m) && pAbsent(m.delineation))) {
    const coupling = run[0].rrPrevMs ?? run[1]?.rrPrevMs ?? 0;
    episodes.push(episodeOf(run, 'no_p', 'unknown', coupling, pagesSpanMs));
  }
  return episodes.sort((a, b) => a.startMs - b.startMs);
}
