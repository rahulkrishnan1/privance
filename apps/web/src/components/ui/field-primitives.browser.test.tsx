import { useRef } from "react";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import "@/globals.css";
import { Input as Field } from "@/components/Input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// The composite field (label + ui/input control + inline error) must wire the
// error to the control for assistive tech, not just show red text.
test("composite Input links its error to the control for assistive tech", async () => {
  const screen = await render(<Field label="Cash balance" error="Enter a dollar amount." />);

  const input = screen.getByLabelText("Cash balance").element();
  await expect.element(screen.getByText("Enter a dollar amount.")).toBeVisible();
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const describedBy = input.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  expect(document.getElementById(describedBy ?? "")?.textContent).toContain(
    "Enter a dollar amount.",
  );
});

test("composite Input has no error wiring when valid", async () => {
  const screen = await render(<Field label="Name" />);
  const input = screen.getByLabelText("Name").element();
  expect(input.getAttribute("aria-invalid")).toBe("false");
  expect(input.getAttribute("aria-describedby")).toBeNull();
});

test("composite Input forwards its ref to the underlying control (RHF focus-on-error)", async () => {
  function Harness() {
    const ref = useRef<HTMLInputElement>(null);
    return (
      <>
        <Field ref={ref} label="Ticker" />
        <button type="button" onClick={() => ref.current?.focus()}>
          focus
        </button>
      </>
    );
  }
  const screen = await render(<Harness />);
  await screen.getByRole("button", { name: "focus" }).click();
  expect(document.activeElement).toBe(screen.getByLabelText("Ticker").element());
});

test("Select marks itself aria-invalid only when invalid", async () => {
  const valid = await render(
    <Select aria-label="Account type" invalid={false}>
      <option>Brokerage</option>
    </Select>,
  );
  expect(valid.getByRole("combobox").element().getAttribute("aria-invalid")).toBeNull();

  const invalid = await render(
    <Select aria-label="Account kind" invalid>
      <option>Brokerage</option>
    </Select>,
  );
  expect(
    invalid.getByRole("combobox", { name: "Account kind" }).element().getAttribute("aria-invalid"),
  ).toBe("true");
});

test("bare Input reflects aria-invalid and accepts a value", async () => {
  const screen = await render(<Input aria-label="Amount" aria-invalid defaultValue="abc" />);
  const input = screen.getByLabelText("Amount").element() as HTMLInputElement;
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.value).toBe("abc");
});

test("bare Textarea reflects aria-invalid", async () => {
  const screen = await render(<Textarea aria-label="Phrase" aria-invalid defaultValue="word" />);
  expect(screen.getByLabelText("Phrase").element().getAttribute("aria-invalid")).toBe("true");
});

test("Button loading shows the spinner, marks aria-busy, and disables", async () => {
  const screen = await render(
    <Button loading onClick={() => {}}>
      Save
    </Button>,
  );
  const button = screen.getByRole("button", { name: /Save/ }).element() as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.querySelector("svg")).not.toBeNull();
});

test("Button variants render their label as a real button", async () => {
  const screen = await render(
    <>
      <Button variant="secondary">Cancel</Button>
      <Button variant="danger">Delete</Button>
    </>,
  );
  await expect.element(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Delete" })).toBeVisible();
});

test("Button size=icon keeps real dimensions (never collapses to 0)", async () => {
  const screen = await render(
    <Button size="icon" aria-label="close">
      x
    </Button>,
  );
  const rect = screen.getByRole("button", { name: "close" }).element().getBoundingClientRect();
  expect(rect.width).toBeGreaterThanOrEqual(32);
  expect(rect.height).toBeGreaterThanOrEqual(32);
});

test("Button variant=dangerOutline is visible and enabled by default", async () => {
  const screen = await render(<Button variant="dangerOutline">Remove</Button>);
  const button = screen.getByRole("button", { name: "Remove" });
  await expect.element(button).toBeVisible();
  expect((button.element() as HTMLButtonElement).disabled).toBe(false);
});
