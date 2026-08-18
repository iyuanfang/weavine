use crate::voice_local;
use base64::Engine;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, Window};

const MODEL_TARBZ2_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny-2024-09-12.tar.bz2";

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
pub async fn download_voice_model(
    app: AppHandle,
    window: Window,
) -> Result<voice_local::ModelStatus, String> {
    let status = voice_local::model_status();
    if status.ready {
        return Ok(status);
    }

    let dir = voice_local::model_dir();
    if let Some(parent) = dir.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("create parent dir: {e}"))?;
    }
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create model dir: {e}"))?;

    let _ = window.emit(
        "voice-model-download-progress",
        serde_json::json!({ "stage": "downloading", "percent": 0 }),
    );

    let bytes = download_with_progress(app.clone(), window.clone()).await?;

    let _ = window.emit(
        "voice-model-download-progress",
        serde_json::json!({ "stage": "extracting", "percent": 100 }),
    );

    let dir_for_blocking = dir.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let cursor = std::io::Cursor::new(bytes);
        let bz = bzip2::read::BzDecoder::new(cursor);
        let mut archive = tar::Archive::new(bz);
        for entry in archive
            .entries()
            .map_err(|e| format!("read tar entries: {e}"))?
        {
            let mut entry = entry.map_err(|e| format!("read entry: {e}"))?;
            let path = entry
                .path()
                .map_err(|e| format!("entry path: {e}"))?
                .into_owned();
            let file_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            if file_name != voice_local::MODEL_FILE
                && file_name != voice_local::TOKENS_FILE
            {
                continue;
            }
            let components: Vec<_> = path.components().collect();
            if components.len() < 2 {
                continue;
            }
            let stripped: PathBuf = components[1..].iter().collect();
            let dest = dir_for_blocking.join(stripped);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
            }
            entry.unpack(&dest).map_err(|e| format!("unpack: {e}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("join blocking extract: {e}"))??;

    let _ = window.emit(
        "voice-model-download-progress",
        serde_json::json!({ "stage": "ready", "percent": 100 }),
    );
    Ok(voice_local::model_status())
}

async fn download_with_progress(
    _app: AppHandle,
    window: Window,
) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("build http client: {e}"))?;
    let mut response = client
        .get(MODEL_TARBZ2_URL)
        .send()
        .await
        .map_err(|e| format!("download start: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "download failed: HTTP {}",
            response.status()
        ));
    }

    let total = response.content_length().unwrap_or(0);
    let mut buf: Vec<u8> = Vec::with_capacity(total as usize);
    let mut last_pct: i64 = -1;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("download chunk: {e}"))?
    {
        buf.extend_from_slice(&chunk);
        if total > 0 {
            let pct = (buf.len() as u64 * 100 / total) as i64;
            if pct != last_pct {
                let _ = window.emit(
                    "voice-model-download-progress",
                    serde_json::json!({
                        "stage": "downloading",
                        "percent": pct,
                        "downloaded": buf.len(),
                        "total": total,
                    }),
                );
                last_pct = pct;
            }
        }
    }
    Ok(buf)
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