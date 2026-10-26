import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import "@/app/globals.css";
import { SpendForm } from "./spend-form";

it("keeps the expense form open with the exact unconfirmed-save message", async () => {
  const message = "Not saved to the server. Reloading can lose these changes.";
  const onClose = vi.fn();
  const screen = await render(
    <SpendForm
      open
      submitting={false}
      onClose={onClose}
      onSave={async () => {
        throw new Error(message);
      }}
    />,
  );
  await screen.getByRole("textbox", { name: "Name" }).fill("Rent");
  await screen.getByRole("textbox", { name: "Amount" }).fill("100.00");
  await screen.getByRole("combobox", { name: "Interval unit" }).selectOptions("month");
  await screen.getByRole("combobox", { name: "Category" }).selectOptions("housing");
  await screen.getByRole("button", { name: "Add expense" }).click();
  await expect.element(screen.getByRole("dialog").getByRole("alert")).toHaveTextContent(message);
  await expect.element(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Rent");
  expect(onClose).not.toHaveBeenCalled();
});

it("retains expense create identity on retry but not when the form is reopened", async () => {
  const ids: string[] = [];
  const onSave = async (_values: unknown, id: string) => {
    ids.push(id);
    if (ids.length === 1) throw new Error("Response lost after commit");
  };
  const screen = await render(
    <SpendForm open submitting={false} onClose={() => {}} onSave={onSave} />,
  );
  const fill = async () => {
    await screen.getByRole("textbox", { name: "Name" }).fill("Expense");
    await screen.getByRole("textbox", { name: "Amount" }).fill("100.00");
    await screen.getByRole("combobox", { name: "Interval unit" }).selectOptions("month");
    await screen.getByRole("combobox", { name: "Category" }).selectOptions("housing");
  };
  await fill();
  await screen.getByRole("button", { name: "Add expense" }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Response lost after commit");
  await screen.getByRole("textbox", { name: "Name" }).fill("Changed expense");
  await screen.getByRole("button", { name: "Add expense" }).click();
  await vi.waitFor(() => expect(ids).toHaveLength(2));
  expect(ids[1]).toBe(ids[0]);
  await screen.rerender(
    <SpendForm open={false} submitting={false} onClose={() => {}} onSave={onSave} />,
  );
  await screen.rerender(<SpendForm open submitting={false} onClose={() => {}} onSave={onSave} />);
  await fill();
  await screen.getByRole("button", { name: "Add expense" }).click();
  await vi.waitFor(() => expect(ids).toHaveLength(3));
  expect(ids[2]).not.toBe(ids[0]);
});
