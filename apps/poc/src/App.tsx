import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type Contact = {
  id: string;
  ownerId: string;
  nickname: string;
  name: string | null;
  company: string | null;
  importance: string;
  reminderEnabled: boolean;
};

type LogEntry = string;

export default function App() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [t, setT] = useState(0);
  const [nickname, setNickname] = useState('张三');
  const [company, setCompany] = useState('ACME');
  const [submitting, setSubmitting] = useState(false);

  const log = (msg: string) =>
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} ${msg}`].slice(-50));

  useEffect(() => {
    log('Component mounted');
    void refresh();
  }, []);

  async function refresh() {
    setError(null);
    try {
      log('→ invoke list_contacts { owner_id: user-local-1 }');
      const start = performance.now();
      const list = (await invoke('list_contacts', {
        p: { owner_id: 'user-local-1', search: null, importance: null, tag_id: null },
      })) as Contact[];
      const ms = Math.round(performance.now() - start);
      log(`← list_contacts returned ${list.length} items in ${ms}ms`);
      setContacts(list);
      setT((x) => x + 1);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`✗ list_contacts failed: ${msg}`);
      setError(msg);
    }
  }

  async function create() {
    setSubmitting(true);
    try {
      log(`→ invoke create_contact { nickname: ${nickname}, company: ${company} }`);
      const created = (await invoke('create_contact', {
        input: {
          owner_id: 'user-local-1',
          nickname,
          name: null,
          company,
          title: null,
          city: null,
          email: null,
          phone: null,
          wechat: null,
          notes: null,
          importance: 'normal',
          tag_ids: null,
        },
      })) as Contact;
      log(`← created ${created.id}`);
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`✗ create_contact failed: ${msg}`);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteOne(id: string) {
    try {
      log(`→ invoke delete_contact { id: ${id} }`);
      await invoke('delete_contact', { id });
      log(`← deleted`);
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`✗ delete_contact failed: ${msg}`);
      setError(msg);
    }
  }

  return (
    <div>
      <h1>PRM PoC: Tauri → Rust 调用</h1>
      <p className="meta">
        验证 Vite SPA 里的 <code>invoke()</code> 真能命中 Rust commands。
        {' '}页面刷新次数: {t}
      </p>

      <h2>新增联系人</h2>
      <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="昵称" />
      <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="公司" />
      <button onClick={create} disabled={submitting}>
        {submitting ? '提交中…' : '新增'}
      </button>
      <button onClick={refresh}>刷新列表</button>

      <h2 style={{ marginTop: '24px' }}>联系人列表 ({contacts.length})</h2>
      {error && <pre className="err">{error}</pre>}
      {contacts.length === 0 && !error && <p className="meta">（空——试试点「新增」）</p>}
      {contacts.map((c) => (
        <div className="row" key={c.id}>
          <strong>{c.nickname}</strong>
          {c.name ? ` (${c.name})` : ''} — {c.company ?? '—'}
          <span className="meta"> · {c.importance} · {c.id.slice(0, 8)}</span>
          <button style={{ float: 'right' }} onClick={() => deleteOne(c.id)}>
            删除
          </button>
        </div>
      ))}

      <h2 style={{ marginTop: '24px' }}>调用日志</h2>
      <div className="log">
        {logs.length === 0 ? <em>no calls yet</em> : logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
