import { expect, it } from "bun:test";
import { strictEqual } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("loads and trims a Docker secret without changing connection routing", async () => {
  const originalEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    PRIVANCE_SECRETS_DIR: process.env.PRIVANCE_SECRETS_DIR,
  };
  const directory = mkdtempSync(join(tmpdir(), "privance-db-config-"));
  let sql: typeof import("./db.js").sql | undefined;
  try {
    process.env.DATABASE_URL = "postgres://fixture@localhost:55487/fixture";
    process.env.PRIVANCE_SECRETS_DIR = directory;
    writeFileSync(join(directory, "postgres_password"), "  secret@:/?#\n");
    ({ sql } = await import("./db.js"));
    strictEqual(sql.options.pass, "secret@:/?#");
    expect(sql.options.user).toBe("fixture");
    expect(sql.options.database).toBe("fixture");
    expect(sql.options.host).toEqual(["localhost"]);
    expect(sql.options.port).toEqual([55487]);
  } finally {
    await sql?.end();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
