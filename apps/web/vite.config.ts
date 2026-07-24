import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      autoCodeSplitting: true,
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
  ],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(process.env.VITE_APP_VERSION || pkg.version),
    "import.meta.env.VITE_SERVER_URL": JSON.stringify(process.env.VITE_SERVER_URL ?? ""),
  },
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
  server: { port: 8081 },
  build: { outDir: "out" },
});
