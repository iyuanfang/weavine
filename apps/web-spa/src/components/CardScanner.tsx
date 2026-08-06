import { useState } from 'react';

import { isTauri } from '../lib/adapter';
import { getAccessToken } from '../lib/auth/storage';

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

interface ScanResult {
  raw_text: string;
  avg_confidence: number;
  langs_actual: string[];
  fields: ScannedFields;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function callExtract(imageBase64: string): Promise<ScanResult> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    const r = await invoke<ScanResult>('extract_card', { imageBase64 });
    return r;
  }
  const m = imageBase64.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error('invalid data URL');
  const mime = m[1];
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  const form = new FormData();
  form.append('file', blob, 'card.png');
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch('/api/cards/extract', {
    method: 'POST',
    body: form,
    credentials: 'include',
    headers,
  });
  if (!resp.ok) {
    throw new Error(`ocr failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

export function CardScanner({ onApply, disabled }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (file: File) => {
    setError(null);
    setResult(null);
    const dataUrl = await readAsDataUrl(file);
    setPreview(dataUrl);
    setBusy(true);
    try {
      const r = await callExtract(dataUrl);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!result) return;
    onApply({
      name: result.fields.name,
      company: result.fields.company,
      title: result.fields.title,
      email: result.fields.email,
      phone: result.fields.phone ?? [],
      address: result.fields.address,
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
        <label
          className="btn btn-secondary"
          style={{ cursor: 'pointer', flexShrink: 0 }}
        >
          {preview ? '换一张' : '📷 扫名片'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
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
            <button
              type="button"
              className="btn btn-primary"
              onClick={apply}
              disabled={busy}
              data-testid="card-scanner-apply"
            >
              应用到表单
            </button>
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