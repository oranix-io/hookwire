// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { createReq } from './setup.js';

describe('Health & home', () => {
  it('GET /health', async () => {
    const { req } = createReq();
    const res = await req('/health');
    expect(res.status).toBe(200);
    expect((await res.json()).service).toBe('hookwire-api');
  });

  it('GET / is home page', async () => {
    const { req } = createReq();
    const res = await req('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Hookwire');
  });

  it('GET /ch/:name is viewer page', async () => {
    const { req } = createReq();
    const res = await req('/ch/viewer-test');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('viewer-test');
    expect(html).toContain('WebSocket');
  });
});

describe('Docs', () => {
  it('GET /docs', async () => {
    const { req } = createReq();
    expect((await req('/docs')).status).toBe(200);
  });

  it('GET /docs/openapi.json', async () => {
    const { req } = createReq();
    const res = await req('/docs/openapi.json');
    const body = await res.json();
    expect(body.openapi).toBe('3.1.0');
    expect(body.paths['/ch/{name}']).toBeDefined();
  });
});
