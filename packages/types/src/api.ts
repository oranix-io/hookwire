export type ApiError = {
  ok: false;
  error: { code: string; message: string };
};

export interface IngestOk {
  ok: true;
  event_id: string;
  seq: number;
}
