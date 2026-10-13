# Sample business: Lakeside Dental Clinic

Fictional knowledge base for the demo. Any resemblance to a real clinic is coincidental; the phone number uses the reserved 555 range and the addresses use `.example` domains.

## Files

| File | What it covers | Format |
|---|---|---|
| `services.md` | Every service, what it involves, how long it takes | Markdown, nested headings |
| `pricing.md` | How fees work: before insurance, orthodontic payments, implant quotes, the Smile Plan fee | Markdown |
| `location-contact.md` | Contact details, address, accessibility, parking, transport | Markdown |
| `insurance-payment.md` | Accepted insurance, payment methods, financing, membership plan | Markdown |
| `faq.md` | Short Q&A pointing to the guides above | Markdown, one heading per question |
| `policies.pdf` | Cancellation fees, late arrival, online requests, privacy | Text PDF (generated from `policies.html`) |

The PDF is deliberately included so the ingestion pipeline is exercised on a format without heading structure.

Its **services table** (names, categories, prices, durations, which can be requested) and **opening hours** (the week, last appointment an hour before closing, the "first and third Saturday" note, closed dates) aren't documents: they are seeded into the admin tables by `supabase/seed.sql`, and edited in Admin > Services and Admin > Opening hours.

## Design rules

- **Each fact lives in exactly one place.** Service prices, durations and opening hours only in the tables; everything descriptive in the documents. The FAQ refers to the guides instead of repeating numbers, so the assistant never finds two conflicting sources.
- **Written for retrieval.** Headings name the thing a customer would ask about ("Teeth whitening", "Opening hours"), so a chunk's heading prefix carries meaning.
- **Deliberate gaps.** Some plausible questions are not answered anywhere, so the "I don't know" behaviour can be demonstrated honestly (see below).

## Demo questions and where the answer lives

This table is also the retrieval evaluation set used in PR-05. Questions the tables answer (the price of whitening or Invisalign, the opening hours) aren't searched, so they're not in it.

| # | Question | Expected answer | Source |
|---|---|---|---|
| 1 | Does whitening work on crowns? | No, it doesn't change the colour of crowns, veneers or fillings | `services.md` › Teeth whitening |
| 2 | How long does whitening take? | 60–90 minutes in-office; take-home ~2 weeks, 30 min/day | `services.md` › Teeth whitening |
| 3 | What's your address? | 420 Lakeshore Drive, Suite 200, Lake Oswego | `location-contact.md` › Address |
| 4 | Is there a bus to the clinic? | TriMet 35 and 36, two minutes' walk | `location-contact.md` › Parking and transport |
| 5 | Do you accept Delta Dental? | Yes, in-network | `insurance-payment.md` › Dental insurance |
| 6 | Do you take Medicaid? | No | `insurance-payment.md` › Dental insurance |
| 7 | What's your cancellation policy? | 24 hours' notice; $50 fee, $100 for visits over 60 min | `policies.pdf` › section 1 |
| 8 | Where do I park? | Free lot behind the building | `location-contact.md` › Parking and transport |
| 9 | What's your phone number? | (503) 555-0142 | `location-contact.md` › Contact |
| 10 | How much does a dental implant cost? | Quoted after a consultation and a 3D scan | `pricing.md` › Dental implants |
| 11 | Do you offer sedation? | Nitrous oxide only; no IV sedation | `services.md` › Sedation and comfort |
| 12 | What is the Smile Plan? | $29/month membership for uninsured patients | `insurance-payment.md` + `pricing.md` |
| 13 | Is an online request a confirmed appointment? | No, the front desk confirms within one working day | `policies.pdf` › section 3 |

## Deliberate gaps (expected answer: "I don't have that information")

| Question | Why it's a gap |
|---|---|
| Do you offer laser eye surgery? | Not a dental service; nothing in the documents |
| Do you do Botox or dermal fillers? | Plausible for a cosmetic clinic, but not offered here |
| Which dentist should I see for my toothache? | Medical advice; the assistant should suggest booking, not diagnose |
| Do you have a branch in Portland? | Only one location is described |

## Regenerating the PDF

```bash
soffice --headless --infilter="HTML (StarWriter)" --convert-to pdf:writer_pdf_Export --outdir data/sample-clinic data/sample-clinic/policies.html
```

The `--infilter` matters: LibreOffice's default Writer/Web export dropped letters from the extracted text ("Sptmbr" for "September"), which would have corrupted embeddings. The Writer filter with a font LibreOffice ships (Liberation Sans) extracts cleanly; this is verified with `pdf-parse` before the file is committed.
