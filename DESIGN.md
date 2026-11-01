# Internship Tracker — Design System

A personal, single-user internship tracker that runs locally on a Mac (127.0.0.1:8765).
It should feel like a native macOS app — Mail, Reminders, System Settings — not a web dashboard.

## 1. Context

| | |
|---|---|
| User | One person (the owner), daily during recruiting season |
| Core jobs | Decide what to apply to today in under a minute · keep the pipeline current · prepare tailored resumes |
| Surfaces | Dashboard, Applications (board + list), New listings, Documents, Profile, Settings, ⌘K palette |
| Platform | Desktop-first, keyboard-first, light + dark. Phone layout is a fallback, not a target |
| Tone | Quiet, precise, native. Information over decoration |
| Avoid | Marketing-page patterns (hero numbers, big cards, pill badges everywhere), gradients, decorative color, ALL-filled buttons, emoji, sparkle/"AI" imagery |

## 2. Current system (as of 2026-11-01, before the redesign)

Captured from `base.css` + `apple.css` so the changes below are measurable.

- **Two style layers.** `base.css` (773 lines) is the original; `apple.css` (397 lines) restyles on top. Tokens live only in `apple.css`.
- **Type.** System font stack. 20+ distinct sizes in use (11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 16, 18, 20, 22, 28…). Body 14px. Half-pixel sizes dominate in `base.css` (12.5px ×36, 11.5px ×12).
- **Color.** Accent `#0064D2` in both light and dark (dark does not switch to `#0A84FF`). Score rings green/orange/grey by band; most visible scores are ≥ 75 so nearly all rings are green. Status colors per stage (grey/blue/indigo/purple/green).
- **Radii.** 2, 3, 4, 6, 8, 12, 14, 18, 22 and 999 (capsule). Cards 18–22px.
- **Elevation.** Soft shadows on every card in light mode; flat in dark.
- **Buttons.** Capsule. Filled blue primary used per row (Apply / Prepare / Save), so a dashboard shows 6+ filled buttons at once.
- **Selection.** Sidebar uses `--fill` grey; base layer uses an accent-soft fill; focus ring is a 4px accent halo.
- **Badges.** Capsule badges for Saved, Analyzed, Tailored resume, Letter, Instant, Next refresh, Within 5 min…
- **Logo.** Blue square with a check mark (favicon only). Replaced by the Waypoint mark (§9).

## 3. Type

Font stack (UI): `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`, followed by `"PingFang TC", "Hiragino Sans"` for CJK names. Numbers use `font-variant-numeric: tabular-nums`. Code / keycaps: `ui-monospace, "SF Mono", Menlo, monospace`.

Seven sizes only. No half pixels.

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `--t-caption2` | 11 / 13 | 500 | Keycaps, section headers in lists (uppercase off), tiny counts |
| `--t-caption` | 12 / 16 | 400 | Secondary metadata, footers, hints |
| `--t-body` | 13 / 18 | 400 · 590 emphasis | Default UI text, rows, controls (macOS body size) |
| `--t-callout` | 15 / 20 | 590 | Row titles that lead a list, drawer field labels |
| `--t-title3` | 17 / 22 | 600 | Panel / section titles |
| `--t-title2` | 22 / 28 | 700 | Drawer and dialog titles, palette input is 17 |
| `--t-title1` | 28 / 34 | 700 | Page title (one per view) |

Hierarchy comes from weight and color (label → secondaryLabel → tertiaryLabel), not from size jumps or boxes. Letter-spacing: −0.022em at 28, −0.016em at 17–22, default below.

## 4. Color

Semantic tokens only; components never use raw hex.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--label` | `#1D1D1F` | `#F5F5F7` | Primary text |
| `--secondary-label` | `rgba(60,60,67,.72)` | `rgba(235,235,245,.68)` | Metadata |
| `--tertiary-label` | `rgba(60,60,67,.52)` | `rgba(235,235,245,.42)` | Hints, placeholders, disabled (≥ 4.5:1 checked on `--background` where it carries meaning; decorative only otherwise) |
| `--separator` | `rgba(60,60,67,.14)` | `rgba(84,84,88,.6)` | Hairlines (0.5px on 2× screens) |
| `--fill` | `rgba(120,120,128,.12)` | `rgba(118,118,128,.24)` | Control backgrounds, hover |
| `--fill-secondary` | `rgba(120,120,128,.08)` | `rgba(118,118,128,.16)` | Quiet wells |
| `--background` | `#FFFFFF` | `#1E1E1E` | Content area |
| `--grouped-background` | `#F2F2F7` | `#000000` | Behind inset grouped rows (Settings, Profile) |
| `--sidebar` | material `rgba(246,246,248,.8)` + blur | `rgba(40,40,42,.7)` + blur | Source list |
| `--accent` | `#007AFF` | `#0A84FF` | Primary button, selection tint, links, focus |
| `--accent-text` | `#0062C4` | `#64B5FF` | Accent used as text on white/black (AA) |
| `--selection` | accent @ 12% | accent @ 22% | Selected row / sidebar item fill |

**Status colors carry meaning only.** `--red` (`#FF3B30` / `#FF453A`) = overdue, blocked, error. `--orange` (`#FF9500` / `#FF9F0A`) = due soon, needs action. `--green` (`#34C759` / `#30D158`) = offer, success. Stage dots: neutral grey for Saved/Closed; accent for Applied; one shared indigo for OA/Interview; green for Offer. No other decorative color.

**Scores.** The number is the information; a colored ring is not. Default: the score as tabular text in `--label` with a thin neutral track. Only the top band (≥ 85, or top-N of today's queue) gets the accent; blocked/not eligible shows "—" with a red dot. This keeps color rare enough to mean something.

## 5. Space, shape, depth

- **Grid:** 4/8. Tokens `--s1:4 --s2:8 --s3:12 --s4:16 --s5:24 --s6:32 --s7:48`. Row padding 8×12, panel padding 16–24, page gutter 24 (32 at ≥ 1280px).
- **Radii:** `--r-sm:6` (controls, badges, keycaps, selection fill), `--r-md:10` (rows, menus, inputs, cards), `--r-lg:14` (panels, dialogs, palette). Capsules only for the segmented control and the search field.
- **Lines over boxes:** lists are rows separated by hairlines inside one grouped container, not a card per item. Light-mode shadow only on floating layers (menus, popovers, palette, drawer).
- **Density:** row height 36–44px; list rows never wrap metadata to 2 lines — truncate with a tooltip, or move detail to the preview pane.

## 6. Components

**Buttons.** Exactly one filled primary per view (e.g. "Add application" or the drawer's main action). Row-level actions are **plain** (text in `--accent-text`) or **tinted** (accent @ 12% fill, accent text) — never filled. Destructive: plain red text, confirmation in a dialog. Sizes: regular 28px tall, small 22px. Radius `--r-sm`.

**Badges.** At most one status badge per row, and only when it changes what you do (Overdue, Closing soon, Not eligible). Informational states (Saved, Analyzed, Tailored, Letter) become small line icons with tooltips, or move into the preview pane. Timing hints ("Next refresh", "Within 5 min") go to the footer/status area, not rows.

**Metadata lines.** Max two facts joined by " · ". The rest goes in a second column (aligned, tabular) or the preview pane.

**Sidebar (source list).** Translucent material. Item 28px tall, radius 6, icon 16px in `--accent`. **Selected = `--selection` tinted fill + label weight 590 — no outline ring.** Counts right-aligned in `--secondary-label`. Footer shows save state in `--caption`, never truncated (short text: "Saved" + time; full path in tooltip).

**Inset grouped rows (Settings, Profile).** System Settings pattern: groups on `--grouped-background`, rows on `--background` with radius 10 per group, hairline separators inset 12px, label left, compact control right (stepper / 80px numeric field / switch / pop-up). No full-width numeric inputs.

**Board (Applications).** Columns shrink to content when empty (a header and a quiet "None" line, not a "Drop a card here" box); horizontal scroll with all columns reachable; cards carry no full-width buttons — actions on hover or in the context menu.

**Navigation.** Top-level pages have no back crumb. Crumbs appear only inside nested views (a job page opened from New listings).

**Palette (⌘K).** 640px, 15vh from top, radius 14, `backdrop-filter: blur(30px) saturate(180%)`, hairline border, layered shadow, overlay `rgba(0,0,0,.15)`. Input 52px / 17px. Rows 36–44px, active row = `--selection` fill (no saturated bar). Full spec in the redesign plan, Phase 3.

**Focus.** `:focus-visible` only: 3px ring `accent @ 50%` offset 1px, following the element radius. Mouse clicks show no ring.

## 7. Motion

150–250ms, `cubic-bezier(.2,.8,.2,1)` (ease-out). Opacity and transform only — no animating width/height/color for layout. Enter 160–200ms, exit 120ms. `prefers-reduced-motion: reduce` → opacity only, ≤ 100ms. No looping animation, no "press squish".

## 8. Dark mode

Every token has a dark value (§4). Dark uses lighter separators instead of shadows, the brighter accent `#0A84FF`, and `--background #1E1E1E` with the sidebar material darker than content. Checked at WCAG AA for text and 3:1 for meaningful UI (focus, selection, status dots).

## 9. Logo — "Waypoint"

`icon.svg` (≥ 24px) and `favicon.svg` (16–32px). A macOS squircle (radius 22.3% of size) in system blue with a white path through three stops — Saved → Applied → Interview — rising to a target ring: the offer. The dip after the second stop is deliberate: progress is real but not a straight line. Flat color, no gradient, white at 60% for the path so the stops read first.

- Use the full mark in the sidebar (28px) and as the touch icon; the simplified mark for favicons and the 16/32px extension icons.
- Keep clear space of 1/8 of the size. Never recolor the stops, add a gradient, or put text inside.
- The mark is the only place the brand blue appears as a large fill.
