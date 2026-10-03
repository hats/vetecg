/** Small DOM helpers: element creation without innerHTML (file names are user data), labels. */
import type { Species } from '../../types/contracts';
import type { SheetStatus } from '../state/case-store';

export type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | null | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return el;
}

export const percent = (x: number): string => `${Math.round(x * 100)} %`;

export const SPECIES_LABEL: Record<Species, string> = { dog: 'собака', cat: 'кошка' };

export const STATUS_LABEL: Record<SheetStatus, string> = {
  queued: 'в очереди',
  analyzing: 'распознаётся',
  done: 'готово',
  error: 'ошибка',
};

export const STATUS_CLASS: Record<SheetStatus, string> = {
  queued: 'badge-ghost',
  analyzing: 'badge-info',
  done: 'badge-success',
  error: 'badge-error',
};
