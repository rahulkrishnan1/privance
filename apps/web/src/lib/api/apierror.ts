import { ApiError } from "@/lib/api/client";

export function mapApiError(e: unknown, mapping: Record<number, string>): string | null {
  if (e instanceof ApiError) {
    for (const [status, key] of Object.entries(mapping)) {
      if (e.status === Number(status)) return key;
    }
  }
  return null;
}
