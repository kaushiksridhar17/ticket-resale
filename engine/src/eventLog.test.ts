import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileEventLog } from "./eventLog.js";
import { MatchingEngine } from "./matchingEngine.js";
import { replay } from "./replay.js";
import type { Command } from "./commands.js";
import type { Order, OrderType, Side } from "./types.js";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateCommands(count: number, seed: number): Command[] {
  const random = mulberry32(seed);
  const users = ["alice", "bob", "carol", "dave"];
  const commands: Command[] = [];
  const restingIds: string[] = [];

  for (let i = 1; i <= count; i += 1) {
    if (restingIds.length > 0 && random() < 0.15) {
      const index = Math.floor(random() * restingIds.length);
      const orderId = restingIds.splice(index, 1)[0]!;
      commands.push({ kind: "cancel", symbol: "evt_demo:GA", orderId });
      continue;
    }

    const side: Side = random() < 0.5 ? "buy" : "sell";
    const type: OrderType = random() < 0.1 ? "market" : "limit";
    const priceInCents =
      type === "market" ? null : 4900 + Math.floor(random() * 41) * 5;
    const quantity = 1 + Math.floor(random() * 100);

    const order: Order = {
      id: `ord_${i}`,
      userId: users[Math.floor(random() * users.length)]!,
      symbol: "evt_demo:GA",
      side,
      type,
      priceInCents,
      quantity,
      remainingQuantity: quantity,
      status: "open",
      sequence: 0,
      createdAt: 1_700_000_000_000 + i,
    };

    if (type === "limit") {
      restingIds.push(order.id);
    }
    commands.push({ kind: "submit", order });
  }

  return commands;
}

describe("event log and replay", () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "exchange-log-"));
    logPath = join(dir, "events.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists and reads back every command in order", () => {
    const log = new FileEventLog(logPath);
    const commands = generateCommands(50, 1);

    for (const command of commands) {
      log.append(command);
    }
    log.close();

    const reopened = new FileEventLog(logPath);
    const entries = reopened.readAll();
    reopened.close();

    expect(entries).toHaveLength(50);
    expect(entries.map((e) => e.seq)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1)
    );
    expect(entries[0]?.command).toEqual(commands[0]);
  });

  it("reproduces identical market state when replayed", () => {
    const log = new FileEventLog(logPath);
    const commands = generateCommands(1000, 42);

    const live = new MatchingEngine();
    const liveTrades = [];

    for (const command of commands) {
      log.append(command);
      if (command.kind === "submit") {
        liveTrades.push(...live.submit(structuredClone(command.order)).trades);
      } else if (command.kind === "cancel") {
        live.cancel(command.symbol, command.orderId);
      }
    }
    log.close();

    const reopened = new FileEventLog(logPath);
    const replayed = replay(reopened.readAll().map((entry) => entry.command));
    reopened.close();

    expect(replayed.engine.digest()).toBe(live.digest());
    expect(replayed.trades).toEqual(liveTrades);
    expect(liveTrades.length).toBeGreaterThan(0);
  });

  it("produces the same digest across repeated replays", () => {
    const commands = generateCommands(1000, 7);

    const first = replay(commands);
    const second = replay(commands);

    expect(second.engine.digest()).toBe(first.engine.digest());
    expect(second.trades).toEqual(first.trades);
  });

  it("conserves quantity across the whole run", () => {
    const commands = generateCommands(1000, 99);
    const { trades } = replay(commands);

    const bought = new Map<string, number>();
    const sold = new Map<string, number>();

    for (const trade of trades) {
      bought.set(trade.buyUserId, (bought.get(trade.buyUserId) ?? 0) + trade.quantity);
      sold.set(trade.sellUserId, (sold.get(trade.sellUserId) ?? 0) + trade.quantity);
    }

    const totalBought = [...bought.values()].reduce((a, b) => a + b, 0);
    const totalSold = [...sold.values()].reduce((a, b) => a + b, 0);

    expect(totalBought).toBe(totalSold);
  });
});