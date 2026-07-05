import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { login, register, saveSession } from '../lib/auth/storage';
import { localUserQueryKey } from '../lib/auth';

function viteApiBase(): string {
  if (typeof import.meta === 'undefined') return '';
  const env = (import.meta as unknown as Record<string, unknown>).env as
    | Record<string, string | undefined>
    | undefined;
  return env?.VITE_API_BASE ?? '';
}

function nextPath(search: string): string {
  const params = new URLSearchParams(search);
  const next = params.get('next');
  if (!next) return '/';
  try {
    const decoded = decodeURIComponent(next);
    if (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded;
  } catch {
    return '/';
  }
  return '/';
}

export function LoginPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('请输入邮箱');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    setPending(true);
    try {
      const base = viteApiBase();
      const sess =
        mode === 'login'
          ? await login(trimmedEmail, password, base)
          : await register(trimmedEmail, password, base);
      saveSession(sess);
      queryClient.setQueryData(localUserQueryKey, {
        id: sess.user_id,
        name: null,
        email: sess.email ?? null,
      });
      window.location.href = nextPath(location.search);
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
        <p className="login-subtitle">
          {mode === 'login' ? '登录到您的账户' : '创建一个新账户'}
        </p>
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
          <label className="login-field">
            <span>密码</span>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              disabled={pending}
            />
          </label>
          {error ? <p className="login-error">{error}</p> : null}
          <button type="submit" className="login-submit" disabled={pending}>
            {pending ? '请稍候...' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>
        <p className="login-switch">
          {mode === 'login' ? '还没有账户？' : '已有账户？'}
          <button
            type="button"
            className="login-switch-btn"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
            disabled={pending}
          >
            {mode === 'login' ? '去注册' : '去登录'}
          </button>
        </p>
      </div>
    </div>
  );
}
