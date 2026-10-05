/** Parse a positive-integer env override, falling back to `fallback`. */
export function envInt(env: any, key: string, fallback: number): number {
  const v = env?.[key];
  if (v === undefined || v === null) return fallback;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
