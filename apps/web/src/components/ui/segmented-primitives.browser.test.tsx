import { useState } from "react";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import "@/app/globals.css";
import { Select as SelectField } from "@/components/Select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function pressActive(key: string) {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

// The headline a11y fix: a single-select segmented control must be arrow-key
// navigable (the hand-rolled radiogroups were not). Radix RadioGroup gives
// roving focus + selection; assert the selection actually moves on ArrowRight.
test("RadioGroup selects the next option on ArrowRight", async () => {
  const screen = await render(
    <RadioGroup defaultValue="equity" aria-label="Asset type">
      <RadioGroupItem value="equity">Equity</RadioGroupItem>
      <RadioGroupItem value="crypto">Crypto</RadioGroupItem>
      <RadioGroupItem value="cash">Cash</RadioGroupItem>
    </RadioGroup>,
  );
  const equity = screen.getByRole("radio", { name: "Equity" });
  await equity.click();
  pressActive("ArrowRight");

  await expect
    .poll(() =>
      screen.getByRole("radio", { name: "Crypto" }).element().getAttribute("aria-checked"),
    )
    .toBe("true");
  expect(equity.element().getAttribute("aria-checked")).toBe("false");
});

test("ToggleGroup (single) reflects the selected item as pressed", async () => {
  function Harness() {
    const [value, setValue] = useState("class");
    return (
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && setValue(v)}
        aria-label="Allocation view"
      >
        <ToggleGroupItem value="class">By class</ToggleGroupItem>
        <ToggleGroupItem value="sector">By sector</ToggleGroupItem>
      </ToggleGroup>
    );
  }
  const screen = await render(<Harness />);
  await screen.getByRole("radio", { name: "By sector" }).click();
  expect(
    screen.getByRole("radio", { name: "By sector" }).element().getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    screen.getByRole("radio", { name: "By class" }).element().getAttribute("aria-checked"),
  ).toBe("false");
});

test("ToggleGroup (single) with guarded onValueChange cannot be deselected by re-clicking the active item", async () => {
  function Harness() {
    const [value, setValue] = useState("class");
    return (
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(nv) => nv && setValue(nv)}
        aria-label="Allocation view"
      >
        <ToggleGroupItem value="class">By class</ToggleGroupItem>
        <ToggleGroupItem value="sector">By sector</ToggleGroupItem>
      </ToggleGroup>
    );
  }
  const screen = await render(<Harness />);
  const byClass = screen.getByRole("radio", { name: "By class" });
  expect(byClass.element().getAttribute("aria-checked")).toBe("true");
  await byClass.click();
  await expect.poll(() => byClass.element().getAttribute("aria-checked")).toBe("true");
});

test("ToggleGroup (multiple) is not exposed as a radiogroup", async () => {
  // Only the single-select variant claims radiogroup semantics; a multi-select
  // group must stay a plain group so AT does not announce a single choice.
  const screen = await render(
    <ToggleGroup type="multiple" aria-label="Filters">
      <ToggleGroupItem value="a">A</ToggleGroupItem>
      <ToggleGroupItem value="b">B</ToggleGroupItem>
    </ToggleGroup>,
  );
  await expect.element(screen.getByText("A")).toBeVisible();
  expect(document.querySelector('[role="radiogroup"]')).toBeNull();
});

test("Switch toggles aria-checked when clicked", async () => {
  function Harness() {
    const [on, setOn] = useState(false);
    return <Switch checked={on} onCheckedChange={setOn} aria-label="Start veiled" />;
  }
  const screen = await render(<Harness />);
  const sw = screen.getByRole("switch", { name: "Start veiled" });
  expect(sw.element().getAttribute("aria-checked")).toBe("false");
  await sw.click();
  expect(sw.element().getAttribute("aria-checked")).toBe("true");
});

test("composite Select links its error to the control for assistive tech", async () => {
  const screen = await render(
    <SelectField label="Account type" error="Choose a type.">
      <option value="">Select…</option>
      <option value="taxable">Taxable</option>
    </SelectField>,
  );
  const select = screen.getByLabelText("Account type").element();
  await expect.element(screen.getByText("Choose a type.")).toBeVisible();
  expect(select.getAttribute("aria-invalid")).toBe("true");
  const describedBy = select.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  expect(document.getElementById(describedBy ?? "")?.textContent).toContain("Choose a type.");
});
