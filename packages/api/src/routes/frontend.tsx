import { Hono } from 'hono';
import { renderer } from '../renderer.js';

const frontend = new Hono();

frontend.use(renderer);

frontend.get('/', (c) => {
  return c.render(
    <div class="hero">
      <h1>Hookwire</h1>
      <p>
        Real-time webhook relay. Create a channel, get a webhook URL,
        and stream events to your app, SDK, or dashboard — instantly.
      </p>
      <div class="links">
        <a href="/docs">📖 API Docs</a>
        <a href="/health">⚡ Health Check</a>
      </div>
      <div class="status">
        <span class="status-dot"></span>
        API v0.1 — Running
      </div>
    </div>
  );
});

export { frontend };
