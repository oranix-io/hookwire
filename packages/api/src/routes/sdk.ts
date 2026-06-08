import { Hono } from 'hono';

const sdk = new Hono();

sdk.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hookwire SDK — Documentation</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',-apple-system,sans-serif;background:#fff;color:#1a1a2e;min-height:100vh}
  .wrap{max-width:800px;margin:0 auto;padding:3rem 1.5rem}
  .top{margin-bottom:2rem}
  .top a{color:#6366f1;text-decoration:none;font-size:.85rem;font-weight:500}
  h1{font-size:2rem;font-weight:800;margin-bottom:.5rem}
  .sub{color:#64748b;margin-bottom:2rem}
  h2{font-size:1.2rem;font-weight:700;margin:2rem 0 1rem;padding-top:1rem;border-top:1px solid #e2e8f0}
  h3{font-size:1rem;font-weight:600;margin:1.5rem 0 .5rem}
  p{color:#475569;line-height:1.7;margin-bottom:1rem}
  code{font-family:'JetBrains Mono',monospace;font-size:.82rem;background:#f1f5f9;padding:.15rem .4rem;border-radius:4px;color:#6366f1}
  pre{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:1.25rem;overflow-x:auto;margin-bottom:1.5rem;font-family:'JetBrains Mono',monospace;font-size:.8rem;line-height:1.7;color:#334155}
  pre .kw{color:#a855f7}
  pre .str{color:#22c55e}
  pre .cmt{color:#94a3b8}
  pre .fn{color:#6366f1}
  table{width:100%;border-collapse:collapse;margin-bottom:1.5rem}
  th,td{text-align:left;padding:.6rem .8rem;border-bottom:1px solid #e2e8f0;font-size:.85rem}
  th{font-weight:600;color:#475569;background:#f8fafc}
  td{color:#64748b}
  td code{font-size:.78rem}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><a href="/">← Hookwire</a> <span style="color:#cbd5e1">/</span> SDK</div>
  <h1>@hookwire/sdk</h1>
  <p class="sub">TypeScript SDK for browser and Node.js. Connect, listen, react — zero boilerplate.</p>

  <h2>Install</h2>
  <pre><span class="kw">npm</span> install @hookwire/sdk</pre>

  <h2>Quick start</h2>
  <pre><span class="kw">import</span> { <span class="fn">HookwireClient</span> } <span class="kw">from</span> <span class="str">'@hookwire/sdk'</span>;

<span class="kw">const</span> client = <span class="kw">new</span> <span class="fn">HookwireClient</span>({
  <span class="cmt">// Your channel name (the random string)</span>
  channelName: <span class="str">'abc123def456'</span>,
  <span class="cmt">// Optional — defaults to https://hookwire.dev</span>
  baseUrl: <span class="str">'http://localhost:8787'</span>,
});

<span class="cmt">// Subscribe to real-time events</span>
client.<span class="fn">onEvent</span>(<span class="kw">event</span> => {
  console.<span class="fn">log</span>(<span class="str">'New event #'</span>, <span class="kw">event</span>.seq);
  console.<span class="fn">log</span>(<span class="kw">event</span>.body.data);
});

<span class="cmt">// Connect (fetches history, then opens WebSocket)</span>
<span class="kw">await</span> client.<span class="fn">connect</span>();

<span class="cmt">// Later…</span>
client.<span class="fn">disconnect</span>();</pre>

  <h2>Constructor options</h2>
  <table>
    <tr><th>Option</th><th>Type</th><th>Default</th><th>Description</th></tr>
    <tr><td><code>channelName</code></td><td>string</td><td>—</td><td>Your channel name (required)</td></tr>
    <tr><td><code>baseUrl</code></td><td>string</td><td><code>https://hookwire.dev</code></td><td>API base URL</td></tr>
    <tr><td><code>autoReconnect</code></td><td>boolean</td><td><code>true</code></td><td>Reconnect on disconnect</td></tr>
    <tr><td><code>reconnectDelay</code></td><td>number</td><td><code>1000</code></td><td>Initial delay in ms (exponential backoff)</td></tr>
  </table>

  <h2>Methods</h2>
  <table>
    <tr><th>Method</th><th>Returns</th><th>Description</th></tr>
    <tr><td><code>connect()</code></td><td>Promise&lt;void&gt;</td><td>Fetch history + open WebSocket</td></tr>
    <tr><td><code>disconnect()</code></td><td>void</td><td>Close WebSocket, stop reconnect</td></tr>
    <tr><td><code>onEvent(handler)</code></td><td>() =&gt; void</td><td>Subscribe to events. Returns unsubscribe fn.</td></tr>
    <tr><td><code>getHistory({ limit, afterSeq })</code></td><td>Promise&lt;ChannelEvent[]&gt;</td><td>Fetch event history</td></tr>
  </table>

  <h2>ChannelEvent shape</h2>
  <pre><span class="kw">interface</span> ChannelEvent {
  id: <span class="kw">string</span>;          <span class="cmt">// evt_xxx</span>
  seq: <span class="kw">number</span>;         <span class="cmt">// Monotonically increasing</span>
  received_at: <span class="kw">string</span>;  <span class="cmt">// ISO timestamp</span>
  method: <span class="kw">string</span>;       <span class="cmt">// HTTP method</span>
  headers: Record&lt;<span class="kw">string</span>, <span class="kw">string</span>&gt;;
  body: {
    encoding: <span class="str">'utf8'</span> | <span class="str">'base64'</span>;
    content_type?: <span class="kw">string</span>;
    data: <span class="kw">string</span>;
    size: <span class="kw">number</span>;
    truncated: <span class="kw">boolean</span>;
  };
  summary?: { title: <span class="kw">string</span>; subtitle?: <span class="kw">string</span> };
}</pre>

  <h2>Server-Sent Events (alternative)</h2>
  <p>If you prefer SSE over WebSocket, use the standard <code>EventSource</code> API — no SDK needed:</p>
  <pre><span class="kw">const</span> es = <span class="kw">new</span> <span class="fn">EventSource</span>(<span class="str">'https://hookwire.dev/ch/abc123/sse'</span>);

es.<span class="fn">onmessage</span> = (<span class="kw">event</span>) => {
  <span class="kw">const</span> data = JSON.<span class="fn">parse</span>(<span class="kw">event</span>.data);
  console.<span class="fn">log</span>(<span class="str">'SSE event #'</span>, data.seq);
};</pre>

  <p style="margin-top:3rem;font-size:.8rem;color:#94a3b8">
    <a href="/docs" style="color:#6366f1">API Docs</a> ·
    <a href="/" style="color:#6366f1">Home</a> ·
    <a href="https://github.com/oranix-io/hookwire" style="color:#6366f1">GitHub</a>
  </p>
</div>
</body>
</html>`);
});

export { sdk as sdkPage };
