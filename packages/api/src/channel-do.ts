import { DurableObject } from 'cloudflare:workers';
import { generateEventId } from './lib/idgen.js';
import type { ChannelEvent, ServerMessage } from '@hookwire/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DOEnv {
  DB?: D1Database;
}

interface ClientSession {
  id: string;
  ws: WebSocket;
  connectedAt: string;
  clientType: 'macos_app' | 'sdk' | 'dashboard' | 'unknown';
  userAgent?: string;
}

// Row shape returned by SQLite queries — keys match column names
interface EventRow {
  id: string;
  seq: number;
  received_at: string;
  method: string;
  path: string;
  query_json: string | null;
  headers_json: string;
  remote_addr: string | null;
  user_agent: string | null;
  provider_hint: string | null;
  provider_event_type: string | null;
  provider_delivery_id: string | null;
  content_type: string | null;
  body_encoding: string;
  body_data: string | null;
  body_size: number;
  body_truncated: number;
  summary_json: string | null;
}

// ---------------------------------------------------------------------------
// Durable Object
// ---------------------------------------------------------------------------

export class ChannelDO extends DurableObject<DOEnv> {
  private sql: SqlStorage;
  private clients: Map<string, ClientSession> = new Map();
  private lastSeq = 0;
  private eventCount = 0;
  private maxEvents = 100;
  private ttlHours = 24;

  constructor(ctx: DurableObjectState, env: DOEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Initialize schema
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id          TEXT PRIMARY KEY,
        seq         INTEGER NOT NULL,
        received_at TEXT NOT NULL,
        method      TEXT NOT NULL,
        path        TEXT NOT NULL,
        query_json  TEXT,
        headers_json TEXT NOT NULL,
        remote_addr TEXT,
        user_agent  TEXT,
        provider_hint        TEXT,
        provider_event_type  TEXT,
        provider_delivery_id TEXT,
        content_type    TEXT,
        body_encoding   TEXT NOT NULL,
        body_data       TEXT,
        body_size       INTEGER NOT NULL,
        body_truncated  INTEGER NOT NULL DEFAULT 0,
        summary_json    TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_seq ON events(seq);
      CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at);
      CREATE INDEX IF NOT EXISTS idx_events_provider_event_type ON events(provider_event_type);
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Restore counters
    const seqRow = this.sql.exec("SELECT value FROM metadata WHERE key = 'last_seq'").one();
    if (seqRow) this.lastSeq = parseInt(seqRow.value as string, 10);

    const countRow = this.sql.exec("SELECT value FROM metadata WHERE key = 'event_count'").one();
    if (countRow) this.eventCount = parseInt(countRow.value as string, 10);

    // Accept any WebSocket that was passed via fetch handler
    for (const ws of ctx.getWebSockets()) {
      ws.accept();
    }
  }

  // -----------------------------------------------------------------------
  // Public — called from Worker via RPC stub
  // -----------------------------------------------------------------------

  async ingestEvent(raw: Omit<ChannelEvent, 'id' | 'seq' | 'received_at'>): Promise<{ id: string; seq: number }> {
    const id = generateEventId();
    const seq = ++this.lastSeq;
    const receivedAt = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO events (
        id, seq, received_at, method, path, query_json, headers_json,
        remote_addr, user_agent, provider_hint, provider_event_type,
        provider_delivery_id, content_type, body_encoding, body_data,
        body_size, body_truncated, summary_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )`,
      id,
      seq,
      receivedAt,
      raw.method,
      raw.path,
      JSON.stringify(raw.query),
      JSON.stringify(raw.headers),
      raw.remote_addr ?? null,
      raw.user_agent ?? null,
      raw.provider.hint ?? null,
      raw.provider.event_type ?? null,
      raw.provider.delivery_id ?? null,
      raw.body.content_type ?? null,
      raw.body.encoding,
      raw.body.truncated ? null : raw.body.data,
      raw.body.size,
      raw.body.truncated ? 1 : 0,
      raw.summary ? JSON.stringify(raw.summary) : null,
    );

    this.eventCount++;
    this.persistCounters();

    this.broadcast({
      type: 'event',
      id,
      seq,
      channel: '',
      received_at: receivedAt,
      provider: raw.provider,
      http: {
        method: raw.method,
        path: raw.path,
        query: raw.query,
        headers: raw.headers,
      },
      body: raw.body,
      summary: raw.summary,
    });

    await this.cleanupEvents();
    return { id, seq };
  }

  async getEvents(params: {
    limit?: number;
    afterSeq?: number;
    beforeSeq?: number;
    includeBody?: boolean;
    includeHeaders?: boolean;
  }): Promise<ChannelEvent[]> {
    const limit = Math.min(params.limit ?? 50, 100);
    const includeBody = params.includeBody ?? true;
    const includeHeaders = params.includeHeaders ?? true;

    const clauses: string[] = ['1=1'];
    const args: unknown[] = [];

    if (params.afterSeq !== undefined) {
      clauses.push('seq > ?');
      args.push(params.afterSeq);
    }
    if (params.beforeSeq !== undefined) {
      clauses.push('seq < ?');
      args.push(params.beforeSeq);
    }

    const where = clauses.join(' AND ');
    const rows = this.sql.exec(
      `SELECT * FROM events WHERE ${where} ORDER BY seq DESC LIMIT ?`,
      ...args,
      limit,
    ).toArray() as unknown as EventRow[];

    // Return in ascending order
    return rows.reverse().map(r => this.rowToEvent(r, includeBody, includeHeaders));
  }

  async clearEvents(): Promise<number> {
    const count = this.eventCount;
    this.sql.exec('DELETE FROM events');
    this.eventCount = 0;
    this.persistCounters();
    return count;
  }

  async getStatus(): Promise<{ connectedClients: number; lastSeq: number; eventCount: number }> {
    return {
      connectedClients: this.clients.size,
      lastSeq: this.lastSeq,
      eventCount: this.eventCount,
    };
  }

  async handleWebSocket(ws: WebSocket, clientType = 'unknown', userAgent?: string): Promise<void> {
    const sessionId = crypto.randomUUID();
    this.clients.set(sessionId, {
      id: sessionId,
      ws,
      connectedAt: new Date().toISOString(),
      clientType: clientType as ClientSession['clientType'],
      userAgent,
    });

    ws.accept();

    ws.send(JSON.stringify({
      type: 'hello',
      protocol: 'channel.v1',
      channel: '',
      server_time: new Date().toISOString(),
      features: { ack: false, history: true, replay: false },
    } satisfies ServerMessage));

    ws.addEventListener('message', (msg) => {
      try {
        const data = JSON.parse(msg.data as string);
        if (data.type === 'ping') {
          ws.send(JSON.stringify({
            type: 'pong',
            id: data.id,
            time: new Date().toISOString(),
          } satisfies ServerMessage));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            code: 'invalid_message',
            message: 'Unsupported message type',
          } satisfies ServerMessage));
        }
      } catch {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'invalid_message',
          message: 'Unable to parse message',
        } satisfies ServerMessage));
      }
    });

    ws.addEventListener('close', () => this.clients.delete(sessionId));
    ws.addEventListener('error', () => this.clients.delete(sessionId));
  }

  async closeAllClients(code = 1001, reason = 'Channel revoked'): Promise<void> {
    for (const [, s] of this.clients) {
      try { s.ws.close(code, reason); } catch { /* ignore */ }
    }
    this.clients.clear();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const [, s] of this.clients) {
      try { s.ws.send(data); } catch { /* client gone, close event cleans up */ }
    }
  }

  private persistCounters(): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO metadata (key, value)
       VALUES ('last_seq', ?), ('event_count', ?), ('last_event_at', ?)`,
      String(this.lastSeq),
      String(this.eventCount),
      new Date().toISOString(),
    );
  }

  private async cleanupEvents(): Promise<void> {
    const cutoff = new Date(Date.now() - this.ttlHours * 60 * 60 * 1000).toISOString();
    this.sql.exec('DELETE FROM events WHERE received_at < ?', cutoff);

    const cnt = this.sql.exec('SELECT COUNT(*) as cnt FROM events').one() as { cnt: number } | null;
    if (cnt && cnt.cnt > this.maxEvents) {
      const excess = cnt.cnt - this.maxEvents;
      this.sql.exec('DELETE FROM events WHERE seq IN (SELECT seq FROM events ORDER BY seq ASC LIMIT ?)', excess);
    }

    const newCnt = this.sql.exec('SELECT COUNT(*) as cnt FROM events').one() as { cnt: number } | null;
    if (newCnt) {
      this.eventCount = newCnt.cnt;
      this.persistCounters();
    }
  }

  private rowToEvent(r: EventRow, includeBody: boolean, includeHeaders: boolean): ChannelEvent {
    return {
      id: r.id,
      seq: r.seq,
      channel_name: '',
      received_at: r.received_at,
      method: r.method,
      path: r.path,
      query: r.query_json ? JSON.parse(r.query_json) : {},
      headers: includeHeaders && r.headers_json ? JSON.parse(r.headers_json) : {},
      remote_addr: r.remote_addr ?? undefined,
      user_agent: r.user_agent ?? undefined,
      provider: {
        hint: r.provider_hint ?? undefined,
        event_type: r.provider_event_type ?? undefined,
        delivery_id: r.provider_delivery_id ?? undefined,
      },
      body: {
        encoding: r.body_encoding as 'utf8' | 'base64',
        content_type: r.content_type ?? undefined,
        data: includeBody ? (r.body_truncated ? '' : (r.body_data ?? '')) : '',
        size: r.body_size,
        truncated: Boolean(r.body_truncated),
      },
      summary: r.summary_json ? JSON.parse(r.summary_json) : undefined,
    };
  }
}
