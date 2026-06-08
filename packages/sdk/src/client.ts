import type { ChannelEvent } from '@hookwire/types';
import { HookwireWebSocket } from './websocket.js';
import { fetchHistory, fetchChannel } from './history.js';

export interface HookwireClientOptions {
  baseUrl?: string;
  wsUrl?: string;
  clientToken: string;
  channelName: string;
  autoReconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export type HookwireEventHandler = (event: ChannelEvent) => void;

type ResolvedOptions = Required<HookwireClientOptions>;

export class HookwireClient {
  private options: ResolvedOptions;
  private ws: HookwireWebSocket | null = null;
  private eventHandlers: Set<HookwireEventHandler> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeq = 0;

  constructor(options: HookwireClientOptions) {
    this.options = {
      baseUrl: 'https://api.hookwire.dev',
      wsUrl: 'wss://api.hookwire.dev',
      autoReconnect: true,
      reconnectDelay: 1000,
      maxReconnectAttempts: 10,
      ...options,
    };
  }

  async connect(): Promise<void> {
    await this.catchUpHistory();
    this.connectWebSocket();
  }

  disconnect(): void {
    this.reconnectAttempts = this.options.maxReconnectAttempts;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  onEvent(handler: HookwireEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => { this.eventHandlers.delete(handler); };
  }

  async getHistory(params?: {
    limit?: number;
    afterSeq?: number;
    includeBody?: boolean;
  }): Promise<ChannelEvent[]> {
    const response = await fetchHistory({
      baseUrl: this.options.baseUrl,
      channelName: this.options.channelName,
      clientToken: this.options.clientToken,
      limit: params?.limit,
      afterSeq: params?.afterSeq,
      includeBody: params?.includeBody,
    });
    return response.events;
  }

  async getChannel(): Promise<unknown> {
    return fetchChannel({
      baseUrl: this.options.baseUrl,
      channelName: this.options.channelName,
      clientToken: this.options.clientToken,
    });
  }

  // --- Private ---

  private async catchUpHistory(): Promise<void> {
    try {
      const events = await this.getHistory({ afterSeq: this.lastSeq, limit: 50 });
      for (const event of events) {
        this.lastSeq = Math.max(this.lastSeq, event.seq);
        this.emit(event);
      }
    } catch (err) {
      console.warn('[HookwireSDK] Failed to fetch history:', err);
    }
  }

  private connectWebSocket(): void {
    const wsUrl = `${this.options.wsUrl}/v1/channels/${this.options.channelName}/connect`;
    this.ws = new HookwireWebSocket(wsUrl, this.options.clientToken);

    this.ws.on('event', (event: ChannelEvent) => {
      this.lastSeq = Math.max(this.lastSeq, event.seq);
      this.emit(event);
    });

    this.ws.on('closed', () => {
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.on('error', () => {
      this.scheduleReconnect();
    });

    this.ws.connect();
  }

  private scheduleReconnect(): void {
    if (!this.options.autoReconnect) return;
    if (this.options.maxReconnectAttempts >= 0 && this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.warn('[HookwireSDK] Max reconnect attempts reached');
      return;
    }
    const delay = this.options.reconnectDelay * Math.min(Math.pow(2, this.reconnectAttempts), 30);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(async () => {
      await this.catchUpHistory();
      this.connectWebSocket();
    }, delay);
  }

  private emit(event: ChannelEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch (err) {
        console.error('[HookwireSDK] Event handler error:', err);
      }
    }
  }
}
