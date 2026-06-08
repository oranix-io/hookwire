import { jsxRenderer } from 'hono/jsx-renderer';
import { Link, ViteClient } from 'vite-ssr-components/hono';

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Hookwire — Webhook Relay</title>
        <ViteClient />
        <Link href="/src/style.css" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
});
