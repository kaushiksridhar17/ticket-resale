import { describe, expect, it } from "vitest";
import {
  NO_FILTERS,
  applyFilters,
  cheapestTier,
  isNarrowed,
  readFilters,
  writeFilters,
  type Filters,
} from "./eventFilters";
import type { EventSummary, Tier } from "./types";

const DAY = 24 * 60 * 60 * 1000;

function tier(faceValueInCents: number, forSale = 0): Tier {
  return {
    tierId: `t${faceValueInCents}`,
    name: "Standing",
    faceValueInCents,
    perPersonLimit: 4,
    symbol: `evt:t${faceValueInCents}`,
    issued: 100,
    forSale,
    waiting: 0,
  };
}

function event(
  id: string,
  startsInDays: number,
  tiers: Tier[]
): EventSummary {
  const startsAt = Date.parse("2026-01-01T00:00:00Z") + startsInDays * DAY;
  return {
    id,
    organizerId: "usr_admin",
    name: id,
    venue: "Somewhere",
    startsAt,
    salesCloseAt: startsAt - 3600_000,
    paymentMode: "offline",
    status: "on_sale",
    resaleOpen: true,
    tiers,
  };
}

const CATALOGUE = [
  event("late-and-dear", 30, [tier(5000, 10)]),
  event("soon-and-cheap", 2, [tier(1000)]),
  event("mixed", 10, [tier(800, 5), tier(6000)]),
];

function filters(overrides: Partial<Filters> = {}): Filters {
  return { ...NO_FILTERS, ...overrides };
}

const ids = (events: EventSummary[]) => events.map((entry) => entry.id);

describe("sorting", () => {
  it("puts the soonest first by default", () => {
    expect(ids(applyFilters(CATALOGUE, filters()))).toEqual([
      "soon-and-cheap",
      "mixed",
      "late-and-dear",
    ]);
  });

  it("sorts by the cheapest ticket an event has", () => {
    expect(ids(applyFilters(CATALOGUE, filters({ sort: "price-asc" })))).toEqual([
      "mixed",
      "soon-and-cheap",
      "late-and-dear",
    ]);
  });

  it("sorts by the dearest ticket an event has", () => {
    expect(ids(applyFilters(CATALOGUE, filters({ sort: "price-desc" })))).toEqual([
      "mixed",
      "late-and-dear",
      "soon-and-cheap",
    ]);
  });

  it("falls back to the date when two events cost the same", () => {
    const same = [
      event("later", 20, [tier(2000)]),
      event("sooner", 5, [tier(2000)]),
    ];

    expect(ids(applyFilters(same, filters({ sort: "price-asc" })))).toEqual([
      "sooner",
      "later",
    ]);
  });

  it("puts the furthest away first when asked", () => {
    expect(ids(applyFilters(CATALOGUE, filters({ sort: "date-desc" })))).toEqual([
      "late-and-dear",
      "mixed",
      "soon-and-cheap",
    ]);
  });

  it("leaves the events it was given alone", () => {
    const original = [...CATALOGUE];
    applyFilters(CATALOGUE, filters({ sort: "price-desc" }));

    expect(CATALOGUE).toEqual(original);
  });
});

describe("filtering", () => {
  it("keeps an event when any one of its tiers is in range", () => {
    expect(ids(applyFilters(CATALOGUE, filters({ maxInCents: 1500 })))).toEqual([
      "soon-and-cheap",
      "mixed",
    ]);
  });

  it("drops an event whose every tier is too dear", () => {
    expect(ids(applyFilters(CATALOGUE, filters({ maxInCents: 900 })))).toEqual([
      "mixed",
    ]);
  });

  it("filters on a floor as well as a ceiling", () => {
    const kept = applyFilters(
      CATALOGUE,
      filters({ minInCents: 900, maxInCents: 5500 })
    );

    expect(ids(kept)).toEqual(["soon-and-cheap", "late-and-dear"]);
  });

  it("filters by date", () => {
    const from = Date.parse("2026-01-05T00:00:00Z");
    const until = Date.parse("2026-01-20T00:00:00Z");

    expect(ids(applyFilters(CATALOGUE, filters({ from, until })))).toEqual([
      "mixed",
    ]);
  });

  it("hides events with nothing spare", () => {
    expect(ids(applyFilters(CATALOGUE, filters({ spareOnly: true })))).toEqual([
      "mixed",
      "late-and-dear",
    ]);
  });

  it("returns nothing when nothing matches", () => {
    expect(applyFilters(CATALOGUE, filters({ minInCents: 100_000 }))).toEqual([]);
  });

  it("knows when it has been narrowed", () => {
    expect(isNarrowed(filters())).toBe(false);
    expect(isNarrowed(filters({ sort: "price-asc" }))).toBe(false);
    expect(isNarrowed(filters({ spareOnly: true }))).toBe(true);
    expect(isNarrowed(filters({ maxInCents: 100 }))).toBe(true);
  });
});

describe("the query string", () => {
  it("reads dollars as cents", () => {
    const read = readFilters(new URLSearchParams("min=8&max=55.50"));

    expect(read.minInCents).toBe(800);
    expect(read.maxInCents).toBe(5550);
  });

  it("covers the whole of the last day", () => {
    const read = readFilters(new URLSearchParams("from=2026-03-01&until=2026-03-01"));
    const onThatEvening = Date.parse("2026-03-01T21:00:00");

    expect(read.from).toBeLessThanOrEqual(onThatEvening);
    expect(read.until).toBeGreaterThanOrEqual(onThatEvening);
  });

  it("ignores nonsense rather than breaking", () => {
    const read = readFilters(
      new URLSearchParams("sort=sideways&min=abc&from=never")
    );

    expect(read.sort).toBe("date-asc");
    expect(read.minInCents).toBeNull();
    expect(read.from).toBeNull();
  });

  it("writes nothing when nothing is set", () => {
    expect(
      writeFilters(filters(), { min: "", max: "", from: "", until: "" })
    ).toBe("");
  });

  it("survives a round trip", () => {
    const query = writeFilters(filters({ sort: "price-asc", spareOnly: true }), {
      min: "10",
      max: "40",
      from: "2026-02-01",
      until: "2026-02-28",
    });
    const read = readFilters(new URLSearchParams(query));

    expect(read.sort).toBe("price-asc");
    expect(read.spareOnly).toBe(true);
    expect(read.minInCents).toBe(1000);
    expect(read.maxInCents).toBe(4000);
  });
});

describe("cheapest tier", () => {
  it("finds the lowest face value on an event", () => {
    expect(cheapestTier(CATALOGUE[2]!)).toBe(800);
  });
});
