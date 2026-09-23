export function centsToDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  return `${sign}${whole.toLocaleString()}.${remainder.toString().padStart(2, "0")}`;
}

export function dollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) {
    return null;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatQuantity(quantity: number): string {
  return quantity.toLocaleString();
}

export function formatPrice(cents: number): string {
  return cents === 0 ? "Free" : `$${centsToDollars(cents)}`;
}

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}