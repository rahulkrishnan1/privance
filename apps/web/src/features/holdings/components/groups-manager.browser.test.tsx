import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import "@/app/globals.css";
import { GroupsManager } from "./groups-manager";

const message = "Not saved to the server. Reloading can lose these changes.";
it.each(["rename", "delete"] as const)(
  "shows an unconfirmed group %s in the active dialog without an unhandled rejection",
  async (action) => {
    const reject = vi.fn(async () => {
      throw new Error(message);
    });
    const screen = await render(
      <GroupsManager
        open
        groups={[{ id: "group", name: "Group", updatedAt: 0 }]}
        onClose={() => {}}
        onRename={reject}
        onDelete={reject}
      />,
    );
    if (action === "rename") {
      await screen.getByRole("button", { name: "Rename Group" }).click();
      await screen.getByRole("textbox", { name: "Group name" }).fill("Changed");
      await screen.getByRole("button", { name: "Save group name" }).click();
    } else {
      await screen.getByRole("button", { name: "Delete Group" }).click();
      await screen.getByRole("button", { name: "Confirm delete" }).click();
    }
    await expect.element(screen.getByRole("dialog").getByRole("alert")).toHaveTextContent(message);
    expect(reject).toHaveBeenCalledTimes(1);
    if (action === "rename")
      await expect
        .element(screen.getByRole("textbox", { name: "Group name" }))
        .toHaveValue("Changed");
    else await expect.element(screen.getByRole("dialog")).toHaveTextContent('Delete "Group"?');
  },
);
