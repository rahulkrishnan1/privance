import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export so Capacitor can wrap the same bundle into iOS/Android shells.
  // Server-side rendering is incompatible with our zero-knowledge model
  // (the DEK never leaves the browser), so static is the correct mode.
  output: "export",

  // Transpile workspace TS packages — Next.js only transpiles JS by default.
  transpilePackages: ["@privance/core"],

  // Capacitor serves files via file:// — avoid trailingSlash mismatches in routes.
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
