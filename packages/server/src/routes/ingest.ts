import { Hono } from 'hono';
import { channelRateLimit } from '../middleware/rate-limit.js';
import { timingSafeEqual } from '../lib/auth.js';

type Bindings = { CHANNEL_DO: DurableObjectNamespace; INGEST_SECRET?: string };

const ingest = new Hono<{ Bindings: Bindings }>();

const HARD_LIMIT = 1_048_576;

function getStub(c: any, name: string): DurableObjectStub {
  return c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(name));
}

ingest.use('/:name', channelRateLimit({ maxRequests: 60, windowMs: 60_000 }));

const METHODS = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE', 'HEAD', 'OPTIONS'];

for (const method of METHODS) {
  ingest.on(method, '/:name', async (c) => {
    const name = c.req.param('name');

    // Optional shared-secret auth: when INGEST_SECRET is set, senders must
    // present it via the x-hookwire-secret header.
    const secret = c.env.INGEST_SECRET;
    if (secret && !timingSafeEqual(c.req.header('x-hookwire-secret'), secret)) {
      return c.json({ ok: false, error: { code: 'unauthorized', message: 'Invalid or missing ingest secret' } }, 401);
    }

    const rawBody = await c.req.text();
    const bodySize = new TextEncoder().encode(rawBody).length;

    if (bodySize > HARD_LIMIT) {
      return c.json({ ok: false, error: { code: 'body_too_large', message: 'Body exceeds 1 MB limit' } }, 413);
    }

    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

    const stub = getStub(c, name);
    const doRes = await stub.fetch(new Request('http://do/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: c.req.method,
        headers,
        body: { encoding: 'utf8', content_type: headers['content-type'], data: rawBody, size: bodySize, truncated: false },
      }),
    }));

    const result = await doRes.json<any>();
    return c.json({ ok: true, event_id: result.id, seq: result.seq }, 202);
  });
}

export { ingest as ingestRoute };
