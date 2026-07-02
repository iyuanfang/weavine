import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { App } from './App';
import { TodayPage } from './routes/Today';

// Other routes land here as Phase 2 fills them in.
// For now, the only fully-wired page is `/` (Today).
const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <App>
        <TodayPage />
      </App>
    ),
  },
  {
    path: '/contacts',
    element: (
      <App>
        <div className="loading">联系人（Phase 2）</div>
      </App>
    ),
  },
  {
    path: '/calendar',
    element: (
      <App>
        <div className="loading">日程（Phase 2）</div>
      </App>
    ),
  },
  {
    path: '/actions',
    element: (
      <App>
        <div className="loading">待办（Phase 2）</div>
      </App>
    ),
  },
  {
    path: '/reminders',
    element: (
      <App>
        <div className="loading">提醒（Phase 2）</div>
      </App>
    ),
  },
  {
    path: '/tags',
    element: (
      <App>
        <div className="loading">标签（Phase 2）</div>
      </App>
    ),
  },
  {
    path: '/tags/:tagId',
    element: (
      <App>
        <div className="loading">标签详情（Phase 2）</div>
      </App>
    ),
  },
]);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
