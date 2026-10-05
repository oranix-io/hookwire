import { createApp } from '../index.js';

// Routes that proxy into ChannelDO are covered by @hookwire/server's tests,
// so no CHANNEL_DO stub is needed here — the remaining tests only hit
// worker-local routes (health, pages, docs).
export function createReq(envOverrides: Record<string, unknown> = {}) {
  const app = createApp();
  return {
    req: (path: string, init: RequestInit = {}) => app.request(path, init, envOverrides as any),
  };
}
