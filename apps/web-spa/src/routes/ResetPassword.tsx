import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { performPasswordReset } from '../lib/auth/storage';

function viteApiBase(): string {
  if (typeof import.meta === 'undefined') return '';
  const env = (import.meta as unknown as Record<string, unknown>).env as
    | Record<string, string | undefined>
    | undefined;
  return env?.VITE_API_BASE ?? '';
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('重置链接无效（缺少 token）');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setPending(true);
    try {
      await performPasswordReset(token, password, viteApiBase());
      navigate('/login?reset=success', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败');
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
        <p className="login-subtitle">设置新密码</p>
        {!token ? (
          <p className="login-error">缺少重置 token，请通过邮件中的链接打开此页面。</p>
        ) : (
          <form onSubmit={onSubmit} className="login-form">
            <label className="login-field">
              <span>新密码</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                disabled={pending}
              />
            </label>
            <label className="login-field">
              <span>确认新密码</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                required
                disabled={pending}
              />
            </label>
            {error ? <p className="login-error">{error}</p> : null}
            <button type="submit" className="login-submit" disabled={pending}>
              {pending ? '请稍候…' : '设置新密码'}
            </button>
          </form>
        )}
        <p className="login-switch">
          <Link to="/login" className="login-switch-btn">
            ← 返回登录
          </Link>
        </p>
      </div>
    </div>
  );
}
