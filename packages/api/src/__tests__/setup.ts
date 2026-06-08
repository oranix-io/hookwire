import { createApp } from '../index.js';

function makeEvents() {
  const events: any[] = [];
  let seq = 0;
  return {
    events,
    ingest(raw: any) {
      seq++;
      const evt = { id: `evt_${seq}`, seq, received_at: new Date().toISOString(), ...raw };
      events.push(evt);
      return { id: evt.id, seq };
    },
    getEvents(params: any) {
      const limit = Math.min(params.limit ?? 50, 100);
      let f = [...events];
      if (params.afterSeq !== undefined) f = f.filter((e: any) => e.seq > params.afterSeq);
      return f.slice(-limit);
    },
    clearEvents() { const c = events.length; events.length = 0; return c; },
    getStatus() { return { clients: 0, lastSeq: seq, events: events.length }; },
  };
}

// Mock DO stub with fetch() that handles HTTP requests
// (mirrors the real ChannelDO's Hono app routes)
function createDOStub() {
  const store = makeEvents();
  const sessions: WebSocket[] = [];

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/ws' && req.headers.get('Upgrade') === 'websocket') {
      const ws = new MockWebSocket();
      sessions.push(ws as unknown as WebSocket);
      // Node.js Response doesn't accept 101 — return 200 with mock ws
      const resp = new Response(null, { status: 200 }) as any;
      resp.webSocket = ws;
      return resp;
    }

    if (url.pathname === '/ingest' && req.method === 'POST') {
      const body = await req.json();
      const result = store.ingest(body);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/events' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') ?? '50');
      const afterSeq = url.searchParams.get('after_seq') ? parseInt(url.searchParams.get('after_seq')!) : undefined;
      const events = store.getEvents({ limit, afterSeq, includeBody: true });
      return new Response(JSON.stringify({ events }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/events' && req.method === 'DELETE') {
      const deleted = store.clearEvents();
      return new Response(JSON.stringify({ deleted_events: deleted }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/status') {
      return new Response(JSON.stringify(store.getStatus()), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('Not found', { status: 404 });
  }

  return { fetch, store, sessions };
}

class MockWebSocket {
  private listeners: Record<string, Function[]> = {};
  addEventListener(event: string, fn: Function) {
    (this.listeners[event] ??= []).push(fn);
  }
  emit(event: string, data?: any) {
    (this.listeners[event] ?? []).forEach(fn => fn(data));
  }
  close() { this.emit('close'); }
  send() {}
}

export function mockEnv() {
  const doStub = createDOStub();
  return {
    doStub,
    env: {
      CHANNEL_DO: {
        idFromName: () => ({ toString: () => 'x' }),
        get: () => ({ fetch: doStub.fetch }),
      },
    },
  };
}

export function createReq() {
  const app = createApp();
  const { doStub, env } = mockEnv();
  return {
    doStub,
    req: (path: string, init: RequestInit = {}) => app.request(path, init, env as any),
  };
}
