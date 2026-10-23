// Run after `docker compose -f infra/compose.local.yaml up --build -d --wait`.
import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://localhost:8080");
    await page.getByRole("link", { name: "Create an account", exact: true }).click();
    await page.waitForURL(/\/auth\/signup\/?$/);
    await page.getByLabel("Invite code").waitFor();
    const response = await page.request.get("http://localhost:8080/api/health");
    assert.equal(response.ok(), true);
    assert.equal((await response.json()).ok, true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
process.stdout.write("Local Compose browser smoke passed (Chromium + WebKit).\n");
