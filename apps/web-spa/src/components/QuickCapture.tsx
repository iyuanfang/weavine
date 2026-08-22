import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { parseQuick } from '../lib/adapter/quick-capture';
import { beginVoice, checkVoiceModel, endVoice, isAndroidTauri, recognizeCloud, recognizeLocal, recognizeSpeech, recordAudio, speechRecognitionAvailable, voiceMode } from '../lib/voice';
import type { VoiceRecordingHandle } from '../lib/voice';
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

function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
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
  const [contactList, setContactList] = useState<Array<{ id: string; nickname: string; name?: string | null }>>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [editedDue, setEditedDue] = useState<string | null>(null);
  const [editedContactId, setEditedContactId] = useState<string | null>(null);
  const [editedContactLabel, setEditedContactLabel] = useState<string>('');
  const [listening, setListening] = useState(false);
  const [selectedKind, setSelectedKind] = useState<QuickKind | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const handleRef = useRef<VoiceRecordingHandle<Blob | string> | null>(null);
  // When we sync the textarea to reflect a user-picked contact, the parse
  // effect below will fire on the new text. This flag tells that effect
  // to keep the user's `editedContactId` instead of overwriting it from
  // the parse result.
  const isInternalTextUpdateRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    adapter.contacts
      .list({ user_id: userId })
      .then((data: { items: Array<{ id: string; nickname: string; name?: string | null }> }) => {
        setContactList(data.items);
        setContactNames(data.items.flatMap((c) => [c.nickname, ...(c.name ? [c.name] : [])]));
      })
      .catch(() => {});
  }, [adapter, userId]);

  const resolveContactLabel = (id: string | null): string => {
    if (!id) return '';
    const c = contactList.find((x) => x.id === id);
    if (!c) return '';
    return c.name && c.name !== c.nickname ? `${c.nickname}（${c.name}）` : c.nickname;
  };

  // Single entry point for all contact-selection UI (dropdown option, clear
  // ✕, "(不指定)", search-field match). When the new contact differs from
  // the current one, substitute the old contact's display names in the
  // textarea so the two stay in sync. Length-sorted to avoid replacing a
  // shorter alias when a longer one is also present (e.g. "张三" vs
  // "张三丰" — we want the longer match to win first).
  const pickContact = (newId: string | null) => {
    const oldId = editedContactId;
    if (newId === oldId) {
      setEditedContactLabel(resolveContactLabel(newId));
      return;
    }
    const oldContact = contactList.find((c) => c.id === oldId);
    const newLabel = resolveContactLabel(newId);
    setEditedContactId(newId);
    setEditedContactLabel(newLabel);

    if (oldContact && newLabel) {
      const oldNames = [oldContact.nickname, ...(oldContact.name ? [oldContact.name] : [])]
        .filter((n): n is string => Boolean(n))
        .sort((a, b) => b.length - a.length);
      let next = text;
      for (const name of oldNames) {
        if (name && next.includes(name)) {
          next = next.replace(name, newLabel);
          break;
        }
      }
      if (next !== text) {
        isInternalTextUpdateRef.current = true;
        setText(next);
      }
    }
  };

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contactList.slice(0, 5);
    const scored = contactList
      .map((c) => {
        const nick = c.nickname.toLowerCase();
        const name = (c.name ?? '').toLowerCase();
        let score = 0;
        if (nick.startsWith(q)) score = 3;
        else if (name.startsWith(q)) score = 2;
        else if (nick.includes(q)) score = 1;
        else if (name.includes(q)) score = 1;
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map((x) => x.c);
  }, [contactList, contactSearch]);

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
          setEditedDue(p.due);
          if (isInternalTextUpdateRef.current) {
            // We synced the textarea to reflect the contact the user just
            // picked — the parser ran on the new text and would normally
            // overwrite `editedContactId`. Preserve the user's choice
            // (and its resolved label), and clear the flag.
            isInternalTextUpdateRef.current = false;
            setEditedContactLabel(resolveContactLabel(editedContactId));
          } else {
            setEditedContactId(p.contact_id);
            setEditedContactLabel(resolveContactLabel(p.contact_id));
          }
          setContactSearch('');
          setError(null);
        })
        .catch((e: unknown) => {
          setParsed(null);
          setSelectedKind(null);
          // Don't clobber the flag on error — the next successful parse
          // triggered by a real keystroke will reset it.
          setError(e instanceof Error ? e.message : String(e));
        });
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [text, contactNames, userId]);

  const handleVoice = () => {
    // Second tap while listening: stop the in-flight recorder early
    // (Android's MediaRecorder padding 13s of silence is the main reason
    // this affordance exists; Web Speech API on Windows auto-ends already).
    if (handleRef.current) {
      handleRef.current.stop();
      handleRef.current = null;
      return;
    }
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
      handleRef.current = null;
      setListening(false);
      endVoice();
    };
    if (isAndroidTauri()) {
      // Two APK flavors: `voice-local` uses sherpa-onnx on-device;
      // `voice-cloud` POSTs to /api/voice/recognize. Both share the same
      // recording pipeline; only the recognizer call differs.
      const handle = recordAudio();
      handleRef.current = handle as VoiceRecordingHandle<Blob | string>;
      if (voiceMode() === 'local') {
        handle.promise
          .then(async (blob) => {
            const status = await checkVoiceModel();
            if (!status.ready) {
              throw new Error(status.error ?? '语音模型尚未就绪，请稍后重试');
            }
            return recognizeLocal(blob);
          })
          .then(done)
          .catch(fail)
          .finally(release);
      } else {
        handle.promise
          .then(async (blob) => recognizeCloud(blob))
          .then(done)
          .catch(fail)
          .finally(release);
      }
      return;
    }
    const handle = recognizeSpeech();
    handleRef.current = handle;
    handle.promise.then(done).catch(fail).finally(release);
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
      const effectiveDue = editedDue ?? p.due;
      const effectiveContactId = editedContactId ?? p.contact_id;
      switch (effectiveKind) {
        case 'event':
          await adapter.events.create({
            user_id: userId,
            title: summary,
            type: '其他',
            start_at: effectiveDue ?? now,
            contact_id: effectiveContactId,
          });
          queryClient.invalidateQueries({ queryKey: ['events', userId] });
          break;
        case 'action':
          await adapter.actions.create({
            user_id: userId,
            title: summary,
            due_at: effectiveDue,
            contact_id: effectiveContactId,
          });
          queryClient.invalidateQueries({ queryKey: ['actions', userId] });
          break;
        case 'interaction':
          await adapter.interactions.create({
            user_id: userId,
            summary,
            occurred_at: effectiveDue ?? now,
            contact_id: effectiveContactId,
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span
            style={{
              flexShrink: 0,
              width: 44,
              color: 'var(--muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            时间
          </span>
          <input
            type="datetime-local"
            aria-label="时间"
            value={isoToLocalInput(editedDue)}
            onChange={(e) => setEditedDue(localInputToIso(e.target.value))}
            style={{
              flex: 1,
              fontSize: 'var(--text-base)',
              padding: '4px 8px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--surface, #fff)',
              color: 'var(--fg, #111)',
            }}
          />
          {editedDue && (
            <button
              type="button"
              onClick={() => setEditedDue(null)}
              aria-label="清除时间"
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--muted)',
                fontSize: 'var(--text-sm)',
                padding: 4,
              }}
            >
              ✕
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span
            style={{
              flexShrink: 0,
              width: 44,
              color: 'var(--muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            对象
          </span>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type="text"
              aria-label="对象"
              placeholder="搜索或选择联系人…"
              value={contactSearch || editedContactLabel}
              onChange={(e) => {
                const v = e.target.value;
                setContactSearch(v);
                const match = contactList.find(
                  (c) => c.nickname === v || (c.name ?? '') === v,
                );
                if (match) {
                  pickContact(match.id);
                  setContactSearch('');
                } else {
                  setEditedContactId(null);
                  setEditedContactLabel(v);
                }
              }}
              onFocus={() => setContactSearch('')}
              style={{
                width: '100%',
                fontSize: 'var(--text-base)',
                padding: '4px 8px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--surface, #fff)',
                color: 'var(--fg, #111)',
              }}
            />
            {contactSearch && filteredContacts.length > 0 && (
              <div
                role="listbox"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 2px)',
                  left: 0,
                  right: 0,
                  zIndex: 10,
                  maxHeight: 200,
                  overflowY: 'auto',
                  background: 'var(--surface, #fff)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                }}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={editedContactId === null}
                  onClick={() => {
                    pickContact(null);
                    setContactSearch('');
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    border: 'none',
                    background: editedContactId === null ? 'var(--accent-soft, #ecfdf5)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--muted)',
                  }}
                >
                  （不指定）
                </button>
                {filteredContacts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={editedContactId === c.id}
                    onClick={() => {
                      pickContact(c.id);
                      setContactSearch('');
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      border: 'none',
                      background: editedContactId === c.id ? 'var(--accent-soft, #ecfdf5)' : 'transparent',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    {resolveContactLabel(c.id)}
                  </button>
                ))}
              </div>
            )}
          </div>
          {editedContactId && (
            <button
              type="button"
              onClick={() => {
                pickContact(null);
              }}
              aria-label="清除对象"
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--muted)',
                fontSize: 'var(--text-sm)',
                padding: 4,
              }}
            >
              ✕
            </button>
          )}
        </div>

        <PreviewRow label="摘要" value={parsed.summary} />
      </div>
    );
  }, [parsed, selectedKind, editedDue, editedContactId, editedContactLabel, contactSearch, contactList, filteredContacts]);

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
              aria-label={listening ? '正在聆听（点此停止）' : '语音输入'}
              title={listening ? '点此停止录音' : '语音输入'}
              style={{
                position: 'absolute',
                right: 8,
                bottom: 8,
                border: 'none',
                background: listening
                  ? 'var(--danger-soft, rgba(220,38,38,0.10))'
                  : 'var(--accent-soft, rgba(139,92,246,0.08))',
                cursor: 'pointer',
                fontSize: 28,
                lineHeight: 1,
                padding: 10,
                borderRadius: 12,
                opacity: 1,
              }}
            >
              {listening ? '🛑' : '🎤'}
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