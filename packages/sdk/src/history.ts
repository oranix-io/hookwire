import type { EventsResponse } from '@hookwire/types';

interface HistoryParams {
  baseUrl: string;
  channelName: string;
  clientToken: string;
  limit?: number;
  afterSeq?: number;
  includeBody?: boolean;
}

export async function fetchHistory(params: HistoryParams): Promise<EventsResponse> {
  const url = new URL(`${params.baseUrl}/v1/channels/${params.channelName}/events`);
  if (params.limit) url.searchParams.set('limit', String(params.limit));
  if (params.afterSeq !== undefined) url.searchParams.set('after_seq', String(params.afterSeq));
  if (params.includeBody !== undefined) url.searchParams.set('include_body', String(params.includeBody));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${params.clientToken}` },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`Failed to fetch history: ${error?.error?.message ?? res.statusText}`);
  }

  return res.json();
}

export async function fetchChannel(params: {
  baseUrl: string;
  channelName: string;
  clientToken: string;
}): Promise<unknown> {
  const res = await fetch(`${params.baseUrl}/v1/channels/${params.channelName}`, {
    headers: { Authorization: `Bearer ${params.clientToken}` },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`Failed to fetch channel: ${error?.error?.message ?? res.statusText}`);
  }

  return res.json();
}
