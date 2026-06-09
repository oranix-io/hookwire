# AGENTS.md — Hookwire Project Conventions

## Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<scope>): <short summary>

<optional body>
```

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Build, CI, scripts, dependencies |
| `style` | Formatting, whitespace (no logic change) |

### Scopes

| Scope | Applies to |
|-------|-----------|
| `api` | `@hookwire/api` Worker + routes |
| `sdk` | `@hookwire/sdk` client library |
| `types` | `@hookwire/types` shared types |
| `do` | ChannelDO Durable Object |
| `sse` | Server-Sent Events endpoint |
| `ws` | WebSocket endpoint |
| `ui` | HTML pages (home, viewer, SDK docs) |
| `docs` | API docs / Scalar / OpenAPI |
| `deps` | Dependency changes |
| `ci` | CI/CD configuration |

### Examples

```
feat(api): add SSE endpoint with 1s polling and keepalive
fix(do): use toArray() instead of nonexistent first() on SQLite cursor
refactor(do): replace RPC with fetch() handler + internal Hono routing
test(sdk): add client connect, disconnect, and event handler tests
chore(sdk): switch build to rslib with publishConfig for dev/prod paths
docs(readme): add WebSocket and SSE protocol comparison table
```

---

## Monorepo Structure

```
hookwire/
├── packages/
│   ├── types/    @hookwire/types    Shared TypeScript types
│   ├── api/      @hookwire/api      Cloudflare Worker + ChannelDO
│   └── sdk/      @hookwire/sdk      Browser / Node.js client
├── scripts/      fire.sh etc.
└── SPEC.md       Original channel design spec (now outdated)
```

## Package Conventions

### Development vs Publishing

- **Development**: `main` points to `./src/index.ts` (workspace resolves TypeScript directly)
- **Published**: `publishConfig.main` points to `./dist/index.js` (rslib output)

### Build

```bash
npm run build -w @hookwire/types
npm run build -w @hookwire/sdk
```

### Publish

```bash
npm run publish:types   # build + publish @hookwire/types
npm run publish:sdk     # build + publish @hookwire/sdk
npm run publish:all     # both
```

---

## API Design Principles

1. **URL is the channel** — no create API, no tokens, no signup. Just a random string.
2. **DO is the service** — one channel = one Durable Object, internal Hono routing.
3. **Worker is a proxy** — Worker only uses `stub.fetch()` to forward to DO. No business logic.
4. **No external DB** — no D1, no R2. Channel metadata lives inside the DO.

---

## Deployment

```bash
# Production deploy
npm run deploy

# Preview version (upload without promoting)
npm run deploy:version
# Then promote via Cloudflare Dashboard → Workers → hookwire-api → Versions
```

### Known: WebSocket disconnect on deploy

Every `wrangler deploy` restarts all Durable Objects, dropping active WebSocket
connections. Mitigations:

1. **Use gradual rollouts** — `wrangler versions upload` + promote via Dashboard
   to minimize simultaneous disconnects.
2. **Client SDK auto-reconnects** — `HookwireClient` has exponential backoff
   reconnect built in.
3. **Future**: Durable Object hibernation with WS attachment serialization
   can preserve connections across code updates (not yet implemented).

---

## Testing

```bash
npm test -w @hookwire/api     # API e2e (vitest + app.request + mock DO stub)
npm test -w @hookwire/sdk     # SDK unit (vitest + vi.fn for WebSocket/fetch)
```

- API tests use `app.request()` with mock DO stubs implementing `fetch()`.
- SDK tests use `vi.fn()` mocks for `WebSocket` and `fetch`.
- No real network or Cloudflare runtime in tests.
