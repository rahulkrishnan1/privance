import { afterEach, describe, expect, it, mock } from "bun:test";

import server, { shutdown } from "./index.js";

describe("health endpoint", () => {
  it("returns ok", async () => {
    const res = await server.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe("background timer shutdown", () => {
  afterEach(() => {
    mock.restore();
  });

  it("shutdown() clears both maintenance intervals so the process can exit", () => {
    const cleared: unknown[] = [];
    const realClear = globalThis.clearInterval;
    const spy = mock((handle: ReturnType<typeof setInterval>) => {
      cleared.push(handle);
      return realClear(handle);
    });
    globalThis.clearInterval = spy as unknown as typeof clearInterval;

    shutdown();

    globalThis.clearInterval = realClear;
    // Both the rate-limit eviction and audit-prune intervals must be cleared.
    expect(cleared).toHaveLength(2);
  });
});
