// E2E port assignments, overridable per checkout so parallel worktrees can run
// the suite concurrently without colliding on fixed ports:
//   E2E_WEB_PORT=8181 E2E_SERVER_PORT=3100 pnpm e2e
// Defaults match the dev stack (web :8081, server :3000).
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 8081);
export const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 3000);
export const BASE_URL = `http://localhost:${WEB_PORT}`;
export const SERVER_URL = `http://localhost:${SERVER_PORT}`;
