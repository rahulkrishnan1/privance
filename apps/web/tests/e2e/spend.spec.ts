import { expect, test } from "@playwright/test";
import { BASE_URL } from "../../playwright/ports";
import type { SessionSnapshot } from "./helpers/auth";
import { restoreSession, signupAndLogin } from "./helpers/auth";

const PASS = "Privance-e2e-passphrase-2026!";
const RUN = Date.now().toString(36);

let session: SessionSnapshot;

test.beforeAll(async ({ browser }) => {
  const result = await signupAndLogin(browser, {
    username: `erin-${RUN}`,
    password: PASS,
  });
  session = result.session;
});

test.describe("spend -- happy path", () => {
  test("empty state, add monthly + yearly, pause, remove", async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, session);

    await page.goto("/app/spend");
    await expect(page).toHaveURL(/\/app\/spend/, { timeout: 15_000 });

    // Step 1: empty state.
    await expect(page.getByRole("heading", { name: /Nothing recurring/ })).toBeVisible({
      timeout: 10_000,
    });
    const emptyCta = page.getByRole("button", { name: "Add a recurring expense" });
    await expect(emptyCta).toBeVisible();

    // Step 2: add a monthly Rent of $1,450 (housing).
    await emptyCta.click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add expense" })).toBeVisible({
      timeout: 5_000,
    });
    await dialog.getByLabel("Amount").fill("1450");
    await dialog.getByLabel("Interval unit").selectOption("month");
    await dialog.getByLabel("Name").fill("Rent");
    await dialog.getByLabel("Category").selectOption("housing");
    await dialog.getByRole("button", { name: "Add expense", exact: true }).click();

    const rentRow = page.getByRole("button", { name: /Rent/ });
    await expect(rentRow).toBeVisible({ timeout: 10_000 });
    // Monthly item shows the whole-dollar amount, no cents.
    await expect(rentRow).toContainText("$1,450");
    await expect(page.getByTestId("spend-monthly-total")).toContainText("$1,450");

    // Step 3: add a yearly Prime of $139 (shopping).
    await page.getByRole("button", { name: "+ Add expense" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add expense" })).toBeVisible({
      timeout: 5_000,
    });
    await dialog.getByLabel("Amount").fill("139");
    await dialog.getByLabel("Interval unit").selectOption("year");
    await dialog.getByLabel("Name").fill("Prime");
    await dialog.getByLabel("Category").selectOption("shopping");
    await dialog.getByRole("button", { name: "Add expense", exact: true }).click();

    const primeRow = page.getByRole("button", { name: /Prime/ });
    await expect(primeRow).toBeVisible({ timeout: 10_000 });
    // The row shows the monthly equivalent ($139 / 12 = $11.58) as its figure. The
    // headline total proves the monthly equivalent (not the raw $139) is counted:
    // $1,450 + $11.58 = $1,461.58, rounded to $1,462.
    await expect(primeRow).toContainText("$11.58");
    await expect(page.getByTestId("spend-monthly-total")).toContainText("$1,462");

    // Step 4: edit Rent's amount; the row and headline total recompute.
    await rentRow.click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Edit Rent" })).toBeVisible({
      timeout: 5_000,
    });
    await dialog.getByLabel("Amount").fill("2000");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(rentRow).toContainText("$2,000");
    // $2,000 + $11.58 = $2,011.58, rounded to $2,012.
    await expect(page.getByTestId("spend-monthly-total")).toContainText("$2,012");

    // Step 5: pause Prime; it drops out of the total but stays listed.
    await primeRow.click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Edit Prime" })).toBeVisible({
      timeout: 5_000,
    });
    await dialog.getByRole("radio", { name: "Paused" }).click();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("paused", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("spend-monthly-total")).toContainText("$2,000");

    // Step 6: remove Prime via the two-tap confirm.
    await primeRow.click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Edit Prime" })).toBeVisible({
      timeout: 5_000,
    });
    await dialog.getByRole("button", { name: "Delete" }).click();
    let armed = dialog.getByRole("button", { name: "Tap again to delete" });
    await expect(armed).toBeVisible({ timeout: 3_000 });
    await armed.click();
    await expect(page.getByRole("button", { name: /Prime/ })).not.toBeVisible({ timeout: 10_000 });

    // Step 7: remove the last item (Rent); the empty state returns.
    await rentRow.click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Edit Rent" })).toBeVisible({
      timeout: 5_000,
    });
    await dialog.getByRole("button", { name: "Delete" }).click();
    armed = dialog.getByRole("button", { name: "Tap again to delete" });
    await expect(armed).toBeVisible({ timeout: 3_000 });
    await armed.click();
    await expect(page.getByRole("heading", { name: /Nothing recurring/ })).toBeVisible({
      timeout: 10_000,
    });

    await ctx.close();
  });
});
