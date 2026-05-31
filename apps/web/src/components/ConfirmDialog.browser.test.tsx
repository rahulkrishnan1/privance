import { useState } from "react";
import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ConfirmDialog } from "./ConfirmDialog";

// A harness that owns `open` so onCancel can actually close the dialog, mirroring
// how callers (accounts/holdings screens) wire it.
function Harness(props: { onConfirm: () => Promise<void> | void; onCancel: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <ConfirmDialog
      open={open}
      title="Delete account?"
      body="This cannot be undone."
      confirmLabel="Delete"
      onConfirm={props.onConfirm}
      onCancel={() => {
        props.onCancel();
        setOpen(false);
      }}
    />
  );
}

test("Escape does not cancel while a destructive action is in flight (busy guard)", async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  const onConfirm = vi.fn(() => pending);
  const onCancel = vi.fn();

  const screen = await render(<Harness onConfirm={onConfirm} onCancel={onCancel} />);

  await screen.getByRole("button", { name: "Delete" }).click();
  // Now busy: the confirm promise has not resolved.
  await expect.element(screen.getByText("Working…")).toBeVisible();

  await userEvent.keyboard("{Escape}");

  // Fix: the in-flight delete must not be silently cancelled by Escape.
  await expect.element(screen.getByRole("heading", { name: "Delete account?" })).toBeVisible();
  expect(onCancel).not.toHaveBeenCalled();

  release?.();
});

test("Escape cancels when no action is in flight", async () => {
  const onCancel = vi.fn();
  const screen = await render(<Harness onConfirm={() => {}} onCancel={onCancel} />);

  await expect.element(screen.getByRole("heading", { name: "Delete account?" })).toBeVisible();
  await userEvent.keyboard("{Escape}");

  await vi.waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
});

test("clicking Delete runs the confirm action", async () => {
  const onConfirm = vi.fn(() => Promise.resolve());
  const screen = await render(<Harness onConfirm={onConfirm} onCancel={() => {}} />);

  await screen.getByRole("button", { name: "Delete" }).click();
  await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
});
