import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { generateEventId } from './lib/idgen.js';
import { generateSummary } from './lib/summary.js';
import type { ServerMessage } from '@hookwire/types';

/** Helper: SqlStorageCursor 没有 .first()，用 next() 实现 */
function firstRow<T>(cursor: { next(): { done?: boolean; value?: T } }): T | null {
  const n = cursor.next();
  return n.done ? null : (n.value as T);
}

interface ClientSession {
  id: string;
  ws: WebSocket;
  connectedAt: string;
}

interface EventRow {
  id: string; seq: number; received_at: string;
  method: string; headers_json: string;
  body_encoding: string; body_data: string | null;
  body_size: number; body_truncated: number;
  content_type: string | null;
  summary_json: string | null;
}

export class ChannelDO extends DurableObject {
  private sql: SqlStorage;
  private sessions = new Map<string, ClientSession>();
  private lastSeq = 0;
  private eventCount = 0;
  private app: Hono;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id             TEXT PRIMARY KEY,
        seq            INTEGER NOT NULL,
        received_at    TEXT NOT NULL,
        method         TEXT NOT NULL,
        headers_json   TEXT NOT NULL,
        content_type   TEXT,
        body_encoding  TEXT NOT NULL,
        body_data      TEXT,
        body_size      INTEGER NOT NULL,
        body_truncated INTEGER NOT NULL DEFAULT 0,
        summary_json   TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_seq ON events(seq);
    `);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

    const sr = firstRow(this.sql.exec("SELECT value FROM meta WHERE key='last_seq'"));
    if (sr) this.lastSeq = parseInt(sr.value as string, 10);
    const cr = firstRow(this.sql.exec("SELECT value FROM meta WHERE key='event_count'"));
    if (cr) this.eventCount = parseInt(cr.value as string, 10);

    // Restore hibernated WS sessions
    for (const ws of ctx.getWebSockets()) {
      const meta = ws.deserializeAttachment?.() ?? {};
      this.sessions.set(meta.id ?? crypto.randomUUID(), {
        id: meta.id ?? crypto.randomUUID(),
        ws,
        connectedAt: meta.connectedAt ?? new Date().toISOString(),
      });
    }

    this.app = this.createApp();
  }

  // ── HTTP fetch — handles WS upgrade + API ──────────────

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  private createApp(): Hono {
    const app = new Hono();

    // WebSocket upgrade — supports ?since=<seq> for replay
    app.get('/ws', async (c) => {
      if (c.req.header('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 400 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.acceptSession(server);

      // Replay history if ?since= is provided
      const sinceParam = c.req.query('since');
      if (sinceParam !== undefined) {
        const since = parseInt(sinceParam, 10) || 0;
        const history = await this.getEvents({ afterSeq: since, limit: 100, includeBody: true });
        for (const event of history) {
          server.send(JSON.stringify({
            type: 'event', id: event.id, seq: event.seq,
            received_at: event.received_at, method: event.method,
            headers: event.headers, body: event.body, summary: event.summary,
          } satisfies ServerMessage));
        }
      }

      return new Response(null, { status: 101, webSocket: client });
    });

    // Ingest webhook
    app.all('/ingest', async (c) => {
      const body = await c.req.json<{
        method: string;
        headers: Record<string, string>;
        body: { encoding: 'utf8' | 'base64'; content_type?: string; data: string; size: number; truncated: boolean };
      }>();
      const result = await this.ingest(body);
      return c.json(result);
    });

    // Get events
    app.get('/events', async (c) => {
      const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 100);
      const afterSeq = c.req.query('after_seq') ? parseInt(c.req.query('after_seq')!) : undefined;
      const includeBody = c.req.query('include_body') !== 'false';
      const items = await this.getEvents({ limit, afterSeq, includeBody });
      return c.json({ events: items });
    });

    // Clear events
    app.delete('/events', async (c) => {
      const deleted = await this.clearEvents();
      return c.json({ deleted_events: deleted });
    });

    // Status
    app.get('/status', async (c) => {
      const st = await this.getStatus();
      return c.json(st);
    });

    return app;
  }

  // ── Core methods ────────────────────────────────────────

  async ingest(raw: {
    method: string;
    headers: Record<string, string>;
    body: { encoding: 'utf8' | 'base64'; content_type?: string; data: string; size: number; truncated: boolean };
  }): Promise<{ id: string; seq: number }> {
    const id = generateEventId();
    const seq = ++this.lastSeq;
    const receivedAt = new Date().toISOString();
    const summary = generateSummary({ contentType: raw.body.content_type, bodySize: raw.body.size, method: raw.method });

    this.sql.exec(
      `INSERT INTO events (id,seq,received_at,method,headers_json,content_type,body_encoding,body_data,body_size,body_truncated,summary_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, seq, receivedAt, raw.method, JSON.stringify(raw.headers),
      raw.body.content_type ?? null, raw.body.encoding,
      raw.body.truncated ? null : raw.body.data,
      raw.body.size, raw.body.truncated ? 1 : 0,
      JSON.stringify(summary),
    );
    this.eventCount++;
    this.persistMeta();

    this.broadcast({
      type: 'event', id, seq, received_at: receivedAt,
      method: raw.method, headers: raw.headers, body: raw.body, summary,
    });
    await this.cleanup();
    return { id, seq };
  }

  async getEvents(params: { limit?: number; afterSeq?: number; includeBody?: boolean }): Promise<any[]> {
    const limit = Math.min(params.limit ?? 50, 100);
    const includeBody = params.includeBody ?? true;
    const clauses = ['1=1'];
    const args: unknown[] = [];
    if (params.afterSeq !== undefined) { clauses.push('seq > ?'); args.push(params.afterSeq); }

    const rows = this.sql.exec(
      `SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY seq DESC LIMIT ?`, ...args, limit,
    ).toArray() as unknown as EventRow[];

    return rows.reverse().map(r => ({
      id: r.id, seq: r.seq, received_at: r.received_at,
      method: r.method, headers: JSON.parse(r.headers_json),
      body: {
        encoding: r.body_encoding as 'utf8' | 'base64',
        content_type: r.content_type ?? undefined,
        data: includeBody ? (r.body_truncated ? '' : (r.body_data ?? '')) : '',
        size: r.body_size, truncated: Boolean(r.body_truncated),
      },
      summary: r.summary_json ? JSON.parse(r.summary_json) : undefined,
    }));
  }

  async clearEvents(): Promise<number> {
    const c = this.eventCount;
    this.sql.exec('DELETE FROM events');
    this.eventCount = 0;
    this.persistMeta();
    return c;
  }

  async getStatus(): Promise<{ clients: number; lastSeq: number; events: number }> {
    return { clients: this.sessions.size, lastSeq: this.lastSeq, events: this.eventCount };
  }

  // ── WebSocket ───────────────────────────────────────────

  private acceptSession(ws: WebSocket): void {
    const sid = crypto.randomUUID();
    const meta = { id: sid, connectedAt: new Date().toISOString() };
    ws.serializeAttachment?.(meta);
    this.sessions.set(sid, { ...meta, ws, connectedAt: meta.connectedAt });
    ws.accept();

    ws.send(JSON.stringify({ type: 'hello', channel: '', server_time: new Date().toISOString() } satisfies ServerMessage));

    ws.addEventListener('message', (msg) => {
      try {
        const d = JSON.parse(msg.data as string);
        if (d.type === 'ping') ws.send(JSON.stringify({ type: 'pong', id: d.id, time: new Date().toISOString() }));
      } catch {}
    });
    ws.addEventListener('close', () => this.sessions.delete(sid));
    ws.addEventListener('error', () => this.sessions.delete(sid));
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const [, s] of this.sessions) { try { s.ws.send(data); } catch {} }
  }

  private persistMeta(): void {
    this.sql.exec(`INSERT OR REPLACE INTO meta (key,value) VALUES ('last_seq',?),('event_count',?)`,
      String(this.lastSeq), String(this.eventCount));
  }

  private async cleanup(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    this.sql.exec('DELETE FROM events WHERE received_at < ?', cutoff);
    const cnt = this.sql.exec('SELECT COUNT(*) as c FROM events').one() as { c: number } | null;
    if (cnt && cnt.c > 100) {
      this.sql.exec('DELETE FROM events WHERE seq IN (SELECT seq FROM events ORDER BY seq ASC LIMIT ?)', cnt.c - 100);
    }
    const newCnt = this.sql.exec('SELECT COUNT(*) as c FROM events').one() as { c: number } | null;
    if (newCnt) { this.eventCount = newCnt.c; this.persistMeta(); }
  }
}
