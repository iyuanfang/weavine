//! Speech-to-text via whisper.cpp (whisper-rs).
//!
//! `POST /api/voice/recognize` (feature `stt`): accepts a multipart audio file,
//! decodes it to 16 kHz mono PCM f32, runs whisper, returns `{ text, lang }`.
//!
//! Auth is zero-friction: the shared service key (`WV_SERVICE_KEY`, or a random
//! one logged at startup) via `X-Service-Key` / `Authorization: Bearer`, or a
//! normal user JWT/API key. No DB rows are written — the service path uses the
//! synthetic user id from `auth::extract_auth_with_service`.

use axum::{
    body::Bytes,
    extract::{multipart::Multipart, State},
    http::{HeaderMap, StatusCode},
};
use serde::Serialize;
use std::sync::{Arc, OnceLock};
use tokio::io::AsyncWriteExt;
use super::auth::{extract_endpoint_auth, EndpointAuth};

use whisper_rs::{
    get_lang_str, FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
};

const TARGET_RATE: u32 = 16000;

#[derive(Debug, Serialize)]
pub struct RecognizeResult {
    pub text: String,
    pub lang: String,
}

static WHISPER: OnceLock<WhisperContext> = OnceLock::new();

fn model_path() -> std::path::PathBuf {
    std::env::var("WHISPER_MODEL")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/var/lib/weavine/models/ggml-tiny.bin"))
}

fn get_whisper() -> Result<&'static WhisperContext, (StatusCode, String)> {
    if let Some(ctx) = WHISPER.get() {
        return Ok(ctx);
    }
    let path = model_path();
    if !path.exists() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            format!(
                "whisper model not found at '{}'. Download a ggml model and set WHISPER_MODEL, e.g.:\n  curl -L -o {0} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
                path.display()
            ),
        ));
    }
    let path_str = path.to_string_lossy().into_owned();
    let ctx = WhisperContext::new_with_params(&path_str, WhisperContextParameters::default())
        .map_err(|e| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                format!("failed to load whisper model '{}': {e}", path.display()),
            )
        })?;
    match WHISPER.set(ctx) {
        Ok(()) => {
            println!("[voice] whisper model loaded: {}", path.display());
            Ok(WHISPER.get().expect("just set"))
        }
        Err(_) => Ok(WHISPER.get().expect("set by racing task")),
    }
}

pub async fn recognize(
    headers: HeaderMap,
    State(pool): State<Arc<sqlx::PgPool>>,
    mut form: Multipart,
) -> Result<axum::Json<RecognizeResult>, (StatusCode, String)> {
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
    if audio_bytes.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "empty audio".into()));
    }

    let pcm = decode_audio(&audio_bytes).await?;
    if pcm.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "no decodable audio in upload".into()));
    }

    let (text, lang) = transcribe(pcm).await?;
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

/// Decode via an `ffmpeg` subprocess: bytes in on stdin, raw f32 LE 16 kHz mono
/// PCM out on stdout. Handles WebM/Opus from MediaRecorder and anything else.
async fn decode_with_ffmpeg(data: &[u8]) -> Result<Vec<f32>, (StatusCode, String)> {
    let mut cmd = tokio::process::Command::new("ffmpeg");
    cmd.args(["-nostdin", "-loglevel", "error", "-i", "-", "-f", "f32le", "-ac", "1", "-ar"])
        .arg(TARGET_RATE.to_string())
        .arg("-")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            format!(
                "ffmpeg is required to decode WebM/Opus audio but could not be launched: {e}. \
                 Install ffmpeg on the server, or send a format symphonia can decode (WAV/PCM)."
            ),
        )
    })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "ffmpeg stdin unavailable".to_string()))?;
    stdin
        .write_all(data)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("write ffmpeg stdin: {e}")))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("ffmpeg wait: {e}")))?;

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

/// Run whisper on 16 kHz mono PCM f32. CPU-bound, so it runs on a blocking
/// thread. Returns `(text, language_code)`.
async fn transcribe(pcm: Vec<f32>) -> Result<(String, String), (StatusCode, String)> {
    tokio::task::spawn_blocking(move || {
        let ctx = get_whisper()?;
        let mut state = ctx.create_state().map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("create whisper state: {e}"))
        })?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_detect_language(true);
        params.set_language(None);
        params.set_n_threads(4);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_max_len(0);

        state.full(params, &pcm).map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("whisper inference failed: {e}"))
        })?;

        let mut text = String::new();
        let n = state.full_n_segments();
        for i in 0..n {
            if let Some(seg) = state.get_segment(i) {
                if let Ok(t) = seg.to_str() {
                    text.push_str(t);
                }
            }
        }
        let lang = get_lang_str(state.full_lang_id_from_state()).unwrap_or("unknown").to_string();
        Ok((text.trim().to_string(), lang))
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("whisper task failed: {e}")))?
}
