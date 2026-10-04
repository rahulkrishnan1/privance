import type { AccountId } from "@privance/core";
import { asId, Decimal, SCALE_CENTS } from "@privance/core";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { TaxBucket } from "../types";
import { TaxBucketsPanel } from "./tax-buckets-panel";
import "@/app/globals.css";

const dollars = (amount: bigint) => Decimal.fromMinorUnits(amount, SCALE_CENTS);

test("tax bucket rows expand to show contributing accounts and values", async () => {
  const buckets: TaxBucket[] = [
    {
      key: "taxable",
      label: "Taxable",
      valueCents: dollars(80_000n),
      accounts: [
        {
          accountId: asId<AccountId>("brokerage"),
          name: "Brokerage",
          valueCents: dollars(80_000n),
          detail: "investments",
        },
      ],
    },
    {
      key: "cash",
      label: "Cash",
      valueCents: dollars(20_000n),
      accounts: [
        {
          accountId: asId<AccountId>("brokerage"),
          name: "Brokerage",
          valueCents: dollars(20_000n),
          detail: "cash balance",
        },
      ],
    },
  ];
  const screen = await render(
    <TaxBucketsPanel buckets={buckets} reachableBeforeFiftyNineHalfCents={dollars(100_000n)} />,
  );

  const taxable = screen.getByRole("button", { name: /Taxable/ });
  const cash = screen.getByRole("button", { name: /Cash/ });

  expect(screen.getByText("investments", { exact: true }).query()).toBeNull();
  cash.element().focus();
  const bar = screen.getByRole("img", { name: "Tax bucket allocation bar" });
  const taxableSegment = bar.element().querySelectorAll("span").item(0);
  const cashSegment = bar.element().querySelectorAll("span").item(1);
  if (!taxableSegment || !cashSegment) throw new Error("expected two allocation segments");
  await expect.poll(() => getComputedStyle(cashSegment).opacity).toBe("1");
  await expect.poll(() => getComputedStyle(taxableSegment).opacity).toBe("0.5");
  cash.element().blur();
  await expect.poll(() => getComputedStyle(cashSegment).opacity).toBe("1");
  await expect.poll(() => getComputedStyle(taxableSegment).opacity).toBe("1");

  await taxable.click();
  await expect.element(taxable).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText("investments", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("$800", { exact: true }).last()).toBeVisible();

  await cash.click();
  await expect.element(taxable).toHaveAttribute("aria-expanded", "false");
  await expect.element(cash).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText("cash balance", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("$200", { exact: true }).last()).toBeVisible();

  await screen.getByRole("heading", { name: "Where it lives" }).hover();
  await expect.poll(() => getComputedStyle(cashSegment).opacity).toBe("1");
  await expect.poll(() => getComputedStyle(taxableSegment).opacity).toBe("0.5");
  await cash.element().blur();
  await expect.poll(() => getComputedStyle(cashSegment).opacity).toBe("1");
  await expect.poll(() => getComputedStyle(taxableSegment).opacity).toBe("0.5");

  await page.viewport(360, 780);
  try {
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await expect.element(cash).toBeVisible();
    await expect.element(screen.getByText("Brokerage", { exact: true })).toBeVisible();
  } finally {
    await page.viewport(1280, 800);
  }

  await cash.click();
  await screen.getByRole("heading", { name: "Where it lives" }).hover();
  await expect.poll(() => getComputedStyle(cashSegment).opacity).toBe("1");
  await expect.poll(() => getComputedStyle(taxableSegment).opacity).toBe("1");
});
