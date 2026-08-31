import { useState } from 'react';

import type { Contact } from '../lib/adapter/types';
import { CardScanner, type ScannedFields } from './CardScanner';

interface Props {
  contact: Contact;
  onClose: () => void;
  onConfirm: (input: {
    picked: Partial<Record<keyof ScannedFields, boolean>>;
    scanned: ScannedFields;
  }) => Promise<void>;
}

type FieldKey = 'name' | 'company' | 'title' | 'email' | 'phone' | 'address';

const FIELD_LABELS: Record<FieldKey, string> = {
  name: '姓名',
  company: '公司',
  title: '职位',
  email: '邮箱',
  phone: '电话',
  address: '地址',
};

const FIELD_ORDER: FieldKey[] = ['name', 'company', 'title', 'email', 'phone', 'address'];

function nonEmptyFields(f: ScannedFields): FieldKey[] {
  const keys: FieldKey[] = [];
  if (f.name) keys.push('name');
  if (f.company) keys.push('company');
  if (f.title) keys.push('title');
  if (f.email) keys.push('email');
  if (f.phone && f.phone.length > 0) keys.push('phone');
  if (f.address) keys.push('address');
  return keys;
}

function displayValue(key: FieldKey, f: ScannedFields): string {
  if (key === 'phone') return (f.phone ?? []).join(' / ');
  const v = f[key];
  return v ?? '';
}

export function RescanCardModal({ contact, onClose, onConfirm }: Props) {
  const [scanned, setScanned] = useState<ScannedFields | null>(null);
  const [picks, setPicks] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onApply = (f: ScannedFields) => {
    setScanned(f);
    const present = nonEmptyFields(f);
    const initial: Partial<Record<FieldKey, boolean>> = {};
    for (const k of present) initial[k] = true;
    setPicks(initial);
  };

  const onBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !submitting) onClose();
  };

  const onConfirmClick = async () => {
    if (!scanned) return;
    const picked: Partial<Record<FieldKey, boolean>> = {};
    for (const k of FIELD_ORDER) {
      if (picks[k]) picked[k] = true;
    }
    if (Object.keys(picked).length === 0) {
      setSubmitError('请至少选择一个字段');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm({ picked, scanned });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  const presentKeys = scanned ? nonEmptyFields(scanned) : [];
  const anyChecked = scanned
    ? FIELD_ORDER.some((k) => picks[k] && presentKeys.includes(k))
    : false;

  return (
    <div className="modal-backdrop" data-testid="rescan-card-modal" onClick={onBackdrop}>
      <div
        className="modal"
        data-testid="rescan-card-modal-inner"
        style={{ width: 560, maxWidth: '92vw', padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 6px 0', fontSize: 'var(--text-lg)' }}>重新拍名片</h2>
        <p className="text-xs text-muted" style={{ margin: '0 0 14px 0' }}>
          将覆盖「{contact.nickname}」的部分字段。仅勾选的字段会被更新。
        </p>

        {!scanned && (
          <CardScanner onApply={onApply} disabled={submitting} />
        )}

        {scanned && (
          <div data-testid="rescan-card-confirm">
            <div
              style={{
                marginBottom: 12,
                padding: 8,
                background: 'var(--surface-2, #f9fafb)',
                borderRadius: 4,
                fontSize: 'var(--text-sm)',
                color: 'var(--muted)',
              }}
            >
              已识别 {presentKeys.length} 个字段，勾选要覆盖的项目：
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              {FIELD_ORDER.map((k) => {
                if (!presentKeys.includes(k)) return null;
                const newVal = displayValue(k, scanned);
                const current =
                  k === 'phone'
                    ? contact.phone ?? ''
                    : (contact[k] as string | null) ?? '';
                const checked = !!picks[k];
                return (
                  <label
                    key={k}
                    data-testid={`rescan-card-row-${k}`}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-start',
                      padding: 8,
                      border: `1px solid ${checked ? 'var(--accent, #8b5cf6)' : 'var(--border)'}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: checked ? 'var(--accent-soft, rgba(139,92,246,0.06))' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setPicks((prev) => ({ ...prev, [k]: e.target.checked }))
                      }
                      disabled={submitting}
                      style={{ marginTop: 2 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 'var(--text-sm)' }}>
                        {FIELD_LABELS[k]}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--text-sm)',
                          color: 'var(--muted)',
                          marginTop: 2,
                          wordBreak: 'break-word',
                        }}
                      >
                        当前：{current || <em style={{ opacity: 0.6 }}>（空）</em>}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--text-sm)',
                          marginTop: 2,
                          wordBreak: 'break-word',
                        }}
                      >
                        新值：{newVal}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {submitError && (
              <div
                role="alert"
                style={{
                  marginTop: 10,
                  padding: 8,
                  background: '#fef2f2',
                  color: '#dc2626',
                  borderRadius: 4,
                  fontSize: 'var(--text-sm)',
                }}
              >
                {submitError}
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 16,
          }}
        >
          {scanned && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setScanned(null);
                setPicks({});
                setSubmitError(null);
              }}
              disabled={submitting}
            >
              重拍
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            取消
          </button>
          {scanned && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onConfirmClick}
              disabled={submitting || !anyChecked}
              data-testid="rescan-card-submit"
            >
              {submitting ? '保存中…' : '确认更新'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
