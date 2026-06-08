import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { channelRoutes } from './routes/channels.js';
import { ingestRoute } from './routes/ingest.js';
import { eventRoutes } from './routes/events.js';
import { openApiApp, redocHtml } from './routes/openapi.js';
import { frontend } from './routes/frontend.jsx';
import { errorHandler } from './middleware/error.js';
import { ChannelDO } from './channel-do.js';

type Bindings = {
  DB: D1Database;
  CHANNEL_DO: DurableObjectNamespace;
};

// ---------------------------------------------------------------------------
// App factory — exported for testing
// ---------------------------------------------------------------------------
export function createApp(): Hono<{ Bindings: Bindings }> {
  const app = new Hono<{ Bindings: Bindings }>();

  // Global middleware
  app.use('*', cors());
  app.use('*', errorHandler);

  // Health check
  app.get('/health', (c) => {
    return c.json({ ok: true, service: 'hookwire-api', version: '0.1.0' });
  });

  // OpenAPI — mount the OpenAPIHono app for /docs
  app.route('/docs', openApiApp);

  // Redoc HTML at /docs
  app.get('/docs', (c) => c.html(redocHtml()));

  // API route groups
  app.route('/v1/channels', channelRoutes);
  app.route('/in', ingestRoute);
  app.route('/v1/channels', eventRoutes);

  // React SSR frontend at /
  app.route('/', frontend);

  return app;
}

// ---------------------------------------------------------------------------
// Worker entry point (default export)
// ---------------------------------------------------------------------------
export default createApp();

// ---------------------------------------------------------------------------
// Durable Object binding
// ---------------------------------------------------------------------------
export { ChannelDO };
