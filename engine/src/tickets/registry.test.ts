import { beforeEach, describe, expect, it } from "vitest";
import { TicketRegistry } from "./registry.js";
import { TicketError } from "./types.js";

const SYMBOL = "evt_demo:GA";

describe("ticket registry", () => {
  let registry: TicketRegistry;

  beforeEach(() => {
    registry = new TicketRegistry();
  });

  it("numbers tickets from one within a tier", () => {
    const issued = registry.issue(SYMBOL, 3, "organizer");

    expect(issued.map((ticket) => ticket.serial)).toEqual([1, 2, 3]);
    expect(issued.every((ticket) => ticket.rotation === 0)).toBe(true);
    expect(registry.issuedCount(SYMBOL)).toBe(3);
  });

  it("keeps serials separate between tiers", () => {
    registry.issue(SYMBOL, 2, "organizer");
    const vip = registry.issue("evt_demo:VIP", 2, "organizer");

    expect(vip.map((ticket) => ticket.serial)).toEqual([1, 2]);
    expect(new Set([...vip.map((t) => t.id)]).size).toBe(2);
  });

  it("continues numbering when a tier is topped up", () => {
    registry.issue(SYMBOL, 2, "organizer");
    const more = registry.issue(SYMBOL, 2, "organizer");

    expect(more.map((ticket) => ticket.serial)).toEqual([3, 4]);
    expect(registry.issuedCount(SYMBOL)).toBe(4);
  });

  it("refuses a non-positive count", () => {
    expect(() => registry.issue(SYMBOL, 0, "organizer")).toThrow(TicketError);
    expect(() => registry.issue(SYMBOL, 1.5, "organizer")).toThrow(TicketError);
  });

  it("hands over the oldest tickets first", () => {
    registry.issue(SYMBOL, 5, "organizer");

    const moved = registry.transfer(SYMBOL, "organizer", "alice", 2);

    expect(moved.map((ticket) => ticket.serial)).toEqual([1, 2]);
    expect(registry.heldBy("organizer", SYMBOL).map((t) => t.serial)).toEqual([
      3, 4, 5,
    ]);
  });

  it("bumps the rotation on every hand-over", () => {
    registry.issue(SYMBOL, 1, "organizer");

    const [first] = registry.transfer(SYMBOL, "organizer", "alice", 1);
    expect(first!.rotation).toBe(1);

    const [second] = registry.transfer(SYMBOL, "alice", "bob", 1);
    expect(second!.id).toBe(first!.id);
    expect(second!.rotation).toBe(2);
  });

  it("moves the holder on the ticket itself", () => {
    registry.issue(SYMBOL, 2, "organizer");
    const [moved] = registry.transfer(SYMBOL, "organizer", "alice", 1);

    expect(registry.get(moved!.id)?.holderId).toBe("alice");
    expect(registry.countHeldBy("organizer", SYMBOL)).toBe(1);
    expect(registry.countHeldBy("alice", SYMBOL)).toBe(1);
  });

  it("refuses to transfer tickets nobody holds", () => {
    registry.issue(SYMBOL, 2, "organizer");

    expect(() => registry.transfer(SYMBOL, "organizer", "alice", 3)).toThrow(
      TicketError
    );
    expect(() => registry.transfer(SYMBOL, "mallory", "alice", 1)).toThrow(
      TicketError
    );
  });

  it("keeps a holder's tickets in serial order after several transfers", () => {
    registry.issue(SYMBOL, 6, "organizer");
    registry.transfer(SYMBOL, "organizer", "alice", 3);
    registry.transfer(SYMBOL, "alice", "bob", 1);
    registry.transfer(SYMBOL, "organizer", "bob", 2);
    registry.transfer(SYMBOL, "bob", "alice", 1);

    const alice = registry.heldBy("alice", SYMBOL).map((t) => t.serial);
    const bob = registry.heldBy("bob", SYMBOL).map((t) => t.serial);

    expect([...alice].sort((a, b) => a - b)).toEqual(alice);
    expect([...bob].sort((a, b) => a - b)).toEqual(bob);
    expect(alice.length + bob.length + registry.countHeldBy("organizer", SYMBOL)).toBe(6);
  });

  it("lists everything a holder owns across tiers", () => {
    registry.issue(SYMBOL, 2, "alice");
    registry.issue("evt_demo:VIP", 1, "alice");

    expect(registry.heldBy("alice")).toHaveLength(3);
    expect(registry.heldBy("nobody")).toEqual([]);
  });

  it("holds its invariants through a chain of transfers", () => {
    registry.issue(SYMBOL, 4, "organizer");
    registry.transfer(SYMBOL, "organizer", "alice", 2);
    registry.transfer(SYMBOL, "alice", "bob", 2);
    registry.transfer(SYMBOL, "bob", "carol", 1);

    registry.assertInvariants();
    expect(registry.size()).toBe(4);
  });
});
