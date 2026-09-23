// Primitive readers for untrusted JSON fields. Each returns the cleaned value or null; none throws.

export type Fields = Record<string, unknown>;

/** A plain JSON object (not null, not an array). */
export function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An integer in [min, max], or null. Rejects NaN, Infinity, fractions and non-numbers. */
export function intIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** A finite number in [min, max], or null. */
export function numberIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** One of a fixed set of literals, or null. */
export function oneOf<T extends string | number>(value: unknown, options: readonly T[]): T | null {
  return (options as readonly unknown[]).includes(value) ? (value as T) : null;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

/**
 * A display string: control / bidi / zero-width characters removed, whitespace runs collapsed,
 * trimmed, then at most `maxLen` characters (longer input is rejected, not truncated).
 */
export function text(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string' || value.length > maxLen * 4) return null;
  const clean = value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  return clean.length <= maxLen ? clean : null;
}

/** A token-like string: trimmed, no internal whitespace handling, at most `maxLen` characters. */
export function rawString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length <= maxLen ? trimmed : null;
}
