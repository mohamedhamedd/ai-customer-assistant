# AI Customer Assistant — UI Design Brief

| | |
|---|---|
| **For** | UI / product designer |
| **Companion doc** | [`user-stories.md`](./user-stories.md) (story IDs like `US-2.1` are referenced throughout) |
| **Version** | 1.1 (business-agnostic revision) |
| **Timeline** | Very short (1–2 day build). Favour clear, standard patterns over custom ones. |

---

## 1. What we're designing

Two surfaces for one product:

1. **Customer Assistant**: a chat page where a business's customers talk to an AI assistant by **text or voice**. The assistant answers from the business's documents (with **source chips**), captures contact details, and creates **consultation requests**.
2. **Admin Console**: a small back-office where the business owner uploads documents and reviews **leads**, **consultation requests**, and **conversations** (including what the AI did behind the scenes).

The product is **white-label and industry-neutral**: it serves any small business that takes enquiries (a clinic, a salon, a law firm, a repair service). The customer side must look right with any business name, logo and accent colour. Everything industry-specific comes from the business's own documents and settings, never from the UI itself.

Demo business: **Lakeside Dental Clinic** (fictional). It is **sample data only**. Use it to fill mockups, but don't design anything that only makes sense for a dental or medical business. The test: replace "Lakeside Dental Clinic" with "Northside Plumbing" and the screen should still make sense.

### 1.1 What the assistant can actually do

Design only for these capabilities. They are the assistant's three tools:

| Tool | What the customer sees |
|---|---|
| `search_knowledge` | An answer with source chips |
| `save_lead` | "Details shared" action card |
| `create_consultation_request` | "Request sent, pending" action card |

Don't show features that don't exist, such as insurance checks, prices or staff on a request, editing or cancelling a request, calendar availability, or payments.

---

## 2. Design principles

1. **Trust over cleverness.** Show where answers come from (source chips), show what the AI *did* (action cards), and never make a request look like a confirmed booking.
2. **Calm and fast.** A calm, neutral palette where the business's accent colour does the branding, generous whitespace, and immediate feedback for every action (thinking, searching, saving).
3. **Voice is a mode, not a separate app.** Voice and text share one thread. Switching never loses context.
4. **Always show state.** Every async process has a visible state: idle, loading, success, error. No silent failures.
5. **Accessible by default.** WCAG 2.1 AA, keyboard-first, captions for voice.
6. **Buildable quickly.** The implementation uses **Tailwind CSS** with standard components (shadcn/ui-style: Button, Input, Card, Badge, Table, Dialog, Sheet/Drawer, Toast, Tabs). Please design within that vocabulary. Avoid bespoke components unless they carry the product (the voice orb and the chat message types are the exceptions).

---

## 3. Information architecture

```
Customer side
├── /                      Home: the businesses as cards (local demo, PR-15)
└── /b/[slug]              Chat (text + voice) for one business

Admin side (/admin), scoped to the business picked in the sidebar switcher
├── New business           Create a business (PR-15, US-10.2)
├── Overview               KPIs + recent activity
├── Knowledge base         Upload, document list, document detail (sections)
├── Leads                  Table + lead detail drawer
├── Consultations          Table with status filter + status change
├── Conversations          List + transcript with AI audit trail
└── Settings               Business profile (name, slug, description, timezone, assistant guidelines)
```

Each chat serves exactly one business (decision D-14). In production, customers reach `/b/[slug]` from the business's own website, so the home page is a demo convenience, not a customer flow.

---

## 4. Visual direction

### 4.1 Mood
Clean, warm, modern SaaS, neutral enough for any industry. The accent colour and logo carry the brand; the rest stays greyscale. References: Intercom Messenger (chat clarity), Linear (admin density and restraint), ChatGPT voice mode (a single animated orb as the voice focal point).

### 4.2 Design tokens (proposal; the designer may refine)

**Colour roles.** Please define light **and** dark values.

| Token | Purpose | Light (suggested) |
|---|---|---|
| `--bg` | Page background | `#F7F8FA` |
| `--surface` | Cards, chat panel | `#FFFFFF` |
| `--surface-muted` | Assistant bubble, table header | `#F1F3F6` |
| `--border` | Dividers, inputs | `#E3E6EB` |
| `--text` | Primary text | `#111827` |
| `--text-muted` | Secondary text, timestamps | `#6B7280` |
| `--accent` | **Business brand colour** (white-label, configurable); user bubble, primary buttons, voice orb | `#0F766E` (teal, demo) |
| `--accent-contrast` | Text on accent | `#FFFFFF` |
| `--success` | Saved / confirmed | `#15803D` |
| `--warning` | Pending | `#B45309` |
| `--danger` | Errors, failed | `#B91C1C` |
| `--info` | Tool activity / sources | `#1D4ED8` |

> The accent must pass 4.5:1 contrast with `--accent-contrast`. Please show the chat with 2–3 alternative accent colours to prove the white-label idea.

**Typography:** Inter (or the system UI stack). Scale: 12 / 14 / 16 / 18 / 24 / 30. Chat body at **16 px** (prevents iOS zoom on input focus). Line height 1.5 for body text.

**Spacing:** 4 px base grid (4, 8, 12, 16, 24, 32, 48).

**Radius:** 8 px for inputs and buttons, 16 px for chat bubbles and cards, full radius for chips and the orb.

**Elevation:** very subtle; mostly borders. One shadow level for floating elements (drawer, toast, voice panel).

**Iconography:** Lucide (matches the component library). Key icons: mic, mic-off, phone-off, send, file-text, sparkles (AI), check-circle, calendar, user, alert-triangle, refresh-cw.

---

## 5. Customer Assistant — screens & components

### 5.0 Home page (`/`, US-10.2, PR-15)

A simple launcher that lists every business for the local demo. Nothing on it is industry-specific.

```
┌───────────────────────────────────────────────────────────┐
│ [✦] AI Customer Assistant                      Admin ↗    │  ← product header
├───────────────────────────────────────────────────────────┤
│  Choose a business                                        │
│  Each business has its own assistant, trained only on     │
│  its own documents.                                       │
│                                                           │
│  ┌──────────────────────┐  ┌──────────────────────┐       │
│  │ (LD) Lakeside Dental │  │ (PF) Peak Fitness    │       │
│  │ Family & cosmetic    │  │ Gym, classes and     │       │
│  │ dentistry in …       │  │ personal training …  │       │
│  │ 6 documents          │  │ 4 documents          │       │
│  │          Open chat → │  │          Open chat → │       │
│  └──────────────────────┘  └──────────────────────┘       │
└───────────────────────────────────────────────────────────┘
```

- **Product header:** this is the only page that shows the product's own name rather than a business's. It has a small "Admin ↗" link on the right, which is the demo's way into the admin while there is no login (A1).
- **Business card:** an initials avatar, the business name (16–18 px semibold), its description clamped to 2 lines, a muted meta line ("6 documents"), and an "Open chat →" link. The whole card is clickable and keyboard-focusable. It is a grid of 2–3 columns on desktop and 1 column on mobile.
- **Visual identity:** every business uses the same product accent. The data model has no per-business colour or logo, so the initials avatar is the only thing that tells cards apart.
- **States:**
  - **Loading:** skeleton cards.
  - **Empty:** "No businesses yet. Add one in the admin." in muted text, with no button.
  - **Business without documents:** the card shows "No documents yet" in the muted colour, and opening it still works because the assistant says it has no information.
- **Never on the home page:** an "Add a business" card or button (creating, editing and deleting businesses happens only in the admin, §6.8), marketing hero sections, pricing, sign-up, or industry imagery.

### 5.1 Layout

**Desktop (≥ 1024 px):** a centred chat column, max width ~760 px, full height. A slim header across the top.
**Mobile (360–767 px):** full-screen chat. The header collapses to a single row. The composer is pinned to the bottom and stays above the keyboard.

```
┌───────────────────────────────────────────────┐
│ [logo] Lakeside Dental Clinic   ● Online   ⋯  │  ← header
├───────────────────────────────────────────────┤
│                                               │
│  (assistant) Hi! I'm Lakeside's assistant…    │
│                                               │
│               What does whitening cost? (you) │
│                                               │
│  (assistant) Whitening is $X per session…     │
│  [📄 Pricing › Whitening] [📄 Services]        │  ← source chips
│                                               │
│  ┌─ ✓ Consultation requested ──────────────┐  │  ← action card
│  │ Teeth whitening · Tue, Oct 20 · 3:00 PM │  │
│  │ Status: Pending — Lakeside will confirm  │  │
│  └──────────────────────────────────────────┘  │
├───────────────────────────────────────────────┤
│ [ Type your message…                  ] 🎤 ➤  │  ← composer
│ AI assistant · may make mistakes · Privacy    │  ← footer note
└───────────────────────────────────────────────┘
```

### 5.2 Header
- Business logo (or an initials avatar), business name, an "AI assistant" subtitle.
- Overflow menu (⋯): "New conversation" (US-1.5), "About this assistant / privacy", and "All businesses" (back to the home page; demo only).
- Optional status dot: Online / Reconnecting.
- **One row, about 56–64 px tall. Nothing else.** No navigation tabs (Services, Pricing, About…). The business's own website does that. No link to the Admin Console: customers never see the back office.

### 5.3 Empty / welcome state (US-1.1)
- A welcome message from the assistant introducing the business in one line.
- **3–4 suggested question chips** (tappable). They are **configured per business**. Generic defaults: "What services do you offer?", "What are your hours?", "How much does it cost?", "Request a consultation". The Lakeside demo may swap one for an insurance question, but the layout must not depend on it.
- A subtle hint: "You can also talk to me 🎤".

### 5.4 Message types — **please design every one**

| Type | Description | Stories |
|---|---|---|
| **User message (text)** | Right-aligned bubble, accent background. | US-1.2 |
| **User message (voice)** | Same, plus a small mic icon; the text is the transcript. | US-2.3 |
| **Assistant message** | Left-aligned, muted surface, with an AI avatar. Supports **basic markdown**: paragraphs, bold, bullet lists, short tables (e.g. a price list). | US-1.2, US-3.1 |
| **Assistant message (voice)** | Same, plus a speaker icon; the text is the transcript of the spoken answer. | US-2.3 |
| **Streaming state** | Assistant bubble growing as text arrives, with a soft caret at the end. | US-1.2 |
| **Thinking indicator** | Three-dot or shimmer placeholder before any text arrives. | US-1.2 |
| **Tool status line** | Small inline row under the avatar: spinner + "Searching {business} information…" / "Saving your details…" / "Creating your request…". Replaced by the result once done. | US-1.2 |
| **Source chips** | Row of pill chips under an assistant message: file icon + document title (+ "› section"). Max 3 visible, then "+2 more". | US-3.2 |
| **Source preview** | On chip click: a popover (desktop) or bottom sheet (mobile) with the document title, section heading, and the excerpt text. The relevant passage may be highlighted. | US-3.2 |
| **Action card — Lead saved** | Compact card, success accent: "✓ Details shared with {business}", name + masked contact (s***@example.com). | US-4.1 |
| **Action card — Consultation requested** | Card with **only** service, preferred date & time (in the business timezone, with the timezone label), and a **Pending** badge + the line "{business} will confirm with you". No price, staff, room, reference numbers, or Modify/Cancel buttons (none of these exist). **Must not look like a confirmed booking**: no "Booked!" language, use a warning-coloured *Pending* badge. | US-5.1 |
| **Action card — Failed** | Danger accent: "Couldn't save your request", short reason, and "Try again". | US-11.1 |
| **Message send failed** | The user bubble gets a red outline + "Not sent · Retry". | US-11.6 |
| **System notice** | Centred muted text: "Voice session ended", "New conversation started", "You're offline". | US-2.5, US-11.6 |
| **"I don't know" answer** | A normal assistant bubble. Optionally an inline quick-action button: "Have the team contact me". | US-3.3 |

Also design: timestamps (on hover/tap, or grouped by time), and a "jump to latest" button when the user has scrolled up during streaming.

**Mockups must show a realistic conversation, not a catalogue.** A main screen should show 4–6 messages, as a real customer would see them. Show each remaining message type as its own small component frame or state variant, not stacked into one thread. Completed tool status lines disappear (they're replaced by the result). The source preview is a popover, so it's closed by default.

### 5.5 Composer (US-1.2, US-1.3)
- Auto-growing textarea (1 → 5 lines, then scrolls). Placeholder: "Ask about services, prices, hours…".
- **Mic button** (secondary) + **Send button** (primary, accent). Send is disabled while empty, while streaming, or when over the limit.
- Character counter appears from 1,800 / 2,000; the limit is reached at 2,000 (danger colour).
- Inline error area above the composer for server errors, keeping the user's text.
- Footer microcopy: "AI assistant — answers are based on {business}'s information and may contain mistakes. Don't share sensitive personal details."

### 5.6 Voice mode (US-2.1 – 2.6) — **key component**

Entering voice mode **does not navigate away**. The composer area transforms into a **voice panel** (or a bottom sheet on mobile). The thread stays visible above it, showing live captions as messages.

The voice panel is **compact**: it sits where the composer was, at most about 280 px tall on desktop, and the thread still fills the screen above it. It contains only the orb, the state label, Mute, End and a "Type instead" link. It has no technical readouts (latency, audio quality, connection details) and no state switcher. Show each state as a separate frame.

```
┌───────────────────────────────────────────────┐
│   …thread with live captions above…           │
├───────────────────────────────────────────────┤
│                    ◯  ← animated orb          │
│                 "Listening…"                  │
│                                               │
│          [ 🔇 Mute ]    [ ⏹ End ]            │
└───────────────────────────────────────────────┘
```

**Voice orb:** a circle in the accent colour whose scale and glow react to audio level. Please specify the animation for each state:

| State | Label | Orb behaviour |
|---|---|---|
| Requesting permission | "Allow microphone access to talk" | Static, muted |
| Connecting | "Connecting…" | Slow pulse |
| Listening | "Listening…" | Gentle idle breathing |
| User speaking | "Listening…" | Reacts to the **user's** mic level |
| Thinking / using a tool | "Thinking…" / "Checking {business} info…" | Rotating shimmer |
| Assistant speaking | "Speaking… (talk anytime to interrupt)" | Reacts to the **assistant's** audio level |
| Muted | "Muted" | Greyed, mic-off icon |
| Error / disconnected | "Voice disconnected" + Reconnect | Danger outline, static |

- **Pre-permission explainer** (before the browser prompt): a small dialog: "Talk to the assistant. We use your microphone only while voice mode is on. Audio isn't stored; a text transcript is." [Start talking] [Cancel].
- **Permission denied state** with instructions + "Continue by text".
- Respect `prefers-reduced-motion`: replace orb animations with a static icon + text state.
- The mic button in the composer shows a live indicator (red dot) while a voice session is active.

### 5.7 Customer-side error & edge states (please design each)
- Offline banner ("You're offline. Messages will send when you're back.").
- AI unavailable ("I'm having trouble responding right now. Please try again.") with a Retry button.
- Rate limited ("You're sending messages quickly. Please wait a moment.").
- Unsupported browser for voice (mic button disabled, with a tooltip explaining why).
- Very long answers (scroll behaviour), very long single words or URLs (wrapping).

### 5.8 Never on the customer page
- Navigation tabs, or a link to the Admin Console.
- Compliance or trust claims the product can't back up: "HIPAA", "Verified", "Certified", "Clinical AI", match-percentage scores.
- Industry-specific legal text, such as medical or emergency disclaimers. If a business needs one, it goes in its own documents.
- Dev or demo controls (state simulators, latency, audio quality) and marketing feature cards.
- Request details the system doesn't have (price estimates, assigned staff, reference numbers) and actions it doesn't support (modify, cancel, insurance checks).
- Decorative tints on every element. Use colour only for the accent (user bubbles, primary button, orb) and for status (success, pending, error).

---

## 6. Admin Console — screens & components

### 6.1 Shell
- **Left sidebar** (collapsible to icons at < 1280 px): a **business switcher** at the top (initials avatar + name + chevron). It opens a menu listing every business and a "+ New business" item, and every admin page shows data for the selected business only; nav items **Overview, Knowledge base, Leads, Consultations, Conversations, Settings**; a pending-count badge on Consultations.
- **Top bar:** page title, primary page action on the right (e.g. "Upload documents"), and an "Open chat ↗" link to the customer side.
- A visible **"Demo mode — no login"** label in the sidebar footer (assumption A1).
- Desktop-first (≥ 1024 px). Tablet usable. Mobile: tables become stacked cards (nice to have).

### 6.2 Overview
- KPI cards: **Conversations (7 days)**, **Leads (7 days)**, **Pending consultations**, **Documents ready**.
- "Recent consultation requests" (5 rows) and "Recent leads" (5 rows) with "View all".
- Optional (US-9.3): a "Questions the assistant couldn't answer" list with links. This one is valuable for the demo story.

### 6.3 Knowledge base (US-7.1 – 7.5)
- **Upload dropzone** at the top: "Drag files here or browse — .txt, .md, .pdf (text-based), up to 10 MB."
- **Upload queue**: per-file row with name, size, and progress/status: *Uploading → Processing → Ready (12 sections)*, or *Failed* with a reason and a dismiss button. Also a *Duplicate — already in knowledge base* state.
- **Documents table:** Title · Type badge · Status badge (Processing = info + spinner, Ready = success, Failed = danger) · Sections · Uploaded · row actions (View, Delete).
- **Document detail** (drawer or page): metadata + an ordered list of sections (heading + text preview, expandable).
- **Test search** (Could, US-7.5): an input, then the top matching sections with similarity scores as small bars/percentages.
- **Delete confirmation dialog:** "Delete 'Pricing 2026.pdf'? The assistant will stop using this information." [Cancel] [Delete].
- **Empty state:** illustration + "Upload your first document so the assistant can learn about your business" + a sample list (price list, FAQ, opening hours).

### 6.4 Leads (US-8.1)
- Table: Name · Email · Phone · Interest · Channel icon (💬/🎤) · Captured (relative time; tooltip with the exact time).
- Search by name/email; newest first.
- **Lead detail drawer:** contact info (copy buttons), interest, consultation requests list, "View conversation" link.
- Empty state: "Leads appear here when customers share their details with the assistant."

### 6.5 Consultations (US-8.2, 8.3)
- Status **tabs/segmented filter**: Pending (default, with count) · Confirmed · Cancelled · All.
- Table: Customer · Contact · Service · **Preferred date & time** (business timezone, label shown once in the header) · Status (inline select or badge + menu) · Requested (relative).
- Status change: optimistic update + toast ("Marked as confirmed"); on failure the change reverts and an error toast appears.
- Row click → the same lead drawer, scrolled to the request.

### 6.6 Conversations (US-9.1, 9.2) — **important for the demo**
- **List:** Started · Last activity · Messages · Lead (name or "Anonymous") · Channels (💬 / 🎤 / both).
- **Transcript view** (split view on desktop: list left, transcript right):
  - Same message styles as the customer side, but read-only and denser.
  - **AI audit trail inline:** between messages, collapsible "tool call" rows, e.g.
    `🔧 search_knowledge · "whitening price" · 3 sources · 412 ms ✓`
    `🔧 save_lead · {name, email} · ✓ saved · 88 ms`
    `🔧 create_consultation_request · ✗ validation error: date in the past`
  - Expanding a row shows the arguments and the result as formatted JSON (monospace, copy button).
  - Failed calls use the danger accent so problems are easy to spot.
  - A toggle: "Show AI activity" (on by default).

### 6.7 Settings — Business profile (US-10.1)
- Form for the selected business:
  - **Business name** (required, max 100).
  - **Slug** (lowercase letters, digits and dashes; unique). Shows the chat URL `/b/{slug}` underneath, with a copy button.
  - **Short description** (textarea, max 500, with a counter).
  - **Timezone** (searchable select).
  - **Assistant guidelines** (textarea, monospace optional). These are business-specific rules, e.g. "Never give a diagnosis; for emergencies tell the customer to call 911." Helper text: "Added to the assistant's instructions for this business only."
- Live preview of the chat header with the chosen name (nice to have).
- Save button with loading → success toast; inline field validation errors (e.g. "This slug is already used").
- Changes apply to the next customer message without a redeploy.

### 6.8 New business (US-10.2, PR-15)
- Reached from "+ New business" in the sidebar switcher. It is a page (or a large dialog) with the same fields as Settings. The slug is suggested from the name as you type.
- On create: switch to the new business and land on **Knowledge base** with its empty state ("Upload your first document…"). A toast reads "Business created. Upload its documents so the assistant can answer."
- Errors: duplicate slug, a required field missing. The form keeps what was typed.

---

## 7. Interaction & motion
- Durations: 150 ms (hover/press), 200–250 ms (drawers, popovers), ease-out.
- New messages: a subtle fade/slide-up (4–8 px).
- Streaming text: no per-word animation, just the blinking caret.
- Toasts: bottom-right on desktop, top on mobile; auto-dismiss after 4 s (errors persist until dismissed).
- Everything respects `prefers-reduced-motion`.

---

## 8. Accessibility requirements
- WCAG 2.1 AA contrast for all text, including text on the accent colour and on badges.
- Full keyboard operation: Tab order through header → thread → source chips → composer; Enter to send; Esc closes popovers, drawers and voice mode.
- Visible focus rings (2 px, accent or a neutral high-contrast colour).
- The message list is an `aria-live="polite"` region; tool status lines are announced; voice state changes are announced.
- Voice mode always has captions (the thread) and a text fallback.
- Status is never conveyed by colour alone: badges have text, icons have labels.
- Minimum touch target 44×44 px.

---

## 9. Microcopy guide

**Voice and tone:** friendly, concise, professional. Plain language. No AI hype.

| Situation | Copy |
|---|---|
| Welcome | "Hi! I'm {business}'s assistant. Ask me about services, prices, or hours — or request a consultation." |
| Searching | "Searching {business} information…" |
| Don't know | "I don't have that information. Would you like someone from the team to contact you?" |
| Lead saved | "Your details were shared with {business}." |
| Request created | "Consultation requested — {business} will confirm with you." |
| Tool failed | "I couldn't save that just now. Please try again in a moment." |
| AI down | "I'm having trouble responding right now. Please try again." |
| Mic denied | "Microphone access is blocked. Allow it in your browser settings, or keep chatting by text." |
| Scanned PDF | "This PDF looks scanned — no text could be read. Upload a text-based PDF, .txt or .md file." |
| Duplicate doc | "This document is already in your knowledge base." |

**Words to avoid:** "booked", "confirmed" (for requests), "guaranteed", "diagnosis".

**`{business}`** is the business name from Settings (in the demo, "Lakeside Dental Clinic"). Write every customer-facing string with the placeholder, never a hard-coded name or industry word.

---

## 10. Deliverables requested from design

**Priority 1 — needed first (blocks the build)**
1. Design tokens (colour roles light/dark, type scale, spacing, radius).
2. Customer chat, desktop + mobile: empty state, active conversation with **every message type** from §5.4, composer states.
3. Voice mode: all states from §5.6 (a static frame per state + an animation note for the orb).
4. Source preview popover / bottom sheet.

**Priority 2**
5. Admin shell + Knowledge base (dropzone, upload queue states, table, delete dialog, empty state).
6. Leads table + lead drawer; Consultations table with status change.
7. Conversations transcript with the AI audit trail.

**Priority 2b (PR-15)**
8. Home page (§5.0): desktop + mobile, with loading and empty states.
9. Admin business switcher, New business (§6.8) and Settings (§6.7).

**Priority 3**
10. Overview dashboard, error/edge states from §5.7, white-label accent variants.

**Format:** Figma, with components using auto-layout and variants for states (e.g. `Message / type=assistant, channel=voice, state=streaming`). Please annotate spacing and the token used per element.

---

## 11. Out of scope for design (this version)
- Admin login / user management screens.
- Tenant sign-up, per-business admin access, and per-business colours or logos (not in the data model; see D-14).
- Calendar or availability pickers (dates come from conversation).
- Embeddable widget launcher bubble for third-party sites (possible future: same chat in a 400×640 floating panel).
- Payments, multi-language.
