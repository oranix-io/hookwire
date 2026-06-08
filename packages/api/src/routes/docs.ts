import { OpenAPIHono, createRoute, z, extendZodWithOpenApi } from '@hono/zod-openapi';
import { apiReference } from '@scalar/hono-api-reference';

extendZodWithOpenApi(z);

// ── Schemas ───────────────────────────────────────────────

const EventSchema = z.object({
  id: z.string(),
  seq: z.number(),
  received_at: z.string(),
  method: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.object({
    encoding: z.enum(['utf8', 'base64']),
    content_type: z.string().nullish(),
    data: z.string(),
    size: z.number(),
    truncated: z.boolean(),
  }),
  summary: z.object({ title: z.string(), subtitle: z.string().nullish() }).nullish(),
}).openapi('ChannelEvent');

const ErrorSchema = z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }).openapi('ApiError');

// ── Route definitions ─────────────────────────────────────

const ingestRoute = createRoute({
  method: 'post',
  path: '/ch/{name}',
  tags: ['Ingest'],
  summary: 'Ingest a webhook',
  description: 'Receives a webhook from any external service. No auth required — the channel name is the only credential. Supports any content type.',
  parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' }, description: 'Your channel name' }],
  responses: {
    202: { description: 'Webhook accepted', content: { 'application/json': { schema: z.object({ ok: z.literal(true), event_id: z.string(), seq: z.number() }) } } },
    413: { description: 'Body too large', content: { 'application/json': { schema: ErrorSchema } } },
    429: { description: 'Rate limited', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const getEventsRoute = createRoute({
  method: 'get',
  path: '/ch/{name}/events',
  tags: ['Events'],
  summary: 'Get event history',
  parameters: [
    { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
    { name: 'after_seq', in: 'query', schema: { type: 'integer' } },
    { name: 'include_body', in: 'query', schema: { type: 'boolean', default: true } },
  ],
  responses: {
    200: { description: 'Events', content: { 'application/json': { schema: z.object({ ok: z.literal(true), channel: z.string(), events: z.array(EventSchema) }) } } },
  },
});

const clearEventsRoute = createRoute({
  method: 'delete',
  path: '/ch/{name}/events',
  tags: ['Events'],
  summary: 'Clear all events',
  parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
  responses: { 200: { description: 'Cleared' } },
});

const wsConnectRoute = createRoute({
  method: 'get',
  path: '/ch/{name}/ws',
  tags: ['Events'],
  summary: 'WebSocket connection',
  description: 'Upgrade to WebSocket for real-time event streaming. Server sends `hello`, `event`, `pong` messages.',
  parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
  responses: { 101: { description: 'WebSocket upgrade' }, 429: { description: 'Too many connections' } },
});

const sseRoute = createRoute({
  method: 'get',
  path: '/ch/{name}/sse',
  tags: ['Events'],
  summary: 'Server-Sent Events',
  description: 'Stream events via SSE. Internally bridges to the ChannelDO WebSocket for real-time push. Use `EventSource` in the browser to connect.',
  parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
  responses: { 200: { description: 'SSE stream (text/event-stream)' } },
});

// ── OpenAPI app ───────────────────────────────────────────

export const openApiApp = new OpenAPIHono();

openApiApp.openapi(ingestRoute, (c) => c.json({ ok: true } as any));
openApiApp.openapi(getEventsRoute, (c) => c.json({ ok: true } as any));
openApiApp.openapi(clearEventsRoute, (c) => c.json({ ok: true } as any));
openApiApp.openapi(wsConnectRoute, (c) => c.json({ ok: true } as any));
openApiApp.openapi(sseRoute, (c) => c.json({ ok: true } as any));

openApiApp.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Hookwire API',
    version: '0.1.0',
    description: `Hookwire is a webhook relay — like smee.io but built on Cloudflare Workers.

## How it works

1. **Get a channel URL** — visit the homepage or pick any random string.
2. **Paste it into your provider** — GitHub, Stripe, Linear, or any webhook sender.
3. **Watch events in real-time** — open the viewer page or connect via WebSocket.

No API keys, no tokens, no setup. The URL is the only credential.`,
    contact: { name: 'Hookwire', url: 'https://hookwire.dev' },
  },
  servers: [
    { url: 'https://hookwire.dev', description: 'Production' },
    { url: 'http://localhost:8787', description: 'Local' },
  ],
  tags: [
    { name: 'Ingest', description: 'Webhook receive endpoint' },
    { name: 'Events', description: 'History + WebSocket' },
  ],
});

// ── Scalar UI ─────────────────────────────────────────────

export const scalarDocs = apiReference({
  spec: { url: '/docs/openapi.json' },
  theme: 'purple',
  pageTitle: 'Hookwire API',
});
