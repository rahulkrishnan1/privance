import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Decimal } from "./decimal.js";
import { DivisionByZeroError, ParseError, SCALE_CENTS, SCALE_CRYPTO } from "./types.js";

function d(s: string, scale?: number): Decimal {
  return Decimal.fromString(s, scale);
}

function arb(scale = SCALE_CENTS): fc.Arbitrary<Decimal> {
  const max = 10n ** BigInt(scale + 6);
  return fc.bigInt({ min: -max, max }).map((n) => Decimal.fromMinorUnits(n, scale));
}

/**
 * Independent banker (round-half-to-even) integer division oracle.
 * Written from the mathematical definition, NOT from Decimal's internals, so
 * it can falsify a regression in Decimal.div's rounding rather than mirror it.
 */
function bankerDivide(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  if (r === 0n) return q;
  const absR2 = (r < 0n ? -r : r) * 2n;
  const absDen = den < 0n ? -den : den;
  const positive = r > 0n === den > 0n;
  if (absR2 < absDen) return q;
  if (absR2 > absDen) return positive ? q + 1n : q - 1n;
  return q % 2n === 0n ? q : positive ? q + 1n : q - 1n;
}

describe("Decimal.fromString", () => {
  it("parses integer string", () => {
    expect(d("100").toMinorUnits()).toBe(10000n);
  });

  it("parses decimal string with leading zeros in frac", () => {
    expect(d("0.01").toMinorUnits()).toBe(1n);
  });

  it("parses negative", () => {
    expect(d("-12.50").toMinorUnits()).toBe(-1250n);
  });

  it("parses zero", () => {
    expect(d("0").isZero()).toBe(true);
  });

  it("parses scale-0 (units)", () => {
    expect(d("42", 0).toMinorUnits()).toBe(42n);
  });

  it("parses scale-8 (crypto)", () => {
    expect(d("1.00000001", 8).toMinorUnits()).toBe(100000001n);
  });

  it("throws ParseError on empty string", () => {
    expect(() => d("")).toThrow(ParseError);
  });

  it("throws ParseError on non-numeric input", () => {
    expect(() => d("abc")).toThrow(ParseError);
  });

  it("throws ParseError on too many decimal places", () => {
    expect(() => d("1.123", SCALE_CENTS)).toThrow(ParseError);
  });

  it("throws ParseError on scientific notation", () => {
    expect(() => d("1e5")).toThrow(ParseError);
  });
});

describe("Decimal.toString", () => {
  it("round-trips scale-2", () => {
    expect(d("12.34").toString()).toBe("12.34");
  });

  it("round-trips negative", () => {
    expect(d("-0.05").toString()).toBe("-0.05");
  });

  it("round-trips scale-0", () => {
    expect(d("99", 0).toString()).toBe("99");
  });

  it("round-trips scale-8 crypto", () => {
    expect(d("0.00000001", 8).toString()).toBe("0.00000001");
  });

  it("toJSON equals toString", () => {
    const dec = d("3.14");
    expect(dec.toJSON()).toBe(dec.toString());
  });
});

describe("add / sub", () => {
  it("adds two values at same scale", () => {
    expect(d("1.25").add(d("2.75")).toString()).toBe("4.00");
  });

  it("subtracts values", () => {
    expect(d("5.00").sub(d("2.50")).toString()).toBe("2.50");
  });

  it("sub to negative", () => {
    expect(d("1.00").sub(d("2.00")).toString()).toBe("-1.00");
  });

  it("add across scales upscales to higher", () => {
    const a = Decimal.fromMinorUnits(100n, 2); // 1.00
    const b = Decimal.fromMinorUnits(1n, 0); // 1
    const result = a.add(b);
    expect(result.scale).toBe(2);
    expect(result.toString()).toBe("2.00");
  });
});

describe("mul", () => {
  it("multiplies two scale-2 values and returns scale-2 result", () => {
    // 10.00 * 2.00 = 20.00
    expect(d("10.00").mul(d("2.00")).toString()).toBe("20.00");
  });

  it("multiplies fractional values", () => {
    // 1.50 * 2.00 = 3.00
    expect(d("1.50").mul(d("2.00")).toString()).toBe("3.00");
  });

  it("multiplies with explicit resultScale", () => {
    const price = d("123.45");
    const qty = Decimal.fromMinorUnits(150n, 2); // 1.50 shares
    // 123.45 * 1.50 = 185.175 → banker rounds to 185.18 at scale 2
    const result = price.mul(qty, { resultScale: 2 });
    expect(result.toString()).toBe("185.18");
  });
});

describe("div", () => {
  it("divides evenly", () => {
    expect(d("10.00").div(d("2.00")).toString()).toBe("5.00");
  });

  it("divides with fractional result (banker rounding)", () => {
    // 1.00 / 3.00 = 0.33...  rounds to 0.33 (floor of 0.333...)
    expect(d("1.00").div(d("3.00")).toString()).toBe("0.33");
  });

  it("throws DivisionByZeroError when divisor is zero", () => {
    expect(() => d("1.00").div(d("0.00"))).toThrow(DivisionByZeroError);
  });
});

describe("neg / abs", () => {
  it("negates positive", () => {
    expect(d("5.00").neg().toString()).toBe("-5.00");
  });

  it("negates negative", () => {
    expect(d("-3.00").neg().toString()).toBe("3.00");
  });

  it("abs of negative is positive", () => {
    expect(d("-7.50").abs().toString()).toBe("7.50");
  });

  it("abs of positive is unchanged", () => {
    expect(d("7.50").abs().toString()).toBe("7.50");
  });
});

describe("cmp / eq / isZero / isNegative", () => {
  it("returns 0 for equal values", () => {
    expect(d("1.00").cmp(d("1.00"))).toBe(0);
  });

  it("returns -1 when less", () => {
    expect(d("0.99").cmp(d("1.00"))).toBe(-1);
  });

  it("returns 1 when greater", () => {
    expect(d("1.01").cmp(d("1.00"))).toBe(1);
  });

  it("eq is true for equal values", () => {
    expect(d("5.00").eq(d("5.00"))).toBe(true);
  });

  it("eq is false for different values", () => {
    expect(d("5.00").eq(d("5.01"))).toBe(false);
  });

  it("isZero for zero", () => {
    expect(Decimal.zero().isZero()).toBe(true);
  });

  it("isZero is false for non-zero", () => {
    expect(d("0.01").isZero()).toBe(false);
  });

  it("isNegative for negative", () => {
    expect(d("-0.01").isNegative()).toBe(true);
  });

  it("isNegative is false for positive", () => {
    expect(d("0.01").isNegative()).toBe(false);
  });
});

describe("fromMinorUnits", () => {
  it("constructs from bigint cents", () => {
    const dec = Decimal.fromMinorUnits(1234n, SCALE_CENTS);
    expect(dec.toString()).toBe("12.34");
  });

  it("constructs negative", () => {
    const dec = Decimal.fromMinorUnits(-50n, SCALE_CENTS);
    expect(dec.toString()).toBe("-0.50");
  });

  it("round-trips through toMinorUnits", () => {
    const minor = 999999n;
    expect(Decimal.fromMinorUnits(minor, SCALE_CRYPTO).toMinorUnits()).toBe(minor);
  });
});

describe("toFloat, JS Number conversion (precision loss possible for large values)", () => {
  it("converts a typical decimal value exactly", () => {
    expect(Decimal.fromString("1234.56").toFloat()).toBe(1234.56);
  });

  it("converts zero to 0", () => {
    expect(Decimal.fromString("0").toFloat()).toBe(0);
  });
});

describe("rounding modes in div", () => {
  it("truncate rounds toward zero for positive result", () => {
    // 7 / 3 = 2.333... → truncate → 2.33
    expect(d("7.00").div(d("3.00"), "truncate").toString()).toBe("2.33");
  });

  it("truncate rounds toward zero for negative result", () => {
    // -7 / 3 = -2.333... → truncate → -2.33
    expect(d("-7.00").div(d("3.00"), "truncate").toString()).toBe("-2.33");
  });

  it("floor rounds down (toward -infinity) for positive", () => {
    // 7 / 3 = 2.33... → floor → 2.33 (same as truncate for positive)
    expect(d("7.00").div(d("3.00"), "floor").toString()).toBe("2.33");
  });

  it("floor rounds down for negative", () => {
    // -7 / 3 = -2.33... → floor rounds away from zero → -2.34
    expect(d("-7.00").div(d("3.00"), "floor").toString()).toBe("-2.34");
  });

  it("ceil rounds toward +infinity for positive", () => {
    // 7 / 3 = 2.33... → ceil → 2.34
    expect(d("7.00").div(d("3.00"), "ceil").toString()).toBe("2.34");
  });

  it("ceil rounds toward +infinity for negative", () => {
    // -7 / 3 = -2.33... → ceil rounds toward zero → -2.33
    expect(d("-7.00").div(d("3.00"), "ceil").toString()).toBe("-2.33");
  });

  it("banker rounds an exact half down to even and the next half up to even", () => {
    // scale-0 division reaches genuine half boundaries.
    // 5 / 2 = 2.5 exactly: round half to even -> 2.
    const five = Decimal.fromMinorUnits(5n, 0);
    const seven = Decimal.fromMinorUnits(7n, 0);
    const two = Decimal.fromMinorUnits(2n, 0);
    expect(five.div(two).toString()).toBe("2");
    // 7 / 2 = 3.5 exactly: round half to even -> 4.
    expect(seven.div(two).toString()).toBe("4");
  });

  it("banker rounds exact halves toward even for negatives too", () => {
    // -5 / 2 = -2.5: nearest even is -2.
    const negFive = Decimal.fromMinorUnits(-5n, 0);
    const negSeven = Decimal.fromMinorUnits(-7n, 0);
    const two = Decimal.fromMinorUnits(2n, 0);
    expect(negFive.div(two).toString()).toBe("-2");
    // -7 / 2 = -3.5: nearest even is -4.
    expect(negSeven.div(two).toString()).toBe("-4");
  });
});

describe("rounding in mul", () => {
  it("mul uses truncate rounding mode", () => {
    // 1.23 * 1.23 = 1.5129 → truncate at scale 2 → 1.51
    const result = d("1.23").mul(d("1.23"), { round: "truncate", resultScale: 2 });
    expect(result.toString()).toBe("1.51");
  });

  it("mul uses floor rounding mode", () => {
    const result = d("1.23").mul(d("1.23"), { round: "floor", resultScale: 2 });
    expect(result.toString()).toBe("1.51");
  });

  it("mul uses ceil rounding mode", () => {
    const result = d("1.23").mul(d("1.23"), { round: "ceil", resultScale: 2 });
    expect(result.toString()).toBe("1.52");
  });

  it("mul upscales when resultScale > productScale", () => {
    // scale-0 * scale-0 at resultScale=2: upscales result
    const a = Decimal.fromMinorUnits(3n, 0); // 3
    const b = Decimal.fromMinorUnits(4n, 0); // 4
    const result = a.mul(b, { resultScale: 2 });
    expect(result.toString()).toBe("12.00");
  });
});

describe("banker rounding at exact half with various signs", () => {
  it("banker rounds to even when exactly halfway: odd quotient rounds away", () => {
    // At scale 2, use mul with a case that produces exactly halfway.
    // 1.50 * 0.01 = 0.0150 at productScale=4; resultScale=2 → 0.0150 / 100 = 0.015
    // quotient = 1, remainder = 50, denominator = 100, doubled = 100 == denominator
    // quotient (1) is odd → banker rounds to 2 → 0.02
    const a = Decimal.fromMinorUnits(150n, 2); // 1.50
    const b = Decimal.fromMinorUnits(1n, 2); // 0.01
    const result = a.mul(b, { round: "banker", resultScale: 2 });
    expect(result.toString()).toBe("0.02");
  });

  it("banker rounds to even when exactly halfway: even quotient stays", () => {
    // 2.50 * 0.01 = 0.025 → productScale=4, resultScale=2
    // quotient = 2, remainder = 50, denominator = 100, doubled = 100 == denominator
    // quotient (2) is even → banker stays at 2 → 0.02
    const a = Decimal.fromMinorUnits(250n, 2); // 2.50
    const b = Decimal.fromMinorUnits(1n, 2); // 0.01
    const result = a.mul(b, { round: "banker", resultScale: 2 });
    expect(result.toString()).toBe("0.02");
  });

  it("mul with productScale === resultScale (exact match, no rounding)", () => {
    // scale-0 * scale-0 = product at scale-0; resultScale defaults to this.scale=0
    const a = Decimal.fromMinorUnits(3n, 0);
    const b = Decimal.fromMinorUnits(5n, 0);
    // productScale = 0+0=0, resultScale = 0: exactly equal → no rounding path
    const result = a.mul(b);
    expect(result.toString()).toBe("15");
    expect(result.scale).toBe(0);
  });

  it("floor on negative result rounds further from zero (covers absDen branch)", () => {
    // floor on a negative value covers the negative remainder path in applyRounding
    const a = Decimal.fromMinorUnits(-7n, 2); // -0.07
    const b = Decimal.fromMinorUnits(3n, 2); // 0.03
    // -0.07 / 0.03 = -2.333... → floor rounds to -2.34 (away from zero for negatives)
    expect(a.div(b, "floor").toString()).toBe("-2.34");
  });
});

describe("#rescale: this.scale < other.scale", () => {
  it("cmp works when left operand has lower scale", () => {
    const low = Decimal.fromMinorUnits(100n, 0); // 100 at scale-0
    const high = Decimal.fromMinorUnits(10000n, 2); // 100.00 at scale-2
    expect(low.cmp(high)).toBe(0);
  });

  it("add works when left operand has lower scale", () => {
    const low = Decimal.fromMinorUnits(1n, 0); // 1 at scale-0
    const high = Decimal.fromMinorUnits(50n, 2); // 0.50 at scale-2
    const result = low.add(high);
    expect(result.toString()).toBe("1.50");
    expect(result.scale).toBe(2);
  });
});

describe("property: add commutativity", () => {
  it("a + b === b + a", () => {
    fc.assert(
      fc.property(arb(), arb(), (a, b) => {
        expect(a.add(b).toMinorUnits()).toBe(b.add(a).toMinorUnits());
      }),
    );
  });
});

describe("property: add associativity", () => {
  it("(a + b) + c === a + (b + c)", () => {
    fc.assert(
      fc.property(arb(), arb(), arb(), (a, b, c) => {
        const lhs = a.add(b).add(c).toMinorUnits();
        const rhs = a.add(b.add(c)).toMinorUnits();
        expect(lhs).toBe(rhs);
      }),
    );
  });
});

describe("property: additive identity", () => {
  it("a + 0 === a", () => {
    fc.assert(
      fc.property(arb(), (a) => {
        expect(a.add(Decimal.zero()).toMinorUnits()).toBe(a.toMinorUnits());
      }),
    );
  });
});

describe("property: additive inverse", () => {
  it("a + (-a) === 0", () => {
    fc.assert(
      fc.property(arb(), (a) => {
        expect(a.add(a.neg()).isZero()).toBe(true);
      }),
    );
  });
});

describe("property: abs is non-negative", () => {
  it("a.abs() >= 0", () => {
    fc.assert(
      fc.property(arb(), (a) => {
        expect(a.abs().isNegative()).toBe(false);
      }),
    );
  });
});

describe("property: mul by zero is zero", () => {
  it("a * 0 === 0", () => {
    fc.assert(
      fc.property(arb(), (a) => {
        expect(a.mul(Decimal.zero()).isZero()).toBe(true);
      }),
    );
  });
});

describe("property: sub is add of negation", () => {
  it("a - b === a + (-b)", () => {
    fc.assert(
      fc.property(arb(), arb(), (a, b) => {
        expect(a.sub(b).toMinorUnits()).toBe(a.add(b.neg()).toMinorUnits());
      }),
    );
  });
});

describe("property: mul commutativity", () => {
  it("a * b === b * a at scale 0 (exact, no rounding loss)", () => {
    fc.assert(
      fc.property(arb(0), arb(0), (a, b) => {
        expect(a.mul(b, { resultScale: 0 }).toMinorUnits()).toBe(
          b.mul(a, { resultScale: 0 }).toMinorUnits(),
        );
      }),
    );
  });
});

describe("property: mul identity", () => {
  it("a * 1 === a", () => {
    fc.assert(
      fc.property(arb(), (a) => {
        const one = Decimal.fromString("1.00");
        expect(a.mul(one).toMinorUnits()).toBe(a.toMinorUnits());
      }),
    );
  });
});

describe("property: mul oracle against exact bigint product", () => {
  it("scale-0 product equals the raw bigint product", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
        fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
        (an, bn) => {
          const a = Decimal.fromMinorUnits(an, 0);
          const b = Decimal.fromMinorUnits(bn, 0);
          expect(a.mul(b, { resultScale: 0 }).toMinorUnits()).toBe(an * bn);
        },
      ),
    );
  });
});

describe("property: div is the inverse of mul up to one rounding step", () => {
  it("(a / b) * b is within b of a (truncating division remainder bound)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        (an, bn) => {
          const a = Decimal.fromMinorUnits(an, 0);
          const b = Decimal.fromMinorUnits(bn, 0);
          const q = a.div(b, "truncate"); // scale 0: integer quotient toward zero
          const reconstructed = q.mul(b, { resultScale: 0 }).toMinorUnits();
          // |a - q*b| < |b| for truncating integer division.
          const diff = an - reconstructed;
          const absDiff = diff < 0n ? -diff : diff;
          expect(absDiff < bn).toBe(true);
        },
      ),
    );
  });
});

describe("property: div by self is one (when nonzero)", () => {
  it("a / a === 1.00 for nonzero a", () => {
    fc.assert(
      fc.property(arb(), (a) => {
        fc.pre(!a.isZero());
        expect(a.div(a).toString()).toBe("1.00");
      }),
    );
  });
});

describe("property: div oracle against banker-rounded exact quotient", () => {
  it("matches an independent bigint banker-rounding computation at scale 2", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
        fc.bigInt({ min: -1_000_000n, max: 1_000_000n }).filter((n) => n !== 0n),
        (an, bn) => {
          const a = Decimal.fromMinorUnits(an, 2);
          const b = Decimal.fromMinorUnits(bn, 2);
          // Engine computes (an * 10^2) / bn at scale 2 with banker rounding.
          const num = an * 100n;
          const expected = bankerDivide(num, bn);
          expect(a.div(b).toMinorUnits()).toBe(expected);
        },
      ),
    );
  });
});

describe("property: fromString / toString round-trip", () => {
  it("parse(str).toString() === str for valid inputs", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -9999999n, max: 9999999n }), (n) => {
        const minor = n;
        const dec = Decimal.fromMinorUnits(minor, SCALE_CENTS);
        const str = dec.toString();
        const reparsed = Decimal.fromString(str, SCALE_CENTS);
        expect(reparsed.toMinorUnits()).toBe(minor);
      }),
    );
  });
});
