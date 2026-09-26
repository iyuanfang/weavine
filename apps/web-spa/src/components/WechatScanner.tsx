import { useState } from 'react';

import { isTauri } from '../lib/adapter';
import { getAccessToken } from '../lib/auth/storage';
import { getDeviceKey, getOrCreateInstallId, osStr, platformStr } from '../lib/install-id';
import { parseWechatProfile, type WechatProfile } from '../lib/wechat-import';

export interface WechatFields {
  nickname: string | null;
  name: string | null;
  wechat: string | null;
  phone: string | null;
  address: string | null;
  tags: string[];
}

interface Props {
  onApply: (fields: WechatFields) => void;
  disabled?: boolean;
}

interface OcrResponse {
  raw_text: string;
  avg_confidence: number;
}

// Shared with CardScanner: phone photos are 3-8 MB, the API caps at 10 MB,
// and PaddleOCR is faster on smaller inputs.
const MAX_OCR_SIZE = 10 * 1024 * 1024;
// Always re-encode phone screenshots: originals are 3-8 MB and large uploads
// get reset by mobile networks mid-flight ("Failed to fetch"). 1400px wide
// JPEG q0.82 is plenty for the fixed-template OCR.
const DOWNSAMPLE_MAX_W = 800;
const JPEG_QUALITY = 0.82;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function ocrImage(dataUrl: string): Promise<OcrResponse> {
  const strip = (s: string) => {
    const i = s.indexOf(',');
    return i >= 0 ? s.slice(i + 1) : s;
  };
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<OcrResponse>('extract_card', { image_base64: strip(dataUrl) });
  }
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error('invalid data URL');
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: m[1] }), 'wechat.png');
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
  const resp = await fetch('/api/cards/extract', {
    method: 'POST',
    body: form,
    credentials: 'include',
    headers,
  });
  if (!resp.ok) {
    if (resp.status === 413) throw new Error('图片过大，请压缩到 10MB 以下');
    if (resp.status === 408 || resp.status === 504) throw new Error('OCR 处理超时，请重试');
    if (resp.status === 401) throw new Error('登录已过期，请刷新页面后重试');
    throw new Error(`OCR 失败 (${resp.status})：网络不稳定或图片过大，请重试`);
  }
  return resp.json();
}

function downsample(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, DOWNSAMPLE_MAX_W / img.width);
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
            ? resolve(new File([blob], 'wechat.jpg', { type: 'image/jpeg' }))
            : reject(new Error('downsample failed')),
        'image/jpeg',
        JPEG_QUALITY,
      );
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = URL.createObjectURL(file);
  });
}

export function WechatScanner({ onApply, disabled }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [parsed, setParsed] = useState<WechatProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (file: File) => {
    setError(null);
    setParsed(null);
    if (file.size > MAX_OCR_SIZE) {
      setError('图片过大，请压缩到 10MB 以下');
      return;
    }
    const processed = await downsample(file);
    const dataUrl = await readAsDataUrl(processed);
    setPreview(dataUrl);
    setBusy(true);
    try {
      const r = await ocrImage(dataUrl);
      const profile = parseWechatProfile(r.raw_text);
      if (!profile) {
        setError('未识别出微信资料页——请上传「联系人详情页」截图（含 微信号/昵称 的那页）');
        return;
      }
      setParsed(profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!parsed) return;
    onApply({
      nickname: parsed.nickname,
      name: parsed.name,
      wechat: parsed.wechat,
      phone: parsed.phone,
      address: parsed.address,
      tags: parsed.tags,
    });
  };

  return (
    <div
      style={{
        border: '1px dashed var(--border)',
        borderRadius: 8,
        padding: 12,
        background: 'var(--surface)',
        opacity: disabled ? 0.6 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label className="btn btn-secondary" style={{ cursor: 'pointer', flexShrink: 0 }}>
          {preview ? '换一张' : '💬 微信截图'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            data-testid="wechat-scanner-input"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
              e.currentTarget.value = '';
            }}
          />
        </label>
        {!preview && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', flexShrink: 0 }}>
            详情页
          </div>
        )}
      </div>

      {busy && <div style={{ marginTop: 8, fontSize: 'var(--text-sm)' }}>识别中…</div>}
      {error && (
        <div style={{ marginTop: 8, fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</div>
      )}
      {parsed && (
        <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)', lineHeight: 1.7 }}>
            {parsed.nickname && <div>备注: {parsed.nickname}</div>}
            {parsed.name && <div>昵称: {parsed.name}</div>}
            {parsed.wechat && <div>微信号: {parsed.wechat}</div>}
            {parsed.phone && <div>电话: {parsed.phone}</div>}
            {parsed.address && <div>地区: {parsed.address}</div>}
            {parsed.tags.length > 0 && <div>标签: {parsed.tags.join('、')}</div>}
          </div>
          <button type="button" className="btn btn-primary" onClick={apply} style={{ flexShrink: 0 }}>
            填入表单
          </button>
        </div>
      )}
    </div>
  );
}
