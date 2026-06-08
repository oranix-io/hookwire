import { Hono } from 'hono';
import { clientTokenAuth } from '../middleware/auth.js';
import { verifyToken, hashToken } from '../lib/token.js';
import type { EventsResponse, ClearEventsResponse } from '@hookwire/types';
import { getChannelStub } from '../lib/do-types.js';

interface ChannelRow {
  id: string;
  user_id: string;
  channel_name: string;
  display_name: string | null;
  provider_hint: string | null;
  client_token_hash: string;
  ingest_secret_hash: string | null;
  status: string;
  max_events: number;
  ttl_hours: number;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  expires_at: string | null;
  deleted_at: string | null;
}

type Bindings = { DB: D1Database; CHANNEL_DO: DurableObjectNamespace };
type Variables = { channel: ChannelRow };

const events = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /v1/channels/:channel_name/events — Event history
// ---------------------------------------------------------------------------
events.get('/:channel_name/events', clientTokenAuth, async (c) => {
  const channelName = c.req.param('channel_name');
  const q = c.req.query();

  const limit = q.limit ? Math.min(parseInt(q.limit, 10), 100) : 50;
  const afterSeq = q.after_seq ? parseInt(q.after_seq, 10) : undefined;
  const beforeSeq = q.before_seq ? parseInt(q.before_seq, 10) : undefined;
  const includeBody = q.include_body !== 'false';
  const includeHeaders = q.include_headers !== 'false';

  const channel = c.get('channel');
  if (channel.status !== 'active') {
    return c.json(
      { ok: false, error: { code: 'channel_not_active', message: 'Channel is not active' } },
      403,
    );
  }

  const stub = getChannelStub(c.env.CHANNEL_DO, channelName);
  const items = await stub.getEvents({
    limit,
    afterSeq,
    beforeSeq,
    includeBody,
    includeHeaders,
  });

  const eventsWithChannel = items.map((e: any) => ({ ...e, channel_name: channelName }));

  const resp: EventsResponse = {
    ok: true,
    channel: channelName,
    events: eventsWithChannel,
  };

  return c.json(resp);
});

// ---------------------------------------------------------------------------
// DELETE /v1/channels/:channel_name/events — Clear all events
// ---------------------------------------------------------------------------
events.delete('/:channel_name/events', clientTokenAuth, async (c) => {
  const channelName = c.req.param('channel_name');

  const stub = getChannelStub(c.env.CHANNEL_DO, channelName);
  const deleted = await stub.clearEvents();

  const resp: ClearEventsResponse = {
    ok: true,
    channel: channelName,
    deleted_events: deleted,
  };

  return c.json(resp);
});

// ---------------------------------------------------------------------------
// GET /v1/channels/:channel_name/connect — WebSocket upgrade
// ---------------------------------------------------------------------------
events.get('/:channel_name/connect', async (c) => {
  const channelName = c.req.param('channel_name');

  // Auth before upgrade (manual, since middleware body return breaks WS)
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      { ok: false, error: { code: 'unauthorized', message: 'Missing or invalid Authorization header' } },
      401,
    );
  }

  const token = authHeader.slice(7);
  const channel = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE channel_name = ? AND deleted_at IS NULL',
  ).bind(channelName).first();

  if (!channel) {
    return c.json(
      { ok: false, error: { code: 'not_found', message: 'Channel not found' } },
      404,
    );
  }

  const valid = await verifyToken(token, channel.client_token_hash as string);
  if (!valid) {
    return c.json(
      { ok: false, error: { code: 'unauthorized', message: 'Invalid client token' } },
      401,
    );
  }

  if (channel.status !== 'active') {
    const statusCode = channel.status === 'revoked' ? 410 : 403;
    return c.json(
      { ok: false, error: { code: 'channel_not_active', message: `Channel is ${channel.status}` } },
      statusCode,
    );
  }

  // Concurrent client limit check
  const stub = getChannelStub(c.env.CHANNEL_DO, channelName);
  const status = await stub.getStatus();
  if (status.connectedClients >= 10) {
    return c.json(
      { ok: false, error: { code: 'too_many_connections', message: 'Too many concurrent connections' } },
      429,
    );
  }

  // Verify it's a WebSocket upgrade
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.json(
      { ok: false, error: { code: 'bad_request', message: 'Expected WebSocket upgrade' } },
      400,
    );
  }

  // Create WebSocket pair
  const pair = new WebSocketPair();
  const [clientWs, serverWs] = Object.values(pair);

  // Hand off to ChannelDO
  await stub.handleWebSocket(serverWs, 'sdk', c.req.header('User-Agent') ?? undefined);

  return new Response(null, { status: 101, webSocket: clientWs });
});

export { events as eventRoutes };
