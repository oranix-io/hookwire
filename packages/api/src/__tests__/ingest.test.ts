// @ts-nocheck — tests relax strict typing for ergonomic assertions
import { describe, it, expect } from 'vitest';
import { createApp } from '../index.js';
import { testEnv } from './setup.js';

function req(path: string, init: RequestInit = {}) {
  const app = createApp();
  return app.request(path, init, testEnv().env as any);
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

describe('POST /in/:channel_name — ingest', () => {
  async function createCh() {
    const res = await req('/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    return res.json();
  }

  it('returns 202 with event_id and seq', async () => {
    const ch = await createCh();

    const res = await req(`/in/${ch.channel_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'push' },
      body: JSON.stringify({ ref: 'refs/heads/main' }),
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.event_id).toMatch(/^evt_/);
    expect(body.seq).toBe(1);
    expect(body.channel).toBe(ch.channel_name);
  });

  it('accepts PUT, PATCH, GET', async () => {
    const ch = await createCh();
    expect((await req(`/in/${ch.channel_name}`, { method: 'PUT', body: 'x' })).status).toBe(202);
    expect((await req(`/in/${ch.channel_name}`, { method: 'PATCH', body: 'x' })).status).toBe(202);
    expect((await req(`/in/${ch.channel_name}`, { method: 'GET' })).status).toBe(202);
  });

  it('returns 404 for unknown channel', async () => {
    const res = await req('/in/ch_nonexistent42', { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('channel_not_found');
  });

  it('returns 410 for revoked channel', async () => {
    const ch = await createCh();
    await req(`/v1/channels/${ch.channel_name}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await req(`/in/${ch.channel_name}`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(410);
  });

  it('returns 413 for body > 1 MB', async () => {
    const ch = await createCh();
    const large = 'x'.repeat(1_100_000);
    const res = await req(`/in/${ch.channel_name}`, { method: 'POST', body: large });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('body_too_large');
  });

  it('seq increments monotonically across 5 ingests', async () => {
    const ch = await createCh();
    for (let i = 1; i <= 5; i++) {
      const r = await req(`/in/${ch.channel_name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ n: i }),
      });
      const body = await r.json();
      expect(body.seq).toBe(i);
    }
  });

  it('detects GitHub provider from X-GitHub-Event header', async () => {
    const ch = await createCh();
    const res = await req(`/in/${ch.channel_name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'push',
        'X-GitHub-Delivery': 'abc-123',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);
  });

  it('detects Stripe provider from Stripe-Signature header', async () => {
    const ch = await createCh();
    const res = await req(`/in/${ch.channel_name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=123,v1=sig',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);
  });
});

describe('Rate limiting', () => {
  it('returns 429 after exceeding 60 req/min', async () => {
    const c = await (async () => {
      const r = await req('/v1/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return r.json();
    })();

    let lastStatus = 0;
    for (let i = 0; i < 61; i++) {
      const r = await req(`/in/${c.channel_name}`, { method: 'POST', body: '{}' });
      lastStatus = r.status;
    }
    expect(lastStatus).toBe(429);
  });
});
