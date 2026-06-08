// Prefixes:
// chn_  → channel_id (internal, 26 chars)
// ch_   → channel_name (public, 18 chars)
// ct_   → client_token (24 chars)
// whsec_→ ingest_secret (24 chars)
// evt_  → event_id (26 chars)

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function generateId(prefix: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let result = prefix;
  for (let i = 0; i < length; i++) {
    result += BASE36[bytes[i] % 36];
  }
  return result;
}

export function generateChannelId(): string {
  return generateId('chn_', 26);
}

export function generateChannelName(): string {
  return generateId('ch_', 18);
}

export function generateClientToken(): string {
  return generateId('ct_', 24);
}

export function generateIngestSecret(): string {
  return generateId('whsec_', 24);
}

export function generateEventId(): string {
  return generateId('evt_', 26);
}
