export type DataSource = "yahoo" | "coingecko";

export type { FetchLike } from "../core/fetch.js";

export class PriceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PriceError";
    this.code = code;
  }
}

/** Upstream provider returned a 5xx, timed out, or returned 429. */
export class UpstreamUnavailableError extends PriceError {
  constructor(message = "upstream price provider unavailable") {
    super("upstream_unavailable", message);
    this.name = "UpstreamUnavailableError";
  }
}

export class InvalidSourceError extends PriceError {
  constructor(source: string) {
    super("invalid_source", `unknown price source: ${source}`);
    this.name = "InvalidSourceError";
  }
}

export type PriceEntry = {
  ticker: string;
  /** Decimal string, e.g. "182.34" */
  price: string;
  /** Prior session close, when upstream provides it. Decimal string. */
  previousPrice: string | null;
  fetchedAt: string; // ISO-8601
};

export type RefreshResult = {
  prices: PriceEntry[];
  /** Tickers present in the request but absent from the upstream response. */
  unknown: string[];
};

export type UpstreamPrice = {
  price: string;
  previousPrice: string | null;
  fetchedAt: string; // ISO-8601
};
