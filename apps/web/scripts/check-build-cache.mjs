#!/usr/bin/env node

// Run from any directory: node apps/web/scripts/check-build-cache.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const cwd = resolve(import.meta.dirname, "../../..");
const env = {
  ...process.env,
  VITE_APP_VERSION: "cache-check-version",
  VITE_SERVER_URL: "https://cache-check.invalid",
  VITE_PRIVANCE_KDF_REDUCED: "false",
};

function dryRun(environment) {
  return JSON.parse(
    execFileSync("pnpm", ["exec", "turbo", "run", "build", "--dry=json"], {
      cwd,
      env: environment,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    }),
  ).tasks;
}

const tasks = dryRun(env);
for (const [taskId, files] of [
  [
    "@privance/web#build",
    [
      "vite.config.ts",
      "vite.alias.ts",
      "index.html",
      "public/sqlite/privance-worker.mjs",
      "public/sqlite/sqlite3.wasm",
      "public/kdf/kdf-worker.js",
      "public/kdf/argon2.umd.min.js",
      "scripts/build-sim-worker.mjs",
      "scripts/build-icons.mjs",
    ],
  ],
  ["@privance/core#build", ["scripts/verify-dataset.mjs"]],
]) {
  const task = tasks.find((entry) => entry.taskId === taskId);
  assert.ok(task, `Missing task: ${taskId}`);
  for (const file of files) {
    assert.ok(Object.hasOwn(task.inputs, file), `${taskId} does not hash ${file}`);
  }
}

const web = tasks.find((entry) => entry.taskId === "@privance/web#build");
for (const name of ["VITE_APP_VERSION", "VITE_SERVER_URL", "VITE_PRIVANCE_KDF_REDUCED"]) {
  assert.ok(
    web.environmentVariables.inferred.some((entry) => entry.startsWith(`${name}=`)),
    `${name} is not inferred by Vite`,
  );
  const changed = dryRun({ ...env, [name]: `${env[name]}-changed` }).find(
    (entry) => entry.taskId === web.taskId,
  );
  assert.notEqual(changed.hash, web.hash, `${name} does not change the web build hash`);
  console.log(`${name}: ${web.hash} -> ${changed.hash}`);
}

console.log("Build cache hashes required assets, scripts, and Vite environment variables.");
