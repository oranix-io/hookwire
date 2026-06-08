/**
 * Extract provider hint from webhook request headers.
 * Falls back to channel-level provider_hint if set, otherwise 'custom'.
 */
export function extractProviderHint(
  headers: Record<string, string>,
  channelProviderHint?: string,
): string {
  if (headers['x-github-event']) return 'github';
  if (headers['stripe-signature']) return 'stripe';
  if (headers['x-linear-event']) return 'linear';
  if (headers['x-gitlab-event']) return 'gitlab';
  if (headers['svix-id']) return 'svix';
  return channelProviderHint ?? 'custom';
}

export function extractEventType(
  headers: Record<string, string>,
  provider: string,
): string | null {
  switch (provider) {
    case 'github':
      return headers['x-github-event'] ?? null;
    case 'gitlab':
      return headers['x-gitlab-event'] ?? null;
    case 'linear':
      return headers['x-linear-event'] ?? null;
    default:
      return null;
  }
}

export function extractDeliveryId(
  headers: Record<string, string>,
  provider: string,
): string | null {
  switch (provider) {
    case 'github':
      return headers['x-github-delivery'] ?? null;
    case 'gitlab':
      return headers['x-gitlab-event-uuid'] ?? null;
    default:
      return null;
  }
}
