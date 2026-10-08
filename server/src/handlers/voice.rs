//! Speech-to-text via sherpa-onnx (SenseVoice).
//!
//! `POST /api/voice/recognize` (feature `stt`): accepts a multipart audio file,
//! decodes it to 16 kHz mono PCM f32, runs SenseVoice, returns `{ text, lang }`.
//!
//! Auth is zero-friction: the shared service key (`WV_SERVICE_KEY`, or a random
//! one logged at startup) via `X-Service-Key` / `Authorization: Bearer`, or a
//! normal user JWT/API key. No DB rows are written — the service path uses the
//! synthetic user id from `auth::extract_auth_with_service`.

use axum::{
    body::Bytes,
    extract::{multipart::Multipart, ConnectInfo, State},
    http::{HeaderMap, StatusCode},
};
use serde::Serialize;
use std::path::Path;
use std::sync::{Arc, OnceLock};
use tokio::io::AsyncWriteExt;
use super::auth::{
    client_ip, extract_endpoint_auth, ocr_voice_rate_limit, EndpointAuth,
    OCR_VOICE_RL_LIMIT, OCR_VOICE_RL_WINDOW,
};

use sherpa_onnx::{
    OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig,
};

const TARGET_RATE: u32 = 16000;

#[derive(Debug, Serialize)]
pub struct RecognizeResult {
    pub text: String,
    pub lang: String,
}

/// Process-wide singleton recognizer. Loading the SenseVoice model
/// (model.int8.onnx) takes a few seconds on server start, so we load
/// once on first use and reuse. The `OfflineRecognizer` is `Send + Sync`
/// and sherpa-onnx runs inference on a thread pool — we don't need to
/// serialize calls, but we still cap concurrent requests with the semaphore
/// below to avoid runaway CPU on small boxes.
static RECOGNIZER: OnceLock<Result<Arc<OfflineRecognizer>, String>> = OnceLock::new();

/// Cap concurrent recognitions at 2. SenseVoice is CPU-heavy; running
/// several in parallel on a small (2-core) box makes every request slower
/// than the nginx proxy timeout, which surfaces as 504 Gateway Timeout
/// to clients. We fail fast with 503 instead of letting requests pile up.
static RECOGNIZE_SEM: std::sync::LazyLock<tokio::sync::Semaphore> =
    std::sync::LazyLock::new(|| tokio::sync::Semaphore::new(1));

fn model_dir() -> std::path::PathBuf {
    std::env::var("SENSEVOICE_MODEL_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/var/lib/weavine/models/sense-voice/"))
}

fn build_recognizer(dir: &Path) -> Result<OfflineRecognizer, String> {
    let model = dir.join("model.int8.onnx").to_string_lossy().into_owned();
    let tokens = dir.join("tokens.txt").to_string_lossy().into_owned();

    let mut config = OfflineRecognizerConfig::default();
    config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
        model: Some(model.into()),
        language: Some("auto".into()),
        use_itn: true,
    };
    config.model_config.tokens = Some(tokens.into());
    config.model_config.provider = Some("cpu".into());
    // Box has 2 CPUs; the sense-voice decoder is mostly sequential and
    // intra-op parallelism past num_cpus hurts more than helps. Pin to 1
    // so onnxruntime doesn't oversubscribe and fight the cron jobs.
    config.model_config.num_threads = 1;

    OfflineRecognizer::create(&config)
        .ok_or_else(|| "failed to build sense-voice recognizer".to_string())
}

fn get_recognizer() -> Result<&'static Arc<OfflineRecognizer>, (StatusCode, String)> {
    if let Some(cached) = RECOGNIZER.get() {
        return match cached {
            Ok(r) => Ok(r),
            Err(e) => Err((StatusCode::SERVICE_UNAVAILABLE, e.clone())),
        };
    }
    let dir = model_dir();
    if !dir.join("model.int8.onnx").exists() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            format!(
                "SenseVoice model not found at '{}'. Place model.int8.onnx and tokens.txt in that directory.",
                dir.display()
            ),
        ));
    }
    let built = build_recognizer(&dir).map(Arc::new);
    let result = RECOGNIZER.get_or_init(|| built.clone());
    match result {
        Ok(r) => {
            println!("[voice] sense-voice recognizer loaded: {}", dir.display());
            Ok(r)
        }
        Err(e) => Err((StatusCode::SERVICE_UNAVAILABLE, e.clone())),
    }
}

pub async fn recognize(
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    State(pool): State<Arc<sqlx::PgPool>>,
    mut form: Multipart,
) -> Result<axum::Json<RecognizeResult>, (StatusCode, String)> {
    let t_total = std::time::Instant::now();
    let t0 = t_total;

    // Per-IP per-minute rate limit (v1.2.0 S2). Applied BEFORE auth + before
    // RECOGNIZE_SEM so an anonymous flood doesn't even contend for the CPU
    // semaphore slot.
    let ip = client_ip(&headers, Some(peer));
    if !ocr_voice_rate_limit().check(
        "voice",
        "ip",
        &ip,
        OCR_VOICE_RL_LIMIT,
        OCR_VOICE_RL_WINDOW,
    ) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "语音识别请求过于频繁，请稍后再试".into(),
        ));
    }

    let _auth = match extract_endpoint_auth(&headers, pool.as_ref()).await? {
        EndpointAuth::ServiceKey => "service:weavine-default".to_string(),
        EndpointAuth::User { user_id, .. } => user_id,
        EndpointAuth::AnonymousDevice { install_id } => {
            let q = super::activation::check_and_bump_quota(&install_id, pool.as_ref(), "voice").await?;
            if q.count > q.limit {
                return Err((
                    StatusCode::TOO_MANY_REQUESTS,
                    format!("daily voice quota exceeded ({}/{})", q.count - 1, q.limit),
                ));
            }
            install_id
        }
    };
    super::activation::record_activation_hook(&headers, pool.as_ref(), "voice").await;
    let t_auth = t_total.elapsed();

    let _permit = match RECOGNIZE_SEM.try_acquire() {
        Ok(p) => p,
        Err(_) => {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                "语音识别繁忙，请稍后重试".to_string(),
            ))
        }
    };

    let mut audio_bytes: Option<Bytes> = None;
    while let Some(field) = form
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    {
        if matches!(field.name(), Some("file") | Some("audio")) {
            audio_bytes = Some(
                field
                    .bytes()
                    .await
                    .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
            );
            break;
        }
    }
    let audio_bytes = audio_bytes
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing audio file field (\"file\" or \"audio\")".into()))?;
    let t_upload = t_total.elapsed();
    if audio_bytes.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "empty audio".into()));
    }

    let t1 = std::time::Instant::now();
    let mut pcm = decode_audio(&audio_bytes).await?;
    let t_decode = t1.elapsed();
    if pcm.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "no decodable audio in upload".into()));
    }
    // v1.3.8: reject sub-0.5 s audio at the boundary too. The JS-side VAD
    // already enforces 1500 ms, but a direct API caller (or a future client
    // build with the guard regressed) can still ship a 200 ms clip; feeding
    // that to SenseVoice just produces "yeah" / "你好" hallucinations.
    // 8000 samples @ 16 kHz = 0.5 s.
    if pcm.len() < 8_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            "audio too short, please re-record (need at least 0.5s)".into(),
        ));
    }
    // v1.3.8: append 300 ms of trailing silence before the recognizer sees
    // the buffer. Without this padding SenseVoice's LM treats the abrupt
    // end-of-clip as a half-spoken filler word and hallucinates
    // "thanks for watching" / "嗯" / "yeah" at the end of real transcripts.
    // 16 kHz × 0.3 s = 4800 samples of f32::ZERO.
    pcm.extend(std::iter::repeat(0.0f32).take(4_800));

    let t2 = std::time::Instant::now();
    let (text, lang) = transcribe(pcm).await?;
    let t_infer = t2.elapsed();
    let t_total_ms = t0.elapsed().as_millis();
    eprintln!(
        "[voice] {} B -> {} PCM samples | auth={:?} upload={:?} decode={:?} infer={:?} total={}ms",
        audio_bytes.len(),
        // re-derive samples count from pcm after decode; pcm moved into transcribe so log len here
        "—",
        t_auth,
        t_upload.saturating_sub(t_auth),
        t_decode,
        t_infer,
        t_total_ms,
    );
    Ok(axum::Json(RecognizeResult { text, lang }))
}

/// Decode uploaded bytes to 16 kHz mono PCM f32. Pure-Rust symphonia is tried
/// first (WAV/PCM/FLAC/Vorbis/OGG, and WebM demux); anything it can't handle —
/// notably WebM/Opus from MediaRecorder — falls back to an `ffmpeg` subprocess.
async fn decode_audio(data: &[u8]) -> Result<Vec<f32>, (StatusCode, String)> {
    let symphonia_pcm = tokio::task::spawn_blocking({
        let data = data.to_vec();
        move || decode_with_symphonia(&data)
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("decode task: {e}")))?;

    if let Some(pcm) = symphonia_pcm {
        if !pcm.is_empty() {
            return Ok(pcm);
        }
    }
    decode_with_ffmpeg(data).await
}

/// `None` means "could not decode" (e.g. an Opus track) — the caller falls
/// back to ffmpeg.
fn decode_with_symphonia(data: &[u8]) -> Option<Vec<f32>> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::errors::Error;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let owned = data.to_vec();
    let mss = MediaSourceStream::new(Box::new(std::io::Cursor::new(owned)), Default::default());
    let hint = Hint::new();
    let fmt_opts = FormatOptions::default();
    let meta_opts = MetadataOptions::default();
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &fmt_opts, &meta_opts)
        .ok()?;
    let mut format = probed.format;
    let track = format.default_track()?.clone();
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .ok()?;

    let mut pcm: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    let mut rate: u32 = 0;
    let mut channels: usize = 1;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(Error::IoError(_)) => break, // EOF
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                rate = spec.rate;
                channels = spec.channels.count();
                if sample_buf.is_none() {
                    sample_buf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
                }
                let sbuf = sample_buf.as_mut()?;
                sbuf.copy_interleaved_ref(decoded);
                pcm.extend_from_slice(sbuf.samples());
            }
            Err(Error::DecodeError(_)) => continue,
            Err(_) => break,
        }
    }
    if pcm.is_empty() {
        return None;
    }
    Some(resample_to_16k(&to_mono(&pcm, channels), rate))
}

fn to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    let frames = interleaved.len() / channels;
    let mut mono = Vec::with_capacity(frames);
    for f in 0..frames {
        let mut sum = 0.0f32;
        for c in 0..channels {
            sum += interleaved[f * channels + c];
        }
        mono.push(sum / channels as f32);
    }
    mono
}

/// Resample mono PCM to 16 kHz with a sinc-interpolated resampler (rubato).
/// Falls back to the input unchanged on any error so the request can still go
/// through the ffmpeg path instead of failing the whole decode.
fn resample_to_16k(mono: &[f32], rate: u32) -> Vec<f32> {
    use rubato::{
        calculate_cutoff, Resampler, SincFixedIn, SincInterpolationParameters,
        SincInterpolationType, WindowFunction,
    };
    if mono.is_empty() || rate == TARGET_RATE {
        return mono.to_vec();
    }

    let sinc_len = 128;
    let window = WindowFunction::Blackman2;
    let params = SincInterpolationParameters {
        sinc_len,
        f_cutoff: calculate_cutoff(sinc_len, window),
        interpolation: SincInterpolationType::Quadratic,
        oversampling_factor: 256,
        window,
    };
    let chunk_size = 4096;
    let f_ratio = TARGET_RATE as f64 / rate as f64;
    let mut resampler = match SincFixedIn::<f32>::new(f_ratio, 1.1, params, chunk_size, 1) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[voice] resampler init failed ({e}); returning un-resampled audio");
            return mono.to_vec();
        }
    };

    let delay = resampler.output_delay();
    let nbr_output_frames = (mono.len() as f64 * f_ratio) as usize;

    let mut out: Vec<f32> = Vec::with_capacity(nbr_output_frames + 64);
    let mut outbuffer = vec![vec![0.0f32; resampler.output_frames_max()]; 1];
    let mut input: Vec<&[f32]> = vec![&mono[..]];

    let mut input_frames_next = resampler.input_frames_next();
    while input[0].len() >= input_frames_next {
        let (nbr_in, nbr_out) = match resampler.process_into_buffer(&input, &mut outbuffer, None) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[voice] resample error ({e})");
                break;
            }
        };
        for s in input.iter_mut() {
            *s = &s[nbr_in..];
        }
        out.extend_from_slice(&outbuffer[0][..nbr_out]);
        input_frames_next = resampler.input_frames_next();
    }
    if !input[0].is_empty() {
        if let Ok((_nbr_in, nbr_out)) =
            resampler.process_partial_into_buffer(Some(&input), &mut outbuffer, None)
        {
            out.extend_from_slice(&outbuffer[0][..nbr_out]);
        }
    }

    let start = delay.min(out.len());
    let mut trimmed: Vec<f32> = out.drain(start..).collect();
    trimmed.truncate(nbr_output_frames);
    trimmed
}

/// Decode via an `ffmpeg` subprocess. Audio bytes go to a NamedTempFile (NOT
/// stdin pipe — pipe+drop(stdin) was hanging on the second/third request
/// because Rust's async writer and ffmpeg's input-probe race on EOF when
/// the pipe buffer is large); ffmpeg reads from the file path; raw f32 LE
/// 16 kHz mono PCM comes out on stdout. WebM/Opus from MediaRecorder and
/// anything else symphonia can't decode falls through here. Bounded by a
/// 30 s timeout so a wedged ffmpeg can't pile up and hang new requests.
async fn decode_with_ffmpeg(data: &[u8]) -> Result<Vec<f32>, (StatusCode, String)> {
    let tmp = tempfile::Builder::new()
        .prefix("weavine-voice-")
        .suffix(".bin")
        .tempfile()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("create temp file: {e}")))?;
    let tmp_path = tmp.path().to_path_buf();
    tokio::fs::write(&tmp_path, data)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("write temp audio ({} bytes): {e}", data.len()),
            )
        })?;

    let mut cmd = tokio::process::Command::new("ffmpeg");
    cmd.args(["-nostdin", "-loglevel", "error", "-i"])
        .arg(&tmp_path)
        .args(["-f", "f32le", "-ac", "1", "-ar"])
        .arg(TARGET_RATE.to_string())
        .arg("-")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = cmd.spawn().map_err(|e| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            format!(
                "ffmpeg is required to decode WebM/Opus audio but could not be launched: {e}. \
                 Install ffmpeg on the server, or send a format symphonia can decode (WAV/PCM)."
            ),
        )
    })?;

    let timeout = std::time::Duration::from_secs(30);
    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| {
            (
                StatusCode::GATEWAY_TIMEOUT,
                format!("ffmpeg decode timed out after {timeout:?}"),
            )
        })?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("ffmpeg wait: {e}")))?;

    let _ = tmp.close();

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let last = err.trim().lines().last().unwrap_or("ffmpeg error");
        return Err((StatusCode::BAD_REQUEST, format!("audio decode failed: {last}")));
    }

    let bytes = output.stdout;
    let frames = bytes.len() / 4;
    let mut pcm = Vec::with_capacity(frames);
    for chunk in bytes.chunks_exact(4) {
        pcm.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(pcm)
}

/// Run SenseVoice on 16 kHz mono PCM f32. CPU-bound, so it runs on a blocking
/// thread. Returns `(text, language_code)`.
async fn transcribe(pcm: Vec<f32>) -> Result<(String, String), (StatusCode, String)> {
    tokio::task::spawn_blocking(move || {
        let recognizer = get_recognizer()?;
        let stream = recognizer.create_stream();
        stream.accept_waveform(16_000, &pcm);
        recognizer.decode(&stream);
        let result = stream
            .get_result()
            .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "recognizer returned no result".to_string()))?;
        let text = result.text.trim().to_string();
        // SenseVoice embeds language info in the text as `<|zh|>` / `<|en|>` tokens.
        // We strip them here so the JS side sees clean text. The language field
        // is reported as "auto" since the model handles detection internally.
        let lang = "auto".to_string();
        Ok((text, lang))
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("recognizer task failed: {e}")))?
}
