//! On-device speech recognition for Android via sherpa-onnx (Whisper tiny).
//!
//! Used by `recognize_voice_local` instead of `recognize_voice` so that
//! voice input on Android never hits the cloud, which would otherwise pile
//! up server-side and 504 under load. The Whisper tiny multilingual model
//! (~75 MB extracted) supports Chinese and English out of the box. On the
//! local-flavor APK it ships pre-bundled under `assets/whisper-tiny/` (see
//! `tauri.local.conf.json::bundle.resources`); on a hypothetical stripped
//! build the code falls back to downloading the tar.bz2 from k2-fsa's
//! GitHub release (see `commands::voice_local::download_voice_model`).
//!
//! The entire module is gated on the `voice-local` Cargo feature so the
//! cloud-flavor Android APK can be built without pulling in sherpa-onnx
//! or its ~30 MB of native libraries. See Cargo.toml for the feature
//! matrix.

#![cfg(feature = "voice-local")]

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use crate::install_id;

pub const MODEL_DIR_NAME: &str = "whisper-tiny";
pub const ENCODER_FILE: &str = "tiny-encoder.int8.onnx";
pub const DECODER_FILE: &str = "tiny-decoder.int8.onnx";
// k2-fsa/sherpa-onnx ships the tokens file as `tiny-tokens.txt`, not
// `tokens.txt`. The previous constant was wrong — download would succeed
// but `model_status()` always returned `ready: false`, leaving the user
// with a downloaded model that the recognizer refused to load.
pub const TOKENS_FILE: &str = "tiny-tokens.txt";

/// Files the tar archive must unpack into `model_dir()`. Anything else
/// (source archives, READMEs, sample audio) is skipped on extract.
pub const REQUIRED_FILES: &[&str] = &[ENCODER_FILE, DECODER_FILE, TOKENS_FILE];

/// Populated by `lib.rs` setup() with the path of the bundled model dir
/// (`app.path().resource_dir().join("whisper-tiny")`) when the local-flavor
/// APK ships with the model pre-installed. When this is set AND contains
/// all three required files, `model_dir()` returns it directly and the
/// runtime never hits `download_voice_model`. On a build without bundled
/// resources the lock stays empty and the historical download path runs.
static BUNDLED_MODEL_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_bundled_model_dir(path: PathBuf) {
    let _ = BUNDLED_MODEL_DIR.set(path);
}

fn has_all_model_files(dir: &Path) -> bool {
    dir.join(ENCODER_FILE).is_file()
        && dir.join(DECODER_FILE).is_file()
        && dir.join(TOKENS_FILE).is_file()
}

pub fn model_dir() -> PathBuf {
    if let Some(bundled) = BUNDLED_MODEL_DIR.get() {
        if has_all_model_files(bundled) {
            return bundled.clone();
        }
    }
    install_id::data_dir().join(MODEL_DIR_NAME)
}

pub fn encoder_path() -> PathBuf {
    model_dir().join(ENCODER_FILE)
}

pub fn decoder_path() -> PathBuf {
    model_dir().join(DECODER_FILE)
}

pub fn tokens_path() -> PathBuf {
    model_dir().join(TOKENS_FILE)
}

pub fn model_status() -> ModelStatus {
    let dir = model_dir();
    let encoder = encoder_path();
    let decoder = decoder_path();
    let tokens = tokens_path();
    if !dir.exists() || !encoder.exists() || !decoder.exists() || !tokens.exists() {
        return ModelStatus {
            ready: false,
            model_path: encoder.to_string_lossy().into_owned(),
            dir_path: dir.to_string_lossy().into_owned(),
            size_bytes: 0,
        };
    }
    let encoder_size = std::fs::metadata(&encoder).map(|m| m.len()).unwrap_or(0);
    let decoder_size = std::fs::metadata(&decoder).map(|m| m.len()).unwrap_or(0);
    ModelStatus {
        ready: true,
        model_path: encoder.to_string_lossy().into_owned(),
        dir_path: dir.to_string_lossy().into_owned(),
        size_bytes: encoder_size + decoder_size,
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

/// Run Whisper tiny on 16 kHz mono PCM f32 samples. The caller is responsible
/// for resampling to 16 kHz and downmixing to mono. Returns `(text, language)`
/// — language comes from the recognizer's language hint (we pass `"auto"` so
/// Whisper picks zh/en automatically); falls back to `"auto"` if the model
/// doesn't expose a language field.
#[cfg(target_os = "android")]
pub fn transcribe(samples: &[f32]) -> Result<(String, String), String> {
    let recognizer = get_recognizer()?;
    let mut stream = recognizer.create_stream();
    stream.accept_waveform(16_000, samples);
    recognizer.decode(&stream);
    let result = stream
        .get_result()
        .ok_or_else(|| "whisper returned no result".to_string())?;
    let text = result.text.trim().to_string();
    // Whisper doesn't emit per-segment language markers like SenseVoice's
    // `<|zh|>` tokens. The `OfflineRecognizerResult` doesn't carry a language
    // field either, so we report the configured hint ("auto") and let the
    // caller decide if that's enough.
    let lang = "auto".to_string();
    Ok((text, lang))
}

#[cfg(not(target_os = "android"))]
pub fn transcribe(_samples: &[f32]) -> Result<(String, String), String> {
    Err("local ASR is only available on Android".to_string())
}

// --- Android-only recognizer singleton. ---

#[cfg(target_os = "android")]
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineWhisperModelConfig};

/// Process-wide singleton recognizer. Loading the Whisper tiny models
/// (encoder + decoder) takes a couple of seconds on a mid-range Android
/// device, so we load once on first use and reuse. The `OfflineRecognizer`
/// is `Send + Sync` and sherpa-onnx runs inference on a thread pool —
/// we don't need to serialize calls.
#[cfg(target_os = "android")]
static RECOGNIZER: OnceLock<Result<Arc<OfflineRecognizer>, String>> = OnceLock::new();

#[cfg(target_os = "android")]
fn build_recognizer(dir: &Path) -> Result<OfflineRecognizer, String> {
    let encoder = dir.join(ENCODER_FILE).to_string_lossy().into_owned();
    let decoder = dir.join(DECODER_FILE).to_string_lossy().into_owned();
    let tokens = dir.join(TOKENS_FILE).to_string_lossy().into_owned();

    let mut config = OfflineRecognizerConfig::default();
    config.model_config.whisper = OfflineWhisperModelConfig {
        encoder: Some(encoder),
        decoder: Some(decoder),
        language: Some("auto".into()),
        task: Some("transcribe".into()),
        tail_paddings: 0,
        ..Default::default()
    };
    config.model_config.tokens = Some(tokens);
    config.model_config.num_threads = 2;
    config.model_config.provider = Some("cpu".into());

    OfflineRecognizer::create(&config)
        .ok_or_else(|| "failed to build whisper recognizer".to_string())
}

#[cfg(target_os = "android")]
pub fn get_recognizer() -> Result<Arc<OfflineRecognizer>, String> {
    if let Some(cached) = RECOGNIZER.get() {
        return cached.clone();
    }
    let dir = model_dir();
    if !dir.join(ENCODER_FILE).exists()
        || !dir.join(DECODER_FILE).exists()
        || !dir.join(TOKENS_FILE).exists()
    {
        return Err(format!(
            "whisper model not installed at {} — call download_voice_model first",
            dir.display()
        ));
    }
    let built = build_recognizer(&dir).map(Arc::new);
    let result = RECOGNIZER.get_or_init(|| built.clone());
    result.clone()
}