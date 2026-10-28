import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import "@/app/globals.css";
import { HoldingForm } from "./holding-form";

it("shows an unconfirmed inline group create without selecting it or clearing the entered name", async () => {
  const message = "Not saved to the server. Reloading can lose these changes.";
  const screen = await render(
    <HoldingForm
      isEdit
      investmentAccounts={[]}
      groups={[]}
      onSubmit={vi.fn()}
      onCreateGroup={async () => {
        throw new Error(message);
      }}
    />,
  );
  await screen.getByRole("textbox", { name: "New group name" }).fill("Unsaved group");
  await screen.getByRole("button", { name: "Create group" }).click();
  await expect.element(screen.getByRole("alert")).toMatchTextContent(message);
  await expect
    .element(screen.getByRole("textbox", { name: "New group name" }))
    .toHaveValue("Unsaved group");
  expect(screen.getByText(/Selected:/).query()).toBeNull();
});

it("scopes group identity to a failed create attempt, not later independent groups", async () => {
  const ids: string[] = [];
  const onCreateGroup = async (_name: string, id: string) => {
    ids.push(id);
    if (ids.length === 1) throw new Error("Response lost after commit");
    return id;
  };
  const screen = await render(
    <HoldingForm
      isEdit
      investmentAccounts={[]}
      groups={[]}
      onSubmit={vi.fn()}
      onCreateGroup={onCreateGroup}
    />,
  );
  await screen.getByRole("textbox", { name: "New group name" }).fill("First");
  await screen.getByRole("button", { name: "Create group" }).click();
  await expect.element(screen.getByRole("alert")).toMatchTextContent("Response lost after commit");
  await screen.getByRole("textbox", { name: "New group name" }).fill("Changed");
  await screen.getByRole("button", { name: "Create group" }).click();
  await expect.element(screen.getByRole("textbox", { name: "New group name" })).toHaveValue("");
  expect(ids[1]).toBe(ids[0]);
  await screen.getByRole("textbox", { name: "New group name" }).fill("Fresh");
  await screen.getByRole("button", { name: "Create group" }).click();
  await vi.waitFor(() => expect(ids).toHaveLength(3));
  expect(ids[2]).not.toBe(ids[0]);
});
