import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const FANS = Number(process.env.FANS ?? 2000);
const TICKETS = Number(process.env.TICKETS ?? 500);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 250);
const PORT = Number(process.env.PORT ?? 3999);
const BASE = `http://127.0.0.1:${PORT}`;
const ORGANIZER = "drop-organizer@example.test";

const codes = new Map();
const waiting = new Map();

function codeFor(email) {
  const held = codes.get(email);
  if (held) {
    codes.delete(email);
    return Promise.resolve(held);
  }
  return new Promise((resolve) => waiting.set(email, resolve));
}

function noteCode(email, code) {
  const pending = waiting.get(email);
  if (pending) {
    waiting.delete(email);
    pending(code);
    return;
  }
  codes.set(email, code);
}

async function post(path, body, session) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { cookie: `session=${session}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return response;
}

async function signIn(email) {
  await post("/auth/request", { email });
  const code = await codeFor(email);
  const response = await post("/auth/verify", { email, code });
  const cookie = response.headers.getSetCookie?.() ?? [];
  const session = cookie
    .join(";")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("session="));
  if (!session) {
    throw new Error(`could not sign in ${email}`);
  }
  return session.slice("session=".length);
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, run));
  return results;
}

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

const dir = mkdtempSync(join(tmpdir(), "facevalue-drop-"));
const engine = spawn(
  process.execPath,
  [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"],
  {
    env: {
      ...process.env,
      PORT: String(PORT),
      LOGGER: "false",
      DATABASE_URL: "",
      ORGANIZER_EMAILS: ORGANIZER,
      DOOR_KEY: "bench-door-key",
      AUTH_PEPPER: "bench-pepper",
      LOG_PATH: join(dir, "events.jsonl"),
    },
    stdio: ["ignore", "pipe", "inherit"],
  }
);

createInterface({ input: engine.stdout }).on("line", (line) => {
  const match = /sign-in code for (\S+): (\d{6})/.exec(line);
  if (match) {
    noteCode(match[1], match[2]);
  }
});

async function waitForEngine() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("engine never came up");
}

function report(title, rows) {
  console.log(`\n${title}`);
  for (const [label, value] of rows) {
    console.log(`  ${label.padEnd(22)}${value}`);
  }
}

try {
  await waitForEngine();
  console.log(`engine up on ${BASE}`);

  const organizer = await signIn(ORGANIZER);
  const closesAt = Date.now() + 86_400_000;
  const created = await post(
    "/events",
    {
      name: "Drop test",
      venue: "Nowhere",
      salesCloseAt: closesAt,
      startsAt: closesAt + 3_600_000,
      tiers: [
        {
          tierId: "GA",
          name: "General admission",
          faceValueInCents: 1500,
          perPersonLimit: 1,
        },
      ],
    },
    organizer
  );
  const { event } = await created.json();
  const symbol = `${event.id}:GA`;

  await post(
    `/events/${event.id}/tickets`,
    { tierId: "GA", count: TICKETS },
    organizer
  );

  console.log(`signing in ${FANS.toLocaleString()} fans`);
  const startedSignIn = performance.now();
  const sessions = await pool(
    Array.from({ length: FANS }, (_, i) => `fan${i}@example.test`),
    100,
    (email) => signIn(email)
  );
  console.log(
    `  took ${((performance.now() - startedSignIn) / 1000).toFixed(1)}s`
  );

  await post(
    "/orders",
    {
      symbol,
      side: "sell",
      type: "limit",
      priceInCents: 1500,
      quantity: TICKETS,
    },
    organizer
  );
  console.log(`${TICKETS.toLocaleString()} tickets released\n`);

  console.log(`${FANS.toLocaleString()} fans claiming at once`);
  const started = performance.now();

  const outcomes = await pool(sessions, CONCURRENCY, async (session) => {
    const at = performance.now();
    const response = await post(
      "/orders",
      { symbol, side: "buy", type: "limit", priceInCents: 1500, quantity: 1 },
      session
    );
    const latency = performance.now() - at;

    if (response.status !== 201) {
      return { latency, status: response.status, sequence: null, got: false };
    }
    const body = await response.json();
    return {
      latency,
      status: 201,
      sequence: body.order.sequence,
      got: body.trades.length > 0,
    };
  });

  const elapsed = (performance.now() - started) / 1000;
  const accepted = outcomes.filter((o) => o.status === 201);
  const winners = accepted.filter((o) => o.got);
  const queued = accepted.filter((o) => !o.got);
  const rejected = outcomes.filter((o) => o.status !== 201);
  const latencies = outcomes.map((o) => o.latency).sort((a, b) => a - b);

  const lastWinner = Math.max(...winners.map((o) => o.sequence));
  const firstLoser = queued.length === 0 ? Infinity : Math.min(...queued.map((o) => o.sequence));
  const fair = lastWinner < firstLoser;

  report("throughput", [
    ["claims", accepted.length.toLocaleString()],
    ["elapsed", `${elapsed.toFixed(2)}s`],
    ["claims/sec", Math.round(accepted.length / elapsed).toLocaleString()],
    ["rejected", rejected.length.toLocaleString()],
  ]);

  report("latency (ms)", [
    ["p50", percentile(latencies, 50).toFixed(1)],
    ["p95", percentile(latencies, 95).toFixed(1)],
    ["p99", percentile(latencies, 99).toFixed(1)],
    ["max", latencies[latencies.length - 1].toFixed(1)],
  ]);

  report("allocation", [
    ["tickets released", TICKETS.toLocaleString()],
    ["got one", winners.length.toLocaleString()],
    ["in the queue", queued.length.toLocaleString()],
    ["last winner seq", lastWinner.toLocaleString()],
    ["first loser seq", queued.length === 0 ? "none" : firstLoser.toLocaleString()],
  ]);

  console.log(
    `\n${fair ? "FAIR" : "UNFAIR"}: every ticket went to an earlier request than every ` +
      `request that missed out`
  );

  if (winners.length !== TICKETS) {
    console.log(
      `MISMATCH: ${TICKETS} tickets released but ${winners.length} people got one`
    );
  }

  process.exitCode = fair && winners.length === TICKETS ? 0 : 1;
} finally {
  engine.kill();
  rmSync(dir, { recursive: true, force: true });
}
