import { readFileSync } from "node:fs";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

function readSecret(name: string, fallback: string): string {
  const dir = process.env.PRIVANCE_SECRETS_DIR;
  if (!dir) return fallback;
  try {
    return readFileSync(join(dir, name), "utf-8").trim();
  } catch {
    return fallback;
  }
}

function buildConnectionUrl(): string {
  const rawUrl = process.env.DATABASE_URL ?? "postgres://privance:privance@localhost:5432/privance";
  const password = readSecret("postgres_password", "");
  if (!password) return rawUrl;

  const url = new URL(rawUrl);
  if (url.password) return rawUrl;
  url.password = password;
  return url.toString();
}

const sql = postgres(buildConnectionUrl());

export const db = drizzle(sql);

export { sql };

export type Db = typeof db;

// Drizzle's transaction executor, narrowed from the transaction callback arg.
// Shared so modules can expose tx-scoped operations (e.g. cross-module purge).
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
