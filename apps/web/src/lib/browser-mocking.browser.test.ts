import { expect, test, vi } from "vitest";
import { commands } from "vitest/browser";

declare module "vitest/browser" {
  interface BrowserCommands {
    clearModuleMockRoutes: () => Promise<void>;
  }
}

const factory = vi.hoisted(() => {
  let enter: () => void;
  let release: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { entered, blocked, enter: () => enter(), release: () => release() };
});

vi.mock("./utils", async () => {
  factory.enter();
  await factory.blocked;
  return { cn: () => "mocked" };
});

test("an in-flight module mock still resolves when its routes are cleared", async () => {
  const importing = import("./utils");
  await factory.entered;
  try {
    await commands.clearModuleMockRoutes();
  } finally {
    factory.release();
  }
  expect((await importing).cn("real")).toBe("mocked");
});
