# Benchmark results

Hardware: [your CPU, RAM]
OS: Windows
Node: [run `node -v`]
Date: 2026-09-20

## Matching engine (in-process, no HTTP)

200,000 randomized orders on a single book, 8 accounts, 15% market
orders, prices in a 99.00-101.00 band. 20,000-order warmup discarded
so V8 JIT compilation does not distort results.

- orders submitted: 200,000
- trades executed: 159,278
- elapsed: 0.19s
- throughput: 1,047,996 orders/sec

Per-order latency:
- mean 0.84 us, p50 0.60 us, p95 1.50 us, p99 6.00 us, max 7,587 us

The max reflects a V8 garbage collection pause. p50 and p99 are the
meaningful figures; the tail is the known cost of a managed runtime.

Reproduce: `npm run bench`

## HTTP API (k6, load generator on the same machine)

Server run with request logging and market-maker bots disabled so the
measurement isolates order handling.

Constant 500/sec for 30s:
- 15,001 requests, 0 errors
- p95 9.27ms, p99 34ms
- 12 of 50 VUs needed

Ramp 250 to 2,000/sec over 80s:
- 82,400 requests, 0 errors, 87 dropped iterations
- median 514us, p95 4.61ms
- peak 47 concurrent VUs

Ramp 1,000 to 8,000/sec over 80s:
- 223,892 requests, 0 errors
- sustained 2,793 req/sec
- median 164ms, p95 203ms
- 106,021 dropped iterations; k6 saturated at 600 VUs from 39s

Practical ceiling on this hardware is roughly 2,500-3,000 orders/sec.
The load generator shares a CPU with the server, so the server's true
ceiling is higher and was not isolated.

Rejections (HTTP 422) are the exchange correctly refusing orders that
exceed available funds, not failures. They are counted separately.

Reproduce: `k6 run bench/api-ramp.js`

## Note on an earlier misleading result

An initial ramp appeared to show the server collapsing at ~1,700
req/sec with connection refusals. Server logs showed request handling
at 0.14-0.25ms throughout. The cause was ephemeral port exhaustion on
the load generator, since each request opened a new TCP connection.
Enabling connection reuse removed the failures entirely and roughly
doubled throughput.