import { Hono } from 'hono';
import {
  generateChannelId,
  generateChannelName,
  generateClientToken,
  generateIngestSecret,
} from '../lib/idgen.js';
import { hashToken, verifyToken } from '../lib/token.js';
import type { CreateChannelResponse, Channel } from '@hookwire/types';

import { getChannelStub } from '../lib/do-types.js';

type Bindings = { DB: D1Database; CHANNEL_DO: DurableObjectNamespace };

const channels = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------------------------
// POST /v1/channels — Create a new channel
// ---------------------------------------------------------------------------
channels.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { display_name, provider_hint, retention } = body;

  const channelId = generateChannelId();
  const channelName = generateChannelName();
  const clientToken = generateClientToken();
  const ingestSecret = generateIngestSecret();
  const clientTokenHash = await hashToken(clientToken);
  const ingestSecretHash = await hashToken(ingestSecret);

  const now = new Date().toISOString();
  const maxEvents = retention?.max_events ?? 100;
  const ttlHours = retention?.ttl_hours ?? 24;

  // TODO: replace 'user_placeholder' with real user ID once auth is wired up
  await c.env.DB.prepare(
    `INSERT INTO channels
       (id, user_id, channel_name, display_name, provider_hint,
        client_token_hash, ingest_secret_hash, status,
        max_events, ttl_hours, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  )
    .bind(channelId, 'user_placeholder', channelName, display_name ?? null,
      provider_hint ?? null, clientTokenHash, ingestSecretHash,
      maxEvents, ttlHours, now, now)
    .run();

  // Touch the DO so it exists
  c.env.CHANNEL_DO.idFromName(channelName);

  const origin = new URL(c.req.url).origin;
  const apiOrigin = origin; // in prod these may differ

  const resp: CreateChannelResponse = {
    ok: true,
    channel_id: channelId,
    channel_name: channelName,
    display_name: display_name ?? undefined,
    provider_hint: provider_hint ?? undefined,
    webhook_url: `https://hooks.hookwire.dev/in/${channelName}`,
    connect_url: `wss://api.hookwire.dev/v1/channels/${channelName}/connect`,
    client_token: clientToken,
    ingest_secret: ingestSecret,
    retention: { max_events: maxEvents, ttl_hours: ttlHours },
    created_at: now,
  };

  return c.json(resp, 201);
});

// ---------------------------------------------------------------------------
// GET /v1/channels/:channel_name — Get channel info
// ---------------------------------------------------------------------------
channels.get('/:channel_name', async (c) => {
  const channelName = c.req.param('channel_name');

  const row = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE channel_name = ? AND deleted_at IS NULL',
  ).bind(channelName).first();

  if (!row) {
    return c.json(
      { ok: false, error: { code: 'not_found', message: 'Channel not found' } },
      404,
    );
  }

  return c.json({
    ok: true,
    channel_id: row.id,
    channel_name: row.channel_name,
    display_name: row.display_name,
    provider_hint: row.provider_hint,
    status: row.status,
    retention: { max_events: row.max_events, ttl_hours: row.ttl_hours },
    webhook_url: `https://hooks.hookwire.dev/in/${row.channel_name}`,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revoked_at: row.revoked_at,
    expires_at: row.expires_at,
  });
});

// ---------------------------------------------------------------------------
// PATCH /v1/channels/:channel_name — Update channel
// ---------------------------------------------------------------------------
channels.patch('/:channel_name', async (c) => {
  const channelName = c.req.param('channel_name');
  const body = await c.req.json().catch(() => ({}));

  const channel = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE channel_name = ? AND deleted_at IS NULL',
  ).bind(channelName).first();

  if (!channel) {
    return c.json(
      { ok: false, error: { code: 'not_found', message: 'Channel not found' } },
      404,
    );
  }

  const updates: string[] = [];
  const args: unknown[] = [];

  if (body.display_name !== undefined) {
    updates.push('display_name = ?');
    args.push(body.display_name);
  }
  if (body.provider_hint !== undefined) {
    updates.push('provider_hint = ?');
    args.push(body.provider_hint);
  }
  if (body.retention?.max_events !== undefined) {
    updates.push('max_events = ?');
    args.push(body.retention.max_events);
  }
  if (body.retention?.ttl_hours !== undefined) {
    updates.push('ttl_hours = ?');
    args.push(body.retention.ttl_hours);
  }

  if (updates.length === 0) {
    return c.json({ ok: true, message: 'Nothing to update' });
  }

  updates.push('updated_at = ?');
  args.push(new Date().toISOString());
  args.push(channelName);

  await c.env.DB.prepare(
    `UPDATE channels SET ${updates.join(', ')} WHERE channel_name = ?`,
  ).bind(...args).run();

  return c.json({ ok: true, channel: channelName });
});

// ---------------------------------------------------------------------------
// POST /v1/channels/:channel_name/revoke — Revoke channel
// ---------------------------------------------------------------------------
channels.post('/:channel_name/revoke', async (c) => {
  const channelName = c.req.param('channel_name');
  const now = new Date().toISOString();

  const channel = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE channel_name = ? AND deleted_at IS NULL',
  ).bind(channelName).first();

  if (!channel) {
    return c.json(
      { ok: false, error: { code: 'not_found', message: 'Channel not found' } },
      404,
    );
  }

  await c.env.DB.prepare(
    "UPDATE channels SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE channel_name = ?",
  ).bind(now, now, channelName).run();

  // Close all WebSocket clients
  const stub = getChannelStub(c.env.CHANNEL_DO, channelName);
  await stub.closeAllClients();

  return c.json({
    ok: true,
    channel: channelName,
    status: 'revoked',
    revoked_at: now,
  });
});

// ---------------------------------------------------------------------------
// DELETE /v1/channels/:channel_name — Soft-delete channel
// ---------------------------------------------------------------------------
channels.delete('/:channel_name', async (c) => {
  const channelName = c.req.param('channel_name');
  const now = new Date().toISOString();

  const channel = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE channel_name = ? AND deleted_at IS NULL',
  ).bind(channelName).first();

  if (!channel) {
    return c.json(
      { ok: false, error: { code: 'not_found', message: 'Channel not found' } },
      404,
    );
  }

  await c.env.DB.prepare(
    "UPDATE channels SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE channel_name = ?",
  ).bind(now, now, channelName).run();

  // Close all WebSocket clients
  const stub = getChannelStub(c.env.CHANNEL_DO, channelName);
  await stub.closeAllClients(1001, 'Channel deleted');

  return c.json({
    ok: true,
    channel: channelName,
    status: 'deleted',
  });
});

export { channels as channelRoutes };
