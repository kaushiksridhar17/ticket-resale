# Benchmark results

Two benchmarks. The first measures how fast the matching engine is. The
second measures whether a ticket drop is actually fair when thousands of
people arrive at once, which is the thing this project claims.

Hardware: Intel Core Ultra 7 155U, 14 GB
OS: Windows
Node: 24.21.0
Date: 2026-09-23

## Matching engine, in-process

200,000 randomized orders on a single book, 8 accounts, 15% market
orders, prices in a 99.00-101.00 band. A 20,000-order warmup is
discarded so V8 JIT compilation does not flatter the result.

- orders submitted: 200,000
- trades executed: 159,278
- elapsed: 0.15s
- throughput: 1,324,502 orders/sec

Per-order latency:
- mean 0.67 us, p50 0.40 us, p95 1.30 us, p99 2.20 us, max 9,268 us

The max is a garbage collection pause. p50 and p99 are the meaningful
figures; the tail is the known cost of a managed runtime.

Reproduce: `npm run bench`

## The ticket drop, end to end

This is the one that matters. It starts a real engine, signs in ten
thousand separate accounts over HTTP, releases two thousand tickets,
and has all ten thousand claim at the same moment. Every request is a
genuine authenticated call through Fastify, the matching engine, and
the event log.

- claims: 10,000
- elapsed: 6.36s
- throughput: 1,573 claims/sec
- rejected: 0

Latency:
- p50 248ms, p95 351ms, p99 559ms, max 608ms

Allocation:
- tickets released: 2,000
- people who got one: 2,000
- people left in the queue: 8,000
- highest sequence number among the winners: 4,000
- lowest sequence number among everyone who missed out: 4,002

That last pair is the point. Every ticket went to a request the engine
sequenced earlier than every request that missed out, with no overlap
at the boundary. Nobody who arrived later jumped the queue, and no
ticket was handed to two people or lost. The benchmark exits non-zero
if either property fails, so it is a test as much as a measurement.

Latency is higher here than in the API numbers above because ten
thousand accounts are hitting one process from one machine, and the
load generator is competing with the server for the same cores. The
engine's own share of each request stays in the microseconds; the wait
is queueing.

Reproduce: `npm run bench:drop`

Knobs: `FANS`, `TICKETS`, `CONCURRENCY`.

```bash
FANS=10000 TICKETS=2000 CONCURRENCY=400 npm run bench:drop
```

## What was removed

There were two k6 scripts here that fired anonymous orders at ACME,
ZENX and ORBT. They stopped being meaningful when the project became a
ticket platform: every order now needs a session, and a stream of
random buys and sells at random prices does not describe anything
anyone does with a ticket. The drop benchmark replaces them, and
verifies fairness rather than only counting requests.
