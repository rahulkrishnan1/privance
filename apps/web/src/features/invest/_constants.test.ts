import { describe, expect, it } from "vitest";
import {
  INVESTMENT_TYPE_OPTIONS,
  SUBKIND_TAG,
  TAX_TREATMENT_BY_SUBKIND,
  TAX_TREATMENT_LABEL,
} from "./_constants";

describe("INVESTMENT_TYPE_OPTIONS", () => {
  it("starts with taxable brokerage", () => {
    expect(INVESTMENT_TYPE_OPTIONS[0].value).toBe("brokerage");
    expect(INVESTMENT_TYPE_OPTIONS[0].label).toBe("Taxable brokerage");
  });

  it("contains all common retirement account types", () => {
    const values = INVESTMENT_TYPE_OPTIONS.map((o) => o.value);
    expect(values).toContain("401k");
    expect(values).toContain("roth_401k");
    expect(values).toContain("ira");
    expect(values).toContain("roth_ira");
    expect(values).toContain("hsa");
    expect(values).toContain("529");
  });
});

describe("tax-treatment coverage", () => {
  // The dropdown drives what a user can pick; every selectable type must resolve
  // to a tax treatment, a treatment label, and a tag, or the detail UI renders
  // "undefined". This catches a new dropdown option shipped without a mapping.
  it("every selectable investment type has a treatment, a label, and a tag", () => {
    for (const option of INVESTMENT_TYPE_OPTIONS) {
      const treatment = TAX_TREATMENT_BY_SUBKIND[option.value];
      expect(treatment, `no treatment for ${option.value}`).toBeDefined();
      expect(TAX_TREATMENT_LABEL[treatment], `no label for ${treatment}`).toBeTruthy();
      expect(SUBKIND_TAG[option.value], `no tag for ${option.value}`).toBeTruthy();
    }
  });

  it("anchors a couple of treatments so a silent table-wide flip is caught", () => {
    expect(TAX_TREATMENT_BY_SUBKIND.brokerage).toBe("taxable");
    expect(TAX_TREATMENT_BY_SUBKIND["401k"]).toBe("pretax");
    expect(TAX_TREATMENT_BY_SUBKIND.roth_ira).toBe("roth");
  });
});
