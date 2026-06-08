import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookwireClient } from '../client.js';
import { fetchHistory } from '../history.js';

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  url = '';
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  private _sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    // Simulate async open
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string) { this._sent.push(data); }
  close() { setTimeout(() => this.onclose?.(), 0); }

  get sent() { return this._sent; }

  // Helper to simulate receiving a message
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

// ---------------------------------------------------------------------------
// fetchHistory
// ---------------------------------------------------------------------------

describe('fetchHistory', () => {
  it('calls the correct URL', async () => {
    const mockFetch = globalThis.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, channel: 'test', events: [] }),
    });

    await fetchHistory({ baseUrl: 'https://hookwire.dev', channelName: 'test', limit: 10 });

    const url = mockFetch.mock.calls[0][0];
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

// ---------------------------------------------------------------------------
// HookwireClient
// ---------------------------------------------------------------------------

describe('HookwireClient', () => {
  it('connects and fetches history', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, channel: 'test', events: [{ seq: 1, id: 'evt_1' }] }),
    });

    const client = new HookwireClient({ channelName: 'test', autoReconnect: false });
    const handler = vi.fn();
    client.onEvent(handler);

    await client.connect();

    // History event should have been emitted
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ seq: 1 }));
  });

  it('connects and opens WebSocket', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, channel: 'test', events: [] }),
    });

    const client = new HookwireClient({ channelName: 'test', autoReconnect: false });
    await client.connect();

    // WS should have been created with correct URL
    expect((globalThis.WebSocket as any)).toHaveBeenCalledWith(
      expect.stringContaining('/ch/test/ws')
    );
  });

  it('receives real-time events via WebSocket', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, channel: 'test', events: [] }),
    });

    const client = new HookwireClient({ channelName: 'test', autoReconnect: false });
    const handler = vi.fn();
    client.onEvent(handler);

    await client.connect();

    // Simulate WS event
    mockWs.receive({
      type: 'event',
      id: 'evt_5',
      seq: 5,
      received_at: new Date().toISOString(),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { encoding: 'utf8', data: '{"hello":"world"}', size: 17, truncated: false },
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      id: 'evt_5',
      seq: 5,
      body: expect.objectContaining({ data: '{"hello":"world"}' }),
    }));
  });

  it('disconnects cleanly', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, channel: 'test', events: [] }),
    });

    const client = new HookwireClient({ channelName: 'test' });
    await client.connect();

    client.disconnect();

    // After disconnect, WS close should have been called
    // (mock close triggers onclose which is handled)
  });

  it('unsubscribe returns a working function', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, channel: 'test', events: [] }),
    });

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
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, channel: 'test', events: [] }),
    });

    const client = new HookwireClient({ channelName: 'test', autoReconnect: false });
    const handler = vi.fn();
    client.onEvent(handler);
    await client.connect();

    // Simulate a hello or pong message
    mockWs.receive({ type: 'hello', channel: 'test', server_time: new Date().toISOString() });

    expect(handler).not.toHaveBeenCalled();
  });
});
