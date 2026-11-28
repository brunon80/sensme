# Moodwave UI specification (Phase 4b)

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
  mirrored as a rippling water reflection, rendered per-pixel by a WebGL
  shader (Canvas-2D fallback when WebGL is unavailable). Tuned against
  original PSP footage (`IMG_7532.MOV`, product-owner reference
  2026-11-27): three long, slow wave trains with gently curving
  wavefronts and a light domain warp, depth-scaled displacement
  (calm at the waterline, choppier with distance), strong vertical
  compression of the mirrored source (~0.82), a near-opaque mirror
  fading ~72%→50% with depth, mild horizontal streaking, subtle
  crest/trough shading and faint specular — no visible waterline
  divider line. Motion is continuous (no loop seam); all parameters
  in `tokens.water`.
- **Floating content**: channel tiles and album artwork float above the
  water, casting their own reflection downward from their bottom edge.
- **Text**: white, humanist sans (clean-room stand-in for Sony's
  proprietary PSP font: Source Sans 3 / system-ui), medium weight.
- **Furniture**: clock+battery top-right; button captions bottom;
  update indicator top-left (all toggleable per R-2).

Tokens: `tokens.json` (canonical), `tokens.css`, `tokens.ts`.

## 1. Channel selection grid (SELECT)

Reference: R-1 `moodwave_cp1.jpg`, R-6 photos 7501/7503–7507, IMG_7506,
IMG_7510, demo_ref_video (52–58 s).

Layout (rest state):
- Static two-row grid of near-square cards — NOT a carousel. Column c
  holds entries 2c (bottom row) and 2c+1 (top row); the grid scrolls
  horizontally to keep the selected column centered and is vertically
  centered on `carousel.centerY` 0.5.
- Grid composition (user-directed layout, 2026-11-26): top row = the
  time-of-day channel(s), Energetic, Mellow, Emotional, Dance,
  Favourites; bottom row = Shuffle, Relax, Upbeat, Lounge, Extreme,
  Newly Added. By default only the time-of-day channel matching the
  clock shows (Morning 05:00–09:59, Daytime 10:00–15:59, Evening
  16:00–18:59, Night 19:00–23:59, Midnight 00:00–04:59); View Settings
  → All Day Channels (default OFF) restores all five, chronological.
  The app boots on the current time-of-day channel, already playing
  (autoplay policy may block; START retries). Gate:
  `apps/web/scripts/grid.mjs`.
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
- ←/→ move one column; ↑/↓ move within the column (the grid is dynamic
  — the time-of-day slot follows the clock; selection is preserved
  across grid changes when the channel is still on the grid). Grid
  scroll animates `motion.carouselStep` 420 ms
  (`cubic-bezier 0.25,0.1,0.25,1`); tiles scrolled into view fade in
  (`motion.tileInMs` 300 ms) and the channel name crossfades.
- ◯/Enter confirms → now-playing (`motion.enterNowPlaying` 240 ms).
- Touch (UI_SPEC §9): horizontal flicks move the selection in the flick
  direction (swipe left → one column right, matching now-playing's
  swipe-left = next), vertical flicks move within the column.
- ✕/Esc returns to now-playing.
- Channel switch crossfades the backdrop photo (`motion.channelSwitch`
  320 ms) — e.g. day ↔ relax test photos. The backdrop does NOT change
  while browsing the grid; it crossfades only when the selected channel
  is entered.
- SELECT/✕ from now-playing: the now-playing ELEMENTS scale down to
  `np.dim.scale` 0.78 and dim to `np.dim.opacity` 0.3, staying visible
  behind the grid (`motion.enterNowPlaying` 240 ms); ✕/Esc reverses the
  same way. The grid enters scaled 0.82 → 1 + fade and exits the exact
  reverse (no sideways slide). A dark scrim (`carousel.scrim` 0.35)
  fades in BETWEEN the two layers so the grid clearly reads as in
  front — the screens must never visually mix. Layer order: backdrop →
  now-playing (z 10) → scrim (z 20) → grid (z 30). The backdrop never
  scales or fades.
- Empty channels are slightly dimmed and cannot be selected (R-2 hint).

Fidelity checklist: [ ] layout [ ] color [ ] typography [ ] icons
[ ] animation timing [ ] behavior — to be scored in 4d.

## 2. Now playing (home screen)

Reference: R-1 `moodwave_cp2.jpg`, R-6 photos 7509–7519.

Layout:
- Track carousel (R-6 7508/7509, demo_ref_video 32–46 s): current track
  card `np.size` 0.62 H at center x 0.23, vertical center `np.centerY`
  0.51 (reflection below). Missing artwork → channel placeholder card
  (e.g. Favourites heart).
- Next tracks: smaller cards (`np.slots` 1–5: scale 0.55→0.24, NO opacity
  fade — every card is fully opaque) stacked behind and immediately after
  the previous (overlapping, nearer on top), standing ON the water
  surface: each card's bottom edge sits at `waterlineY + (npBottom −
  waterlineY) · scale^np.floorExp` (floorExp 2), so bottom edges
  converge to the waterline as cards recede while the big foreground
  card dips below it (PSP reference photo, product owner 2026-11-27);
  cards are yawed in 3D (`np.tiltDeg` 28° ramped over `np.tiltRamp` 4 slots, `.nowplaying` perspective)
  so the row reads as a fan, not flat paper: receding cards yaw with
  their right edges toward the viewer (fan wrapping away to the right),
  the current card carries the same angle mirrored (product-owner
  correction 2026-11-27);
  the chain continues geometrically (ratio of the last
  two token scales) but floors at `np.minScale` 0.16 — far cards barely
  shrink and keep stacking horizontally; the floor anchor keeps their
  BOTTOM edges aligned along the water while the gentle decay serrates
  the TOP edges in steps (product-owner correction 2026-11-27) — until
  cards run fully past the RIGHT EDGE — the
  stack always reaches the screen edge at any aspect. The previous card
  glides out left. Non-cyclic: clamped at both ends — a one-track
  channel shows a single card; next at the end stops.
  Slot X is not hardcoded: each card's center chains from the previous
  one — `x_k = x_{k−1} + (w_{k−1}+w_k)/2 − np.overlap·w_k`
  (`np.overlap` 0.3) — so every card shows 70% of its width and the
  stack overlap is uniform at every depth and aspect ratio (computed
  in vh; anchor `np.anchorX` 0.23 vw).
- Every card (current and receding) reflects on the water below, like
  the PSP's glossy floor.
- Track title: right-aligned block, baseline y 0.74, `type.title`,
  white; thin rule under it (R-6 7511).
- `Artist / Album` line below: y 0.81, `type.body`, white 72%; title
  block mirrored on the floor (reflection).
- Marquee: a title/artist line wider than the text block auto-scrolls
  (left, loop with pauses at both ends, ~100 px/s) so the full text can
  be read; lines that fit stay static with an ellipsis. The reflection
  scrolls in lockstep (shared document timeline). Gate:
  `apps/web/scripts/marquee.mjs`.
- Copyright line (when tagged): y 0.92, `type.small`, white 45%.
- Backdrop: current channel's photo (per-channel mapping), crossfaded
  on channel switch; rippling floor reflection below the waterline.
- Captions bottom-left, chip style (key chip + help text): desktop
  shows `[Esc] Change Channels [Space] Play/Pause [←] Prev [→] Next
  [F] Favourite [C] Add Music`; touch/console keeps PSP glyph chips
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
- START/Space with no candidate toggles play/pause; `F` toggles the
  favourite (the chip shows the action the press performs).
- Favourite toggle chip (PSP reference IMG_7534.MOV, 2026-11-27): when
  the current track is a favourite, the chip reads `[F] Unfavourite`
  (touch: `♥ Unfavourite`) instead of `[F] Favourite`, and the whole
  caption strip crossfades on the change (`motion.npStepMs`, same fade
  whether the track was already favourited on entry or was just added).
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
- Items (PSP order per R-2, minus no-ops — AGENTS §3 forbids silent
  placeholders): View Settings (Time and Battery, Button Caption, All
  Day Channels ON/OFF, default OFF — OFF shows only the time-of-day
  channel matching the clock),
  Sound Settings (Dynamic Normalizer ON/OFF, default ON — functional,
  ADR-018), Music Scan, Metadata Lookup (fill missing tags/artwork/label
  from MusicBrainz + Cover Art Archive, ADR-019 — user-initiated only;
  progress is the discreet corner indicator, never the first-run modal),
  Favourites Setting, Block List Settings,
  Database Settings (rebuild/wipe), Help, About. Check for Updates and
  Sound Effects stay omitted until they actually do something.
- Layer: the menu sits above every scene layer (z 50: backdrop →
  now-playing → scrim → grid) and below the furniture overlay (z 60).
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
| Caption chip (now a button)  | ✕ Back · ◯ Select              | SELECT · START · L · R · ♥ · OPTIONS · ⚙ |

Caption chips render as buttons on every platform (mouse click or touch
tap) and trigger exactly the same actions as the keyboard bindings. All
touch actions go through the same action dispatcher as the keyboard map
(`interaction-model.md`), so behaviour cannot drift between platforms.

### Mouse input map (identical semantics to the PSP buttons)

Desktop keeps the keyboard map; the mouse adds pointing without changing
any screen or animation (product-owner request 2026-11-27):

| Mouse action                    | Carousel (SELECT)                     | Now playing                                |
| ------------------------------- | ------------------------------------- | ------------------------------------------ |
| Wheel ↓ / → (or ↓ accumulated)  | D-pad column right (globe rotates)    | R: stage next candidate (pending scale)    |
| Wheel ↑ / ←                     | D-pad column left                     | L: stage prev candidate                    |
| Press-hold + drag ← / →         | globe rotates live, snaps to nearest column on release | stack follows live, snaps to nearest track (stages candidate) |
| Click a tile                    | move selection to that tile           | —                                          |
| Click the selected tile         | ◯ enter channel                       | —                                          |
| Click a side card               | —                                     | stage that track as the candidate          |
| Click the big card              | —                                     | START: confirm candidate / play · pause    |
| Caption chip (button)           | Esc Back · Enter Select               | Esc · Space · ← · → · F · C · O Options    |

- The wheel accumulates deltas and fires one step per notch (≈50 px), so
  trackpads cannot burst-step; wheel events are swallowed (the app never
  scrolls).
- Drag scrub: a press that travels ≥ 6 px becomes a drag — the globe/slot
  geometry is driven by a fractional column offset, so the whole view
  follows the pointer live (step transitions off while dragging). Release
  always settles centered on the **nearest** element: ≥ half a step
  commits via the shared dispatcher (same step animation as wheel/
  keyboard), less springs back. Progress is clamped at the queue/grid
  ends, and the click a drag ends with is swallowed so it cannot
  double-fire as select/enter.
- Clicking a now-playing card reuses the two-step selection: side cards
  stage a candidate at `np.pendingScale` (same animation as L/R), and the
  big card confirms (scales up + plays) or toggles play/pause.
- The now-playing captions carry an Options chip (desktop `O`, touch `⚙`)
  that opens the settings menu — the mouse equivalent of the PSP △ button.
- Empty channels stay dimmed and unclickable; dimmed now-playing cards
  behind the open grid ignore clicks.
- Mouse affordances are cursor-only (`pointer` on tiles/cards, chip hover
  mirrors the touch `:active` state): no visual redesign.

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
