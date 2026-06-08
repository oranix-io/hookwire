import type { EventSummary } from '@hookwire/types';

export interface SummaryInput {
  providerHint: string;
  eventType: string | null;
  contentType: string | undefined;
  bodySize: number;
  method: string;
}

export function generateSummary(input: SummaryInput): EventSummary {
  const { providerHint, eventType, contentType, bodySize, method } = input;

  if (providerHint === 'github' && eventType) {
    return {
      title: `GitHub ${eventType}`,
      subtitle: formatSize(bodySize),
    };
  }

  if (providerHint === 'stripe') {
    return {
      title: 'Stripe event',
      subtitle: eventType ?? formatSize(bodySize),
    };
  }

  const ct = contentType?.split(';')[0] ?? 'unknown';
  return {
    title: 'Incoming webhook',
    subtitle: `${method} · ${ct} · ${formatSize(bodySize)}`,
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
