import { useState } from "react";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { useKeepLastNonNull } from "./use-keep-last";

// The sheet parents hold the selected row in state, null it on close, and keep
// rendering the sheet against the retained last value so the exit transition
// still has content. The hook must keep returning the last non-null value until
// a new row is selected.
function Harness() {
  const [value, setValue] = useState<string | null>("first");
  const shown = useKeepLastNonNull(value);
  return (
    <>
      <output data-testid="shown">{shown ?? "null"}</output>
      <button type="button" onClick={() => setValue(null)}>
        clear
      </button>
      <button type="button" onClick={() => setValue("second")}>
        second
      </button>
    </>
  );
}

test("retains the last non-null value while the live value is null", async () => {
  const screen = await render(<Harness />);
  const shown = () => screen.getByTestId("shown").element();

  expect(shown().textContent).toBe("first");

  await screen.getByRole("button", { name: "clear" }).click();
  expect(shown().textContent).toBe("first");

  await screen.getByRole("button", { name: "second" }).click();
  expect(shown().textContent).toBe("second");

  await screen.getByRole("button", { name: "clear" }).click();
  expect(shown().textContent).toBe("second");
});
