import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { buildRouterObjects } from './routes-config';

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