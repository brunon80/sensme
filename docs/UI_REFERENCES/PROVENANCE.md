# UI reference provenance

Per AGENTS.md §7, Sony screenshots are **studied as references only** and
are never committed to this repository. Reference images live outside the
repo (analysis copies in the scratch dir); this file records every source,
its capture, and what it documents. Shipped assets are clean-room
reimplementations derived from the specs in `docs/UI_SPEC.md`.

## Sources

| ref | source | status | documents |
|---|---|---|---|
| R-1 | Sony official PSP SensMe channels site (EN), archived 2010-08-18: `web.archive.org/web/20100818034520/http://www.playstation.com/psp-app/sensme/en/` | text + 2 thumbnails (`sensme_cp1.jpg`, `sensme_cp2.jpg`, 193×109) | channel carousel screen, now-playing screen, app icon |
| R-2 | Sony official "Using SensMe channels" manual pages (EN), archived 2011-06-18 / 2012-01-08: `.../en/usage.html`, `.../en/listen.html`, `.../en/prepare.html` | full text | complete interaction model: buttons, channels, options menu, status messages (transcribed in `interaction-model.md`) |
| R-3 | Wikipedia "SensMe" article (rev. 2026-11-21): `en.wikipedia.org/wiki/SensMe` | text + fair-use images | PSP channel list, version history (1.00/1.01/1.50), firmware 6.10 debut |
| R-4 | PSP XMB screenshot (Wikipedia fair-use, `SensMe_channels_on_PSP.jpg`, 421×237) | image | XMB Music category placement of the SensMe icon (not the app UI itself) |
| R-5 | Sony official JP site, archived 2012-01-04: `web.archive.org/web/20120104145251/http://www.playstation.com/psp-app/sensme/jp/` | text + same 2 thumbnails | JP naming (おまかせチャンネル), same screens |
| R-6 | **Product-owner captures** (iPhone photos + Live Photo videos of a real PSP running SensMe channels v1.50), 2026-11-25, 19 photo/video pairs in `references-local/` (never committed) | analyzed | all screens: carousel (Favourites/Extreme/Newly Added/Lounge/Emotional/Dance), now-playing ×8 (incl. placeholder art, dot-grid backdrop), options menu + 3 submenus, update state, XMB context. Rectified 480×272 analysis copies + palette/geometry measurements in the scratch dir; drove `docs/UI_SPEC.md` and `contracts/design-tokens/` |

## What R-1 thumbnails show (low-res, used for layout only)

- `sensme_cp1.jpg` — **channel selection**: horizontal carousel of
  photographic channel tiles; selected tile centered, enlarged, white
  border; channel name ("Dance") centered below; button captions
  ("✕ Back  ◯ Select") bottom-center; dark background with a field of
  colored bokeh dots above and a mirrored reflection of the tiles below.
- `sensme_cp2.jpg` — **now playing**: large album artwork left of center;
  "Artist — Title" caption bottom-center ("Cristina — Moonshadow");
  grid of colored dots upper-right (channel membership indicators);
  caption "✕ Dance" bottom-left (back-to-channel context); same bokeh
  background + reflective floor.

## Reference coverage (post R-6)

| screen | refs |
|---|---|
| Channel carousel | R-1 cp1, R-6 ×6 |
| Now playing | R-1 cp2, R-6 ×8 (incl. placeholder art + dot-grid backdrop) |
| Options menu + submenus | R-6 ×4 |
| Update/analysis state | R-6 ×1 |
| XMB context (out of scope) | R-4, R-6 ×1 |
| Help screen | not captured — documented deviation in UI_SPEC §5 |
| Empty-channel state | not captured — behavior spec from R-2 only |

## Backdrop photos (not Sony assets)

All shipped in `apps/web/public/bg/`; user-provided photos added
2026-11-25 explicitly for the scene backdrops (source folder
`backgrounds/` deleted after copying; large files recompressed with
ffmpeg for web). Not Sony assets; replace with clean-room art before
distribution if licensing is unclear.

| File | Used by |
|---|---|
| `day.jpg` | default backdrop (fallback for entries without a photo) |
| `relax.jpg` | Relax |
| `energetic.jpg` | Energetic |
| `upbeat.jpg` | Upbeat |
| `mellow.jpg` | Mellow |
| `lounge.jpg` | Lounge |
| `emotional.jpg` | Emotional |
| `dance.jpg` | Dance |
| `extreme.jpg` | Extreme |
| `morning.jpg` | Morning |
| `day.jpg` | Daytime |
| `evening.jpg` | Evening |
| `night.jpg` | Night |
| `midnight.jpg` | Midnight |
| `favorite.webp` | Favourites |
| `shuffle_all.jpg` | Shuffle All |
| `new_additions.webp` | Newly Added |

2026-11-27: the ten backdrops under ~750px (`relax`, `energetic`, `mellow`,
`lounge`, `emotional`, `dance`, `extreme`, `night`, `midnight`,
`shuffle_all`) were AI-upscaled 4× with RealESRGAN x4plus (local ComfyUI)
and downsampled to 1400px wide — placeholders until final licensed art.

## Favicon

- `apps/web/public/icon.svg` — **Moodwave wave-bars mark** (2026-11-27):
  twelve spectrum-ordered bars (one per channel) rising and falling as a
  wave, using only `dotPalette` colors from `contracts/design-tokens/`,
  on a white rounded-square tile. PNGs are full-bleed white (no
  transparency — platform masks give the rounded/circular shape;
  maskable keeps the bare mark in the safe zone via `icon-mark.svg`).
  Clean-room original; concept exploration in `docs/branding/concepts/`
  (ADR-020). Source of truth: `icon.svg` + `scripts/gen-icons.mjs`.
- Historical: until 2026-11-27 the favicon was the SensMe heart-and-note
  mark supplied by the product owner (2026-11-25), a documented deviation
  from AGENTS.md §7. Removed with the rebrand; never distributed.
