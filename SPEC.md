# Hookwire — Channel v0.1 Implementation Spec

**Project**: Hookwire
**Version**: v0.1
**Framework**: Hono + Cloudflare Workers + Durable Objects + D1
**Date**: 2026-06-08

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Shared Types Package](#3-shared-types-package)
4. [API Package — Core Implementation](#4-api-package--core-implementation)
5. [Durable Object — ChannelDO](#5-durable-object--channeldo)
6. [API Routes — Full Specification](#6-api-routes--full-specification)
7. [WebSocket Protocol](#7-websocket-protocol)
8. [SDK Package — Client SDK](#8-sdk-package--client-sdk)
9. [OpenAPI + Redoc Integration](#9-openapi--redoc-integration)
10. [Rate Limiting](#10-rate-limiting)
11. [Security & Token Management](#11-security--token-management)
12. [Database Schema](#12-database-schema)
13. [Implementation Order](#13-implementation-order)
14. [Minimum Acceptance Criteria](#14-minimum-acceptance-criteria)
15. [File-by-File Implementation Plan](#15-file-by-file-implementation-plan)

---

## 1. Architecture Overview

```
                         ┌─────────────────────────────┐
                         │   GitHub / Stripe / etc.     │
                         │   POST /in/ch_xxx            │
                         └─────────────┬───────────────┘
                                       │
                              ┌────────▼────────┐
                              │  Cloudflare      │
                              │  Worker (Hono)   │
                              │  (ingest + API)  │
                              └───┬────────┬─────┘
                                  │        │
                    ┌─────────────▼──┐  ┌──▼──────────────┐
                    │  D1            │  │  ChannelDO       │
                    │  (channels)    │  │  (per-channel)   │
                    │  (metadata)    │  │  • events SQLite │
                    └────────────────┘  │  • WebSocket hub │
                                        │  • seq manager   │
                                        │  • retention     │
                                        └──┬───────────────┘
                                           │
                              ┌────────────▼──────────────┐
                              │  WebSocket Clients         │
                              │  • macOS App               │
                              │  • SDK (Node.js / browser) │
                              │  • Dashboard               │
                              └────────────────────────────┘
```

- **Cloudflare Worker (Hono)**: HTTP ingest endpoint + REST API. Authenticates, rate-limits, routes to ChannelDO.
- **D1**: Stores channel metadata (id, name, status, token hashes, retention config). Does NOT store events.
- **ChannelDO (Durable Object)**: One per channel. Owns the events SQLite table, WebSocket hub, seq counter, and retention cleanup.
- **SDK**: Browser + Node.js client that connects via WebSocket, polls history, and exposes a typed event stream.

---

## 2. Monorepo Structure

```
hookwire/
├── package.json                  # Root workspace config
├── tsconfig.base.json            # Shared TS config
├── SPEC.md                       # This document
├── .gitignore
│
├── packages/
│   ├── types/                    # @hookwire/types
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── channel.ts
│   │       ├── event.ts
│   │       ├── websocket.ts
│   │       └── api.ts
│   │
│   ├── api/                      # @hookwire/api
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── wrangler.jsonc
│   │   └── src/
│   │       ├── index.ts          # Main Hono app
│   │       ├── app.ts            # App factory (for testing)
│   │       ├── channel-do.ts     # Durable Object class
│   │       ├── routes/
│   │       │   ├── channels.ts
│   │       │   ├── ingest.ts
│   │       │   ├── events.ts
│   │       │   └── openapi.ts
│   │       ├── middleware/
│   │       │   ├── auth.ts
│   │       │   ├── rate-limit.ts
│   │       │   └── error.ts
│   │       ├── lib/
│   │       │   ├── idgen.ts
│   │       │   ├── token.ts
│   │       │   ├── summary.ts
│   │       │   └── provider.ts
│   │       └── openapi.json      # Generated spec (served)
│   │
│   └── sdk/                      # @hookwire/sdk
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── client.ts
│           ├── websocket.ts
│           ├── history.ts
│           └── types.ts          # Re-exports from @hookwire/types
```

### Root `package.json`

```jsonc
{
  "name": "hookwire",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev": "npm run dev -w @hookwire/api",
    "build": "npm run build -w @hookwire/api",
    "deploy": "npm run deploy -w @hookwire/api",
    "typecheck": "npm run typecheck -w @hookwire/types && npm run typecheck -w @hookwire/sdk && npm run typecheck -w @hookwire/api",
    "cf-typegen": "npm run cf-typegen -w @hookwire/api",
    "generate-openapi": "npm run generate-openapi -w @hookwire/api"
  }
}
```

### Root `tsconfig.base.json`

```jsonc
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ESNext"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

---

## 3. Shared Types Package (`@hookwire/types`)

### `packages/types/package.json`

```jsonc
{
  "name": "@hookwire/types",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

### `packages/types/src/index.ts`

```ts
export * from './channel.js';
export * from './event.js';
export * from './websocket.js';
export * from './api.js';
```

### `packages/types/src/channel.ts`

```ts
export type ChannelStatus = 'active' | 'revoked' | 'expired' | 'deleted';

export interface Retention {
  max_events: number;
  ttl_hours: number;
}

export interface Channel {
  id: string;                     // chn_xxx (internal)
  user_id: string;
  channel_name: string;           // ch_xxx (public)
  display_name?: string;
  provider_hint?: string;
  client_token_hash: string;
  ingest_secret_hash?: string;
  status: ChannelStatus;
  max_events: number;
  ttl_hours: number;
  created_at: string;
  updated_at: string;
  revoked_at?: string;
  expires_at?: string;
  deleted_at?: string;
}

export interface CreateChannelRequest {
  display_name?: string;
  provider_hint?: string;
  retention?: {
    max_events?: number;
    ttl_hours?: number;
  };
}

export interface CreateChannelResponse {
  channel_id: string;
  channel_name: string;
  display_name?: string;
  provider_hint?: string;
  webhook_url: string;
  connect_url: string;
  client_token: string;
  ingest_secret: string;
  retention: Retention;
  created_at: string;
}

export interface UpdateChannelRequest {
  display_name?: string;
  provider_hint?: string;
  retention?: {
    max_events?: number;
    ttl_hours?: number;
  };
}
```

### `packages/types/src/event.ts`

```ts
export interface EventProvider {
  hint?: string;
  event_type?: string;
  delivery_id?: string;
}

export interface EventBody {
  encoding: 'utf8' | 'base64';
  content_type?: string;
  data: string;
  size: number;
  truncated: boolean;
}

export interface EventSummary {
  title: string;
  subtitle?: string;
}

export interface ChannelEvent {
  id: string;                     // evt_xxx
  seq: number;
  channel_name: string;
  received_at: string;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  remote_addr?: string;
  user_agent?: string;
  provider: EventProvider;
  body: EventBody;
  summary?: EventSummary;
}

export interface EventsQueryParams {
  limit?: number;
  after_seq?: number;
  before_seq?: number;
  include_body?: boolean;
  include_headers?: boolean;
}

export interface EventsResponse {
  channel: string;
  events: ChannelEvent[];
}

export interface ClearEventsResponse {
  ok: true;
  channel: string;
  deleted_events: number;
}
```

### `packages/types/src/websocket.ts`

```ts
// --- Server → Client Messages ---

export interface HelloMessage {
  type: 'hello';
  protocol: 'channel.v1';
  channel: string;
  server_time: string;
  features: {
    ack: false;
    history: true;
    replay: false;
  };
}

export interface EventMessage {
  type: 'event';
  id: string;
  seq: number;
  channel: string;
  received_at: string;
  provider: {
    hint?: string;
    event_type?: string;
    delivery_id?: string;
  };
  http: {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
  };
  body: {
    encoding: 'utf8' | 'base64';
    content_type?: string;
    data: string;
    size: number;
    truncated: boolean;
  };
  summary?: {
    title: string;
    subtitle?: string;
  };
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface StatusMessage {
  type: 'status';
  channel: string;
  connected_clients: number;
  last_seq: number;
}

// --- Client → Server Messages ---

export interface PingMessage {
  type: 'ping';
  id: string;
  time: string;
}

export interface PongMessage {
  type: 'pong';
  id: string;
  time: string;
}

export type ServerMessage = HelloMessage | EventMessage | ErrorMessage | StatusMessage | PongMessage;
export type ClientMessage = PingMessage;
```

### `packages/types/src/api.ts`

```ts
export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export interface ApiOk<T = Record<string, unknown>> {
  ok: true;
  [key: string]: unknown;
} & T;

export type ApiResponse<T = Record<string, unknown>> = ApiOk<T> | ApiError;

export interface IngestResponse {
  ok: true;
  channel: string;
  event_id: string;
  seq: number;
}

export interface RevokeChannelResponse {
  ok: true;
  channel: string;
  status: 'revoked';
  revoked_at: string;
}

export interface DeleteChannelResponse {
  ok: true;
  channel: string;
  status: 'deleted';
}

export interface RegenerateTokenResponse {
  ok: true;
  channel: string;
  client_token: string;
}

export interface RegenerateSecretResponse {
  ok: true;
  channel: string;
  ingest_secret: string;
}
```

---

## 4. API Package — Core Implementation (`@hookwire/api`)

### `packages/api/package.json`

```jsonc
{
  "name": "@hookwire/api",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "vite build",
    "deploy": "npm run build && wrangler deploy",
    "cf-typegen": "wrangler types --env-interface CloudflareBindings",
    "typecheck": "tsc --noEmit",
    "generate-openapi": "tsx scripts/generate-openapi.ts"
  },
  "dependencies": {
    "@hookwire/types": "*",
    "hono": "^4.12.24",
    "@hono/zod-openapi": "^0.18.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "^1.2.3",
    "vite": "^6.3.5",
    "wrangler": "^4.17.0"
  }
}
```

### `packages/api/wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "hookwire-api",
  "compatibility_date": "2025-08-03",
  "main": "./src/index.ts",
  "durable_objects": {
    "bindings": [
      {
        "name": "CHANNEL_DO",
        "class_name": "ChannelDO"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_classes": ["ChannelDO"]
    }
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "hookwire-db",
      "database_id": "your-database-id"
    }
  ]
}
```

### `packages/api/src/index.ts`

This is the Cloudflare Worker entry point. It:
1. Creates the Hono app
2. Exports the `ChannelDO` class for DO binding
3. Exports the default `fetch` handler

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { channelRoutes } from './routes/channels.js';
import { ingestRoute } from './routes/ingest.js';
import { eventRoutes } from './routes/events.js';
import { openApiRoute } from './routes/openapi.js';
import { errorHandler } from './middleware/error.js';

export { ChannelDO } from './channel-do.js';

type Bindings = {
  DB: D1Database;
  CHANNEL_DO: DurableObjectNamespace;
  // Rate limiting (uses DO or Workers KV)
  RATE_LIMITER?: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// Middleware
app.use('*', cors());
app.use('*', errorHandler);

// Routes
app.route('/v1/channels', channelRoutes);
app.route('/in', ingestRoute);
app.route('/v1/channels', eventRoutes);
app.route('/docs', openApiRoute);

// Health check
app.get('/health', (c) => c.json({ ok: true, service: 'hookwire-api', version: '0.1.0' }));

export default app;
```

---

## 5. Durable Object — ChannelDO

`ChannelDO` is the per-channel state coordinator. One instance per `channel_name`.

### Responsibilities
1. Allocates monotonically increasing `seq` per event
2. Stores events in internal SQLite
3. Manages connected WebSocket clients
4. Broadcasts events to all online clients
5. Cleans up expired/over-limit events
6. Returns event history on query

### `packages/api/src/channel-do.ts`

```ts
import { DurableObject } from 'cloudflare:workers';
import type { ChannelEvent, ServerMessage } from '@hookwire/types';

interface DOEnv {
  DB?: D1Database; // optional, only if DO needs to verify channel status
}

interface ClientSession {
  id: string;
  ws: WebSocket;
  connectedAt: string;
  clientType: 'macos_app' | 'sdk' | 'dashboard' | 'unknown';
  userAgent?: string;
}

export class ChannelDO extends DurableObject<DOEnv> {
  private sql: SqlStorage;
  private clients: Map<string, ClientSession> = new Map();
  private lastSeq: number = 0;
  private eventCount: number = 0;

  constructor(ctx: DurableObjectState, env: DOEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Initialize SQLite tables
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        received_at TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        query_json TEXT,
        headers_json TEXT NOT NULL,
        remote_addr TEXT,
        user_agent TEXT,
        provider_hint TEXT,
        provider_event_type TEXT,
        provider_delivery_id TEXT,
        content_type TEXT,
        body_encoding TEXT NOT NULL,
        body_data TEXT,
        body_size INTEGER NOT NULL,
        body_truncated INTEGER NOT NULL DEFAULT 0,
        summary_json TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_seq ON events(seq);
      CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at);
      CREATE INDEX IF NOT EXISTS idx_events_provider_event_type ON events(provider_event_type);
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Restore counters from metadata
    const lastSeqRow = this.sql.exec("SELECT value FROM metadata WHERE key = 'last_seq'").one();
    if (lastSeqRow) this.lastSeq = parseInt(lastSeqRow.value as string);

    const eventCountRow = this.sql.exec("SELECT value FROM metadata WHERE key = 'event_count'").one();
    if (eventCountRow) this.eventCount = parseInt(eventCountRow.value as string);

    // Handle WebSocket connections initiated via fetch
    ctx.getWebSockets().forEach(ws => {
      ws.accept();
      // Track as unknown client (will be identified on hello)
    });
  }

  // --- Public API called from Worker ---

  async ingestEvent(event: Omit<ChannelEvent, 'id' | 'seq' | 'received_at'>): Promise<{ id: string; seq: number }> {
    const id = generateEventId();
    const seq = ++this.lastSeq;
    const receivedAt = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO events (id, seq, received_at, method, path, query_json, headers_json,
        remote_addr, user_agent, provider_hint, provider_event_type, provider_delivery_id,
        content_type, body_encoding, body_data, body_size, body_truncated, summary_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, seq, receivedAt, event.method, event.path,
      JSON.stringify(event.query), JSON.stringify(event.headers),
      event.remote_addr ?? null, event.user_agent ?? null,
      event.provider.hint ?? null, event.provider.event_type ?? null, event.provider.delivery_id ?? null,
      event.body.content_type ?? null, event.body.encoding,
      event.body.truncated ? null : event.body.data, event.body.size, event.body.truncated ? 1 : 0,
      event.summary ? JSON.stringify(event.summary) : null
    );

    this.eventCount++;
    this.persistCounters();

    // Broadcast to all connected clients
    const message: ServerMessage = {
      type: 'event',
      id,
      seq,
      channel: '', // Will be filled by worker
      received_at: receivedAt,
      provider: event.provider,
      http: {
        method: event.method,
        path: event.path,
        query: event.query,
        headers: event.headers,
      },
      body: event.body,
      summary: event.summary,
    };

    this.broadcast(message);

    // Trigger cleanup after insert
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

    let sql = 'SELECT * FROM events WHERE 1=1';
    const args: unknown[] = [];

    if (params.afterSeq !== undefined) {
      sql += ' AND seq > ?';
      args.push(params.afterSeq);
    }
    if (params.beforeSeq !== undefined) {
      sql += ' AND seq < ?';
      args.push(params.beforeSeq);
    }

    sql += ' ORDER BY seq DESC LIMIT ?';
    args.push(limit);

    const rows = this.sql.exec(sql, ...args).toArray();
    return rows.map(row => this.rowToEvent(row, includeBody, includeHeaders)).reverse();
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

  // --- WebSocket ---

  async handleWebSocket(ws: WebSocket, clientType: string = 'unknown', userAgent?: string): Promise<void> {
    const sessionId = crypto.randomUUID();
    const session: ClientSession = {
      id: sessionId,
      ws,
      connectedAt: new Date().toISOString(),
      clientType: clientType as ClientSession['clientType'],
      userAgent,
    };

    this.clients.set(sessionId, session);

    ws.accept();

    // Send hello
    const hello: ServerMessage = {
      type: 'hello',
      protocol: 'channel.v1',
      channel: '', // Will be filled by worker
      server_time: new Date().toISOString(),
      features: {
        ack: false,
        history: true,
        replay: false,
      },
    };
    ws.send(JSON.stringify(hello));

    // Handle client messages
    ws.addEventListener('message', (msg) => {
      try {
        const data = JSON.parse(msg.data as string);
        if (data.type === 'ping') {
          const pong: ServerMessage = {
            type: 'pong',
            id: data.id,
            time: new Date().toISOString(),
          };
          ws.send(JSON.stringify(pong));
        }
      } catch {
        const error: ServerMessage = {
          type: 'error',
          code: 'invalid_message',
          message: 'Unable to parse message',
        };
        ws.send(JSON.stringify(error));
      }
    });

    ws.addEventListener('close', () => {
      this.clients.delete(sessionId);
    });

    ws.addEventListener('error', () => {
      this.clients.delete(sessionId);
    });
  }

  async closeAllClients(): Promise<void> {
    for (const [, session] of this.clients) {
      session.ws.close(1001, 'Channel revoked');
    }
    this.clients.clear();
  }

  // --- Private ---

  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const [, session] of this.clients) {
      try {
        session.ws.send(data);
      } catch {
        // Client might have disconnected; cleanup happens on close event
      }
    }
  }

  private persistCounters(): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_seq', ?), ('event_count', ?), ('last_event_at', ?)`,
      String(this.lastSeq), String(this.eventCount), new Date().toISOString()
    );
  }

  private async cleanupEvents(): Promise<void> {
    // TODO: Read retention config from metadata or channel table
    // For now, keep last 100 events
    const maxEvents = 100;
    const ttlHours = 24;

    const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000).toISOString();

    // Delete expired
    this.sql.exec("DELETE FROM events WHERE received_at < ?", cutoff);

    // Delete over-limit (keep latest maxEvents)
    const currentCount = this.sql.exec("SELECT COUNT(*) as cnt FROM events").one() as { cnt: number };
    if (currentCount && currentCount.cnt > maxEvents) {
      const deleteCount = currentCount.cnt - maxEvents;
      this.sql.exec("DELETE FROM events WHERE seq IN (SELECT seq FROM events ORDER BY seq ASC LIMIT ?)", deleteCount);
    }

    // Update count
    const newCount = this.sql.exec("SELECT COUNT(*) as cnt FROM events").one() as { cnt: number };
    if (newCount) {
      this.eventCount = newCount.cnt;
      this.persistCounters();
    }
  }

  private rowToEvent(row: Record<string, unknown>, includeBody: boolean, includeHeaders: boolean): ChannelEvent {
    const bodySize = row.body_size as number;
    const bodyTruncated = Boolean(row.body_truncated);

    return {
      id: row.id as string,
      seq: row.seq as number,
      channel_name: '', // Filled by worker
      received_at: row.received_at as string,
      method: row.method as string,
      path: row.path as string,
      query: row.query_json ? JSON.parse(row.query_json as string) : {},
      headers: includeHeaders && row.headers_json ? JSON.parse(row.headers_json as string) : {},
      remote_addr: row.remote_addr as string | undefined,
      user_agent: row.user_agent as string | undefined,
      provider: {
        hint: row.provider_hint as string | undefined,
        event_type: row.provider_event_type as string | undefined,
        delivery_id: row.provider_delivery_id as string | undefined,
      },
      body: {
        encoding: row.body_encoding as 'utf8' | 'base64',
        content_type: row.content_type as string | undefined,
        data: includeBody ? (bodyTruncated ? '' : (row.body_data as string) ?? '') : '',
        size: bodySize,
        truncated: bodyTruncated,
      },
      summary: row.summary_json ? JSON.parse(row.summary_json as string) : undefined,
    };
  }
}

function generateEventId(): string {
  // simple ULID-like prefix: evt_ + random base36
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(36).padStart(2, '0'))
    .join('');
  return `evt_${rand}`;
}
```

---

## 6. API Routes — Full Specification

### 6.1 Channel CRUD (`packages/api/src/routes/channels.ts`)

```
POST   /v1/channels                      → Create channel
GET    /v1/channels/:channel_name         → Get channel info
PATCH  /v1/channels/:channel_name         → Update channel
POST   /v1/channels/:channel_name/revoke  → Revoke channel
DELETE /v1/channels/:channel_name         → Delete channel
```

```ts
import { Hono } from 'hono';
import type { Bindings } from '../app.js';

const channelRoutes = new Hono<{ Bindings: Bindings }>();

// POST /v1/channels — Create
channelRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { display_name, provider_hint, retention } = body;

  const channelId = generateId('chn');
  const channelName = generateChannelName();
  const clientToken = generateClientToken();
  const ingestSecret = generateIngestSecret();
  const clientTokenHash = await hashToken(clientToken);
  const ingestSecretHash = await hashToken(ingestSecret);

  const now = new Date().toISOString();
  const maxEvents = retention?.max_events ?? 100;
  const ttlHours = retention?.ttl_hours ?? 24;

  // Store in D1
  await c.env.DB.prepare(
    `INSERT INTO channels (id, user_id, channel_name, display_name, provider_hint,
      client_token_hash, ingest_secret_hash, status, max_events, ttl_hours, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  ).bind(channelId, 'user_placeholder', channelName, display_name ?? null,
    provider_hint ?? null, clientTokenHash, ingestSecretHash,
    maxEvents, ttlHours, now, now).run();

  // Initialize ChannelDO (optional — just ensures DO exists)
  const doId = c.env.CHANNEL_DO.idFromName(channelName);

  return c.json({
    ok: true,
    channel_id: channelId,
    channel_name: channelName,
    display_name: display_name ?? null,
    provider_hint: provider_hint ?? null,
    webhook_url: `https://hooks.hookwire.dev/in/${channelName}`,
    connect_url: `wss://api.hookwire.dev/v1/channels/${channelName}/connect`,
    client_token: clientToken,
    ingest_secret: ingestSecret,
    retention: { max_events: maxEvents, ttl_hours: ttlHours },
    created_at: now,
  }, 201);
});

// GET /v1/channels/:channel_name
channelRoutes.get('/:channel_name', async (c) => {
  const channelName = c.req.param('channel_name');
  const row = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE channel_name = ? AND deleted_at IS NULL'
  ).bind(channelName).first();

  if (!row) return c.json({ ok: false, error: { code: 'not_found', message: 'Channel not found' } }, 404);

  return c.json({
    ok: true,
    channel_id: row.id,
    channel_name: row.channel_name,
    display_name: row.display_name,
    provider_hint: row.provider_hint,
    status: row.status,
    retention: { max_events: row.max_events, ttl_hours: row.ttl_hours },
    webhook_url: `https://hooks.hookwire.dev/in/${row.channel_name}`,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
  });
});

// PATCH /v1/channels/:channel_name
channelRoutes.patch('/:channel_name', async (c) => { /* ... */ });

// POST /v1/channels/:channel_name/revoke
channelRoutes.post('/:channel_name/revoke', async (c) => { /* ... */ });

// DELETE /v1/channels/:channel_name
channelRoutes.delete('/:channel_name', async (c) => { /* ... */ });

export { channelRoutes };
```

### 6.2 Webhook Ingest (`packages/api/src/routes/ingest.ts`)

```
POST /in/:channel_name     → Ingest webhook
GET  /in/:channel_name     → Ingest webhook (any method)
PUT  /in/:channel_name     → Ingest webhook
PATCH /in/:channel_name     → Ingest webhook
```

```ts
import { Hono } from 'hono';
import type { Bindings } from '../app.js';

const ingestRoute = new Hono<{ Bindings: Bindings }>();

// All methods for ingest flexibility
const ingestMethods = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE'];

for (const method of ingestMethods) {
  ingestRoute.on(method, '/in/:channel_name', async (c) => {
    const channelName = c.req.param('channel_name');

    // 1. Look up channel in D1
    const channel = await c.env.DB.prepare(
      'SELECT * FROM channels WHERE channel_name = ? AND deleted_at IS NULL'
    ).bind(channelName).first();

    if (!channel) {
      return c.json({
        ok: false,
        error: { code: 'channel_not_found', message: 'Channel not found' }
      }, 404);
    }

    if (channel.status === 'revoked') {
      return c.json({
        ok: false,
        error: { code: 'channel_revoked', message: 'Channel has been revoked' }
      }, 410);
    }

    if (channel.status === 'expired') {
      return c.json({
        ok: false,
        error: { code: 'channel_expired', message: 'Channel has expired' }
      }, 410);
    }

    // 2. Rate limit check (see §10)

    // 3. Read body
    const rawBody = await c.req.text();
    const bodySize = new TextEncoder().encode(rawBody).length;

    // 4. Size limits
    const HARD_BODY_LIMIT = 1 * 1024 * 1024; // 1 MB
    const SOFT_BODY_LIMIT = 256 * 1024; // 256 KB

    if (bodySize > HARD_BODY_LIMIT) {
      return c.json({
        ok: false,
        error: { code: 'body_too_large', message: 'Request body exceeds maximum size' }
      }, 413);
    }

    const truncated = bodySize > SOFT_BODY_LIMIT;
    const bodyData = truncated ? rawBody.slice(0, SOFT_BODY_LIMIT) : rawBody;

    // 5. Extract provider hints
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const providerHint = extractProviderHint(headers, channel.provider_hint);
    const eventType = extractEventType(headers, providerHint);
    const deliveryId = extractDeliveryId(headers, providerHint);

    // 6. Generate summary
    const summary = generateSummary({
      providerHint,
      eventType,
      contentType: headers['content-type'],
      bodySize,
      method: c.req.method,
    });

    // 7. Forward to ChannelDO
    const doId = c.env.CHANNEL_DO.idFromName(channelName);
    const stub = c.env.CHANNEL_DO.get(doId);

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

    // 8. Return 202
    return c.json({
      ok: true,
      channel: channelName,
      event_id: result.id,
      seq: result.seq,
    }, 202);
  });
}

export { ingestRoute };
```

### 6.3 Event Routes (`packages/api/src/routes/events.ts`)

```
GET    /v1/channels/:channel_name/events    → Get event history
DELETE /v1/channels/:channel_name/events    → Clear events
GET    /v1/channels/:channel_name/connect   → WebSocket upgrade
```

```ts
import { Hono } from 'hono';
import type { Bindings } from '../app.js';

const eventRoutes = new Hono<{ Bindings: Bindings }>();

// GET /v1/channels/:channel_name/events
eventRoutes.get('/:channel_name/events', async (c) => {
  const channelName = c.req.param('channel_name');
  const { limit, after_seq, before_seq, include_body, include_headers } = c.req.query();

  // Auth: verify client_token from Authorization header
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ ok: false, error: { code: 'unauthorized', message: 'Missing or invalid token' } }, 401);
  }
  const token = authHeader.slice(7);

  const channel = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE channel_name = ? AND deleted_at IS NULL'
  ).bind(channelName).first();

  if (!channel) return c.json({ ok: false, error: { code: 'not_found', message: 'Channel not found' } }, 404);

  const valid = await verifyToken(token, channel.client_token_hash);
  if (!valid) return c.json({ ok: false, error: { code: 'unauthorized', message: 'Invalid client token' } }, 401);

  if (channel.status !== 'active') {
    return c.json({ ok: false, error: { code: 'channel_not_active', message: 'Channel is not active' } }, 403);
  }

  const doId = c.env.CHANNEL_DO.idFromName(channelName);
  const stub = c.env.CHANNEL_DO.get(doId);

  const events = await stub.getEvents({
    limit: limit ? parseInt(limit) : 50,
    afterSeq: after_seq ? parseInt(after_seq) : undefined,
    beforeSeq: before_seq ? parseInt(before_seq) : undefined,
    includeBody: include_body !== 'false',
    includeHeaders: include_headers !== 'false',
  });

  // Fill in channel_name for each event
  const eventsWithChannel = events.map(e => ({ ...e, channel_name: channelName }));

  return c.json({ ok: true, channel: channelName, events: eventsWithChannel });
});

// DELETE /v1/channels/:channel_name/events
eventRoutes.delete('/:channel_name/events', async (c) => {
  // Similar auth flow...
  const doId = c.env.CHANNEL_DO.idFromName(channelName);
  const stub = c.env.CHANNEL_DO.get(doId);
  const count = await stub.clearEvents();
  return c.json({ ok: true, channel: channelName, deleted_events: count });
});

// WebSocket upgrade: GET /v1/channels/:channel_name/connect
eventRoutes.get('/:channel_name/connect', async (c) => {
  const channelName = c.req.param('channel_name');
  const authHeader = c.req.header('Authorization');

  // Auth before upgrade
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ ok: false, error: { code: 'unauthorized', message: 'Missing or invalid token' } }, 401);
  }
  const token = authHeader.slice(7);

  const channel = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE channel_name = ? AND deleted_at IS NULL'
  ).bind(channelName).first();

  if (!channel) return c.json({ ok: false, error: { code: 'not_found', message: 'Channel not found' } }, 404);

  const valid = await verifyToken(token, channel.client_token_hash);
  if (!valid) return c.json({ ok: false, error: { code: 'unauthorized', message: 'Invalid client token' } }, 401);

  if (channel.status !== 'active') {
    return c.json(
      { ok: false, error: { code: 'channel_not_active', message: 'Channel is not active' } },
      channel.status === 'revoked' ? 410 : 403
    );
  }

  // Check concurrent client limit (10 per channel)
  const doId = c.env.CHANNEL_DO.idFromName(channelName);
  const stub = c.env.CHANNEL_DO.get(doId);
  const status = await stub.getStatus();
  if (status.connectedClients >= 10) {
    return c.json({ ok: false, error: { code: 'too_many_connections', message: 'Too many concurrent connections' } }, 429);
  }

  // Get WebSocket pair
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'Expected WebSocket upgrade' } }, 400);
  }

  const [client, server] = Object.values(new WebSocketPair());

  // Hand off to ChannelDO
  await stub.handleWebSocket(server, 'sdk', c.req.header('User-Agent') ?? undefined);

  return new Response(null, { status: 101, webSocket: client });
});

export { eventRoutes };
```

### 6.4 OpenAPI Docs Route (`packages/api/src/routes/openapi.ts`)

```ts
import { Hono } from 'hono';

const openApiRoute = new Hono();

// Serve Redoc HTML page
openApiRoute.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html>
<head>
  <title>Hookwire API Documentation</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style> body { margin: 0; padding: 0; } </style>
</head>
<body>
  <redoc spec-url="/docs/openapi.json"></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>
  `);
});

// Serve raw OpenAPI spec
openApiRoute.get('/openapi.json', (c) => {
  return c.json(openApiSpec);
});

export { openApiRoute };
```

---

## 7. WebSocket Protocol

### Connection Flow

```
Client                                     Server
  │                                          │
  │  GET /v1/channels/ch_xxx/connect          │
  │  Authorization: Bearer ct_xxx             │
  │  Upgrade: websocket                       │
  │─────────────────────────────────────────>│
  │                                          │  ← Auth check (before upgrade)
  │  101 Switching Protocols                  │  ← Upgrade to WebSocket
  │<─────────────────────────────────────────│
  │                                          │
  │  {"type":"hello","protocol":"channel.v1", │
  │   "channel":"ch_xxx","server_time":"...", │
  │   "features":{...}}                       │
  │<─────────────────────────────────────────│
  │                                          │
  │  {"type":"event","id":"evt_xxx",...}      │  ← Webhook arrives
  │<─────────────────────────────────────────│
  │                                          │
  │  {"type":"ping","id":"msg_1","time":"..."}│
  │─────────────────────────────────────────>│
  │                                          │
  │  {"type":"pong","id":"msg_1","time":"..."}│
  │<─────────────────────────────────────────│
```

### Message Types (reuse from `@hookwire/types`)

All messages are JSON over WebSocket text frames.

| Direction | Type | Description |
|-----------|------|-------------|
| S→C | `hello` | Connection established, features negotiated |
| S→C | `event` | Real-time webhook event |
| S→C | `error` | Server error |
| S→C | `status` | Connection/channel status (optional) |
| S→C | `pong` | Response to client ping |
| C→S | `ping` | Keepalive / latency check |

---

## 8. SDK Package (`@hookwire/sdk`)

The SDK provides a typed, event-driven client for both browser and Node.js.

### `packages/sdk/package.json`

```jsonc
{
  "name": "@hookwire/sdk",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@hookwire/types": "*"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  },
  "keywords": ["webhook", "hookwire", "realtime", "websocket"],
  "license": "MIT"
}
```

### `packages/sdk/src/index.ts`

```ts
export { HookwireClient } from './client.js';
export type { HookwireClientOptions, HookwireEvent } from './client.js';
export * from '@hookwire/types';
```

### `packages/sdk/src/client.ts`

```ts
import type { ChannelEvent, ServerMessage, EventMessage } from '@hookwire/types';
import { HookwireWebSocket } from './websocket.js';
import { fetchHistory, fetchChannel } from './history.js';

export interface HookwireClientOptions {
  /** Base URL of the Hookwire API (default: https://api.hookwire.dev) */
  baseUrl?: string;
  /** WebSocket URL for connecting to channels */
  wsUrl?: string;
  /** Client token for authentication */
  clientToken: string;
  /** Channel name to subscribe to */
  channelName: string;
  /** Auto-reconnect on disconnection */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;
  /** Max reconnect attempts (default: 10, -1 for infinite) */
  maxReconnectAttempts?: number;
}

export type HookwireEventHandler = (event: ChannelEvent) => void;

export class HookwireClient {
  private options: Required<HookwireClientOptions>;
  private ws: HookwireWebSocket | null = null;
  private eventHandlers: Set<HookwireEventHandler> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeq = 0;

  constructor(options: HookwireClientOptions) {
    this.options = {
      baseUrl: 'https://api.hookwire.dev',
      wsUrl: 'wss://api.hookwire.dev',
      autoReconnect: true,
      reconnectDelay: 1000,
      maxReconnectAttempts: 10,
      ...options,
    };
  }

  /** Connect to the channel via WebSocket and start receiving events */
  async connect(): Promise<void> {
    // First, fetch recent history to catch up
    await this.catchUpHistory();

    // Then connect WebSocket for real-time
    this.connectWebSocket();
  }

  /** Disconnect from the channel */
  disconnect(): void {
    this.reconnectAttempts = this.options.maxReconnectAttempts; // prevent reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Register an event handler */
  onEvent(handler: HookwireEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => { this.eventHandlers.delete(handler); };
  }

  /** Fetch event history */
  async getHistory(params?: {
    limit?: number;
    afterSeq?: number;
    includeBody?: boolean;
  }): Promise<ChannelEvent[]> {
    const response = await fetchHistory({
      baseUrl: this.options.baseUrl,
      channelName: this.options.channelName,
      clientToken: this.options.clientToken,
      limit: params?.limit,
      afterSeq: params?.afterSeq,
      includeBody: params?.includeBody,
    });
    return response.events;
  }

  /** Get channel info */
  async getChannel(): Promise<any> {
    return fetchChannel({
      baseUrl: this.options.baseUrl,
      channelName: this.options.channelName,
      clientToken: this.options.clientToken,
    });
  }

  // --- Private ---

  private async catchUpHistory(): Promise<void> {
    try {
      const events = await this.getHistory({
        afterSeq: this.lastSeq,
        limit: 50,
      });
      for (const event of events) {
        this.lastSeq = Math.max(this.lastSeq, event.seq);
        this.emit(event);
      }
    } catch (err) {
      console.warn('[HookwireSDK] Failed to fetch history:', err);
    }
  }

  private connectWebSocket(): void {
    const wsUrl = `${this.options.wsUrl}/v1/channels/${this.options.channelName}/connect`;

    this.ws = new HookwireWebSocket(wsUrl, this.options.clientToken);

    this.ws.on('event', (event: ChannelEvent) => {
      this.lastSeq = Math.max(this.lastSeq, event.seq);
      this.emit(event);
    });

    this.ws.on('closed', () => {
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[HookwireSDK] WebSocket error:', err);
      this.scheduleReconnect();
    });

    this.ws.connect();
  }

  private scheduleReconnect(): void {
    if (!this.options.autoReconnect) return;
    if (this.options.maxReconnectAttempts >= 0 && this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.warn('[HookwireSDK] Max reconnect attempts reached');
      return;
    }

    const delay = this.options.reconnectDelay * Math.min(Math.pow(2, this.reconnectAttempts), 30); // exponential backoff, max 30s
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      await this.catchUpHistory();
      this.connectWebSocket();
    }, delay);
  }

  private emit(event: ChannelEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('[HookwireSDK] Event handler error:', err);
      }
    }
  }
}
```

### `packages/sdk/src/websocket.ts`

```ts
import type { ChannelEvent, ServerMessage } from '@hookwire/types';

type WsEventHandler = (event: ChannelEvent) => void;
type WsClosedHandler = () => void;
type WsErrorHandler = (error: Event) => void;

export class HookwireWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private eventHandlers: Set<WsEventHandler> = new Set();
  private closedHandlers: Set<WsClosedHandler> = new Set();
  private errorHandlers: Set<WsErrorHandler> = new Set();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(url: string, clientToken: string) {
    this.url = url;
    this.token = clientToken;
  }

  connect(): void {
    // Note: Cloudflare Workers WebSocket does not support custom headers
    // in native WebSocket constructor. We use a subprotocol workaround
    // or pass token as query parameter.
    // For this implementation, the server supports token in query param as fallback.
    const wsUrl = new URL(this.url);
    wsUrl.searchParams.set('token', this.token);

    this.ws = new WebSocket(wsUrl.toString());

    this.ws.onopen = () => {
      // Start ping/pong keepalive
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'ping',
            id: crypto.randomUUID(),
            time: new Date().toISOString(),
          }));
        }
      }, 30000); // every 30 seconds
    };

    this.ws.onmessage = (msg) => {
      try {
        const data: ServerMessage = JSON.parse(msg.data as string);
        if (data.type === 'event') {
          this.emitEvent(data);
        } else if (data.type === 'hello') {
          console.log('[HookwireSDK] Connected to channel:', data.channel);
        }
        // pong, status, error handled silently or logged
      } catch (err) {
        console.error('[HookwireSDK] Failed to parse message:', err);
      }
    };

    this.ws.onclose = () => {
      if (this.pingInterval) clearInterval(this.pingInterval);
      for (const h of this.closedHandlers) h();
    };

    this.ws.onerror = (err) => {
      for (const h of this.errorHandlers) h(err);
    };
  }

  close(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  on(event: 'event', handler: WsEventHandler): void;
  on(event: 'closed', handler: WsClosedHandler): void;
  on(event: 'error', handler: WsErrorHandler): void;
  on(event: string, handler: (...args: any[]) => void): void {
    switch (event) {
      case 'event': this.eventHandlers.add(handler as WsEventHandler); break;
      case 'closed': this.closedHandlers.add(handler as WsClosedHandler); break;
      case 'error': this.errorHandlers.add(handler as WsErrorHandler); break;
    }
  }

  private emitEvent(msg: ServerMessage & { type: 'event' }): void {
    const event: ChannelEvent = {
      id: msg.id,
      seq: msg.seq,
      channel_name: msg.channel,
      received_at: msg.received_at,
      method: msg.http.method,
      path: msg.http.path,
      query: msg.http.query,
      headers: msg.http.headers,
      remote_addr: undefined,
      user_agent: undefined,
      provider: msg.provider,
      body: msg.body,
      summary: msg.summary,
    };
    for (const h of this.eventHandlers) h(event);
  }
}
```

### `packages/sdk/src/history.ts`

```ts
import type { EventsResponse, ChannelEvent } from '@hookwire/types';

interface HistoryParams {
  baseUrl: string;
  channelName: string;
  clientToken: string;
  limit?: number;
  afterSeq?: number;
  includeBody?: boolean;
}

export async function fetchHistory(params: HistoryParams): Promise<EventsResponse> {
  const url = new URL(`${params.baseUrl}/v1/channels/${params.channelName}/events`);
  if (params.limit) url.searchParams.set('limit', String(params.limit));
  if (params.afterSeq) url.searchParams.set('after_seq', String(params.afterSeq));
  if (params.includeBody !== undefined) url.searchParams.set('include_body', String(params.includeBody));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${params.clientToken}` },
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`Failed to fetch history: ${error.error?.message ?? res.statusText}`);
  }

  return res.json();
}

export async function fetchChannel(params: { baseUrl: string; channelName: string; clientToken: string }): Promise<any> {
  const res = await fetch(`${params.baseUrl}/v1/channels/${params.channelName}`, {
    headers: { Authorization: `Bearer ${params.clientToken}` },
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`Failed to fetch channel: ${error.error?.message ?? res.statusText}`);
  }

  return res.json();
}
```

### SDK Usage Example

```ts
import { HookwireClient } from '@hookwire/sdk';

const client = new HookwireClient({
  clientToken: 'ct_xxx',
  channelName: 'ch_xxx',
  autoReconnect: true,
});

// Subscribe to events
const unsubscribe = client.onEvent((event) => {
  console.log(`[${event.provider.hint}] ${event.summary?.title}`);
  console.log('Body:', event.body.data);
});

// Connect (fetches history then opens WebSocket)
await client.connect();

// Later
// unsubscribe();
// client.disconnect();
```

---

## 9. OpenAPI + Redoc Integration

### Approach

We use `@hono/zod-openapi` to define routes with Zod schemas. This provides:
- Type-safe request/response validation
- Automatic OpenAPI 3.1 spec generation
- Works natively with Hono

Redoc is served as a static HTML page that renders the OpenAPI spec from `/docs/openapi.json`.

### `packages/api/src/lib/openapi-spec.ts`

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

// --- Schemas ---

const ChannelSchema = z.object({
  channel_id: z.string().describe('Internal channel ID'),
  channel_name: z.string().describe('Public channel name (used in URL)'),
  display_name: z.string().nullable().optional(),
  provider_hint: z.string().nullable().optional(),
  webhook_url: z.string().describe('URL for external webhook providers'),
  connect_url: z.string().describe('WebSocket connection URL'),
  client_token: z.string().describe('Private client token (shown only once)'),
  ingest_secret: z.string().describe('Webhook signature verification secret'),
  retention: z.object({
    max_events: z.number(),
    ttl_hours: z.number(),
  }),
  created_at: z.string(),
});

const CreateChannelSchema = z.object({
  display_name: z.string().optional(),
  provider_hint: z.enum(['github', 'stripe', 'linear', 'custom']).optional(),
  retention: z.object({
    max_events: z.number().min(1).max(1000).optional().default(100),
    ttl_hours: z.number().min(1).max(720).optional().default(24),
  }).optional(),
}).openapi('CreateChannelRequest');

const EventSchema = z.object({
  id: z.string(),
  seq: z.number(),
  channel_name: z.string(),
  received_at: z.string(),
  method: z.string(),
  path: z.string(),
  query: z.record(z.string()),
  headers: z.record(z.string()),
  remote_addr: z.string().nullable().optional(),
  user_agent: z.string().nullable().optional(),
  provider: z.object({
    hint: z.string().nullable().optional(),
    event_type: z.string().nullable().optional(),
    delivery_id: z.string().nullable().optional(),
  }),
  body: z.object({
    encoding: z.enum(['utf8', 'base64']),
    content_type: z.string().nullable().optional(),
    data: z.string(),
    size: z.number(),
    truncated: z.boolean(),
  }),
  summary: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
  }).nullable().optional(),
}).openapi('ChannelEvent');

// --- Route Definitions ---

const createChannelRoute = createRoute({
  method: 'post',
  path: '/v1/channels',
  tags: ['Channels'],
  summary: 'Create a new channel',
  description: 'Creates a new webhook channel with a random channel_name, client_token, and ingest_secret.',
  request: {
    body: {
      content: { 'application/json': { schema: CreateChannelSchema } },
    },
  },
  responses: {
    201: {
      description: 'Channel created successfully',
      content: { 'application/json': { schema: ChannelSchema } },
    },
    400: {
      description: 'Invalid request body',
      content: { 'application/json': { schema: z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }) } },
    },
  },
});

const ingestRoute = createRoute({
  method: 'post',
  path: '/in/{channel_name}',
  tags: ['Ingest'],
  summary: 'Ingest a webhook',
  description: 'Receives a webhook from an external service and broadcasts it to connected clients.',
  parameters: [
    { name: 'channel_name', in: 'path', required: true, schema: { type: 'string' } },
  ],
  responses: {
    202: { description: 'Webhook accepted' },
    404: { description: 'Channel not found' },
    410: { description: 'Channel revoked or expired' },
    413: { description: 'Body too large' },
  },
});

const getEventsRoute = createRoute({
  method: 'get',
  path: '/v1/channels/{channel_name}/events',
  tags: ['Events'],
  summary: 'Get event history',
  description: 'Returns recent events for a channel. Requires client_token authentication.',
  parameters: [
    { name: 'channel_name', in: 'path', required: true, schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
    { name: 'after_seq', in: 'query', schema: { type: 'integer' } },
    { name: 'before_seq', in: 'query', schema: { type: 'integer' } },
    { name: 'include_body', in: 'query', schema: { type: 'boolean', default: true } },
    { name: 'include_headers', in: 'query', schema: { type: 'boolean', default: true } },
  ],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Event history' },
    401: { description: 'Invalid client token' },
    404: { description: 'Channel not found' },
  },
});

// --- OpenAPI Configuration ---

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Hookwire API',
    version: '0.1.0',
    description: `Hookwire is a webhook relay service that provides real-time event streaming.

## How it works

1. **Create a channel** — generates a random webhook URL and a client token
2. **Configure your webhook provider** (GitHub, Stripe, etc.) to POST to your webhook URL
3. **Connect via WebSocket or use the SDK** — receive events in real-time
4. **Query history** — fetch past events using the REST API

## Authentication

- **Channel ingest**: No auth required (just the channel name in the URL)
- **Client operations**: `Bearer <client_token>` header
- **Management operations**: `Bearer <app_session_token>` header`,
    contact: {
      name: 'Hookwire',
      url: 'https://hookwire.dev',
    },
  },
  servers: [
    { url: 'https://api.hookwire.dev', description: 'Production' },
    { url: 'http://localhost:8787', description: 'Local development' },
  ],
  tags: [
    { name: 'Channels', description: 'Channel CRUD operations' },
    { name: 'Events', description: 'Event history and management' },
    { name: 'Ingest', description: 'Webhook ingest endpoint' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Client token (ct_xxx) for event/connect access, or app session token for management',
      },
    },
  },
  paths: {},
};

// Helper to add OpenAPI routes
export function registerOpenApiRoutes(app: OpenAPIHono): void {
  app.openapi(createChannelRoute, async (c) => {
    // ... create channel logic
  });

  // ... register other routes
}
```

### Redoc HTML page

Served at `/docs` — see `openapi.ts` route in §6.4.

---

## 10. Rate Limiting

### Strategy: Per-channel sliding window using Durable Object

We can use a dedicated `RateLimiterDO` or handle it within `ChannelDO`.

For v0.1, implement rate limiting in the Worker layer using a simple in-memory approach (sufficient for single-worker deployment on Cloudflare).

### `packages/api/src/middleware/rate-limit.ts`

```ts
import type { Context, Next } from 'hono';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const channelRateLimits = new Map<string, { count: number; resetAt: number }>();

export function channelRateLimit(config: RateLimitConfig = { windowMs: 60_000, maxRequests: 60 }) {
  return async (c: Context, next: Next) => {
    const channelName = c.req.param('channel_name');
    if (!channelName) return next();

    const now = Date.now();
    let entry = channelRateLimits.get(channelName);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + config.windowMs };
      channelRateLimits.set(channelName, entry);
    }

    entry.count++;

    if (entry.count > config.maxRequests) {
      return c.json({
        ok: false,
        error: { code: 'rate_limited', message: 'Channel rate limit exceeded' }
      }, 429);
    }

    // Periodic cleanup
    if (Math.random() < 0.01) {
      for (const [key, val] of channelRateLimits) {
        if (now > val.resetAt) channelRateLimits.delete(key);
      }
    }

    return next();
  };
}
```

### Limits Applied

| Operation | Limit |
|-----------|-------|
| Webhook ingest | 60 req/min/channel |
| Event history query | 120 req/min/channel |
| WebSocket connections | 10 concurrent/channel |
| Body size (max) | 1 MB hard limit, 256 KB soft limit |

---

## 11. Security & Token Management

### ID Generation (`packages/api/src/lib/idgen.ts`)

```ts
// Prefixes:
// chn_  → channel_id (internal)
// ch_   → channel_name (public)
// ct_   → client_token
// whsec_→ ingest_secret
// evt_  → event_id

function generateId(prefix: string, length: number = 22): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let result = prefix;
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export function generateChannelId(): string {
  return generateId('chn_', 26);
}

export function generateChannelName(): string {
  return generateId('ch_', 18);
}

export function generateClientToken(): string {
  return generateId('ct_', 24);
}

export function generateIngestSecret(): string {
  return generateId('whsec_', 24);
}

export function generateEventId(): string {
  return generateId('evt_', 26);
}
```

### Token Hashing (`packages/api/src/lib/token.ts`)

```ts
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyToken(token: string, hash: string): Promise<boolean> {
  const computedHash = await hashToken(token);
  // Constant-time comparison
  if (computedHash.length !== hash.length) return false;
  let result = 0;
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return result === 0;
}
```

### Permission Matrix

| Operation | Requires |
|-----------|----------|
| Ingest webhook | `channel_name` (URL) |
| Read event history | `client_token` |
| Connect WebSocket | `client_token` |
| Clear events | `client_token` or `app_session_token` |
| Revoke channel | `app_session_token` |
| Modify retention | `app_session_token` |
| Delete channel | `app_session_token` |
| Regenerate client_token | `app_session_token` |
| Regenerate ingest_secret | `app_session_token` |

---

## 12. Database Schema

### D1: `channels` table

```sql
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  provider_hint TEXT,
  client_token_hash TEXT NOT NULL,
  ingest_secret_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired','deleted')),
  max_events INTEGER NOT NULL DEFAULT 100,
  ttl_hours INTEGER NOT NULL DEFAULT 24,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  expires_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_channels_user_id ON channels(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_channel_name ON channels(channel_name);
CREATE INDEX IF NOT EXISTS idx_channels_status ON channels(status);
```

### ChannelDO SQLite: `events` table

```sql
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  query_json TEXT,
  headers_json TEXT NOT NULL,
  remote_addr TEXT,
  user_agent TEXT,
  provider_hint TEXT,
  provider_event_type TEXT,
  provider_delivery_id TEXT,
  content_type TEXT,
  body_encoding TEXT NOT NULL,
  body_data TEXT,
  body_size INTEGER NOT NULL,
  body_truncated INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_seq ON events(seq);
CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at);
CREATE INDEX IF NOT EXISTS idx_events_provider_event_type ON events(provider_event_type);
```

### ChannelDO SQLite: `metadata` table

```sql
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Keys**: `last_seq`, `created_at`, `last_event_at`, `event_count`

---

## 13. Implementation Order

```
Phase 1: Foundation
  1. Set up monorepo (npm workspaces)
  2. Create @hookwire/types package
  3. Create @hookwire/api package with wrangler config
  4. Create D1 database in Cloudflare dashboard
  5. Run channels table migration
  6. Implement ID generation (idgen.ts)
  7. Implement token hashing (token.ts)

Phase 2: Channel CRUD
  8. POST /v1/channels — create channel
  9. GET /v1/channels/:name — get channel info
  10. PATCH /v1/channels/:name — update channel
  11. POST /v1/channels/:name/revoke — revoke channel
  12. DELETE /v1/channels/:name — delete channel

Phase 3: Ingest & DO
  13. Create ChannelDO class skeleton
  14. POST /in/:channel_name — ingest webhook
  15. ChannelDO.ingestEvent — write event to SQLite
  16. Provider hint extraction
  17. Event summary generation
  18. Body size limits and truncation

Phase 4: WebSocket
  19. WebSocket upgrade on /v1/channels/:name/connect
  20. Auth check before WebSocket upgrade
  21. ChannelDO WebSocket session management
  22. Hello message on connect
  23. Event broadcast to all connected clients
  24. Ping/pong handling

Phase 5: History & Retention
  25. GET /v1/channels/:name/events — event history
  26. DELETE /v1/channels/:name/events — clear events
  27. Retention cleanup (max_events + ttl)
  28. ChannelDO retention logic

Phase 6: SDK
  29. Create @hookwire/sdk package
  30. HookwireClient class
  31. WebSocket connection management
  32. Auto-reconnect with exponential backoff
  33. History API integration
  34. Event handler registration

Phase 7: OpenAPI + Polish
  35. Add @hono/zod-openapi
  36. Define OpenAPI schemas for all routes
  37. Generate openapi.json
  38. Serve Redoc at /docs
  39. Rate limiting middleware
  40. Error response consistency
  41. CORS headers
  42. Health check endpoint
```

---

## 14. Minimum Acceptance Criteria

- [ ] `POST /v1/channels` creates a random channel with `channel_name`, `client_token`, `ingest_secret`
- [ ] Response includes `webhook_url` and `connect_url`
- [ ] `POST /in/:channel_name` returns 202 with `event_id` and `seq`
- [ ] Event is stored in ChannelDO SQLite
- [ ] WebSocket connection at `/v1/channels/:channel_name/connect` succeeds with valid `client_token`
- [ ] Connected WebSocket client receives `hello` message
- [ ] Connected WebSocket client receives `event` messages in real-time
- [ ] Multiple clients on the same channel all receive the same event
- [ ] `GET /v1/channels/:channel_name/events` returns recent event history
- [ ] `DELETE /v1/channels/:channel_name/events` clears all events
- [ ] Revoked channel returns 410 on ingest and WebSocket connect
- [ ] Events exceeding retention limits are cleaned up
- [ ] Body exceeding 1 MB returns 413
- [ ] Body exceeding 256 KB is marked `truncated: true`
- [ ] `@hookwire/sdk` package installs and connects
- [ ] SDK receives events via callback
- [ ] SDK auto-reconnects on disconnect
- [ ] `/docs` serves Redoc with full API documentation

---

## 15. File-by-File Implementation Plan

```
hookwire/
├── package.json                          # Edit: add workspaces
├── tsconfig.base.json                    # Create: shared TS config
│
├── packages/
│   ├── types/
│   │   ├── package.json                  # Create
│   │   ├── tsconfig.json                 # Create
│   │   └── src/
│   │       ├── index.ts                  # Create
│   │       ├── channel.ts                # Create
│   │       ├── event.ts                  # Create
│   │       ├── websocket.ts              # Create
│   │       └── api.ts                    # Create
│   │
│   ├── api/
│   │   ├── package.json                  # Create
│   │   ├── tsconfig.json                 # Create
│   │   ├── wrangler.jsonc                # Create (with DO + D1 bindings)
│   │   ├── vitest.config.ts              # Create (for testing)
│   │   └── src/
│   │       ├── index.ts                  # Create: worker entry
│   │       ├── app.ts                    # Create: Hono app factory
│   │       ├── channel-do.ts             # Create: DurableObject class
│   │       ├── routes/
│   │       │   ├── channels.ts           # Create: channel CRUD
│   │       │   ├── ingest.ts             # Create: webhook ingest
│   │       │   ├── events.ts             # Create: history + WebSocket
│   │       │   └── openapi.ts            # Create: Redoc + spec
│   │       ├── middleware/
│   │       │   ├── auth.ts               # Create: auth helpers
│   │       │   ├── rate-limit.ts         # Create: rate limiting
│   │       │   └── error.ts              # Create: error handler
│   │       ├── lib/
│   │       │   ├── idgen.ts              # Create: ID generation
│   │       │   ├── token.ts              # Create: token hash/verify
│   │       │   ├── summary.ts            # Create: event summary
│   │       │   ├── provider.ts           # Create: provider detection
│   │       │   └── openapi-spec.ts       # Create: OpenAPI spec builder
│   │       └── scripts/
│   │           └── generate-openapi.ts   # Create: CLI to dump spec
│   │
│   └── sdk/
│       ├── package.json                  # Create
│       ├── tsconfig.json                 # Create
│       └── src/
│           ├── index.ts                  # Create
│           ├── client.ts                 # Create
│           ├── websocket.ts              # Create
│           └── history.ts                # Create
│
├── src/                                  # DELETE (move to packages/api)
│   ├── index.tsx                         # Delete
│   ├── renderer.tsx                      # Delete
│   └── style.css                         # Delete
├── public/                               # DELETE (move to packages/api or remove for v0.1 API-only)
├── vite.config.ts                        # Delete (root-level, api has its own)
├── tsconfig.json                         # Edit → tsconfig.base.json
└── .gitignore                            # Edit: add workspace patterns
```

---

## Appendix A: Provider Hint Extraction

```ts
// packages/api/src/lib/provider.ts

export function extractProviderHint(headers: Record<string, string>, defaultHint?: string): string {
  if (headers['x-github-event']) return 'github';
  if (headers['stripe-signature']) return 'stripe';
  if (headers['x-linear-event']) return 'linear';
  if (headers['x-gitlab-event']) return 'gitlab';
  if (headers['svix-id']) return 'svix';
  return defaultHint ?? 'custom';
}

export function extractEventType(headers: Record<string, string>, provider: string): string | null {
  switch (provider) {
    case 'github': return headers['x-github-event'] ?? null;
    case 'gitlab': return headers['x-gitlab-event'] ?? null;
    case 'linear': return headers['x-linear-event'] ?? null;
    default: return null;
  }
}

export function extractDeliveryId(headers: Record<string, string>, provider: string): string | null {
  switch (provider) {
    case 'github': return headers['x-github-delivery'] ?? null;
    case 'gitlab': return headers['x-gitlab-event-uuid'] ?? null;
    case 'stripe': return headers['stripe-signature']?.split(',')[0]?.split('=')[1] ?? null;
    default: return null;
  }
}
```

## Appendix B: Event Summary Generation

```ts
// packages/api/src/lib/summary.ts

import type { EventSummary } from '@hookwire/types';

interface SummaryInput {
  providerHint: string;
  eventType: string | null;
  contentType: string | undefined;
  bodySize: number;
  method: string;
}

export function generateSummary(input: SummaryInput): EventSummary {
  const { providerHint, eventType, contentType, bodySize, method } = input;

  // Provider-specific summaries
  if (providerHint === 'github' && eventType) {
    return {
      title: `GitHub ${eventType}`,
      subtitle: formatSize(bodySize),
    };
  }

  if (providerHint === 'stripe') {
    return {
      title: 'Stripe event',
      subtitle: eventType ?? formatSize(bodySize),
    };
  }

  // Generic fallback
  const ct = contentType?.split(';')[0] ?? 'unknown';
  return {
    title: 'Incoming webhook',
    subtitle: `${method} · ${ct} · ${formatSize(bodySize)}`,
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

## Appendix C: Dependencies Summary

| Package | Purpose |
|---------|---------|
| `hono` | HTTP framework |
| `@hono/zod-openapi` | OpenAPI + Zod integration |
| `zod` | Schema validation |
| `wrangler` | Cloudflare Workers CLI |
| `@cloudflare/vite-plugin` | Vite integration for Workers |
| `typescript` | Type checking |

---

**End of spec.**
