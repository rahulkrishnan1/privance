/**
 * Minimal next/link shim for the Vitest browser environment.
 *
 * next/link's real implementation reads process.env.NODE_ENV which is not
 * available in Chromium. Components that use Link from next/link render a
 * plain anchor in tests through this alias, preserving href and children.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children?: ReactNode;
}

export default function Link({ href, children, ...rest }: LinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
