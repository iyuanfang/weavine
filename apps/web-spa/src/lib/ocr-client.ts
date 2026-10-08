// Shared client-side OCR plumbing used by both CardScanner and WechatScanner.
//
// Both scanners hit the same /api/cards/extract endpoint with a multipart
// `file` field and receive the same OcrResult shape — the post-processing
// (which fields to apply) is what differs. Keeping the transport in one place
// means a fix to header injection, error mapping, or rate-limit handling
// lands everywhere at once.

import { isTauri } from './adapter';
import { getAccessToken } from './auth/storage';
import { getDeviceKey, getOrCreateInstallId, osStr, platformStr } from './install-id';

export interface OcrLine {
  text: string;
}

export interface OcrFields {
  name?: string | null;
  company?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string[];
  address?: string | null;
}

export interface OcrResult {
  raw_text: string;
  lines: OcrLine[];
  fields: OcrFields;
  avg_confidence: number;
  langs: string;
  langs_actual: string[];
}

export const MAX_OCR_SIZE = 10 * 1024 * 1024;

export interface DownsampleOptions {
  /** Target max width in CSS pixels. Source above this is scaled down. */
  maxWidth: number;
  /** Only downsample when source exceeds this byte threshold. */
  minBytes?: number;
  /** JPEG quality when re-encoding (1.0 = lossless). 0.85 by default. */
  quality?: number;
  /** MIME type of the output blob — usually matches the source. */
  mime?: string;
}

/** Re-encode a photo to a smaller JPEG/PNG when it exceeds the size cap. */
export function downsampleImage(file: File, opts: DownsampleOptions): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const targetMime = opts.mime ?? file.type ?? 'image/jpeg';
      if (opts.minBytes != null && file.size <= opts.minBytes && img.width <= opts.maxWidth) {
        resolve(file);
        return;
      }
      const scale = Math.min(1, opts.maxWidth / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(new File([blob], file.name, { type: targetMime }))
            : reject(new Error('downsample failed')),
        targetMime,
        opts.quality ?? 0.85,
      );
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = URL.createObjectURL(file);
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function stripDataUrlPrefix(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    // Anonymous installs have no JWT — the server accepts X-Device-Key
    // (minted by /api/activation/ping on first launch) for these endpoints.
    'X-Install-Id': getOrCreateInstallId(),
    'X-Client-Platform': platformStr(),
    'X-Client-OS': osStr(),
    'X-Device-Key': getDeviceKey() ?? '',
  };
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * Hit the OCR endpoint with a base64-encoded image. In Tauri, this delegates
 * to the `extract_card` Rust command (which proxies to the server using the
 * persisted credentials); in the browser it talks to /api/cards/extract
 * directly with the activation + auth headers above.
 */
export async function callOcrExtract(imageBase64: string, filename: string): Promise<OcrResult> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<OcrResult>('extract_card', {
      image_base64: stripDataUrlPrefix(imageBase64),
    });
  }
  const m = imageBase64.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error('invalid data URL');
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: m[1] }), filename);
  const resp = await fetch('/api/cards/extract', {
    method: 'POST',
    body: form,
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!resp.ok) {
    if (resp.status === 413) throw new Error('图片过大，请压缩到 10MB 以下');
    if (resp.status === 408 || resp.status === 504) throw new Error('OCR 处理超时，请上传更小的图片');
    if (resp.status === 401) throw new Error('登录已过期，请刷新页面后重试');
    if (resp.status === 429) throw new Error('OCR 请求过于频繁，请稍后再试');
    throw new Error(`OCR 失败 (${resp.status})：网络不稳定或图片过大，请重试`);
  }
  return resp.json();
}