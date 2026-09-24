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

Nothing is paid here. You claim a ticket and pay the venue on the night,
which means there is no float to hold, no refunds to process, and nothing
for a tout to make money on.

![An event](docs/images/event.png)

One button does both jobs. If a ticket is spare you get it; if not, your
request rests in the book and holds your place. Buying and queueing are
the same order behaving differently depending on whether supply exists.

## Fairness, demonstrated

`npm run bench:drop` starts an engine, signs in ten thousand accounts over
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

## The door

Tickets are numbered and the number is real: each one is a distinct
object with a holder and a count of how many times it has changed hands.

A door pass is `ticketId.rotation.slot.signature`, where `slot` is the
current 30-second window and the signature is an HMAC over the other
three. The phone refreshes it every 20 seconds.

![A pass](docs/images/pass.png)

Three things follow from what is inside the signature. A screenshot dies
within about a minute, because the door only accepts the current slot and
one either side. A pass stops working the moment the ticket is passed on,
because the rotation counter moves and the old signature no longer
matches. And nobody can forge one, because the key never leaves the
server.

A used ticket is also recorded as admitted, so the same pass twice is
refused even inside its 30 seconds.

![Admitted](docs/images/door-admitted.png)

![Refused](docs/images/door-refused.png)

## Accounts

There is one admin, who puts on the events, approves what sellers submit
and works the door. Everybody else is a member, and a member holds two
switches: buying and selling. Most people want one of them, some want
both, and nobody has to decide forever. Creating an account asks the
question once, buying is on by default, and either switch can be flipped
later without making a second account.

Buying covers claiming a ticket and joining a queue. Selling covers
putting up a ticket you got somewhere else, which is the thing an admin
has to approve. Passing on a ticket you already hold is not gated by
either, because that ticket is already in the system and already
verified, and the whole point of the project is that a ticket you cannot
use goes back to the queue.

Everybody signs in at the same place with an email and a password. The
account carries what it can do, so nobody is asked to declare anything,
and the site sends you where you belong. Passwords are stored as scrypt
hashes and never leave the server.

Each account also carries its own settings, kept in Postgres rather than
in the browser, so the theme you pick follows you to another machine. A
small script applies the remembered theme before the first paint, so the
page does not start light and turn dark once the account has loaded.

The admin is not created through the site at all, which is why the site
never offers it as a choice. It comes from `engine/admin.json`, or from
`ADMIN_EMAIL` and `ADMIN_PASSWORD`, and it is only created the first time
the engine starts with no admin already there. Out of the box that is
`admin@example.com` with the password `admin-password`, which is fine for
looking around and worth changing before the first run otherwise.

## Putting up a ticket you cannot use

A seller does not invent an event and does not name a price. They pick one
out of the catalogue, say how many they have, and attach a photo of the
ticket. It waits.

The admin sees the queue, looks at the photo, and either approves it or
turns it down with a reason the seller reads. Approving is what brings the
tickets into existence: they are issued in the seller's name and go
straight onto the book at the face value the admin set for that tier, in
the same queue as the venue's own stock and behind anything already
waiting. Turning it down creates nothing.

That is the whole answer to a question this project cannot dodge. There is
no way to check a ticket is real by machine, so a person looks, and the
face value comes from the event rather than from whoever is selling.

Photos are stored outside the log under names the server chooses, checked
by their first bytes rather than by what the file claims to be, and handed
out only to the seller who uploaded them and to the admin. Submissions and
decisions go into the event log like everything else, so a restart still
knows what is waiting and what was already decided.

## The catalogue

Face value only means something if somebody other than the seller sets it,
so events are not something a seller can invent. They come from
`engine/events.seed.json`, and the admin owns them.

Eight of them ship with the project, covering a gig, a derby, a club night,
a play, a festival and a free open evening, and between them the tiers run
from nothing to fifty-five dollars. Dates are written as days from now
rather than as calendar dates, so the catalogue is never out of date on a
machine that clones this next year.

Each tier says how many tickets to print and how many of those to put on
sale straight away. The rest stay with the admin, so there is something to
release later. Three tiers ship released at zero, which is what a sold-out
event looks like: the only thing you can do is join the queue, and when the
admin releases, the queue drains in the order people joined it.

Seeding runs through the same path a person's click does, so it lands in
the event log rather than in the database, and it skips anything already
there. Restarting does not print a second set of tickets.

![Admin](docs/images/organizer.png)

Printing and releasing are separate because they are separate decisions.
Releasing places a sell order, so the initial on-sale and every later
resale run through the same book. Anyone already queueing is filled
immediately, in order.

"Passed on again" counts tickets that have changed hands more than once.
Every hand-over is recorded with who had it before, who has it now, and
which trade moved it, so a ticket carries its own chain of custody.

## Running it

```bash
git clone https://github.com/kaushiksridhar17/ticket-resale.git
cd ticket-resale
cp .env.example .env
```

The copy comes with `admin@example.com` and `admin-password` already in it,
so it runs as it is. Put your own address and password in `ADMIN_EMAIL` and
`ADMIN_PASSWORD` if you would rather, then:

```bash
docker compose up --build
```

Open http://localhost:3000 and sign in with those admin details. Everybody
else creates their own account, as a customer or a seller. The catalogue is
already there, with most of it on sale.

To run the engine and the frontend yourself with only the database in
Docker, uncomment `DATABASE_URL` in `.env` and start that one container:

```bash
docker compose up -d db
```

```bash
cd engine && npm install && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

The engine reads the same `.env`, so the admin details carry over. If you
would rather keep them out of `.env`, put them in `engine/admin.json`
instead, which is a copy of `engine/admin.example.json` and is gitignored.

The engine keeps events in an append-only log on disk either way, but
accounts only survive a restart when a database is configured, and it
says so on startup.

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
replaying the log reproduces the same market, verified by a SHA-256 digest
over the resulting book. Postgres is a read model and can be rebuilt from
the log at any time, which one of the integration tests does.

Nothing in the claim path waits on the database. Orders match in memory
and return; rows are written in batches behind them.

## Decisions worth knowing about

Money is counted in integer cents. Order arrival is decided by a sequence
number rather than a timestamp, because two requests can share a
millisecond. Tickets are reserved when a seller lists them, so the same
ticket cannot be offered twice. Ticket rules are checked when an order is
submitted and never on replay, so a log replayed after the sales cutoff is
not rejected by it. Book updates are coalesced to 100ms.

## Tests

```bash
cd engine && npm test
```

![Tests](docs/images/tests.png)

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
frontend/               Next.js, one page per thing you can do
```

## Built with

TypeScript, Node, Fastify, WebSockets, PostgreSQL, Next.js, React,
Tailwind, Vitest, fast-check, Docker.
