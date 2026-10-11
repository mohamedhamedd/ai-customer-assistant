# AI Customer Assistant — UI Design Brief

| | |
|---|---|
| **For** | UI / product designer |
| **Companion doc** | [`user-stories.md`](./user-stories.md) (story IDs like `US-2.1` are referenced throughout) |
| **Version** | 1.0 (draft for planning) |
| **Timeline** | Very short (1–2 day build). Favour clear, standard patterns over custom ones. |

---

## 1. What we're designing

Two surfaces for one product:

1. **Customer Assistant**: a chat page where a business's customers talk to an AI assistant by **text or voice**. The assistant answers from the business's documents (with **source chips**), captures contact details, and creates **consultation requests**.
2. **Admin Console**: a small back-office where the business owner uploads documents and reviews **leads**, **consultation requests**, and **conversations** (including what the AI did behind the scenes).

Demo business: **Lakeside Dental Clinic** (fictional). The product itself is **white-label**: the customer side must look good with any business name and accent colour.

---

## 2. Design principles

1. **Trust over cleverness.** Show where answers come from (source chips), show what the AI *did* (action cards), and never make a request look like a confirmed booking.
2. **Calm and fast.** A healthcare-style calm palette, generous whitespace, and immediate feedback for every action (thinking, searching, saving).
3. **Voice is a mode, not a separate app.** Voice and text share one thread. Switching never loses context.
4. **Always show state.** Every async process has a visible state: idle, loading, success, error. No silent failures.
5. **Accessible by default.** WCAG 2.1 AA, keyboard-first, captions for voice.
6. **Buildable quickly.** The implementation uses **Tailwind CSS** with standard components (shadcn/ui-style: Button, Input, Card, Badge, Table, Dialog, Sheet/Drawer, Toast, Tabs). Please design within that vocabulary. Avoid bespoke components unless they carry the product (the voice orb and the chat message types are the exceptions).

---

## 3. Information architecture

```
Customer side
└── /                      Chat (text + voice) for the business

Admin side (/admin)
├── Overview               KPIs + recent activity
├── Knowledge base         Upload, document list, document detail (sections)
├── Leads                  Table + lead detail drawer
├── Consultations          Table with status filter + status change
├── Conversations          List + transcript with AI audit trail
└── Settings               Business profile (name, description, timezone)
```

---

## 4. Visual direction

### 4.1 Mood
Clean, clinical-but-warm, modern SaaS. References: Intercom Messenger (chat clarity), Linear (admin density and restraint), ChatGPT voice mode (a single animated orb as the voice focal point).

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
│  │ Status: Pending — the clinic will confirm│  │
│  └──────────────────────────────────────────┘  │
├───────────────────────────────────────────────┤
│ [ Type your message…                  ] 🎤 ➤  │  ← composer
│ AI assistant · may make mistakes · Privacy    │  ← footer note
└───────────────────────────────────────────────┘
```

### 5.2 Header
- Business logo (or an initials avatar), business name, an "AI assistant" subtitle.
- Overflow menu (⋯): "New conversation" (US-1.5), "About this assistant / privacy".
- Optional status dot: Online / Reconnecting.

### 5.3 Empty / welcome state (US-1.1)
- A welcome message from the assistant introducing the business in one line.
- **3–4 suggested question chips** (tappable): "What services do you offer?", "What are your hours?", "Do you accept insurance?", "Book a consultation".
- A subtle hint: "You can also talk to me 🎤".

### 5.4 Message types — **please design every one**

| Type | Description | Stories |
|---|---|---|
| **User message (text)** | Right-aligned bubble, accent background. | US-1.2 |
| **User message (voice)** | Same, plus a small mic icon; the text is the transcript. | US-2.3 |
| **Assistant message** | Left-aligned, muted surface, with an AI avatar. Supports **basic markdown**: paragraphs, bold, bullet lists, short tables (price lists!). | US-1.2, US-3.1 |
| **Assistant message (voice)** | Same, plus a speaker icon; the text is the transcript of the spoken answer. | US-2.3 |
| **Streaming state** | Assistant bubble growing as text arrives, with a soft caret at the end. | US-1.2 |
| **Thinking indicator** | Three-dot or shimmer placeholder before any text arrives. | US-1.2 |
| **Tool status line** | Small inline row under the avatar: spinner + "Searching clinic information…" / "Saving your details…" / "Creating your request…". Replaced by the result once done. | US-1.2 |
| **Source chips** | Row of pill chips under an assistant message: file icon + document title (+ "› section"). Max 3 visible, then "+2 more". | US-3.2 |
| **Source preview** | On chip click: a popover (desktop) or bottom sheet (mobile) with the document title, section heading, and the excerpt text. The relevant passage may be highlighted. | US-3.2 |
| **Action card — Lead saved** | Compact card, success accent: "✓ Details shared with Lakeside Dental Clinic", name + masked contact (s***@example.com). | US-4.1 |
| **Action card — Consultation requested** | Card with service, date & time (in the business timezone, with the timezone label), and a **Pending** badge + the line "The clinic will confirm with you". **Must not look like a confirmed booking**: no "Booked!" language, use a warning-coloured *Pending* badge. | US-5.1 |
| **Action card — Failed** | Danger accent: "Couldn't save your request", short reason, and "Try again". | US-11.1 |
| **Message send failed** | The user bubble gets a red outline + "Not sent · Retry". | US-11.6 |
| **System notice** | Centred muted text: "Voice session ended", "New conversation started", "You're offline". | US-2.5, US-11.6 |
| **"I don't know" answer** | A normal assistant bubble. Optionally an inline quick-action button: "Have the team contact me". | US-3.3 |

Also design: timestamps (on hover/tap, or grouped by time), and a "jump to latest" button when the user has scrolled up during streaming.

### 5.5 Composer (US-1.2, US-1.3)
- Auto-growing textarea (1 → 5 lines, then scrolls). Placeholder: "Ask about services, prices, hours…".
- **Mic button** (secondary) + **Send button** (primary, accent). Send is disabled while empty, while streaming, or when over the limit.
- Character counter appears from 1,800 / 2,000; the limit is reached at 2,000 (danger colour).
- Inline error area above the composer for server errors, keeping the user's text.
- Footer microcopy: "AI assistant — answers are based on Lakeside's information. Don't share sensitive medical details."

### 5.6 Voice mode (US-2.1 – 2.6) — **key component**

Entering voice mode **does not navigate away**. The composer area transforms into a **voice panel** (or a bottom sheet on mobile). The thread stays visible above it, showing live captions as messages.

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
| Thinking / using a tool | "Thinking…" / "Checking clinic info…" | Rotating shimmer |
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

---

## 6. Admin Console — screens & components

### 6.1 Shell
- **Left sidebar** (collapsible to icons at < 1280 px): business name at the top; nav items **Overview, Knowledge base, Leads, Consultations, Conversations, Settings**; a pending-count badge on Consultations.
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
- Form: Business name, short description (textarea with a counter), timezone (searchable select), accent colour (Could: a colour picker with a contrast warning), logo (Could).
- Live preview of the chat header with the chosen name and accent (nice to have).
- Save button with loading → success toast; inline field validation errors.

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
| Welcome | "Hi! I'm Lakeside Dental's assistant. Ask me about services, prices, or hours — or request a consultation." |
| Searching | "Searching clinic information…" |
| Don't know | "I don't have that information. Would you like someone from the team to contact you?" |
| Lead saved | "Your details were shared with Lakeside Dental Clinic." |
| Request created | "Consultation requested — the clinic will confirm with you." |
| Tool failed | "I couldn't save that just now. Please try again in a moment." |
| AI down | "I'm having trouble responding right now. Please try again." |
| Mic denied | "Microphone access is blocked. Allow it in your browser settings, or keep chatting by text." |
| Scanned PDF | "This PDF looks scanned — no text could be read. Upload a text-based PDF, .txt or .md file." |
| Duplicate doc | "This document is already in your knowledge base." |

**Words to avoid:** "booked", "confirmed" (for requests), "guaranteed", "diagnosis".

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

**Priority 3**
8. Overview dashboard, Settings, error/edge states from §5.7, white-label accent variants.

**Format:** Figma, with components using auto-layout and variants for states (e.g. `Message / type=assistant, channel=voice, state=streaming`). Please annotate spacing and the token used per element.

---

## 11. Out of scope for design (this version)
- Admin login / user management screens.
- Calendar or availability pickers (dates come from conversation).
- Embeddable widget launcher bubble for third-party sites (possible future: same chat in a 400×640 floating panel).
- Payments, multi-language.
