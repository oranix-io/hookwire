export type ChannelStatus = 'active' | 'revoked' | 'expired' | 'deleted';

export interface Retention {
  max_events: number;
  ttl_hours: number;
}

export interface Channel {
  id: string;
  user_id: string;
  channel_name: string;
  display_name?: string;
  provider_hint?: string;
  client_token_hash: string;
  ingest_secret_hash?: string;
  status: ChannelStatus;
  max_events: number;
  ttl_hours: number;
  created_at: string;
  updated_at: string;
  revoked_at?: string;
  expires_at?: string;
  deleted_at?: string;
}

export interface CreateChannelRequest {
  display_name?: string;
  provider_hint?: string;
  retention?: {
    max_events?: number;
    ttl_hours?: number;
  };
}

export interface CreateChannelResponse {
  ok: true;
  channel_id: string;
  channel_name: string;
  display_name?: string;
  provider_hint?: string;
  webhook_url: string;
  connect_url: string;
  client_token: string;
  ingest_secret: string;
  retention: Retention;
  created_at: string;
}

export interface UpdateChannelRequest {
  display_name?: string;
  provider_hint?: string;
  retention?: {
    max_events?: number;
    ttl_hours?: number;
  };
}
