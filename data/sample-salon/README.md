# Sample business: Maple Street Hair Studio

A second fictional business, so the same assistant can be tested on a very different industry. The phone number uses the reserved 555 range and the addresses use `.example` domains.

It is **seeded** by `supabase/seed.sql`: its profile and rules, its services table (names, prices, durations, which can be requested) and its opening hours (Tue–Sat, late Thursday, closed dates). Its documents are loaded with:

```bash
npm run ingest -- ./data/sample-salon --business maple-street-hair
```

Chat: http://localhost:3000/b/maple-street-hair · Admin: http://localhost:3000/admin/maple-street-hair

## Files

| File | What it covers |
|---|---|
| `services.md` | What each service involves, the patch test, aftercare |
| `policies.md` | Requests vs confirmed appointments, cancellations, deposits, redo policy |
| `location-contact.md` | Contact, address, parking, transport |
| `faq.md` | Gift cards, payment, colour brand, curly hair, walk-ins |

As with the clinic, each fact lives in one place: prices, durations and hours only in the tables.

## Things to try

| Try | Expected |
|---|---|
| How much is balayage? | $220 to $280, 3 to 4 hours (from the table) |
| Are you open on Monday? | Closed Sunday and Monday |
| Can I come Thursday at 7:30 PM? | Yes: Thursday is open until 8 PM, last start 7:30 PM |
| Do you sell gift cards? | Yes, any amount, never expire (FAQ) |
| I want highlights Saturday at 10am | Asks: partial or full highlights? |
| Book a fringe trim tomorrow | Can't be requested: walk-in only |
| I'd like colour for the first time | Mentions the 48-hour patch test (the salon's rule) |
| Will blonde suit me? | No opinion: suggests the free colour consultation |
| Do you do nails? | Not among its services (it searches first) |
| Christmas Eve at 10am | Closed (closed date) |
