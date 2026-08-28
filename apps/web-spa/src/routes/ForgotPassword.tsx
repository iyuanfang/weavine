import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { requestPasswordReset } from '../lib/auth/storage';

function viteApiBase(): string {
  if (typeof import.meta === 'undefined') return '';
  const env = (import.meta as unknown as Record<string, unknown>).env as
    | Record<string, string | undefined>
    | undefined;
  return env?.VITE_API_BASE ?? '';
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('请输入邮箱');
      return;
    }
    setPending(true);
    try {
      await requestPasswordReset(trimmed, viteApiBase());
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <h1 className="login-title">
          Weavine
          <span className="login-tagline">管好人和事</span>
        </h1>
        <p className="login-subtitle">重置密码</p>
        {submitted ? (
          <p className="reset-success" role="status">
            如果该邮箱已注册，我们已向其发送重置链接。请在 60 分钟内点击邮件中的链接继续。
          </p>
        ) : (
          <form onSubmit={onSubmit} className="login-form">
            <label className="login-field">
              <span>邮箱</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={pending}
              />
            </label>
            {error ? <p className="login-error">{error}</p> : null}
            <button type="submit" className="login-submit" disabled={pending}>
              {pending ? '请稍候…' : '发送重置链接'}
            </button>
          </form>
        )}
        <p className="login-switch">
          <Link to="/login" className="login-switch-btn" title="返回 (Alt+←)">
            ← 返回登录
          </Link>
        </p>
      </div>
    </div>
  );
}
