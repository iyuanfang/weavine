import { useRef, useState } from 'react';

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

interface Props {
  /** Open the QuickCapture modal, optionally seeded with a transcript. */
  onOpenQuick: (initialText: string) => void;
}

/**
 * Fixed bottom input bar of the mobile home screen, WeChat-style.
 *
 * Two modes:
 *  - Text (default): a fake input; tapping opens the QuickCapture modal.
 *  - Hold-to-talk (after tapping 🎤): press and hold anywhere on the bar to
 *    record; release to recognize and open QuickCapture with the transcript;
 *    slide up to cancel.
 *
 * The recording pipeline is the existing shared one (recordAudio →
 * recognizeCloud/Local/Web with browser-engine fallback) — only the trigger
 * UI is new.
 */
export function MobileInputBar({ onOpenQuick }: Props) {
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [holding, setHolding] = useState(false);
  const [cancelHint, setCancelHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<VoiceRecordingHandle<Blob | string> | null>(null);
  const startYRef = useRef(0);

  const recognize = async (blob: Blob): Promise<string> => {
    if (blob.size === 0) throw new Error('录音为空，请重试');
    if (isAndroidTauri()) {
      if (voiceMode() === 'local') {
        const status = await checkVoiceModel();
        if (!status.ready) throw new Error(status.error ?? '语音模型尚未就绪，请稍后重试');
        return recognizeLocal(blob);
      }
      return recognizeCloud(blob);
    }
    try {
      return await recognizeWeb(blob);
    } catch (webErr) {
      if (!speechRecognitionAvailable()) throw webErr;
      console.warn('[voice] server STT failed, falling back to browser recognition', webErr);
      return recognizeSpeech().promise;
    }
  };

  const startHold = (e: React.PointerEvent) => {
    if (mode !== 'voice' || handleRef.current) return;
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
      const blob = await handle.promise;
      const transcript = await recognize(blob as Blob);
      onOpenQuick(transcript);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`识别失败：${msg}`);
      setMode('text');
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!holding) return;
    setCancelHint(startYRef.current - e.clientY > 80);
  };

  if (mode === 'text') {
    return (
      <div className="mobile-input-bar" data-testid="mobile-input-bar">
        <button
          type="button"
          className="mobile-input-bar__field"
          onClick={() => onOpenQuick('')}
          aria-label="快速记录"
          data-testid="mobile-input-text"
        >
          <span>说了什么，记一下…</span>
        </button>
        <button
          type="button"
          className="mobile-input-bar__mic"
          onClick={() => setMode('voice')}
          aria-label="切换到按住说话"
          data-testid="mobile-input-voice-toggle"
        >
          🎤
        </button>
      </div>
    );
  }

  return (
    <div className="mobile-input-bar">
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
      <button
        type="button"
        className="mobile-input-bar__mic mobile-input-bar__mic--keyboard"
        onClick={() => setMode('text')}
        aria-label="切换到键盘输入"
        data-testid="mobile-input-text-toggle"
      >
        ⌨️
      </button>
      {error && (
        <div className="mobile-input-bar__error">{error}</div>
      )}
    </div>
  );
}
