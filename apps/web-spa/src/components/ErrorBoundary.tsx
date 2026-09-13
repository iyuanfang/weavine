import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Optional fallback override. Default fallback renders a small inline
   * "render error" card with the message + a reset button — sized so it
   * can replace any subtree without leaving the whole route blank.
   */
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  err: Error | null;
}

/**
 * Root-level render-error catch.
 *
 * Without this, any throw inside a render pass or layout effect
 * (e.g. a CodeMirror mount/unmount race, a markdown parse on unusual
 * input) bubbles up to React's commit phase and unmounts the entire
 * tree — the user sees a pure white screen with zero diagnostic info.
 * Boundary keeps a single failed subtree from blanking the whole app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { err: null };

  static getDerivedStateFromError(err: Error): ErrorBoundaryState {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    // Log to console so the user can copy/paste from DevTools.
    // We deliberately don't ship these to a remote endpoint — the dev
    // session can inspect locally.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] render failure:', err, info.componentStack);
  }

  reset = (): void => {
    this.setState({ err: null });
  };

  render(): ReactNode {
    const { err } = this.state;
    if (!err) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(err, this.reset);
    }

    return (
      <div
        role="alert"
        style={{
          margin: 24,
          padding: 16,
          border: '1px solid #fecaca',
          background: '#fef2f2',
          color: '#7f1d1d',
          borderRadius: 8,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: 16 }}>页面渲染出错</h2>
        <p style={{ margin: '0 0 8px 0', fontSize: 13 }}>
          当前页面遇到未捕获的异常，已阻止整个应用变成白屏。请截图右侧错误信息反馈给开发者。
        </p>
        <pre
          style={{
            margin: 0,
            padding: 8,
            background: '#fff',
            border: '1px solid #fecaca',
            borderRadius: 4,
            fontSize: 11,
            overflow: 'auto',
            maxHeight: 240,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {err.name}: {err.message}
          {'\n\n'}
          {err.stack ?? '(no stack)'}
        </pre>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={this.reset}
            style={{
              padding: '4px 12px',
              border: '1px solid #7f1d1d',
              background: '#fff',
              color: '#7f1d1d',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            重试
          </button>
          <button
            type="button"
            onClick={() => {
              // Clear the captured error first — without this the boundary
              // keeps rendering its fallback and the button appears to do
              // nothing.
              this.reset();
              // SPA nav, not a full reload. See SearchPalette.tsx for why
              // `window.location.assign()` blanks the Tauri production webview
              // (no SPA history fallback for unknown paths).
              //
              // Target `/today`, not `/`: routes-config has no `/` route (it
              // was removed so the marketing site could own `/` on web), so
              // navigating there hits a 404.
              window.history.pushState({}, '', '/today');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
            style={{
              padding: '4px 12px',
              border: '1px solid #7f1d1d',
              background: '#fff',
              color: '#7f1d1d',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }
}
