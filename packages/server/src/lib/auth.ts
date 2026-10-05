/**
 * Constant-time string comparison for shared-secret checks.
 *
 * crypto.subtle.timingSafeEqual is not available in the Workers runtime,
 * so we XOR-accumulate over encoded bytes. When lengths differ we still
 * run a fixed-length loop over the expected value to reduce length/timing
 * leakage before returning false.
 */
export function timingSafeEqual(provided: string | null | undefined, expected: string): boolean {
  const enc = new TextEncoder();
  const e = enc.encode(expected);
  const p = enc.encode(provided ?? '');

  let diff = 0;
  // Always iterate over the expected length so a wrong-length guess does
  // not exit early.
  for (let i = 0; i < e.length; i++) {
    diff |= e[i] ^ (i < p.length ? p[i] : 0);
  }
  if (p.length !== e.length) return false;
  return diff === 0;
}
