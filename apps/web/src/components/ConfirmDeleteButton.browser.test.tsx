import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";

test("first tap arms, second tap confirms", async () => {
  vi.useFakeTimers();
  const onConfirm = vi.fn();
  const screen = await render(<ConfirmDeleteButton onConfirm={onConfirm} />);

  await screen.getByRole("button", { name: "Delete" }).click();
  await expect.element(screen.getByRole("button", { name: "Tap again to delete" })).toBeVisible();
  expect(onConfirm).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Tap again to delete" }).click();
  expect(onConfirm).toHaveBeenCalledTimes(1);

  vi.useRealTimers();
});

test("disarms after the timeout without confirming", async () => {
  vi.useFakeTimers();
  const onConfirm = vi.fn();
  const screen = await render(<ConfirmDeleteButton onConfirm={onConfirm} />);

  await screen.getByRole("button", { name: "Delete" }).click();
  await expect.element(screen.getByRole("button", { name: "Tap again to delete" })).toBeVisible();

  vi.advanceTimersByTime(3500);

  await expect.element(screen.getByRole("button", { name: "Delete" })).toBeVisible();
  expect(onConfirm).not.toHaveBeenCalled();

  vi.useRealTimers();
});

test("pending disables the button", async () => {
  const screen = await render(<ConfirmDeleteButton onConfirm={() => {}} pending />);
  await expect.element(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
});
