import type {
  AccountSummary,
  Role,
  EventReport,
  EventSummary,
  NewEvent,
  ScanResult,
  TicketPass,
  Order,
  OrderBookSnapshot,
  TicketSummary,
  Trade,
  User,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const body = (await response.json()) as {
        error?: string;
        message?: string;
      };
      message = body.error ?? body.message ?? message;
    } catch {
      // response had no JSON body
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export interface Credentials {
  email: string;
  password: string;
}

export function register(
  credentials: Credentials & { role: Exclude<Role, "admin">; displayName?: string }
): Promise<{ user: User }> {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function logIn(
  credentials: Credentials & { role?: Role }
): Promise<{ user: User }> {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function signOut(): Promise<void> {
  return request("/auth/logout", { method: "POST" });
}

export async function fetchMe(): Promise<User | null> {
  try {
    const result = await request<{ user: User }>("/me");
    return result.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export function fetchSymbols(): Promise<{ symbols: string[] }> {
  return request("/symbols");
}

export function fetchBook(symbol: string): Promise<OrderBookSnapshot> {
  return request(`/book/${symbol}`);
}

export function fetchTrades(symbol: string): Promise<{ trades: Trade[] }> {
  return request(`/trades/${symbol}`);
}

export function fetchAccount(): Promise<AccountSummary> {
  return request("/account");
}

export function fetchEvents(): Promise<{ events: EventSummary[] }> {
  return request("/events");
}

export function fetchEvent(eventId: string): Promise<{ event: EventSummary }> {
  return request(`/events/${eventId}`);
}

export function fetchTickets(): Promise<{ tickets: TicketSummary[] }> {
  return request("/tickets");
}

export function fetchPass(ticketId: string): Promise<TicketPass> {
  return request(`/tickets/${ticketId}/pass`);
}

export function scanPass(token: string, eventId: string): Promise<ScanResult> {
  return request("/scan", {
    method: "POST",
    body: JSON.stringify({ token, eventId }),
  });
}

export function fetchReport(eventId: string): Promise<EventReport> {
  return request(`/events/${eventId}/report`);
}

export function createEvent(event: NewEvent): Promise<{ event: EventSummary }> {
  return request("/events", { method: "POST", body: JSON.stringify(event) });
}

export function issueTickets(
  eventId: string,
  tierId: string,
  count: number
): Promise<{ issued: number }> {
  return request(`/events/${eventId}/tickets`, {
    method: "POST",
    body: JSON.stringify({ tierId, count }),
  });
}

export function closeSales(eventId: string): Promise<{ event: EventSummary }> {
  return request(`/events/${eventId}/close`, { method: "POST" });
}

export function cancelEvent(eventId: string): Promise<{ event: EventSummary }> {
  return request(`/events/${eventId}/cancel`, { method: "POST" });
}

export interface PlaceOrderInput {
  symbol: string;
  side: "buy" | "sell";
  type: "limit" | "market";
  priceInCents?: number;
  quantity: number;
}

export function placeOrder(
  input: PlaceOrderInput
): Promise<{ order: Order; trades: Trade[] }> {
  return request("/orders", { method: "POST", body: JSON.stringify(input) });
}

export function cancelOrder(orderId: string): Promise<{ order: Order }> {
  return request(`/orders/${orderId}`, { method: "DELETE" });
}
