import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test as base, type Page, webkit } from "@playwright/test";

// WebKit OPFS requires an on-disk profile; ephemeral contexts fail
// getDirectory() the same way Safari Private Browsing does.
type Fixtures = { persistentPage: Page };

export const test = base.extend<Fixtures>({
  persistentPage: async ({ browserName, browser, baseURL }, use) => {
    if (browserName !== "webkit") {
      const ctx = await browser.newContext({ baseURL });
      const page = await ctx.newPage();
      await use(page);
      await ctx.close();
      return;
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-wk-"));
    const ctx = await webkit.launchPersistentContext(userDataDir, {
      headless: true,
      baseURL,
    });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    try {
      await use(page);
    } finally {
      await ctx.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  },
});

export { expect } from "@playwright/test";
