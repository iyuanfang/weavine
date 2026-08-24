import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { MarkdownView } from '../components/MarkdownView';
import type { Note } from '../lib/adapter/types';

export function NoteNew() {
  const adapter = useAdapter();
  const userId = useUserId() ?? '';
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      setError('本地用户尚未就绪');
      return;
    }
    if (!title.trim() && !body.trim()) {
      setError('标题或正文不能为空');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await adapter.notes.create({
        user_id: userId,
        title: title.trim() || '（无标题）',
        body,
      });
      navigate(`/notes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="page note-edit">
      <header className="page-header">
        <button type="button" className="btn" onClick={() => navigate('/notes')}>
          ← 返回
        </button>
        <h1>新建笔记</h1>
      </header>
      <form onSubmit={onSubmit} className="note-edit__form">
        <input
          type="text"
          className="input-base note-edit__title"
          placeholder="标题（可选，留空则填「（无标题）」）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <textarea
          className="input-base note-edit__body"
          placeholder={'Markdown 正文。引用联系人/项目/待办/日程：\n\n[[Contact:张三]] 推荐我看《XXX》\n[[Project:客户调研]] 计划下季度启动\n'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
        />
        {error && <p className="danger">{error}</p>}
        <div className="note-edit__actions">
          <button type="button" className="btn" onClick={() => navigate('/notes')}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function NoteDetail() {
  const { id } = useParams<{ id: string }>();
  const adapter = useAdapter();
  const userId = useUserId() ?? '';
  const navigate = useNavigate();
  const [note, setNote] = useState<Note | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !id) return;
    adapter.notes.get(userId, id).then((n) => {
      setNote(n);
      if (n) {
        setDraftTitle(n.title);
        setDraftBody(n.body);
      }
    });
  }, [adapter, userId, id]);

  const onSave = async () => {
    if (!userId || !id) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await adapter.notes.update(userId, id, {
        id,
        title: draftTitle.trim() || '（无标题）',
        body: draftBody,
      });
      setNote(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!userId || !id) return;
    if (!window.confirm('确定删除这条笔记？此操作不可恢复。')) return;
    await adapter.notes.delete(userId, id);
    navigate('/notes');
  };

  if (note === undefined) return <div className="page">加载中…</div>;
  if (note === null) {
    return (
      <div className="page">
        <p>笔记不存在或已被删除。</p>
        <button type="button" className="btn" onClick={() => navigate('/notes')}>
          返回列表
        </button>
      </div>
    );
  }

  return (
    <div className="page note-detail">
      <header className="page-header">
        <button type="button" className="btn" onClick={() => navigate('/notes')}>
          ← 返回
        </button>
        <div className="note-detail__actions">
          {editing ? (
            <>
              <button type="button" className="btn" onClick={() => {
                setDraftTitle(note.title);
                setDraftBody(note.body);
                setEditing(false);
              }}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                编辑
              </button>
              <button type="button" className="btn btn-danger" onClick={onDelete}>
                删除
              </button>
            </>
          )}
        </div>
      </header>

      {editing ? (
        <div className="note-detail__edit">
          <input
            type="text"
            className="input-base note-edit__title"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
          />
          <textarea
            className="input-base note-edit__body"
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={18}
          />
        </div>
      ) : (
        <article className="note-detail__view">
          <h1 className="note-detail__title">{note.title || '（无标题）'}</h1>
          <p className="note-detail__meta">
            更新于 {new Date(note.updated_at).toLocaleString('zh-CN')}
          </p>
          <MarkdownView body={note.body} />
        </article>
      )}
      {error && <p className="danger">{error}</p>}
    </div>
  );
}