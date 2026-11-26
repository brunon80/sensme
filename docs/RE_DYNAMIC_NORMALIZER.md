# SensMe Channels (NPIA00013) — "Dynamic Normalizer" Reverse-Engineering Report

Target: `EBOOT_dec.bin` / `EBOOT_patched.bin` (MIPS Allegrex, LE).
Address mapping: `file_offset = vaddr + 0xC0`.
All addresses are virtual unless noted. Confidence per claim: **[HIGH]**, **[MED]**, **[LOW]**.

---

## 0. Executive verdict

- **Hypothesis C ("sceAudiocodec VolumeHarmony") is FALSE as named.** The EBOOT imports
  exactly **5** `sceAudiocodec` functions (stub idx 159–163, stub addrs `0x14cf20–0x14cf40`),
  matching the public PSPSDK set (`CheckNeedMem / Init / Decode / GetEDRAM / ReleaseEDRAM`).
  There is **no** volume/normalization import anywhere in `.lib.stub`. [HIGH]
- **Hypothesis A (per-track `pcsd` → playback gain) is NOT implemented in the EBOOT.**
  `pcsd` appears only in the DB `INSERT` (write side). No SQL `SELECT` names it, and no code
  path from the DB/track struct to any gain control was found. [HIGH for "no EBOOT-side path";
  the column is still *written*, so it is metadata, not a playback gain here]
- **Hypothesis B (real-time AGC on PCM in the EBOOT mixer) is also NOT present.** The software
  mixer has a full per-slot volume + ramp system, but **nothing in the EBOOT ever writes a
  non-unity volume to a music slot** (default `0x1000` = unity, and the only volume call in the
  binary sets max `0x7f/0x7f`). [HIGH]
- **Conclusion:** the Dynamic Normalizer's audible effect is **not produced by EBOOT-side
  sample gain**. The EBOOT-side infrastructure that *would* carry it (per-slot volume ramp
  engine, `sceAudioOutput2ChangeVolume` wrappers) exists but is **unused for music**. The most
  plausible remaining home is the **firmware codec libraries** (sceMp3/sceAac/sceAtrac3plus via
  `sceAudiocodecInit` codec buffers, or the sceAudio driver), configured by the ON/OFF flag —
  not resolvable from the EBOOT alone. [MED]

The most valuable deliverable for the Rust reimplementation is the **complete, bit-exact
software mixer specification** (below), which is fully recovered.

---

## 1. Playback audio architecture [HIGH]

Music playback = **one `sceAudioOutput2` stream fed by a software mixer thread**.

- Mixer thread entry: `FUN_0012d5d4` (size 0x87c).
  Created in `FUN_0012c908`: `lui $a0,0x13; addiu $a1,$a0,-0x2a2c` → entry `0x12d5d4`,
  stack size `0x200`, stack buffer ~`0x762820`; thread id stored at bss (placeholder
  `0x1ef080`); exit-request flag at placeholder `0x1edde8` (checked at `0x12d5d8` via
  bss `0x9733a8`-family).
- Output: stub `0x14cdf0` called as `(handle, 0x8000, buf)` per block and `(handle, 0, 0)` on
  exit; idle filler via stub `0x14cc48(handle,1,0x20,0)`; `FUN_0014ccd0(0)` on exit.
  (sceAudioOutput2 family; exact NIDs not resolved — stubs are kernel-patched `jr $ra`
  placeholders in the static image.)
- Output buffer: bss `0x97342c`, **ping-pong two halves of 0x700 bytes** (`local_5c*0x700`).
  One block = **0x700 bytes = 448 stereo samples ≈ 10.2 ms @44.1 kHz** (matches
  `sceAudioOutput2Reserve(…, 0x1c0=448, …)` seen in `FUN_0012c7d8` @0x12c858).
- Block = **16 chunks × 0x70 bytes (28 stereo samples)**; each chunk memset to 0 before mixing
  (`jal 0x14cae0` = memset, `0x12d650`).

## 2. Mixer state (bss) [HIGH]

- **Active slots array: bss `0x97422c`, 8 slots, stride 0x40.**
  (Confirmed from resolved `lui 0x97 / addiu 0x422c` at `0x12cf20`, `0x12d174`, `0x12d470`;
  the `lui 0x1f / addiu -0x1394` pairs elsewhere are unresolved sym256 *placeholders* for the
  same bss symbol.)
- **Pending (staged) slots array: bss `0x97442c`**, same layout (resolved at `0x12cf74`,
  `0x12d0e4`, `0x12d19c`).
- Temp/scratch PCM buffer pointer: bss `0x97463c` (loaded at `0x12d7b0`).
- Slot struct (0x40 bytes), int32 fields unless noted:

| off | name | meaning |
|----|------|---------|
| 0x00 | in_ptr | source buffer pointer (0 = silent) |
| 0x04 | size | source size in bytes |
| 0x08 | volL | left volume, **0..0x1000, 0x1000 = unity** |
| 0x0c | volR | right volume, same scale |
| 0x10,0x14 | zero | init-zeroed |
| 0x18 | flags | see bit table |
| 0x1c | active | 0/1 |
| 0x20 | read_off | read offset into source |
| 0x24 | zero | |
| 0x28,0x2c | aux | copied on commit (decoder state) |
| 0x30,0x32 | aux (short×2) | ADPCM predictor/step index |
| 0x34 | gain | current envelope **0..0x7f** |
| 0x38 | ramp_int | ramp interval in **chunks** (set to **0x70** at start) |
| 0x3c | ramp_cnt | ramp counter |

Flags (slot+0x18) [HIGH]:
- `0x100`|`0x200` both set → **stereo** sample fetch; otherwise **mono** (single sample
  replicated to L/R). (mixer `0x12d890–0x12d8a0`)
- `0x400` → silent/empty slot special path in start API.
- `0x10000` → volume-change pending (commit staged vol at ramp end).
- `0x20000` → stop pending (deactivate at ramp end).
- `0x40000` → stop variant 2 (deactivate at ramp end, fewer fields committed).
- `0x100000` → **ramp active**.

Format byte (low byte of +0x18) [HIGH]: `0` = raw PCM (chunk copy 0x38/0x70),
`1` = **IMA ADPCM** decoded inline by `FUN_0012de50` (nibble/step tables at `0x77ea44`,
16-byte frames → 0x10), `2` = raw PCM mono (0x10 copy).

## 3. Exact mixing arithmetic (bit-faithful) [HIGH]

Per slot, per chunk (28 stereo samples), from disassembly `0x12d7b0–0x12da7c`:

**Envelope (once per chunk):**
```
if !(flags & 0x100000):  gain = 0x7f
else:
  interval = slot+0x38; counter = slot+0x3c
  gain = (interval - counter) * 127 / interval      # integer div (div/mflo)
  if gain < 0: gain = 0
  slot+0x34 = gain
  counter += 1; slot+0x3c = counter
  if counter >= interval:
     clear ramp bit (0x100000) and the pending-class bit:
       if flags & 0x10000:  clear 0x110000; commit pending volL/volR(+0x08/0x0c),
                           active(+0x1c), read_off, aux(+0x28/0x2c/0x30/0x32)
       elif flags & 0x20000: clear 0x120000; commit active, read_off, aux
       elif flags & 0x40000: clear 0x140000; commit active only
     counter = 0
```
Note the envelope **decreases** 0x7f→0: this is a **fade-out** (used for stop/commit dips),
not a fade-in. [HIGH]

**Per sample (stereo path `0x12d97c`; mono path `0x12d8a8` identical math):**
```
qL = (volL * gain) / 127          # magic: x*0x8102409, mfhi, +x, >>6, -sign(x)  (== trunc x/127)
qR = (volR * gain) / 127
pL = qL * sampleL                 # 32-bit mult
pL += (pL >> 31) >> 20            # if pL<0 add 0x000FFFFF  (floor-bias)
scaledL = pL >> 12                # arithmetic shift
accL = out16_existing + scaledL
t = accL + 0x7fff                 # daddu encodings 0x006c502d / 0x0062402d @0x12d940/44
if t < -0x8000: t = -0x8000       # slti + movn
out16 = (int16) t                 # sh  (no upper clamp; wraps above 0x7fff)
```
Unity check: vol=0x1000, gain=0x7f → q=0x1000 → (0x1000*sample)>>12 = sample. [HIGH]

**Anomaly (faithful-port note):** the `+0x7fff` bias before the 16-bit store is real in the
binary (Ghidra and manual decode agree). With a zeroed output buffer a full-scale +32767
sample would store as −2, and there is **no upper saturation** — the original relies on
inputs staying well inside range (or tolerates wrap). For a bit-faithful port reproduce the
sequence verbatim; for a "correct" port replace with true sat16. [HIGH on the encoding;
the audible consequence is [MED] because typical decoded PCM rarely hits full scale.]

## 4. Engine API inventory (module 0x12c080–0x12e7d0) [HIGH]

| addr | role |
|------|------|
| 0x12c7d8 | init: memset slots(0x97422c,0x200)+pending(0x97442c,0x200); `sceAudioOutput2Reserve(-1,0x1c0,0)` (stub 0x14ce00) + 3 extra channels @0x974644 |
| 0x12c908 | create mixer thread (entry 0x12d5d4) |
| 0x12ca40 | stop path (calls 0x12d174) |
| 0x12cb04 | **start slot**(idx, ptr, size≤0x180000, flags): volL=volR=**0x1000**, ramp_int=**0x70**, counter=0, read_off=0, active=0 |
| 0x12cc4c | set slot vol 7-bit **direct** (scale ×0x1000/0x7f) — unused |
| 0x12cdc0 | set slot vol 12-bit **direct** (0..0x1000) — unused |
| 0x12cef4 | set slot vol 7-bit **ramped** (0..0x7f → staged + flags|=0x110000) — only caller `0x4318c` passes **0x7f,0x7f (max)** |
| 0x12d06c | set slot vol 12-bit **ramped** — unused |
| 0x12d174 | stop-with-fade (pending.active=0, flags|=0x120000) |
| 0x12d470 | stop variant 2 (pending.active=0, flags|=0x140000) — unused |
| 0x12ce10 / 0x12ce64 / 0x12cec8 | get volume / get remaining bytes / is-active |
| 0x12d264/0x12d2cc/0x12d334 | `sceAudioOutput2` volume wrappers (stubs 0x14ce20/0x14ce30/0x14cdf8, handle table @0x97346c-family) — **unused** |
| 0x12de50 | IMA ADPCM decoder (slot format 1) |

Playback wiring: `FUN_0037918` (start orchestrator) → `FUN_0043118` → `FUN_0012c7d8` +
`FUN_0012c908` + `FUN_00431b8` (arms all 8 slots with static PCM buffers at
`0x71bb0, 0x71730, 0x72cd20, 0x734430, 0x73be00, 0x7404d0, 0x747f20, 0x751fb0`, flags=0).
Stop: `FUN_00378c4`-family → `FUN_0043164` → `FUN_0012ca40` → fade-stop.

## 5. Normalizer-specific evidence

1. **Menu wiring (SENSME.DAT):** Sound Settings = menu 5; item 1 "Dynamic Normalizer" →
   submenu 8 (ON/OFF, `MenuParam8_DefaultCheck=1`); item 2 "Sound Effects" → submenu 9.
   EBOOT contains the generic getters `MenuParam%d_DefaultCheck`, `MenuParamName%d_%d` →
   settings persist via `ms0:/PSP/SENSME/property.xml`. [HIGH]
2. **No gain consumer found:** every volume setter in the engine is either unused or called
   only with max volume. `sceAudioOutput2ChangeVolume` wrappers unused. No float constants
   resembling loudness targets exist in the playback module (0x42000–0x44000). [HIGH]
3. **pcsd:** written by analysis into `ms_tracks.pcsd` (INSERT @vaddr 0x776b04); no named
   reader; playback slot setup never consults any per-track scalar. [HIGH]
4. **sceAudiocodec:** exactly 5 imports; call sites at 0x48864 (CheckNeedMem-style, codec-type
   dispatch vs 0xc8/0xcb), 0x48b30, 0x48c7c/cc/d58, 0x49a28, 0x49b20 — standard decode flow.
   No option/volume call exists to toggle. [HIGH]

### Most probable mechanism (for the Rust port)
The ON/OFF flag is stored in `property.xml` and almost certainly passed into the **firmware
codec libraries' init/attribute path** (the `sceAudiocodecInit` codec buffer or
`sceAtrac*`/`sceMp3*`/`sceAac*` module attributes), i.e., normalization happens **inside
Sony's closed firmware codecs**, not in the game binary. The EBOOT-side ramp engine
(fade-out over `0x70` chunks ≈ 112×28 = 3136 samples ≈ **71 ms**) is the only dynamic-gain
machinery present and is used solely for stop/commit transitions. [MED]

## 6. Recommendations for the Rust reimplementation

- Port the mixer exactly (§2–§3): fixed-point `vol∈[0,0x1000]`, `gain∈[0,0x7f]`,
  `/127` via the same truncating division, `>>12` with the negative floor-bias, and the
  documented store sequence (optionally with true sat16, flagged as a deviation).
- Implement the slot/pending commit protocol and flag bits verbatim — it cleanly supports a
  future real normalizer by simply calling the (already-designed) ramped-volume API.
- Treat "Dynamic Normalizer" as a **product-level feature to design ourselves** (e.g.,
  per-track `pcsd` → ramped slot gain, or a real-time compressor on the mixed buffer);
  the original gives us the *hook* (ramp engine + pcsd column) but not the algorithm.

## 7. Open items / limits

- Stub NIDs not resolved (kernel-patched placeholders); sceAudio/sceAudiocodec function
  identities inferred from argument shapes + PSPSDK. [MED]
- The exact `property.xml` key that stores the normalizer choice and the codec-buffer field
  that would consume it are not observable from the EBOOT alone.
- `pcsd` formula (analysis side) not re-derived here; see RESEARCH_NOTES §7.4.

---

# Phase 2 — `ms_tracks.pcsd` recovery (analysis side)

Scope: recover how the per-track `pcsd` value stored in `ms_tracks.pcsd` is
produced and bound. Read-only; no files in the decomp tree were modified.
Address convention: **file offset = vaddr + 0xC0**; all addresses are vaddrs.

## P2.1 Headline result (changes the port assumption)

`ms_tracks.pcsd` is **not** the loudness scalar itself — it is a **0/1 presence
flag** derived from the scalar. The analysis-completion handler receives the
scalar as an argument and the SQL binder stores only `(scalar > 0 ? 1 : 0)`.

Evidence (HIGH confidence):
- `db_insert_track_full` @ `0x3fd74` binds column 17 (`pcsd`, bind index `0x11`)
  at `0x3ff5c`–`0x3ff68`:
  ```
  0x3ff60: sltu  $a2, $zero, $s7      ; $a2 = ($s7 > 0) ? 1 : 0   (unsigned)
  0x3ff64: addiu $a1, $zero, 0x11     ; bind index 17
  0x3ff68: jal   0x42d90              ; sqlite3_bind_int
  ```
  `$s7` is the incoming pcsd scalar (see P2.2). `sltu $zero,$s7` is exactly
  `0 < $s7`, i.e. a boolean. So the persisted column value ∈ {0,1}.

## P2.2 The pcsd scalar is an argument, not computed in the INSERT path

`db_insert_track_full` @ `0x3fd74` parameter mapping (prologue `0x3fd74`–`0x3fdd0`):

| reg in callee | source arg | column(s) bound | bind stub |
|---|---|---|---|
| `$s2` | `$a0` | sqlite stmt/db handle | — |
| `$s3` | `$a1` | col 1 `filePath` | `0x42df0` (bind_text) |
| `$s4`/`$s5` | `$a2`/`$a3` | col 2 `modifyDateTime` (lo/hi) | `0x42dc0` (bind_int64/text) |
| `$s1` | `$t0` | cols 3–15 = 13 channel bits (`ext $s1,bit,1`) | `0x42d90` (bind_int) |
| `$s6` | `$t1` | col 16 `analyzed` (status) | `0x42d90` (bind_int) |
| `$s7` | `$t2` | col 17 `pcsd` = `($s7>0)` | `0x42d90` (bind_int) |

Bind stub identities (HIGH):
- `0x42d90` → `0xb7234` (`sra $a3,$a2,0x1f` sign-extend) → `j 0xb71b4`
  = `sqlite3_bind_int64` core (`0xb71b4` → `0xb7070`). ⇒ **bind_int**.
- `0x42dc0` → `0xb71b4` directly = **bind_int64** (64-bit datetime).
- `0x42df0` → `0xb8208` = **bind_text** (filePath).

So `pcsd` is an **INTEGER** column bound via `sqlite3_bind_int`, value ∈ {0,1}.

The INSERT function does not compute the scalar; it only reduces `$t2` to a
boolean. The scalar arrives as `$t2` from the caller.

## P2.3 Two INSERT callers (scan-time vs analysis-time)

`db_insert_track_full` @ `0x3fd74` has exactly two callers (HIGH):

1. **Scan-time INSERT** @ `0x3ce38` (inside fn ~`0x3cd00`):
   ```
   0x3ce30: move $t0, $zero   ; channel bits = 0
   0x3ce34: move $t1, $zero   ; analyzed = 0
   0x3ce38: jal  0x3fd74
   0x3ce3c: move $t2, $zero   ; pcsd scalar = 0  (delay slot, runs before call)
   ```
   ⇒ row inserted with `analyzed=0, pcsd=0`.

2. **Analysis-time INSERT** @ `0x3bb1c` (inside fn `0x3b92c`):
   ```
   0x3bb0c: lw   $t1, 0x490($sp)   ; status (=2)
   0x3bb14: move $t0, $s0          ; channel bits (from 0x3ebd0)
   0x3bb18: move $t2, $fp          ; pcsd scalar  ($fp = saved $a1 of 0x3b92c)
   0x3bb1c: jal  0x3fd74
   ```
   ⇒ `analyzed=2`, `pcsd = (scalar>0)`.

There is **no** `UPDATE ms_tracks SET pcsd=…` anywhere; pcsd is written only at
INSERT (re-confirmed by string scan; only the generic
`UPDATE ms_tracks SET %s=? WHERE szTrackId=?` template exists, with the column
name formatted in at runtime).

## P2.4 How the analysis handler is reached (dispatch)

`fn 0x3b92c` (the analysis-completion INSERT handler) takes:
`$a0`=ctx, `$a1`=**pcsd scalar**, `$a2`/`$a3`/`$t0`/`$t1`=aux (often 0).
Prologue `0x3b92c`–`0x3b968` saves `$fp=$a1` (the scalar) and uses it only at
`0x3bb18` for the INSERT. It does **not** compute the scalar.

`0x3b92c` is reached only through tiny wrapper thunks that tail-jump to it while
preserving `$a1` (HIGH):
```
0x3ac8c: move $a2,$zero; move $a3,$zero; move $t0,$zero
0x3ac98: j 0x3b92c          ; (delay) move $t1,$zero
0x3aca0: j 0x3b92c
```
No direct `jal`/`j` to `0x3ac8c`/`0x3b92c` exists in the image (verified by a
full-text scan of all J-type targets). These wrappers are entries in a
`{handler_addr, type}` dispatch table at **`0x79bb70`** (entries `0x3ac98`,
`0x3aca0`, flag `4`). The table is consumed by a message-loop that matches a
message-type field against the `flag` word and tail-calls the handler with
`$a0`=ctx, `$a1`=scalar. (The second message-loop that walks this table was not
fully localized: the table base `0x79bb70` is not referenced by any `lui`/`addiu`
or stored pointer in the image, so it is reached via a computed/`$gp`-relative
base. [MED] on the table being the dispatch source; [LOW] on the exact loop.)

A *separate*, fully-resolved message-loop exists at `0x3a768` (switch on
`8($s0)` message type: 1→`0x3b114`, 2→`0x3b2f0`, 0x1000→`0x3ca08`,
0x1001→`0x3d174`, 0x1002→`0x3d88c`, 0x1007→`0x3ca00`); it does **not** invoke
the pcsd handler, confirming the pcsd INSERT is dispatched through the
`0x79bb70` table path, not this switch.

## P2.5 Where the scalar comes from (analysis pipeline) — partial

The analysis worker `0x8584` and the "ensure-result" helper `0x8ce0` build a
**result object** (0x24 bytes, alloc `0x1a2a8`, init `0xeec0`, finish `0xef10`)
and call `result_obj_finish` @ `0xef10`. That finish routine drives the analysis
DSP library (module ~`0x122000`–`0x125000`) and fills the object:

- `result_obj_finish` @ `0xef10` calls, in order: `0x14ced8`, `0x14cea0`,
  ring-init `0x2c898`, then DSP `0x1225a8`, `0x1226e4(0, buf@bss 0x8736c0, 0x10000)`,
  `0x122ea0`, ring-consume `0x2c8b4` (×3), `0x1237f4(0x1e0,0x110,ptr,0x200)`,
  `0x123970(0x110000,0x200)`, `0x124300`, `0x124208`, `0x1242ac(0x7fff,0)`, …
- The object's `param_1[4..6]` are **ring-buffer read pointers** (struct
  `{+0 base, +4 capacity, +8 read_off}`; consume `0x2c8b4` returns a pointer and
  advances `read_off`), reading 0x88000 / 0x88000 / 0x44000 bytes from the
  bss ring families. They are **not** scalars. (HIGH)
- The object exposes a **float getter** `0xf378` (`lwc1 $f0, 0x20($a0)`), and the
  updater `0xf1e4` computes that float as:
  ```
  delta = new_counter - old_counter          ; 0x1c(obj) counter
  f0    = 1e6 / (float)delta                 ; rodata 0x77d6c4 = 1e+06
  swc1  f0, 0x20(obj)
  ```
  i.e. a **rate** (µ-units per count). This is the only first-party scalar the
  result object computes; whether it is the value handed to `0x3b92c` as `$a1`
  could not be tied through the unresolved dispatcher. [LOW]

The DSP module `0x122000`–`0x125000` is a **command-driven** audio library: it
writes command words (e.g. `0x9e000000|…`, `0x9d000000`, `0xd2000000`,
`0x97…`/`0x9f…` constants) into a ring at bss `0x972a74` and consumes them
(`0x123970`, `0x1233f0`, `0x123440`). It carries sample-rate constants
(`0x8000`, `0x10000`, `0x110`, `0x1e0`) and a tuning magic
`rodata 0x1ed46c = -0.0941579`. The actual per-frame loudness accumulation and
final reduction that yields the pcsd scalar live **inside this linked DSP
library**, which is a black-box command interpreter rather than a simple
first-party accumulator loop in the EBOOT's own code.

## P2.6 What is and is not bit-recoverable

RESOLVED (HIGH):
- `pcsd` column type = INTEGER, bound via `sqlite3_bind_int` (stub `0x42d90`).
- Persisted value = `(pcsd_scalar > 0 ? 1 : 0)` (`sltu $zero,$s7` @ `0x3ff60`).
- Scalar is an argument (`$a1`→`$fp`→`$t2`) to handler `0x3b92c`; not computed
  in the INSERT path.
- Two INSERT sites: scan-time (`0x3ce38`, scalar=0, analyzed=0) and
  analysis-time (`0x3bb1c`, analyzed=2, scalar from analysis).
- No `UPDATE … pcsd`; pcsd set only at INSERT.

NOT bit-recoverable from the EBOOT alone (honest limit):
- The exact per-frame accumulator + final reduction producing the pcsd scalar:
  it is performed inside the command-driven DSP library (`0x122000`–`0x125000`),
  whose semantics are encoded as runtime command words, not static constants.
- The dispatcher that supplies `$a1` to `0x3b92c` (table `0x79bb70` consumer)
  was not localized to a specific loop.

## P2.7 Consequences for the Rust port

1. **Schema:** `ms_tracks.pcsd` is an INTEGER holding a 0/1 *presence* flag, not
   a loudness magnitude. A faithful port should store `pcsd = (loudness_scalar>0)`
   at INSERT, with `analyzed` ∈ {0 (scan), 2 (analyzed)} in the same row.
2. **Two-phase insert:** scan inserts `(analyzed=0, pcsd=0)`; the analysis pass
   inserts the analyzed row. Re-analysis must not assume an UPDATE path.
3. **Loudness math:** the scalar feeding the flag is produced by the closed
   analysis DSP (command-driven). For a clean-room reimplementation, model the
   *observable contract* (a per-track scalar whose sign drives the flag) and
   implement the loudness estimator from the Phase-1 mixer/normalizer spec and
   the DSP constants catalogued above (`-0.0941579`, rate constants, ring sizes
   0x88000/0x44000), rather than claiming a bit-exact reproduction of the
   proprietary reduction.
4. **Multiple scalars?** No. There is a single pcsd scalar argument; the
   `param_1[4..6]` triple in `result_obj_finish` is ring-buffer read pointers,
   not candidate scalars. The only first-party scalar on the result object is the
   `1e6/Δcount` rate float at `obj+0x20` (getter `0xf378`), which is a *rate*,
   not the pcsd flag source as bound.
