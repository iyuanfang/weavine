// Single source of truth for contact importance values across the web-spa UI.
// Mirrors the SQLite CHECK constraint + PG migration: `high | medium | low`.
//
// The desktop Rust side enforces the same three values via
// `Contact.importance` and the schema migration in `src-tauri/src/migration.rs`
// (M18) + `server/migrations/20260809000006_contact_importance_cleanup.sql`.

export type Importance = 'high' | 'medium' | 'low';

export const DEFAULT_IMPORTANCE: Importance = 'low';

export const IMPORTANCE_VALUES: readonly Importance[] = [
  'high',
  'medium',
  'low',
] as const;

export interface ImportanceOption {
  value: Importance;
  label: string;
  icon: string;
  color: string;
}

export const IMPORTANCE_OPTIONS: readonly ImportanceOption[] = [
  { value: 'high', label: '高', icon: '🔴', color: '#ef4444' },
  { value: 'medium', label: '中', icon: '🟡', color: '#f59e0b' },
  { value: 'low', label: '低', icon: '⚪', color: '#9ca3af' },
] as const;

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export const IMPORTANCE_DOT: Record<Importance, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#9ca3af',
};

export function isImportance(v: unknown): v is Importance {
  return v === 'high' || v === 'medium' || v === 'low';
}

// Normalize a raw importance string to a valid `Importance`.
// Used when hydrating form state from a `Contact.importance` field whose
// declared TypeScript type is `string` (serde-friendly). Legacy rows or
// stale local caches may still contain the removed `normal` bucket; we
// collapse those to `medium` so existing data renders sensibly without
// blocking the form.
export function normalizeImportance(v: string | null | undefined): Importance {
  if (isImportance(v)) return v;
  if (v === 'normal') return 'medium';
  return DEFAULT_IMPORTANCE;
}

export interface ImportanceMeta {
  label: string;
  color: string;
  icon: string;
}

const META_BY_VALUE: Record<Importance, ImportanceMeta> = {
  high: { label: '高', color: '#ef4444', icon: '🔴' },
  medium: { label: '中', color: '#f59e0b', icon: '🟡' },
  low: { label: '低', color: '#9ca3af', icon: '⚪' },
};

export function importanceMeta(value: string): ImportanceMeta {
  if (isImportance(value)) return META_BY_VALUE[value];
  return { label: value, color: '#9ca3af', icon: '·' };
}