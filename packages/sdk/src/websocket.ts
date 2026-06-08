import type { ChannelEvent, ServerMessage } from '@hookwire/types';

export class HookwireWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: { event: Set<(e: ChannelEvent) => void>; closed: Set<() => void>; error: Set<(e: Event) => void> } = {
    event: new Set(), closed: new Set(), error: new Set(),
  };
  private ping: ReturnType<typeof setInterval> | null = null;

  constructor(url: string) { this.url = url; }

  connect(): void {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.ping = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'ping', id: crypto.randomUUID(), time: new Date().toISOString() }));
        }
      }, 30_000);
    };

    this.ws.onmessage = (msg: MessageEvent) => {
      try {
        const data: ServerMessage = JSON.parse(msg.data);
        if (data.type === 'event') {
          const event: ChannelEvent = {
            id: data.id, seq: data.seq, received_at: data.received_at,
            method: data.method, headers: data.headers, body: data.body,
            summary: data.summary,
          };
          for (const h of this.handlers.event) h(event);
        }
      } catch {}
    };

    this.ws.onclose = () => { if (this.ping) clearInterval(this.ping); for (const h of this.handlers.closed) h(); };
    this.ws.onerror = (e) => { for (const h of this.handlers.error) h(e); };
  }

  close(): void { if (this.ping) clearInterval(this.ping); this.ws?.close(); this.ws = null; }

  on(type: 'event', handler: (e: ChannelEvent) => void): void;
  on(type: 'closed', handler: () => void): void;
  on(type: 'error', handler: (e: Event) => void): void;
  on(type: string, handler: any): void {
    if (type === 'event') this.handlers.event.add(handler);
    else if (type === 'closed') this.handlers.closed.add(handler);
    else if (type === 'error') this.handlers.error.add(handler);
  }
}
