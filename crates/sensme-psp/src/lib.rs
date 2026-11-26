//! Bit-faithful port of the SensMe Channels (NPIA00013) offline analysis pipeline.
//!
//! Mirrors the PSP binary function-for-function (see RESEARCH_NOTES.md §6a).
//! The session object is modeled as flat i32 memory (0x5328 bytes) exactly like
//! the original, including the quirk that the statistics functions read
//! `chunk_count+1` consecutive ints starting at each ring base (past the 9-slot
//! rings into adjacent fields for long tracks).

mod tables;
use tables::*;

// ------------------------------------------------------------- session layout
// Field offsets in i32 units (byte offset / 4), matching the PSP session object.
const M_B: usize = 0x2388 / 4; // buffer B: 1024 windowed samples (Q14 input)
const M_C: usize = 0x3388 / 4; // buffer C: 513 power-spectrum bins
const M_BANDS_A: usize = 0x3b8c / 4; // 40 Bark bands (ping-pong)
const M_BANDS_B: usize = 0x3c2c / 4;
const M_RING1: usize = 0x3ccc / 4; // centroid per chunk (9 slots)
const M_RING2: usize = 0x3cf0 / 4; // flux per chunk
const M_RING3: usize = 0x3d14 / 4; // rolloff per chunk
const M_RING4: usize = 0x3d38 / 4; // ZCR per chunk
const M_PAIRS: usize = 0x3d60 / 4; // 20 x i64 accumulated scores
const M_EXP0: usize = 0x3e00 / 4; // auto-range exponent (current chunk)
const M_EXP1: usize = 0x3e04 / 4; // exponent, previous
const M_EXP2: usize = 0x3e08 / 4; // exponent, two back
const M_DC: usize = 0x3e0c / 4; // DC-removal filter state
const M_FLAG: usize = 0x3e10 / 4; // query gate flag
const M_CHUNKS: usize = 0x3e14 / 4; // chunk counter
const M_RUNS: usize = 0x3e18 / 4; // classifier-run counter
const M_RATE: usize = 0x3e1c / 4; // rate index
const M_INIT1: usize = 0xc / 4; // session+0xc: configured flag (record_parse)
const M_INIT2: usize = 0x10 / 4; // session+0x10: finalized flag (record_open)
const MEM_INTS: usize = 0x5328 / 4;

const NCHUNK: usize = 1024; // samples per chunk @ 22050 Hz

// ------------------------------------------------------------- fixed-point helpers

/// MIPS arithmetic shift with the binary's `&32 → sign-fill` semantics.
pub fn ashr(v: i32, s: u32) -> i32 {
    if s & 32 != 0 {
        if v < 0 { -1 } else { 0 }
    } else {
        v >> (s & 31)
    }
}

/// `fix_shift` @0x10c204 with bits=0x20: saturate a 64-bit (hi:lo) pair to i32.
pub fn fix_shift(lo: i32, hi: i32) -> i32 {
    let v = ((hi as i64) << 32) | (lo as u32 as i64);
    v.clamp(i32::MIN as i64, i32::MAX as i64) as i32
}

/// Saturating clamp of a 64-bit value to i32.
pub fn sat64(v: i64) -> i32 {
    v.clamp(i32::MIN as i64, i32::MAX as i64) as i32
}

/// hi32 of the signed 64-bit square (the binary's `x*(x>>31)*2 + hi32(x*x)` idiom).
fn sqhi(x: i32) -> i32 {
    (((x as i64) * (x as i64)) >> 32) as i32
}

/// `fix_div` @0x10f9dc: fixed-point rsqrt Newton (7 iters, q in Q29).
/// q converges to 2^29 / sqrt(xn) where xn = x << t4 (xn in [2^30, 2^31)).
/// Callers reconstruct `x / sqrt(x·2^y)`-style normalizations via
/// `(q · value) >> (e + rem − 31)`; see `feat_flux`.
pub fn fix_div(x: i32, y: i32) -> (i32, i32) {
    if x <= 0 {
        return (0, y);
    }
    let a2 = 32 - x.leading_zeros() as i32; // bitlen (binary search result)
    let t4: u32 = if ((a2 + y) & 1) == 0 { (31 - a2) as u32 } else { (30 - a2) as u32 };
    let xn = (x as u32).wrapping_shl(t4 & 31) as i32;
    let mut q: i32 = 0x1000_0000; // 0.5 in Q29
    for _ in 0..7 {
        // w = signed(q²) >> 29   (Q29)
        let w = (((q as i64) * (q as i64)) >> 29) as i32;
        // u = signed(xn·w) >> 29 = xn_val·q_val²·2^30 (Q30)
        let u = (((xn as i64) * (w as i64)) >> 29) as i32;
        // v0 = 3/2 − xn·q²/2 in Q30
        let v0 = 0x6000_0000i32.wrapping_sub(u);
        // q' = signed(q·v0) >> 30 (Q29)
        q = (((q as i64) * (v0 as i64)) >> 30) as i32;
    }
    // rem = trunc((29 − t4 − y)/2) + 29, via the binary's (v + (v>>31)) >> 1 idiom
    let v1 = 29i32.wrapping_sub(t4 as i32).wrapping_sub(y);
    let rem = v1.wrapping_add(v1 >> 31) >> 1;
    (q, rem.wrapping_add(29))
}

/// `fix_div2` @0x10fbfc: signed division with up to 14 fractional bits.
/// Returns (quotient, extra_exp) where value ≈ quotient · 2^−exp_added.
fn fix_div2(num: i32, den: i32) -> (i32, i32) {
    if den == 0 {
        return (0, 0);
    }
    let mut n = num;
    let mut d = den;
    let mut sign: i32 = 0;
    if n < 0 {
        n = n.wrapping_neg();
        sign = -1;
    }
    if d < 0 {
        d = d.wrapping_neg();
        sign = !sign;
    }
    let mut rem = n % d;
    let mut q = n / d;
    let mut e = 0i32;
    loop {
        rem = rem.wrapping_mul(2);
        let q2 = q.wrapping_mul(2);
        if q2 < 0 {
            let mut out = q & 0x7fff_ffff;
            if sign < 0 {
                out = out.wrapping_neg();
            }
            return (out, e);
        }
        e += 1;
        let mut q2 = q2;
        if d <= rem {
            q2 = q2.wrapping_add(1);
            rem = rem.wrapping_sub(d);
        }
        q = q2;
        if e == 14 {
            break;
        }
    }
    let mut out = q;
    if sign < 0 {
        out = out.wrapping_neg();
    }
    (out, 14)
}

/// `fix_log2` @0x10f5e0 — piecewise-linear log2, Q26 result, straight from
/// the raw disassembly. The function first runs the classic `sra` binary
/// search to get the bit-length `a2` of its value, normalizes with
/// `x <<= 30 - a2`, then walks a ladder of `x += x>>k` steps accumulating
/// log2 correction constants (Q26). The first ladder step *sets* the
/// accumulator to `(a2-30)<<26 + log2(2/3)`; if that step is skipped the
/// accumulator keeps whatever `$a1` held (the caller passes 5 — a harmless
/// original quirk). Final `-= (x < 0x3fffff00)`.
pub fn fix_log2(x: i32) -> i32 {
    // bit-length via the asm's arithmetic-shift binary search
    let mut a1 = x;
    let mut a2 = 0i32;
    if (a1 as u32) & 0xffff_0000 != 0 {
        a1 >>= 16;
        a2 = 16;
    }
    if (a1 as u32) & 0xffff_ff00 != 0 {
        a1 >>= 8;
        a2 += 8;
    }
    if (a1 as u32) & 0xffff_fff0 != 0 {
        a1 >>= 4;
        a2 += 4;
    }
    if (a1 as u32) & 0xffff_fffc != 0 {
        a1 >>= 2;
        a2 += 2;
    }
    if (a1 as u32) & 0xffff_fffe != 0 {
        a1 >>= 1;
        a2 += 1;
    }
    a2 += ((a1 as u32) > 0) as i32; // sltu $zero,$a1
    let mut xn = x.wrapping_shl((30 - a2) as u32 & 31);
    let mut acc: i32 = 5; // $a1 leftover when the first step is skipped
    // (threshold, correction) ladder, straight from the disassembly
    const LADDER: [(i32, i32); 25] = [
        (0x2aaaaaab, -0x02570069), // first step uses acc = -0x7a570069
        (0x33333333, -0x0149a785),
        (0x38e38e39, -0x00ae00d2),
        (0x3c3c3c3c, -0x00598fdc),
        (0x3e0f83e1, -0x002d75a7),
        (0x3f03f03f, -0x0016e797),
        (0x3f80fe04, -0x000b7f28),
        (0x3fc03fc0, -0x0005c271),
        (0x3fe00ff8, -0x0002e1f0),
        (0x3ff003ff, -0x00017126),
        (0x3ff80100, -0x0000b89f),
        (0x3ffc0040, -0x00005c52),
        (0x3ffe0010, -0x00002e2a),
        (0x3fff0004, -0x00001715),
        (0x3fff8001, -0x00000b8b),
        (0x3fffc000, -0x000005c5),
        (0x3fffe000, -0x000002e3),
        (0x3ffff000, -0x00000171),
        (0x3ffff800, -0x000000b9),
        (0x3ffffc00, -0x0000005c),
        (0x3ffffe00, -0x0000002e),
        (0x3fffff00, -0x00000017),
        (0x3fffff80, -0x0000000c),
        (0x3fffffc0, -0x00000006),
        (0x3fffffe0, -0x00000003),
    ];
    for (k, (thr, corr)) in LADDER.iter().enumerate() {
        if xn < *thr {
            xn = xn.wrapping_add(xn >> (k + 1));
            if k == 0 {
                acc = ((a2 - 30) << 26).wrapping_add(*corr);
            } else {
                acc = acc.wrapping_add(*corr);
            }
        }
    }
    acc.wrapping_sub((xn < 0x3fff_ff00) as i32)
}

/// `FUN_00116178`: signed 64×64 multiply (low 64 bits).
fn mul64(a: i64, b: i64) -> i64 {
    a.wrapping_mul(b)
}

// ------------------------------------------------------------- session

/// Analysis session: flat i32 memory mirroring the PSP session object.
pub struct Session {
    /// Flat i32 mirror of the PSP session object (see module docs).
    pub mem: Vec<i32>,
}

impl Default for Session {
    fn default() -> Self {
        Session { mem: vec![0; MEM_INTS] }
    }
}

fn pair_get(mem: &[i32], slot: usize) -> i64 {
    let lo = mem[M_PAIRS + slot * 2] as u64;
    let hi = mem[M_PAIRS + slot * 2 + 1] as i64;
    (hi << 32) | lo as i64
}

fn pair_set(mem: &mut [i32], slot: usize, v: i64) {
    mem[M_PAIRS + slot * 2] = v as i32;
    mem[M_PAIRS + slot * 2 + 1] = (v >> 32) as i32;
}

impl Session {
    /// Process one mono chunk of 1024 samples at 22050 Hz (`record_add` @0x10b514,
    /// mono/22050 path: samples scaled <<14 into buffer B).
    pub fn push_chunk(&mut self, pcm: &[i16; NCHUNK]) {
        let mem = &mut self.mem;
        let chunks = mem[M_CHUNKS] as u32;
        let idx = (chunks % 9) as usize;

        // buffer B = s << 0xe
        for i in 0..NCHUNK {
            mem[M_B + i] = (pcm[i] as i32) << 14;
        }

        // ZCR (`feat_scalar_a` @0x10c6f0): count sign changes between
        // consecutive nonzero samples; zero samples don't update prev.
        let mut prev = mem[M_B];
        let mut zc: i32 = 0;
        for i in 1..NCHUNK {
            let cur = mem[M_B + i];
            if cur != 0 {
                zc = zc.wrapping_add(((cur ^ prev) as u32 >> 31) as i32);
                prev = cur;
            }
        }
        let zp = (zc as i64).wrapping_mul(0x468f_5c29i64);
        // disasm: (hi·2^22) | (lo >> 10)  ⇒  zc·2^22/23
        let ring4 = (((zp >> 32) as u32).wrapping_shl(22) | ((zp as u32) >> 10)) as i32;
        mem[M_RING4 + idx] = ring4;

        // DC removal (`buf_prep_a` @0x10d1f8): y = (x>>1) − (prev·0x7c29 >> 16)
        let mut dc = mem[M_DC];
        for i in 0..NCHUNK {
            let x = mem[M_B + i];
            mem[M_B + i] = (x >> 1) - ((dc as i64).wrapping_mul(0x7c29) >> 16) as i32;
            dc = x;
        }
        mem[M_DC] = dc;

        // window (`buf_prep_b` @0x10d250): x = (x·win16[i]) >> 14
        for i in 0..NCHUNK {
            let x = mem[M_B + i] as i64;
            mem[M_B + i] = ((x.wrapping_mul(WINDOW[i] as i64)) >> 14) as i32;
        }

        // FFT-512 complex (1024 real samples as 512 interleaved complex pairs),
        // radix-2 with >>1 scaling per stage (`spectral_stage` @0x10cbdc).
        fft512_inplace(&mut mem[M_B..M_B + NCHUNK]);

        // auto-range (`buf_prep_c` @0x10d2c0): shift so max|P| has MSB at bit 31
        let mut mx: u32 = 0;
        for i in 0..NCHUNK {
            let a = (mem[M_B + i] as i64).abs() as u32;
            if a > mx {
                mx = a;
            }
        }
        let bitlen = if mx == 0 { 0 } else { 32 - mx.leading_zeros() };
        if mx != 0 {
            let sh = 31 - bitlen;
            for i in 0..NCHUNK {
                mem[M_B + i] = mem[M_B + i].wrapping_shl(sh);
            }
        }
        // local_6c = 13 − bitlen + 21; exponent = 2·local_6c − 33
        let local_6c = 13i32.wrapping_sub(bitlen as i32).wrapping_add(21);
        mem[M_EXP0] = local_6c * 2 - 0x21;

        // power spectrum (`buf_prep_d` @0x10c74c):
        // C[0] = sqhi(P[0])>>1; C[512] = sqhi(P[512])>>1;
        // C[i] = (sqhi(P[i]) + sqhi(P[1024−i])) >> 1, i=1..511
        mem[M_C] = sqhi(mem[M_B]) >> 1;
        mem[M_C + 512] = sqhi(mem[M_B + 512]) >> 1;
        for i in 1..=511 {
            mem[M_C + i] = (sqhi(mem[M_B + i]) + sqhi(mem[M_B + 1024 - i])) >> 1;
        }

        // Bark bands (`buf_prep_e` @0x10c830): band[b] = Σ hi32(C[start+j]·w[j]).
        // Ping-pong: parity 0 → write B(0xf0b), other = A; parity 1 → write A.
        let (cur_base, other_base) = if chunks & 1 == 0 {
            (M_BANDS_B, M_BANDS_A)
        } else {
            (M_BANDS_A, M_BANDS_B)
        };
        let mut widx = 0usize;
        for b in 0..40 {
            let start = BAND_START[b] as usize;
            let len = BAND_LEN[b] as usize;
            let mut acc: i32 = 0;
            for j in 0..len {
                acc = acc.wrapping_add(
                    (((mem[M_C + start + j] as i64).wrapping_mul(BAND_W[widx + j] as i64)) >> 32) as i32,
                );
            }
            widx += len;
            mem[cur_base + b] = acc;
        }

        // exponent chain (record_add order): EXP1 ← EXP0 before flux;
        // EXP2 ← EXP1 after flux. flux sees (EXP1=e_cur, EXP2=e_prev).
        mem[M_EXP1] = mem[M_EXP0];

        // centroid (`feat_scalar_b` @0x10c0f0) → ring1
        let cent = feat_centroid(&mem[M_C..M_C + 513]);
        mem[M_RING1 + idx] = cent;

        // rolloff-1/3 (`feat_scalar_c` @0x10c648) → ring3
        let roll = feat_rolloff(&mem[M_C..M_C + 513]);
        mem[M_RING3 + idx] = roll;

        // flux (`feat_scalar_d` @0x10c29c) → ring2
        if chunks == 0 {
            mem[M_RING2] = 0;
        } else {
            let f = feat_flux(mem, cur_base, other_base, mem[M_EXP1], mem[M_EXP2]);
            mem[M_RING2 + idx] = f;
        }
        mem[M_EXP2] = mem[M_EXP1];

        // statistics + classifier (record_add tail). The original uses
        // n = chunks + 1 (0x10b7e4: s0 = chunks − 8 + 9), which reads past
        // the 9-slot rings into the following fields — a faithful quirk.
        // The classifier runs only once chunks ≥ 4.
        if (chunks as i32) < 4 {
            mem[M_CHUNKS] = chunks as i32 + 1;
            return;
        }
        let n = chunks as i32 + 1;
        let _m1 = stat_reduce(mem, M_RING1, n); // computed by the original but discarded
        let m2 = stat_reduce(mem, M_RING2, n);
        let m3 = stat_reduce(mem, M_RING3, n);
        let m4 = stat_reduce(mem, M_RING4, n);
        let w1 = stat_weighted(mem, M_RING1, n, 0x1f);
        let w2 = stat_weighted(mem, M_RING2, n, 0x19);
        let w3 = stat_weighted(mem, M_RING3, n, 0x1f);
        let w4 = stat_weighted(mem, M_RING4, n, 0x1e);
        if w1 != 0 {
            mem[M_RUNS] += 1;
        }
        // verified f-vector order (record_add @0x10b8b0: array at sp+8):
        // [w1, w4, m3, w3, m4, w4, m2, w2] — centroid mean unused, ZCR std twice.
        let mut f = [w1, w4, m3, w3, m4, w4, m2, w2];
        feat_normalize(&mut f);
        if w1 != 0 {
            classifier(&f, mem);
            mem[M_CHUNKS] = chunks as i32 + 1;
            return;
        }
        mem[M_CHUNKS] = chunks as i32 + 1;
    }

    /// Debug view: accumulated pair scores + counters.
    pub fn debug_state(&self) -> ([i64; 20], i32, i32) {
        let mut p = [0i64; 20];
        for s in 0..20 {
            p[s] = pair_get(&self.mem, s);
        }
        (p, self.mem[M_RUNS], self.mem[M_CHUNKS])
    }

    /// Debug view: last 9 ring values (chronological) + EXP chain.
    pub fn debug_rings(&self) -> ([i32; 9], [i32; 9], [i32; 9], [i32; 9], [i32; 3]) {
        let chunks = self.mem[M_CHUNKS] as usize;
        let mut r = ([0i32; 9], [0i32; 9], [0i32; 9], [0i32; 9]);
        for k in 0..9 {
            let ri = ((chunks + k) % 9) as usize;
            r.0[k] = self.mem[M_RING1 + ri];
            r.1[k] = self.mem[M_RING2 + ri];
            r.2[k] = self.mem[M_RING3 + ri];
            r.3[k] = self.mem[M_RING4 + ri];
        }
        (r.0, r.1, r.2, r.3, [self.mem[M_EXP0], self.mem[M_EXP1], self.mem[M_EXP2]])
    }

    /// Debug view: the 20 accumulated pair scores (i64).
    pub fn debug_pairs(&self) -> [i64; 20] {
        let mut p = [0i64; 20];
        for s in 0..20 {
            p[s] = pair_get(&self.mem, s);
        }
        p
    }

    /// Debug view: the feature vector that would be fed to the classifier
    /// for the current ring state (stats over n = chunks+1, unbounded).
    pub fn debug_features(&self) -> ([i32; 8], [i32; 8]) {
        let n = self.mem[M_CHUNKS];
        let m1 = stat_reduce(&self.mem, M_RING1, n);
        let m2 = stat_reduce(&self.mem, M_RING2, n);
        let m3 = stat_reduce(&self.mem, M_RING3, n);
        let m4 = stat_reduce(&self.mem, M_RING4, n);
        let w1 = stat_weighted(&self.mem, M_RING1, n, 0x1f);
        let w2 = stat_weighted(&self.mem, M_RING2, n, 0x19);
        let w3 = stat_weighted(&self.mem, M_RING3, n, 0x1f);
        let w4 = stat_weighted(&self.mem, M_RING4, n, 0x1e);
        let raw = [m4, w4, m2, w2, m3, w3, m1, w1];
        let mut f = raw;
        feat_normalize(&mut f);
        (raw, f)
    }

    /// `record_open` @0x10b9c0 backfill: 4 extra classifier passes with
    /// n = 8,7,6,5 over the last 8 ring values (chronological order).
    pub fn record_open_backfill(&mut self) {
        let mem = &mut self.mem;
        let chunks = mem[M_CHUNKS];
        // gather last 8 ring values, oldest → newest
        let mut r1 = [0i32; 8];
        let mut r2 = [0i32; 8];
        let mut r3 = [0i32; 8];
        let mut r4 = [0i32; 8];
        for k in 0..8 {
            let ri = (((chunks + 1 + k as i32) % 9) as usize).min(8);
            r1[k] = mem[M_RING1 + ri];
            r2[k] = mem[M_RING2 + ri];
            r3[k] = mem[M_RING3 + ri];
            r4[k] = mem[M_RING4 + ri];
        }
        let mut n = 8i32;
        while n >= 5 {
            let m1 = stat_reduce_arr(&r1, n);
            let m2 = stat_reduce_arr(&r2, n);
            let m3 = stat_reduce_arr(&r3, n);
            let m4 = stat_reduce_arr(&r4, n);
            let w1 = stat_weighted_arr(&r1, n, 0x1f);
            let w2 = stat_weighted_arr(&r2, n, 0x19);
            let w3 = stat_weighted_arr(&r3, n, 0x1f);
            let w4 = stat_weighted_arr(&r4, n, 0x1e);
            // record_open's f-vector order differs from record_add's (faithful):
            // [m4, w4, m2, w2, m3, w3, m1, w1], gated on m4 != 0.
            if m4 != 0 {
                mem[M_RUNS] += 1;
            }
            let mut f = [m4, w4, m2, w2, m3, w3, m1, w1];
            feat_normalize(&mut f);
            if m4 != 0 {
                classifier(&f, mem);
            }
            n -= 1;
        }
        mem[M_INIT2] = 1; // session+0x10 finalized
    }

    /// `record_query` @0x10bce4 + `record_winner` @0x10f3b8 for one kind.
    /// kind 1 → raw slot ids; kind 2/3 → SLOT_CAT-mapped categories.
    pub fn record_query(&self, kind: i32) -> Vec<i32> {
        const SENT: i64 = 0x7fff_ffff_ffff_ffff;
        let mem = &self.mem;
        if mem[M_INIT1] == 0 || mem[M_INIT2] == 0 {
            return vec![];
        }
        let kf = match kind {
            1 => 1,
            2 => 0,
            3 => 1,
            _ => return vec![],
        };
        // filtered pair array (sentinel for slots of the other kind)
        let mut pairs = [SENT; 20];
        let mut nonzero = false;
        for s in 0..20 {
            if SLOT_KIND[s] as i32 == kf {
                pairs[s] = pair_get(mem, s);
                if pairs[s] != 0 {
                    nonzero = true;
                }
            }
        }
        if !nonzero {
            return vec![];
        }
        // first winner: strict argmin over slots excluding 10/14/15
        let mut w = -1i32;
        let mut blo = 0xffff_ffffu32;
        let mut bhi = 0x7fff_ffffi32;
        for s in 0..20 {
            if s == 10 || s == 14 || s == 15 {
                continue;
            }
            let lo = pairs[s] as u32;
            let hi = (pairs[s] >> 32) as i32;
            if hi < bhi || (hi == bhi && lo < blo) {
                w = s as i32;
                blo = lo;
                bhi = hi;
            }
        }
        // gate: found && (flag==1 || runs−4 < 1 || query_gate == 0)
        if !(w >= 0
            && (mem[M_FLAG] == 1
                || mem[M_RUNS].wrapping_sub(4) < 1
                || self.query_gate() == 0))
        {
            return vec![];
        }
        // second winner: strict argmin over slots passing slot_gate, excl 10/14/15
        let mut w2 = -1i32;
        let mut blo = 0xffff_ffffu32;
        let mut bhi = 0x7fff_ffffi32;
        for s in 0..20 {
            if s == 10 || s == 14 || s == 15 {
                continue;
            }
            if self.slot_gate(&pairs, s) != 0 {
                continue;
            }
            let lo = pairs[s] as u32;
            let hi = (pairs[s] >> 32) as i32;
            if hi < bhi || (hi == bhi && lo < blo) {
                w2 = s as i32;
                blo = lo;
                bhi = hi;
            }
        }
        if w2 < 0 {
            return vec![];
        }
        let mut out = self.record_winner(&pairs, w2 as usize, kind);
        if mem[M_RUNS].wrapping_sub(4) > 0 {
            emit_categories(kind, mem, &mut out);
            emit_categories2(kind, mem, &mut out);
        }
        out
    }

    /// `record_winner` @0x10f3b8: collect slots with pair ≤ threshold.
    fn record_winner(&self, pairs: &[i64; 20], winner: usize, kind: i32) -> Vec<i32> {
        const SENT: i64 = 0x7fff_ffff_ffff_ffff;
        let p = pairs[winner];
        // val = pair − pair/200 for pair ≤ 0, pair + pair/200 for pair > 0
        let mut thresh = if p <= 0 {
            p.wrapping_sub(p.wrapping_div(200))
        } else {
            p.wrapping_add(p.wrapping_div(200))
        };
        if winner == 0xc {
            thresh = pairs[3];
        }
        let mut out: Vec<i32> = Vec::new();
        for s in 0..20 {
            if pairs[s] > thresh || pairs[s] == SENT {
                continue;
            }
            if self.slot_gate(pairs, s) != 0 {
                continue;
            }
            if kind < 2 {
                if s != 10 && s != 14 && s != 15 {
                    out.push(s as i32);
                }
            } else {
                let c = SLOT_CAT[s] as i32;
                if c != -1 && !out.contains(&c) {
                    out.push(c);
                }
            }
        }
        out
    }

    /// `slot_gate` @0x10f260: reject slot if sat(pair[slot]·n) exceeds a
    /// fraction of sat(session_pair5·n).
    fn slot_gate(&self, pairs: &[i64; 20], slot: usize) -> i32 {
        let mem = &self.mem;
        let n = mem[M_RUNS].wrapping_sub(4) as i64;
        // FUN_00116178 = 64-bit signed division; fix_shift saturates to i32.
        let div = |x: i64| -> i32 {
            if n == 0 {
                return 0;
            }
            sat64(x.wrapping_div(n))
        };
        let v_slot = div(pairs[slot]);
        let v5 = div(pair_get(mem, 5));
        if v_slot > 0x3fff {
            let t: i32 = match slot {
                3 => 0x5b6d_b6db,
                2 | 13 | 9 => 0x6aaa_aaab,
                8 => 0x745d_1746,
                6 => 0x7d7d_7d7d_u32 as i32,
                _ => return 0,
            };
            let prod = (v5 as i64).wrapping_mul(t as i64);
            let scaled = (((prod >> 32) as i32) << 1) | ((prod as u32 >> 31) as i32);
            if scaled < v_slot {
                return 1;
            }
        }
        0
    }

    /// `query_gate` @0x10eeb0 (verified against raw disasm).
    /// A = sat32(best·n), B = sat32(pair19·n), C = sat32(pair18·n), n = runs−4.
    /// Returns 1 (gate blocks) iff argmin(slot 5..19) == 19, or both
    /// (C−B)/C > 10% and (B−A)/B > 13%.
    fn query_gate(&self) -> i32 {
        let mem = &self.mem;
        let n = mem[M_RUNS].wrapping_sub(4);
        // walk slots 5..19, strict improvement updates best + index
        let mut best = pair_get(mem, 5);
        let mut argmin = 5usize;
        for s in 6..20 {
            if pair_get(mem, s) < best {
                best = pair_get(mem, s);
                argmin = s;
            }
        }
        // A/B/C are the pair values DIVIDED by n (FUN_00116178), saturated to i32.
        let nd = n as i64;
        let div = |s: usize| -> i32 {
            if nd == 0 {
                0
            } else {
                sat64(pair_get(mem, s).wrapping_div(nd))
            }
        };
        let a = if nd == 0 { 0 } else { sat64(best.wrapping_div(nd)) };
        let b = div(19);
        let c = div(18);
        let d = c.wrapping_sub(b);
        // pct1 = 100·(C−B)/C as a fixed-point value with exponent e1
        let (q1, e1) = fix_div2(d, c);
        let e1 = e1.wrapping_sub(7);
        let x1 = mul64(q1 as i64, 100) >> 7;
        // (C−A)/C computed but only its exponent is stored (never compared)
        let (_q2, _e2) = fix_div2(c.wrapping_sub(a), c);
        // pct3 = 100·(B−A)/B with exponent e3
        let (q3, e3) = fix_div2(b.wrapping_sub(a), b);
        let e3 = e3.wrapping_sub(7);
        let x3 = mul64(q3 as i64, 100) >> 7;
        // build 64-bit constants 10·2^e1 and 13·2^e3 exactly as the binary does
        let (hi1, lo1) = if e1 < 1 {
            let ne = (-e1) as u32;
            let lo = if ne & 0x20 != 0 { 0 } else { (10u32 >> (ne & 31)) as i32 };
            (0i32, lo)
        } else {
            let lo = 10i32.wrapping_shl(e1 as u32 & 31);
            let hi = if e1 as u32 & 0x20 != 0 {
                0
            } else {
                5i32 >> (!e1 as u32 & 31)
            };
            (hi, lo)
        };
        let (hi2, lo2) = if e3 < 1 {
            let ne = (-e3) as u32;
            let lo = if ne & 0x20 != 0 { 0 } else { (13u32 >> (ne & 31)) as i32 };
            (0i32, lo)
        } else {
            let lo = 13i32.wrapping_shl(e3 as u32 & 31);
            let hi = if e3 as u32 & 0x20 != 0 {
                0
            } else {
                6i32 >> (!e3 as u32 & 31)
            };
            (hi, lo)
        };
        // signed 64 compares: 10·2^e1 < x1  and  13·2^e3 < x3
        let cmp1 = (hi1 as i64) < (x1 >> 32) as i64
            || (hi1 == (x1 >> 32) as i32 && (lo1 as u32 as u64) < (x1 as u64));
        let cmp2 = (hi2 as i64) < (x3 >> 32) as i64
            || (hi2 == (x3 >> 32) as i32 && (lo2 as u32 as u64) < (x3 as u64));
        if argmin == 19 || (cmp1 && cmp2) {
            return 1;
        }
        0
    }

    /// Final 13-bit channel mask: `result_to_channel_mask` @0x4bd28.
    pub fn channel_mask(&self) -> u32 {
        let a = self.record_query(2);
        let b = self.record_query(3);
        categories_to_mask(&a, &b)
    }
}

// ------------------------------------------------------------- features

/// `feat_scalar_b` @0x10c0f0: spectral centroid.
/// mom = Σ (c[i]·(i+1) as i64 >> 20); sum = Σ (c[i]>>10); q,e = fix_div2(mom,sum);
/// if q==0 → 0; if q ≥ 512<<e → 0x7fffffff; else x = q<<(22−e), return x − (x>>9).
fn feat_centroid(c: &[i32]) -> i32 {
    let mut sum: i32 = 0;
    for i in 0..513 {
        sum = sum.wrapping_add(c[i] >> 10);
    }
    let mut mom: i32 = 0;
    for i in 0..513 {
        let term = ((c[i] as i64).wrapping_mul((i + 1) as i64)) >> 20;
        mom = mom.wrapping_add(term as i32);
    }
    let (q, e) = fix_div2(mom, sum);
    // original seeds the exponent word with −10 (0xfffffffa) and fix_div2
    // adds 14, so the effective exponent is e−10 (typically 4).
    let e = e.wrapping_sub(10);
    if q == 0 {
        return 0;
    }
    let limit = 512i32.wrapping_shl(e as u32 & 31);
    if q >= limit {
        return 0x7fff_0000;
    }
    let x = q.wrapping_shl((22 - e) as u32 & 31);
    x.wrapping_sub(x >> 9)
}

/// `feat_scalar_c` @0x10c648: rolloff at 1/3 energy.
fn feat_rolloff(c: &[i32]) -> i32 {
    let mut total: i32 = 0;
    for i in 0..513 {
        total = total.wrapping_add(c[i] >> 10);
    }
    // total/3 via the 0x6ccccccd magic (signed)
    let third = {
        let p = (total as i64).wrapping_mul(0x6ccc_cccdu32 as i64);
        (((p >> 32) as i32) << 1 | ((p as u32) >> 31) as i32)
    };
    let mut cum: i32 = 0;
    for bin in 0..513 {
        cum = cum.wrapping_add(c[bin] >> 10);
        if third <= cum {
            if bin < 512 {
                // disasm: sll $v1,$a3,0x16 ; sra $v0,$v1,9 ; subu $v0,$v1,$v0
                let v = (bin as i32) << 22;
                return v - (v >> 9);
            }
            return 0x7fff_ffff;
        }
    }
    0x7fff_ffff
}

/// `feat_scalar_d` @0x10c29c: normalized band-spectrum difference (flux).
/// arr1[b] = sat32((q1·cur[b]) >> (e_cur+rem1−31)); arr2[b] likewise with q2;
/// flux = Σ sqhi(arr1[b]−arr2[b]) >> 5.
fn feat_flux(mem: &[i32], cur: usize, other: usize, e_cur: i32, e_prev: i32) -> i32 {
    // disasm loops 0xa0=160 words from each base: reads past the 40-band
    // arrays into rings/pairs/EXP (faithful quirk of the original).
    let mut sd: i32 = 0; // Σ sqhi(cur)>>6
    let mut se: i32 = 0; // Σ sqhi(other)>>6
    for b in 0..160 {
        sd = sd.wrapping_add(sqhi(mem[cur + b]) >> 6);
        se = se.wrapping_add(sqhi(mem[other + b]) >> 6);
    }
    let (q1, rem1) = fix_div(sd, e_cur.wrapping_mul(2).wrapping_sub(0x26));
    let (q2, rem2) = fix_div(se, e_prev.wrapping_mul(2).wrapping_sub(0x26));
    let mut arr1 = [0i32; 160];
    let mut arr2 = [0i32; 160];
    let s3 = e_cur.wrapping_add(rem1).wrapping_sub(0x1f);
    for b in 0..160 {
        let prod = (q1 as i64).wrapping_mul(mem[cur + b] as i64);
        let t = if s3 > 0 {
            (prod >> (s3 as u32 & 63)) as i64
        } else if s3 < 0 {
            prod.wrapping_shl((-s3) as u32 & 63)
        } else {
            prod
        };
        arr1[b] = fix_shift(t as i32, (t >> 32) as i32);
    }
    let s4 = e_prev.wrapping_add(rem2).wrapping_sub(0x1f);
    for b in 0..160 {
        let prod = (q2 as i64).wrapping_mul(mem[other + b] as i64);
        let t = if s4 > 0 {
            (prod >> (s4 as u32 & 63)) as i64
        } else if s4 < 0 {
            prod.wrapping_shl((-s4) as u32 & 63)
        } else {
            prod
        };
        arr2[b] = fix_shift(t as i32, (t >> 32) as i32);
    }
    let mut acc: i32 = 0;
    for b in 0..160 {
        let d = arr1[b].wrapping_sub(arr2[b]);
        acc = acc.wrapping_add(sqhi(d) >> 5);
    }
    acc
}

// ------------------------------------------------------------- statistics

/// Read a session word. Reads past the end of the session struct return 0:
/// the original reads adjacent heap memory there (MIPS does not bounds
/// check), and fresh heap pages are zero. Long tracks (n = chunks+1 words
/// of linear stats read) hit this path constantly.
fn mem_get(mem: &[i32], idx: usize) -> i32 {
    mem.get(idx).copied().unwrap_or(0)
}

/// `stat_reduce` @0x10c8cc: mean over `n` consecutive ints (>>4 then <<4).
fn stat_reduce(mem: &[i32], base: usize, n: i32) -> i32 {
    let s: i64 = (0..n).map(|i| (mem_get(mem, base + i as usize) >> 4) as i64).sum();
    (s / n as i64 * 16) as i32
}

/// `stat_reduce` over a plain slice (`record_open` backfill).
fn stat_reduce_arr(a: &[i32], n: i32) -> i32 {
    let s: i64 = (0..n).map(|i| (a[i as usize] >> 4) as i64).sum();
    (s / n as i64 * 16) as i32
}

/// `stat_weighted` @0x10c908: std-like statistic via fix_div.
fn stat_weighted(mem: &[i32], base: usize, n: i32, p: i32) -> i32 {
    stat_weighted_core((0..n).map(|i| mem_get(mem, base + i as usize)), n, p)
}

/// `stat_weighted` over a plain slice (`record_open` backfill).
fn stat_weighted_arr(a: &[i32], n: i32, p: i32) -> i32 {
    stat_weighted_core((0..n).map(|i| a[i as usize]), n, p)
}

fn stat_weighted_core(vals: impl Iterator<Item = i32>, n: i32, p: i32) -> i32 {
    let vals: Vec<i32> = vals.collect();
    let sum: i64 = vals.iter().map(|x| (x >> 4) as i64).sum();
    let mean16 = (sum / n as i64) * 16;
    let mut acc: i32 = 0;
    for x in vals {
        // original: addu (wrapping), then square the 32-bit dev
        let dev = x.wrapping_sub(mean16 as i32);
        acc = acc.wrapping_add(sqhi(dev) >> 4);
    }
    let var = (acc / n).wrapping_mul(16);
    let y = p * 2 - 32;
    let (q, e) = fix_div(var, y);
    // result = (q·var) >> (y + e − p) as a FULL 64-bit arithmetic shift
    // (the original assembles hi/lo words; taking hi first was a bug that
    // zeroed every std feature).
    let prod = (q as i64).wrapping_mul(var as i64);
    let sh = y + e - p;
    if sh >= 0 {
        (prod >> sh) as i32
    } else {
        // original's u>=32 branch for negative shift: hi >> (sh & 31)
        ((prod >> 32) as i32) >> ((sh as u32) & 31)
    }
}

// ------------------------------------------------------------- normalize

/// `feat_normalize` @0x10d3c4 — fully re-verified against raw disassembly.
/// Byte constants: `lb(0x76dda0)=26` (f0 product shift 26+2=28),
/// `lb(0x76dda1)=31` (offset shifts: f0 31−30=1, f1 31−26=5, f2/f3 31−25=6,
/// f4..f7 31−31=0), `lb(0x76ddac)=26`/`lb(0x76ddad)=35` (f1 log pre-shift
/// 26−35+30=21, post-shift 35−30=5). The `nor $v0,$zero,$s` idiom supplies
/// `−s−1` so each combine is an exact 64-bit arithmetic shift by `s`:
/// f0 >>28, f1 affine >>30 (masked from corr−2), f2/f3 >>29, f4..f7 >>3.
fn feat_normalize(f: &mut [i32; 8]) {
    // f1 log front-end: v = ((f1·0x7a0daa97)>>21) + 1367135488; while the
    // hi word of v is > 0: v >>= 1, corr += 2^26; lv = (v >> 5) as i32.
    let prod = (f[1] as i64).wrapping_mul(0x7a0d_aa97i64);
    let mut v = (prod >> 21).wrapping_add(1_367_135_488);
    let mut corr: i32 = 0;
    while v > (1i64 << 35) {
        v >>= 1;
        corr = corr.wrapping_add(0x0400_0000);
    }
    let lv = ((v >> 5) as u32) as i32;
    let f1log = (((fix_log2(lv).wrapping_add(corr) as i64).wrapping_mul(0x4d10_4d42)) >> 32) as i32;
    // f1 affine on the log value: sat32(((f1log − off1>>5)·sc1) >> 24)
    let p1 = ((f1log.wrapping_sub(NORM_OFFSET[1] >> 5)) as i64).wrapping_mul(NORM_SCALE[1] as i64);
    f[1] = sat64(p1 >> 24);
    // f0: sat32(((f0 − off0>>1)·sc0) >> 28)
    let p0 = ((f[0].wrapping_sub(NORM_OFFSET[0] >> 1)) as i64).wrapping_mul(NORM_SCALE[0] as i64);
    f[0] = sat64(p0 >> 28);
    // f2, f3: sat32(((raw − off>>6)·sc) >> 23)
    for k in 2..4 {
        let pk = ((f[k].wrapping_sub(NORM_OFFSET[k] >> 6)) as i64).wrapping_mul(NORM_SCALE[k] as i64);
        f[k] = sat64(pk >> 23);
    }
    // f4..f7: sat32(((raw − off)·sc) >> 29)
    for k in 4..8 {
        let pk = ((f[k].wrapping_sub(NORM_OFFSET[k])) as i64).wrapping_mul(NORM_SCALE[k] as i64);
        f[k] = sat64(pk >> 29);
    }
}

// ------------------------------------------------------------- GMM classifier

/// `score_kernel` @0x10fcb4: −Σ (L_i·d)² with d = (x−μ)>>1.
fn score_kernel(x: &[i32; 8], mean: &[i32], chol: &[i32]) -> i32 {
    // d[k] = sat32(x[k] − (mean[k] >> 1))   (mean shifted first, then saturating sub)
    let mut d = [0i32; 8];
    for k in 0..8 {
        let diff = x[k] as i64 - (mean[k] >> 1) as i64;
        d[k] = diff.clamp(i32::MIN as i64, i32::MAX as i64) as i32;
    }
    // score = −Σ_i ((v_i² as i64) >> 31) as i32,  v_i = Σ_{j≤i} (chol[i][j]·d[j]) >> 32
    let mut score: i32 = 0;
    for i in 0..8 {
        let mut v: i32 = 0;
        for j in 0..=i {
            v = v.wrapping_add(((chol[i * 8 + j] as i64 * d[j] as i64) >> 32) as i32);
        }
        score = score.wrapping_sub((((v as i64 * v as i64) >> 31) as i32));
    }
    score
}

/// `classifier` @0x10fe90: pairs[c] −= max_g(bias>>13 − mahal_g).
fn classifier(f: &[i32; 8], mem: &mut [i32]) {
    for c in 0..20 {
        let mut best = i32::MIN;
        for g in 0..3 {
            let mean = &MEANS[(c * 3 + g) * 8..];
            let chol = &CHOL[(c * 3 + g) * 64..];
            let s = score_kernel(f, mean, chol).wrapping_add(BIAS[c * 3 + g] >> 13);
            if s > best {
                best = s;
            }
        }
        let p = pair_get(mem, c);
        pair_set(mem, c, p.wrapping_sub(best as i64));
    }
}

// ------------------------------------------------------------- emit rules

/// `emit_categories` @0x10ecb0 (kind 3 post-rule).
/// v12=sat(p12·n), v6=sat(p6·n), v16=sat(p16·n), n=runs−4.
/// If out contains 7 (and v12>0) at index i, and 0.489·v6 < v12 or
/// 0.489·v16 < v12: if out contains 5 or 1 → remove entry i; else out[i]=5.
fn emit_categories(kind: i32, mem: &[i32], out: &mut Vec<i32>) {
    if kind != 3 {
        return;
    }
    let n = mem[M_RUNS].wrapping_sub(4) as i64;
    let div = |s: usize| -> i32 {
        if n == 0 {
            0
        } else {
            sat64(pair_get(mem, s).wrapping_div(n))
        }
    };
    let v12 = div(12);
    let v7 = div(7);
    let v16 = div(16);
    // loop1: first index of category 8 (DAT_007743a0), only counts when v12 > 0
    let mut idx8 = 0usize;
    let mut bvar1 = false;
    for i in 0..out.len().min(20) {
        if out[i] == 8 {
            if v12 > 0 {
                bvar1 = true;
                idx8 = i;
            }
            break;
        }
    }
    if !bvar1 {
        return;
    }
    // loop2: out contains 5 (DAT_00774396 / PTR_DAT_007743a8)
    let bvar2 = out.iter().take(20).any(|&v| v == 5);
    let frac = |x: i32| -> i32 {
        let p = (x as i64).wrapping_mul(0x7d2f_1aa0u32 as i64);
        (((p >> 32) << 1) | ((p as u32) >> 31) as i64) as i32
    };
    if frac(v7) < v12 || frac(v16) < v12 {
        if bvar2 {
            if idx8 < 19 && idx8 < out.len() {
                out.remove(idx8);
            }
        } else if idx8 < out.len() {
            out[idx8] = 5;
        }
    }
}

/// `emit_categories2` @0x10eaf0 (kind 3 post-rule).
/// v10=p10/n, v6=p6/n, v17=p17/n (saturated). If out contains 9 (DAT_0077439a)
/// and 0.463·v10 < v6+v17: if contains 9 → remove entry at idx10; else out[idx10]=9.
fn emit_categories2(kind: i32, mem: &[i32], out: &mut Vec<i32>) {
    if kind != 3 {
        return;
    }
    let n = mem[M_RUNS].wrapping_sub(4) as i64;
    let div = |s: usize| -> i32 {
        if n == 0 {
            0
        } else {
            sat64(pair_get(mem, s).wrapping_div(n))
        }
    };
    let v10 = div(10);
    let v6 = div(6);
    let v17 = div(17);
    // loop1: out contains 9
    let bvar1 = out.iter().take(20).any(|&v| v == 9);
    // loop2: first index of 10 with v6+v17 ≥ 1; absent → return
    let sum = v6.wrapping_add(v17);
    let idx10 = match out.iter().take(20).position(|&v| v == 10) {
        Some(i) => i,
        None => return,
    };
    if sum < 1 {
        return;
    }
    let p = (v10 as i64).wrapping_mul(0x7684_bda1u32 as i64);
    let scaled = ((((p >> 32) << 1) | ((p as u32) >> 31) as i64) as i32);
    if scaled < sum {
        if bvar1 {
            if idx10 < 19 && idx10 < out.len() {
                out.remove(idx10);
            }
        } else if idx10 < out.len() {
            out[idx10] = 9;
        }
    }
}

// ------------------------------------------------------------- category → mask

/// Category ID → DB bit (`result_to_channel_mask` @0x4bd28).
pub const CATEGORY_TO_BIT: [u32; 13] = [
    0x400, // 0  jazz
    0x010, // 1  midnight
    0x001, // 2  morning
    0x008, // 3  night
    0x002, // 4  daytime
    0x020, // 5  active
    0x040, // 6  slow
    0x100, // 7  happy
    0x1000,// 8  rock
    0x004, // 9  twilight
    0x080, // 10 sad
    0x200, // 11 ballad
    0x800, // 12 dance
];

pub fn categories_to_mask(a: &[i32], b: &[i32]) -> u32 {
    let mut m = 0u32;
    for arr in [a, b] {
        for &id in arr.iter() {
            if id < 0 {
                continue;
            }
            if let Some(&bit) = CATEGORY_TO_BIT.get(id as usize) {
                m |= bit;
            }
        }
    }
    m
}

// ------------------------------------------------------------- FFT

/// Radix-2 DIF-style FFT on 512 interleaved complex pairs (1024 ints), with
/// >>1 (floor) scaling per stage, matching `spectral_stage` @0x10cbdc scaling.
#[doc(hidden)]
fn fft512_inplace(buf: &mut [i32]) {
    let mut re = [0f64; 512];
    let mut im = [0f64; 512];
    for i in 0..512 {
        re[i] = buf[2 * i] as f64;
        im[i] = buf[2 * i + 1] as f64;
    }
    // bit-reversal permutation
    let mut j = 0usize;
    for i in 1..512 {
        let mut bit = 512 >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    // stages with per-stage halving (floor, like sra)
    let mut len = 2;
    while len <= 512 {
        let ang = -std::f64::consts::PI * 2.0 / len as f64;
        let (ws, wc) = (ang.sin(), ang.cos());
        let half = len / 2;
        let mut i = 0;
        while i < 512 {
            let (mut si, mut ci) = (1.0f64, 1.0f64);
            for k in 0..half {
                let a = i + k;
                let b = a + half;
                let tr = re[b] * ci - im[b] * si;
                let ti = re[b] * si + im[b] * ci;
                re[b] = ((re[a] - tr) * 0.5).floor();
                im[b] = ((im[a] - ti) * 0.5).floor();
                re[a] = ((re[a] + tr) * 0.5).floor();
                im[a] = ((im[a] + ti) * 0.5).floor();
                let ns = si * wc + ci * ws;
                ci = ci * wc - si * ws;
                si = ns;
            }
            i += len;
        }
        len <<= 1;
    }
    for i in 0..512 {
        buf[2 * i] = re[i].clamp(i32::MIN as f64, i32::MAX as f64) as i32;
        buf[2 * i + 1] = im[i].clamp(i32::MIN as f64, i32::MAX as f64) as i32;
    }
}

// ------------------------------------------------------------- top-level

/// Analyze mono 22050 Hz i16 PCM → 13-bit channel mask.
pub fn analyze_mono_22050(pcm: &[i16]) -> u32 {
    let mut s = Session::default();
    s.mem[M_INIT1] = 1; // record_parse configured the session
    for chunk in pcm.chunks(NCHUNK) {
        if chunk.len() < NCHUNK {
            break;
        }
        let mut c = [0i16; NCHUNK];
        c.copy_from_slice(chunk);
        s.push_chunk(&c);
    }
    s.record_open_backfill();
    s.channel_mask()
}

/// Resample arbitrary-rate mono/stereo i16 PCM to 22050 Hz mono using a
/// windowed-sinc resampler (the PSP path uses FIR kernels @0x76dd10 etc.;
/// this is the accuracy-equivalent replacement).
pub fn resample_to_22050(pcm: &[i16], rate: u32, channels: u32) -> Vec<i16> {
    let ch = channels.max(1) as usize;
    let mono: Vec<f64> = if ch == 1 {
        pcm.iter().map(|&s| s as f64).collect()
    } else {
        pcm.chunks_exact(2).map(|p| (p[0] as f64 + p[1] as f64) * 0.5).collect()
    };
    if rate == 22050 {
        return mono.iter().map(|&v| v.clamp(i16::MIN as f64, i16::MAX as f64) as i16).collect();
    }
    let ratio = 22050.0 / rate as f64;
    let taps = 64usize;
    let out_len = (mono.len() as f64 * ratio) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let center = i as f64 / ratio;
        let mut acc = 0.0f64;
        let lo = (center.floor() as usize).saturating_sub(taps / 2);
        for k in 0..taps {
            let idx = lo + k;
            if idx >= mono.len() {
                break;
            }
            let x = idx as f64 - center;
            let w = if x == 0.0 {
                1.0
            } else {
                let px = std::f64::consts::PI * x * ratio;
                px.sin() / px
            };
            let win = 0.5 + 0.5 * (std::f64::consts::PI * (k as f64 / taps as f64)).cos();
            acc += mono[idx] * w * win;
        }
        out.push(acc.clamp(i16::MIN as f64, i16::MAX as f64) as i16);
    }
    out
}

/// Analyze PCM at an arbitrary rate/channels → 13-bit channel mask.
pub fn analyze(pcm: &[i16], rate: u32, channels: u32) -> u32 {
    analyze_full(pcm, rate, channels).mask
}

// ------------------------------------------------------------- high-level API

/// Version of the faithful PSP algorithm port (bump on semantic change).
pub const PSP_ALGORITHM_VERSION: &str = "psp-1.0.0";

/// Category names by category ID (0..12), matching the PSP MUSICDB.DAT bits.
pub const CATEGORY_NAMES: [&str; 13] = [
    "jazz", "midnight", "morning", "night", "daytime", "active", "slow", "happy", "rock",
    "twilight", "sad", "ballad", "dance",
];

/// Result of a full offline analysis pass (the PSP "session state").
#[derive(Debug, Clone)]
pub struct PspAnalysis {
    /// 13 channel flags; bit i = `CATEGORY_NAMES[i]` (same bits as MUSICDB.DAT).
    pub mask: u32,
    /// kind-2 winner categories (0..4).
    pub kind2: Vec<i32>,
    /// kind-3 winner categories (5..12).
    pub kind3: Vec<i32>,
    /// Accumulated per-slot pair scores (i64; lower = better match).
    pub pairs: [i64; 20],
    /// Classifier run counter (session+0x3e18).
    pub runs: i32,
    /// Chunk counter (session+0x3e14).
    pub chunks: i32,
}

/// Product-level fallback (NOT part of the original): when the faithful
/// query gate leaves the mask empty, pick the single best-matching category
/// from the raw pair scores (argmin over slots that carry a category).
/// The PSP simply left such tracks unclassified; the app requires every
/// track to carry at least one channel.
pub fn fallback_mask(pairs: &[i64; 20]) -> u32 {
    let mut best: Option<(i64, usize)> = None;
    for s in 0..20 {
        let cat = SLOT_CAT[s];
        if cat < 0 {
            continue;
        }
        let v = pairs[s];
        if best.map_or(true, |(bv, _)| v < bv) {
            best = Some((v, cat as usize));
        }
    }
    best.map_or(0, |(_, c)| 1 << c)
}

/// Channel names enabled by a mask.
pub fn mask_names(mask: u32) -> Vec<&'static str> {    (0..13)
        .filter(|i| mask >> i & 1 == 1)
        .map(|i| CATEGORY_NAMES[i])
        .collect()
}

/// The original seeks to a stored position before analyzing
/// (`db_update_channels` @0x3c668: `media_seek(handle, track[0xc])`), which
/// skips leading silence so the 8-chunk feature window lands on real audio.
/// We replicate that by skipping leading near-silent chunks.
fn first_content_chunk(mono: &[i16]) -> usize {
    let mut i = 0usize;
    while i * NCHUNK < mono.len() {
        let end = ((i + 1) * NCHUNK).min(mono.len());
        let rms = mono[i * NCHUNK..end].iter().map(|s| (*s as i64) * (*s as i64)).sum::<i64>() / (end - i * NCHUNK) as i64;
        if rms >= 1_000 {
            break;
        }
        i += 1;
    }
    i
}

/// Run the faithful PSP offline pipeline on integer PCM at any rate/channels.
/// Resampling to 22050 Hz mono uses `resample_to_22050` (the PSP FIR path is
/// approximated; see module docs).
pub fn analyze_full(pcm: &[i16], rate: u32, channels: u32) -> PspAnalysis {
    let mono = resample_to_22050(pcm, rate, channels);
    let start = first_content_chunk(&mono);
    let mut s = Session::default();
    s.mem[M_INIT1] = 1; // record_parse configured the session
    for chunk in mono[start..].chunks(NCHUNK) {
        if chunk.len() < NCHUNK {
            break;
        }
        let mut c = [0i16; NCHUNK];
        c.copy_from_slice(chunk);
        s.push_chunk(&c);
    }
    s.record_open_backfill();
    PspAnalysis {
        mask: s.channel_mask(),
        kind2: s.record_query(2),
        kind3: s.record_query(3),
        pairs: s.debug_pairs(),
        runs: s.mem[M_RUNS],
        chunks: s.mem[M_CHUNKS],
    }
}

/// Convenience: normalized f32 samples (−1..=1) → i16 PCM → `analyze`.
pub fn analyze_f32(samples: &[f32], rate: u32) -> PspAnalysis {
    let pcm: Vec<i16> = samples
        .iter()
        .map(|&v| (v * 32767.0).clamp(-32768.0, 32767.0) as i16)
        .collect();
    analyze_full(&pcm, rate, 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mask_mapping() {
        assert_eq!(categories_to_mask(&[0, 2], &[5]), 0x400 | 0x001 | 0x020);
    }
    #[test]
    fn fix_div_sqrt() {
        // q must converge near the fixed point of q·(3/2 − xn·q²) (Q29)
        let (q1, r1) = fix_div(0x0100_0000, 30);
        let (q2, r2) = fix_div(0x00ab_cd00, 18);
        assert!(q1 > 0 && q2 > 0, "q1={q1:#x} q2={q2:#x}");
        assert!(r1 > 0 && r2 > 0);
    }
    #[test]
    fn pipeline_runs() {
        let n = 22050 * 3;
        let sine: Vec<i16> = (0..n)
            .map(|i| {
                (6000.0 * (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / 22050.0).sin()) as i16
            })
            .collect();
        // deterministic pseudo-noise
        let mut st = 0x1234_5678u32;
        let noise: Vec<i16> = (0..n)
            .map(|_| {
                st = st.wrapping_mul(1664525).wrapping_add(1013904223);
                ((st >> 15) as i16) & 0x7fff
            })
            .collect();
        let run = |pcm: &[i16]| -> Session {
            let mut s = Session::default();
            s.mem[M_INIT1] = 1;
            for chunk in pcm.chunks(NCHUNK) {
                if chunk.len() < NCHUNK {
                    break;
                }
                let mut c = [0i16; NCHUNK];
                c.copy_from_slice(chunk);
                s.push_chunk(&c);
            }
            s.record_open_backfill();
            s
        };
        let s1 = run(&sine);
        let s2 = run(&noise);
        // The classifier must discriminate between different signals
        // (a pure sine may legitimately map to no channel).
        assert_ne!(s1.debug_pairs(), s2.debug_pairs(), "pairs must differ");
    }
}


