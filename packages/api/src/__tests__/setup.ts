import { beforeEach } from 'vitest';
import { hashToken } from '../lib/token.js';

// ---------------------------------------------------------------------------
// In-memory D1 mock — matches the real D1 interface closely enough for tests
// ---------------------------------------------------------------------------

interface Row {
  [key: string]: unknown;
}

class MockResult {
  private rows: Row[];
  constructor(rows: Row[]) { this.rows = rows; }
  first(): Row | null { return this.rows[0] ?? null; }
  all() { return { results: this.rows }; }
}

class MockPreparedStatement {
  private sql: string;
  private params: unknown[] = [];
  private db: MockD1;

  constructor(sql: string, db: MockD1) { this.sql = sql; this.db = db; }

  bind(...p: unknown[]): this { this.params = p; return this; }

  first(): Row | null {
    if (this.sql.includes('SELECT * FROM channels')) {
      const name = this.params[0];
      return this.db.channels.find(r => r.channel_name === name && !r.deleted_at) ?? null;
    }
    return null;
  }

  all() { return { results: [] as Row[] }; }

  run() {
    if (this.sql.includes('INSERT INTO channels')) {
      // INSERT INTO channels (id, user_id, channel_name, display_name, provider_hint,
      //   client_token_hash, ingest_secret_hash, status, max_events, ttl_hours, created_at, updated_at)
      // VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      const row: Row = {
        id: this.params[0],
        user_id: this.params[1],
        channel_name: this.params[2],
        display_name: this.params[3],
        provider_hint: this.params[4],
        client_token_hash: this.params[5],
        ingest_secret_hash: this.params[6],
        status: 'active',
        max_events: this.params[7],
        ttl_hours: this.params[8],
        created_at: this.params[9],
        updated_at: this.params[10],
        revoked_at: null,
        expires_at: null,
        deleted_at: null,
      };
      this.db.channels.push(row);
    }
    if (this.sql.includes('UPDATE channels')) {
      const name = this.params[this.params.length - 1];
      const ch = this.db.channels.find(r => r.channel_name === name);
      if (ch) {
        if (this.sql.includes("status = 'revoked'")) {
          ch.status = 'revoked';
          ch.revoked_at = this.params[0];
          ch.updated_at = this.params[1];
        }
        if (this.sql.includes("status = 'deleted'")) {
          ch.status = 'deleted';
          ch.deleted_at = this.params[0];
          ch.updated_at = this.params[1];
        }
      }
    }
    return { success: true as const };
  }
}

export class MockD1 {
  channels: Row[] = [];

  prepare(sql: string): MockPreparedStatement {
    return new MockPreparedStatement(sql, this);
  }
}

// ---------------------------------------------------------------------------
// In-memory DO stub mock
// ---------------------------------------------------------------------------

export interface MockDOStub {
  events: any[];
  seq: number;
  ingestEvent(raw: any): Promise<{ id: string; seq: number }>;
  getEvents(params: any): Promise<any[]>;
  clearEvents(): Promise<number>;
  getStatus(): Promise<{ connectedClients: number; lastSeq: number; eventCount: number }>;
  closeAllClients(code?: number, reason?: string): Promise<void>;
}

export function createMockDOStub(): MockDOStub {
  const events: any[] = [];
  let seq = 0;
  return {
    events,
    seq: 0,
    async ingestEvent(raw) {
      seq++;
      const evt = { id: `evt_test_${seq}`, seq, channel_name: raw.channel_name, received_at: new Date().toISOString(), ...raw };
      events.push(evt);
      return { id: evt.id, seq: evt.seq };
    },
    async getEvents(params) {
      const limit = Math.min(params.limit ?? 50, 100);
      let f = [...events];
      if (params.afterSeq !== undefined) f = f.filter((e: any) => e.seq > params.afterSeq!);
      if (params.beforeSeq !== undefined) f = f.filter((e: any) => e.seq < params.beforeSeq!);
      return f.slice(-limit);
    },
    async clearEvents() { const c = events.length; events.length = 0; return c; },
    async getStatus() { return { connectedClients: 0, lastSeq: seq, eventCount: events.length }; },
    async closeAllClients(_code?: number, _reason?: string) { /* no-op */ },
  };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

export interface TestEnv {
  db: MockD1;
  doStub: MockDOStub;
  env: { DB: unknown; CHANNEL_DO: unknown };
}

let _env: TestEnv;

beforeEach(() => {
  const db = new MockD1();
  const doStub = createMockDOStub();
  _env = {
    db,
    doStub,
    env: {
      DB: db,
      CHANNEL_DO: {
        idFromName: () => ({ toString: () => 'mock-do-id' }),
        get: () => doStub,
      },
    },
  };
});

export function testEnv(): TestEnv {
  return _env;
}

// ---------------------------------------------------------------------------
// Helper to create a channel AND fix the token hash so auth passes
// ---------------------------------------------------------------------------

export async function seedChannel(app: any): Promise<{ channel_name: string; client_token: string }> {
  const env = testEnv();
  const res = await app.request('/v1/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: 'Test' }),
  }, env.env);
  const ch: any = await res.json();

  // Patch the stored hash to match the real token
  const chRow = env.db.channels.find(r => r.channel_name === ch.channel_name);
  if (chRow) {
    chRow.client_token_hash = await hashToken(ch.client_token);
  }

  return { channel_name: ch.channel_name, client_token: ch.client_token };
}
