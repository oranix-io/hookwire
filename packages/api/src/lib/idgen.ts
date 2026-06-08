const CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

function rand(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (let i = 0; i < len; i++) s += CHARS[bytes[i] % 36];
  return s;
}

export function generateChannelName(): string { return rand(20); }
export function generateEventId(): string { return 'evt_' + rand(26); }
