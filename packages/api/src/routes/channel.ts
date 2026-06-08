import { Hono } from 'hono';

const channelPage = new Hono();

channelPage.get('/:name', (c) => {
  const name = c.req.param('name');
  const hookUrl = `${new URL(c.req.url).origin}/ch/${name}`;
  const wsUrl   = `${new URL(c.req.url).origin.replace('http', 'ws')}/ch/${name}/ws`;
  const sseUrl  = `${new URL(c.req.url).origin}/ch/${name}/sse`;

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hookwire — ${name}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',-apple-system,sans-serif;background:#fff;color:#1a1a2e;min-height:100vh}
  .wrap{max-width:800px;margin:0 auto;padding:2rem 1.5rem}
  .top{display:flex;align-items:center;gap:.5rem;margin-bottom:1.5rem}
  .top a{color:#6366f1;text-decoration:none;font-size:.85rem;font-weight:500}
  .top a:hover{color:#4f46e5}
  .top .sep{color:#cbd5e1}
  .top .name{font-family:'JetBrains Mono',monospace;font-size:.85rem;color:#6366f1;font-weight:500}
  .url-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:1rem 1.25rem;margin-bottom:1.5rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}
  .url-box code{font-family:'JetBrains Mono',monospace;font-size:.82rem;color:#475569;word-break:break-all;flex:1}
  .url-box button{background:#6366f1;color:#fff;border:none;padding:.45rem 1rem;border-radius:8px;font-size:.78rem;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .15s}
  .url-box button:hover{background:#4f46e5}
  .url-box button.sec{background:#fff;color:#6366f1;border:1px solid #e2e8f0}
  .url-box button.sec:hover{background:#f1f5f9}
  .status{display:flex;align-items:center;gap:.5rem;margin-bottom:1.5rem;font-size:.82rem;color:#94a3b8}
  .dot{width:7px;height:7px;border-radius:50%;display:inline-block}
  .dot.on{background:#22c55e}
  .dot.off{background:#ef4444}
  .event{border:1px solid #e2e8f0;border-radius:10px;margin-bottom:.75rem;overflow:hidden}
  .event-head{display:flex;justify-content:space-between;align-items:center;padding:.6rem 1rem;background:#f8fafc;border-bottom:1px solid #e2e8f0}
  .event-head .meta{font-size:.78rem;color:#94a3b8}
  .event-head .seq{font-size:.72rem;color:#cbd5e1;font-family:'JetBrains Mono',monospace}
  .event-body{padding:1rem;font-family:'JetBrains Mono',monospace;font-size:.76rem;line-height:1.6;color:#475569;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto;background:#fff}
  .empty{text-align:center;padding:4rem 1rem;color:#94a3b8}
  .empty .icon{font-size:2rem;margin-bottom:.75rem}
  .empty p{font-size:.95rem;margin-bottom:.3rem}
  .empty code{color:#6366f1;font-family:'JetBrains Mono',monospace;font-size:.82rem}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <a href="/">← Hookwire</a>
    <span class="sep">/</span>
    <span class="name">${name}</span>
  </div>

  <div class="url-box">
    <code>${hookUrl}</code>
    <button onclick="copyUrl()">Copy</button>
    <button class="sec" onclick="copySse()">SSE</button>
  </div>

  <div class="status">
    <span class="dot" id="dot"></span>
    <span id="status">Connecting…</span>
    <span style="margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:.78rem" id="cnt"></span>
  </div>

  <div id="events"></div>

  <div style="text-align:center;margin-top:3rem;padding-top:1.5rem;border-top:1px solid #e2e8f0;font-size:.78rem;color:#94a3b8">
    <a href="/" style="color:#94a3b8;text-decoration:none">Hookwire</a> ·
    <a href="https://github.com/oranix-io/hookwire" style="color:#94a3b8;text-decoration:none">GitHub</a>
  </div>
</div>

<script>
var NAME='${name}';
var WS_URL='${wsUrl}';
var SSE_URL='${sseUrl}';
var events=[];
var el=document.getElementById('events');
var dot=document.getElementById('dot');
var st=document.getElementById('status');
var cnt=document.getElementById('cnt');

function render(){
  if(!events.length){el.innerHTML='<div class=empty><div class=icon>📨</div><p>Waiting for webhooks…</p><p>POST to <code>'+NAME+'</code></p></div>';return}
  el.innerHTML=events.slice().reverse().map(function(e){return'<div class=event><div class=event-head><span class=meta>'+e.method+' · '+new Date(e.received_at).toLocaleTimeString()+'</span><span class=seq>#'+e.seq+'</span></div><div class=event-body>'+esc(e.body.data).slice(0,4000)+(e.body.size>4000?'\\n…truncated':'')+'</div></div>'}).join('')
}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function copyUrl(){navigator.clipboard.writeText('${hookUrl}');var b=document.querySelector('button');b.textContent='Copied!';setTimeout(function(){b.textContent='Copy'},1500)}
function copySse(){navigator.clipboard.writeText(SSE_URL);var b=document.querySelector('button.sec');b.textContent='Copied!';setTimeout(function(){b.textContent='SSE'},1500)}

// WebSocket
var ws=new WebSocket(WS_URL);
ws.onopen=function(){dot.className='dot on';st.textContent='Live'}
ws.onclose=function(){dot.className='dot off';st.textContent='Disconnected'}
ws.onmessage=function(msg){
  try{var d=JSON.parse(msg.data);if(d.type==='event'){events.push(d);cnt.textContent=events.length+' events';render()}}catch(e){}
}

// History
fetch('/ch/'+NAME+'/events?limit=20').then(function(r){return r.json()}).then(function(d){
  if(d.events){events=d.events;cnt.textContent=events.length+' events'}render()
}).catch(function(){render()})
</script>
</body>
</html>`);
});

export { channelPage };
