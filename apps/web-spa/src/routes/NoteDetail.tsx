import { useEffect, useRef, useState } from 'react';

const NOTE_TEMPLATES: { id: string; icon: string; title: string; body: string }[] = [
  {
    id: 'meeting',
    icon: '🤝',
    title: '会议记录',
    body: `# 会议主题

**时间**：${new Date().toLocaleString('zh-CN')}
**参与人**：

## 议题
- 

## 决议
- 

## 待办
- [ ] 

`,
  },
  {
    id: 'chat',
    icon: '💬',
    title: '沟通日志',
    body: `# 沟通日志

**时间**：${new Date().toLocaleString('zh-CN')}
**渠道**：电话 / 微信 / 邮件 / 见面
**对方**：

## 关键议题
- 

## 达成共识
- 

## 待跟进
- [ ] 

`,
  },
  {
    id: 'first-meeting',
    icon: '👋',
    title: '初次见面',
    body: `# 初次见面

**日期**：
**地点**：
**介绍人**：

## 对方背景
- 

## 我的印象
- 

## 共同话题 / 兴趣点
- 

## 后续
- [ ] 

`,
  },
  {
    id: 'follow-up',
    icon: '📋',
    title: '跟进计划',
    body: `# 跟进计划

**对象**：
**背景**：

## 当前状态
- 

## 需要推动的事
- [ ] 
- [ ] 

## 卡点 / 需要支持
- 

## 下次同步时间
- 

`,
  },
  {
    id: 'gratitude',
    icon: '🙏',
    title: '感谢日志',
    body: `# 感谢

**对象**：
**事由**：
**时间**：

## 对方给我的帮助
- 

## 对我的影响
- 

## 我可以回报的
- 

`,
  },
  {
    id: 'idea',
    icon: '💡',
    title: '想法',
    body: `# 

## 为什么想做
- 

## 怎么做
- 

## 风险
- 

`,
  },
  {
    id: 'retro',
    icon: '🔄',
    title: '复盘',
    body: `# 

## 做得好的
- 

## 做得不好的
- 

## 下一步
- 

`,
  },
];
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { MarkdownView } from '../components/MarkdownView';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { SearchablePicker } from '../components/SearchablePicker';
import type {
  Action,
  Contact,
  Event,
  Interaction,
  Note,
  NoteEntityLink,
  Project,
} from '../lib/adapter/types';

type EntityKind = 'contact' | 'project' | 'event' | 'action' | 'interaction';

const ENTITY_LABELS: Record<EntityKind, string> = {
  contact: '联系人',
  project: '项目',
  event: '日程',
  action: '待办',
  interaction: '互动',
};

function labelOf(kind: EntityKind, id: string, rosters: EntityRosters): string {
  if (!rosters.loaded) return '加载中…';
  switch (kind) {
    case 'contact':
      return rosters.contacts.find((c) => c.id === id)?.nickname ?? '(已删除)';
    case 'project':
      return rosters.projects.find((p) => p.id === id)?.title ?? '(已删除)';
    case 'event':
      return rosters.events.find((e) => e.id === id)?.title ?? '(已删除)';
    case 'action':
      return rosters.actions.find((a) => a.id === id)?.title ?? '(已删除)';
    case 'interaction':
      return rosters.interactions.find((i) => i.id === id)?.summary ?? '(已删除)';
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
    case 'interaction':
      return rosters.interactions.map((i) => ({
        id: i.id,
        label: i.summary || '(空)',
        sublabel: i.channel ?? i.occurred_at?.slice(0, 10) ?? null,
      }));
  }
}

interface EntityRosters {
  contacts: Contact[];
  projects: Project[];
  events: Event[];
  actions: Action[];
  interactions: Interaction[];
  loaded: boolean;
}

function useEntityRosters(): EntityRosters {
  const adapter = useAdapter();
  const userId = useUserId();
  const [data, setData] = useState<EntityRosters>({
    contacts: [],
    projects: [],
    events: [],
    actions: [],
    interactions: [],
    loaded: false,
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
      adapter.interactions.list({ user_id: userId, limit: 500 }).catch(() => []),
    ]).then(([c, p, e, a, i]) => {
      if (cancelled) return;
      setData({
        contacts: c as Contact[],
        projects: p as Project[],
        events: e as Event[],
        actions: a as Action[],
        interactions: i as Interaction[],
        loaded: true,
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
      <span className="entity-chip__kind">{ENTITY_LABELS[link.entity_type as EntityKind] ?? link.entity_type}</span>
      <span className="entity-chip__label">{labelOf(link.entity_type as EntityKind, link.entity_id, rosters)}</span>
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
  const userId = useUserId() ?? '';
  const [searchParams] = useSearchParams();
  const preContact = searchParams.get('link_contact');
  const preProject = searchParams.get('link_project');
  const preEvent = searchParams.get('link_event');
  const preAction = searchParams.get('link_action');
  const preInteraction = searchParams.get('link_interaction');
  const cloneFrom = searchParams.get('clone_from');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [links, setLinks] = useState<NoteEntityLink[]>(() => {
    const init: NoteEntityLink[] = [];
    if (preContact) init.push({ entity_type: 'contact', entity_id: preContact });
    if (preProject) init.push({ entity_type: 'project', entity_id: preProject });
    if (preEvent) init.push({ entity_type: 'event', entity_id: preEvent });
    if (preAction) init.push({ entity_type: 'action', entity_id: preAction });
    if (preInteraction) init.push({ entity_type: 'interaction', entity_id: preInteraction });
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clone from an existing note — fetch its body + links (without the title prefix).
  useEffect(() => {
    if (!cloneFrom || !userId) return;
    let cancelled = false;
    Promise.all([
      adapter.notes.get(userId, cloneFrom),
      adapter.notes.listEntityLinks(userId, cloneFrom),
    ])
      .then(([n, ls]) => {
        if (cancelled || !n) return;
        setTitle('');
        setBody(n.body);
        setLinks(ls);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cloneFrom, adapter, userId]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !body.trim()) {
      setError('标题或正文不能为空');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await adapter.notes.create(userId, {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        setMode((m) => (m === 'edit' ? 'preview' : 'edit'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
        <div className="note-edit__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'edit'}
            className={`note-edit__tab ${mode === 'edit' ? 'is-active' : ''}`}
            onClick={() => setMode('edit')}
          >
            编辑
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            className={`note-edit__tab ${mode === 'preview' ? 'is-active' : ''}`}
            onClick={() => setMode('preview')}
          >
            预览
          </button>
        </div>
        {mode === 'edit' ? (
          <div className="note-edit__editor">
            {body.trim() === '' && (
              <div className="note-edit__templates">
                <span className="note-edit__templates-label">快速开始：</span>
                {NOTE_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="note-edit__template"
                    onClick={() => {
                      setBody(t.body);
                      setTitle(t.title);
                    }}
                  >
                    {t.icon} {t.title}
                  </button>
                ))}
              </div>
            )}
            <MarkdownEditor
              value={body}
              onChange={(next) => {
                if (!title.trim()) {
                  const heading = next.match(/^\s*#\s+(.+?)\s*$/m);
                  if (heading) setTitle(heading[1].slice(0, 120));
                }
                setBody(next);
              }}
            />
          </div>
        ) : (
          <div className="note-edit__preview">
            <MarkdownView body={body} />
          </div>
        )}
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
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftLinks, setDraftLinks] = useState<NoteEntityLink[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const saveTokenRef = useRef(0);
  const debounceHandleRef = useRef<number | null>(null);

  const persist = async (opts?: { force?: boolean }) => {
    if (!userId || !id || !note) return;
    if (!opts?.force && !dirtyRef.current) return;
    if (debounceHandleRef.current !== null) {
      window.clearTimeout(debounceHandleRef.current);
      debounceHandleRef.current = null;
    }
    const title = draftTitle.trim() || '（无标题）';
    const linksSnapshot = draftLinks;
    const bodySnapshot = draftBody;
    dirtyRef.current = false;
    saveTokenRef.current += 1;
    const myToken = saveTokenRef.current;
    setSaveStatus('saving');
    try {
      const updated = await adapter.notes.update(userId, id, {
        id,
        title,
        body: bodySnapshot,
        entity_links: linksSnapshot,
      });
      if (myToken !== saveTokenRef.current) return;
      setNote(updated);
      setLastSavedAt(Date.now());
      setSaveStatus('saved');
    } catch (err) {
      if (myToken !== saveTokenRef.current) return;
      dirtyRef.current = true;
      setSaveStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Skip the next debounce cycle — set true when the load effect populates
  // drafts, consumed by the debounce effect when it next fires for those
  // state changes. Without this, opening a note triggers a 3 s timer that
  // persist()s identical content (bug #2: opening rewrites the row).
  const skipNextDebounceRef = useRef(true);

  useEffect(() => {
    if (!userId || !id) return;
    let cancelled = false;
    setMode('preview');
    dirtyRef.current = false;
    Promise.all([
      adapter.notes.get(userId, id),
      adapter.notes.listEntityLinks(userId, id),
    ]).then(([n, ls]) => {
      if (cancelled) return;
      setNote(n);
      if (n) {
        setDraftTitle(n.title);
        setDraftBody(n.body);
        setDraftLinks(ls);
        // The setState calls above batch into a single render → debounce
        // effect runs once with the loaded drafts. Tell it to skip that
        // single run since the change came from the server, not the user.
        skipNextDebounceRef.current = true;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, userId, id]);

  useEffect(() => {
    if (skipNextDebounceRef.current) {
      skipNextDebounceRef.current = false;
      return;
    }
    dirtyRef.current = true;
    const handle = window.setTimeout(() => {
      debounceHandleRef.current = null;
      void persist();
    }, 3000);
    debounceHandleRef.current = handle;
    return () => {
      window.clearTimeout(handle);
      // Flush on unmount / SPA navigation: if we still own the timer and
      // there are pending edits, persist immediately rather than dropping
      // them (bug #3: beforeunload doesn't catch react-router nav, so
      // without an explicit flush the 3 s window would lose the edits).
      if (handle === debounceHandleRef.current && dirtyRef.current) {
        debounceHandleRef.current = null;
        void persist();
      }
    };
  }, [draftTitle, draftBody, draftLinks]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void persist({ force: true });
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        setMode((m) => (m === 'edit' ? 'preview' : 'edit'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [persist]);

  // Warn before browser navigation if there are unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const onDelete = async () => {
    if (!userId || !id) return;
    if (!window.confirm('确定删除这条笔记？此操作不可恢复。')) return;
    await persist({ force: true });
    await adapter.notes.delete(userId, id);
    navigate('/notes');
  };

  const onCopyMarkdown = async () => {
    if (!note) return;
    const title = draftTitle.trim() || '（无标题）';
    const md = `# ${title}\n\n${draftBody}`;
    try {
      await navigator.clipboard.writeText(md);
      setSaveStatus('saved');
      setLastSavedAt(Date.now());
      window.setTimeout(() => setSaveStatus('idle'), 1500);
    } catch {
      window.prompt('复制失败，手动复制：', md);
    }
  };

  const onExportMd = async () => {
    if (!note || !userId) return;
    try {
      await persist({ force: true });
      const safeTitle = (draftTitle.trim() || 'note').replace(/[\\/:*?"<>|]/g, '_');
      const defaultName = `${safeTitle}.md`;
      const target = await adapter.md.saveDialog(defaultName);
      if (!target) return;
      await adapter.md.exportNoteAsMd(userId, note.id, target);
      window.alert(`已导出到:\n${target}\n\n文件 mtime 已设为笔记 imported_at，下次导入库走快速路径。`);
    } catch (e) {
      window.alert(`导出失败: ${String(e)}`);
    }
  };

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
          <span className={`note-detail__save-status note-detail__save-status--${saveStatus}`}>
            {saveLabel}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => navigate(`/graph/note/${id}`)}
            data-testid="note-graph-link"
          >
            🕸️ 关联图
          </button>
          <button
            type="button"
            className="btn"
            onClick={onCopyMarkdown}
            title="复制 Markdown 源码到剪贴板"
          >
            复制 MD
          </button>
          <button
            type="button"
            className="btn"
            onClick={onExportMd}
            title="导出为本地 .md 文件；文件 mtime = imported_at，下次导入走快速路径"
          >
            导出 .md
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => navigate(`/notes/new?clone_from=${id}`)}
          >
            克隆
          </button>
          <button type="button" className="btn" onClick={onDelete}>
            删除
          </button>
        </div>
      </header>

      <div className="note-detail__edit">
        <input
          type="text"
          className="input-base note-edit__title"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="标题"
        />
        <div className="note-edit__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'edit'}
            className={`note-edit__tab ${mode === 'edit' ? 'is-active' : ''}`}
            onClick={() => setMode('edit')}
          >
            编辑
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            className={`note-edit__tab ${mode === 'preview' ? 'is-active' : ''}`}
            onClick={() => setMode('preview')}
          >
            预览
          </button>
        </div>
        {mode === 'edit' ? (
          <div className="note-edit__editor">
            <MarkdownEditor value={draftBody} onChange={setDraftBody} />
          </div>
        ) : (
          <div className="note-edit__preview">
            <MarkdownView body={draftBody} />
          </div>
        )}
        <div className="note-edit__section">
          <label className="note-edit__label">关联实体</label>
          <EntityPicker rosters={rosters} value={draftLinks} onChange={setDraftLinks} />
        </div>
      </div>
      {error && <p className="danger">{error}</p>}
    </div>
  );
}