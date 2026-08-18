import { useState } from 'react';

import { beginVoice, checkVoiceModel, downloadVoiceModel, endVoice, isAndroidTauri, ModelDownloadProgress, recognizeLocal, recognizeSpeech, recordAudio, speechRecognitionAvailable } from '../lib/voice';

interface Props {
  onOpen: (initialText: string) => void;
}

async function ensureModelAndRecognize(
  blob: Blob,
  onProgress: (p: ModelDownloadProgress) => void,
): Promise<string> {
  const status = await checkVoiceModel();
  if (!status.ready) {
    await downloadVoiceModel(onProgress);
  }
  return recognizeLocal(blob);
}

export function QuickFab({ onOpen }: Props) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [downloadStage, setDownloadStage] = useState<string | null>(null);

  const handleTap = () => {
    setBusy(true);
    if (isAndroidTauri()) {
      if (!beginVoice()) {
        setBusy(false);
        return;
      }
      setListening(true);
      recordAudio()
        .then((blob) => {
          if (blob.size === 0) throw new Error('录音为空，请重试');
          return ensureModelAndRecognize(blob, (p) => {
            setDownloadStage(p.stage);
            setDownloadPct(p.totalBytes > 0 ? (p.downloadedBytes / p.totalBytes) * 100 : null);
          });
        })
        .then((transcript) => {
          onOpen(transcript);
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[voice] recording failed:', msg);
          onOpen(msg);
        })
        .finally(() => {
          setListening(false);
          setBusy(false);
          setDownloadPct(null);
          setDownloadStage(null);
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
    recognizeSpeech()
      .then((transcript) => {
        onOpen(transcript);
      })
      .catch(() => {
        onOpen('');
      })
      .finally(() => {
        setListening(false);
        setBusy(false);
      });
  };

  const showDownload = downloadStage === 'download' || downloadStage === 'extract';

  return (
    <button
      type="button"
      onClick={handleTap}
      disabled={busy}
      aria-label="语音快速记录"
style={{
        position: 'fixed',
        right: 20,
        bottom: 72,
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
      {showDownload
        ? `${Math.round(downloadPct ?? 0)}%`
        : listening
          ? '🎙️'
          : '⚡'}
    </button>
  );
}