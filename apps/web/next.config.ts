import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

const nextConfig: NextConfig = {
  // Surface the build version to the client (Settings shows it). Release builds
  // inject NEXT_PUBLIC_APP_VERSION from the git tag (the single source of truth);
  // local/dev builds fall back to package.json so there's no manual bump to forget.
  env: { NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || pkg.version },

  // Server-side rendering is incompatible with our zero-knowledge model
  // (the DEK never leaves the browser), so static export is the correct mode.
  output: "export",

  // Next.js only transpiles JS by default; workspace TS packages need this.
  transpilePackages: ["@privance/core"],

  // Serve route paths with a trailing slash so static hosts resolve them as
  // directories (e.g. /app/holdings/ -> .../index.html).
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
