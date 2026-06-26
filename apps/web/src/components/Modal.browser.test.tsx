import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { Modal } from "./Modal";

// Regression: showModal() focuses the first child (the close button); the Modal
// redirects focus to the dialog container so no ring paints on open.
test("on open, focus lands on the dialog, not the first focusable child", async () => {
  const screen = await render(
    <Modal open onClose={() => {}} labelledBy="modal-title">
      <h2 id="modal-title">Title</h2>
      <button type="button" aria-label="Close">
        x
      </button>
      <input aria-label="Field" />
    </Modal>,
  );

  const dialog = screen.getByRole("dialog").element();
  await expect.poll(() => document.activeElement === dialog).toBe(true);
  expect(document.activeElement?.getAttribute("aria-label")).not.toBe("Close");
});
