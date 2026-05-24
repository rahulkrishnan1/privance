import { readFileSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "drizzle-kit";

function readSecret(name: string): string {
  const dir = process.env.PRIVANCE_SECRETS_DIR;
  if (!dir) return "";
  try {
    return readFileSync(join(dir, name), "utf-8").trim();
  } catch {
    return "";
  }
}

function buildConnectionUrl(): string {
  const rawUrl = process.env.DATABASE_URL ?? "postgres://privance:privance@localhost:5432/privance";
  const password = readSecret("postgres_password");
  if (!password) return rawUrl;
  const url = new URL(rawUrl);
  if (url.password) return rawUrl;
  url.password = password;
  return url.toString();
}

export default defineConfig({
  schema: "./src/*/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: buildConnectionUrl(),
  },
  strict: true,
  verbose: true,
});
