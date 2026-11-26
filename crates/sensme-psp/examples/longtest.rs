// quick harness: 5 min of 44.1kHz audio through the PSP engine
use sensme_psp::analyze_full;
fn main() {
    let rate = 44100u32;
    let n = (rate as usize) * 300; // 5 minutes
    let pcm: Vec<i16> = (0..n)
        .map(|i| {
            let t = i as f64 / rate as f64;
            (32000.0 * (2.0 * std::f64::consts::PI * 220.0 * t).sin()) as i16
        })
        .collect();
    let r = analyze_full(&pcm, rate, 1);
    println!("ok chunks={} runs={} mask={:013b}", r.chunks, r.runs, r.mask);
}
