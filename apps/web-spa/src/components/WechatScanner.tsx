import { useState } from 'react';

import {
  MAX_OCR_SIZE,
  callOcrExtract,
  downsampleImage,
  readFileAsDataUrl,
} from '../lib/ocr-client';
import { parseWechatProfile } from '../lib/wechat-import';

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

// Always re-encode phone screenshots: originals are 3-8 MB and large uploads
// get reset by mobile networks mid-flight ("Failed to fetch"). 600px wide
// JPEG q65 is plenty for the fixed-template OCR.
const DOWNSAMPLE_MAX_W = 600;
const JPEG_QUALITY = 0.65;

export function WechatScanner({ onApply, disabled }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (file: File) => {
    setError(null);
    if (file.size > MAX_OCR_SIZE) {
      setError('图片过大，请压缩到 10MB 以下');
      return;
    }
    const processed = await downsampleImage(file, {
      maxWidth: DOWNSAMPLE_MAX_W,
      quality: JPEG_QUALITY,
      mime: 'image/jpeg',
    });
    const dataUrl = await readFileAsDataUrl(processed);
    setPreview(dataUrl);
    setBusy(true);
    try {
      const r = await callOcrExtract(dataUrl, 'wechat.png');
      const profile = parseWechatProfile(r.raw_text);
      if (!profile) {
        setError('未识别出微信资料页——请上传「联系人详情页」截图（含 微信号/昵称 的那页）');
        return;
      }
      // Apply the OCR result to the parent form immediately — no manual
      // confirm step. The user can edit or clear fields afterwards.
      onApply({
        nickname: profile.nickname,
        name: profile.name,
        wechat: profile.wechat,
        phone: profile.phone,
        address: profile.address,
        tags: profile.tags,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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

    </div>
  );
}
