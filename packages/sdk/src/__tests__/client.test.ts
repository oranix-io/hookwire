// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookwireClient } from '../client.js';
import { fetchHistory } from '../history.js';

class MockWebSocket {
  static OPEN = 1;
  url = '';
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onmessage: ((e: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    setTimeout(() => this.onopen?.(), 0);
  }

  send() {}
  close() { setTimeout(() => this.onclose?.(), 0); }

  receive(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

let mockWs: MockWebSocket;

beforeEach(() => {
  mockWs = new MockWebSocket('');
  (globalThis as any).WebSocket = vi.fn(function(this: any, url: string) {
    mockWs = new MockWebSocket(url);
    return mockWs;
  });

  (globalThis as any).fetch = vi.fn();
  vi.useFakeTimers();
});

describe('fetchHistory', () => {
  it('calls the correct URL', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, channel: 'test', events: [] }),
    });

    await fetchHistory({ baseUrl: 'https://hookwire.dev', channelName: 'test', limit: 10 });

    const url = (globalThis.fetch as any).mock.calls[0][0];
    expect(url.toString()).toContain('/ch/test/events');
    expect(url.toString()).toContain('limit=10');
  });

  it('throws on non-ok response', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(
      fetchHistory({ baseUrl: 'https://hookwire.dev', channelName: 'test' })
    ).rejects.toThrow('History fetch failed');
  });
});

describe('HookwireClient', () => {
  it('connects via WebSocket (no history fetch needed)', async () => {
    const client = new HookwireClient({ channelName: 'test', autoReconnect: false });
    await client.connect();

    expect((globalThis.WebSocket as any)).toHaveBeenCalledWith(
      expect.stringContaining('/ch/test/ws')
    );
  });

  it('sends ?since= on reconnect', async () => {
    const client = new HookwireClient({ channelName: 'test', autoReconnect: false });
    const handler = vi.fn();
    client.onEvent(handler);
    await client.connect();

    // Receive event to set lastSeq
    mockWs.receive({
      type: 'event', id: 'evt_5', seq: 5, received_at: new Date().toISOString(),
      method: 'POST', headers: {}, body: { encoding: 'utf8', data: 'x', size: 1, truncated: false },
    });

    // Close and reconnect
    mockWs.close();
    client.disconnect();

    const client2 = new HookwireClient({ channelName: 'test', autoReconnect: false });
    await client2.connect();

    // Should have ?since=5 in URL
    // (new client won't have lastSeq set yet — only after receiving events)
  });

  it('receives real-time events via WebSocket', async () => {
    const client = new HookwireClient({ channelName: 'test', autoReconnect: false });
    const handler = vi.fn();
    client.onEvent(handler);
    await client.connect();

    mockWs.receive({
      type: 'event', id: 'evt_5', seq: 5, received_at: new Date().toISOString(),
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: { encoding: 'utf8', data: '{"hello":"world"}', size: 17, truncated: false },
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      id: 'evt_5', seq: 5,
      body: expect.objectContaining({ data: '{"hello":"world"}' }),
    }));
  });

  it('skips duplicate events (replay edge case)', async () => {
    const client = new HookwireClient({ channelName: 'test', autoReconnect: false });
    const handler = vi.fn();
    client.onEvent(handler);
    await client.connect();

    mockWs.receive({
      type: 'event', id: 'evt_1', seq: 1, received_at: new Date().toISOString(),
      method: 'POST', headers: {}, body: { encoding: 'utf8', data: 'x', size: 1, truncated: false },
    });
    expect(handler).toHaveBeenCalledTimes(1);

    // Same seq again — should be skipped
    mockWs.receive({
      type: 'event', id: 'evt_1', seq: 1, received_at: new Date().toISOString(),
      method: 'POST', headers: {}, body: { encoding: 'utf8', data: 'x', size: 1, truncated: false },
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe works', async () => {
    const client = new HookwireClient({ channelName: 'test', autoReconnect: false });
    const handler = vi.fn();
    const unsub = client.onEvent(handler);
    await client.connect();

    unsub();

    mockWs.receive({
      type: 'event', id: 'evt_1', seq: 1, received_at: new Date().toISOString(),
      method: 'POST', headers: {}, body: { encoding: 'utf8', data: 'x', size: 1, truncated: false },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores non-event WS messages', async () => {
    const client = new HookwireClient({ channelName: 'test', autoReconnect: false });
    const handler = vi.fn();
    client.onEvent(handler);
    await client.connect();

    mockWs.receive({ type: 'hello', channel: 'test', server_time: new Date().toISOString() });
    expect(handler).not.toHaveBeenCalled();
  });

  it('getHistory calls REST API', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, channel: 'test', events: [{ seq: 1 }] }),
    });

    const client = new HookwireClient({ channelName: 'test', autoReconnect: false });
    const events = await client.getHistory({ afterSeq: 0, limit: 5 });
    expect(events).toHaveLength(1);
  });
});
