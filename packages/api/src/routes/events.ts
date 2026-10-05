import { Hono } from 'hono';
import { timingSafeEqual } from '../lib/auth.js';

type Bindings = { CHANNEL_DO: DurableObjectNamespace; INGEST_SECRET?: string };

const events = new Hono<{ Bindings: Bindings }>();

function getStub(c: any, name: string): DurableObjectStub {
  return c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(name));
}

/** Validate a seq cursor param; returns an error message or null. */
function seqParamError(v: string | undefined): string | null {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? null : 'must be a non-negative integer';
}

function badRequest(c: any, param: string) {
  return c.json({ ok: false, error: { code: 'bad_request', message: `Invalid ${param}: must be a non-negative integer` } }, 400);
}

// ── GET /ch/:name/events ──────────────────────────────────

events.get('/:name/events', async (c) => {
  const name = c.req.param('name');
  const q = c.req.query();

  if (seqParamError(q.after_seq)) return badRequest(c, 'after_seq');

  const params = new URLSearchParams();
  if (q.limit) params.set('limit', q.limit);
  if (q.after_seq) params.set('after_seq', q.after_seq);
  if (q.include_body) params.set('include_body', q.include_body);

  const stub = getStub(c, name);
  const doRes = await stub.fetch(new Request(`http://do/events?${params.toString()}`));
  const body = await doRes.json<any>();

  // Forward DO errors (400 invalid cursor, 410 evicted-retention gap) verbatim.
  if (!doRes.ok) return c.json(body, doRes.status as any);

  return c.json({ ok: true, channel: name, events: body.events });
});

// ── DELETE /ch/:name/events ───────────────────────────────

events.delete('/:name/events', async (c) => {
  const name = c.req.param('name');

  // Optional shared-secret auth: when INGEST_SECRET is set, clearing events
  // requires the same x-hookwire-secret header as ingest.
  const secret = c.env.INGEST_SECRET;
  if (secret && !timingSafeEqual(c.req.header('x-hookwire-secret'), secret)) {
    return c.json({ ok: false, error: { code: 'unauthorized', message: 'Invalid or missing ingest secret' } }, 401);
  }

  const stub = getStub(c, name);
  const doRes = await stub.fetch(new Request('http://do/events', { method: 'DELETE' }));
  const body = await doRes.json<any>();
  return c.json({ ok: true, channel: name, deleted_events: body.deleted_events });
});

// ── GET /ch/:name/ws — WebSocket upgrade ──────────────────

events.get('/:name/ws', async (c) => {
  const name = c.req.param('name');

  if (c.req.header('Upgrade') !== 'websocket') {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'Expected WebSocket upgrade' } }, 400);
  }

  if (seqParamError(c.req.query('since'))) return badRequest(c, 'since');

  const stub = getStub(c, name);

  // Forward WS upgrade to DO, preserving ?since= if present
  const doUrl = new URL(c.req.url);
  return stub.fetch(new Request(`http://do/ws${doUrl.search}`, {
    headers: { Upgrade: 'websocket' },
  }));
});

// ── GET /ch/:name/sse — SSE (polls DO every 1s with keepalive) ──

events.get('/:name/sse', async (c) => {
  const name = c.req.param('name');
  const stub = getStub(c, name);

  // ?since=<seq> — start from this seq (default: only new events from now)
  const sinceParam = c.req.query('since');
  if (seqParamError(sinceParam)) return badRequest(c, 'since');
  const since = sinceParam !== undefined ? Number(sinceParam) : NaN;
  let lastSeq: number;

  if (Number.isNaN(since)) {
    // Missing or invalid since → start from current newest, no history replay
    const statusRes = await stub.fetch(new Request('http://do/status'));
    const status = await statusRes.json<any>();
    lastSeq = status.lastSeq ?? 0;
  } else {
    lastSeq = since;
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(':ok\n\n'));

      // Keepalive every 15s to prevent Cloudflare killing idle stream
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(':ping\n\n')); } catch {}
      }, 15_000);

      const poll = setInterval(async () => {
        try {
          const doRes = await stub.fetch(new Request(`http://do/events?after_seq=${lastSeq}&limit=50`));
          const body = await doRes.json<any>();
          for (const event of body.events ?? []) {
            lastSeq = Math.max(lastSeq, event.seq);
            controller.enqueue(encoder.encode(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`));
          }
        } catch { /* DO may be cold-starting */ }
      }, 1000);

      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        clearInterval(poll);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

export { events as eventRoutes };
