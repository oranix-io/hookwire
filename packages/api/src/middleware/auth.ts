import type { Context, MiddlewareHandler } from 'hono';
import { verifyToken } from '../lib/token.js';

/**
 * Authenticate a client_token from Authorization: Bearer header.
 * Looks up the channel in D1 and verifies the hash.
 * Sets channel row on context for downstream use.
 */
export const clientTokenAuth: MiddlewareHandler<{
  Bindings: { DB: D1Database };
  Variables: { channel: Record<string, unknown> };
}> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      { ok: false, error: { code: 'unauthorized', message: 'Missing or invalid Authorization header' } },
      401,
    );
  }

  const token = authHeader.slice(7);
  const channelName = c.req.param('channel_name');

  if (!channelName) {
    return c.json(
      { ok: false, error: { code: 'bad_request', message: 'Missing channel_name' } },
      400,
    );
  }

  const row = await c.env.DB
    .prepare('SELECT * FROM channels WHERE channel_name = ? AND deleted_at IS NULL')
    .bind(channelName)
    .first();

  if (!row) {
    return c.json(
      { ok: false, error: { code: 'not_found', message: 'Channel not found' } },
      404,
    );
  }

  const valid = await verifyToken(token, row.client_token_hash as string);
  if (!valid) {
    return c.json(
      { ok: false, error: { code: 'unauthorized', message: 'Invalid client token' } },
      401,
    );
  }

  c.set('channel', row as Record<string, unknown>);
  return next();
};
