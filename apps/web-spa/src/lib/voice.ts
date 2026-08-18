import { invoke } from '@tauri-apps/api/core';

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
        // Android WebView needs a short warm-up for the audio pipeline to
        // initialize. Starting the recorder immediately captures silence.
        stream.getTracks().forEach((t) => t.stop());
        return stream;
      })
      .then((stream) => {
        const mime = pickRecorderMime();
        const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
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
        recorder.start();
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