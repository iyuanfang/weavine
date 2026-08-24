import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { MarkdownView } from '../components/MarkdownView';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { SearchablePicker } from '../components/SearchablePicker';
import type {
  Action,
  Contact,
  Event,
  Note,
  NoteEntityLink,
  Project,
} from '../lib/adapter/types';

type EntityKind = 'contact' | 'project' | 'event' | 'action';

const ENTITY_LABELS: Record<EntityKind, string> = {
  contact: '联系人',
  project: '项目',
  event: '日程',
  action: '待办',
};

function labelOf(kind: EntityKind, id: string, rosters: EntityRosters): string {
  switch (kind) {
    case 'contact':
      return rosters.contacts.find((c) => c.id === id)?.nickname ?? '(已删除)';
    case 'project':
      return rosters.projects.find((p) => p.id === id)?.title ?? '(已删除)';
    case 'event':
      return rosters.events.find((e) => e.id === id)?.title ?? '(已删除)';
    case 'action':
      return rosters.actions.find((a) => a.id === id)?.title ?? '(已删除)';
  }
}

function entityOptions(kind: EntityKind, rosters: EntityRosters) {
  switch (kind) {
    case 'contact':
      return rosters.contacts.map((c) => ({
        id: c.id,
        label: c.nickname || c.name || '(无昵称)',
        sublabel: c.company ?? null,
      }));
    case 'project':
      return rosters.projects.map((p) => ({
        id: p.id,
        label: p.title,
        sublabel: p.stage ?? null,
      }));
    case 'event':
      return rosters.events.map((e) => ({
        id: e.id,
        label: e.title,
        sublabel: e.start_at ?? null,
      }));
    case 'action':
      return rosters.actions.map((a) => ({
        id: a.id,
        label: a.title,
        sublabel: a.status ?? null,
      }));
  }
}

interface EntityRosters {
  contacts: Contact[];
  projects: Project[];
  events: Event[];
  actions: Action[];
}

function useEntityRosters(): EntityRosters {
  const adapter = useAdapter();
  const userId = useUserId();
  const [data, setData] = useState<EntityRosters>({
    contacts: [],
    projects: [],
    events: [],
    actions: [],
  });
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    Promise.all([
      adapter.contacts.list({ user_id: userId, limit: 500 }).then((r) => r.items ?? []).catch(() => []),
      adapter.projects.list({ user_id: userId, archived: 'false', limit: 500 }).catch(() => []),
      adapter.events.list({ user_id: userId, limit: 500 }).catch(() => []),
      adapter.actions.list({
        user_id: userId,
        archived: 'false',
        limit: 500,
      }).catch(() => []),
    ]).then(([c, p, e, a]) => {
      if (cancelled) return;
      setData({
        contacts: c as Contact[],
        projects: p as Project[],
        events: e as Event[],
        actions: a as Action[],
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  return data;
}

interface EntityChipProps {
  link: NoteEntityLink;
  onRemove?: () => void;
  rosters: EntityRosters;
}
function EntityChip({ link, onRemove, rosters }: EntityChipProps) {
  return (
    <span className="entity-chip">
      <span className="entity-chip__kind">{ENTITY_LABELS[link.entity_type]}</span>
      <span className="entity-chip__label">{labelOf(link.entity_type, link.entity_id, rosters)}</span>
      {onRemove && (
        <button
          type="button"
          className="entity-chip__remove"
          onClick={onRemove}
          aria-label="移除关联"
        >
          ×
        </button>
      )}
    </span>
  );
}

interface EntityPickerProps {
  rosters: EntityRosters;
  value: NoteEntityLink[];
  onChange: (next: NoteEntityLink[]) => void;
}
function EntityPicker({ rosters, value, onChange }: EntityPickerProps) {
  const [activeKind, setActiveKind] = useState<EntityKind>('contact');
  const [pickerValue, setPickerValue] = useState('');

  const addLink = (kind: EntityKind, id: string) => {
    if (!id) return;
    if (value.some((l) => l.entity_type === kind && l.entity_id === id)) return;
    onChange([...value, { entity_type: kind, entity_id: id }]);
    setPickerValue('');
  };

  const removeLink = (kind: EntityKind, id: string) => {
    onChange(value.filter((l) => !(l.entity_type === kind && l.entity_id === id)));
  };

  return (
    <div className="entity-picker">
      <div className="entity-picker__chips">
        {value.length === 0 && <span className="entity-picker__empty">未关联任何实体</span>}
        {value.map((l) => (
          <EntityChip
            key={`${l.entity_type}:${l.entity_id}`}
            link={l}
            rosters={rosters}
            onRemove={() => removeLink(l.entity_type, l.entity_id)}
          />
        ))}
      </div>
      <div className="entity-picker__add">
        <div className="entity-picker__tabs">
          {(Object.keys(ENTITY_LABELS) as EntityKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`entity-picker__tab ${activeKind === k ? 'is-active' : ''}`}
              onClick={() => {
                setActiveKind(k);
                setPickerValue('');
              }}
            >
              + {ENTITY_LABELS[k]}
            </button>
          ))}
        </div>
        <SearchablePicker
          value={pickerValue}
          onChange={(id) => addLink(activeKind, id)}
          options={entityOptions(activeKind, rosters)}
          placeholder={`搜索${ENTITY_LABELS[activeKind]}…`}
          emptyText="没有匹配项"
        />
      </div>
    </div>
  );
}

export function NoteNew() {
  const adapter = useAdapter();
  const navigate = useNavigate();
  const rosters = useEntityRosters();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [links, setLinks] = useState<NoteEntityLink[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !body.trim()) {
      setError('标题或正文不能为空');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await adapter.notes.create({
        title: title.trim() || '（无标题）',
        body,
        entity_links: links,
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
        <div className="note-edit__editor">
          <MarkdownEditor value={body} onChange={setBody} />
        </div>
        <div className="note-edit__section">
          <label className="note-edit__label">关联实体</label>
          <EntityPicker rosters={rosters} value={links} onChange={setLinks} />
        </div>
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
  const rosters = useEntityRosters();
  const [note, setNote] = useState<Note | null | undefined>(undefined);
  const [entityLinks, setEntityLinks] = useState<NoteEntityLink[]>([]);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftLinks, setDraftLinks] = useState<NoteEntityLink[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  const persist = async (opts?: { force?: boolean }) => {
    if (!userId || !id || !note) return;
    if (!opts?.force && !dirtyRef.current) return;
    const title = draftTitle.trim() || '（无标题）';
    const linksSnapshot = draftLinks;
    const bodySnapshot = draftBody;
    dirtyRef.current = false;
    setSaveStatus('saving');
    try {
      const updated = await adapter.notes.update(userId, id, {
        id,
        title,
        body: bodySnapshot,
        entity_links: linksSnapshot,
      });
      setNote(updated);
      setEntityLinks(linksSnapshot);
      setLastSavedAt(Date.now());
      setSaveStatus('saved');
    } catch (err) {
      dirtyRef.current = true;
      setSaveStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!userId || !id) return;
    let cancelled = false;
    setEditing(false);
    dirtyRef.current = false;
    Promise.all([
      adapter.notes.get(userId, id),
      adapter.notes.listEntityLinks(userId, id),
    ]).then(([n, ls]) => {
      if (cancelled) return;
      setNote(n);
      setEntityLinks(ls);
      if (n) {
        setDraftTitle(n.title);
        setDraftBody(n.body);
        setDraftLinks(ls);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, userId, id]);

  useEffect(() => {
    if (!editing) return;
    dirtyRef.current = true;
    const handle = window.setTimeout(() => {
      void persist();
    }, 3000);
    return () => window.clearTimeout(handle);
  }, [editing, draftTitle, draftBody, draftLinks]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (editing) void persist({ force: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, persist]);

  const onDelete = async () => {
    if (!userId || !id) return;
    if (!window.confirm('确定删除这条笔记？此操作不可恢复。')) return;
    await persist({ force: true });
    await adapter.notes.delete(userId, id);
    navigate('/notes');
  };

  const viewableLinks = useMemo(
    () =>
      entityLinks.filter((l) =>
        ['contact', 'project', 'event', 'action'].includes(l.entity_type),
      ),
    [entityLinks],
  );

  const saveLabel = (() => {
    if (saveStatus === 'saving') return '保存中…';
    if (saveStatus === 'error') return '保存失败';
    if (!lastSavedAt) return '未修改';
    const ago = Math.max(0, Math.round((Date.now() - lastSavedAt) / 1000));
    if (ago < 5) return '已保存';
    if (ago < 60) return `已保存 ${ago} 秒前`;
    return `已保存 ${Math.round(ago / 60)} 分钟前`;
  })();

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
          {editing && (
            <span
              className={`note-detail__save-status note-detail__save-status--${saveStatus}`}
            >
              {saveLabel}
            </span>
          )}
          <button type="button" className="btn" onClick={onDelete}>
            删除
          </button>
          {editing ? (
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              完成
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setEditing(true)}
            >
              编辑
            </button>
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
            placeholder="标题"
          />
          <div className="note-edit__editor">
            <MarkdownEditor value={draftBody} onChange={setDraftBody} />
          </div>
          <div className="note-edit__section">
            <label className="note-edit__label">关联实体</label>
            <EntityPicker rosters={rosters} value={draftLinks} onChange={setDraftLinks} />
          </div>
        </div>
      ) : (
        <article className="note-detail__view">
          <h1 className="note-detail__title">{note.title || '（无标题）'}</h1>
          <p className="note-detail__meta">
            更新于 {new Date(note.updated_at).toLocaleString('zh-CN')}
          </p>
          {viewableLinks.length > 0 && (
            <div className="note-detail__chips">
              {viewableLinks.map((l) => (
                <EntityChip
                  key={`${l.entity_type}:${l.entity_id}`}
                  link={l}
                  rosters={rosters}
                />
              ))}
            </div>
          )}
          <MarkdownView body={note.body} />
        </article>
      )}
      {error && <p className="danger">{error}</p>}
    </div>
  );
}