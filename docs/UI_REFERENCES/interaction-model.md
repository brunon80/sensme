# PSP SensMe channels — interaction model (transcribed from R-2)

Source: Sony official "Using SensMe channels" pages (archived 2011–2012).
This is the authoritative behavior spec; our implementation must preserve
it, mapping PSP buttons onto desktop/keyboard/controller/touch input
(AGENTS.md §6: input adaptation, not redesign).

## Startup / database update

- On first start or after new tracks are imported, the app updates its
  database and categorizes tracks.
- During update: an icon at the **top-left** indicates the database is
  updating; status messages such as `[Updating channels... xx/xx]` appear
  at the **bottom-left**.
- Playback of all channels is available after the update completes.

## Channels (official list, in manual order)

| # | channel | description (Sony) |
|---|---|---|
| 1 | Morning | Music for various times of the day |
| 2 | Daytime | |
| 3 | Evening | |
| 4 | Night | |
| 5 | Midnight | |
| 6 | Shuffle All | Music played in random order |
| 7 | Energetic | Uptempo and high-energy music |
| 8 | Relax | Calm and relaxing music |
| 9 | Mellow | Soft and slow-tempo music |
| 10 | Upbeat | Cheerful and uplifting music |
| 11 | Emotional | Ballads |
| 12 | Lounge | Jazz and easy listening music |
| 13 | Dance | Rhythm, rap and R & B music |
| 14 | Extreme | Loud and powerful music |
| 15 | Favourites | Tracks the user added |
| 16 | Newly Added | Recently imported tracks |

Mapping to our model: 1–5 and 7–14 are exactly our 13 classifier
channels (ADR-011). 6, 15, 16 are **utility channels** — library
functions, not classifier outputs; they must still appear in the channel
carousel in this order.

## Button map (PSP → our input semantics)

| PSP | action | desktop mapping (spec) |
|---|---|---|
| SELECT | open channel selection; directional buttons pick a channel | `C` / left-click channel strip |
| ← → (directional) | move through the channel carousel | ← → keys, L/R shoulder, drag |
| START | play / resume; press again pauses | Space / click artwork |
| L / R | previous / next track | , and . keys, L1/R1 |
| ↑ (while playing) | add current track to Favourites | `F` key |
| ↓ | remove from Favourites; **hold** = add to block list | `Shift+F` / hold `B` |
| △ (triangle) | options menu | `O` key / right-click |
| ✕ (cross) | back (from channel selection / menus) | Esc |
| ◯ (circle) | select (channel) | Enter |
| PS/HOME | quit | window close |

## Options menu (△)

- **View Settings**: Time and Battery (ON/OFF, top-right); Button Caption
  (ON/OFF, bottom-left).
- **Sound Settings**: Dynamic Normalizer (ON/OFF); Sound Effects — key
  tones on channel/menu operations (ON/OFF).
- **Favourites Setting**: delete all favourites.
- **Block List Settings**: delete all blocked tracks.
- **Help**: operation information.
- **Check for Updates**: (network; we replace with "check for app
  updates" — optional, offline-first default OFF).
- **About SensMe channels**: trademark info.

## Behavior rules (hints section)

- Each channel selection varies the play order (per-selection shuffle).
- Channels with no tracks cannot be selected.
- A track may belong to several channels.
- Block list: blocked tracks never play; cannot block a favourite or the
  only track in a channel; block list inactive inside Favourites.
- Favourites: ↑ adds, ↓ removes the playing track.

## Persistent screen furniture

- **Top-right**: clock + battery (toggleable). Our desktop: clock only
  (battery when on laptops).
- **Top-left**: database-update indicator (during analysis).
- **Bottom-left**: button captions (toggleable) and status messages.
- **Background**: dark field of colored bokeh dots (upper area) with a
  reflective floor beneath the tiles/artwork (measured in UI_SPEC from
  R-6 once provided).
