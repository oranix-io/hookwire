import type { ChannelEvent, ServerMessage } from '@hookwire/types';

type WsEventHandler = (event: ChannelEvent) => void;
type WsClosedHandler = () => void;
type WsErrorHandler = (error: Event) => void;

export class HookwireWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private eventHandlers = new Set<WsEventHandler>();
  private closedHandlers = new Set<WsClosedHandler>();
  private errorHandlers = new Set<WsErrorHandler>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(url: string, clientToken: string) {
    this.url = url;
    this.token = clientToken;
  }

  connect(): void {
    const wsUrl = new URL(this.url);
    wsUrl.searchParams.set('token', this.token);
    this.ws = new WebSocket(wsUrl.toString());

    this.ws.onopen = () => {
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'ping',
            id: crypto.randomUUID(),
            time: new Date().toISOString(),
          }));
        }
      }, 30_000);
    };

    this.ws.onmessage = (msg: MessageEvent) => {
      try {
        const data: ServerMessage = JSON.parse(msg.data as string);
        if (data.type === 'event') {
          const event: ChannelEvent = {
            id: data.id,
            seq: data.seq,
            channel_name: data.channel,
            received_at: data.received_at,
            method: data.http.method,
            path: data.http.path,
            query: data.http.query,
            headers: data.http.headers,
            remote_addr: undefined,
            user_agent: undefined,
            provider: data.provider,
            body: data.body,
            summary: data.summary,
          };
          for (const h of this.eventHandlers) h(event);
        }
      } catch (err) {
        console.error('[HookwireSDK] Failed to parse message:', err);
      }
    };

    this.ws.onclose = () => {
      if (this.pingInterval) clearInterval(this.pingInterval);
      for (const h of this.closedHandlers) h();
    };

    this.ws.onerror = (err: Event) => {
      for (const h of this.errorHandlers) h(err);
    };
  }

  close(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.ws?.close();
    this.ws = null;
  }

  on(event: string, handler: WsEventHandler | WsClosedHandler | WsErrorHandler): void {
    switch (event) {
      case 'event': this.eventHandlers.add(handler as WsEventHandler); break;
      case 'closed': this.closedHandlers.add(handler as WsClosedHandler); break;
      case 'error': this.errorHandlers.add(handler as WsErrorHandler); break;
    }
  }
}
