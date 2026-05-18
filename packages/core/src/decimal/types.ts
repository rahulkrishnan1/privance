declare const _brand: unique symbol;
type Branded<T, Brand> = T & { readonly [_brand]: Brand };

export type Cents = Branded<bigint, "Cents">;
export type BasisPoints = Branded<bigint, "BasisPoints">;

export class DecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecimalError";
  }
}

export class ParseError extends DecimalError {
  constructor(input: string) {
    super(`Cannot parse "${input}" as a Decimal`);
    this.name = "ParseError";
  }
}

export class DivisionByZeroError extends DecimalError {
  constructor() {
    super("Division by zero");
    this.name = "DivisionByZeroError";
  }
}

export type RoundingMode = "banker" | "floor" | "ceil" | "truncate";

export const SCALE_UNITS = 0 as const;
export const SCALE_CENTS = 2 as const;
export const SCALE_CRYPTO = 8 as const;

export type SupportedScale = typeof SCALE_UNITS | typeof SCALE_CENTS | typeof SCALE_CRYPTO;
