import http from "k6/http";
import { check } from "k6";
import { Counter, Rate } from "k6/metrics";

const errorRate = new Rate("errors");
const accepted = new Counter("orders_accepted");
const rejected = new Counter("orders_rejected");

export const options = {
  noConnectionReuse: false,
  discardResponseBodies: true,
  scenarios: {
    ramp: {
      executor: "ramping-arrival-rate",
      startRate: 1000,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      maxVUs: 600,
      stages: [
        { target: 2000, duration: "20s" },
        { target: 4000, duration: "20s" },
        { target: 6000, duration: "20s" },
        { target: 8000, duration: "20s" },
      ],
    },
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:3001";
const SYMBOLS = ["ACME", "ZENX", "ORBT"];
const ANCHORS = { ACME: 5000, ZENX: 12500, ORBT: 800 };

export default function () {
  const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const anchor = ANCHORS[symbol];
  const side = Math.random() < 0.5 ? "buy" : "sell";
  const drift = Math.round((Math.random() - 0.5) * anchor * 0.04);

  const payload = JSON.stringify({
    userId: `load_${__VU}`,
    symbol,
    side,
    type: "limit",
    priceInCents: anchor + drift,
    quantity: 1 + Math.floor(Math.random() * 20),
  });

  const response = http.post(`${BASE}/orders`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  errorRate.add(
    !check(response, {
      "handled cleanly": (r) => r.status === 201 || r.status === 422,
    })
  );

  if (response.status === 201) {
    accepted.add(1);
  } else if (response.status === 422) {
    rejected.add(1);
  }
}