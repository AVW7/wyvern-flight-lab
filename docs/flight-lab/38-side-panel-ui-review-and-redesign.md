# 38 — Side panel UI review and redesign proposal

Date: 2026-10-21
Scope: Flight Lab docked side panels — left specimen sidebar, right controls deck, the shared dock/toggle system, and their responsive behavior.
Method: source review of `src/app/flight-lab/`, WCAG 2.1 contrast measurement of every panel text/background pair in both themes, and inspection of the 2026-10-21 panel-dock evidence screenshots.

> **Implemented 2026-10-21 (same day).** All P1/P2/P3 panel items below are now in code.
> See the [Implementation addendum](#implementation-addendum-2026-10-21) at the end for what
> shipped, the two deviations from this proposal, and the verification evidence.

## 1. Verdict

The dock system itself is sound: pinned grid columns that never shift the stage, persisted panel visibility, a clean collapse-to-drawer transition at 1050px, and a toggle that parks at the dock edge. The problems are all in the panel *interiors* and the *states* they can reach:

1. **Ten of twenty measured text/background pairs fail WCAG AA** in the panels, in both themes. The worst (`#525252` roster index on `#0c0c0c`, 2.50:1) is effectively invisible.
2. **Selected vs. hover states are 0.106 luminance steps apart** — the single most important state distinction in the roster is nearly imperceptible.
3. **The mobile drawer opens over the stage by default**, because persisted desktop "open" state is applied at phone widths where "open" means a 330px curtain over the only content that matters.
4. **Closed drawers remain in the tab order** (off-canvas `transform` only) — keyboard users tab into invisible panels.
5. **Typography and spacing have no scale**: six font sizes from 8px to 17px across three font families, and a dozen one-off spacing values (4, 6, 7, 8, 9, 12, 17, 22, 25px…).
6. **Dead UI ships**: the "Egg archive" divider can never render (the catalogue has zero eggs), and the "STATIC MESH" badge flashes during every specimen load because clip details are cleared before the swap.

None of this requires new features. It is a token, semantics, and state pass.

## 2. Current state inventory

### 2.1 Layout architecture

| Piece | Implementation | Notes |
| --- | --- | --- |
| Dock grid | `.lab` CSS grid, `clamp(212px,15vw,246px) minmax(0,1fr) clamp(312px,23vw,352px)` (`FlightLabClient.module.css:168-183`) | Panels pinned to columns 1/3, stage to column 2; a hidden panel never shifts the stage. Good. |
| Desktop collapse | `@media (min-width: 1051px)`: collapsed panel `display: none`, column width `0px` (`:3106-3112`) | Clean. Removes content from the a11y tree too. |
| Tablet/phone drawers | `@media (max-width: 1050px)`: panels become `position: absolute` overlays, off-canvas via `transform: translateX(±102%)` (`:3114-3146`) | Works visually, but see §3.1 — transform alone leaves closed drawers focusable. |
| Phone tighten | `@media (max-width: 720px)`: drawer `min(340px, 88vw)`, chrome insets (`:3148-3163`) | Fine. |
| Toggle | `PanelToggle.tsx` — 22×48px arrow, `aria-expanded`, docks at panel inner edge or screen edge | Good semantics, small touch target (§3.5). |
| Panel state | `FlightLabClient.tsx:86-90, 196-217` — `leftPanelOpen`/`rightPanelOpen` persisted to `localStorage["flight-lab-panels"]` | Persistence is right; the default application is wrong (§3.2). |

### 2.2 Left panel anatomy (`SpecimenSidebar.tsx`, 118 lines)

- Section label "Flight specimens" (`:30`)
- Search box: `type="search"` input + conditional custom clear button (`:32-51`)
- Roster: `specimens.map` → wrapper `div.specimenEntry` → `button.specimen` with index/name/class (`:56-75`); group divider rendered when `item.kind !== specimens[index-1].kind`, hardcoded label "Egg archive" (`:58-60`)
- Selected-specimen card: header + clips badge, name, description, meta grid (model / target scale / triangles / vertices / dimensions) (`:77-115`)

### 2.3 Right panel anatomy (`FlightControls.tsx`, 592 lines)

Sticky deck tab bar (All / Actions / Clips / Camera, `:134-167`), timeline scrubber, quick actions, flight-mode grid, one-shot combat grid, camera presets (persp/ortho sub-tabs), zoom/framing row, clip browser, log console. Well-organized vertically; the issues here are consistency and ARIA completeness (§3.7).

### 2.4 State handling map

| State | Owner | Issue |
| --- | --- | --- |
| `leftPanelOpen` / `rightPanelOpen` | Client, persisted | Defaults applied at all widths (§3.2) |
| `navOpen` | Client | Escape + outside-pointer close — the pattern the drawers lack |
| `searchQuery` / `filteredSpecimens` | Client (`:119-146`) | No result count, no live announcement |
| `specimenId` → `metrics`, `clipDetails`, `clips` | Client `selectSpecimen` (`:237-256`) | All cleared on switch → panel content collapses then re-grows (§3.4) |
| `clipDetailsCount` badge | Sidebar prop | Flips to "STATIC MESH" during every load (§3.4) |
| `deckView`, `cameraSubTab` | FlightControls | `cameraSubTab` desyncs from `cameraPreset` after mount (§3.7) |
| `activeOneShotName` | FlightControls | 1800ms `setTimeout` never cleared on unmount (§3.7) |

## 3. Issue register

Severity: **P1** = fix before any further panel work; **P2** = fix in the same pass; **P3** = polish.

### 3.1 P1 — Closed drawers stay in the tab order

`@media (max-width: 1050px)` hides drawers with `transform: translateX(±102%)` only (`FlightLabClient.module.css:3131-3142`). Transformed-off-screen content is still rendered, still in the accessibility tree, and still focusable. A keyboard user at 900px width tabs: stage controls → **invisible left drawer** → **invisible right drawer** → page end, with no visual focus indicator. The desktop path gets this right (`display: none`); the drawer path does not.

Fix: on closed drawers add `visibility: hidden` with the visibility transition delayed so the slide-out still animates (`transition: transform .28s cubic-bezier(0.16,1,0.3,1), visibility .28s;`), or set the `inert` attribute on the closed panel from React. Also add: Escape closes the topmost open drawer, and a click on the stage scrim closes it. The header nav already implements exactly this pattern (`FlightLabClient.tsx:219-235`) — reuse it.

### 3.2 P1 — Mobile first paint is a curtain

`leftPanelOpen`/`rightPanelOpen` default to `true` and are restored from `localStorage` unconditionally (`:86-87, 196-206`). A user who last used the lab on desktop and opens it on a phone gets **both 330px drawers overlaying the stage** on first paint — the wyvern is invisible until they close both. Same on tablet.

Fix: default to media-aware state. On mount, if `window.matchMedia("(max-width: 1050px)").matches` and there is no persisted preference, start both collapsed. Persisted values still win for returning users. Additionally, at ≤1050px, **selecting a specimen closes the left drawer** (master→detail flow: pick, then look at the stage) and Escape/scrim closes either drawer.

### 3.3 P1 — Contrast failures (measured, not estimated)

Computed with the WCAG 2.1 relative-luminance formula over composited backgrounds (panel `rgba(12,12,12,.94)` over lab `#050505`; meta cells `rgba(20,20,20,.6)`; badge `rgba(255,255,255,.06)`):

| Theme | Element | fg on bg | Ratio | AA need | Verdict |
| --- | --- | --- | --- | --- | --- |
| dark | `.specimen strong` (name) | `#a3a3a3` on `#0c0c0c` | 7.75 | 4.5 | PASS |
| dark | `.specimen small` (class line) | `#737373` on `#0c0c0c` | 4.13 | 4.5 | **FAIL** |
| dark | `.specimenIndex` (01) | `#525252` on `#0c0c0c` | 2.50 | 4.5 | **FAIL** |
| dark | `.specimenNoteHeader span` | `#737373` on `#0c0c0c` | 4.13 | 4.5 | **FAIL** |
| dark | `.specimenMetaGrid span` (labels) | `#737373` on `#131313` | 3.98 | 4.5 | **FAIL** |
| dark | `.searchInput::placeholder` | `#595959` on `#121212` | 2.67 | 4.5 | **FAIL** |
| dark | `.emptySearch` | `#737373` on `#0c0c0c` | 4.13 | 4.5 | **FAIL** |
| dark | `.rosterDivider` / `.specimenNote p` | `#8c8c8c` on `#0c0c0c` | 5.82 | 4.5 | PASS |
| dark | meta values / badge text | `#d4d4d8` | 11.65–12.78 | 4.5 | PASS |
| light | `.specimenIndex` | `#8c8c8c` on `#fafafa` | 3.22 | 4.5 | **FAIL** |
| light | `.specimenMetaGrid span` (labels) | `#737373` on `#f5f5f5` | 4.35 | 4.5 | **FAIL** |
| light | `.searchInput::placeholder` | `#8c8c8c` on `#ffffff` | 3.36 | 4.5 | **FAIL** |
| light | `.emptySearch` | `#8c8c8c` on `#fafafa` | 3.22 | 4.5 | **FAIL** |

The pattern: `#525252`/`#595959`/`#737373` were chosen as "quiet" greys but land at 2.5–4.1:1. `#8c8c8c` (5.82:1 dark, and usable in light at `#595959` = 6.71:1) is the quietest grey that still passes. Fix = retint, not redesign.

### 3.4 P1 — Roster states are indistinguishable; content jumps on load

- Hover `rgba(255,255,255,.04)` vs active `rgba(255,255,255,.08)`: **0.106 luminance steps** apart. The active row's only strong cue is the 2px inset bar. Users cannot tell at a glance which specimen is loaded.
- On `selectSpecimen` the client clears `metrics`, `clips`, `clipDetails` (`:240-244`), so the meta grid collapses from 5 cells to 2 and the badge flips `18 CLIPS → STATIC MESH → 18 CLIPS` during every load. Layout shift plus a factually wrong badge mid-load.

Fix: three-tier roster states (hover = bg .04; active = bg .12 + inset accent + white name; focus-visible = existing white ring). For the detail card, keep the previous specimen's metrics visible with an "Updating…" treatment (or render fixed-height placeholder rows) instead of unmounting them, and make the badge read "LOADING…" while `loading` is true.

### 3.5 P2 — No type or spacing scale; sub-minimum sizes

Six font sizes — 8, 9, 10, 11, 13, 17px — across three families (ui-mono, Georgia serif, system-ui), plus one-off spacing 4/6/7/8/9/12/17/22/25px. The 8px tier (`.specimenBadge`, `.specimenMetaGrid span`, `.sectionMeta`) is below any comfortable reading size even for uppercase micro-labels; 9px is the roster's class line. Nothing documents why any value was chosen, so nothing is consistent between panels.

Fix: adopt the token sets in §4.1–4.3 and replace every magic number in the panel CSS.

### 3.6 P2 — Semantics and roster markup

- Roster is a bare series of buttons; no list semantics, no `aria-current` on the active row (`data-active` is presentational only), no live region for the filtered count. Screen-reader users hear "button, V2 Rig…" with no notion of position or selection.
- `specimenIndex` numbers the **filtered** array, so "01" attaches to a different specimen after every keystroke in search. Numbering that changes with the query is noise; either number by catalogue position (stable: 01, 02, 04) or drop the column.
- Group divider is hardcoded `"Egg archive"` and can never render (catalogue is 4/4 `kind: "wyvern"`, `catalog.ts:12-57`). Dead UI in a shipped panel.
- `type="search"` + custom clear button: Safari/WebKit also renders its native `::-webkit-search-cancel-button`, producing two clear buttons on iOS. Suppress the native one.
- No result count; empty state has no `role="status"`.

### 3.7 P2 — Right panel inconsistencies (shared-system impact)

- `role="tablist"` on the deck bar without `role="tab"`/`aria-selected`/`aria-controls` on the buttons (`FlightControls.tsx:134-167`) — an incomplete ARIA pattern is worse than none. Either complete it or drop the role and use `aria-pressed` filters.
- `cameraSubTab` initializes from `cameraPreset` once and never syncs (`:109-111`) — selecting an ortho preset from the persp sub-tab shows persp presets while the camera is orthographic.
- `activeOneShotName` timeout is never cleared on unmount (`:126-128`).
- Emoji icons (⚡ 🎞 🎥) in a strictly monochrome design language — replace with text labels or simple SVG glyphs.
- The sticky deck tab bar (`top: -16px`, negative margin bleed, `:726-739`) is the right pattern; the left panel's search does not use it. Search scrolls away on long rosters.

### 3.8 P3 — Touch targets and small frictions

- Search input 34px tall, clear button 20×20px, panel toggle 22×48px — all below the 44px floor the header nav already applies via `@media (pointer: coarse)` (`:118-120`). Extend that query to panel controls.
- Panels lack `overscroll-behavior: contain` (scroll chaining) and the long model filename (`wyvern-v2-idle-walk-flight-lab-candidate.glb`) breaks mid-word with `overflow-wrap: anywhere` (`:398, :418`) into three ragged lines. Prefer single-line ellipsis + `title`.
- Meta grid mounts conditionally on `metrics` — combined with §3.4 this is the layout-shift source.

## 4. Proposed design

### 4.1 Color tokens (retint, not redesign)

Keep the monochrome system; move every failing grey up one step. Measured ratios against the composited dark panel `#0c0c0c` / light panel `#fafafa`:

| Token | Dark | Ratio (dark) | Light | Ratio (light) | Replaces |
| --- | --- | --- | --- | --- | --- |
| `--panel-text` | `#f5f5f5` | 17.9 | `#0a0a0a` | 19.0 | name/heading text |
| `--panel-text-strong` | `#ffffff` | 19.6 | `#000000` | 20.1 | active row, values |
| `--panel-text-body` | `#a3a3a3` | 7.75 | `#404040` | 9.9 | roster names, body |
| `--panel-text-muted` | `#8c8c8c` | 5.82 | `#595959` | 6.71 | class lines, labels, placeholders |
| `--panel-text-faint` | `#737373` | 4.13 | `#737373` | 4.54 | **large text / icons only** (≥18.66px or ≥24px, or non-text) |
| `--panel-accent` | `#ffffff` | — | `#000000` | — | active inset bar, focus ring |

Rule: nothing below `--panel-text-muted` carries information at text sizes. `#525252`/`#595959` disappear from text roles entirely (they may remain on decorative 1px rules).

### 4.2 Typography tokens

Two families, deliberate roles: **Georgia** for the display voice (panel/specimen names — it already carries the h1), **ui-monospace** for all data and UI chrome. Drop system-ui from the description paragraph; mono at 11px/1.65 reads fine at this measure and removes the third family.

| Token | Size / line | Family | Use |
| --- | --- | --- | --- |
| `--t-micro` | 10px / 1.2, `ls .12em`, uppercase | mono | badges, meta labels, group headers |
| `--t-label` | 11px / 1.4 | mono | section labels, buttons, chips |
| `--t-body` | 12px / 1.6 | mono | roster class line, description |
| `--t-name` | 13px / 1.3, 500 | mono | roster row name |
| `--t-card-title` | 15px / 1.25, 500 | Georgia | selected specimen name |
| `--t-panel-title` | 10px / 1.2, uppercase, `ls .16em` | mono | "FLIGHT SPECIMENS" label |

Minimums: no text below 10px, ever. The 8px tier is abolished; micro-labels move to 10px.

### 4.3 Spacing tokens

`--s-1: 4px`, `--s-2: 8px`, `--s-3: 12px`, `--s-4: 16px`, `--s-5: 24px`. Panel padding stays 16px (`--s-4`); section gaps become 16/12; roster row padding 10px 8px → 8px 10px on the 8px grid; the odd 17/22/25px values in `.specimenNote` become 12/16. Touch-target floor: 44px at `pointer: coarse`, 36px otherwise (search input, clear button, panel toggle).

### 4.4 Left panel anatomy (proposed)

```
┌─────────────────────────────┐
│ FLIGHT SPECIMENS      4 / 4 │  ← section label + live result count (sticky with search)
│ ┌─────────────────────────┐ │
│ │ [q] Search specimens…  ✕ │ │  ← sticky; 36/44px; webkit cancel suppressed
│ └─────────────────────────┘ │
│ ── FLIGHT ROSTER ────────── │  ← group header for group 1 (data-driven, symmetric)
│ ▌01  V2 Rig (Gothic Rebuild)│  ← active: bg .12 + inset bar + white name
│    v2 rebuild (Rig 2)       │
│  02  V2 Locomotion Candidate│
│  03  V2 Membrane Repair …   │
│  04  V1 Rig (Drogon Player) │
│ ── SELECTED SPECIMEN ────── │
│ V2 Rig (Gothic Rebuild / Rig 2)   [18 CLIPS] │  ← Georgia 15px; badge → LOADING… while loading
│ Rig 2 focus rig: 92 bones…  │  ← mono 12px/1.6, --panel-text-body
│ ┌──────────┐ ┌───────────┐ │
│ │ MODEL    │ │ TARGET    │ │  ← labels 10px muted; values 11px strong;
│ │ wyvern-v2-rig.glb        │ │    model filename single-line ellipsis + title
│ ├──────────┴───────────┤ │
│ │ DIMENSIONS 3.2×4.1×12.4m│ │  ← fixed-height rows; previous metrics retained
│ └──────────────────────────┘ │    with "Updating…" during load (no collapse)
└─────────────────────────────┘
```

Content-organization changes, with reasoning:

1. **Result count next to the section label** (`4 / 4`, `aria-live="polite"`). Search currently gives no feedback until the list visibly empties; a count makes filtering legible and is the cheapest possible live region. *Reasoning: the roster is the panel's index; an index needs a count.*
2. **Symmetric, data-driven group headers.** Replace the dead "Egg archive" divider with headers rendered for every `kind` group present ("Flight roster" / "Egg archive" when eggs exist). *Reasoning: labeling one group and not the other is an accident of ordering; deriving from data kills the dead branch and makes grouping honest if the catalogue grows.*
3. **Stable roster numbering by catalogue position.** *Reasoning: numbers that renumber under the user's keystrokes carry zero information; stable numbers let a user say "load 03" and mean it.*
4. **`aria-current="true"` on the active row + `role="list"`/`role="listitem"` semantics on the roster** (buttons inside list items). *Reasoning: `data-active` is CSS-only; selection is the one fact a screen-reader user most needs from this panel.*
5. **Detail card below a divider, not floating.** It already sits after a border-top; formalize it as the panel's second region with its own micro-label ("SELECTED SPECIMEN" → keep, it's good) so the two regions read as card, not one long scroll.
6. **Meta grid: two columns, labels above values, dimensions full-width.** Keep the structure; fix the type tokens, the ellipsis on model filename, and the mount-time shift.

### 4.5 Right panel consistency changes

- Complete or drop the deck tab ARIA: recommended — drop `role="tablist"`, keep four filter buttons with `aria-pressed`, because they filter sections rather than switch panels. *Reasoning: half an ARIA pattern lies to assistive tech; `aria-pressed` toggle buttons are what these actually are.*
- Sync `cameraSubTab` to `cameraPreset` via an effect (or derive during render). *Reasoning: a sub-tab that shows "Perspective" while the camera is in matched-ortho is a false control label.*
- Clear the one-shot timeout on unmount.
- Replace emoji with text or 12px SVG glyphs.
- Mirror the left panel's sticky search: make the clip search sticky too.

### 4.6 User flow spec

**Desktop (≥1051px)** — unchanged dock behavior (it works), plus: toggle keeps `aria-expanded`, gains `aria-controls` (panel ids), and a 44px coarse-pointer floor. Collapsed panels stay `display: none`.

**Tablet/phone (≤1050px)** — drawers, hardened:
1. First paint with no persisted preference → both collapsed (media-query-aware default).
2. Opening a drawer adds a scrim over the stage; click scrim or press Escape → close; focus moves to the drawer on open and returns to the toggle on close.
3. Closed drawer → `visibility: hidden` (animated) so it leaves the tab order.
4. Selecting a specimen in the left drawer closes it — the user's next intent is to look at the stage.
5. The toggle parks at the screen edge when closed, rides the drawer's inner edge when open (already correct), with 44px touch height.

**All widths** — reduced-motion already respected (`:3165-3168`); keep it.

### 4.7 State handling spec

| Change | Where | Reasoning |
| --- | --- | --- |
| Media-aware panel defaults | `FlightLabClient.tsx:86-87, 196-206` | Kills the phone-curtain first paint (§3.2) |
| Drawer close on select | `selectSpecimen` | Master→detail flow on small screens |
| Retain previous metrics during load; badge `LOADING…` | `SpecimenSidebar` props + `FlightLabClient` loading state | Removes layout shift and the false "STATIC MESH" (§3.4) |
| Stable numbering + count + live region | Sidebar | Search legibility and SR parity (§3.6) |
| `cameraSubTab` sync; one-shot timer cleanup | `FlightControls` | Truthful controls, no post-unmount setState (§3.7) |

## 5. Prioritized recommendations

| # | Recommendation | Severity | Reasoning (why this change) |
| --- | --- | --- | --- |
| 1 | Retint text to §4.1 tokens | P1 | Ten measured AA failures; one-step grey moves fix all of them without touching the look |
| 2 | `visibility: hidden` on closed drawers + Escape/scrim close + focus return | P1 | Off-canvas ≠ inaccessible; the desktop path already proves the intent |
| 3 | Media-aware panel defaults; close left drawer on specimen select | P1 | First paint on a phone currently hides the product |
| 4 | Three-tier roster states (hover/active/focus) | P1 | 0.106 luminance steps between the two most-used states is not a design system, it's an accident |
| 5 | Type + spacing tokens (§4.2–4.3), abolish 8px | P2 | Six sizes and a dozen spacings cannot stay consistent across two hand-maintained panels |
| 6 | Roster semantics: list roles, `aria-current`, stable numbers, count live region | P2 | Selection and position are the panel's whole job; make them machine-readable |
| 7 | Data-driven group headers; delete dead egg branch | P2 | Dead UI misleads future readers about the catalogue |
| 8 | Detail-card stability during load (retain metrics, LOADING… badge) | P2 | Layout shift mid-load reads as breakage |
| 9 | Suppress `::-webkit-search-cancel-button`; sticky search; 44px coarse targets | P2/P3 | iOS double-clear, scroll-away search, thumb-hostile hit areas |
| 10 | Right-panel ARIA completion, sub-tab sync, timer cleanup, emoji removal | P2/P3 | Consistency is the ask; the dock is a system, not two panels |
| 11 | `overscroll-behavior: contain`; model filename ellipsis + title | P3 | Scroll chaining and ragged mid-word breaks are small papercuts |

## 6. Verification plan (per repo convention — evidence, not assertion)

1. `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test` before and after.
2. Screenshots at 1440 / 1024 / 390 px, both themes, both panel states: `docs/flight-lab/evidence/2026-10-21-side-panel-*.png` (supersedes the current panel-dock set).
3. Re-run the contrast script (§3.3 method) against the new tokens — every text pair ≥4.5, icons ≥3.0.
4. Keyboard pass: Tab through the closed-drawer state at 390px (must skip panels), Escape closes, focus returns to the toggle.
5. axe DevTools (or equivalent) on both routes states — expect zero violations for the panel subtree.
6. First-paint check on a phone viewport with `localStorage` cleared: stage visible, drawers closed.

## Appendix — measurement method

Contrast: WCAG 2.1 relative luminance over composited backgrounds (panel `rgba(12,12,12,.94)` on lab `#050505`; meta cell `rgba(20,20,20,.6)`; badge `rgba(255,255,255,.06)`; light panel `rgba(250,250,250,.95)` on `#f0f0f0`; meta `#f5f5f5`). Active/hover delta: luminance distance between `rgba(255,255,255,.04)` and `.08` overlays on `#0c0c0c` = 0.106 steps. Sources: `FlightLabClient.module.css:168-419, 726-793, 2205-2368, 3106-3168`, `SpecimenSidebar.tsx`, `PanelToggle.tsx`, `FlightControls.tsx`, `FlightLabClient.tsx`, `catalog.ts`.

## Implementation addendum (2026-10-21)

### What shipped

| Doc item | Where | Status |
| --- | --- | --- |
| §4.1 color tokens | `FlightLabClient.module.css` — `--panel-text*` custom properties on `.surface` with a `[data-theme="light"]` override block | Done. Every failing text role now resolves to a measured ≥4.5:1 token; `#525252`/`#595959`/`#737373` survive only on decorative borders, the scrollbar, and stage-overlay rules outside the panels. |
| §4.2 type tokens | `--t-micro` (10px) … `--t-card-title` (15px Georgia) | Done. The 8px tier is abolished panel-wide; the roster class line landed on `--t-micro` (10px uppercase caption) rather than `--t-body` — at 12px it competed with the 13px name instead of reading as a caption. |
| §4.3 spacing tokens | `--s-1`…`--s-5` (4/8/12/16/24) | Done in the sidebar and detail card; the right panel keeps its pre-existing values where they already sat on the 8px grid. |
| §3.4 three-tier roster states | `.specimen:hover` bg `.04` / `[data-active]` bg `.12` + inset bar + white name (light: `.12`) | Done. |
| §3.1 closed drawers leave the tab order | `visibility: hidden` on collapsed drawers, transitioned with the same `.28s`; desktop `display: none` unchanged | Done. |
| §3.2 media-aware defaults | `FlightLabClient.tsx` — `useLayoutEffect` restore: persisted value wins; otherwise both collapsed at ≤1050px | Done. |
| §3.2 master→detail close | `selectSpecimen` closes the left drawer at drawer widths | Done. |
| §4.6 drawer hardening | Escape closes (focus returns to the owning toggle), scrim click closes, focus moves to the panel on open; `.drawerScrim` is `display:none` above 1050px | Done. |
| §3.4 load-stable detail card | `selectSpecimen` no longer clears metrics; `.specimenMetaGrid[data-stale]` dims previous values; badge shows `LOADING…` (dashed border) while `loading` | Done. |
| §3.6 roster semantics | `role="list"`/`listitem`, `aria-current` on the active row, live result count (`role="status"`), stable catalogue numbering, empty state `role="status"` | Done. |
| §3.7 right panel | Deck tabs and clip pills: incomplete `tablist` pattern → `role="group"` + `aria-pressed`; emoji removed; `cameraSubTab` syncs to `cameraPreset`; one-shot timer cleared on unmount; clip search made sticky below the deck bar | Done. |
| §3.8 touch/frictions | 44px coarse-pointer floor for search, clear, and toggle; `::-webkit-search-cancel-button` suppressed; `overscroll-behavior: contain`; model filename single-line ellipsis + `title` | Done. |
| §3.7 retints (right panel) | `.fpsRow`, `.fpsLabel`, `.fpsButtons button`, `.logHeader span/small`, `.logEmpty`, `.logTime`, `.logTag`, `.staticNotice`, `.ringsLabel`, `.keyDeckTitle`, `.cameraPresetIcon`, `.zoomDistanceReadout small`, `.clipCategoryPill` moved to tokens | Done — these were not in the original issue list; found in the same sweep. |
| PanelToggle | `aria-controls` + ref forwarding for focus return | Done. |

### Deviations from the proposal

1. **Group headers render only when more than one group exists.** The proposal's anatomy shows "FLIGHT ROSTER" under "FLIGHT SPECIMENS"; with a single-kind catalogue that is a redundant label. The label appears when (and only when) the roster actually splits by kind — the dead "Egg archive" branch is gone and the data-driven version is exercised the moment eggs exist.
2. **Meta grid is 3 columns with MODEL and DIMENSIONS full-width.** Two half-width columns could not hold `wyvern-v2-idle-walk-flight-lab-candidate.glb` at any readable size; the model row gets the full measure with ellipsis + `title`, and the three numeric stats share one row.

### Verification

- `pnpm tsc --noEmit` — clean. `pnpm test` — 161/161.
- Contrast re-measured against the shipped tokens: all sidebar and right-panel text pairs pass AA in both themes (worst is now 5.57:1, placeholder on `#121212`).
- Evidence (GLB temporarily moved to keep the SwiftShader renderer alive; restored, sha256 re-verified against the pinned contract `d916b748…`, `runtime_rig_contract.mjs` passes):
  - `docs/flight-lab/evidence/2026-10-21-side-panel-desktop-dark.png` — count, stable numbering, active-row lift, sticky head, text-only deck tabs
  - `docs/flight-lab/evidence/2026-10-21-side-panel-desktop-search.png` — live count `3 / 4`, filtered roster
  - `docs/flight-lab/evidence/2026-10-21-side-panel-desktop-light.png` — light-theme parity
  - `docs/flight-lab/evidence/2026-10-21-side-panel-tablet-firstpaint.png` / `-tablet-drawer-open.png` — collapsed default + scrim
  - `docs/flight-lab/evidence/2026-10-21-side-panel-phone-firstpaint.png` / `-phone-drawer-open.png` / `-phone-after-select.png` — no curtain on first paint; drawer; master→detail auto-close
- Keyboard pass not yet run (tab-order skip on closed drawers, Escape, focus return) — pending; axe sweep pending. Both are listed in §6.
