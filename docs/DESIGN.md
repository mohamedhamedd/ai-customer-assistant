# Design System — AI Customer Assistant

Source of truth for visual tokens. Companion to [`ui-design-brief.md`](./ui-design-brief.md). Implemented with Tailwind CSS v4 and shadcn/ui-style components.

## Brand & Style

A white-label assistant that any small business can put its name on: a clinic, a salon, a law firm or a repair service. The UI is **neutral and quiet**. Greyscale surfaces do the structure, and a single **business accent colour** carries the brand. Nothing in the UI refers to an industry.

- **Character:** calm, plain-spoken, trustworthy. Closer to Intercom Messenger and Linear than to a medical portal.
- **Restraint:** colour only means something. The accent is for the user's own messages, the primary action and the voice orb. Green, amber and red are for status. Everything else is white, grey or near-black text.
- **No decoration:** no gradients on surfaces, no glass, no tinted backgrounds behind every element, and no badges that only decorate.

## Colors

The accent is configurable per business. Teal is the demo value. All text must meet WCAG 2.1 AA (4.5:1).

| Role | Light | Dark | Use |
|---|---|---|---|
| bg | `#F7F8FA` | `#0B0D10` | Page background |
| surface | `#FFFFFF` | `#14171C` | Chat column, cards, composer, panels |
| surface-muted | `#F1F3F6` | `#1C2027` | Assistant bubble, table header, chip background |
| border | `#E3E6EB` | `#2A2F37` | Dividers, card and input outlines |
| text | `#111827` | `#F3F4F6` | Primary text |
| text-muted | `#6B7280` | `#9CA3AF` | Timestamps, captions, helper text |
| accent | `#0F766E` | `#2DD4BF` | User bubble, primary button, orb, focus ring |
| accent-contrast | `#FFFFFF` | `#042F2E` | Text and icons on accent |
| success | `#15803D` | `#4ADE80` | Saved, done |
| warning | `#B45309` | `#FBBF24` | Pending |
| danger | `#B91C1C` | `#F87171` | Error, failed, end call |
| info | `#1D4ED8` | `#60A5FA` | Tool activity, source chip icon |

Status colours appear as text or icon colour on a pale tint (about 10% opacity) of the same hue, and always with a text label.

Alternative demo accents for white-label previews: indigo `#4338CA`, rose `#BE123C`, amber-brown `#92400E`.

## Typography

- **Font:** Inter, falling back to the system UI stack.
- **Scale:** 12 / 14 / 16 / 18 / 24 / 30 px.
- **Chat message text:** 16 px, line height 1.5, regular 400.
- **Metadata** (timestamps, chip labels, captions): 12–14 px, text-muted. Nothing smaller than 12 px.
- **Headings:** semibold 600. The business name in the header is 16 px semibold.
- **Body text is never all caps.** Small uppercase labels are allowed only for table headers.

## Layout & Spacing

- **Grid:** 4 px base. Steps: 4, 8, 12, 16, 24, 32, 48.
- **Customer chat:** one centred column, max width 760 px, full height. A slim 60 px header, a scrolling thread, and the composer pinned to the bottom. No sidebars and no nav tabs.
- **Thread rhythm:** 8 px between consecutive messages from the same sender, 24 px when the speaker changes.
- **Admin:** a 240 px left sidebar (collapsing to icons below 1280 px), a 56 px top bar, and a fluid content area with 24–32 px padding.
- **Mobile (< 768 px):** full-width chat with 16 px gutters. The composer stays above the keyboard.

## Elevation & Depth

Mostly flat. Hierarchy comes from borders and surface contrast.

- **Level 0:** bg, no border.
- **Level 1:** surface with a 1 px border. Used for cards, the composer and the voice panel.
- **Level 2:** only for floating elements (popover, drawer, toast, dropdown): `0 8px 24px -6px rgba(17,24,39,0.12)`.

## Shapes

- Inputs and buttons: 8 px radius.
- Chat bubbles and cards: 16 px radius. The user bubble has a 4 px bottom-right corner; the assistant bubble has a 4 px bottom-left corner.
- Chips, badges, avatars and the voice orb: fully round.
- Minimum touch target: 44 × 44 px.

## Components

- **Header:** an initials avatar or logo, the business name, and an "AI assistant" subtitle in text-muted, plus a small green "Online" dot and a ⋯ overflow menu. Nothing else.
- **User bubble:** right-aligned, accent background, accent-contrast text. A voice message adds a small mic icon before the text.
- **Assistant bubble:** left-aligned, surface-muted background, a 28 px round avatar with a sparkles icon, and markdown content (paragraphs, bold, lists, small tables). A voice message adds a small speaker icon.
- **Source chips:** under the assistant bubble. Each is a pill with a surface-muted background, a 1 px border, a file-text icon in info colour and the label "Document › Section" at 13 px. Up to 3 chips are shown, then "+N more". Clicking one opens a popover.
- **Tool status line:** a 14 px text-muted row with a small spinner, for example "Searching {business} information…". It is replaced by the result when done.
- **Action card (lead saved):** a compact surface card with a 1 px border and a success check-circle icon. It reads "Details shared with {business}" and shows the name and masked email.
- **Action card (consultation requested):** a surface card with a calendar icon, the service, and the preferred date and time with a timezone label. It has an amber "Pending" badge and the line "{business} will confirm with you". It has no buttons.
- **Action card (failed):** a pale danger tint, an alert-triangle icon, a one-line reason and a "Try again" button.
- **Composer:** a surface card with a 1 px border and 16 px radius, containing an auto-growing textarea (16 px). It has a ghost mic button and a round accent send button. Below it, a 12 px text-muted disclaimer line.
- **Voice panel:** replaces the composer and is at most about 280 px tall. It holds an 88 px accent orb with a soft glow, a state label below ("Listening…" or "Speaking…"), and two buttons: Mute (secondary) and End (danger outline). A "Type instead" text link sits underneath.
- **Business card (home page):**
  - A surface card with a 1 px border, 16 px radius and 24 px padding. On hover it shows a Level 2 shadow and the border darkens slightly.
  - Inside: a 44 px round initials avatar in the accent colour, the business name in 18 px semibold, and a 14 px text-muted description clamped to 2 lines.
  - At the bottom: a 12 px text-muted meta line ("6 documents") on the left and an accent "Open chat →" link on the right.
- **Business switcher (admin):** a full-width button with a 28 px avatar, the name in 14 px semibold and a chevron. Long names truncate with an ellipsis, and the full name shows in a tooltip and in the open menu, where names wrap instead of truncating.
- **Buttons:** primary (accent fill), secondary (surface with border), ghost and danger, all 8 px radius and 40 px tall (44 px on touch).
- **Badges:** a pill with a status tint and status-colour text, 12 px medium weight.

## Reference screens

Generated in Stitch (project "File Review Assistant", `680365958594726836`) from this file, using the "AI Customer Assistant" design system:

| Screen | Image |
|---|---|
| Customer Assistant — Chat | [`design/customer-chat.png`](./design/customer-chat.png) |
| Home — business launcher (`/`) | [`design/home.png`](./design/home.png) |
| Customer Assistant — Voice mode (speaking) | [`design/customer-voice.png`](./design/customer-voice.png) |
| Customer Assistant — Source preview popover | [`design/customer-source-preview.png`](./design/customer-source-preview.png) |
| Chat — message types & edge states | [`design/customer-states.png`](./design/customer-states.png) |
| Voice — permission explainer dialog | [`design/voice-permission.png`](./design/voice-permission.png) |
| Voice panel — all states | [`design/voice-states.png`](./design/voice-states.png) |
| Home — loading & empty | [`design/home-states.png`](./design/home-states.png) |
| Mobile — Home | [`design/mobile-home.png`](./design/mobile-home.png) |
| Mobile — Welcome (suggested questions) | [`design/mobile-welcome.png`](./design/mobile-welcome.png) |
| Mobile — Chat | [`design/mobile-chat.png`](./design/mobile-chat.png) |
| Mobile — Source preview (bottom sheet) | [`design/mobile-source-preview.png`](./design/mobile-source-preview.png) |
| Mobile — Voice mode (listening) | [`design/mobile-voice.png`](./design/mobile-voice.png) |
| Admin — New business | [`design/admin-new-business.png`](./design/admin-new-business.png) |
| Admin — Settings (saved) | [`design/admin-settings.png`](./design/admin-settings.png) |
| Admin — Overview (business switcher open) | [`design/admin-overview.png`](./design/admin-overview.png) |
| Admin — Knowledge base (upload states) | [`design/admin-knowledge-base.png`](./design/admin-knowledge-base.png) |
| Admin — Leads (detail drawer open) | [`design/admin-leads.png`](./design/admin-leads.png) |
| Admin — Consultations (status menu open) | [`design/admin-consultations.png`](./design/admin-consultations.png) |
| Admin — Conversations (AI audit trail) | [`design/admin-conversations.png`](./design/admin-conversations.png) |
| Admin — Knowledge base (new business, empty) | [`design/admin-knowledge-base-empty.png`](./design/admin-knowledge-base-empty.png) |
| Admin — Delete document dialog | [`design/admin-delete-document.png`](./design/admin-delete-document.png) |
| Admin — empty states | [`design/admin-empty-states.png`](./design/admin-empty-states.png) |

Every screen and state in the brief (§10) now has a reference frame.

Build notes, where the reference images differ from this spec (follow the spec):
- States board: the "1,962 / 2,000" counter renders red. It should be warning amber; only "2,000 / 2,000" is red.
- Settings: the "Chat header preview" label is uppercase, the slug uses a monospace font, and the preview card truncates the business name. In the build, use a sentence-case label, Inter for every input, and a 320 px preview card where the name wraps.
