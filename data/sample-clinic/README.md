# Sample business: Lakeside Dental Clinic

Fictional knowledge base for the demo. Any resemblance to a real clinic is coincidental; the phone number uses the reserved 555 range and the addresses use `.example` domains.

## Files

| File | What it covers | Format |
|---|---|---|
| `services.md` | Every service, what it involves, how long it takes | Markdown, nested headings |
| `pricing.md` | Every price (the only file that contains prices) | Markdown with tables |
| `hours-location.md` | Opening hours, contact details, address, parking | Markdown with a table |
| `insurance-payment.md` | Accepted insurance, payment methods, financing, membership plan | Markdown |
| `faq.md` | Short Q&A pointing to the guides above | Markdown, one heading per question |
| `policies.pdf` | Cancellation fees, late arrival, online requests, privacy | Text PDF (generated from `policies.html`) |

The PDF is deliberately included so the ingestion pipeline is exercised on a format without heading structure.

## Design rules

- **Each fact lives in exactly one file.** Prices only in `pricing.md`, hours only in `hours-location.md`. The FAQ refers to the guides instead of repeating numbers, so retrieval never finds two conflicting sources.
- **Written for retrieval.** Headings name the thing a customer would ask about ("Teeth whitening", "Opening hours"), so a chunk's heading prefix carries meaning.
- **Deliberate gaps.** Some plausible questions are not answered anywhere, so the "I don't know" behaviour can be demonstrated honestly (see below).

## Demo questions and where the answer lives

This table is also the retrieval evaluation set used in PR-05.

| # | Question | Expected answer | Source |
|---|---|---|---|
| 1 | How much is teeth whitening? | $349 in-office, $199 take-home kit | `pricing.md` › Cosmetic treatment |
| 2 | How long does whitening take? | 60–90 minutes in-office; take-home ~2 weeks, 30 min/day | `services.md` › Teeth whitening |
| 3 | What are your opening hours? | Mon–Thu 8–5, Fri 8–2, Sat 9–1 (1st and 3rd), Sun closed | `hours-location.md` › Opening hours |
| 4 | Are you open on Tuesday afternoon? | Yes, until 5:00 PM | `hours-location.md` › Opening hours |
| 5 | Do you accept Delta Dental? | Yes, in-network | `insurance-payment.md` › Dental insurance |
| 6 | Do you take Medicaid? | No | `insurance-payment.md` › Dental insurance |
| 7 | What's your cancellation policy? | 24 hours' notice; $50 fee, $100 for visits over 60 min | `policies.pdf` › section 1 |
| 8 | Where do I park? | Free lot behind the building | `hours-location.md` › Parking and transport |
| 9 | What's your phone number? | (503) 555-0142 | `hours-location.md` › Contact |
| 10 | How much does Invisalign cost? | $3,500–$5,500; free consultation | `pricing.md` › Orthodontics |
| 11 | Do you offer sedation? | Nitrous oxide only; no IV sedation | `services.md` › Sedation and comfort |
| 12 | What is the Smile Plan? | $29/month membership for uninsured patients | `insurance-payment.md` + `pricing.md` |
| 13 | Is an online request a confirmed appointment? | No, the front desk confirms within one working day | `policies.pdf` › section 3 |

## Deliberate gaps (expected answer: "I don't have that information")

| Question | Why it's a gap |
|---|---|
| Do you offer laser eye surgery? | Not a dental service; nothing in the documents |
| Do you do Botox or dermal fillers? | Plausible for a cosmetic clinic, but not offered here |
| How much does a dental implant cost? | Documents say it's quoted after a consultation, so the assistant should say that, not invent a number |
| Which dentist should I see for my toothache? | Medical advice; the assistant should suggest booking, not diagnose |
| Do you have a branch in Portland? | Only one location is described |

## Regenerating the PDF

```bash
soffice --headless --infilter="HTML (StarWriter)" --convert-to pdf:writer_pdf_Export --outdir data/sample-clinic data/sample-clinic/policies.html
```

The `--infilter` matters: LibreOffice's default Writer/Web export dropped letters from the extracted text ("Sptmbr" for "September"), which would have corrupted embeddings. The Writer filter with a font LibreOffice ships (Liberation Sans) extracts cleanly; this is verified with `pdf-parse` before the file is committed.
