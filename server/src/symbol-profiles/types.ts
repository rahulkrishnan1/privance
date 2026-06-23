// Domain types live in packages/core, server consumes them via the workspace dep.
import type { AssetType, SymbolProfile } from "@privance/core/domain";

export type { AssetType, SymbolProfile };

export class SymbolProfileError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SymbolProfileError";
    this.code = code;
  }
}

/** Upstream provider returned a 5xx, timed out, or returned 429. */
export class UpstreamUnavailableError extends SymbolProfileError {
  constructor(message = "upstream profile provider unavailable") {
    super("upstream_unavailable", message);
    this.name = "UpstreamUnavailableError";
  }
}

export type { FetchLike } from "../core/fetch.js";

export type LookupResult = {
  profiles: SymbolProfile[];
  /** Tickers present in the request but unknown to DB + upstream. */
  unknown: string[];
};
