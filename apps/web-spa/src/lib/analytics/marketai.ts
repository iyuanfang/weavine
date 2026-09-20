// MarketAI analytics tracker wrapper for Weavine web SPA.
//
// The snippet is loaded once by index.html (sync script tag) and exposes
// `window.marketai.push([...])`. This module is a thin, type-safe wrapper
// around that queue so call sites don't need to know the underlying API.
//
// Tracking key + endpoint are baked into the snippet itself — set them in
// apps/web-spa/index.html <head>:
//   <script async src="https://marketai.financialagent.cc/api/v1/track.js"
//           data-site-key="SITE_KEY_FROM_MARKETAI_ADMIN"></script>

interface MarketAIQueue {
  push(args: unknown[]): void;
}

declare global {
  interface Window {
    marketai?: MarketAIQueue;
  }
}

/**
 * Safe-enqueue a `sign_up` event to MarketAI.
 * Call this from the registration success handler so the new contact gets
 * stitched to their anonymous browser (page views / clicks already uploaded).
 */
export function trackSignUp(input: {
  email: string;
  first_name?: string | null;
  plan?: string | null;
}): void {
  if (typeof window === 'undefined') return;
  const queue = window.marketai;
  if (!queue || typeof queue.push !== 'function') return;
  const props: Record<string, unknown> = { email: input.email };
  if (input.first_name) props.first_name = input.first_name;
  if (input.plan) props.plan = input.plan;
  queue.push(['event', 'sign_up', props]);
}

/**
 * Fire-and-forget custom event. Properties object is serialized as-is.
 */
export function trackEvent(eventName: string, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const queue = window.marketai;
  if (!queue || typeof queue.push !== 'function') return;
  queue.push(['event', eventName, props]);
}