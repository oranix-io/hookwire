import { Hono } from 'hono';

type Bindings = { CHANNEL_DO: DurableObjectNamespace };

const events = new Hono<{ Bindings: Bindings }>();

function getStub(c: any, name: string): DurableObjectStub {
  return c.env.CHANNEL_DO.get(c.env.CHANNEL_DO.idFromName(name));
}

// ── GET /ch/:name/events ──────────────────────────────────

events.get('/:name/events', async (c) => {
  const name = c.req.param('name');
  const q = c.req.query();

  const params = new URLSearchParams();
  if (q.limit) params.set('limit', q.limit);
  if (q.after_seq) params.set('after_seq', q.after_seq);
  if (q.include_body) params.set('include_body', q.include_body);

  const stub = getStub(c, name);
  const doRes = await stub.fetch(new Request(`http://do/events?${params.toString()}`));
  const body = await doRes.json<any>();

  return c.json({ ok: true, channel: name, events: body.events });
});

// ── DELETE /ch/:name/events ───────────────────────────────

events.delete('/:name/events', async (c) => {
  const name = c.req.param('name');
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
  let lastSeq: number;

  if (sinceParam !== undefined) {
    lastSeq = parseInt(sinceParam, 10) || 0;
  } else {
    // No since → start from current newest, no history replay
    const statusRes = await stub.fetch(new Request('http://do/status'));
    const status = await statusRes.json<any>();
    lastSeq = status.lastSeq ?? 0;
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
