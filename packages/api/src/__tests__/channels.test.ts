// @ts-nocheck — tests relax strict typing for ergonomic assertions
import { describe, it, expect } from 'vitest';
import { createApp } from '../index.js';
import { testEnv } from './setup.js';

function req(path: string, init: RequestInit = {}) {
  const app = createApp();
  return app.request(path, init, testEnv().env as any);
}

// ---------------------------------------------------------------------------
// Channel CRUD
// ---------------------------------------------------------------------------

describe('POST /v1/channels — create', () => {
  it('creates a channel and returns all required fields', async () => {
    const res = await req('/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'GitHub Webhooks', provider_hint: 'github' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.channel_id).toMatch(/^chn_/);
    expect(body.channel_name).toMatch(/^ch_/);
    expect(body.client_token).toMatch(/^ct_/);
    expect(body.ingest_secret).toMatch(/^whsec_/);
    expect(body.webhook_url).toContain('/in/');
    expect(body.connect_url).toContain('/connect');
    expect(body.display_name).toBe('GitHub Webhooks');
    expect(body.provider_hint).toBe('github');
    expect(body.retention.max_events).toBe(100);
    expect(body.retention.ttl_hours).toBe(24);
    expect(body.created_at).toBeDefined();
  });

  it('uses custom retention', async () => {
    const res = await req('/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retention: { max_events: 50, ttl_hours: 48 } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.retention.max_events).toBe(50);
    expect(body.retention.ttl_hours).toBe(48);
  });

  it('uses defaults with empty body', async () => {
    const res = await req('/v1/channels', { method: 'POST' });
    expect(res.status).toBe(201);
  });

  it('generates unique channel names', async () => {
    const r1 = await req('/v1/channels', { method: 'POST' });
    const r2 = await req('/v1/channels', { method: 'POST' });
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1.channel_name).not.toBe(b2.channel_name);
    expect(b1.client_token).not.toBe(b2.client_token);
  });
});

describe('GET /v1/channels/:channel_name', () => {
  it('returns 404 for unknown channel', async () => {
    const res = await req('/v1/channels/ch_nonexistent42');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });

  it('returns created channel info', async () => {
    const c = await req('/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'My Test' }),
    });
    const ch = await c.json();

    const res = await req(`/v1/channels/${ch.channel_name}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channel_name).toBe(ch.channel_name);
    expect(body.status).toBe('active');
    expect(body.display_name).toBe('My Test');
  });
});

// ---------------------------------------------------------------------------
// Revoke & Delete
// ---------------------------------------------------------------------------

describe('POST /v1/channels/:name/revoke', () => {
  it('revokes a channel', async () => {
    const c = await req('/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const ch = await c.json();

    const res = await req(`/v1/channels/${ch.channel_name}/revoke`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('revoked');
    expect(body.revoked_at).toBeDefined();
  });

  it('ingest returns 410 after revoke', async () => {
    const c = await req('/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const ch = await c.json();

    await req(`/v1/channels/${ch.channel_name}/revoke`, { method: 'POST' });

    const res = await req(`/in/${ch.channel_name}`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe('channel_revoked');
  });
});

describe('DELETE /v1/channels/:channel_name', () => {
  it('soft-deletes', async () => {
    const c = await req('/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const ch = await c.json();

    const res = await req(`/v1/channels/${ch.channel_name}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('deleted');
  });
});

describe('PATCH /v1/channels/:channel_name', () => {
  it('updates display_name', async () => {
    const c = await req('/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'Old' }),
    });
    const ch = await c.json();

    const res = await req(`/v1/channels/${ch.channel_name}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'New' }),
    });
    expect(res.status).toBe(200);
  });
});
