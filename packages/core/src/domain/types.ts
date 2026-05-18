// Branded ID types, prevent accidental cross-type ID mixing

declare const _brand: unique symbol;
type Branded<T, Brand> = T & { readonly [_brand]: Brand };

export type UserId = Branded<string, "UserId">;
export type AccountId = Branded<string, "AccountId">;
export type HoldingId = Branded<string, "HoldingId">;
export type HoldingGroupId = Branded<string, "HoldingGroupId">;
export type PriceId = Branded<string, "PriceId">;
export type NetWorthSnapshotId = Branded<string, "NetWorthSnapshotId">;
export type ActivityId = Branded<string, "ActivityId">;

/** ISO-8601 date string (YYYY-MM-DD). */
export type IsoDate = Branded<string, "IsoDate">;

/** ISO-8601 datetime string. */
export type IsoDateTime = Branded<string, "IsoDateTime">;

/** Asset classification matching v0 holdings check constraint. */
export type AssetType = "stock" | "crypto";

/**
 * Cast a plain string to a branded ID type.
 * Use only at I/O boundaries (DB reads, wire deserialization).
 */
export function asId<T extends Branded<string, string>>(s: string): T {
  return s as unknown as T;
}

export function asIsoDate(s: string): IsoDate {
  return s as IsoDate;
}

export function asIsoDateTime(s: string): IsoDateTime {
  return s as IsoDateTime;
}
