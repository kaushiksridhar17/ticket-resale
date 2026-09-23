import { MatchingEngine } from "./matchingEngine.js";
import type { Command } from "./commands.js";
import type { Trade } from "./types.js";

export interface ReplayResult {
  engine: MatchingEngine;
  trades: Trade[];
}

export function replay(commands: Command[]): ReplayResult {
  const engine = new MatchingEngine();
  const trades: Trade[] = [];

  for (const command of commands) {
    if (command.kind === "submit") {
      trades.push(...engine.submit(structuredClone(command.order)).trades);
    } else if (command.kind === "cancel") {
      engine.cancel(command.symbol, command.orderId);
    }
  }

  return { engine, trades };
}