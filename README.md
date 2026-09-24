# Face Value

Ticket resale where nobody can charge more than face value, and tickets go
out in the order people asked for them.

![Events](docs/images/events.png)

## The idea

Resale is unfair in two ways. Touts buy in bulk and sell at a markup, and
when a gig sells out the returns go to whoever happens to be refreshing at
the right moment.

This fixes both by running every ticket through an order book with the
price capped at face value. A cap turns the book into a queue: if nobody
can outbid anybody, the only thing left to sort on is who asked first.
That is price-time priority with the price dimension deliberately removed.

Nothing is paid on the site. You claim a ticket and pay the venue on the
night, so there is no float to hold, no refunds to process, and nothing for
a tout to make money on.

![An event](docs/images/event.png)

One button does both jobs. If a ticket is spare you get it; if not, your
request rests in the book and holds your place. Buying and queueing are the
same order behaving differently depending on whether supply exists. The
listing sorts by date or price and filters by price range, date range or
availability, with the state in the URL so a view can be shared.

## Fairness, demonstrated

`npm run bench:drop` starts an engine, creates ten thousand accounts over
HTTP, releases two thousand tickets, and has everyone claim at once.

![Drop benchmark](docs/images/drop.png)

Every ticket went to a request sequenced earlier than every request that
missed out, with no overlap at the boundary. The benchmark exits non-zero
if that fails, or if the number of winners does not equal the number of
tickets, so it works as a test.

On a Core Ultra 7 laptop, with the load generator fighting the server for
the same cores: 10,000 claims in 6.4s, 1,573/sec, p50 248ms, p99 559ms.
Almost all of that is queueing. Matching itself runs at 1.3 million orders
a second, 0.40 us median, measured in-process by `npm run bench`. Full
numbers in [`engine/bench/results.md`](engine/bench/results.md).

## Accounts

There is one admin, who puts on events, approves what sellers submit and
works the door. Everybody else is a member holding two switches, buying and
selling. The question is asked once, at sign-up, and either switch can be
flipped later without making a second account.

![Creating an account](docs/images/register.png)

![Both switches on](docs/images/register-both.png)

Buying covers claiming a ticket and joining a queue. Selling covers putting
up a ticket you got somewhere else, which an admin has to approve. Passing
on a ticket you already hold is gated by neither, because that ticket is
already in the system and already verified.

Everybody signs in at the same place. The account carries what it can do,
so nobody declares anything, and the site sends you where you belong.
Passwords are scrypt hashes and never leave the server. Settings live in
Postgres rather than the browser, so the theme follows you to another
machine; a small script applies it before the first paint.

![Settings](docs/images/settings-dark.png)

The admin is not created through the site, which is why the site never
offers it as a choice. It comes from `engine/admin.json`, or from
`ADMIN_EMAIL` and `ADMIN_PASSWORD`, and only when no admin exists yet. Out
of the box that is `admin@example.com` with the password `admin-password`.

## Putting up a ticket you cannot use

A seller does not invent an event and does not name a price. They pick one
from the catalogue, say how many they have, and attach a photo.

![Selling](docs/images/sell.png)

The admin sees the queue, looks at the photo, and approves or turns it down
with a reason the seller reads. Approving is what brings the tickets into
existence: issued in the seller's name and put on the book at the face
value the admin set, behind anything already queueing. Turning it down
creates nothing.

![The queue](docs/images/listings.png)

There is no way to check a ticket is real by machine, so a person looks,
and the face value comes from the event rather than from whoever is
selling. Photos are stored outside the log under names the server chooses,
checked by their first bytes rather than by what the file claims to be, and
handed only to the seller who uploaded them and to the admin.

## The catalogue

Face value only means something if somebody other than the seller sets it,
so events come from `engine/events.seed.json` and the admin owns them.
Eight ship with the project, a gig through to a free open evening, with
tiers from nothing to fifty-five dollars. Dates are days from now rather
than calendar dates, so the catalogue never goes stale.

Each tier says how many tickets to print and how many to put on sale at
once. Three ship released at zero, which is what sold out looks like: join
the queue, and when the admin releases, it drains in order. Seeding runs
through the same path a click does, so it lands in the event log and skips
anything already there.

![Admin](docs/images/admin.png)

Printing and releasing are separate decisions. Releasing places a sell
order, so the on-sale and every later resale run through the same book.
"Passed on again" counts tickets that changed hands more than once; every
hand-over records who had it, who has it now, and which trade moved it.

## The door

Tickets are numbered and the number is real: each is a distinct object with
a holder and a count of how many times it has changed hands.

A door pass is `ticketId.rotation.slot.signature`, where `slot` is the
current 30-second window and the signature is an HMAC over the other three.
The phone refreshes it every 20 seconds.

![A pass](docs/images/pass.png)

Three things follow from what is inside the signature. A screenshot dies
within about a minute, because the door accepts only the current slot and
one either side. A pass stops working the moment the ticket is passed on,
because the rotation counter moves. And nobody can forge one, because the
key never leaves the server. A used ticket is recorded as admitted, so the
same pass twice is refused even inside its 30 seconds.

![Admitted](docs/images/door-admitted.png)

![Refused](docs/images/door-refused.png)

A ticket you have put back up stops producing a pass while it waits, since
it is already spoken for. Withdraw and it works again. Otherwise you could
sell a ticket and still walk in on it.

![Your tickets](docs/images/tickets.png)

## Running it

```bash
git clone https://github.com/kaushiksridhar17/ticket-resale.git
cd ticket-resale
cp .env.example .env
docker compose up --build
```

`.env` ships with working admin details, so it runs as it is. Open
http://localhost:3000 and sign in with them; everybody else creates their
own account. The catalogue is already there, mostly on sale.

To run the engine and frontend yourself with only the database in Docker,
uncomment `DATABASE_URL` in `.env`, then:

```bash
docker compose up -d db
cd engine && npm install && npm run dev
cd frontend && npm install && npm run dev
```

The engine reads the same `.env`. Events survive in the log on disk either
way, but accounts only survive a restart when a database is configured, and
it says so on startup.

## How it holds together

```
Browser ──REST──▶ Fastify ──▶ Matching engine ──▶ Broadcaster ──WS──▶ Browser
                     │              │
                     │              ├──▶ Ticket registry (serials, custody)
                     ▼              ▼
                 Event log ──▶ Persistence queue ──▶ PostgreSQL
                (source of        (batched)          (read model)
                  truth)
```

The log stores inputs, not outcomes. Because matching is deterministic,
replaying it reproduces the same market, verified by a SHA-256 digest over
the resulting book. Postgres is a read model and can be rebuilt from the
log at any time, which one of the integration tests does. Nothing in the
claim path waits on the database: orders match in memory and return, rows
are written in batches behind them.

## Decisions worth knowing about

Money is counted in integer cents. Order arrival is decided by a sequence
number rather than a timestamp, because two requests can share a
millisecond. Tickets are reserved when somebody puts them up, so the same
ticket cannot be offered twice and cannot open a door while it waits.
Ticket rules are checked when an order is submitted and never on replay, so
a log replayed after the sales cutoff is not rejected by it. Book updates
are coalesced to 100ms.

Approving a submitted ticket counts it as issued for that event, which
nudges the printed figure above what the venue itself printed. That is the
honest way to record a real ticket entering the system, and worth knowing
before reading the numbers on an event.

## Tests

```bash
cd engine && npm test
```

365 of them, including property-based tests over thousands of randomised
order sequences: tickets are never duplicated or lost, every account's
serial count matches its balance, total hand-overs equal total quantity
traded, and the same sequence of orders always produces the same
allocation.

The Postgres integration tests skip unless a database is configured:

```bash
docker compose up -d db
docker compose exec db createdb -U facevalue facevalue_test
TEST_DATABASE_URL=postgres://facevalue:facevalue@localhost:5432/facevalue_test npm test
```

The frontend has its own, covering the sorting and filtering rules:

```bash
cd frontend && npm test
```

## Future work

- Settlement between people. Nothing is paid on the site, so a seller
  reimbursing themselves for a ticket bought elsewhere is not modelled.
  Adding it brings refunds, disputes and reversals with it.
- Suspending an account. The engine can do it and drops the sessions, but
  there is no admin screen for it.
- Telling a seller their listing was decided, rather than making them look.
- Deployment. It runs locally and in Docker; there is no hosted instance.

## Layout

```
engine/
  src/
    matchingEngine.ts   price-time priority, one book per tier
    exchangeState.ts    rules, log, recovery
    events/             events, tiers, and the seeded catalogue
    tickets/            serials and chain of custody
    listings/           seller submissions, photos, approvals
    door/               pass signing and scanning
    auth/               passwords, sessions, accounts, settings
    db/                 batched writer, migrations, Postgres schema
  bench/                engine throughput and the drop benchmark
frontend/
  app/
    page.tsx            what is on, with sorting and filtering
    events/[eventId]/   claim, queue, or pass one on
    tickets/            what you hold, and the door pass for each
    sell/               submit a ticket and watch for the decision
    admin/              events, the approval queue, reports
    door/               the scanner
    settings/           buying and selling, appearance, password
```

## Built with

TypeScript, Node, Fastify, WebSockets, PostgreSQL, Next.js, React,
Tailwind, Vitest, fast-check, Docker.
