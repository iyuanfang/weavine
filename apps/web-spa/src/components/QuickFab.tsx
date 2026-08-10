import { useState } from 'react';

import { isAndroid, recognizeSpeech, speechRecognitionAvailable } from '../lib/voice';

interface Props {
  onOpen: (initialText: string) => void;
}

export function QuickFab({ onOpen }: Props) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isAndroid()) return null;

  const handleTap = () => {
    setBusy(true);
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

  return (
    <button
      type="button"
      onClick={handleTap}
      disabled={busy}
      aria-label="语音快速记录"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 99990,
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: 'none',
        cursor: 'pointer',
        background: 'var(--accent, #8b5cf6)',
        color: '#fff',
        fontSize: 24,
        boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {listening ? '🎙️' : '⚡'}
    </button>
  );
}