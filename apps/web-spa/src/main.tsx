import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { buildRouterObjects } from './routes-config';

// Tauri 2 WebViews boot at http(s)://tauri.localhost/ (see
// tauri-2.11.5/src/manager/mod.rs:787). routes-config has no '/' route — it was
// dropped in 03d1293 so the marketing landing page could own '/' on the web
// deployment. Without this rewrite, Tauri launches hit React Router's 404 path.
//
// Web is unaffected: the hostname guard never matches on web (the SPA is served
// at /spa/ behind nginx, '/' is a separate static index.html).
if (
  typeof window !== 'undefined' &&
  (window.location.hostname === 'tauri.localhost' ||
    window.location.protocol === 'tauri:') &&
  window.location.pathname === '/'
) {
  window.history.replaceState(null, '', '/today');
}

// Single source of route definitions lives in routes-config.tsx.
// Each migration subagent updates that file; main.tsx stays stable.
const router = createBrowserRouter(buildRouterObjects());

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);