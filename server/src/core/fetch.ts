/** Injectable fetcher type, compatible with globalThis.fetch and test arrow functions. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
