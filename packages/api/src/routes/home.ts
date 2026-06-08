import { Hono } from 'hono';
import { generateChannelName } from '../lib/idgen.js';

const home = new Hono();

home.get('/', (c) => {
  const randomName = generateChannelName();
  const hookUrl = `${new URL(c.req.url).origin}/ch/${randomName}`;

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hookwire — Instant Webhook Relay</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',-apple-system,sans-serif;background:#fff;color:#1a1a2e;min-height:100vh}
  .page{max-width:720px;margin:0 auto;padding:6rem 1.5rem 4rem;text-align:center}
  h1{font-size:clamp(2.2rem,5vw,3.5rem);font-weight:800;letter-spacing:-.03em;line-height:1.15;margin-bottom:.75rem;color:#0f0f23}
  h1 span{background:linear-gradient(135deg,#6366f1,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .sub{font-size:1.1rem;color:#64748b;line-height:1.7;margin-bottom:3rem}
  .box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:2rem;max-width:520px;margin:0 auto;box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .box-label{font-size:.75rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.75rem;text-align:left}
  .url-row{display:flex;gap:.5rem;margin-bottom:1.5rem}
  .url-row input{flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:.82rem;color:#334155;outline:none;transition:border-color .2s}
  .url-row input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
  .url-row button{background:#6366f1;color:#fff;border:none;padding:.7rem 1.2rem;border-radius:10px;font-size:.82rem;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s}
  .url-row button:hover{background:#4f46e5}
  .url-row button.sec{background:#fff;color:#6366f1;border:1px solid #e2e8f0}
  .url-row button.sec:hover{background:#f1f5f9}
  .hint{font-size:.8rem;color:#94a3b8;line-height:1.6}
  .hint code{color:#6366f1;font-family:'JetBrains Mono',monospace;font-size:.78rem;background:#ede9fe;padding:.1rem .35rem;border-radius:4px}
  .steps{margin-top:5rem;text-align:left;max-width:520px;margin-left:auto;margin-right:auto}
  .steps h2{font-size:1.15rem;font-weight:700;margin-bottom:1.5rem;color:#0f0f23}
  .step{display:flex;gap:1rem;margin-bottom:1.25rem}
  .step-num{width:30px;height:30px;border-radius:50%;background:#ede9fe;color:#6366f1;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.8rem;flex-shrink:0}
  .step p{font-size:.88rem;color:#475569;line-height:1.6}
  .step code{font-size:.78rem;color:#a855f7;font-family:'JetBrains Mono',monospace;background:#f3e8ff;padding:.1rem .35rem;border-radius:4px}
  .links{display:flex;gap:1.5rem;justify-content:center;margin-top:4rem}
  .links a{color:#94a3b8;text-decoration:none;font-size:.8rem;font-weight:500;transition:color .15s}
  .links a:hover{color:#6366f1}
  .tos{text-align:center;margin-top:2rem}
  .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-right:.4rem}
</style>
</head>
<body>
<div class="page">
  <h1>Webhooks, <span>streamed.</span></h1>
  <p class="sub">Instant webhook relay. One URL. No setup. No tokens.</p>

  <div class="box">
    <div class="box-label">Your webhook URL</div>
    <div class="url-row">
      <input id="urlInput" type="text" value="${hookUrl}" readonly />
      <button onclick="copyUrl()">Copy</button>
    </div>
    <div class="url-row">
      <button class="sec" onclick="newUrl()">🎲 New URL</button>
      <button onclick="go()">→ Open viewer</button>
    </div>
    <p class="hint">Paste this into <code>GitHub</code>, <code>Stripe</code>, or any webhook provider.<br />Open the viewer to see events in real-time.</p>
  </div>

  <div class="steps">
    <h2>How it works</h2>
    <div class="step"><span class="step-num">1</span><p>Copy your webhook URL.</p></div>
    <div class="step"><span class="step-num">2</span><p>Configure your provider (<code>GitHub</code>, <code>Stripe</code>, <code>Linear</code>…) to POST to it.</p></div>
    <div class="step"><span class="step-num">3</span><p>Open the viewer. Events arrive via WebSocket in real-time.</p></div>
    <div class="step"><span class="step-num">4</span><p>Or use <code>@hookwire/sdk</code> to receive events in your own code.</p></div>
  </div>

  <div class="links">
    <a href="/docs">API Docs</a>
    <a href="/sdk">SDK</a>
    <a href="/docs/openapi.json">OpenAPI Spec</a>
    <a href="/health">Status</a>
  </div>
  <div class="tos" style="font-size:.75rem;color:#cbd5e1"><span class="dot"></span> v0.1</div>
</div>
<script>
function copyUrl(){var i=document.getElementById('urlInput');navigator.clipboard.writeText(i.value).then(function(){var b=document.querySelector('button');b.textContent='Copied!';setTimeout(function(){b.textContent='Copy'},1500)})}
function newUrl(){var a='';for(var i=0;i<20;i++)a+='0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random()*36)];document.getElementById('urlInput').value=location.origin+'/ch/'+a}
function go(){location.href=document.getElementById('urlInput').value}
</script>
</body>
</html>`);
});

export { home };
