// Mock for cloudflare:workers module — used during vitest (Node.js runtime)

export class DurableObject {
  protected ctx: any;
  protected env: any;

  constructor(ctx: any, env: any) {
    this.ctx = ctx;
    this.env = env;
  }
}

// Minimal mocks — the real DO runs in the ChannelDO class but vitest
// never instantiates it directly (tests use mock DO stubs instead).
