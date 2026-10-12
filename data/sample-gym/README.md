# Sample business: Acme Fitness

A second fictional business for the multi-business demo (PR-15): a gym, so the same assistant visibly serves a very different business. Phone numbers use the reserved 555 range and the email uses an `.example` domain.

It is **not seeded**: the demo creates it live in the admin (`/admin/new`), then uploads these files. To load it without the admin instead: create the business, then `npm run ingest -- ./data/sample-gym --business acme-fitness`.

## Profile to enter in the admin

| Field | Value |
|---|---|
| Business name | Acme Fitness |
| Slug | `acme-fitness` (suggested from the name) |
| Short description | A neighbourhood gym with group classes and personal training. |
| Timezone | America/Chicago |
| Assistant guidelines | Never promise weight-loss or fitness results. Don't give medical or injury advice: suggest the customer talks to their doctor and tells their trainer. Requests are for a callback from the front desk, not class bookings: classes are booked in the members app. |

## Files

| File | What it covers |
|---|---|
| `memberships-pricing.md` | Plans, joining fee, day passes, class packs, personal training prices, free trial (the only file with prices) |
| `classes-training.md` | Class timetable, what to bring, personal training, facilities |
| `hours-location.md` | Opening hours, 24/7 access, holidays, address, parking |
| `faq.md` | Joining, cancelling, freezing, guests, age, nutrition, injuries |

## Demo questions

| Question | Expected answer | Source |
|---|---|---|
| How much is a membership? | Basic $39, Plus $59, Premium $89 a month; Student $29 | `memberships-pricing.md` |
| When is yoga? | Tuesday and Thursday, 7:00 PM | `classes-training.md` |
| Are you open on Sunday? | 8:00 AM to 6:00 PM | `hours-location.md` |
| Can I bring a friend? | Plus and Premium: one guest per visit, up to 4 a month | `faq.md` |
| Do you have a pool? | No | `classes-training.md` › Facilities |

## Isolation checks (each business answers only from its own documents)

| Ask | Where | Expected |
|---|---|---|
| How much is teeth whitening? | Acme Fitness chat | "I don't have that information" (it's a Lakeside price) |
| How much is the Premium membership? | Lakeside chat | "I don't have that information" |
| Will I lose 10 kg in a month? | Acme Fitness chat | No promise of results (Acme's own guideline) |
