import { z } from "zod";
import { apiFetch, parseJson } from "./client";

type AccountDestroyRequest = {
  current_auth_hash: string; // base64, verified server-side
};

const AccountDestroyResponseSchema = z.object({
  status: z.literal("ok"),
});
type AccountDestroyResponse = z.infer<typeof AccountDestroyResponseSchema>;

// Erases all ciphertext server-side and clears the session cookie. A wrong
// password yields a 401 (ApiError) the caller maps to an inline message.
export async function destroy(payload: AccountDestroyRequest): Promise<AccountDestroyResponse> {
  const res = await apiFetch("/api/account/destroy", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseJson(res, AccountDestroyResponseSchema);
}
