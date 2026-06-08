import type { Context, Next } from 'hono';

/**
 * Global error handler middleware.
 * Catches unhandled errors and returns a consistent JSON error response.
 */
export async function errorHandler(c: Context, next: Next): Promise<Response | void> {
  try {
    return await next();
  } catch (err) {
    console.error('[hookwire-api] Unhandled error:', err);
    return c.json(
      {
        ok: false,
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred',
        },
      },
      500,
    );
  }
}
