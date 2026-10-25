import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import "@/app/globals.css";
import { HoldingDialog, type HoldingDialogMode } from "./holding-dialog";

it("starts a new inline-group create intent when the same holding form is reopened", async () => {
  const ids: string[] = [];
  const props = {
    mode: {
      kind: "edit",
      holding: {
        id: "holding",
        accountId: "parent",
        groupId: null,
        ticker: "AAPL",
        assetType: "stock",
        proxyTicker: null,
        sharesMajor: "1",
        sharesScale: 4,
        costBasisCents: "10000",
        scaleFactor: undefined,
        proxyAnchoredAt: undefined,
        name: undefined,
        updatedAt: 0,
      },
    } as HoldingDialogMode,
    investmentAccounts: [],
    groups: [],
    onClose: () => {},
    onSubmit: vi.fn(),
    onCreateGroup: async (_name: string, id: string) => {
      ids.push(id);
      throw new Error("Unconfirmed group");
    },
    submitting: false,
  };
  const screen = await render(<HoldingDialog open {...props} />);
  await screen.getByRole("textbox", { name: "New group name" }).fill("Pending group");
  await screen.getByRole("button", { name: "Create group" }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Unconfirmed group");
  await screen.rerender(<HoldingDialog open={false} {...props} />);
  await screen.rerender(<HoldingDialog open {...props} />);
  await screen.getByRole("textbox", { name: "New group name" }).fill("Fresh group");
  await screen.getByRole("button", { name: "Create group" }).click();
  await vi.waitFor(() => expect(ids).toHaveLength(2));
  expect(ids[1]).not.toBe(ids[0]);
});
