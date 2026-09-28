import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { parseQuick } from '../lib/adapter/quick-capture';
import { SearchablePicker } from './SearchablePicker';
import {
  beginVoice,
  checkVoiceModel,
  endVoice,
  isAndroidTauri,
  recognizeCloud,
  recognizeLocal,
  recognizeSpeech,
  recognizeWeb,
  recordAudio,
  speechRecognitionAvailable,
  voiceMode,
} from '../lib/voice';
import type { VoiceRecordingHandle } from '../lib/voice';
import type { ParsedQuick, QuickKind } from '../lib/quick-types';

const KIND_LABEL: Record<QuickKind, string> = {
  event: '📅 日程',
  action: '✅ 待办',
  interaction: '💬 互动',
  note: '📝 笔记',
};

interface Props {
  /** Invalidate-all callback after a successful save (queries refetch). */
  onSaved: () => void;
}

/**
 * Fixed bottom input bar of the mobile home screen — WeChat-style, fully
 * inline. No modal:
 *  - Text (default): tapping focuses a real textarea in place; the parsed
 *    preview (type/time/contact/summary) floats right above the bar as the
 *    user types, and 记录 commits.
 *  - Hold-to-talk (🎤): press and hold to record; release recognizes and
 *    drops the transcript into the same inline textarea; slide up cancels.
 */
export function MobileInputBar({ onSaved }: Props) {
  const adapter = useAdapter();
  const queryClient = useQueryClient();
  const userId = useUserId() ?? '';
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [active, setActive] = useState(false);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedQuick | null>(null);
  // Editable overlay state — seeded from the parser, user-tweakable. Kept
  // separate from `parsed` so re-parses (typing) don't clobber manual edits
  // until the text itself changes enough to re-seed (same policy as
  // QuickCapture's userOverride pattern).
  const [kind, setKind] = useState<QuickKind | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactNames, setContactNames] = useState<string[]>([]);
  const [contactList, setContactList] = useState<Array<{ id: string; nickname: string; name?: string | null }>>([]);
  const [contactLookup, setContactLookup] = useState<Record<string, string>>({});
  const [holding, setHolding] = useState(false);
  const [cancelHint, setCancelHint] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const handleRef = useRef<VoiceRecordingHandle<Blob | string> | null>(null);
  const startYRef = useRef(0);

  useEffect(() => {
    if (!userId) return;
    adapter.contacts
      .list({ user_id: userId })
      .then((data: { items: Array<{ id: string; nickname: string; name?: string | null }> }) => {
        setContactList(data.items);
        setContactNames(data.items.flatMap((c) => [c.nickname, ...(c.name ? [c.name] : [])]));
        const lookup: Record<string, string> = {};
        for (const c of data.items) lookup[c.id] = c.nickname || c.name || '?';
        setContactLookup(lookup);
      })
      .catch(() => {});
  }, [adapter, userId]);

  // Examples rotate through the field's placeholder when it's empty — gives
  // the user a sense of what counts as a record without bloating the screen.
  const EXAMPLES = [
    '明天下午 3 点和张三开会',
    '今天和李四吃了午饭',
    '后天前把方案发给王总',
    '上周和王总聊了 Q4 计划',
  ];
  const [exampleIdx, setExampleIdx] = useState(0);
  useEffect(() => {
    if (text) return;
    const id = window.setInterval(() => setExampleIdx((i) => (i + 1) % EXAMPLES.length), 4000);
    return () => window.clearInterval(id);
  }, [text]);

  // Live parse while typing (same debounce as QuickCapture). Re-seeds the
  // editable fields only when the text is fully cleared, so a user-picked
  // kind/time/contact survives ongoing typing — mirrors QuickCapture.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const trimmed = text.trim();
    if (!trimmed) {
      setParsed(null);
      setKind(null);
      setDue(null);
      setContactId(null);
      setError(null);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      parseQuick(trimmed, contactNames, userId)
        .then((p) => {
          setParsed(p);
          setKind((prev) => (prev === null ? p.kind : prev));
          setDue((prev) => (prev === null ? p.due : prev));
          setContactId((prev) => (prev === null ? p.contact_id : prev));
          setError(null);
        })
        .catch((e: unknown) => {
          setParsed(null);
          setError(e instanceof Error ? e.message : String(e));
        });
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [text, contactNames, userId]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    if (!userId) {
      setError('本地用户尚未就绪，请稍候再试');
      return;
    }
    setSubmitting(true);
    try {
      const p = parsed ?? (await parseQuick(trimmed, contactNames, userId));
      const effKind = kind ?? p.kind;
      const effDue = due ?? p.due;
      const effContactId = contactId ?? p.contact_id;
      const summary = p.summary || trimmed;
      const nowIso = new Date().toISOString();
      switch (effKind) {
        case 'event':
          await adapter.events.create({
            user_id: userId,
            title: summary,
            type: '其他',
            start_at: effDue ?? nowIso,
            contact_id: effContactId,
          });
          queryClient.invalidateQueries({ queryKey: ['events', userId] });
          break;
        case 'action':
          await adapter.actions.create({
            user_id: userId,
            title: summary,
            due_at: effDue,
            contact_id: effContactId,
          });
          queryClient.invalidateQueries({ queryKey: ['actions', userId] });
          break;
        case 'interaction':
          await adapter.interactions.create({
            user_id: userId,
            summary,
            occurred_at: effDue ?? nowIso,
            contact_id: effContactId,
          });
          queryClient.invalidateQueries({ queryKey: ['interactions', userId] });
          break;
        case 'note':
          await adapter.notes.create(userId, { title: summary.slice(0, 80), body: text });
          queryClient.invalidateQueries({ queryKey: ['notes', userId] });
          break;
      }
      onSaved();
      setSubmitted(true);
      setText('');
      setParsed(null);
      setKind(null);
      setDue(null);
      setContactId(null);
      setExpanded(false);
      setActive(false);
      window.setTimeout(() => setSubmitted(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const startHold = (e: React.PointerEvent) => {
    if (handleRef.current) return;
    if (!beginVoice()) return;
    e.preventDefault();
    startYRef.current = e.clientY;
    setHolding(true);
    setCancelHint(false);
    setError(null);
    const handle = recordAudio();
    handleRef.current = handle as VoiceRecordingHandle<Blob | string>;
  };

  const finishHold = async (cancel: boolean) => {
    const handle = handleRef.current;
    if (!handle) return;
    handleRef.current = null;
    setHolding(false);
    setCancelHint(false);
    endVoice();
    if (cancel) {
      handle.stop();
      return;
    }
    try {
      const blob = (await handle.promise) as Blob;
      if (blob.size === 0) throw new Error('录音为空，请重试');
      let transcript: string;
      if (isAndroidTauri()) {
        if (voiceMode() === 'local') {
          const status = await checkVoiceModel();
          if (!status.ready) throw new Error(status.error ?? '语音模型尚未就绪，请稍后重试');
          transcript = await recognizeLocal(blob);
        } else {
          transcript = await recognizeCloud(blob);
        }
      } else {
        try {
          transcript = await recognizeWeb(blob);
        } catch (webErr) {
          if (!speechRecognitionAvailable()) throw webErr;
          console.warn('[voice] server STT failed, falling back to browser recognition', webErr);
          transcript = await recognizeSpeech().promise;
        }
      }
      setMode('text');
      setActive(true);
      setText(transcript);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!holding) return;
    setCancelHint(startYRef.current - e.clientY > 80);
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

  // The floating preview above the textarea. Collapsed: read-only summary,
  // tap to expand. Expanded: type / time / contact all editable inline.
  // No 记录 button here — the single confirm is the bar's 记录 (or Enter).
  const preview = (() => {
    if (!text.trim()) return null;
    const effKind: QuickKind = kind ?? parsed?.kind ?? 'note';
    const effDue = due ?? parsed?.due ?? null;
    const effContactId = contactId ?? parsed?.contact_id ?? null;
    const summary = parsed?.summary || text.trim();
    const time = effDue
      ? new Date(effDue).toLocaleString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : null;

    if (!expanded) {
      return (
        <button
          type="button"
          className="mobile-input-bar__preview"
          data-testid="mobile-input-preview"
          onClick={() => setExpanded(true)}
        >
          <span className="mobile-input-bar__preview-kind">{KIND_LABEL[effKind]}</span>
          {time && <span className="mobile-input-bar__preview-meta">{time}</span>}
          {effContactId && (
            <span className="mobile-input-bar__preview-meta">@{contactLookup[effContactId] ?? '?'}</span>
          )}
          <span className="mobile-input-bar__preview-summary">{summary}</span>
          <span
            className="mobile-input-bar__preview-edit"
            aria-hidden="true"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
          >
            编辑
          </span>
        </button>
      );
    }

    return (
      <div className="mobile-input-bar__editor" data-testid="mobile-input-editor">
        <div className="mobile-input-bar__editor-row">
          <select
            value={effKind}
            onChange={(e) => setKind(e.target.value as QuickKind)}
            aria-label="类型"
            className="mobile-input-bar__editor-select"
          >
            <option value="interaction">{KIND_LABEL.interaction}</option>
            <option value="action">{KIND_LABEL.action}</option>
            <option value="event">{KIND_LABEL.event}</option>
            <option value="note">{KIND_LABEL.note}</option>
          </select>
          <input
            type="datetime-local"
            value={isoToLocalInput(effDue)}
            onChange={(e) => setDue(localInputToIso(e.target.value))}
            aria-label="时间"
            className="mobile-input-bar__editor-time"
          />
          <SearchablePicker
            value={effContactId ?? ''}
            onChange={(v) => setContactId(v || null)}
            options={contactList.map((c) => ({
              id: c.id,
              label: c.nickname || c.name || '?',
              searchText: `${c.nickname ?? ''} ${c.name ?? ''}`.trim(),
            }))}
            placeholder="搜索或选择联系人…"
            emptyText="没有匹配的联系人"
          />
        </div>
        <div className="mobile-input-bar__editor-row mobile-input-bar__editor-row--summary">
          <span className="mobile-input-bar__preview-summary">{summary}</span>
          <button type="button" className="mobile-input-bar__editor-collapse" onClick={() => setExpanded(false)}>
            收起
          </button>
        </div>
      </div>
    );
  })();

  return (
    <div className={`mobile-input-bar${active ? ' mobile-input-bar--active' : ''}`} data-testid="mobile-input-bar">
      {preview}
      {error && <div className="mobile-input-bar__error">{error}</div>}
      {submitted && <div className="mobile-input-bar__submitted">已记录 ✓</div>}

      <div className="mobile-input-bar__row">
        {mode === 'text' ? (
          active ? (
            <textarea
              ref={inputRef}
              className="mobile-input-bar__textarea"
              rows={2}
              placeholder={`${EXAMPLES[exampleIdx]}（回车保存）`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={(e) => {
                // Collapse when empty and focus leaves — but not when the
                // blur comes from tapping the preview/record (mousedown).
                if (!e.target.value.trim()) setActive(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === 'Escape') {
                  setText('');
                  setActive(false);
                }
              }}
              data-testid="mobile-input-textarea"
              autoFocus
            />
          ) : (
            <button
              type="button"
              className="mobile-input-bar__field"
              onClick={() => setActive(true)}
              aria-label="快速记录"
              data-testid="mobile-input-text"
            >
              <span>做了什么，记一下…</span>
            </button>
          )
        ) : (
          <button
            type="button"
            className={`mobile-input-bar__hold${holding ? ' mobile-input-bar__hold--active' : ''}${cancelHint ? ' mobile-input-bar__hold--cancel' : ''}`}
            data-testid="mobile-input-hold"
            onPointerDown={startHold}
            onPointerUp={() => void finishHold(cancelHint)}
            onPointerLeave={() => holding && void finishHold(cancelHint)}
            onPointerMove={onPointerMove}
            onContextMenu={(e) => e.preventDefault()}
          >
            {holding ? (cancelHint ? '松开取消' : '松手 发送') : '按住 说话'}
          </button>
        )}
        {mode === 'text' && active ? (
          <button
            type="button"
            className="mobile-input-bar__send"
            onClick={() => void submit()}
            disabled={!text.trim() || submitting}
            aria-label="记录"
            data-testid="mobile-input-send"
          >
            记录
          </button>
        ) : (
          <button
            type="button"
            className="mobile-input-bar__mic"
            onClick={() => {
              setMode(mode === 'text' ? 'voice' : 'text');
              setActive(false);
            }}
            aria-label={mode === 'text' ? '切换到按住说话' : '切换到键盘输入'}
            data-testid={mode === 'text' ? 'mobile-input-voice-toggle' : 'mobile-input-text-toggle'}
          >
            {mode === 'text' ? <WaveIcon /> : <KeyboardIcon />}
          </button>
        )}
      </div>
    </div>
  );
}

// WeChat-style voice icon: a mic-less sound-wave bubble. Stroke follows
// currentColor so the button's green/gray states just work.
function WaveIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 10v4" />
      <path d="M8 7v10" />
      <path d="M12 4.5v15" />
      <path d="M16 7v10" />
      <path d="M20 10v4" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="6.5" width="18" height="11" rx="2.5" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M6.5 13.5h.01M17 13.5h.01M9.5 13.5h5" />
    </svg>
  );
}
