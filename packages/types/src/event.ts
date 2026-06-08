export interface ChannelEvent {
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

export interface EventSummary {
  title: string;
  subtitle?: string;
}
