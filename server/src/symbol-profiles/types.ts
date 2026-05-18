// Domain types live in packages/core, server consumes them via the workspace dep.
import type { AssetType, SymbolProfile } from "@privance/core/domain";

export type { AssetType, SymbolProfile };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SymbolProfileError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SymbolProfileError";
    this.code = code;
  }
}

/** Ticker not found in DB or upstream. */
export class NotFoundError extends SymbolProfileError {
  constructor(ticker: string) {
    super("not_found", `symbol profile not found: ${ticker}`);
    this.name = "NotFoundError";
  }
}

/** Upstream provider returned a 5xx, timed out, or returned 429. */
export class UpstreamUnavailableError extends SymbolProfileError {
  constructor(message = "upstream profile provider unavailable") {
    super("upstream_unavailable", message);
    this.name = "UpstreamUnavailableError";
  }
}

/** Per-user refresh cooldown not yet elapsed. */
export class RateLimitedError extends SymbolProfileError {
  readonly msRemaining: number;
  constructor(msRemaining: number) {
    super("rate_limited", `refresh cooldown: ${msRemaining}ms remaining`);
    this.name = "RateLimitedError";
    this.msRemaining = msRemaining;
  }
}

export type { FetchLike } from "../core/fetch.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type LookupResult = {
  profiles: SymbolProfile[];
  /** Tickers present in the request but unknown to DB + upstream. */
  unknown: string[];
};
