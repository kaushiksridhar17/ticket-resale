import type { EventSummary } from "./types";

export type SortBy = "date-asc" | "date-desc" | "price-asc" | "price-desc";

export const SORTS: { value: SortBy; label: string }[] = [
  { value: "date-asc", label: "Time \u2191" },
  { value: "date-desc", label: "Time \u2193" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
];

const SORT_VALUES = SORTS.map((option) => option.value);

export const DEFAULT_SORT: SortBy = "date-asc";

export interface Filters {
  sort: SortBy;
  minInCents: number | null;
  maxInCents: number | null;
  from: number | null;
  until: number | null;
  spareOnly: boolean;
}

export const NO_FILTERS: Filters = {
  sort: DEFAULT_SORT,
  minInCents: null,
  maxInCents: null,
  from: null,
  until: null,
  spareOnly: false,
};

export function cheapestTier(event: EventSummary): number {
  return event.tiers.reduce(
    (lowest, tier) => Math.min(lowest, tier.faceValueInCents),
    Number.POSITIVE_INFINITY
  );
}

export function dearestTier(event: EventSummary): number {
  return event.tiers.reduce(
    (highest, tier) => Math.max(highest, tier.faceValueInCents),
    0
  );
}

export function spareCount(event: EventSummary): number {
  return event.tiers.reduce((sum, tier) => sum + tier.forSale, 0);
}

function withinPrice(event: EventSummary, filters: Filters): boolean {
  // An event counts as in range when any one of its tiers is, so a
  // cheap seat keeps a pricey event in a low search.
  return event.tiers.some((tier) => {
    if (filters.minInCents !== null && tier.faceValueInCents < filters.minInCents) {
      return false;
    }
    if (filters.maxInCents !== null && tier.faceValueInCents > filters.maxInCents) {
      return false;
    }
    return true;
  });
}

function withinDates(event: EventSummary, filters: Filters): boolean {
  if (filters.from !== null && event.startsAt < filters.from) {
    return false;
  }
  if (filters.until !== null && event.startsAt > filters.until) {
    return false;
  }
  return true;
}

export function applyFilters(
  events: EventSummary[],
  filters: Filters
): EventSummary[] {
  const kept = events.filter(
    (event) =>
      withinPrice(event, filters) &&
      withinDates(event, filters) &&
      (!filters.spareOnly || spareCount(event) > 0)
  );

  const sorted = [...kept];
  if (filters.sort === "price-asc") {
    sorted.sort(
      (a, b) => cheapestTier(a) - cheapestTier(b) || a.startsAt - b.startsAt
    );
  } else if (filters.sort === "price-desc") {
    sorted.sort(
      (a, b) => dearestTier(b) - dearestTier(a) || a.startsAt - b.startsAt
    );
  } else if (filters.sort === "date-desc") {
    sorted.sort((a, b) => b.startsAt - a.startsAt);
  } else {
    sorted.sort((a, b) => a.startsAt - b.startsAt);
  }

  return sorted;
}

export function isNarrowed(filters: Filters): boolean {
  return (
    filters.minInCents !== null ||
    filters.maxInCents !== null ||
    filters.from !== null ||
    filters.until !== null ||
    filters.spareOnly
  );
}

export function readFilters(params: URLSearchParams): Filters {
  const sort = params.get("sort");

  return {
    sort: SORT_VALUES.includes(sort as SortBy) ? (sort as SortBy) : DEFAULT_SORT,
    minInCents: wholeDollars(params.get("min")),
    maxInCents: wholeDollars(params.get("max")),
    from: dayStart(params.get("from")),
    until: dayEnd(params.get("until")),
    spareOnly: params.get("spare") === "1",
  };
}

export function writeFilters(filters: Filters, raw: RawInputs): string {
  const params = new URLSearchParams();
  if (filters.sort !== DEFAULT_SORT) {
    params.set("sort", filters.sort);
  }
  if (raw.min) {
    params.set("min", raw.min);
  }
  if (raw.max) {
    params.set("max", raw.max);
  }
  if (raw.from) {
    params.set("from", raw.from);
  }
  if (raw.until) {
    params.set("until", raw.until);
  }
  if (filters.spareOnly) {
    params.set("spare", "1");
  }
  return params.toString();
}

export interface RawInputs {
  min: string;
  max: string;
  from: string;
  until: string;
}

export function readRaw(params: URLSearchParams): RawInputs {
  return {
    min: params.get("min") ?? "",
    max: params.get("max") ?? "",
    from: params.get("from") ?? "",
    until: params.get("until") ?? "",
  };
}

function wholeDollars(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const dollars = Number(value);
  return Number.isFinite(dollars) && dollars >= 0
    ? Math.round(dollars * 100)
    : null;
}

function dayStart(value: string | null): number | null {
  const parsed = value ? Date.parse(`${value}T00:00:00`) : NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

function dayEnd(value: string | null): number | null {
  const parsed = value ? Date.parse(`${value}T23:59:59.999`) : NaN;
  return Number.isNaN(parsed) ? null : parsed;
}
