import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DateField } from "./DateField";
// Real stylesheet so the shadcn token utilities and popover render as in-app.
import "@/globals.css";

function Harness({
  initial = "",
  onChange,
  onBlur,
}: {
  initial?: string;
  onChange?: (v: string) => void;
  onBlur?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateField
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      onBlur={onBlur}
    />
  );
}

test("shows the placeholder when no date is set", async () => {
  const screen = await render(<Harness />);
  await expect.element(screen.getByText("Select a date")).toBeVisible();
});

test("renders the set date without a timezone day-shift", async () => {
  const screen = await render(<Harness initial="2026-06-15" />);
  // A UTC-parsed date would render the 14th in negative-offset zones; assert the
  // exact calendar day survives.
  await expect.element(screen.getByText(/\b15\b/)).toBeVisible();
  await expect.element(screen.getByText(/2026/)).toBeVisible();
});

test("selecting a day emits the local YYYY-MM-DD string", async () => {
  const onChange = vi.fn();
  const screen = await render(<Harness initial="2026-06-15" onChange={onChange} />);
  await screen.getByText(/\b15\b/).click(); // open the popover via the trigger
  await screen.getByText("22", { exact: true }).click();
  expect(onChange).toHaveBeenCalledWith("2026-06-22");
});

test("clear resets the value", async () => {
  const onChange = vi.fn();
  const screen = await render(<Harness initial="2026-06-15" onChange={onChange} />);
  await screen.getByText(/\b15\b/).click();
  await screen.getByRole("button", { name: "Clear" }).click();
  expect(onChange).toHaveBeenCalledWith("");
});

test("fires onBlur when the picker closes, so react-hook-form onBlur validation runs", async () => {
  const onBlur = vi.fn();
  const screen = await render(<Harness onBlur={onBlur} />);
  await screen.getByText("Select a date").click();
  await screen.getByText("Select a date").click();
  expect(onBlur).toHaveBeenCalled();
});

test("stays interactive inside a shadcn Dialog", async () => {
  // The forms render the date field inside a Dialog. A nested Radix Popover must
  // remain clickable rather than be blocked by the dialog's layer.
  function Dialoged({ onChange }: { onChange: (v: string) => void }) {
    const [value, setValue] = useState("2026-06-15");
    return (
      <Dialog open>
        <DialogContent>
          <DialogTitle className="sr-only">Pick a date</DialogTitle>
          <DateField
            value={value}
            onChange={(v) => {
              setValue(v);
              onChange(v);
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }
  const onChange = vi.fn();
  const screen = await render(<Dialoged onChange={onChange} />);
  await screen.getByText(/\b15\b/).click();
  await screen.getByText("22", { exact: true }).click();
  expect(onChange).toHaveBeenCalledWith("2026-06-22");
});
