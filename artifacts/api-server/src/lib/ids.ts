import { randomUUID } from 'node:crypto';

/** Short, sortable, human-readable identifiers for agents and runs. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

const ACCENTS = ['#c8f169', '#6fe0dc', '#f3b761', '#b79bf3', '#ed7770', '#9ed4cc'] as const;

/** Deterministic accent colour so an agent looks the same on every reload. */
export function accentFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length]!;
}
