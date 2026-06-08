import { Hono } from 'hono';
import { channelRateLimit } from '../middleware/rate-limit.js';
import { extractProviderHint, extractEventType, extractDeliveryId } from '../lib/provider.js';
import { generateSummary } from '../lib/summary.js';
import type { IngestResponse } from '@hookwire/types';

import { getChannelStub } from '../lib/do-types.js';

type Bindings = { DB: D1Database; CHANNEL_DO: DurableObjectNamespace };

const ingest = new Hono<{ Bindings: Bindings }>();

// Limits
const HARD_BODY_LIMIT = 1_048_576;  // 1 MB
const SOFT_BODY_LIMIT = 262_144;    // 256 KB

// Apply rate limiting to ingest
ingest.use('/in/:channel_name', channelRateLimit({ maxRequests: 60, windowMs: 60_000 }));

// ---------------------------------------------------------------------------
// ALL /in/:channel_name — Ingest a webhook (any HTTP method)
// ---------------------------------------------------------------------------
const METHODS = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE', 'HEAD', 'OPTIONS'];

for (const method of METHODS) {
  ingest.on(method, '/in/:channel_name', async (c) => {
    const channelName = c.req.param('channel_name');

    // 1. Look up channel
    const channel = await c.env.DB.prepare(
      'SELECT * FROM channels WHERE channel_name = ? AND deleted_at IS NULL',
    ).bind(channelName).first();

    if (!channel) {
      return c.json(
        { ok: false, error: { code: 'channel_not_found', message: 'Channel not found' } },
        404,
      );
    }

    if (channel.status === 'revoked') {
      return c.json(
        { ok: false, error: { code: 'channel_revoked', message: 'Channel has been revoked' } },
        410,
      );
    }

    if (channel.status === 'expired') {
      return c.json(
        { ok: false, error: { code: 'channel_expired', message: 'Channel has expired' } },
        410,
      );
    }

    // 2. Read body
    const rawBody = await c.req.text();
    const bodySize = new TextEncoder().encode(rawBody).length;

    // 3. Size check
    if (bodySize > HARD_BODY_LIMIT) {
      return c.json(
        { ok: false, error: { code: 'body_too_large', message: 'Request body exceeds 1 MB limit' } },
        413,
      );
    }

    const truncated = bodySize > SOFT_BODY_LIMIT;
    const bodyData = truncated ? rawBody.slice(0, SOFT_BODY_LIMIT) : rawBody;

    // 4. Extract headers as plain object (lowercased keys)
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // 5. Provider detection
    const providerHint = extractProviderHint(headers, channel.provider_hint as string | undefined);
    const eventType = extractEventType(headers, providerHint);
    const deliveryId = extractDeliveryId(headers, providerHint);

    // 6. Summary
    const summary = generateSummary({
      providerHint,
      eventType,
      contentType: headers['content-type'],
      bodySize,
      method: c.req.method,
    });

    // 7. Forward to ChannelDO
    const stub = getChannelStub(c.env.CHANNEL_DO, channelName);
    const result = await stub.ingestEvent({
      channel_name: channelName,
      method: c.req.method,
      path: c.req.path,
      query: Object.fromEntries(new URL(c.req.url).searchParams.entries()),
      headers,
      remote_addr: headers['cf-connecting-ip'] ?? undefined,
      user_agent: headers['user-agent'],
      provider: {
        hint: providerHint,
        event_type: eventType ?? undefined,
        delivery_id: deliveryId ?? undefined,
      },
      body: {
        encoding: 'utf8',
        content_type: headers['content-type'],
        data: bodyData,
        size: bodySize,
        truncated,
      },
      summary,
    });

    // 8. Respond
    const resp: IngestResponse = {
      ok: true,
      channel: channelName,
      event_id: result.id,
      seq: result.seq,
    };

    return c.json(resp, 202);
  });
}

export { ingest as ingestRoute };
