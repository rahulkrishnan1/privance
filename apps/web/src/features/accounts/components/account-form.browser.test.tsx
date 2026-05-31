import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AccountForm } from "./account-form";

async function fillValidCashAccount(screen: Awaited<ReturnType<typeof render>>) {
  await screen.getByRole("textbox", { name: "Account name" }).fill("My Cash");
  await screen.getByRole("textbox", { name: "Balance" }).fill("100.00");
}

test("surfaces an inline error when the save fails (no longer silently swallowed)", async () => {
  const onSubmit = vi.fn(() => Promise.reject(new Error("encrypt failed")));
  const screen = await render(<AccountForm open onClose={() => {}} onSubmit={onSubmit} />);

  await fillValidCashAccount(screen);
  await screen.getByRole("button", { name: "Save" }).click();

  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await expect.element(screen.getByText("Could not save. Please try again.")).toBeVisible();
});

test("submits the entered values and shows no error on success", async () => {
  const onSubmit = vi.fn(() => Promise.resolve());
  const screen = await render(<AccountForm open onClose={() => {}} onSubmit={onSubmit} />);

  await fillValidCashAccount(screen);
  await screen.getByRole("button", { name: "Save" }).click();

  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ name: "My Cash", balance: "100.00" }),
  );
  expect(screen.container.querySelector('[role="alert"]')).toBeNull();
});
