import type { FastifyInstance } from "fastify";
import type { Broadcaster } from "./broadcaster.js";

interface IncomingMessage {
  type?: string;
  symbol?: string;
}

export function registerWebSocket(
  app: FastifyInstance,
  broadcaster: Broadcaster
): void {
  app.get("/ws", { websocket: true }, (socket) => {
    const client = broadcaster.add(socket);

    socket.on("message", (raw: Buffer) => {
      let parsed: IncomingMessage;
      try {
        parsed = JSON.parse(raw.toString()) as IncomingMessage;
      } catch {
        socket.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
        return;
      }

      if (parsed.type === "subscribe" && typeof parsed.symbol === "string") {
        const ok = broadcaster.subscribe(client, parsed.symbol);
        if (!ok) {
          socket.send(
            JSON.stringify({
              type: "error",
              error: `Unknown symbol ${parsed.symbol}`,
            })
          );
        }
        return;
      }

      if (parsed.type === "unsubscribe" && typeof parsed.symbol === "string") {
        broadcaster.unsubscribe(client, parsed.symbol);
        return;
      }

      if (parsed.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }

      socket.send(
        JSON.stringify({ type: "error", error: "Unknown message type" })
      );
    });

    socket.on("close", () => {
      broadcaster.remove(client);
    });
  });
}