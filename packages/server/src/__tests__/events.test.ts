// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { createReq } from './setup.js';

describe('GET /ch/:name/events', () => {
  it('returns empty for new channel', async () => {
    const { req } = createReq();
    const res = await req('/ch/newch/events');
    expect((await res.json()).events).toEqual([]);
  });

  it('returns ingested events', async () => {
    const { req } = createReq();
    for (let i = 0; i < 3; i++) {
      await req('/ch/mych', { method: 'POST', body: JSON.stringify({ n: i }) });
    }
    const res = await req('/ch/mych/events');
    expect((await res.json()).events.length).toBe(3);
  });

  it('supports after_seq', async () => {
    const { req } = createReq();
    for (let i = 0; i < 5; i++) {
      await req('/ch/mych2', { method: 'POST', body: '{}' });
    }
    const res = await req('/ch/mych2/events?after_seq=2');
    expect((await res.json()).events.length).toBe(3);
  });

  it('after_seq pagination is gap-safe (ascending from cursor)', async () => {
    const { req } = createReq();
    for (let i = 0; i < 10; i++) {
      await req('/ch/drain', { method: 'POST', body: '{}' });
    }
    const res = await req('/ch/drain/events?after_seq=0&limit=3');
    const seqs = (await res.json()).events.map((e: any) => e.seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it('supports limit', async () => {
    const { req } = createReq();
    for (let i = 0; i < 10; i++) {
      await req('/ch/mych3', { method: 'POST', body: '{}' });
    }
    const res = await req('/ch/mych3/events?limit=3');
    expect((await res.json()).events.length).toBe(3);
  });

  it('returns 400 for non-numeric after_seq', async () => {
    const { req } = createReq();
    const res = await req('/ch/badseq/events?after_seq=abc');
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative after_seq', async () => {
    const { req } = createReq();
    expect((await req('/ch/negseq/events?after_seq=-1')).status).toBe(400);
  });

  it('returns 410 when after_seq precedes the retained window', async () => {
    const { req, doStub } = createReq();
    for (let i = 0; i < 3; i++) {
      await req('/ch/gapch', { method: 'POST', body: '{}' });
    }
    // Simulate retention eviction of seq 1–2
    doStub.store.events.splice(0, 2);
    const res = await req('/ch/gapch/events?after_seq=1');
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.min_seq).toBe(3);
  });

  it('does not 410 when there are no retained events', async () => {
    const { req } = createReq();
    const res = await req('/ch/emptych/events?after_seq=5');
    expect(res.status).toBe(200);
    expect((await res.json()).events).toEqual([]);
  });

  it('does not 410 when after_seq is inside the retained window', async () => {
    const { req } = createReq();
    for (let i = 0; i < 3; i++) {
      await req('/ch/okch', { method: 'POST', body: '{}' });
    }
    const res = await req('/ch/okch/events?after_seq=2');
    expect(res.status).toBe(200);
    expect((await res.json()).events.length).toBe(1);
  });
});

describe('DELETE /ch/:name/events auth', () => {
  it('returns 401 without x-hookwire-secret when INGEST_SECRET is set', async () => {
    const { req } = createReq({ INGEST_SECRET: 's3cret' });
    const res = await req('/ch/delauth/events', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong-length secret', async () => {
    const { req } = createReq({ INGEST_SECRET: 's3cret' });
    const res = await req('/ch/delauth2/events', {
      method: 'DELETE',
      headers: { 'x-hookwire-secret': 's3cret-but-longer' },
    });
    expect(res.status).toBe(401);
  });

  it('clears events with correct x-hookwire-secret', async () => {
    const { req } = createReq({ INGEST_SECRET: 's3cret' });
    await req('/ch/delok', { method: 'POST', headers: { 'x-hookwire-secret': 's3cret' }, body: '{}' });
    const res = await req('/ch/delok/events', {
      method: 'DELETE',
      headers: { 'x-hookwire-secret': 's3cret' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).deleted_events).toBe(1);
  });

  it('stays open when INGEST_SECRET is unset', async () => {
    const { req } = createReq();
    const res = await req('/ch/delopen/events', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });
});

describe('?since= validation', () => {
  it('GET /ch/:name/sse returns 400 for non-numeric since', async () => {
    const { req } = createReq();
    const res = await req('/ch/ssebad/sse?since=abc');
    expect(res.status).toBe(400);
  });

  it('GET /ch/:name/ws returns 400 for non-numeric since', async () => {
    const { req } = createReq();
    const res = await req('/ch/wsbad/ws?since=abc', { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(400);
  });
});

describe('lib/auth timingSafeEqual', () => {
  it('accepts equal strings, rejects different and different-length', async () => {
    const { timingSafeEqual } = await import('../lib/auth.js');
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abd', 'abc')).toBe(false);
    expect(timingSafeEqual('abcd', 'abc')).toBe(false);
    expect(timingSafeEqual(undefined, 'abc')).toBe(false);
  });
});

describe('lib/env envInt', () => {
  it('parses overrides and falls back on missing/invalid', async () => {
    const { envInt } = await import('../lib/env.js');
    expect(envInt({}, 'X', 10)).toBe(10);
    expect(envInt({ X: '500' }, 'X', 10)).toBe(500);
    expect(envInt({ X: 'nope' }, 'X', 10)).toBe(10);
    expect(envInt({ X: -3 }, 'X', 10)).toBe(10);
  });
});

describe('DELETE /ch/:name/events', () => {
  it('clears all events', async () => {
    const { req } = createReq();
    for (let i = 0; i < 3; i++) {
      await req('/ch/mych4', { method: 'POST', body: '{}' });
    }
    const del = await req('/ch/mych4/events', { method: 'DELETE' });
    expect((await del.json()).deleted_events).toBe(3);

    const after = await req('/ch/mych4/events');
    expect((await after.json()).events.length).toBe(0);
  });
});

describe('Streaming', () => {
  it('GET /ch/:name/sse returns text/event-stream', async () => {
    const { req } = createReq();
    const res = await req('/ch/sse-test/sse');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
  });
});

describe('Full E2E', () => {
  it('ingest → query → clear', async () => {
    const { req } = createReq();
    const name = 'e2e-' + Date.now();

    for (let i = 0; i < 5; i++) {
      const r = await req(`/ch/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Custom': 'hello' },
        body: JSON.stringify({ step: i }),
      });
      expect(r.status).toBe(202);
    }

    const hist = await req(`/ch/${name}/events`);
    const h = await hist.json();
    expect(h.events.length).toBe(5);
    expect(h.events[0].headers['x-custom']).toBe('hello');

    await req(`/ch/${name}/events`, { method: 'DELETE' });

    const after = await req(`/ch/${name}/events`);
    expect((await after.json()).events.length).toBe(0);
  });
});
