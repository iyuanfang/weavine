#![cfg(feature = "voice-local")]

use crate::voice_local;
use base64::Engine;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRecognizeResult {
    pub text: String,
    pub lang: String,
}

#[tauri::command]
pub fn check_voice_model() -> voice_local::ModelStatus {
    voice_local::model_status()
}

#[tauri::command]
pub fn recognize_voice_local(pcm_base64: String) -> Result<LocalRecognizeResult, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(pcm_base64.as_bytes())
        .map_err(|e| format!("base64 decode: {e}"))?;
    if bytes.len() % 4 != 0 {
        return Err(format!(
            "pcm byte length {} is not a multiple of 4 (f32 stride)",
            bytes.len()
        ));
    }
    let mut pcm: Vec<f32> = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        pcm.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    let (text, lang) = voice_local::transcribe(&pcm)?;
    Ok(LocalRecognizeResult { text, lang })
}