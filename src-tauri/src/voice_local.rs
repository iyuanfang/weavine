//! On-device speech recognition for Android via sherpa-onnx (Whisper tiny).
//!
//! Used by `recognize_voice_local` instead of `recognize_voice` so that
//! voice input on Android never hits the cloud, which would otherwise pile
//! up server-side and 504 under load. The Whisper tiny multilingual model
//! (~75 MB extracted) supports Chinese and English out of the box and is
//! downloaded on first voice use (see
//! `commands::voice_local::download_voice_model`) and cached in the app's
//! data dir.
//!
//! Compiled on all platforms so the `check_voice_model` and
//! `download_voice_model` commands can be defined everywhere; the heavy
//! `sherpa_onnx` dependency is only linked on Android (see Cargo.toml).

use std::path::{PathBuf};
use std::sync::{Arc, OnceLock};

use crate::install_id;

pub const MODEL_DIR_NAME: &str = "whisper-tiny";
pub const ENCODER_FILE: &str = "tiny-encoder.int8.onnx";
pub const DECODER_FILE: &str = "tiny-decoder.int8.onnx";
pub const TOKENS_FILE: &str = "tokens.txt";

/// Files the tar archive must unpack into `model_dir()`. Anything else
/// (source archives, READMEs, sample audio) is skipped on extract.
pub const REQUIRED_FILES: &[&str] = &[ENCODER_FILE, DECODER_FILE, TOKENS_FILE];

pub fn model_dir() -> PathBuf {
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
#[cfg(target_os = "android")]
use std::path::Path;

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
        .map_err(|e| format!("failed to build whisper recognizer: {e}"))
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