import type { FastifyInstance } from "fastify";
import { requireRole, requireUser } from "../auth/plugin.js";
import { parseSymbol } from "../events/types.js";
import type { ExchangeState } from "../exchangeState.js";
import type { PassIssuer } from "./passes.js";

export interface DoorDeps {
  state: ExchangeState;
  passes: PassIssuer;
  now?: () => number;
}

const scanSchema = {
  body: {
    type: "object",
    required: ["token", "eventId"],
    properties: {
      token: { type: "string", minLength: 1, maxLength: 200 },
      eventId: { type: "string", minLength: 1, maxLength: 40 },
    },
  },
} as const;

type Refusal =
  | "not_a_pass"
  | "out_of_date"
  | "forged"
  | "unknown_ticket"
  | "passed_on"
  | "wrong_event"
  | "event_off"
  | "already_inside";

const REASONS: Record<Refusal, string> = {
  not_a_pass: "That is not a ticket",
  out_of_date: "This pass has gone stale. Ask them to refresh it.",
  forged: "This pass was not issued by us",
  unknown_ticket: "No such ticket",
  passed_on: "This ticket has been passed on to somebody else",
  wrong_event: "This ticket is for a different event",
  event_off: "This event has been cancelled",
  already_inside: "This ticket has already been used",
};

export function registerDoorRoutes(app: FastifyInstance, deps: DoorDeps): void {
  const { state, passes } = deps;
  const now = deps.now ?? (() => Date.now());

  app.get("/tickets/:ticketId/pass", async (request, reply) => {
    const user = requireUser(request);
    const { ticketId } = request.params as { ticketId: string };
    const ticket = state.getTicket(ticketId);

    if (!ticket || ticket.holderId !== user.id) {
      return reply.code(404).send({ error: "You do not hold that ticket" });
    }

    const ref = state.events.resolve(ticket.symbol);
    if (ref?.event.status === "cancelled") {
      return reply.code(409).send({
        error: "This event has been cancelled",
        cancelled: true,
      });
    }

    const issued = passes.issue(ticket.id, ticket.rotation);

    return {
      token: issued.token,
      expiresAt: issued.expiresAt,
      serial: ticket.serial,
      symbol: ticket.symbol,
      admittedAt: ticket.admittedAt,
    };
  });

  app.post("/scan", { schema: scanSchema }, async (request, reply) => {
    requireRole(request, "staff", "organizer");
    const { token, eventId } = request.body as {
      token: string;
      eventId: string;
    };

    const event = state.events.get(eventId);
    if (!event) {
      return reply.code(404).send({ error: `Unknown event ${eventId}` });
    }

    const refuse = (reason: Refusal) =>
      reply.send({ admitted: false, reason, message: REASONS[reason] });

    if (event.status === "cancelled") {
      return reply.send({
        admitted: false,
        reason: "event_off" satisfies Refusal,
        message: REASONS.event_off,
      });
    }

    const pass = passes.verify(token);
    if (pass === "malformed") {
      return refuse("not_a_pass");
    }
    if (pass === "expired") {
      return refuse("out_of_date");
    }
    if (pass === "forged") {
      return refuse("forged");
    }

    const ticket = state.getTicket(pass.ticketId);
    if (!ticket) {
      return refuse("unknown_ticket");
    }
    if (parseSymbol(ticket.symbol)?.eventId !== eventId) {
      return refuse("wrong_event");
    }
    if (ticket.rotation !== pass.rotation) {
      return refuse("passed_on");
    }
    if (ticket.admittedAt !== null) {
      return reply.send({
        admitted: false,
        reason: "already_inside" satisfies Refusal,
        message: REASONS.already_inside,
        serial: ticket.serial,
        admittedAt: ticket.admittedAt,
      });
    }

    const admitted = state.admit(ticket.id, now());
    const tier = state.events.resolve(ticket.symbol)?.tier;

    return {
      admitted: true,
      serial: admitted.serial,
      tierName: tier?.name ?? null,
      owedInCents: tier?.faceValueInCents ?? null,
      admittedAt: admitted.admittedAt,
    };
  });
}
