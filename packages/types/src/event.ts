export interface EventProvider {
  hint?: string;
  event_type?: string;
  delivery_id?: string;
}

export interface EventBody {
  encoding: 'utf8' | 'base64';
  content_type?: string;
  data: string;
  size: number;
  truncated: boolean;
}

export interface EventSummary {
  title: string;
  subtitle?: string;
}

export interface ChannelEvent {
  id: string;
  seq: number;
  channel_name: string;
  received_at: string;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  remote_addr?: string;
  user_agent?: string;
  provider: EventProvider;
  body: EventBody;
  summary?: EventSummary;
}

export interface EventsQueryParams {
  limit?: number;
  after_seq?: number;
  before_seq?: number;
  include_body?: boolean;
  include_headers?: boolean;
}

export interface EventsResponse {
  ok: true;
  channel: string;
  events: ChannelEvent[];
}

export interface ClearEventsResponse {
  ok: true;
  channel: string;
  deleted_events: number;
}
