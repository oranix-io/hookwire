import { Hono } from 'hono';
import { channelRateLimit } from '../middleware/rate-limit.js';

type Bindings = { CHANNEL_DO: DurableObjectNamespace };

const ingest = new Hono<{ Bindings: Bindings }>();

const HARD_LIMIT = 1_048_576;
const SOFT_LIMIT = 262_144;

function getStub(c: any, name: string): DurableObjectStub {
  return c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(name));
}

ingest.use('/:name', channelRateLimit({ maxRequests: 60, windowMs: 60_000 }));

const METHODS = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE', 'HEAD', 'OPTIONS'];

for (const method of METHODS) {
  ingest.on(method, '/:name', async (c) => {
    const name = c.req.param('name');
    const rawBody = await c.req.text();
    const bodySize = new TextEncoder().encode(rawBody).length;

    if (bodySize > HARD_LIMIT) {
      return c.json({ ok: false, error: { code: 'body_too_large', message: 'Body exceeds 1 MB limit' } }, 413);
    }

    const truncated = bodySize > SOFT_LIMIT;
    const bodyData = truncated ? rawBody.slice(0, SOFT_LIMIT) : rawBody;

    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

    const stub = getStub(c, name);
    const doRes = await stub.fetch(new Request('http://do/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: c.req.method,
        headers,
        body: { encoding: 'utf8', content_type: headers['content-type'], data: bodyData, size: bodySize, truncated },
      }),
    }));

    const result = await doRes.json<any>();
    return c.json({ ok: true, event_id: result.id, seq: result.seq }, 202);
  });
}

export { ingest as ingestRoute };
