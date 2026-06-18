/**
 * Hard navigation seam. A full-page `location.replace` is how the auth-touching
 * flows (sign out, destroy vault) tear the SPA down so JS memory, including the
 * in-memory DEK, is wiped by the browser. Routing it through this function gives
 * tests a stub point, since `window.location.replace` itself is non-configurable
 * in real browsers and cannot be spied on directly.
 */
export function hardRedirect(path: string): void {
  window.location.replace(path);
}
