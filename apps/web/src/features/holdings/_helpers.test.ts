import { Decimal, SCALE_CENTS } from "@privance/core";
import { describe, expect, test } from "vitest";
import { sortByValueDesc } from "./_helpers";

const dollars = (n: string) => Decimal.fromString(n, SCALE_CENTS);

describe("sortByValueDesc", () => {
  test("orders by descending value, biggest first", () => {
    const items = [
      { id: "a", name: "Alpha", value: dollars("100") },
      { id: "b", name: "Bravo", value: dollars("300") },
      { id: "c", name: "Charlie", value: dollars("200") },
    ];
    const sorted = sortByValueDesc(
      items,
      (i) => i.value,
      (i) => i.name,
    );
    expect(sorted.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  test("breaks value ties by name ascending", () => {
    const items = [
      { name: "Zulu", value: dollars("50") },
      { name: "Alpha", value: dollars("50") },
    ];
    const sorted = sortByValueDesc(
      items,
      (i) => i.value,
      (i) => i.name,
    );
    expect(sorted.map((i) => i.name)).toEqual(["Alpha", "Zulu"]);
  });

  test("returns a new array and leaves the input order untouched", () => {
    const items = [
      { name: "A", value: dollars("1") },
      { name: "B", value: dollars("2") },
    ];
    const sorted = sortByValueDesc(
      items,
      (i) => i.value,
      (i) => i.name,
    );
    expect(sorted).not.toBe(items);
    expect(items.map((i) => i.name)).toEqual(["A", "B"]);
  });
});
