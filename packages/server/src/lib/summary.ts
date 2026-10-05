import type { EventSummary } from '@hookwire/types';

export function generateSummary(opts: {
  contentType?: string;
  bodySize: number;
  method: string;
}): EventSummary {
  const ct = opts.contentType?.split(';')[0] ?? 'unknown';
  return {
    title: 'Incoming webhook',
    subtitle: `${opts.method} · ${ct} · ${fmt(opts.bodySize)}`,
  };
}

function fmt(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
