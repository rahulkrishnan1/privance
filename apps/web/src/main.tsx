import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./providers/auth-context";
import { QueryProvider } from "./providers/query-client";
import { SyncProvider } from "./providers/sync-context";
import { routeTree } from "./routeTree.gen";
import "./globals.css";
import "@fontsource/schibsted-grotesk";
import "@fontsource/spline-sans-mono";
import "@fontsource/instrument-serif";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryProvider>
        <AuthProvider>
          <SyncProvider>
            <RouterProvider router={router} />
          </SyncProvider>
        </AuthProvider>
      </QueryProvider>
    </StrictMode>,
  );
}
