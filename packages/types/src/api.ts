export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export interface IngestResponse {
  ok: true;
  channel: string;
  event_id: string;
  seq: number;
}

export interface RevokeChannelResponse {
  ok: true;
  channel: string;
  status: 'revoked';
  revoked_at: string;
}

export interface DeleteChannelResponse {
  ok: true;
  channel: string;
  status: 'deleted';
}
