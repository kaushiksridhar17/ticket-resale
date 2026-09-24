import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExchangeState } from "../exchangeState.js";
import { readSeedFile, seedEvents, type SeedEvent } from "./seed.js";
import { symbolFor } from "./types.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function seed(overrides: Partial<SeedEvent> = {}): SeedEvent {
  return {
    id: "evt_basement",
    name: "Basement show",
    venue: "The Old Mill",
    startsInDays: 10,
    salesCloseHoursBefore: 4,
    tiers: [
      {
        tierId: "GA",
        name: "Standing",
        faceValueInCents: 1500,
        perPersonLimit: 4,
        print: 50,
        release: 0,
      },
    ],
    ...overrides,
  };
}

describe("seeding the catalogue", () => {
  let state: ExchangeState;

  beforeEach(() => {
    state = new ExchangeState(null);
  });

  afterEach(() => {
    state.close();
  });

  it("creates an event the admin owns", () => {
    const now = Date.now();
    const result = seedEvents(state, [seed()], "usr_admin", now);

    expect(result.created).toEqual(["evt_basement"]);
    const event = state.events.get("evt_basement")!;
    expect(event.organizerId).toBe("usr_admin");
    expect(event.name).toBe("Basement show");
    expect(event.status).toBe("on_sale");
  });

  it("works out the dates from the day it is seeded", () => {
    const now = 1_700_000_000_000;
    seedEvents(state, [seed({ startsInDays: 10, salesCloseHoursBefore: 4 })], "usr_admin", now);

    const event = state.events.get("evt_basement")!;
    expect(event.startsAt).toBe(now + 10 * DAY);
    expect(event.salesCloseAt).toBe(now + 10 * DAY - 4 * HOUR);
    expect(event.salesCloseAt).toBeGreaterThan(now);
  });

  it("prints the tickets into the admin's account", () => {
    seedEvents(state, [seed()], "usr_admin");

    const symbol = symbolFor("evt_basement", "GA");
    expect(state.events.issuedCount(symbol)).toBe(50);
    expect(state.ticketsHeldBy("usr_admin")).toHaveLength(50);
  });

  it("prints nothing for a tier asking for none", () => {
    seedEvents(
      state,
      [
        seed({
          tiers: [
            {
              tierId: "GA",
              name: "Standing",
              faceValueInCents: 1500,
              perPersonLimit: 4,
              print: 0,
              release: 0,
            },
          ],
        }),
      ],
      "usr_admin"
    );

    expect(state.events.issuedCount(symbolFor("evt_basement", "GA"))).toBe(0);
    expect(state.events.get("evt_basement")).not.toBeNull();
  });

  it("puts the released share on sale and keeps the rest back", () => {
    seedEvents(
      state,
      [
        seed({
          tiers: [
            {
              tierId: "GA",
              name: "Standing",
              faceValueInCents: 1500,
              perPersonLimit: 4,
              print: 50,
              release: 30,
            },
          ],
        }),
      ],
      "usr_admin"
    );

    const symbol = symbolFor("evt_basement", "GA");
    expect(state.restingQuantity(symbol, "sell")).toBe(30);
    expect(state.restingQuantity(symbol, "buy")).toBe(0);
    expect(state.ticketsHeldBy("usr_admin")).toHaveLength(50);
  });

  it("releases at face value, never above it", () => {
    seedEvents(
      state,
      [
        seed({
          tiers: [
            {
              tierId: "GA",
              name: "Standing",
              faceValueInCents: 1500,
              perPersonLimit: 4,
              print: 20,
              release: 20,
            },
          ],
        }),
      ],
      "usr_admin"
    );

    const resting = state.restingOrders(symbolFor("evt_basement", "GA"));
    expect(resting).toHaveLength(1);
    expect(resting[0]!.priceInCents).toBe(1500);
    expect(resting[0]!.side).toBe("sell");
  });

  it("releases nothing when the catalogue asks for none", () => {
    seedEvents(state, [seed()], "usr_admin");

    expect(state.restingQuantity(symbolFor("evt_basement", "GA"), "sell")).toBe(0);
  });

  it("leaves an event that is already there alone", () => {
    seedEvents(state, [seed()], "usr_admin");
    const again = seedEvents(state, [seed()], "usr_other");

    expect(again.created).toEqual([]);
    expect(again.skipped).toEqual(["evt_basement"]);
    expect(state.events.get("evt_basement")!.organizerId).toBe("usr_admin");
    expect(state.events.issuedCount(symbolFor("evt_basement", "GA"))).toBe(50);
  });

  it("seeds only the events that are missing", () => {
    seedEvents(state, [seed()], "usr_admin");

    const result = seedEvents(
      state,
      [seed(), seed({ id: "evt_quarry", name: "Quarry field" })],
      "usr_admin"
    );

    expect(result.created).toEqual(["evt_quarry"]);
    expect(result.skipped).toEqual(["evt_basement"]);
  });

  it("does not leave a tier out of a multi-tier event", () => {
    seedEvents(
      state,
      [
        seed({
          tiers: [
            { tierId: "GA", name: "Standing", faceValueInCents: 1500, perPersonLimit: 4, print: 20, release: 0 },
            { tierId: "BALC", name: "Balcony", faceValueInCents: 2500, perPersonLimit: 2, print: 10, release: 0 },
          ],
        }),
      ],
      "usr_admin"
    );

    expect(state.events.issuedCount(symbolFor("evt_basement", "GA"))).toBe(20);
    expect(state.events.issuedCount(symbolFor("evt_basement", "BALC"))).toBe(10);
  });
});

describe("reading the seed file", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "facevalue-seed-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(contents: unknown): string {
    const path = join(dir, "events.seed.json");
    writeFileSync(
      path,
      typeof contents === "string" ? contents : JSON.stringify(contents)
    );
    return path;
  }

  it("reads a catalogue", () => {
    const path = write({ events: [seed()] });

    expect(readSeedFile(path)).toHaveLength(1);
  });

  it("treats a missing file as no catalogue", () => {
    expect(readSeedFile(join(dir, "nothing-here.json"))).toBeNull();
  });

  it("complains about something that is not JSON", () => {
    expect(() => readSeedFile(write("{ nope"))).toThrow(/valid JSON/);
  });

  it("complains when there is no events array", () => {
    expect(() => readSeedFile(write({ things: [] }))).toThrow(/events. array/);
  });

  it("complains about an id that could collide with a real one", () => {
    expect(() => readSeedFile(write({ events: [seed({ id: "evt_1" })] }))).toThrow(
      /id like evt_something/
    );
    expect(() =>
      readSeedFile(write({ events: [seed({ id: "Basement Show" })] }))
    ).toThrow(/id like evt_something/);
  });

  it("complains about the same event twice", () => {
    expect(() =>
      readSeedFile(write({ events: [seed(), seed()] }))
    ).toThrow(/twice/);
  });

  it("complains about the same tier twice", () => {
    const tier = {
      tierId: "GA",
      name: "Standing",
      faceValueInCents: 1500,
      perPersonLimit: 4,
      print: 10,
      release: 0,
    };
    expect(() =>
      readSeedFile(write({ events: [seed({ tiers: [tier, tier] })] }))
    ).toThrow(/tier GA twice/);
  });

  it("complains about an event with no tiers", () => {
    expect(() => readSeedFile(write({ events: [seed({ tiers: [] })] }))).toThrow(
      /at least one tier/
    );
  });

  it("complains about a date in the past", () => {
    expect(() =>
      readSeedFile(write({ events: [seed({ startsInDays: -1 })] }))
    ).toThrow(/startsInDays above zero/);
  });

  it("complains when sales close before the event is announced", () => {
    expect(() =>
      readSeedFile(
        write({ events: [seed({ startsInDays: 1, salesCloseHoursBefore: 48 })] })
      )
    ).toThrow(/before it is announced/);
  });

  it("complains about a face value that is not a whole number", () => {
    expect(() =>
      readSeedFile(
        write({
          events: [
            seed({
              tiers: [
                {
                  tierId: "GA",
                  name: "Standing",
                  faceValueInCents: 15.5,
                  perPersonLimit: 4,
                  print: 10,
                  release: 0,
                },
              ],
            }),
          ],
        })
      )
    ).toThrow(/faceValueInCents/);
  });

  it("accepts the catalogue this project ships with", () => {
    const shipped = readSeedFile("events.seed.json");

    expect(shipped).not.toBeNull();
    expect(shipped!.length).toBeGreaterThan(4);
  });
});
