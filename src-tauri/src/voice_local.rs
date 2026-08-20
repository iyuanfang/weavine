//! On-device speech recognition for Android via sherpa-onnx (SenseVoice).
//!
//! Used by `recognize_voice_local` instead of `recognize_voice` so that
//! voice input on Android never hits the cloud, which would otherwise pile
//! up server-side and 504 under load. The SenseVoice small int8 model
//! (`model.int8.onnx`, ~228 MB) supports Chinese and English out of the box
//! with automatic language detection. On the local-flavor APK it ships
//! pre-bundled under `assets/sense-voice/` (see
//! `tauri.local.conf.json::bundle.resources`) and is extracted to the app
//! data dir at startup by `android_assets::extract_sense_voice_to_data_dir()`
//! (see `lib.rs` setup). There is deliberately NO download fallback — the
//! model is always bundled, so `model_dir()` is the single source of truth.
//!
//! The entire module is gated on the `voice-local` Cargo feature so the
//! cloud-flavor Android APK can be built without pulling in sherpa-onnx
//! or its ~30 MB of native libraries. See Cargo.toml for the feature
//! matrix.

#![cfg(feature = "voice-local")]

use std::path::PathBuf;

use crate::install_id;

#[cfg(target_os = "android")]
use std::path::Path;
#[cfg(target_os = "android")]
use std::sync::{Arc, OnceLock};
#[cfg(target_os = "android")]
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig};

pub const MODEL_DIR_NAME: &str = "sense-voice";
pub const MODEL_FILE: &str = "model.int8.onnx";
pub const TOKENS_FILE: &str = "tokens.txt";

/// Files that must exist in `model_dir()` for the recognizer to be ready.
pub const REQUIRED_FILES: &[&str] = &[MODEL_FILE, TOKENS_FILE];

pub fn model_dir() -> PathBuf {
    install_id::data_dir().join(MODEL_DIR_NAME)
}

pub fn model_path() -> PathBuf {
    model_dir().join(MODEL_FILE)
}

pub fn tokens_path() -> PathBuf {
    model_dir().join(TOKENS_FILE)
}

pub fn model_status() -> ModelStatus {
    let dir = model_dir();
    let model = model_path();
    let tokens = tokens_path();
    if !dir.exists() || !model.exists() || !tokens.exists() {
        return ModelStatus {
            ready: false,
            model_path: model.to_string_lossy().into_owned(),
            dir_path: dir.to_string_lossy().into_owned(),
            size_bytes: 0,
        };
    }
    let model_size = std::fs::metadata(&model).map(|m| m.len()).unwrap_or(0);
    let tokens_size = std::fs::metadata(&tokens).map(|m| m.len()).unwrap_or(0);
    ModelStatus {
        ready: true,
        model_path: model.to_string_lossy().into_owned(),
        dir_path: dir.to_string_lossy().into_owned(),
        size_bytes: model_size + tokens_size,
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub ready: bool,
    pub model_path: String,
    pub dir_path: String,
    pub size_bytes: u64,
}

/// Run SenseVoice on 16 kHz mono PCM f32 samples. The caller is responsible
/// for resampling to 16 kHz and downmixing to mono. Returns `(text, language)`
/// — SenseVoice emits `<|zh|>` / `<|en|>` markers in its output tokens, but
/// the `OfflineRecognizerResult` struct doesn't expose a parsed language
/// field, so we report `"auto"` and let the caller decide if that's enough.
#[cfg(target_os = "android")]
pub fn transcribe(samples: &[f32]) -> Result<(String, String), String> {
    let recognizer = get_recognizer()?;
    let mut stream = recognizer.create_stream();
    stream.accept_waveform(16_000, samples);
    recognizer.decode(&stream);
    let result = stream
        .get_result()
        .ok_or_else(|| "sense-voice returned no result".to_string())?;
    let text = result.text.trim().to_string();
    let lang = "auto".to_string();
    Ok((text, lang))
}

#[cfg(not(target_os = "android"))]
pub fn transcribe(_samples: &[f32]) -> Result<(String, String), String> {
    Err("local ASR is only available on Android".to_string())
}

// --- Android-only recognizer singleton. ---

/// Process-wide singleton recognizer. Loading the SenseVoice int8 model
/// (~228 MB) takes a couple of seconds on a mid-range Android device, so we
/// load once on first use and reuse. The `OfflineRecognizer` is `Send + Sync`
/// and sherpa-onnx runs inference on a thread pool — we don't need to
/// serialize calls.
#[cfg(target_os = "android")]
static RECOGNIZER: OnceLock<Result<Arc<OfflineRecognizer>, String>> = OnceLock::new();

#[cfg(target_os = "android")]
fn build_recognizer(dir: &Path) -> Result<OfflineRecognizer, String> {
    let model = dir.join(MODEL_FILE).to_string_lossy().into_owned();
    let tokens = dir.join(TOKENS_FILE).to_string_lossy().into_owned();

    let mut config = OfflineRecognizerConfig::default();
    config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
        model: Some(model.into()),
        language: Some("auto".into()),
        use_itn: true,
    };
    config.model_config.tokens = Some(tokens.into());
    config.model_config.provider = Some("cpu".into());
    config.model_config.num_threads = 2;

    OfflineRecognizer::create(&config)
        .ok_or_else(|| "failed to build sense-voice recognizer".to_string())
}

#[cfg(target_os = "android")]
pub fn get_recognizer() -> Result<Arc<OfflineRecognizer>, String> {
    if let Some(cached) = RECOGNIZER.get() {
        return cached.clone();
    }
    let dir = model_dir();
    if !dir.join(MODEL_FILE).exists() || !dir.join(TOKENS_FILE).exists() {
        return Err(format!(
            "sense-voice model not installed at {} — the bundled model was not extracted",
            dir.display()
        ));
    }
    let built = build_recognizer(&dir).map(Arc::new);
    let result = RECOGNIZER.get_or_init(|| built.clone());
    result.clone()
}