//! WebAssembly surface over the SensMe core (ADR-016).
//!
//! The web shell owns persistence (IndexedDB) and I/O; this crate exposes
//! the deterministic analysis + classification pipeline to JavaScript.
//! Every returned object follows the `contracts/generated/` ts-rs types.
//!
//! All functions are pure: same input bytes ⇒ same output vectors on every
//! platform (golden-vector gate, AGENTS.md §2).

use wasm_bindgen::prelude::*;

use sensme_core::models::{Channel, Classification, FeatureVector};

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
///
/// # Errors
/// As [`analyze_bytes`] and [`classify_features`].
#[wasm_bindgen]
pub fn analyze_and_classify(label: &str, bytes: &[u8]) -> Result<JsValue, JsError> {
    let fv = sensme_audio::analyze_bytes(label, bytes)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let classification = classify_vector(&fv)?;
    serde_wasm_bindgen::to_value(&classification).map_err(|e| JsError::new(&e.to_string()))
}

/// Contract metadata the shell needs: version pins, feature layout names,
/// tone axes and channel ids (display order).
#[wasm_bindgen]
pub fn contract_meta() -> JsValue {
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "algorithmVersion": sensme_audio::ALGORITHM_VERSION,
        "featureVectorVersion": sensme_audio::FEATURE_VECTOR_VERSION,
        "axisWeightsVersion": sensme_classify::AXIS_WEIGHTS_VERSION,
        "channelWeightsVersion": sensme_classify::CHANNEL_WEIGHTS_VERSION,
        "featureNames": sensme_audio::features::FEATURE_NAMES_V1,
        "toneAxes": sensme_core::models::TONE_AXES,
        "channels": Channel::ALL.iter().map(|c| c.id()).collect::<Vec<_>>(),
    }))
    .unwrap_or(JsValue::NULL)
}

fn classify_vector(fv: &FeatureVector) -> Result<Classification, JsError> {
    let (axes, channels) =
        sensme_classify::classify(fv).map_err(|e| JsError::new(&format!("{e}")))?;
    Ok(Classification { axes, channels })
}
