// @ts-nocheck — tests relax strict typing for ergonomic assertions
import { describe, it, expect } from 'vitest';
import { createApp } from '../index.js';
import { testEnv, seedChannel } from './setup.js';

function req(path: string, init: RequestInit = {}) {
  const app = createApp();
  return app.request(path, init, testEnv().env as any);
}

// ---------------------------------------------------------------------------
// Event history
// ---------------------------------------------------------------------------

describe('GET /v1/channels/:name/events', () => {
  it('returns 401 without Authorization header', async () => {
    const ch = await seedChannel(createApp());
    const res = await req(`/v1/channels/${ch.channel_name}/events`);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthorized');
  });

  it('returns 401 with invalid token', async () => {
    const ch = await seedChannel(createApp());
    const res = await req(`/v1/channels/${ch.channel_name}/events`, {
      headers: { Authorization: 'Bearer ct_invalid_token_1234' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown channel', async () => {
    const res = await req('/v1/channels/ch_unknown/events', {
      headers: { Authorization: 'Bearer ct_some_token_1234' },
    });
    expect(res.status).toBe(404);
  });

  it('returns empty events list with valid token', async () => {
    const ch = await seedChannel(createApp());

    const res = await req(`/v1/channels/${ch.channel_name}/events`, {
      headers: { Authorization: `Bearer ${ch.client_token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.channel).toBe(ch.channel_name);
    expect(body.events).toEqual([]);
  });

  it('returns ingested events with valid token', async () => {
    const ch = await seedChannel(createApp());

    // Ingest 3 events directly via DO stub
    const stub = testEnv().doStub;
    await stub.ingestEvent({
      channel_name: ch.channel_name,
      method: 'POST', path: `/in/${ch.channel_name}`, query: {},
      headers: { 'content-type': 'application/json' },
      provider: { hint: 'github', event_type: 'push' },
      body: { encoding: 'utf8', data: '{}', size: 2, truncated: false },
    });
    await stub.ingestEvent({
      channel_name: ch.channel_name,
      method: 'POST', path: `/in/${ch.channel_name}`, query: {},
      headers: { 'content-type': 'application/json' },
      provider: { hint: 'stripe', event_type: 'checkout.session.completed' },
      body: { encoding: 'utf8', data: '{}', size: 2, truncated: false },
    });
    await stub.ingestEvent({
      channel_name: ch.channel_name,
      method: 'POST', path: `/in/${ch.channel_name}`, query: {},
      headers: {}, provider: {},
      body: { encoding: 'utf8', data: '{}', size: 2, truncated: false },
    });

    const res = await req(`/v1/channels/${ch.channel_name}/events`, {
      headers: { Authorization: `Bearer ${ch.client_token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.length).toBe(3);
    expect(body.events[0].seq).toBe(1);
    expect(body.events[2].seq).toBe(3);
  });

  it('supports after_seq pagination', async () => {
    const ch = await seedChannel(createApp());
    const stub = testEnv().doStub;
    for (let i = 0; i < 5; i++) {
      await stub.ingestEvent({
        channel_name: ch.channel_name,
        method: 'POST', path: `/in/${ch.channel_name}`, query: {},
        headers: {}, provider: {},
        body: { encoding: 'utf8', data: '{}', size: 2, truncated: false },
      });
    }

    const res = await req(`/v1/channels/${ch.channel_name}/events?after_seq=2`, {
      headers: { Authorization: `Bearer ${ch.client_token}` },
    });
    const body = await res.json();
    expect(body.events.length).toBe(3); // seq 3,4,5
    expect(body.events[0].seq).toBe(3);
  });

  it('supports limit param', async () => {
    const ch = await seedChannel(createApp());
    const stub = testEnv().doStub;
    for (let i = 0; i < 10; i++) {
      await stub.ingestEvent({
        channel_name: ch.channel_name,
        method: 'POST', path: `/in/${ch.channel_name}`, query: {},
        headers: {}, provider: {},
        body: { encoding: 'utf8', data: '{}', size: 2, truncated: false },
      });
    }

    const res = await req(`/v1/channels/${ch.channel_name}/events?limit=3`, {
      headers: { Authorization: `Bearer ${ch.client_token}` },
    });
    const body = await res.json();
    expect(body.events.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Clear events
// ---------------------------------------------------------------------------

describe('DELETE /v1/channels/:name/events', () => {
  it('clears all events', async () => {
    const ch = await seedChannel(createApp());
    const stub = testEnv().doStub;
    for (let i = 0; i < 3; i++) {
      await stub.ingestEvent({
        channel_name: ch.channel_name,
        method: 'POST', path: `/in/${ch.channel_name}`, query: {},
        headers: {}, provider: {},
        body: { encoding: 'utf8', data: '{}', size: 2, truncated: false },
      });
    }

    const del = await req(`/v1/channels/${ch.channel_name}/events`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ch.client_token}` },
    });
    expect(del.status).toBe(200);
    expect((await del.json()).deleted_events).toBe(3);

    // Verify empty
    const get = await req(`/v1/channels/${ch.channel_name}/events`, {
      headers: { Authorization: `Bearer ${ch.client_token}` },
    });
    expect((await get.json()).events.length).toBe(0);
  });

  it('returns 401 without token', async () => {
    const ch = await seedChannel(createApp());
    const res = await req(`/v1/channels/${ch.channel_name}/events`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Health & Docs
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await req('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe('hookwire-api');
    expect(body.version).toBe('0.1.0');
  });
});

describe('GET /docs', () => {
  it('returns Scalar API Reference UI', async () => {
    const res = await req('/docs');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('scalar');
  });
});

describe('GET /docs/openapi.json', () => {
  it('returns OpenAPI 3.1 spec', async () => {
    const res = await req('/docs/openapi.json');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe('3.1.0');
    expect(body.info.title).toBe('Hookwire API');
    expect(body.paths['/v1/channels']).toBeDefined();
    expect(body.paths['/in/{channel_name}']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Full E2E flow
// ---------------------------------------------------------------------------

describe('E2E: create → ingest → query → clear → revoke', () => {
  it('completes the full lifecycle', async () => {
    // 1. Create
    const c = await req('/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'Lifecycle Test' }),
    });
    const ch = await c.json();

    // Fix token hash so auth works
    const { hashToken } = await import('../lib/token.js');
    const chRow = testEnv().db.channels.find((r: any) => r.channel_name === ch.channel_name);
    if (chRow) chRow.client_token_hash = await hashToken(ch.client_token);

    // 2. Ingest
    for (let i = 0; i < 5; i++) {
      const r = await req(`/in/${ch.channel_name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': i === 0 ? 'push' : 'issues' },
        body: JSON.stringify({ step: i }),
      });
      expect(r.status).toBe(202);
    }

    // 3. Query
    const hist = await req(`/v1/channels/${ch.channel_name}/events`, {
      headers: { Authorization: `Bearer ${ch.client_token}` },
    });
    const hBody = await hist.json();
    expect(hBody.events.length).toBe(5);
    expect(hBody.events[0].provider.hint).toBe('github');
    expect(hBody.events[0].provider.event_type).toBe('push');

    // 4. Clear
    const del = await req(`/v1/channels/${ch.channel_name}/events`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ch.client_token}` },
    });
    expect((await del.json()).deleted_events).toBe(5);

    // 5. Verify cleared
    const after = await req(`/v1/channels/${ch.channel_name}/events`, {
      headers: { Authorization: `Bearer ${ch.client_token}` },
    });
    expect((await after.json()).events.length).toBe(0);

    // 6. Revoke
    const revoke = await req(`/v1/channels/${ch.channel_name}/revoke`, { method: 'POST' });
    expect((await revoke.json()).status).toBe('revoked');

    // 7. Ingest rejected
    const ingest = await req(`/in/${ch.channel_name}`, { method: 'POST', body: '{}' });
    expect(ingest.status).toBe(410);
  });
});
