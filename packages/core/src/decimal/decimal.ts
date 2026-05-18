import { DivisionByZeroError, ParseError, type RoundingMode, SCALE_CENTS } from "./types.js";

function pow10(n: number): bigint {
  let result = 1n;
  for (let i = 0; i < n; i++) result *= 10n;
  return result;
}

/**
 * Rounds a quotient computed from dividing `numerator` by `denominator`
 * using the specified rounding mode. All arithmetic is exact bigint.
 *
 * `remainder` must equal `numerator - quotient * denominator` (the raw
 * truncated remainder, retaining sign) when calling this function.
 */
function applyRounding(
  quotient: bigint,
  remainder: bigint,
  denominator: bigint,
  mode: RoundingMode,
): bigint {
  if (remainder === 0n) return quotient;

  const absRem = remainder < 0n ? -remainder : remainder;
  const absDen = denominator < 0n ? -denominator : denominator;
  const positive = remainder > 0n === denominator > 0n;

  switch (mode) {
    case "truncate":
      return quotient;

    case "floor":
      return positive ? quotient : quotient - 1n;

    case "ceil":
      return positive ? quotient + 1n : quotient;

    case "banker": {
      const doubled = absRem * 2n;
      if (doubled < absDen) return quotient;
      if (doubled > absDen) return positive ? quotient + 1n : quotient - 1n;
      // Exactly halfway: round to even
      return quotient % 2n === 0n ? quotient : positive ? quotient + 1n : quotient - 1n;
    }
    /* c8 ignore next 4 -- compile-time guard, unreachable from typed callers */
    default: {
      const _exhaustive: never = mode;
      throw new Error(`unknown rounding mode: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Immutable decimal value backed by a BigInt minor-units representation.
 * Default scale is 2 (cents). Supports scale 0 (units), 2 (cents), 8 (crypto).
 * No floating-point arithmetic is used anywhere.
 */
export class Decimal {
  readonly #minor: bigint;
  readonly #scale: number;

  private constructor(minor: bigint, scale: number) {
    this.#minor = minor;
    this.#scale = scale;
  }

  get scale(): number {
    return this.#scale;
  }

  /**
   * Parses a decimal string such as "12.34", "-0.5", "100", "1.00000001".
   * The string must not contain scientific notation, commas, or currency symbols.
   */
  static fromString(s: string, scale: number = SCALE_CENTS): Decimal {
    const trimmed = s.trim();
    if (!trimmed) throw new ParseError(s);

    const negative = trimmed.startsWith("-");
    const unsigned = negative ? trimmed.slice(1) : trimmed;
    const dotIndex = unsigned.indexOf(".");

    if (!/^\d+(\.\d+)?$/.test(unsigned)) throw new ParseError(s);

    let intPart: string;
    let fracPart: string;

    if (dotIndex === -1) {
      intPart = unsigned;
      fracPart = "";
    } else {
      intPart = unsigned.slice(0, dotIndex);
      fracPart = unsigned.slice(dotIndex + 1);
    }

    if (fracPart.length > scale) {
      throw new ParseError(`"${s}" has more than ${scale} decimal places for scale ${scale}`);
    }

    const padded = fracPart.padEnd(scale, "0");
    const minor = BigInt(intPart) * pow10(scale) + BigInt(padded || "0");
    return new Decimal(negative ? -minor : minor, scale);
  }

  /** Construct from an already-scaled bigint (e.g., cents as stored in DB). */
  static fromMinorUnits(n: bigint, scale: number = SCALE_CENTS): Decimal {
    return new Decimal(n, scale);
  }

  /** Zero at the given scale. */
  static zero(scale: number = SCALE_CENTS): Decimal {
    return new Decimal(0n, scale);
  }

  #rescale(other: Decimal): [bigint, bigint, number] {
    if (this.#scale === other.#scale) {
      return [this.#minor, other.#minor, this.#scale];
    }
    // Upscale the lower-precision operand
    if (this.#scale < other.#scale) {
      const factor = pow10(other.#scale - this.#scale);
      return [this.#minor * factor, other.#minor, other.#scale];
    } else {
      const factor = pow10(this.#scale - other.#scale);
      return [this.#minor, other.#minor * factor, this.#scale];
    }
  }

  add(other: Decimal): Decimal {
    const [a, b, s] = this.#rescale(other);
    return new Decimal(a + b, s);
  }

  sub(other: Decimal): Decimal {
    const [a, b, s] = this.#rescale(other);
    return new Decimal(a - b, s);
  }

  /**
   * Multiplies and then scales back to the output scale using the given rounding mode.
   * Result scale matches `this.scale` (left operand) unless you pass `resultScale`.
   */
  mul(other: Decimal, opts: { round?: RoundingMode; resultScale?: number } = {}): Decimal {
    const round: RoundingMode = opts.round ?? "banker";
    const resultScale = opts.resultScale ?? this.#scale;
    // Product scale = this.scale + other.scale; reduce to resultScale
    const productScale = this.#scale + other.#scale;
    const product = this.#minor * other.#minor;
    if (productScale === resultScale) return new Decimal(product, resultScale);
    const factor = pow10(Math.abs(productScale - resultScale));
    if (productScale > resultScale) {
      const q = product / factor;
      const r = product % factor;
      return new Decimal(applyRounding(q, r, factor, round), resultScale);
    } else {
      return new Decimal(product * factor, resultScale);
    }
  }

  /**
   * Divides this by other. Result is expressed at `this.scale` precision
   * using the given rounding mode (default: banker's rounding).
   */
  div(other: Decimal, round: RoundingMode = "banker"): Decimal {
    if (other.#minor === 0n) throw new DivisionByZeroError();
    // Up-scale numerator to preserve precision after division
    const [a, b] = this.#rescale(other);
    const scale = Math.max(this.#scale, other.#scale);
    // Compute: (a * 10^scale) / b, then keep at scale
    const upscaled = a * pow10(scale);
    const q = upscaled / b;
    const r = upscaled % b;
    return new Decimal(applyRounding(q, r, b, round), scale);
  }

  neg(): Decimal {
    return new Decimal(-this.#minor, this.#scale);
  }

  abs(): Decimal {
    return new Decimal(this.#minor < 0n ? -this.#minor : this.#minor, this.#scale);
  }

  /**
   * Returns -1, 0, or 1 (this < other, this === other, this > other).
   * Handles different scales by rescaling.
   */
  cmp(other: Decimal): -1 | 0 | 1 {
    const [a, b] = this.#rescale(other);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  eq(other: Decimal): boolean {
    return this.cmp(other) === 0;
  }

  isZero(): boolean {
    return this.#minor === 0n;
  }

  isNegative(): boolean {
    return this.#minor < 0n;
  }

  toMinorUnits(): bigint {
    return this.#minor;
  }

  /** Canonical decimal string, e.g. "12.34", "-0.05", "100.00000000". */
  toString(): string {
    if (this.#scale === 0) return this.#minor.toString();

    const factor = pow10(this.#scale);
    const abs = this.#minor < 0n ? -this.#minor : this.#minor;
    const intPart = (abs / factor).toString();
    const fracPart = (abs % factor).toString().padStart(this.#scale, "0");
    const body = `${intPart}.${fracPart}`;
    return this.#minor < 0n ? `-${body}` : body;
  }

  /** JSON serialization, same as toString(). */
  toJSON(): string {
    return this.toString();
  }

  /**
   * Convert to a JS number. PRECISION LOSS POSSIBLE for very large values
   * (above Number.MAX_SAFE_INTEGER / 10**scale). Use ONLY at boundaries
   * where JS numbers are required (chart libraries, JSON serialization
   * to non-Decimal-aware consumers). Never for arithmetic.
   */
  toFloat(): number {
    return Number(this.toString());
  }
}
