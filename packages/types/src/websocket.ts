// Server → Client Messages

export interface HelloMessage {
  type: 'hello';
  protocol: 'channel.v1';
  channel: string;
  server_time: string;
  features: {
    ack: false;
    history: true;
    replay: false;
  };
}

export interface EventMessage {
  type: 'event';
  id: string;
  seq: number;
  channel: string;
  received_at: string;
  provider: {
    hint?: string;
    event_type?: string;
    delivery_id?: string;
  };
  http: {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
  };
  body: {
    encoding: 'utf8' | 'base64';
    content_type?: string;
    data: string;
    size: number;
    truncated: boolean;
  };
  summary?: {
    title: string;
    subtitle?: string;
  };
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface StatusMessage {
  type: 'status';
  channel: string;
  connected_clients: number;
  last_seq: number;
}

export interface PongMessage {
  type: 'pong';
  id: string;
  time: string;
}

// Client → Server Messages

export interface PingMessage {
  type: 'ping';
  id: string;
  time: string;
}

export type ServerMessage = HelloMessage | EventMessage | ErrorMessage | StatusMessage | PongMessage;
export type ClientMessage = PingMessage;
