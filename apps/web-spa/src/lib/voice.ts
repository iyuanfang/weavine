import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

import { isTauri } from './adapter/tauri';

interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

// Android WebView's webkitSpeechRecognition needs the Google STT service + network.
// On an offline-first Tauri APK that's broken-by-design (permission granted, STT
// silently fails). Re-enable when a native STT plugin ships.
export function isAndroidTauri(): boolean {
  return isAndroid() && isTauri;
}

let voiceInFlight = false;

// Global lock so QuickFab and QuickCapture can't run two recordings at once.
// Android's whisper round-trip takes 20s+ on a 2-core server; a second,
// overlapping request would just pile up server-side and 504.
export function beginVoice(): boolean {
  if (voiceInFlight) return false;
  voiceInFlight = true;
  return true;
}

export function endVoice(): void {
  voiceInFlight = false;
}

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionAvailable(): boolean {
  return recognitionCtor() !== null;
}

export function recognizeSpeech(lang = 'zh-CN'): Promise<string> {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    return Promise.reject(new Error('当前环境不支持语音识别'));
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    rec.onresult = (event) => {
      if (settled) return;
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      settled = true;
      resolve(transcript);
    };
    rec.onerror = (event) => {
      if (settled) return;
      settled = true;
      reject(new Error(`语音识别失败：${event.error}`));
    };
    rec.onend = () => {
      if (settled) return;
      settled = true;
      reject(new Error('未识别到语音'));
    };
    rec.start();
  });
}

// ── Cloud STT (Tauri → weavine-server whisper) ─────────────────

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取录音失败'));
    reader.readAsDataURL(blob);
  });
}

function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export function recordAudio(maxMs = 15000): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      reject(new Error('当前环境不支持录音'));
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        // Android WebView's audio pipeline needs a moment to initialize;
        // starting the recorder immediately can capture a short silent lead-in.
        // NOTE: do NOT stop the tracks as a "warm-up" — that kills the mic
        // and the recorder ends up with a dead stream (no data, empty blob,
        // server returns "empty audio"). Instead, delay recorder.start().
        const mime = pickRecorderMime();
        let recorder: MediaRecorder;
        try {
          recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        } catch (e) {
          stream.getTracks().forEach((t) => t.stop());
          reject(new Error(`录音初始化失败（${e instanceof Error ? e.message : String(e)}）`));
          return;
        }
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: mime ?? 'audio/webm' }));
        };
        recorder.onerror = () => {
          stream.getTracks().forEach((t) => t.stop());
          reject(new Error('录音失败'));
        };
        // Delay start so the audio pipeline warms up without dropping samples.
        window.setTimeout(() => {
          try {
            recorder.start();
          } catch (e) {
            stream.getTracks().forEach((t) => t.stop());
            reject(new Error(`录音启动失败：${e instanceof Error ? e.message : String(e)}`));
          }
        }, 200);
        window.setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
        }, maxMs);
      })
      .catch((e: unknown) => {
        const name = (e as { name?: string } | null)?.name ?? '';
        const msg = e instanceof Error ? e.message : String(e ?? '');
        if (name === 'NotAllowedError' || /permission/i.test(msg)) {
          reject(new Error('无法访问麦克风：请在系统设置中授予应用麦克风权限'));
          return;
        }
        if (name === 'NotFoundError') {
          reject(new Error('无法访问麦克风：未检测到麦克风设备'));
          return;
        }
        reject(new Error(`无法访问麦克风（${name || 'unknown'}）：${msg || '未知错误'}`));
      });
  });
}

export async function recognizeCloud(audioBlob: Blob): Promise<string> {
  if (!isTauri) {
    throw new Error('云端语音识别仅在 Tauri 客户端可用');
  }
  const audioBase64 = await blobToBase64(audioBlob);
  return invoke<string>('recognize_voice', { audio_base64: audioBase64 });
}

// ── Local on-device STT (Android only, sherpa-onnx Whisper tiny) ──
// The 30 MB Whisper-tiny multilingual model is downloaded on first use
// (see commands/voice_local.rs). Audio is decoded in WebView at 16 kHz mono
// Float32 and shipped to the Rust side which runs inference on-device.

export interface VoiceModelStatus {
  ready: boolean;
  /** Total bytes expected to be downloaded (~30 MB tar.bz2). */
  downloadBytes?: number;
  /** Path to model dir on disk when ready. */
  modelDir?: string;
  /** Reason if not ready. */
  error?: string;
}

export function checkVoiceModel(): Promise<VoiceModelStatus> {
  return invoke<VoiceModelStatus>('check_voice_model');
}

export interface ModelDownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  /** Stage: 'download' | 'extract' | 'done' | 'error' */
  stage: 'download' | 'extract' | 'done' | 'error';
  message?: string;
}

export async function downloadVoiceModel(
  onProgress?: (p: ModelDownloadProgress) => void,
): Promise<void> {
  let unlisten: UnlistenFn | undefined;
  if (onProgress) {
    unlisten = await listen<ModelDownloadProgress>('voice-model-download-progress', (event) => {
      onProgress(event.payload);
    });
  }
  try {
    await invoke<void>('download_voice_model');
  } finally {
    if (unlisten) unlisten();
  }
}

/**
 * Decode any recorded audio Blob to 16 kHz mono Float32 PCM and ship it
 * to the Rust recognizer. The Rust side accepts raw little-endian f32
 * bytes via `Vec<u8>` reinterpret.
 */
async function decodeToPcm16kMono(blob: Blob): Promise<ArrayBuffer> {
  const arrayBuf = await blob.arrayBuffer();
  const Ctor: typeof AudioContext | undefined =
    typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Ctor) throw new Error('当前环境不支持本地语音识别（缺少 AudioContext）');
  const ctx = new Ctor({ sampleRate: 16000 });
  try {
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    const channelCount = decoded.numberOfChannels;
    const length = decoded.length;
    const out = new Float32Array(length);
    if (channelCount === 1) {
      out.set(decoded.getChannelData(0));
    } else {
      for (let ch = 0; ch < channelCount; ch++) {
        const data = decoded.getChannelData(ch);
        for (let i = 0; i < length; i++) out[i] += data[i];
      }
      for (let i = 0; i < length; i++) out[i] /= channelCount;
    }
    // Browsers always store Float32 as little-endian, matching the
    // platform Rust expects via `bytemuck::cast_slice::<u8, f32>`.
    return out.buffer;
  } finally {
    void ctx.close();
  }
}

export async function recognizeLocal(audioBlob: Blob): Promise<string> {
  if (!isTauri) {
    throw new Error('本地语音识别仅在 Tauri 客户端可用');
  }
  if (audioBlob.size === 0) {
    throw new Error('录音为空，请重试');
  }
  const pcmBuf = await decodeToPcm16kMono(audioBlob);
  const samples = new Uint8Array(pcmBuf);
  return invoke<string>('recognize_voice_local', {
    pcm_base64: arrayBufferToBase64(samples.buffer),
  });
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}