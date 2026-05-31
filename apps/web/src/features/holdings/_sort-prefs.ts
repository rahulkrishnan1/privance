import {
  DEFAULT_SORT,
  SORT_COLUMNS,
  SORT_DIRECTIONS,
  type SortColumn,
  type SortDirection,
  type SortState,
} from "./types";

let _persistedSort: SortState = DEFAULT_SORT;

export function getSavedSort(userId: string | undefined): SortState {
  if (!userId) return _persistedSort;
  try {
    const raw =
      typeof localStorage !== "undefined" ? localStorage.getItem(`holdings.sort.${userId}`) : null;
    if (!raw) return _persistedSort;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      SORT_COLUMNS.includes((parsed as { column?: unknown }).column as SortColumn) &&
      SORT_DIRECTIONS.includes((parsed as { direction?: unknown }).direction as SortDirection)
    ) {
      return parsed as SortState;
    }
    return _persistedSort;
  } catch {
    return _persistedSort;
  }
}

export function saveSort(userId: string | undefined, sort: SortState) {
  _persistedSort = sort;
  if (!userId) return;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(`holdings.sort.${userId}`, JSON.stringify(sort));
    }
  } catch {
    // localStorage unavailable
  }
}
