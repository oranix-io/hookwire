import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ingestRoute, eventRoutes, ChannelDO } from '@hookwire/server';
import { channelPage } from './routes/channel.js';
import { home } from './routes/home.js';
import { sdkPage } from './routes/sdk.js';
import { openApiApp, scalarDocs } from './routes/docs.js';
import { errorHandler } from './middleware/error.js';

type Bindings = { CHANNEL_DO: DurableObjectNamespace };

export function createApp(): Hono<{ Bindings: Bindings }> {
  const app = new Hono<{ Bindings: Bindings }>();

  app.use('*', cors());
  app.use('*', errorHandler);

  app.get('/health', (c) => c.json({ ok: true, service: 'hookwire-api', version: '0.1.0' }));

  // API docs
  app.route('/docs', openApiApp);
  app.get('/docs', scalarDocs);

  // Core routes — order matters: specific GET routes before catch-all ingest
  app.route('/ch', eventRoutes);      // GET/DELETE /ch/:name/events, /ch/:name/ws
  app.route('/ch', channelPage);      // GET /ch/:name   (HTML viewer)
  app.route('/ch', ingestRoute);      // ANY /ch/:name   (fallback: webhook ingest)

  // Pages
  app.route('/', home);
  app.route('/sdk', sdkPage);               // GET /

  return app;
}

export default createApp();
export { ChannelDO };
