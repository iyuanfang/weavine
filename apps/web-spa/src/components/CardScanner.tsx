import { useState } from 'react';

import {
  MAX_OCR_SIZE,
  type OcrResult,
  callOcrExtract,
  downsampleImage,
  readFileAsDataUrl,
} from '../lib/ocr-client';

export interface ScannedFields {
  name?: string | null;
  company?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string[];
  address?: string | null;
}

interface Props {
  onApply: (fields: ScannedFields) => void;
  disabled?: boolean;
}

const DOWNSAMPLE_SIZE = 2 * 1024 * 1024;
const DOWNSAMPLE_MAX_W = 1600;

export function CardScanner({ onApply, disabled }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (file: File) => {
    setError(null);
    setResult(null);
    if (file.size > MAX_OCR_SIZE) {
      setError('图片过大，请压缩到 10MB 以下');
      return;
    }
    const processed = await downsampleImage(file, {
      maxWidth: DOWNSAMPLE_MAX_W,
      minBytes: DOWNSAMPLE_SIZE,
      quality: 0.85,
      mime: file.type,
    });
    const dataUrl = await readFileAsDataUrl(processed);
    setPreview(dataUrl);
    setBusy(true);
    try {
      const r = await callOcrExtract(dataUrl, 'card.png');
      setResult(r);
      // Apply the OCR result to the parent form immediately — no manual
      // confirm step. The user can edit or clear fields afterwards.
      onApply({
        name: r.fields.name,
        company: r.fields.company,
        title: r.fields.title,
        email: r.fields.email,
        phone: r.fields.phone ?? [],
        address: r.fields.address,
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
        <label
          className="btn btn-secondary"
          style={{ cursor: 'pointer', flexShrink: 0 }}
        >
          {preview ? '换一张' : '📷 扫名片'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            capture="environment"
            data-testid="card-scanner-input"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
              e.target.value = '';
            }}
          />
        </label>
        {preview && (
          <img
            src={preview}
            alt="card preview"
            data-testid="card-scanner-preview"
            style={{ width: 88, height: 56, objectFit: 'cover', borderRadius: 4 }}
          />
        )}
        {busy && <span style={{ color: 'var(--muted)' }} data-testid="card-scanner-busy">识别中…</span>}
        {result && (
          <span style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }} data-testid="card-scanner-confidence">
            置信度 {Math.round(result.avg_confidence * 100)}%
            {result.langs_actual.length > 0 && ` · ${result.langs_actual.join('+')}`}
          </span>
        )}
      </div>

      {error && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: '#fef2f2',
            color: '#dc2626',
            borderRadius: 4,
            fontSize: 'var(--text-sm)',
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }} data-testid="card-scanner-fields">
          {(() => {
            const pairs: [string, string | null | undefined][] = [
              ['姓名', result.fields.name],
              ['公司', result.fields.company],
              ['职位', result.fields.title],
              ['邮箱', result.fields.email],
              ['电话', (result.fields.phone ?? []).join(' / ')],
              ['地址', result.fields.address],
            ];
            return pairs.map(([label, value]) =>
              value ? (
                <div
                  key={label}
                  data-testid={`card-scanner-field-${label}`}
                  style={{ display: 'flex', gap: 8, fontSize: 'var(--text-sm)' }}
                >
                  <span style={{ color: 'var(--muted)', minWidth: 48 }}>{label}</span>
                  <span style={{ flex: 1 }}>{value}</span>
                </div>
              ) : null,
            );
          })()}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <details style={{ fontSize: 'var(--text-sm)' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>
                查看原始文本
              </summary>
              <pre
                style={{
                  marginTop: 6,
                  padding: 8,
                  background: 'var(--surface-2, #f9fafb)',
                  borderRadius: 4,
                  fontSize: 'var(--text-xs)',
                  whiteSpace: 'pre-wrap',
                  maxHeight: 160,
                  overflow: 'auto',
                }}
              >
                {result.raw_text}
              </pre>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}