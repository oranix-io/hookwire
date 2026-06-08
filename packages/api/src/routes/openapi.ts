import { OpenAPIHono, createRoute, z, extendZodWithOpenApi } from '@hono/zod-openapi';
import type { Context } from 'hono';

// Extend zod with .openapi() method (required for zod v4 + @hono/zod-openapi v1.x)
extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const RetentionSchema = z.object({
  max_events: z.number().int().min(1).max(1000).default(100).openapi({ example: 100, description: 'Maximum number of events to retain' }),
  ttl_hours: z.number().int().min(1).max(720).default(24).openapi({ example: 24, description: 'Time-to-live in hours before events expire' }),
});

const CreateChannelBody = z.object({
  display_name: z.string().optional().openapi({ example: 'GitHub Webhooks', description: 'Human-readable label' }),
  provider_hint: z.enum(['github', 'stripe', 'linear', 'custom']).optional().openapi({ example: 'github', description: 'Expected webhook provider type' }),
  retention: RetentionSchema.optional(),
}).openapi('CreateChannelRequest');

const ChannelResponse = z.object({
  ok: z.literal(true),
  channel_id: z.string().openapi({ example: 'chn_01JZ8K4N7M7R9Y6Z2T3P4Q5W6E', description: 'Internal channel ID' }),
  channel_name: z.string().openapi({ example: 'ch_8xq4m2p7n9v5k1r6', description: 'Public channel name used in URLs' }),
  display_name: z.string().nullable().optional(),
  provider_hint: z.string().nullable().optional(),
  webhook_url: z.string().openapi({ example: 'https://hooks.hookwire.dev/in/ch_8xq4m2p7n9v5k1r6' }),
  connect_url: z.string().openapi({ example: 'wss://api.hookwire.dev/v1/channels/ch_8xq4m2p7n9v5k1r6/connect' }),
  client_token: z.string().openapi({ description: 'Private token — shown only once at creation' }),
  ingest_secret: z.string().openapi({ description: 'Secret for provider signature verification' }),
  retention: RetentionSchema,
  created_at: z.string().openapi({ example: '2026-06-08T00:00:00.000Z' }),
}).openapi('CreateChannelResponse');

const ErrorResponse = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
}).openapi('ApiError');

const EventProviderSchema = z.object({
  hint: z.string().optional(),
  event_type: z.string().optional(),
  delivery_id: z.string().optional(),
});

const EventBodySchema = z.object({
  encoding: z.enum(['utf8', 'base64']),
  content_type: z.string().optional(),
  data: z.string(),
  size: z.number(),
  truncated: z.boolean(),
});

const EventSummarySchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
});

const ChannelEventSchema = z.object({
  id: z.string(),
  seq: z.number(),
  channel_name: z.string(),
  received_at: z.string(),
  method: z.string(),
  path: z.string(),
  query: z.record(z.string(), z.string()),
  headers: z.record(z.string(), z.string()),
  remote_addr: z.string().nullish(),
  user_agent: z.string().nullish(),
  provider: EventProviderSchema,
  body: EventBodySchema,
  summary: EventSummarySchema.nullish(),
}).openapi('ChannelEvent');

const EventsResponse = z.object({
  ok: z.literal(true),
  channel: z.string(),
  events: z.array(ChannelEventSchema),
}).openapi('EventsResponse');

const IngestResponse = z.object({
  ok: z.literal(true),
  channel: z.string(),
  event_id: z.string(),
  seq: z.number(),
}).openapi('IngestResponse');

const ChannelStatusResponse = z.object({
  ok: z.literal(true),
  channel_id: z.string(),
  channel_name: z.string(),
  display_name: z.string().nullable().optional(),
  provider_hint: z.string().nullable().optional(),
  status: z.enum(['active', 'revoked', 'expired', 'deleted']),
  retention: RetentionSchema,
  webhook_url: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  revoked_at: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
}).openapi('ChannelStatusResponse');

const RevokeResponse = z.object({
  ok: z.literal(true),
  channel: z.string(),
  status: z.literal('revoked'),
  revoked_at: z.string(),
}).openapi('RevokeChannelResponse');

const ClearEventsResponse = z.object({
  ok: z.literal(true),
  channel: z.string(),
  deleted_events: z.number(),
}).openapi('ClearEventsResponse');

// ---------------------------------------------------------------------------
// Route Definitions
// ---------------------------------------------------------------------------

export const createChannelRoute = createRoute({
  method: 'post',
  path: '/v1/channels',
  tags: ['Channels'],
  summary: 'Create a new channel',
  description: 'Generates a random webhook URL, client token, and ingest secret. The client_token is returned only once.',
  request: {
    body: {
      content: { 'application/json': { schema: CreateChannelBody } },
    },
  },
  responses: {
    201: {
      description: 'Channel created successfully',
      content: { 'application/json': { schema: ChannelResponse } },
    },
    400: {
      description: 'Invalid request body',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

export const getChannelRoute = createRoute({
  method: 'get',
  path: '/v1/channels/{channel_name}',
  tags: ['Channels'],
  summary: 'Get channel information',
  parameters: [
    { name: 'channel_name', in: 'path', required: true, schema: { type: 'string' }, description: 'Public channel name' },
  ],
  responses: {
    200: { description: 'Channel info', content: { 'application/json': { schema: ChannelStatusResponse } } },
    404: { description: 'Channel not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

export const patchChannelRoute = createRoute({
  method: 'patch',
  path: '/v1/channels/{channel_name}',
  tags: ['Channels'],
  summary: 'Update channel settings',
  parameters: [
    { name: 'channel_name', in: 'path', required: true, schema: { type: 'string' } },
  ],
  request: {
    body: {
      content: { 'application/json': { schema: CreateChannelBody.partial() } },
    },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: z.object({ ok: z.literal(true), channel: z.string() }) } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

export const revokeChannelRoute = createRoute({
  method: 'post',
  path: '/v1/channels/{channel_name}/revoke',
  tags: ['Channels'],
  summary: 'Revoke a channel',
  description: 'Revokes the channel, closes all WebSocket connections, and rejects future ingest requests with 410.',
  parameters: [
    { name: 'channel_name', in: 'path', required: true, schema: { type: 'string' } },
  ],
  responses: {
    200: { description: 'Revoked', content: { 'application/json': { schema: RevokeResponse } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

export const deleteChannelRoute = createRoute({
  method: 'delete',
  path: '/v1/channels/{channel_name}',
  tags: ['Channels'],
  summary: 'Delete a channel (soft delete)',
  parameters: [
    { name: 'channel_name', in: 'path', required: true, schema: { type: 'string' } },
  ],
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.literal(true), channel: z.string(), status: z.literal('deleted') }) } } },
    404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

export const ingestWebhookRoute = createRoute({
  method: 'post',
  path: '/in/{channel_name}',
  tags: ['Ingest'],
  summary: 'Ingest a webhook event',
  description: `Receives a webhook from an external service (GitHub, Stripe, etc.).
The request body can be any content type — it will be captured and broadcast to connected clients.

Rate limit: 60 requests per minute per channel.
Body limit: 1 MB hard limit, 256 KB soft limit (truncated above).`,
  parameters: [
    { name: 'channel_name', in: 'path', required: true, schema: { type: 'string' }, description: 'Public channel name (from webhook URL)' },
  ],
  responses: {
    202: { description: 'Webhook accepted', content: { 'application/json': { schema: IngestResponse } } },
    404: { description: 'Channel not found', content: { 'application/json': { schema: ErrorResponse } } },
    410: { description: 'Channel revoked or expired', content: { 'application/json': { schema: ErrorResponse } } },
    413: { description: 'Body too large (>1 MB)', content: { 'application/json': { schema: ErrorResponse } } },
    429: { description: 'Rate limited', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

export const getEventsRoute = createRoute({
  method: 'get',
  path: '/v1/channels/{channel_name}/events',
  tags: ['Events'],
  summary: 'Get event history',
  description: 'Returns recent webhook events for a channel. Requires client_token authentication.',
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'channel_name', in: 'path', required: true, schema: { type: 'string' } },
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50, maximum: 100 }, description: 'Max events to return' },
    { name: 'after_seq', in: 'query', required: false, schema: { type: 'integer' }, description: 'Return events with seq > this value' },
    { name: 'before_seq', in: 'query', required: false, schema: { type: 'integer' }, description: 'Return events with seq < this value' },
    { name: 'include_body', in: 'query', required: false, schema: { type: 'boolean', default: true }, description: 'Include event body in response' },
    { name: 'include_headers', in: 'query', required: false, schema: { type: 'boolean', default: true }, description: 'Include HTTP headers in response' },
  ],
  responses: {
    200: { description: 'Event list', content: { 'application/json': { schema: EventsResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Channel not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

export const clearEventsRoute = createRoute({
  method: 'delete',
  path: '/v1/channels/{channel_name}/events',
  tags: ['Events'],
  summary: 'Clear all events for a channel',
  description: 'Deletes all events in the channel. Does not reset the seq counter.',
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'channel_name', in: 'path', required: true, schema: { type: 'string' } },
  ],
  responses: {
    200: { description: 'Events cleared', content: { 'application/json': { schema: ClearEventsResponse } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

export const wsConnectRoute = createRoute({
  method: 'get',
  path: '/v1/channels/{channel_name}/connect',
  tags: ['Events'],
  summary: 'Connect via WebSocket',
  description: `Upgrades to a WebSocket connection for real-time event streaming.

On connection the server sends a \`hello\` message with channel info and feature flags.
Webhook events are broadcast as \`event\` messages in real-time.
Clients can send \`ping\` messages to keep the connection alive.`,
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'channel_name', in: 'path', required: true, schema: { type: 'string' } },
  ],
  responses: {
    101: { description: 'WebSocket upgrade successful' },
    401: { description: 'Invalid client token', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Channel not found', content: { 'application/json': { schema: ErrorResponse } } },
    410: { description: 'Channel revoked', content: { 'application/json': { schema: ErrorResponse } } },
    429: { description: 'Too many concurrent connections (>10)', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ---------------------------------------------------------------------------
// Create the OpenAPI app and register routes for documentation
// ---------------------------------------------------------------------------

export const openApiApp = new OpenAPIHono();

openApiApp.openapi(createChannelRoute, (c) => c.json({ ok: true } as any));
openApiApp.openapi(getChannelRoute, (c) => c.json({ ok: true } as any));
openApiApp.openapi(patchChannelRoute, (c) => c.json({ ok: true } as any));
openApiApp.openapi(revokeChannelRoute, (c) => c.json({ ok: true } as any));
openApiApp.openapi(deleteChannelRoute, (c) => c.json({ ok: true } as any));
openApiApp.openapi(ingestWebhookRoute, (c) => c.json({ ok: true } as any));
openApiApp.openapi(getEventsRoute, (c) => c.json({ ok: true } as any));
openApiApp.openapi(clearEventsRoute, (c) => c.json({ ok: true } as any));
openApiApp.openapi(wsConnectRoute, (c) => c.json({ ok: true } as any));

// Configure the document
openApiApp.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Hookwire API',
    version: '0.1.0',
    description: `Hookwire is a webhook relay service with real-time event streaming.

## How it works

1. **Create a channel** — generates a random webhook URL and client token.
2. **Configure your webhook provider** (GitHub, Stripe, etc.) to POST to your webhook URL.
3. **Connect via WebSocket or use the SDK** — receive events in real-time.
4. **Query history** — fetch past events using the REST API.

## Authentication

- **Channel ingest**: No auth required (channel name in URL).
- **Client operations**: \`Bearer <client_token>\` header.
- **Management operations**: \`Bearer <app_session_token>\` header.

## WebSocket Protocol

The WebSocket API uses a simple JSON message protocol:
- Server → Client: \`hello\`, \`event\`, \`error\`, \`pong\`, \`status\`
- Client → Server: \`ping\``,
    contact: { name: 'Hookwire', url: 'https://hookwire.dev' },
  },
  servers: [
    { url: 'https://api.hookwire.dev', description: 'Production' },
    { url: 'http://localhost:8787', description: 'Local development' },
  ],
  tags: [
    { name: 'Channels', description: 'Channel lifecycle — create, read, update, revoke, delete' },
    { name: 'Ingest', description: 'Webhook ingest endpoint — receives events from external services' },
    { name: 'Events', description: 'Event history query, clear events, and WebSocket real-time streaming' },
  ],
  security: [
    { bearerAuth: [] },
  ],
});

import { apiReference } from '@scalar/hono-api-reference';

// ---------------------------------------------------------------------------
// Scalar API Reference middleware — beautiful interactive API docs
// ---------------------------------------------------------------------------
export const scalarDocs = apiReference({
  spec: { url: '/docs/openapi.json' },
  theme: 'purple',
  pageTitle: 'Hookwire API v0.1',
  metaData: {
    title: 'Hookwire API v0.1',
    description: 'Webhook relay with real-time event streaming',
  },
});
