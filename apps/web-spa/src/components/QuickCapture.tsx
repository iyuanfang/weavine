import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { parseQuick } from '../lib/adapter/quick-capture';
import { beginVoice, checkVoiceModel, endVoice, isAndroidTauri, recognizeCloud, recognizeLocal, recognizeSpeech, recordAudio, speechRecognitionAvailable, voiceMode } from '../lib/voice';
import type { ParsedQuick, QuickKind } from '../lib/quick-types';

const KIND_LABEL: Record<QuickKind, string> = {
  event: '事件',
  action: '待办',
  interaction: '互动',
};

const KIND_ICON: Record<QuickKind, string> = {
  event: '📅',
  action: '✅',
  interaction: '💬',
};

function formatDue(due: string | null): string {
  if (!due) return '未指定';
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return due;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `今天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span
        style={{
          flexShrink: 0,
          width: 44,
          color: 'var(--muted)',
          fontSize: 'var(--text-sm)',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 'var(--text-base)' }}>{value}</span>
    </div>
  );
}

interface Props {
  onClose: () => void;
  initialText?: string;
}

export function QuickCapture({ onClose, initialText = '' }: Props) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const userId = useUserId() ?? '';
  const [text, setText] = useState(initialText);
  const [parsed, setParsed] = useState<ParsedQuick | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [contactNames, setContactNames] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [selectedKind, setSelectedKind] = useState<QuickKind | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    adapter.contacts
      .list({ user_id: userId })
      .then((data: { items: Array<{ nickname: string; name?: string | null }> }) => {
        setContactNames(data.items.flatMap((c) => [c.nickname, ...(c.name ? [c.name] : [])]));
      })
      .catch(() => {});
  }, [adapter, userId]);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const trimmed = text.trim();
    if (!trimmed) {
      setParsed(null);
      setError(null);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      parseQuick(trimmed, contactNames, userId)
        .then((p) => {
          setParsed(p);
          setSelectedKind(p.kind);
          setError(null);
        })
        .catch((e: unknown) => {
          setParsed(null);
          setSelectedKind(null);
          setError(e instanceof Error ? e.message : String(e));
        });
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [text, contactNames, userId]);

  const handleVoice = () => {
    if (!beginVoice()) return;
    setListening(true);
    const done = (transcript: string) => {
      setText(transcript);
      inputRef.current?.focus();
    };
    const fail = (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    };
    const release = () => {
      setListening(false);
      endVoice();
    };
    if (isAndroidTauri()) {
      // Two APK flavors: `voice-local` uses sherpa-onnx on-device;
      // `voice-cloud` POSTs to /api/voice/recognize. Both share the same
      // recording pipeline; only the recognizer call differs.
      if (voiceMode() === 'local') {
        recordAudio()
          .then(async (blob) => {
            const status = await checkVoiceModel();
            if (!status.ready) {
              throw new Error(status.error ?? '语音模型尚未就绪，请稍后重试');
            }
            return recognizeLocal(blob);
          })
          .then(done)
          .catch((e: unknown) => {
            fail(e);
          })
          .finally(() => {
            release();
          });
      } else {
        recordAudio()
          .then(async (blob) => recognizeCloud(blob))
          .then(done)
          .catch(fail)
          .finally(release);
      }
      return;
    }
    recognizeSpeech()
      .then(done)
      .catch(fail)
      .finally(release);
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!userId) {
      setError('本地用户尚未就绪，请稍候再试');
      return;
    }
    try {
      const p = parsed ?? (await parseQuick(trimmed, contactNames, userId));
      const summary = p.summary || trimmed;
      const now = new Date().toISOString();
      const effectiveKind: QuickKind = selectedKind ?? p.kind;
      switch (effectiveKind) {
        case 'event':
          await adapter.events.create({
            user_id: userId,
            title: summary,
            type: '其他',
            start_at: p.due ?? now,
            contact_id: p.contact_id,
          });
          queryClient.invalidateQueries({ queryKey: ['events', userId] });
          break;
        case 'action':
          await adapter.actions.create({
            user_id: userId,
            title: summary,
            due_at: p.due,
            contact_id: p.contact_id,
          });
          queryClient.invalidateQueries({ queryKey: ['actions', userId] });
          break;
        case 'interaction':
          await adapter.interactions.create({
            user_id: userId,
            summary,
            occurred_at: p.due ?? now,
            contact_id: p.contact_id,
          });
          queryClient.invalidateQueries({ queryKey: ['interactions', userId] });
          break;
      }
      setSubmitted(true);
      window.setTimeout(onClose, 400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const preview = useMemo(() => {
    if (!parsed) return null;
    const effectiveKind: QuickKind = selectedKind ?? parsed.kind;
    return (
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--accent-soft, rgba(139,92,246,0.06))',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select
            value={effectiveKind}
            onChange={(e) => setSelectedKind(e.target.value as QuickKind)}
            aria-label="类型"
            data-testid="quick-kind-select"
            style={{
              fontWeight: 600,
              fontSize: 'var(--text-base)',
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface, #fff)',
              cursor: 'pointer',
            }}
          >
            <option value="event">{KIND_ICON.event} {KIND_LABEL.event}</option>
            <option value="interaction">{KIND_ICON.interaction} {KIND_LABEL.interaction}</option>
            <option value="action">{KIND_ICON.action} {KIND_LABEL.action}</option>
          </select>
          <span
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--muted)',
            }}
          >
            置信度 {(parsed.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <PreviewRow label="时间" value={formatDue(parsed.due)} />
        <PreviewRow label="对象" value={parsed.contact_id ? '已匹配联系人' : '未指定'} />
        <PreviewRow label="摘要" value={parsed.summary} />
      </div>
    );
  }, [parsed, selectedKind]);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99998,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="快速记录"
        style={{
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--surface, #fff)',
          borderRadius: 12,
          boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>
            ⚡ 快速记录
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--muted)',
              fontSize: 'var(--text-base)',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ position: 'relative' }}>
          <textarea
            ref={inputRef}
            className="input-base"
            rows={2}
            placeholder="例：明天下午 3 点和张三开会，提醒我准备议程"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            style={{
              resize: 'none',
              lineHeight: 1.6,
              minHeight: 56,
              paddingRight: 44,
            }}
          />
          {(isAndroidTauri() || speechRecognitionAvailable()) && (
            <button
              type="button"
              onClick={handleVoice}
              disabled={listening}
              aria-label={listening ? '正在聆听' : '语音输入'}
              title="语音输入"
              style={{
                position: 'absolute',
                right: 8,
                bottom: 8,
                border: 'none',
                background: 'var(--accent-soft, rgba(139,92,246,0.08))',
                cursor: listening ? 'default' : 'pointer',
                fontSize: 28,
                lineHeight: 1,
                padding: 10,
                borderRadius: 12,
                opacity: listening ? 0.6 : 1,
              }}
            >
              {listening ? '🎙️' : '🎤'}
            </button>
          )}
        </div>

        {listening && (
          <div style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
            正在聆听… 请说话（需授权麦克风）
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--danger, #dc2626)', fontSize: 'var(--text-sm)' }}>
            {error}
          </div>
        )}

        {preview}

        {submitted && (
          <div
            style={{
              color: 'var(--accent, #8b5cf6)',
              fontSize: 'var(--text-base)',
              textAlign: 'center',
            }}
          >
            已记录 ✓
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={!text.trim()}
          >
            记录
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}