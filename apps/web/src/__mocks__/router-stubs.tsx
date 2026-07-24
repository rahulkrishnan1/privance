import type { ReactNode } from "react";

/** A <Link> stand-in for components rendered outside a RouterProvider. */
export function LinkStub({ children, to }: { children?: ReactNode; to?: string }) {
  return <a href={to}>{children}</a>;
}

/** Stubs createFileRoute so a route module loads without the generated tree.
 *  The returned Route keeps `.options`, so a test can read `.options.component`. */
export function createFileRouteStub() {
  return (options: unknown) => ({ options });
}
