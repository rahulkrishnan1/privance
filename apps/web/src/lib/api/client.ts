const CSRF_HEADER = "X-Requested-With";
const CSRF_VALUE = "privance-web";
const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function serverUrl(): string {
  return process.env.NEXT_PUBLIC_SERVER_URL ?? "";
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();

  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (MUTATING_METHODS.has(method)) {
    headers.set(CSRF_HEADER, CSRF_VALUE);
  }

  let response: Response;
  try {
    response = await fetch(`${serverUrl()}${path}`, {
      ...init,
      method,
      credentials: "include",
      headers,
    });
  } catch (cause) {
    throw new ApiError(0, "network", cause instanceof Error ? cause.message : "network error");
  }

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      let body: Record<string, unknown>;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        throw new ApiError(response.status, "parse_error", "failed to parse error body");
      }
      const code = typeof body.error === "string" ? body.error : String(response.status);
      const message = typeof body.message === "string" ? body.message : JSON.stringify(body);
      throw new ApiError(response.status, code, message);
    } else {
      const text = await response.text();
      throw new ApiError(response.status, text || String(response.status), text);
    }
  }

  return response;
}
