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
| R-6 | **Product-owner screenshots** (PSP captures) | pending — provided by user | high-resolution captures of every screen; primary source for palette, typography, spacing, animation timing |

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

## Pending references (needed from R-6)

1. Channel selection at rest + mid-transition (to measure animation).
2. Now-playing (idle and with track info).
3. Options menu (△).
4. Help screen.
5. "Updating channels… xx/xx" status state.
6. Empty-channel / no-music state.
