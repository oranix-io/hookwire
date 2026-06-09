# Hookwire

**Instant webhook relay. One URL. No setup. No tokens.**

Like [smee.io](https://smee.io), but built on Cloudflare Workers + Durable Objects. Every channel is a random URL — paste it into GitHub, Stripe, or any webhook provider, and watch events stream in real-time via WebSocket or SSE.

```
https://hookwire.dev/ch/abc123def456
         ─────────────────────────────
         Your webhook URL. That's it.
```

---

## How it works

1. Visit [hookwire.dev](https://hookwire.dev) — you get a random channel URL.
2. Paste it into your provider's webhook settings.
3. Open the viewer — events stream in via WebSocket, instantly.
4. Or use `@hookwire/sdk` to receive events in your own app.

No API key. No signup. No channel creation. **The URL is the only credential.**

---

## Architecture

```
GitHub / Stripe / …
        │
        ▼ POST /ch/:name
┌───────────────────┐
│  Cloudflare Worker │  ← Hono (routing, rate limit)
└──────┬────────────┘
       │ stub.fetch()
       ▼
┌───────────────────┐
│  ChannelDO         │  ← Durable Object (one per channel)
│  • SQLite events   │
│  • WebSocket hub   │
│  • Seq manager     │
│  • Retention (100) │
└───────────────────┘
       │
       ▼
  WebSocket / SSE → connected clients
```

- **Worker**: Hono-based HTTP router, forwards requests to DO via `stub.fetch()`
- **ChannelDO**: One Durable Object per channel. Internal Hono app handles ingest, event history, WebSocket upgrades, SSE bridging
- **No D1, no external DB**: Channel metadata lives in the DO itself
- **Edge-native**: Runs on Cloudflare Workers, sub-10ms cold starts

---

## Real-time protocols

Hookwire supports both **WebSocket** and **Server-Sent Events (SSE)**.

| Protocol | Endpoint | Direction | Best for |
|----------|----------|-----------|----------|
| WebSocket | `/ch/:name/ws` | Bidirectional | Low latency, custom clients |
| SSE | `/ch/:name/sse` | Server → Client | Browsers, `EventSource` API |

Both receive the same event payload.

### Replay

Both protocols support `?since=` for replaying missed events:

```
/ch/:name/ws?since=0   → full replay + real-time
/ch/:name/ws?since=42  → replay from seq 42 + real-time
```

- Server sends history events first, then switches to real-time.
- SDK automatically appends `?since=` on reconnect — no missed events.
- Retention: 100 events / 24 hours. Events outside this window are lost.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ch/:name` | `ANY` | Ingest webhook (auto-creates channel) |
| `/ch/:name` | `GET` | HTML viewer (real-time WebSocket events) |
| `/ch/:name/events` | `GET` | Event history (`?limit=50&after_seq=10`) |
| `/ch/:name/events` | `DELETE` | Clear all events |
| `/ch/:name/ws` | `GET` | WebSocket upgrade |
| `/ch/:name/sse` | `GET` | Server-Sent Events (`?since=<seq>`) |
| `/` | `GET` | Home page (generate random channel) |

Full API docs at `/docs` (Scalar UI).

---

## SDK

```bash
npm install @hookwire/sdk
```

```ts
import { HookwireClient } from '@hookwire/sdk';

const client = new HookwireClient({
  channelName: 'abc123def456',
  baseUrl: 'https://hookwire.dev',
});

client.onEvent(event => {
  console.log(`#${event.seq}`, event.body.data);
});

await client.connect();
```

Auto-reconnect with exponential backoff, server-side replay via `?since=`. [Docs →](/sdk)

Or use plain SSE — no SDK needed:

```js
const es = new EventSource('https://hookwire.dev/ch/abc123/sse');
es.onmessage = e => console.log(JSON.parse(e.data));
```

WebSocket is also available directly:

```js
const ws = new WebSocket('wss://hookwire.dev/ch/abc123/ws');
ws.onmessage = e => {
  const data = JSON.parse(e.data);
  if (data.type === 'event') console.log('#' + data.seq, data.body.data);
};
```

---

## Development

```bash
git clone https://github.com/hookwire/hookwire
cd hookwire

# Install
npm install

# Dev server (wrangler)
npm run dev -w @hookwire/api

# Run tests
npm test -w @hookwire/api

# Type check all packages
npm run typecheck
```

### Monorepo

```
packages/
├── types/    @hookwire/types    Shared TypeScript types
├── api/      @hookwire/api      Cloudflare Worker + DO
└── sdk/      @hookwire/sdk      Browser / Node.js client
```

### Fire test webhooks

```bash
# Continuous, every 2 seconds
./scripts/fire.sh my-channel

# 10 requests, 0.5s interval
./scripts/fire.sh my-channel 0.5 10
```

---

## Limits

| Limit | Value |
|-------|-------|
| Ingest rate | 60 req/min per channel |
| Body size (hard) | 1 MB |
| Body size (soft, truncates) | 256 KB |
| Concurrent WS clients | 10 per channel |
| Event retention | 100 events / 24 hours |

---

## License

MIT
