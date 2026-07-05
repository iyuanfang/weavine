// Auth token storage for the web SPA.
// Stores access + refresh JWTs in localStorage; cleared = logout.

const ACCESS_KEY = 'weavine.access_token';
const REFRESH_KEY = 'weavine.refresh_token';
const USER_KEY = 'weavine.user_id';

export interface AuthSession {
  user_id: string;
  access_token: string;
  refresh_token: string;
  email?: string;
}

function ls(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSession(): AuthSession | null {
  const s = ls();
  if (!s) return null;
  const access_token = s.getItem(ACCESS_KEY);
  const refresh_token = s.getItem(REFRESH_KEY);
  const user_id = s.getItem(USER_KEY);
  if (!access_token || !refresh_token || !user_id) return null;
  return { user_id, access_token, refresh_token };
}

const EMAIL_KEY = 'weavine.email';

export function saveSession(s: AuthSession): void {
  const ls_ = ls();
  if (!ls_) return;
  ls_.setItem(ACCESS_KEY, s.access_token);
  ls_.setItem(REFRESH_KEY, s.refresh_token);
  ls_.setItem(USER_KEY, s.user_id);
  if (s.email) ls_.setItem(EMAIL_KEY, s.email);
}

export function getStoredEmail(): string | null {
  return ls()?.getItem(EMAIL_KEY) ?? null;
}

export function clearSession(): void {
  const ls_ = ls();
  if (!ls_) return;
  ls_.removeItem(ACCESS_KEY);
  ls_.removeItem(REFRESH_KEY);
  ls_.removeItem(USER_KEY);
}

export function getAccessToken(): string | null {
  return ls()?.getItem(ACCESS_KEY) ?? null;
}

export async function login(
  email: string,
  password: string,
  baseUrl: string,
): Promise<AuthSession> {
  const resp = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      device: { name: 'web', os: 'browser', app_version: '0.2.0' },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 401) throw new Error('邮箱或密码不正确');
    if (resp.status === 429) throw new Error('尝试次数过多，请稍后再试');
    throw new Error(text || `登录失败: HTTP ${resp.status}`);
  }
  const data: {
    user_id: string;
    access_token: string;
    refresh_token: string;
    email?: string;
  } = await resp.json();
  return {
    user_id: data.user_id,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    email: data.email,
  };
}

export async function register(
  email: string,
  password: string,
  baseUrl: string,
): Promise<AuthSession> {
  const resp = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      device: { name: 'web', os: 'browser', app_version: '0.2.0' },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 409) throw new Error('该邮箱已被注册');
    if (resp.status === 400) throw new Error('密码太弱（至少 8 位）');
    throw new Error(text || `注册失败: HTTP ${resp.status}`);
  }
  const data: { user_id: string; access_token: string; refresh_token: string } =
    await resp.json();
  return {
    user_id: data.user_id,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  };
}

export async function refresh(
  refresh_token: string,
  baseUrl: string,
): Promise<AuthSession> {
  const resp = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token }),
  });
  if (!resp.ok) {
    clearSession();
    throw new Error('登录已过期，请重新登录');
  }
  const data: { user_id: string; access_token: string; refresh_token: string } =
    await resp.json();
  return {
    user_id: data.user_id,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  };
}

export async function logout(baseUrl: string): Promise<void> {
  const sess = loadSession();
  if (sess) {
    try {
      await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: sess.refresh_token }),
      });
    } catch {
      // best-effort server logout; always clear local session
    }
  }
  clearSession();
}
