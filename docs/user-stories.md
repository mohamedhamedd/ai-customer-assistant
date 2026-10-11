# AI Customer Assistant — User Stories & Acceptance Criteria

| | |
|---|---|
| **Product** | AI Customer Assistant (text + voice) for small service businesses |
| **Document type** | Product requirements: personas, epics, user stories, acceptance criteria |
| **Version** | 1.0 (draft for planning) |
| **Owner** | Mohamed Hamed |
| **Status** | Planning — not yet implemented |

---

## 1. Product summary

A web assistant that **understands a business from its own documents** and talks to that business's customers by **text or voice**. It answers questions with **cited sources**, **captures leads**, and **creates consultation requests** on the business's behalf. Business owners manage the knowledge base and see leads, consultation requests, and conversations in a small admin area.

The product is **generic**: any business can upload its documents. The demo uses a fictional dental clinic, **"Lakeside Dental Clinic"**, with documents covering services, prices, opening hours, insurance, and FAQs.

### 1.1 Goals

1. Customers get accurate answers instantly, at any hour, in text or voice.
2. The assistant never invents facts. If the documents don't cover a question, it says so and offers a human follow-up.
3. Customers who are interested become a **lead** or a **consultation request** without filling in a form.
4. The business owner can see every lead, request, and conversation, including what the AI did and why.

### 1.2 Non-goals (this version)

- Real calendar booking or availability checks (requests are *requests*; staff confirm them).
- Payments, invoicing, or medical/clinical advice.
- Admin authentication and multi-user roles (see §9, Assumptions).
- OCR for scanned PDFs or images.
- Channels other than web (SMS, WhatsApp, phone lines).

---

## 2. Personas

### P1 — Customer (anonymous website visitor)
- **Who:** A member of the public on the business's website. Examples: a new patient comparing clinics, or an existing patient checking hours.
- **Context:** Often on a phone, often in a hurry, sometimes driving or busy and preferring to talk instead of type.
- **Needs:** Quick, trustworthy answers; an easy way to book without a long form; no account needed.
- **Frustrations:** Bots that make things up, forget what was said two messages ago, or force a sign-up.

### P2 — Business Admin (owner / office manager)
- **Who:** Runs the business. Not technical.
- **Needs:** Upload existing documents (price list, FAQ) and have the assistant "just know" them; see new leads and consultation requests in one place; trust that the AI isn't promising things the business doesn't offer.
- **Frustrations:** Complicated setup; no visibility into what the bot told customers.

### P3 — Business Staff (front desk) — *secondary*
- **Who:** Follows up on leads and confirms consultation requests.
- **Needs:** A clear list of pending requests with contact details and the conversation context.
- *In this version Staff use the same admin area as the Admin.*

### P4 — System / Operator (developer running the platform)
- **Who:** The engineer who deploys and maintains the product.
- **Needs:** Seed data, logs of every tool call, graceful failure behaviour, setup that can be reproduced.

---

## 3. Epics overview

| ID | Epic | Persona | Priority |
|---|---|---|---|
| E1 | Web chat conversation | Customer | Must |
| E2 | Voice conversation | Customer | Must |
| E3 | Knowledge answers with sources (RAG) | Customer | Must |
| E4 | Lead capture | Customer → Business | Must |
| E5 | Consultation requests | Customer → Business | Must |
| E6 | Conversation memory & context | Customer | Must |
| E7 | Knowledge base management | Admin | Must (seed script acceptable fallback) |
| E8 | Leads & consultations management | Admin / Staff | Must (view) / Should (status updates) |
| E9 | Conversation review & AI audit trail | Admin / Operator | Should |
| E10 | Business profile | Admin | Should |
| E11 | Reliability & error handling | System | Must |
| E12 | Safety, security & privacy | System | Must |

Priority uses **MoSCoW**: Must / Should / Could / Won't (this version).

Story IDs follow `US-<epic>.<n>`. Acceptance criteria use **Given / When / Then**.

---

## 4. Customer stories

### E1 — Web chat conversation

#### US-1.1 Start a conversation without signing up — *Must*
**As a** customer, **I want** to open the chat and start typing immediately, **so that** I can get answers without creating an account.

**Acceptance criteria**
- **Given** I open the chat page for the first time, **when** the page loads, **then** I see a welcome message with the business name and 3–4 suggested questions (e.g. "What services do you offer?", "What are your opening hours?").
- **Given** I am a first-time visitor, **when** the page loads, **then** an anonymous session ID is created in my browser and no personal data is requested.
- **Given** I click a suggested question, **then** it is sent as my message.

#### US-1.2 Send a message and see a streaming reply — *Must*
**As a** customer, **I want** to see the assistant's answer appear as it is being written, **so that** the chat feels fast and alive.

**Acceptance criteria**
- **Given** I type a message and press Enter or the Send button, **then** my message appears at once in the thread and the input clears.
- **When** the assistant is working, **then** a "thinking" indicator is visible within 300 ms.
- **When** the assistant looks something up or performs an action, **then** a short status is shown (e.g. "Searching clinic information…", "Saving your details…").
- **Then** the answer text streams in token by token, and the thread auto-scrolls unless I have scrolled up.
- **Given** a reply is streaming, **then** the Send button is disabled (no double submits). Shift+Enter inserts a new line.

#### US-1.3 Input validation in the composer — *Must*
**As a** customer, **I want** clear limits on what I can send, **so that** I don't lose a long message to a silent error.

**Acceptance criteria**
- Empty or whitespace-only messages cannot be sent (button disabled).
- Messages are limited to **2,000 characters**; a counter appears from 1,800 characters and the button is disabled above the limit.
- **Given** the server rejects a message (e.g. too long, rate limited), **then** a clear inline error is shown and my text stays in the input.

#### US-1.4 Mobile-friendly chat — *Must*
**As a** customer on a phone, **I want** the chat to fit my screen and keyboard, **so that** I can use it comfortably.

**Acceptance criteria**
- Works from 360 px width upward with no horizontal scrolling.
- The composer stays visible above the on-screen keyboard.
- Tap targets are at least 44×44 px.

#### US-1.5 Start a new conversation — *Could*
**As a** customer, **I want** to start fresh, **so that** a previous topic doesn't confuse the assistant.

**Acceptance criteria**
- **Given** I click "New conversation" and confirm, **then** a new anonymous session starts and the thread is empty. The old conversation remains stored for the business.

---

### E2 — Voice conversation

#### US-2.1 Talk to the assistant — *Must*
**As a** customer, **I want** to press a microphone button and speak naturally, **so that** I can get answers without typing.

**Acceptance criteria**
- **Given** I press the mic button for the first time, **then** the browser asks for microphone permission, with a short explanation shown beforehand ("We use your microphone only while voice mode is on").
- **When** the voice session connects, **then** the UI shows the state *Connecting → Listening* within ~2 seconds on a normal connection.
- **When** I speak and pause, **then** the assistant detects the end of my turn automatically (no push-to-talk needed) and answers with spoken audio.
- The voice UI clearly shows the current state: **Connecting, Listening, You're speaking, Thinking, Assistant speaking, Error**.

#### US-2.2 Interrupt the assistant — *Must*
**As a** customer, **I want** to cut in while the assistant is talking, **so that** the conversation feels natural.

**Acceptance criteria**
- **Given** the assistant is speaking, **when** I start talking, **then** its audio stops within ~500 ms and it listens to me.

#### US-2.3 Live captions — *Must*
**As a** customer, **I want** to see a transcript of what I said and what the assistant said, **so that** I can confirm I was understood. This also supports hearing-impaired users.

**Acceptance criteria**
- My speech and the assistant's speech appear as messages in the same thread, marked with a small voice icon.
- Sources and action confirmations (E3–E5) appear in voice mode exactly as in text mode.

#### US-2.4 Voice takes the same actions as text — *Must*
**As a** customer, **I want** to ask questions, share my details, and request a consultation by voice, **so that** I don't have to switch to typing.

**Acceptance criteria**
- Everything in E3, E4 and E5 works in voice mode with the same validation and the same database records.
- When I spell my email by voice, the assistant reads it back to confirm it before saving.

#### US-2.5 Control and end the voice session — *Must*
**As a** customer, **I want** to mute or end voice mode at any time, **so that** I stay in control of my microphone.

**Acceptance criteria**
- Mute and End buttons are always visible during voice mode.
- **When** I end voice mode, **then** the microphone is released (the browser's mic indicator turns off) and I can continue in text with full context.

#### US-2.6 Voice unavailable — *Must*
**As a** customer, **I want** a clear message when voice can't work, **so that** I can fall back to text.

**Acceptance criteria**
- Microphone permission denied: show "Microphone access is blocked. You can allow it in your browser settings, or keep chatting by text."
- Unsupported browser or connection failure: show a non-blocking error and keep the text composer usable.
- If the voice connection drops mid-conversation, show "Voice disconnected" with a Reconnect button. The transcript so far is kept.

---

### E3 — Knowledge answers with sources (RAG)

#### US-3.1 Accurate answers from the business's documents — *Must*
**As a** customer, **I want** answers based on the business's actual information, **so that** I can trust them.

**Acceptance criteria**
- **Given** the documents state that teeth whitening costs $X, **when** I ask "How much is whitening?", **then** the answer states $X.
- **Given** a follow-up like "And how long does it take?", **then** the assistant understands "it" refers to whitening (see E6).
- Answers are concise (2–5 sentences or a short list), in plain language.

#### US-3.2 See where an answer came from — *Must*
**As a** customer, **I want** to see the source of an answer, **so that** I know it isn't made up.

**Acceptance criteria**
- Every answer that uses business information shows one or more **source chips** under the message (document title, and section heading where available).
- Clicking a chip opens a preview of the exact text excerpt used.
- Sources shown come from the retrieval system's actual results, never from text the model wrote itself (so the model cannot invent a citation).
- Answers that use no business information (e.g. greetings) show no sources.

#### US-3.3 Honest "I don't know" — *Must*
**As a** customer, **I want** the assistant to admit when it doesn't know, **so that** I'm not misled.

**Acceptance criteria**
- **Given** I ask something the documents don't cover (e.g. "Do you treat horses?"), **then** the assistant says it doesn't have that information. It does **not** guess.
- **Then** it offers a next step: "I can have someone from the team contact you — would you like that?" (leads into E4).
- **Given** only weakly related content exists (below the similarity threshold), **then** it is treated as "not found".

#### US-3.4 Stay on topic and within limits — *Must*
**As a** customer, **I want** the assistant to stay focused on the business, **so that** the experience is professional.

**Acceptance criteria**
- Off-topic requests (e.g. "write me a poem") get a polite redirect to how it can help with the business.
- **Domain safety (clinic demo):** the assistant does not diagnose or give medical advice. For symptoms it suggests booking a consultation; for emergencies it tells the user to call local emergency services (911).
- It does not promise prices, discounts, or availability that aren't in the documents.

---

### E4 — Lead capture

#### US-4.1 Share my contact details in conversation — *Must*
**As a** customer, **I want** to give my name and contact details during the chat, **so that** the business can follow up without me filling in a form.

**Acceptance criteria**
- The assistant asks for details **only when relevant**: I want follow-up, a consultation, or an answer the documents can't give. It never asks at the start of the chat.
- Required: **name** and at least one of **email** or **phone**. Optional: **interest** (e.g. "Invisalign").
- Before saving, the assistant **confirms the details back** to me ("Just to confirm: Sara Ali, sara@example.com — correct?").
- On success, a **confirmation card** appears in the thread ("✓ Your details were shared with Lakeside Dental Clinic").

#### US-4.2 Invalid details are caught — *Must*
**As a** customer, **I want** to be told if I mistyped my email or phone, **so that** the business can actually reach me.

**Acceptance criteria**
- Invalid email (e.g. `sara@gmail`) → the assistant explains the problem and asks again. Nothing is saved.
- Invalid phone (fewer than 7 digits or containing letters) → same behaviour.
- Emails are stored lowercase and phone numbers in a normalised format.

#### US-4.3 No duplicate leads — *Must*
**As a** business, **I want** one lead per person, **so that** staff don't contact the same customer twice.

**Acceptance criteria**
- **Given** a lead with the same email (or phone) already exists for this business, **then** the existing lead is updated (e.g. new interest), not duplicated.
- The conversation is linked to the lead, so later turns know who the customer is (E6).

---

### E5 — Consultation requests

#### US-5.1 Request a consultation in conversation — *Must*
**As a** customer, **I want** to ask for a consultation for a specific service and time, **so that** I can book without calling.

**Acceptance criteria**
- The assistant collects: **service**, **preferred date & time**, and optional **notes**. If no lead exists yet, it collects lead details first (E4).
- Relative dates ("next Tuesday afternoon") are resolved using the **current date and the business's timezone**. The assistant confirms the exact date and time back ("Tuesday, Oct 20 at 3:00 PM — correct?").
- On success, a **confirmation card** shows the service, date and time, and status **"Pending — the clinic will confirm"**.
- The assistant never says the appointment is *booked* or *confirmed*. It is a request.

#### US-5.2 Invalid consultation inputs are caught — *Must*
**As a** customer, **I want** to be corrected if my request can't be accepted, **so that** I don't think I'm booked when I'm not.

**Acceptance criteria**
- A date in the past → the assistant explains and asks for a future date.
- A date more than 6 months ahead → asks for a nearer date.
- A service that isn't offered (according to the documents) → the assistant says so and lists the available services.
- *Assumption:* opening hours are checked by the assistant against the documents, not enforced by the database (see §9).

#### US-5.3 No duplicate requests — *Must*
**As a** business, **I want** retried or repeated requests to not create duplicates.

**Acceptance criteria**
- The same lead + service + date/time creates exactly one request. A repeat returns the existing one.

---

### E6 — Conversation memory & context

#### US-6.1 Remember earlier messages in the conversation — *Must*
**As a** customer, **I want** the assistant to remember what I said earlier, **so that** I don't repeat myself.

**Acceptance criteria**
- Follow-up questions that rely on earlier turns are understood (pronouns, "that one", "the second option").
- The most recent **~20 messages** are used as working context. Older turns are not sent to the model (to control cost).

#### US-6.2 Continue where I left off — *Must*
**As a** returning customer on the same browser, **I want** to see and continue my previous conversation, **so that** I don't start over.

**Acceptance criteria**
- **Given** I return on the same browser, **then** my previous messages load and the assistant continues with full context.
- History is loaded from the server (the source of truth), not trusted from the browser.

#### US-6.3 Don't ask for details I already gave — *Must*
**As a** customer, **I want** the assistant to remember my name and contact details once shared, **so that** booking is quick.

**Acceptance criteria**
- **Given** I already shared my details, **when** I request a consultation later (even in a later visit), **then** the assistant uses my saved details and only confirms them.
- The assistant may address me by name after I've shared it.

#### US-6.4 Seamless switch between text and voice — *Must*
**As a** customer, **I want** to switch between typing and talking in the same conversation, **so that** I can use whichever suits the moment.

**Acceptance criteria**
- Voice turns and text turns are stored in the same conversation, in order.
- After a voice session ends, a typed follow-up ("what was that price again?") is answered with the voice context.

---

## 5. Admin & staff stories

> **Note:** In this version the admin area has **no login** (see §9). It is intended for local/demo use only.

### E7 — Knowledge base management

#### US-7.1 Upload business documents — *Must*
**As an** admin, **I want** to upload my existing documents, **so that** the assistant learns my business without manual data entry.

**Acceptance criteria**
- Supported: **.txt, .md, and text-based .pdf**, up to **10 MB** each. Multiple files can be selected.
- Drag-and-drop and a file picker are both available.
- Each upload shows a status: **Processing → Ready** (with number of sections indexed) or **Failed** (with a reason).
- Unsupported types are rejected before upload with a clear message.
- A PDF with no extractable text (scanned) fails with: "This PDF looks scanned — no text could be read. Upload a text-based PDF or a .txt/.md file."

#### US-7.2 Avoid duplicate documents — *Must*
**As an** admin, **I want** re-uploading the same file to be harmless, **so that** answers aren't skewed by duplicates.

**Acceptance criteria**
- Uploading a file whose content is identical to an existing document is detected and reported ("Already in your knowledge base"). No new chunks are created.

#### US-7.3 See and remove documents — *Must*
**As an** admin, **I want** to see all documents and delete outdated ones, **so that** the assistant only uses current information.

**Acceptance criteria**
- A table lists title, type, status, number of sections, and upload date.
- Delete asks for confirmation; after deletion the assistant no longer uses that document's content in answers.

#### US-7.4 Preview what the assistant learned — *Could*
**As an** admin, **I want** to preview how a document was split into sections, **so that** I can trust the content was read correctly.

**Acceptance criteria**
- Opening a document shows its indexed sections (heading + text) in order.

#### US-7.5 Test the assistant against my documents — *Could*
**As an** admin, **I want** a "Test search" box, **so that** I can check what the assistant would find for a question.

**Acceptance criteria**
- Shows the top matching sections with their similarity scores.

### E8 — Leads & consultation requests

#### US-8.1 View leads — *Must*
**As an** admin or staff member, **I want** a list of all captured leads, **so that** I can follow up.

**Acceptance criteria**
- Table: name, email, phone, interest, channel (text/voice), captured date. Newest first.
- Opening a lead shows its consultation requests and a link to the conversation.
- Empty state explains where leads come from.

#### US-8.2 View consultation requests — *Must*
**As an** admin or staff member, **I want** a list of consultation requests, **so that** I can confirm them with customers.

**Acceptance criteria**
- Table: customer name, contact, service, preferred date & time (in the business timezone), status, created date.
- Filter by status (Pending / Confirmed / Cancelled). Default: Pending.

#### US-8.3 Update request status — *Should*
**As a** staff member, **I want** to mark a request Confirmed or Cancelled, **so that** the team knows what's handled.

**Acceptance criteria**
- Status changes save immediately with visible feedback. Failure shows an error and reverts the change in the UI.

### E9 — Conversation review & AI audit trail

#### US-9.1 Read customer conversations — *Should*
**As an** admin, **I want** to read conversations, **so that** I understand what customers ask and how the assistant responds.

**Acceptance criteria**
- List of conversations: started, last activity, message count, linked lead (if any), channels used.
- Transcript view shows messages in order with text/voice markers and sources.

#### US-9.2 See what the AI did and why — *Should*
**As an** admin or operator, **I want** to see each tool the AI used, with its inputs and outcome, **so that** I can trust and debug its actions.

**Acceptance criteria**
- Inline in the transcript: each tool call (search, save lead, create request) shows its name, arguments, result (success or error), and duration.
- Failed tool calls are visually highlighted.

#### US-9.3 Spot knowledge gaps — *Could*
**As an** admin, **I want** to see questions the assistant couldn't answer, **so that** I can add the missing information to my documents.

**Acceptance criteria**
- A list of customer questions where search found nothing relevant, with a link to the conversation.

### E10 — Business profile

#### US-10.1 Edit business profile — *Should*
**As an** admin, **I want** to set my business name, short description, and timezone, **so that** the assistant introduces the business correctly and handles dates in the right timezone.

**Acceptance criteria**
- Fields: name (required, max 100 chars), description (max 500 chars), timezone (selected from a list).
- Changes apply to the next customer message without a redeploy.

#### US-10.2 Add another business — *Should*
**As an** admin, **I want** to add another business with its own documents, **so that** the same assistant serves it without any code change.

**Acceptance criteria**
- Creating a business asks for name, short description, timezone and assistant guidelines (business-specific rules, e.g. "no medical advice" for a clinic).
- After uploading its documents, the business has its own chat, which answers only from its documents, with sources.
- Other businesses are unaffected: their answers never draw on another business's documents.
- *Scope note:* for the local demo, a home page lists the businesses as cards. Tenant sign-up and per-tenant admin login are out of scope (see §9, A1, A2).

---

## 6. System stories — reliability (E11)

#### US-11.1 Tool failures don't break the conversation — *Must*
**As a** customer, **I want** the assistant to handle errors gracefully, **so that** I'm never left with a broken chat or a false confirmation.

**Acceptance criteria**
- If a tool fails (database down, timeout), the assistant tells me plainly ("I couldn't save your request just now") and offers an alternative (try again, or the clinic's phone number if it is in the documents).
- The assistant **never claims an action succeeded** unless the tool returned success.
- The failure is logged with conversation ID, tool name, arguments, and error.

#### US-11.2 Invalid tool inputs are caught before reaching the database — *Must*
**As a** system, **I want** every tool input validated against a schema, **so that** bad data never gets saved.

**Acceptance criteria**
- Validation errors are returned to the AI as structured messages it can act on (e.g. ask the customer to correct their email).
- Validation rules are identical for text and voice.

#### US-11.3 AI provider failures — *Must*
**As a** customer, **I want** a clear message if the AI service is unavailable, **so that** I'm not left waiting.

**Acceptance criteria**
- AI requests time out after a bounded time (target 30 s). The user sees "I'm having trouble responding right now. Please try again in a moment."
- My message is still saved and can be retried.

#### US-11.4 No runaway agent loops — *Must*
**As an** operator, **I want** a limit on tool-call rounds per message, **so that** cost and latency stay bounded.

**Acceptance criteria**
- At most **5 tool rounds** per user message; then the assistant gives its best answer or a graceful fallback.

#### US-11.5 Document ingestion failures — *Must*
**As an** admin, **I want** failed uploads to show a reason and leave no partial data, **so that** the knowledge base stays consistent.

**Acceptance criteria**
- If text extraction or embedding fails, the document is marked **Failed** with a reason, and no partial chunks remain searchable.

#### US-11.6 Network loss in the browser — *Must*
**As a** customer, **I want** to know when I'm offline, **so that** I understand why nothing happens.

**Acceptance criteria**
- A failed send shows "Message not sent — Retry" on that message. Retry resends it without duplicating it.

---

## 7. System stories — safety, security & privacy (E12)

#### US-12.1 Secrets never reach the browser — *Must*
- The OpenAI API key and the Supabase service key are used only on the server.
- Voice sessions use a **short-lived ephemeral token** issued by the server.

#### US-12.2 Database not publicly accessible — *Must*
- Row-Level Security is enabled on all tables. The browser has no direct database access; all reads and writes go through the server.

#### US-12.3 Conversation history can't be tampered with — *Must*
- The browser sends only the new message and its session ID. History is loaded server-side, so a user cannot inject fake assistant turns.

#### US-12.4 Prompt-injection resistance — *Must*
- The assistant refuses to reveal its system instructions or act outside its tools when a user asks it to ("ignore previous instructions…").
- Tool permissions are limited by design: the AI can only search, save a lead, and create a request. It cannot read other customers' data.

#### US-12.5 Data minimisation — *Should*
- Only the data needed for follow-up is collected (name, email/phone, interest, request details). Voice audio is not stored, only transcripts.

#### US-12.6 Abuse protection — *Could*
- Basic rate limit per session (e.g. 20 messages / minute) with a friendly message when exceeded.

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| **Latency (text)** | First streamed token in < 2 s for answers that need no tool, < 4 s when a knowledge search is required (p50, normal network). |
| **Latency (voice)** | Assistant starts speaking within ~1.5 s after the customer stops talking (p50). |
| **Accuracy** | Every factual answer about the business is supported by a retrieved source; unknown questions produce an honest "I don't know". |
| **Cost** | Small, cheap models for chat and embeddings; history capped at ~20 messages; top 6 chunks per search. Voice is the main cost driver and is noted in the README. |
| **Accessibility** | WCAG 2.1 AA: keyboard operable, visible focus, screen-reader announcements for new messages, captions for voice. |
| **Browser support** | Latest Chrome, Safari, Edge, Firefox; mobile Safari and Chrome. Voice requires WebRTC and microphone support. |
| **Observability** | Structured server logs per request (conversation ID, latency, tool calls, errors); tool-call audit table. |
| **Portability** | Runs locally with one setup flow (Supabase in Docker + Next.js); migrations and seed data in the repo. |

---

## 9. Assumptions & open questions

| # | Assumption / question | Decision for this version |
|---|---|---|
| A1 | Admin authentication | Out of scope. Admin pages are unprotected and for demo/local use only; Supabase Auth would be added for production. |
| A2 | Single vs multiple businesses | Data model is multi-business; each chat serves one business. For the local demo, the admin can add a business and a home page lists them (US-10.2). |
| A3 | Real booking | Not included. Consultation requests are created as *Pending* for staff to confirm. |
| A4 | Opening hours validation | Checked by the assistant using the documents; not enforced in the database (hours aren't stored as structured data). |
| A5 | Scanned PDFs / images | Not supported. They would need OCR or a vision model (documented in README). |
| A6 | Languages | English only. |
| A7 | Data retention | Conversations are kept indefinitely in the demo. Production would need a retention policy and consent notice. |
| A8 | Customer identity | Anonymous browser session only. Clearing browser storage starts a new conversation. |

---

## 10. Traceability — assessment requirements → stories

| Assessment requirement | Covered by |
|---|---|
| Web Chat (Next.js) | E1 (US-1.1 – 1.5) |
| Voice AI (real-time, natural speech) | E2 (US-2.1 – 2.6) |
| RAG with source references | E3 (US-3.1 – 3.4), E7 |
| AI Agent: tool calling, leads, consultations | E4, E5, US-2.4 |
| Database (Supabase) | E4, E5, E6, E7, E8, US-12.2 |
| Context & Memory | E6 (US-6.1 – 6.4) |
| Reliability: unknowns, invalid inputs, tool & DB failures | US-3.3, US-4.2, US-5.2, E11 |

---

## 11. Demo scenarios (what the video must show)

1. **Text + RAG:** "What services do you offer and how much is whitening?" → answer with source chips → click a chip to show the excerpt.
2. **Follow-up memory:** "How long does it take?" → understood as whitening.
3. **Unknown answer:** "Do you offer laser eye surgery?" → honest "I don't know" + offer of follow-up.
4. **Invalid input:** give a broken email → assistant asks to correct it.
5. **Lead + consultation (text):** share details → confirmation card → "next Tuesday at 3pm" → resolved date confirmed → request card.
6. **Voice:** switch to voice, ask about opening hours, interrupt mid-answer, request a consultation by voice.
7. **Cross-channel memory:** end voice, type "what time did I book again?" → correct answer.
8. **Admin:** upload a new document → Ready → ask about it in chat → the lead and request appear in admin → the tool-call audit trail in the conversation view.
9. **Failure handling:** simulate a database outage → assistant reports it can't save, with no false confirmation.
