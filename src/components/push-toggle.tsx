'use client';

import { useEffect, useState } from 'react';

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const b = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}

export function PushToggle() {
  const [state, setState] = useState<
    'loading' | 'on' | 'off' | 'unsupported'
  >('loading');

  useEffect(() => {
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    ) {
      setState('unsupported');
      return;
    }
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? 'on' : 'off');
      })
      .catch(() => setState('unsupported'));
  }, []);

  async function subscribe() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      ),
    });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub }),
    });
    setState('on');
  }

  if (state === 'loading') return null;
  if (state === 'unsupported')
    return <p className="text-sm text-gray-500">当前浏览器不支持 Web Push</p>;
  if (state === 'on')
    return <p className="text-sm text-green-700">通知已开启 ✓</p>;
  return (
    <button onClick={subscribe} className="btn-primary text-sm">
      开启浏览器通知
    </button>
  );
}
