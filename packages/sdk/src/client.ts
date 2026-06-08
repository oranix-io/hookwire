import type { ChannelEvent } from '@hookwire/types';
import { HookwireWebSocket } from './websocket.js';
import { fetchHistory } from './history.js';

export interface HookwireClientOptions {
  baseUrl?: string;
  channelName: string;
  autoReconnect?: boolean;
  reconnectDelay?: number;
}

export type HookwireEventHandler = (event: ChannelEvent) => void;

type ResolvedOptions = Required<HookwireClientOptions>;

export class HookwireClient {
  private options: ResolvedOptions;
  private ws: HookwireWebSocket | null = null;
  private handlers = new Set<HookwireEventHandler>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeq = 0;

  constructor(options: HookwireClientOptions) {
    this.options = {
      baseUrl: 'https://hookwire.dev',
      autoReconnect: true,
      reconnectDelay: 1000,
      ...options,
    };
  }

  async connect(): Promise<void> {
    await this.catchUpHistory();
    this.connectWS();
  }

  disconnect(): void {
    this.reconnectAttempts = 999;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
  }

  onEvent(handler: HookwireEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  async getHistory(params?: { limit?: number; afterSeq?: number }): Promise<ChannelEvent[]> {
    const resp = await fetchHistory({
      baseUrl: this.options.baseUrl,
      channelName: this.options.channelName,
      limit: params?.limit,
      afterSeq: params?.afterSeq,
    });
    return resp.events;
  }

  private async catchUpHistory(): Promise<void> {
    try {
      const events = await this.getHistory({ afterSeq: this.lastSeq, limit: 50 });
      for (const e of events) { this.lastSeq = Math.max(this.lastSeq, e.seq); this.emit(e); }
    } catch (err) {
      console.warn('[HookwireSDK] History fetch failed:', err);
    }
  }

  private connectWS(): void {
    const url = `${this.options.baseUrl.replace('http', 'ws')}/ch/${this.options.channelName}/ws`;
    this.ws = new HookwireWebSocket(url);

    this.ws.on('event', (event: ChannelEvent) => {
      this.lastSeq = Math.max(this.lastSeq, event.seq);
      this.emit(event);
    });

    this.ws.on('closed', () => { this.ws = null; this.scheduleReconnect(); });
    this.ws.on('error', () => { this.scheduleReconnect(); });

    this.ws.connect();
  }

  private scheduleReconnect(): void {
    if (!this.options.autoReconnect) return;
    const delay = this.options.reconnectDelay * Math.min(Math.pow(2, this.reconnectAttempts++), 30_000);
    this.reconnectTimer = setTimeout(async () => {
      await this.catchUpHistory();
      this.connectWS();
    }, delay);
  }

  private emit(event: ChannelEvent): void {
    for (const h of this.handlers) { try { h(event); } catch {} }
  }
}
