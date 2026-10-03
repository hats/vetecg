/** Overlay colors and texts (VIS-01, VIS-02, story 24). Single source for the scene and the toolbar. */
import type { EctopicKind, LeadId, UnreliableKind } from '../../types/contracts';

/** Color per lead — six distinguishable on a white sheet with a black curve. */
export const LEAD_COLORS: Record<LeadId, string> = {
  I: '#0284c7',
  II: '#16a34a',
  III: '#9333ea',
  aVR: '#0d9488',
  aVL: '#b45309',
  aVF: '#db2777',
};

/** Wave markers: P — orange, QRS — red, T — blue (VIS-02). */
export const MARKER_COLORS = { P: '#f97316', QRS: '#dc2626', T: '#1d4ed8' } as const;
export type MarkerGroup = keyof typeof MARKER_COLORS;

/** Unreliable spans: gap and merging — yellow, device clipping — red dashes. */
export const UNRELIABLE_COLORS: Record<UnreliableKind, string> = { gap: '#eab308', ambiguous: '#eab308', clipped: '#dc2626' };

export const UNRELIABLE_TEXT: Record<UnreliableKind, string> = {
  gap: 'Разрыв кривой: участок интерполирован, в измерения не идёт',
  ambiguous: 'Слипание с соседним отведением: положение кривой неточно',
  clipped: 'Обрезано прибором: кривая ушла за рамку, амплитуда неизвестна — не кривая',
};

export const ECTOPIC_COLOR = '#7c3aed';
export const ECTOPIC_LABEL: Record<EctopicKind, string> = { SVE: 'НЖЭ', VE: 'ЖЭ' };

export const GRID_COLOR = '#15803d';
export const SEPARATOR_COLOR = '#1e293b';
export const CALIBRATION_COLOR = '#0f766e';

export const DEBUG_COLORS = { ink: 'rgba(220, 38, 38, 0.45)', zone: '#2563eb', glyph: '#7c3aed' } as const;
