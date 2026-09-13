import { useRef, useState } from 'react';

import { beginVoice, checkVoiceModel, endVoice, isAndroidTauri, recognizeCloud, recognizeLocal, recognizeSpeech, recordAudio, speechRecognitionAvailable, voiceMode } from '../lib/voice';
import type { VoiceRecordingHandle } from '../lib/voice';

interface Props {
  onOpen: (initialText: string) => void;
}

async function ensureModelAndRecognize(blob: Blob): Promise<string> {
  const status = await checkVoiceModel();
  if (!status.ready) {
    throw new Error(status.error ?? '语音模型尚未就绪，请稍后重试');
  }
  return recognizeLocal(blob);
}

export function QuickFab({ onOpen }: Props) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const handleRef = useRef<VoiceRecordingHandle<Blob | string> | null>(null);

  const handleTap = () => {
    // Second tap while listening: stop the in-flight recorder early.
    if (handleRef.current) {
      handleRef.current.stop();
      handleRef.current = null;
      return;
    }
    setBusy(true);
    if (isAndroidTauri()) {
      if (!beginVoice()) {
        setBusy(false);
        return;
      }
      setListening(true);
      // Two APK flavors: `voice-local` runs sherpa-onnx on-device;
      // `voice-cloud` POSTs to /api/voice/recognize on the server.
      const handle = recordAudio();
      handleRef.current = handle as VoiceRecordingHandle<Blob | string>;
      const onAndroid = voiceMode() === 'local'
        ? handle.promise.then(async (blob) => {
            if (blob.size === 0) throw new Error('录音为空，请重试');
            return ensureModelAndRecognize(blob);
          })
        : handle.promise.then(async (blob) => {
            if (blob.size === 0) throw new Error('录音为空，请重试');
            return recognizeCloud(blob);
          });
      onAndroid
        .then((transcript) => {
          onOpen(transcript);
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[voice] recording failed:', msg);
          onOpen(msg);
        })
        .finally(() => {
          handleRef.current = null;
          setListening(false);
          setBusy(false);
          endVoice();
        });
      return;
    }
    if (!speechRecognitionAvailable()) {
      setBusy(false);
      onOpen('');
      return;
    }
    setListening(true);
    const handle = recognizeSpeech();
    handleRef.current = handle;
    handle.promise
      .then((transcript) => {
        onOpen(transcript);
      })
      .catch(() => {
        onOpen('');
      })
      .finally(() => {
        handleRef.current = null;
        setListening(false);
        setBusy(false);
      });
  };

  return (
    <button
      type="button"
      onClick={handleTap}
      disabled={busy}
      aria-label="语音快速记录"
style={{
        position: 'fixed',
        right: 20,
        bottom: 'calc(var(--bottom-nav-height, 56px) + env(safe-area-inset-bottom, 0px) + 36px)',
        zIndex: 99990,
        width: 44,
        height: 44,
        borderRadius: '50%',
        border: 'none',
        cursor: 'pointer',
        background: 'var(--accent, #8b5cf6)',
        color: '#fff',
        fontSize: 20,
        boxShadow: '0 4px 12px rgba(0,0,0,0.22)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {listening ? '🎙️' : '⚡'}
    </button>
  );
}