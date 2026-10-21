import { expect, test } from "vitest";

test("the browser renders the test iframe without scaling pointer coordinates", () => {
  const bounds = window.frameElement?.getBoundingClientRect();
  expect(bounds?.width).toBe(window.innerWidth);
  expect(bounds?.height).toBe(window.innerHeight);
});
