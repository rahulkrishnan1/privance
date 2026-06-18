import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

const nextConfig: NextConfig = {
  // Surface the package version to the client so Settings can show the real
  // build without a hardcoded literal drifting out of date.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },

  // Static export so Capacitor can wrap the same bundle into iOS/Android shells.
  // Server-side rendering is incompatible with our zero-knowledge model
  // (the DEK never leaves the browser), so static is the correct mode.
  output: "export",

  // Next.js only transpiles JS by default; workspace TS packages need this.
  transpilePackages: ["@privance/core"],

  // Capacitor serves files via file://; avoid trailingSlash mismatches in routes.
  trailingSlash: true,

  // Disable Next.js image optimization: it requires a server, which static
  // export does not provide. We serve raw image assets from /public.
  images: { unoptimized: true },

  webpack(config) {
    // @privance/core uses ESM-standard .js extension imports in TypeScript source.
    // Webpack needs to know to resolve .js imports as .ts when the .js file does
    // not exist (TypeScript extensionless resolution under bundler moduleResolution).
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
