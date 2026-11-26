# SensMe UI specification (Phase 4b)

Derived exclusively from the references in `docs/UI_REFERENCES/`
(R-1…R-6; see PROVENANCE.md). All visual values are tokens in
`contracts/design-tokens/` — app code must never hardcode them
(AGENTS.md §6). Geometry is specified as **ratios of the viewport**
(reference canvas: PSP 480×272; our shells scale to any window size
while preserving ratios).

> Measurement caveat: R-6 are phone photos of a glossy PSP screen
> (glare, moiré, ±10% geometry error). Colors were corrected by eye
> against hue samples; values below are clean-room targets, not
> extracted Sony assets.

## 0. Design language (global)

The whole app is one continuous scene:

- **Backdrop**: each channel owns a static backdrop image (photo or
  generated bokeh field) filling the screen above the waterline. Photo
  backdrops are cropped to a fixed vertical band — the photo's **30%→80%
  of height counting from the bottom** (token `layout.backdropCrop`,
  expressed as rows 0.2→0.7 from the top edge) — fit to the region above
  the waterline; the water below mirrors that same band. If a photo is
  too narrow to cover the screen width at that band, the band widens
  symmetrically about its centre until the width is covered. (Product-owner
  decision 2026-11-26 — previously bottom-anchored, then top-anchored
  cover crops.)
- **Water**: from `waterline.y` (55% of height) down, the backdrop is
  mirrored as a rippling water reflection (horizontal streaking,
  ~55% opacity, subtle continuous ripple ~4 s loop).
- **Floating content**: channel tiles and album artwork float above the
  water, casting their own reflection downward from their bottom edge.
- **Text**: white, humanist sans (clean-room stand-in for Sony's
  proprietary PSP font: Source Sans 3 / system-ui), medium weight.
- **Furniture**: clock+battery top-right; button captions bottom;
  update indicator top-left (all toggleable per R-2).

Tokens: `tokens.json` (canonical), `tokens.css`, `tokens.ts`.

## 1. Channel selection grid (SELECT)

Reference: R-1 `sensme_cp1.jpg`, R-6 photos 7501/7503–7507, IMG_7506,
IMG_7510, demo_ref_video (52–58 s).

Layout (rest state):
- Static two-row grid of near-square cards — NOT a carousel. Column c
  holds entries 2c (bottom row) and 2c+1 (top row); the grid scrolls
  horizontally to keep the selected column centered and is vertically
  centered on `carousel.centerY` 0.5.
- Card size `carousel.card` (w 0.18 vw, h 0.26 vh), gaps `colGap`
  0.035 / `rowGap` 0.04 — sparse enough that the scaled selection
  never overlaps its neighbors.
- Card content: the channel's backdrop photo (per-channel mapping,
  fallback default), cover-cropped; rounded corners `r 0.012`; every
  card has a light border (2px white 0.7) + soft glow.
- Globe effect (INSIDE the globe, PSP-faithful per IMG_7504): uniform
  column spacing (`card.w + colGap`) — cards never overlap or stack.
  The arc opens to the SIDES: outer columns bow slightly TOWARD the
  viewer (`globe.depth` 0.12) and are gently angled inward
  (`globe.angleDeg` 10° per column, `rotateY −col·angleDeg` — concave,
  like the inside of a sphere). Rows converge toward the vertical
  center (`rowCurve` 0.045 — kept under half the row gap so rows
  never touch); perspective 1.4 H; far columns dim slightly; stepping
  rotates the globe (420 ms transform morph).
- Selected card: scale `carousel.selectedScale` 1.12 + stronger white
  glow. Bottom-row cards reflect on the floor.
- Channel name: centered under the bottom row, `type.title`, white with
  shadow + floor reflection.
- Captions bottom-LEFT, chip style: each control is a bordered key chip
  followed by plain help text (`[Esc] Back  [Enter] Select`); PSP glyph
  chips on touch/console. `type.caption`.

Interaction (R-2):
- ←/→ move one column (±2 entries); ↑/↓ move within the column. Grid
  scroll animates `motion.carouselStep` 420 ms
  (`cubic-bezier 0.25,0.1,0.25,1`); tiles scrolled into view fade in
  (`motion.tileInMs` 300 ms) and the channel name crossfades.
- ◯/Enter confirms → now-playing (`motion.enterNowPlaying` 380 ms).
- ✕/Esc returns to now-playing.
- Channel switch crossfades the backdrop photo (`motion.channelSwitch`
  320 ms) — e.g. day ↔ relax test photos. While browsing, the backdrop
  previews the selected channel; ✕/Esc cancels and restores the backdrop
  of the channel backing now-playing (the preview must not leak).
- Empty channels are slightly dimmed and cannot be selected (R-2 hint).

Fidelity checklist: [ ] layout [ ] color [ ] typography [ ] icons
[ ] animation timing [ ] behavior — to be scored in 4d.

## 2. Now playing (home screen)

Reference: R-1 `sensme_cp2.jpg`, R-6 photos 7509–7519.

Layout:
- Track carousel (R-6 7508/7509, demo_ref_video 32–46 s): current track
  card `np.size` 0.62 H at center x 0.23, vertical center `np.centerY`
  0.51 (reflection below). Missing artwork → channel placeholder card
  (e.g. Favourites heart).
- Next tracks: up to 5 smaller cards (`np.slots` 1–5: scale 0.55→0.24,
  opacity 0.95→0.35) stacked behind and immediately after the previous
  (overlapping, nearer on top), all vertically centered on the current
  card; the previous card glides out left. Non-cyclic: clamped at both
  ends — a one-track channel shows a single card; next at the end stops.
  Slot X is not hardcoded: each card's center chains from the previous
  one — `x_k = x_{k−1} + (w_{k−1}+w_k)/2 − np.overlap·w_k`
  (`np.overlap` 0.3) — so every card shows 70% of its width and the
  stack overlap is uniform at every depth and aspect ratio (computed
  in vh; anchor `np.anchorX` 0.23 vw).
- Track title: right-aligned block, baseline y 0.74, `type.title`,
  white; thin rule under it (R-6 7511).
- `Artist / Album` line below: y 0.81, `type.body`, white 72%; title
  block mirrored on the floor (reflection).
- Copyright line (when tagged): y 0.92, `type.small`, white 45%.
- Backdrop: current channel's photo (per-channel mapping), crossfaded
  on channel switch; rippling floor reflection below the waterline.
- Captions bottom-left, chip style (key chip + help text): desktop
  shows `[Esc] Change Channels [Space] Play/Pause [←] Prev [→] Next
  [F] Favourites [C] Add Music`; touch/console keeps PSP glyph chips
  (`SELECT`/`START`/`L`/`R`/`♥`/`OPTIONS`). Esc toggles the channel
  grid from now-playing (and back). The Add Music chip makes the
  rescan entry point discoverable (Options menu → "Music Scan").
- Clock + battery top-right (margin 0.05), `type.title`.

Interaction (R-2):
- Two-step track selection: L/R (or `,`/`.`) stages the next/previous
  candidate — it slides into the big slot at `np.pendingScale` 0.72
  while the outgoing card glides left; playback does NOT start. The
  caption switches to `START/◯ Confirm · ✕ Cancel`. Card morph animates
  `motion.npStepMs` 460 ms ease (`cubic-bezier 0.25,0.1,0.25,1`); the
  title/artist block re-fades (`fadeUp`) on every focus change.
- START/◯ confirms: the candidate scales up to full size and playback
  starts. ✕/Esc cancels the candidate (the current card returns).
- START/Space with no candidate toggles play/pause; `F` favourites,
  `⇧F` removes.
- △/`O` or right-click opens options menu (dim scrim, panel slides in
  from right, 220 ms).
- Per-selection shuffle order (R-2 hint).

Fidelity checklist: [ ] layout [ ] color [ ] typography [ ] icons
[ ] animation timing [ ] behavior.

## 3. Options menu (△)

Reference: R-6 photos 7520–7521; item list from R-2.

- Scrim: `menu.scrim` over the whole screen (scene stays visible).
- Panel: right 55% of width, full height, translucent dark.
- Items centered in panel, `type.body`, line pitch 0.088 H; selected
  item bold + brighter; ▼ scroll indicator when overflowed.
- Items (order per R-2): View Settings (Time and Battery, Button
  Caption), Sound Settings (Dynamic Normalizer, Sound Effects),
  Favourites Setting, Block List Settings, Help, Check for Updates*,
  About. (*offline-first: disabled without network.)
- Captions bottom: `✕ Select  ◯ Close`.
- Submenus replace the item list in place (same panel).

Fidelity checklist: [ ] layout [ ] color [ ] typography [ ] icons
[ ] animation timing [ ] behavior.

## 4. Update / analysis state

Reference: R-6 photo 7509 ("Now updating… 1/1"), R-2.

- Top-left: rotating update indicator icon.
- Bottom-left status: `Updating channels… xx/xx` (`type.caption`).
- Progress card variant (first run): centered card with app logo +
  progress bar + `✕ Cancel` (R-6 7509).
- Our addition (documented deviation): per-file analysis errors are
  counted and surfaced in the same status line.
- Our addition: re-import is a **rescan** — files already in the
  library (same path + size + mtime) are skipped and counted
  (`(N already in library)`), so adding music to a folder and
  re-scanning only analyzes what's new/changed. Entry points: `[C]`
  chip in the captions, Options menu → "Music Scan", `Space` on the
  empty screen.

## 5. Help screen

Reference: R-2 (content), R-6 (not captured — deviation: styled like
the options panel, full-screen text pages, ✕/Esc closes).

## 6. Channel identity (clean-room)

Sony's backdrop photos and icons cannot ship (AGENTS.md §7). Each
channel gets a generated backdrop: dark base + bokeh dot field +
hue theme from `channelHues` in tokens (Favourites blue, Dance warm
multicolor, Emotional green, …). Tile thumbnails render the same
generator at higher contrast. Dot-grid on now-playing uses
`dotPalette`.

## 7. Utility channels

Shuffle All, Favourites, Newly Added appear in the carousel in the
official order (R-2) with utility icons (shuffle arrows, heart, plus)
— clean-drawn, PSP-style stroke icons.

## 8. Typography & motion tokens

See `contracts/design-tokens/tokens.json`. Type sizes are fractions of
viewport height (PSP px in comments). Motion durations measured from
R-6 video frames (transition completes in ~10 frames @30 fps ⇒
300–380 ms; ripple loop estimated).

## 9. Mobile & touch adaptation (AGENTS §6: input adaptation, not redesign)

The visual model is unchanged on touch devices; only input mechanisms and
viewport handling adapt.

### Landscape lock

The PSP is a landscape 16:9 device, so the app is landscape-only on
touch devices (product-owner decision 2026-11-26):

- PWA manifest declares `orientation: "landscape"` (installed apps open
  locked).
- Best-effort `screen.orientation.lock("landscape")` on the first touch
  (works where the browser allows it, e.g. Android in fullscreen/PWA;
  failures are ignored).
- In portrait on a coarse-pointer device, a PSP-style rotate overlay
  (dark scrim, rotating device glyph, "Rotate your device") covers the
  whole screen until the device is turned. Desktop (fine pointer) is
  never affected.

### Touch input map (identical semantics to the PSP buttons)

| Gesture / control            | Carousel (SELECT)              | Now playing                     |
| ---------------------------- | ------------------------------ | ------------------------------- |
| Tap (empty area / artwork)   | ◯ Select channel               | START play/pause (confirm)      |
| Tap a tile                   | move selection to that tile    | —                               |
| Swipe ← / →                  | D-pad column left/right        | L / R stage prev/next candidate |
| Swipe ↑ / ↓                  | D-pad row up/down              | SELECT → channel carousel       |
| Caption chip (now a button)  | ✕ Back · ◯ Select              | SELECT · START · L · R · ♥ · OPTIONS |

Caption chips render as buttons on coarse-pointer devices and trigger
exactly the same actions as the keyboard bindings; on desktop they stay
static help text. All touch actions go through the same action
dispatcher as the keyboard map (`interaction-model.md`), so behaviour
cannot drift between platforms.

### Viewport handling

- Layout units use dynamic viewport units (`dvh`/`dvw`) so mobile URL
  bars never crop the scene.
- Furniture (clock, captions, menu) respects `env(safe-area-inset-*)`
  with `viewport-fit=cover`.
- `touch-action: none` (the app owns every gesture and never scrolls),
  suppressed overscroll and tap-highlight: no double-tap zoom, no
  pull-to-refresh, no flash on tap.

## Fidelity gate bookkeeping (AGENTS.md §6)

Each screen above carries a checklist; 4d scores every item against
R-6 rectified captures (`references-local/`, analysis copies in the
scratch dir). Deviations allowed only when documented here (see §5, §6).
