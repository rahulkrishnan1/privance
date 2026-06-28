import { Decimal, SCALE_CENTS } from "@privance/core";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { PlanFormValues } from "../types";
import { AdjustPanel } from "./adjust-panel";

const VALUES: PlanFormValues = {
  currentAge: 35,
  planUntilAge: 95,
  monthlyContribution: 1000,
  annualSpend: 40000,
  swrPercent: 4,
  preset: "balanced",
};

const POT = Decimal.fromMinorUnits(50_000_000n, SCALE_CENTS);

function renderPanel(overrides?: Partial<Parameters<typeof AdjustPanel>[0]>) {
  return render(
    <AdjustPanel
      values={VALUES}
      potCents={POT}
      baseline={VALUES}
      currentFireAge={49}
      currentNeverFi={false}
      baselineFireAge={49}
      baselineNeverFi={false}
      dirty={false}
      saving={false}
      onChange={() => {}}
      onSave={() => {}}
      {...overrides}
    />,
  );
}

test("readout shows the current FIRE age with no delta when it matches the saved plan", async () => {
  const screen = await renderPanel({ currentFireAge: 49, baselineFireAge: 49 });
  await expect.element(screen.getByText("FI age")).toBeVisible();
  await expect.element(screen.getByText("49")).toBeVisible();
  expect(screen.getByText(/sooner|later/).query()).toBeNull();
});

test("readout shows a sooner delta when the plan reaches FI earlier than the saved one", async () => {
  const screen = await renderPanel({ currentFireAge: 49, baselineFireAge: 52 });
  await expect.element(screen.getByText(/3 yrs sooner/)).toBeVisible();
});

test("readout shows a later delta when the plan reaches FI after the saved one", async () => {
  const screen = await renderPanel({ currentFireAge: 54, baselineFireAge: 49 });
  await expect.element(screen.getByText(/5 yrs later/)).toBeVisible();
});

test("readout uses the singular year for a one-year delta", async () => {
  const screen = await renderPanel({ currentFireAge: 48, baselineFireAge: 49 });
  await expect.element(screen.getByText(/1 yr sooner/)).toBeVisible();
});

test("readout reports off-track when the current plan never reaches FI", async () => {
  const screen = await renderPanel({ currentNeverFi: true });
  await expect.element(screen.getByText("Off track at this setting")).toBeVisible();
  expect(screen.getByText("FI age").query()).toBeNull();
});

test("no sooner/later delta is shown when the saved plan itself never reaches FI", async () => {
  // baselineNeverFi forces delta to 0: there's no FIRE age to measure against.
  const screen = await renderPanel({
    baselineNeverFi: true,
    currentFireAge: 49,
    baselineFireAge: 60,
  });
  await expect.element(screen.getByText("FI age")).toBeVisible();
  await expect.element(screen.getByText("49")).toBeVisible();
  expect(screen.getByText(/sooner|later/).query()).toBeNull();
});

test("only the stock-allocation lever keeps an explanatory subtitle", async () => {
  const screen = await renderPanel();
  // The allocation lever's expected-return note stays...
  await expect.element(screen.getByText(/expected real return/)).toBeVisible();
  // ...while the contribution/spend/withdrawal subtitles are gone.
  expect(screen.getByText(/the more you save/).query()).toBeNull();
  expect(screen.getByText(/spending divided by your withdrawal rate/).query()).toBeNull();
  expect(screen.getByText(/survives more bad decades/).query()).toBeNull();
});

test("current age below the schema minimum is clamped on entry", async () => {
  const onChange = vi.fn();
  const screen = await renderPanel({ onChange });
  await screen.getByRole("textbox", { name: "Current age" }).fill("2");
  expect(onChange).toHaveBeenCalledWith({ currentAge: 16 });
});

test("current age is capped at 100 (and below plan-until age)", async () => {
  const onChange = vi.fn();
  const screen = await renderPanel({ values: { ...VALUES, planUntilAge: 110 }, onChange });
  await screen.getByRole("textbox", { name: "Current age" }).fill("200");
  expect(onChange).toHaveBeenCalledWith({ currentAge: 100 });
});

test("plan-until age is floored just above the current age", async () => {
  const onChange = vi.fn();
  const screen = await renderPanel({ onChange }); // currentAge 35
  await screen.getByRole("textbox", { name: "Plan until age" }).fill("5");
  expect(onChange).toHaveBeenCalledWith({ planUntilAge: 36 });
});

test("slider ranges reach realistic values from a default plan", async () => {
  // Regression: ranges used to cap at 2x the saved plan, so a default $40k plan
  // couldn't reach $100k without saving first to widen the track.
  const screen = await renderPanel();
  const spend = screen.getByRole("slider", { name: "Target annual spend" });
  await expect.element(spend).toHaveAttribute("min", "30000");
  await expect.element(spend).toHaveAttribute("max", "200000");
  await expect
    .element(screen.getByRole("slider", { name: "Monthly contribution" }))
    .toHaveAttribute("max", "25000");
});

test("starting-portfolio source switches to manual, prefilling from accounts", async () => {
  const onChange = vi.fn();
  const screen = await renderPanel({ onChange });
  await screen.getByRole("radio", { name: "Manual" }).click();
  expect(onChange).toHaveBeenCalledWith({ manualStartingDollars: 500000 });
});

test("switching the source back to accounts clears the manual amount", async () => {
  const onChange = vi.fn();
  const screen = await renderPanel({
    values: { ...VALUES, manualStartingDollars: 12345 },
    onChange,
  });
  await screen.getByRole("radio", { name: "Accounts" }).click();
  expect(onChange).toHaveBeenCalledWith({ manualStartingDollars: undefined });
});

test("save control is enabled for unsaved, savable changes", async () => {
  const screen = await renderPanel({ dirty: true });
  await expect.element(screen.getByRole("button", { name: "Save plan" })).toBeEnabled();
});

test("save control is disabled while saving and reads as in-progress", async () => {
  const screen = await renderPanel({ dirty: true, saving: true });
  await expect.element(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();
  await expect.element(screen.getByText("Saving…")).toBeVisible();
});

test("save control is disabled when saving is blocked by an error", async () => {
  const screen = await renderPanel({ dirty: true, saveDisabled: true });
  await expect.element(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();
});

test("an out-of-band withdrawal rate surfaces a warning", async () => {
  const screen = await renderPanel({ values: { ...VALUES, swrPercent: 8 } });
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await expect.element(screen.getByText(/SWR above 6%/)).toBeVisible();
});

test("a failed save surfaces a retry prompt", async () => {
  const screen = await renderPanel({ dirty: true, saveError: true });
  await expect.element(screen.getByText(/Could not save your plan/)).toBeVisible();
});

test("the Cautious snap selects the conservative preset", async () => {
  const onChange = vi.fn();
  const screen = await renderPanel({ onChange });
  await screen.getByRole("radio", { name: "Cautious" }).click();
  expect(onChange).toHaveBeenCalledWith({ preset: "conservative" });
});

test("the Balanced snap selects the balanced preset", async () => {
  const onChange = vi.fn();
  // Start from a non-balanced plan so the Balanced snap is not already active.
  const screen = await renderPanel({ onChange, values: { ...VALUES, preset: "aggressive" } });
  await screen.getByRole("radio", { name: "Balanced" }).click();
  expect(onChange).toHaveBeenCalledWith({ preset: "balanced" });
});

test("the Aggressive snap selects the aggressive preset", async () => {
  const onChange = vi.fn();
  const screen = await renderPanel({ onChange });
  await screen.getByRole("radio", { name: "Aggressive" }).click();
  expect(onChange).toHaveBeenCalledWith({ preset: "aggressive" });
});

test("the monthly-contribution lever reports its new value on change", async () => {
  const onChange = vi.fn();
  const screen = await renderPanel({ onChange });
  await screen.getByRole("slider", { name: "Monthly contribution" }).fill("2000");
  expect(onChange).toHaveBeenCalledWith({ monthlyContribution: 2000 });
});

test("the annual-spend lever reports its new value on change", async () => {
  const onChange = vi.fn();
  const screen = await renderPanel({ onChange });
  await screen.getByRole("slider", { name: "Target annual spend" }).fill("60000");
  expect(onChange).toHaveBeenCalledWith({ annualSpend: 60000 });
});

test("dragging the stock-allocation lever switches to a custom preset with the chosen weight", async () => {
  const onChange = vi.fn();
  const screen = await renderPanel({ onChange });
  await screen.getByRole("slider", { name: "Stock allocation (percent stocks)" }).fill("75");
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ preset: "custom" }));
  const patch = onChange.mock.calls.at(-1)?.[0] as { stockWeightPercent: number };
  expect(patch.stockWeightPercent).toBe(75);
});

test("typing keeps in-progress text even when the committed value clamps it", async () => {
  // Regression: the committed value (clamped to 16) used to overwrite the
  // in-progress "4" via the resync effect, so a multi-digit age couldn't be
  // typed. The field stays focused, so the typed text must survive the clamp.
  function Controlled() {
    const [v, setV] = useState<PlanFormValues>(VALUES);
    return (
      <AdjustPanel
        values={v}
        potCents={POT}
        baseline={VALUES}
        currentFireAge={49}
        currentNeverFi={false}
        baselineFireAge={49}
        baselineNeverFi={false}
        dirty={false}
        saving={false}
        onChange={(p) => setV((prev) => ({ ...prev, ...p }))}
        onSave={() => {}}
      />
    );
  }
  const screen = await render(<Controlled />);
  const age = screen.getByRole("textbox", { name: "Current age" });
  await age.fill("4");
  await expect.element(age).toHaveValue("4");
});
