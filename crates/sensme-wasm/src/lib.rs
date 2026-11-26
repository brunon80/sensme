//! WebAssembly surface over the SensMe core (ADR-016).
//!
//! The web shell owns persistence (IndexedDB) and I/O; this crate exposes
//! the deterministic analysis + classification pipeline to JavaScript.
//! Every returned object follows the `contracts/generated/` ts-rs types.
//!
//! All functions are pure: same input bytes ⇒ same output vectors on every
//! platform (golden-vector gate, AGENTS.md §2).

use wasm_bindgen::prelude::*;

use sensme_core::models::{Channel, ChannelScores, Classification, FeatureVector, ToneAxes};

/// Decode + analyze in-memory audio bytes into a versioned
/// [`FeatureVector`] (serialized per `contracts/generated/FeatureVector.ts`).
///
/// `label` is used only for the format hint (extension) and error messages.
///
/// # Errors
/// Returns a JS `Error` when the bytes contain no decodable audio.
#[wasm_bindgen]
pub fn analyze_bytes(label: &str, bytes: &[u8]) -> Result<JsValue, JsError> {
    let fv = sensme_audio::analyze_bytes(label, bytes)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    serde_wasm_bindgen::to_value(&fv).map_err(|e| JsError::new(&e.to_string()))
}

/// Classify a stored feature vector (pure function of features + shipped
/// weights; never re-decodes audio).
///
/// # Errors
/// Returns a JS `Error` when the vector's layout version is unsupported.
#[wasm_bindgen]
pub fn classify_features(features: JsValue) -> Result<JsValue, JsError> {
    let fv: FeatureVector =
        serde_wasm_bindgen::from_value(features).map_err(|e| JsError::new(&e.to_string()))?;
    let classification = classify_vector(&fv)?;
    serde_wasm_bindgen::to_value(&classification).map_err(|e| JsError::new(&e.to_string()))
}

/// Decode + analyze + classify in one call (convenience for import passes).
/// Returns `{ featureVector, classification }` per the contract types.
///
/// # Errors
/// As [`analyze_bytes`] and [`classify_features`].
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisResult {
    feature_vector: sensme_core::models::FeatureVector,
    classification: Classification,
}

#[wasm_bindgen]
pub fn analyze_and_classify(label: &str, bytes: &[u8]) -> Result<JsValue, JsError> {
    let fv = sensme_audio::analyze_bytes(label, bytes)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let classification = classify_vector(&fv)?;
    let result = AnalysisResult {
        feature_vector: fv,
        classification,
    };
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// PSP category index (`sensme_psp::CATEGORY_NAMES` order) → index into
/// `Channel::ALL`. Both sets have 13 members; the core channel set is the
/// modernized PSP set (active→energetic, slow→relax, happy→upbeat,
/// ballad→mellow, jazz→lounge, sad→emotional, rock→extreme,
/// twilight→evening; the five time-of-day channels map 1:1).
const PSP_TO_CORE: [usize; 13] = [4, 12, 8, 11, 9, 0, 1, 2, 7, 10, 5, 3, 6];

/// Feature-vector layout version for PSP-engine outputs.
const PSP_FEATURE_VECTOR_VERSION: u32 = 2;

/// Decode + analyze + classify with the faithful PSP SensMe Channels
/// engine (reverse-engineered from the original EBOOT, `sensme-psp`).
///
/// The stored feature vector uses layout v2: `values` = the 20 accumulated
/// pair scores (lower = better match), then the 13-bit channel mask, the
/// classifier run count, and the chunk count. The classification's channel
/// scores are 1.0 for channels flagged by the PSP mask (mapped onto the
/// core channel set via [`PSP_TO_CORE`]), 0.0 otherwise; tone axes are not
/// produced by this engine and stay 0.
///
/// # Errors
/// Returns a JS `Error` when the bytes contain no decodable audio.
#[wasm_bindgen]
pub fn psp_analyze_and_classify(label: &str, bytes: &[u8]) -> Result<JsValue, JsError> {
    let audio = sensme_audio::load_mono_bytes(label, bytes, 44_100)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let res = sensme_psp::analyze_f32(&audio.samples, audio.sample_rate as u32);
    let result = AnalysisResult {
        feature_vector: psp_feature_vector(&res),
        classification: psp_classification(&res),
    };
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

fn psp_feature_vector(res: &sensme_psp::PspAnalysis) -> FeatureVector {
    let mut values: Vec<f32> = Vec::with_capacity(23);
    for p in res.pairs {
        values.push(p as f32);
    }
    values.push(res.mask as f32);
    values.push(res.runs as f32);
    values.push(res.chunks as f32);
    FeatureVector {
        algorithm_version: sensme_psp::PSP_ALGORITHM_VERSION.into(),
        feature_vector_version: PSP_FEATURE_VECTOR_VERSION,
        values,
    }
}

fn psp_classification(res: &sensme_psp::PspAnalysis) -> Classification {
    // Product rule: every track must carry at least one channel. The
    // faithful engine leaves the mask empty when its query gate blocks;
    // fall back to the single best-matching category from the raw pairs.
    let mask = if res.mask == 0 {
        sensme_psp::fallback_mask(&res.pairs)
    } else {
        res.mask
    };
    let mut scores = [0.0f32; 13];
    for cat in 0..13 {
        if mask >> cat & 1 == 1 {
            scores[PSP_TO_CORE[cat]] = 1.0;
        }
    }
    Classification {
        axes: ToneAxes {
            scores: [0.0; 12],
            weights_version: sensme_psp::PSP_ALGORITHM_VERSION.into(),
        },
        channels: ChannelScores {
            scores,
            weights_version: sensme_psp::PSP_ALGORITHM_VERSION.into(),
        },
    }
}

/// Contract metadata the shell needs: version pins, feature layout names,
/// tone axes and channel ids (display order). A plain struct so
/// serde-wasm-bindgen emits a JS object (not a Map).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ContractMeta {
    algorithm_version: &'static str,
    feature_vector_version: u32,
    axis_weights_version: &'static str,
    channel_weights_version: &'static str,
    psp_algorithm_version: &'static str,
    feature_names: [&'static str; 30],
    tone_axes: [&'static str; 12],
    channels: [&'static str; 13],
}

#[wasm_bindgen]
pub fn contract_meta() -> JsValue {
    let meta = ContractMeta {
        algorithm_version: sensme_audio::ALGORITHM_VERSION,
        feature_vector_version: sensme_audio::FEATURE_VECTOR_VERSION,
        axis_weights_version: sensme_classify::AXIS_WEIGHTS_VERSION,
        channel_weights_version: sensme_classify::CHANNEL_WEIGHTS_VERSION,
        psp_algorithm_version: sensme_psp::PSP_ALGORITHM_VERSION,
        feature_names: sensme_audio::features::FEATURE_NAMES_V1,
        tone_axes: sensme_core::models::TONE_AXES,
        channels: Channel::ALL.map(|c| c.id()),
    };
    serde_wasm_bindgen::to_value(&meta).unwrap_or(JsValue::NULL)
}

fn classify_vector(fv: &FeatureVector) -> Result<Classification, JsError> {
    let (axes, channels) =
        sensme_classify::classify(fv).map_err(|e| JsError::new(&format!("{e}")))?;
    Ok(Classification { axes, channels })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn psp_mask_maps_to_core_channels() {
        // bit 0 = jazz → lounge (4), bit 12 = dance → dance (6)
        let res = sensme_psp::PspAnalysis {
            mask: 0b1_0000_0000_0001,
            kind2: vec![],
            kind3: vec![],
            pairs: [7; 20],
            runs: 61,
            chunks: 64,
        };
        let c = psp_classification(&res);
        assert_eq!(c.channels.scores[4], 1.0);
        assert_eq!(c.channels.scores[6], 1.0);
        assert_eq!(c.channels.scores.iter().filter(|s| **s > 0.0).count(), 2);
        assert_eq!(c.axes.scores, [0.0; 12]);
        let fv = psp_feature_vector(&res);
        assert_eq!(fv.feature_vector_version, PSP_FEATURE_VECTOR_VERSION);
        assert_eq!(fv.algorithm_version, sensme_psp::PSP_ALGORITHM_VERSION);
        assert_eq!(fv.values.len(), 23);
        assert_eq!(fv.values[0], 7.0);
        assert_eq!(fv.values[20], 4097.0); // mask
        assert_eq!(fv.values[21], 61.0); // runs
        assert_eq!(fv.values[22], 64.0); // chunks
    }

    #[test]
    fn psp_to_core_is_a_permutation() {
        let mut seen = [false; 13];
        for &i in &PSP_TO_CORE {
            assert!(!seen[i], "duplicate core index {i}");
            seen[i] = true;
        }
        assert!(seen.iter().all(|s| *s));
    }
}
