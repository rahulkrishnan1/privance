import { describe, expect, it } from "bun:test";

import server from "./index.js";

describe("health endpoint", () => {
  it("returns ok", async () => {
    const res = await server.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
