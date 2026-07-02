import { useEffect } from 'react';

export function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // silently ignore — SW failure is non-fatal
      });
    }
  }, []);

  return null;
}
