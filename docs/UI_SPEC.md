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
  generated bokeh field) filling the screen above the waterline.
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

## 1. Channel carousel (SELECT)

Reference: R-1 `sensme_cp1.jpg`, R-6 photos 7501/7503–7507.

Layout (rest state):
- Single horizontal row of tiles, vertically centered on the waterline
  (tile bottom at `carousel.baseline` = 62% H).
- Selected tile centered horizontally: `w 0.26, h 0.42` of viewport,
  white border 2px + soft outer glow.
- Neighbors: `w 0.18, h 0.30`, receding right (and left) with
  perspective tilt (~18°) and progressive scale-down (×0.85 per step)
  and dim (−18% per step).
- Tile content: channel backdrop thumbnail; rounded corners `r 0.02`.
- Reflections of all tiles below the waterline.
- Channel name: centered under selected tile, `type.title` (16/272 H),
  white, at y 0.68.
- Captions bottom-center: `✕ Back` left of `◯ Select` (or `✕ Next`
  when entered from now-playing), `type.caption`.

Interaction (R-2):
- ←/→ step tiles; each step animates `motion.carouselStep` 260 ms
  ease-in-out.
- ◯/Enter confirms → transition to now-playing (`motion.enterNowPlaying`
  380 ms: tiles slide right + fade, artwork grows from selected tile).
- ✕/Esc returns to now-playing.
- Channel switch while playing crossfades backdrop + dot hue.
- Empty channels are dimmed and cannot be selected (R-2 hint).

Fidelity checklist: [ ] layout [ ] color [ ] typography [ ] icons
[ ] animation timing [ ] behavior — to be scored in 4d.

## 2. Now playing (home screen)

Reference: R-1 `sensme_cp2.jpg`, R-6 photos 7509–7519.

Layout:
- Album artwork: square, `art.size` 0.59 H, center x `0.28`, bottom
  edge at `art.bottom` 0.86 H (stands on the water; reflection below).
  Missing artwork → channel placeholder card (e.g. Favourites heart).
- Track title: right-aligned block, baseline y 0.77, `type.title`,
  white; thin rule under it (R-6 7511).
- `Artist / Album` line below: y 0.85, `type.body`, white 72%.
- Copyright line (when tagged): y 0.92, `type.small`, white 45%.
- Backdrop: current channel's image; dot-grid channels (Dance) show
  the colored dot field with water reflection.
- Captions bottom-left: `△ Options`; while playing also
  `SELECT Change Channels · START Pause · ♥ Add to Favourites`
  (R-6 7509), `type.caption`, centered bottom.
- Clock + battery top-right (margin 0.03), `type.title`.

Interaction (R-2):
- START/Space toggles play/pause; L/R or `,`/`.` prev/next with
  artwork slide (260 ms).
- ↑/`F` add to Favourites (♥ pulse); ↓/`⇧F` remove; hold ↓/`B` block.
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

## Fidelity gate bookkeeping (AGENTS.md §6)

Each screen above carries a checklist; 4d scores every item against
R-6 rectified captures (`references-local/`, analysis copies in the
scratch dir). Deviations allowed only when documented here (see §5, §6).
