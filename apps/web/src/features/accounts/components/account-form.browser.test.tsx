import type { Account, AccountId, UserId } from "@privance/core";
import { asId, asIsoDateTime } from "@privance/core";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AccountForm } from "./account-form";

const TS = asIsoDateTime("2026-01-01T00:00:00.000Z");

function makeAccount(payload: Account["payload"]): Account {
  return {
    id: asId<AccountId>("acct-edit"),
    userId: asId<UserId>("user-1"),
    createdAt: TS,
    lastUpdatedAt: TS,
    payload,
  } as Account;
}

// The rebuilt form defaults to Cash kind, so the balance field is labeled
// "Current balance" and the submit button "Create account". Account type starts
// on the placeholder and must be chosen.
async function fillValidCashAccount(screen: Awaited<ReturnType<typeof render>>) {
  await screen.getByRole("textbox", { name: "Name" }).fill("My Cash");
  await screen.getByRole("combobox", { name: "Account type" }).selectOptions("checking");
  await screen.getByRole("textbox", { name: "Current balance" }).fill("100.00");
}

test("surfaces an inline error when the save fails (no longer silently swallowed)", async () => {
  const onSubmit = vi.fn(() => Promise.reject(new Error("encrypt failed")));
  const screen = await render(<AccountForm open onClose={() => {}} onSubmit={onSubmit} />);

  await fillValidCashAccount(screen);
  await screen.getByRole("button", { name: "Create account" }).click();

  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await expect.element(screen.getByText("Could not save. Please try again.")).toBeVisible();
});

test("submits the entered values and shows no error on success", async () => {
  const onSubmit = vi.fn(() => Promise.resolve());
  const screen = await render(<AccountForm open onClose={() => {}} onSubmit={onSubmit} />);

  await fillValidCashAccount(screen);
  await screen.getByRole("button", { name: "Create account" }).click();

  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ name: "My Cash", balance: "100.00" }),
  );
  expect(screen.container.querySelector('[role="alert"]')).toBeNull();
});

test("first account (defaultKind investment) saves an investment subKind, not a cash one", async () => {
  // Regression: the empty-state form opens with defaultKind="investment" but the
  // subKind defaulted to "checking", so a brand-new Investment account saved with
  // a cash subKind and failed to parse on read (screen stuck on the empty state).
  const onSubmit = vi.fn(() => Promise.resolve());
  const screen = await render(
    <AccountForm open defaultKind="investment" onClose={() => {}} onSubmit={onSubmit} />,
  );

  await screen.getByRole("textbox", { name: "Name" }).fill("Brokerage");
  await screen.getByRole("combobox", { name: "Account type" }).selectOptions("brokerage");
  await screen.getByRole("textbox", { name: "Cash balance / optional" }).fill("12345.00");
  await screen.getByRole("button", { name: "Create account" }).click();

  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "investment", subKind: "brokerage" }),
  );
});

test("blocks save until an account type is chosen", async () => {
  const onSubmit = vi.fn(() => Promise.resolve());
  const screen = await render(<AccountForm open onClose={() => {}} onSubmit={onSubmit} />);

  await screen.getByRole("textbox", { name: "Name" }).fill("No Type");
  await screen.getByRole("textbox", { name: "Current balance" }).fill("50.00");
  await screen.getByRole("button", { name: "Create account" }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent("Select an account type");
  expect(onSubmit).not.toHaveBeenCalled();
});

test("edit mode prefills the existing cash account and keeps its kind locked", async () => {
  const account = makeAccount({
    kind: "cash",
    subKind: "savings",
    name: "Ally Savings",
    balanceCents: "1234500", // $12,345.00
    currency: "USD",
    apy: "0.0410",
  });
  const screen = await render(
    <AccountForm open account={account} onClose={() => {}} onSubmit={vi.fn()} />,
  );

  await expect.element(screen.getByRole("heading", { name: "Edit account" })).toBeVisible();
  await expect.element(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Ally Savings");
  await expect
    .element(screen.getByRole("textbox", { name: "Current balance" }))
    .toHaveValue("12345.00");
  await expect
    .element(screen.getByRole("combobox", { name: "Account type" }))
    .toHaveValue("savings");
  // Stored APY fraction renders as a percent input.
  await expect.element(screen.getByRole("textbox", { name: "APY (optional)" })).toHaveValue("4.10");
  // Kind cannot change in edit mode (changing kind would break the encrypted shape).
  await expect.element(screen.getByRole("button", { name: "Cash" })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "Investment" })).toBeDisabled();
});

test("edit mode submits the edited values under Save changes", async () => {
  const onSubmit = vi.fn(() => Promise.resolve());
  const account = makeAccount({
    kind: "cash",
    subKind: "checking",
    name: "Old Name",
    balanceCents: "10000",
    currency: "USD",
  });
  const screen = await render(
    <AccountForm open account={account} onClose={() => {}} onSubmit={onSubmit} />,
  );

  await screen.getByRole("textbox", { name: "Name" }).fill("New Name");
  await screen.getByRole("button", { name: "Save changes" }).click();

  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ name: "New Name", kind: "cash", subKind: "checking" }),
  );
});

test("edit mode prefills a liability rate and term and submits them", async () => {
  const onSubmit = vi.fn(() => Promise.resolve());
  const account = makeAccount({
    kind: "liability",
    subKind: "mortgage",
    name: "Mortgage",
    balanceCents: "30000000", // $300,000
    currency: "USD",
    interestRate: "0.0625",
    termYearsRemaining: "22",
  });
  const screen = await render(
    <AccountForm open account={account} onClose={() => {}} onSubmit={onSubmit} />,
  );

  await expect
    .element(screen.getByRole("textbox", { name: "Rate (optional)" }))
    .toHaveValue("6.25");
  await expect
    .element(screen.getByRole("textbox", { name: "Years left (optional)" }))
    .toHaveValue("22");

  await screen.getByRole("button", { name: "Save changes" }).click();
  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ interestRate: "6.25", termYears: "22" }),
  );
});

test("a typed name is preserved when the parent re-renders", async () => {
  const onSubmit = vi.fn(() => Promise.resolve());
  const screen = await render(<AccountForm open onClose={() => {}} onSubmit={onSubmit} />);

  await screen.getByRole("textbox", { name: "Name" }).fill("Survives Rerender");

  // Re-render with the same props (simulates a parent re-render from new data)
  screen.rerender(<AccountForm open onClose={() => {}} onSubmit={onSubmit} />);

  await expect
    .element(screen.getByRole("textbox", { name: "Name" }))
    .toHaveValue("Survives Rerender");
});
