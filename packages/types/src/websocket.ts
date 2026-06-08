export interface HelloMessage {
  type: 'hello';
  channel: string;
  server_time: string;
}

export interface EventMessage {
  type: 'event';
  id: string;
  seq: number;
  received_at: string;
  method: string;
  headers: Record<string, string>;
  body: {
    encoding: 'utf8' | 'base64';
    content_type?: string;
    data: string;
    size: number;
    truncated: boolean;
  };
  summary?: { title: string; subtitle?: string };
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface PongMessage {
  type: 'pong';
  id: string;
  time: string;
}

export interface PingMessage {
  type: 'ping';
  id: string;
  time: string;
}

export type ServerMessage = HelloMessage | EventMessage | ErrorMessage | PongMessage;
export type ClientMessage = PingMessage;
