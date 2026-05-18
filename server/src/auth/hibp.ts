import { createHash } from "node:crypto";

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 5_000;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export async function isBreached(
  authHashHex: string,
  fetcher: Fetcher = globalThis.fetch,
): Promise<boolean | null> {
  const upper = authHashHex.toUpperCase();
  const prefix = upper.slice(0, 5);
  const suffix = upper.slice(5);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetcher(`${HIBP_RANGE_URL}${prefix}`, {
        headers: { "Add-Padding": "true" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) return null;

    const text = await resp.text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(":");
      const hashSuffix = colonIdx === -1 ? trimmed : trimmed.slice(0, colonIdx);
      if (hashSuffix.toUpperCase() === suffix) return true;
    }
    return false;
  } catch {
    return null;
  }
}

export function authHashToHex(authHash: Buffer): string {
  return createHash("sha1").update(authHash).digest("hex").toUpperCase();
}
