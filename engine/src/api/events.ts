import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { OrderRejected } from "../exchange.js";
import { requireRole, requireUser } from "../auth/plugin.js";
import {
  createEventSchema,
  issueTicketsSchema,
  type CreateEventBody,
  type IssueTicketsBody,
} from "./schemas.js";
import { symbolFor, type EventDefinition } from "../events/types.js";
import type { ExchangeState } from "../exchangeState.js";

export interface EventRouteDeps {
  state: ExchangeState;
  now?: () => number;
}

export function registerEventRoutes(
  app: FastifyInstance,
  deps: EventRouteDeps
): void {
  const { state } = deps;
  const now = deps.now ?? (() => Date.now());

  const view = (event: EventDefinition) => eventView(state, event, now());

  app.get("/events", async () => ({
    events: state.events.list().map(view),
  }));

  app.get("/events/:eventId", async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const event = state.events.get(eventId);
    if (!event) {
      return reply.code(404).send({ error: `Unknown event ${eventId}` });
    }
    return { event: view(event) };
  });

  app.get("/tickets", async (request) => {
    const user = requireUser(request);

    const tickets = state.ticketsHeldBy(user.id).map((ticket) => {
      const ref = state.events.resolve(ticket.symbol);
      return {
        id: ticket.id,
        symbol: ticket.symbol,
        serial: ticket.serial,
        rotation: ticket.rotation,
        eventId: ref?.event.id ?? null,
        eventName: ref?.event.name ?? null,
        eventStatus: ref?.event.status ?? null,
        venue: ref?.event.venue ?? null,
        startsAt: ref?.event.startsAt ?? null,
        tierId: ref?.tier.tierId ?? null,
        tierName: ref?.tier.name ?? null,
        faceValueInCents: ref?.tier.faceValueInCents ?? null,
      };
    });

    return { tickets };
  });

  app.get("/events/:eventId/report", async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const event = ownedEvent(request, reply, state, eventId);
    if (!event) {
      return reply;
    }

    return {
      event: view(event),
      tiers: event.tiers.map((tier) => {
        const symbol = symbolFor(event.id, tier.tierId);
        const tickets = state.tickets.forSymbol(symbol);
        const holders = new Set<string>();
        let withOrganizer = 0;
        let passedOn = 0;

        for (const ticket of tickets) {
          holders.add(ticket.holderId);
          if (ticket.holderId === event.organizerId) {
            withOrganizer += 1;
          }
          if (ticket.rotation >= 2) {
            passedOn += 1;
          }
        }

        return {
          tierId: tier.tierId,
          name: tier.name,
          symbol,
          faceValueInCents: tier.faceValueInCents,
          issued: tickets.length,
          withOrganizer,
          withFans: tickets.length - withOrganizer,
          passedOn,
          holders: holders.size,
          forSale: state.restingQuantity(symbol, "sell"),
          waiting: state.restingQuantity(symbol, "buy"),
          recentTrades: state.recentTrades(symbol, 8).map((trade) => ({
            priceInCents: trade.priceInCents,
            quantity: trade.quantity,
            executedAt: trade.executedAt,
          })),
        };
      }),
    };
  });

  app.post("/events", { schema: createEventSchema }, async (request, reply) => {
    requireRole(request, "admin");
    const body = request.body as CreateEventBody;

    const problem = validateEvent(body, now());
    if (problem) {
      return reply.code(400).send({ error: problem });
    }

    const event: EventDefinition = {
      id: state.nextEventId(),
      organizerId: requireUser(request).id,
      name: body.name.trim(),
      venue: body.venue.trim(),
      startsAt: body.startsAt,
      salesCloseAt: body.salesCloseAt,
      paymentMode: body.paymentMode ?? "offline",
      status: "on_sale",
      tiers: body.tiers.map((tier) => ({
        tierId: tier.tierId,
        name: tier.name.trim(),
        faceValueInCents: tier.faceValueInCents,
        perPersonLimit: tier.perPersonLimit,
      })),
    };

    state.createEvent(event);

    return reply.code(201).send({ event: view(event) });
  });

  app.post(
    "/events/:eventId/tickets",
    { schema: issueTicketsSchema },
    async (request, reply) => {
      const { eventId } = request.params as { eventId: string };
      const body = request.body as IssueTicketsBody;

      const event = ownedEvent(request, reply, state, eventId);
      if (!event) {
        return reply;
      }
      if (!event.tiers.some((tier) => tier.tierId === body.tierId)) {
        return reply.code(404).send({ error: `Unknown tier ${body.tierId}` });
      }
      if (event.status !== "on_sale") {
        return reply
          .code(409)
          .send({ error: "Tickets can only be issued while an event is on sale" });
      }

      try {
        const issued = state.issueTickets(eventId, body.tierId, body.count);
        return reply.code(201).send({
          symbol: symbolFor(eventId, body.tierId),
          issued,
          event: view(event),
        });
      } catch (error) {
        if (error instanceof OrderRejected) {
          return reply.code(422).send({ error: error.message });
        }
        throw error;
      }
    }
  );

  app.post("/events/:eventId/close", async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const event = ownedEvent(request, reply, state, eventId);
    if (!event) {
      return reply;
    }
    if (event.status === "cancelled") {
      return reply.code(409).send({ error: "That event is already cancelled" });
    }

    state.closeSales(eventId);
    return { event: view(event) };
  });

  app.post("/events/:eventId/cancel", async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const event = ownedEvent(request, reply, state, eventId);
    if (!event) {
      return reply;
    }

    state.cancelEvent(eventId);
    return { event: view(event) };
  });
}

function ownedEvent(
  request: FastifyRequest,
  reply: FastifyReply,
  state: ExchangeState,
  eventId: string
): EventDefinition | null {
  requireRole(request, "admin");
  const event = state.events.get(eventId);

  if (!event) {
    reply.code(404).send({ error: `Unknown event ${eventId}` });
    return null;
  }

  return event;
}

function validateEvent(body: CreateEventBody, currentTime: number): string | null {
  if (body.salesCloseAt <= currentTime) {
    return "Sales must close in the future";
  }
  if (body.startsAt < body.salesCloseAt) {
    return "Sales cannot close after the event has started";
  }

  const ids = new Set<string>();
  for (const tier of body.tiers) {
    if (ids.has(tier.tierId)) {
      return `Duplicate tier ${tier.tierId}`;
    }
    ids.add(tier.tierId);
  }

  return null;
}

function eventView(
  state: ExchangeState,
  event: EventDefinition,
  currentTime: number
) {
  return {
    id: event.id,
    organizerId: event.organizerId,
    name: event.name,
    venue: event.venue,
    startsAt: event.startsAt,
    salesCloseAt: event.salesCloseAt,
    paymentMode: event.paymentMode,
    status: event.status,
    resaleOpen: event.status === "on_sale" && currentTime < event.salesCloseAt,
    tiers: event.tiers.map((tier) => {
      const symbol = symbolFor(event.id, tier.tierId);
      return {
        tierId: tier.tierId,
        name: tier.name,
        faceValueInCents: tier.faceValueInCents,
        perPersonLimit: tier.perPersonLimit,
        symbol,
        issued: state.events.issuedCount(symbol),
        forSale: state.restingQuantity(symbol, "sell"),
        waiting: state.restingQuantity(symbol, "buy"),
      };
    }),
  };
}
