import type { ChannelEvent } from '@hookwire/types';

interface EventsResponse { ok: true; channel: string; events: ChannelEvent[]; }

interface HistoryOpts {
  baseUrl: string;
  channelName: string;
  limit?: number;
  afterSeq?: number;
}

export async function fetchHistory(opts: HistoryOpts): Promise<EventsResponse> {
  const url = new URL(`${opts.baseUrl}/ch/${opts.channelName}/events`);
  if (opts.limit) url.searchParams.set('limit', String(opts.limit));
  if (opts.afterSeq !== undefined) url.searchParams.set('after_seq', String(opts.afterSeq));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);
  return res.json();
}
