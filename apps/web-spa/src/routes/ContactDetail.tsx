import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { BacklinksPanel } from '../components/BacklinksPanel';
import { AvatarCropModal } from '../components/AvatarCropModal';
import { AvatarViewModal } from '../components/AvatarViewModal';
import { CadencePicker } from '../components/CadencePicker';
import { ReminderCountdown } from '../components/ReminderCountdown';
import { InteractionSourceTag } from '../components/InteractionSourceTag';
import { CardImageViewModal } from '../components/CardImageViewModal';
import { EntityGraph, ALL_TYPES, TYPE_META } from '../components/EntityGraph';
import { GraphQuickCreateModal } from '../components/GraphQuickCreateModal';
import { emit } from '../lib/telemetry';
import { avatarBg } from '../lib/contactColor';
import { tagColor } from '../lib/tagColor';
import { avatarUrlFor } from '../lib/avatarUrl';
import { backTarget } from '../lib/backNavigation';
import type { CreateInteractionInput, EntityGraphNode, EntityGraphNodeType, MediaItem } from '../lib/adapter/types';

const FILTER_STORAGE_KEY = 'weavine:contact-graph-filter:v1';

function loadVisibleTypes(): Set<EntityGraphNodeType> {
  if (typeof window === 'undefined') return new Set(ALL_TYPES);
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return new Set(ALL_TYPES);
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set(ALL_TYPES);
    return new Set(arr.filter((t) => ALL_TYPES.includes(t as EntityGraphNodeType)) as EntityGraphNodeType[]);
  } catch {
    return new Set(ALL_TYPES);
  }
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px',
    border: 'none',
    background: active ? '#fff' : 'transparent',
    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    color: active ? '#2563eb' : '#64748b',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    fontSize: 14,
  };
}

function detailHrefFromNode(n: EntityGraphNode): string {
  switch (n.entity_type) {
    case 'contact': return `/contacts/${n.id}`;
    case 'project': return `/projects/${n.id}`;
    case 'event': return `/events/${n.id}`;
    case 'action': return `/actions/${n.id}`;
    case 'note': return `/notes/${n.id}`;
    case 'interaction': return `/interactions/${n.id}`;
    default: return '/';
  }
}

const IMPORTANCE_LABELS: Record<string, string> = {
  normal: '普通',
  high: '高',
  medium: '中',
  low: '低',
};

const IMPORTANCE_BADGE: Record<string, { bg: string; fg: string }> = {
  high: { bg: '#fef2f2', fg: '#dc2626' },
  medium: { bg: '#fffbeb', fg: '#d97706' },
  low: { bg: '#f3f4f6', fg: '#6b7280' },
};

export function ContactDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const userId = useUserId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const fromParam = searchParams.get('from');

  const back = backTarget(fromParam, '/contacts');

  const contactQuery = useQuery({
    queryKey: ['contact', id],
    queryFn: () => adapter.contacts.get(id),
  });

  const eventsQuery = useQuery({
    queryKey: ['events', userId, 'for-contact', id, 'active'],
    queryFn: () =>
      adapter.events.list({
        user_id: userId!,
        contact_id: id,
        archived: 'false',
        limit: 20,
      }),
    enabled: !!userId,
  });

  const actionsQuery = useQuery({
    queryKey: ['actions', userId, 'for-contact', id, 'active'],
    queryFn: () =>
      adapter.actions.list({
        user_id: userId!,
        contact_id: id,
        archived: 'false',
        limit: 20,
      }),
    enabled: !!userId,
  });

  const interactionsQuery = useQuery({
    queryKey: ['interactions', userId, 'for-contact', id],
    queryFn: () =>
      adapter.interactions.list({
        user_id: userId!,
        contact_id: id,
        limit: 20,
      }),
    enabled: !!userId,
  });

  const cardImagesQuery = useQuery({
    queryKey: ['media', 'card_image', 'contact', id],
    queryFn: () =>
      adapter.media.listByOwner({
        kind: 'card_image',
        owner_type: 'contact',
        owner_id: id,
      }),
    enabled: !!id,
  });

  const [interactionSummary, setInteractionSummary] = useState('');
  const [interactionChannel, setInteractionChannel] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [viewingAvatar, setViewingAvatar] = useState(false);
  const [viewingCard, setViewingCard] = useState(false);
  const [tab, setTab] = useState<'detail' | 'graph'>('detail');
  const [visibleTypes, setVisibleTypes] = useState<Set<EntityGraphNodeType>>(() => loadVisibleTypes());
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(Array.from(visibleTypes)));
      } catch {
        // localStorage may be full / disabled; filter state still works in memory.
      }
    }
  }, [visibleTypes]);

  useEffect(() => {
    if (tab === 'graph') {
      emit('graph_tab_open', {
        entity_type: 'contact',
        entity_id: id,
        source: 'tab',
      });
    }
  }, [tab, id]);

  const cardImages: MediaItem[] = cardImagesQuery.data ?? [];
  const cardImageUrl = (m: MediaItem) =>
    adapter.baseUrl
      ? `${adapter.baseUrl}/files/${m.storage_key}`
      : `/files/${m.storage_key}`;

  const createInteractionMutation = useMutation({
    mutationFn: (input: CreateInteractionInput) => adapter.interactions.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['interactions', userId, 'for-contact', id],
      });
      setInteractionSummary('');
      setInteractionChannel('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (contactId: string) => adapter.contacts.delete(contactId),
    onSuccess: () => {
      // Required: navigate() remounts ContactsList but the cached
      // ['contacts', userId] query is still fresh (staleTime: 30s), so the
      // list would keep showing the deleted row until F5.
      queryClient.invalidateQueries({ queryKey: ['contacts', userId] });
      navigate(fromParam || '/contacts');
    },
  });

  const cadenceMutation = useMutation({
    mutationFn: (overrideDays: number | null) =>
      adapter.contacts.update({
        id,
        keep_in_touch_cadence_days: overrideDays && overrideDays > 0 ? overrideDays : 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact', id] });
    },
  });

  const handleCreateInteraction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!interactionSummary.trim() || !userId) return;
    createInteractionMutation.mutate({
      user_id: userId,
      contact_id: id,
      occurred_at: new Date().toISOString(),
      channel: interactionChannel.trim() || null,
      summary: interactionSummary.trim(),
    });
  };

  const handleDelete = () => {
    if (confirm('确定要删除这个联系人吗？此操作不可恢复。')) {
      deleteMutation.mutate(id);
    }
  };

  if (contactQuery.isLoading) {
    return <div className="loading">加载中</div>;
  }

  if (contactQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载联系人失败: {String(contactQuery.error)}</div>
      </div>
    );
  }

  const contact = contactQuery.data!;
  const events = eventsQuery.data ?? [];
  const actions = actionsQuery.data ?? [];
  const interactions = interactionsQuery.data ?? [];

  const displayName = contact.nickname || contact.name || '?';
  const contactAvatarUrl = avatarUrlFor(contact, { baseUrl: adapter.baseUrl });

  const onPickAvatar = () => fileInputRef.current?.click();

  const onAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    console.log('[avatar-pick] onChange fired, file=', file ? `${file.name} type=${file.type} size=${file.size}` : 'NULL', 'contact.id=', contact.id);
    if (!file || !contact.id) return;
    console.log('[avatar-pick] setCropFile -> opening crop modal');
    setCropFile(file);
  };

  const onCropConfirm = async (blob: Blob) => {
    setCropFile(null);
    if (!contact.id) return;
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      console.log('[avatar-upload] blob type=', blob.type, 'size=', bytes.byteLength, 'contact=', contact.id);
      if (bytes.byteLength === 0) {
        setAvatarError('裁剪结果为空，请重新选择图片');
        return;
      }
      const resp = await adapter.media.upload({
        kind: 'avatar',
        owner_type: 'contact',
        owner_id: contact.id,
        bytes,
        mime: blob.type || 'image/webp',
        filename: 'avatar.webp',
      });
      console.log('[avatar-upload] response=', resp);
      await queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
    } catch (err) {
      console.error('avatar upload failed', err);
      // Tauri v2 rejects with the raw Rust error string (not an Error
      // instance) — surface it so the real cause is visible.
      setAvatarError(err instanceof Error ? err.message : String(err));
    } finally {
      setAvatarUploading(false);
    }
  };
  const imp = IMPORTANCE_BADGE[contact.importance] ?? IMPORTANCE_BADGE.low;
  const impLabel = IMPORTANCE_LABELS[contact.importance];

  const infoFields: [string, string | null][] = [
    ['姓名', contact.name],
    ['公司', contact.company],
    ['职位', contact.title],
    ['地址', contact.address],
    ['邮箱', contact.email],
    ['电话', contact.phone],
    ['微信', contact.wechat],
  ].filter(([, v]) => v) as [string, string][];

  const isLoading =
    eventsQuery.isLoading ||
    actionsQuery.isLoading ||
    interactionsQuery.isLoading;

  return (
    <div className="page">
      <div
        className="card"
        style={{
          padding: 24,
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          flexWrap: 'wrap',
          rowGap: 16,
        }}
      >
        <div
          className="avatar avatar--lg"
          style={{ background: avatarBg(displayName), position: 'relative', cursor: 'pointer' }}
          onClick={() => contactAvatarUrl && setViewingAvatar(true)}
          title={contactAvatarUrl ? '点击查看大图' : ''}
        >
          <Avatar name={displayName} src={contactAvatarUrl} size={88} />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: 'none' }}
            onChange={onAvatarChange}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cluster cluster--loose">
            <h1 className="page-title" style={{ margin: 0 }}>
              {displayName}
            </h1>
            {impLabel && (
              <span className="badge" style={{ background: imp.bg, color: imp.fg }}>
                {impLabel}
              </span>
            )}
          </div>
          {contact.tags.length > 0 && (
            <div className="cluster" style={{ marginTop: 8 }}>
              {contact.tags.map((tag) => (
                <Link
                  key={tag.id}
                  to={`/tags/${tag.id}`}
                  className="tag-chip"
                  style={{
                    background: `${tagColor(tag)}14`,
                    borderColor: `${tagColor(tag)}40`,
                    color: tagColor(tag),
                    textDecoration: 'none',
                  }}
                >
                  <span
                    className="tag-chip__dot"
                    style={{ background: tagColor(tag) }}
                  />
                  {tag.name}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', rowGap: 8 }}>
          <Link to={back.href} className="btn btn-ghost">
            {back.label}
          </Link>
          <button
            type="button"
            onClick={onPickAvatar}
            disabled={avatarUploading}
            className="btn btn-secondary"
            style={{ opacity: avatarUploading ? 0.6 : 1 }}
          >
            {avatarUploading ? '上传中…' : '更换头像'}
          </button>
          {avatarError && (
            <span role="alert" style={{ color: '#dc2626', fontSize: 13, alignSelf: 'center' }}>
              {avatarError}
            </span>
          )}
          <Link
            to={`/graph/contact/${id}`}
            className="btn btn-secondary"
            data-testid="contact-graph-full-link"
          >
            ⤢ 完整图
          </Link>
          <Link
            to={`/contacts/${id}/edit?from=${encodeURIComponent(fromParam || `/contacts/${id}`)}`}
            className="btn btn-secondary"
          >
            编辑
          </Link>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="btn btn-danger"
            style={{ opacity: deleteMutation.isPending ? 0.6 : 1 }}
          >
            {deleteMutation.isPending ? '删除中…' : '删除'}
          </button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="详情 / 关系图"
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid #e2e8f0',
          marginTop: 16,
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'detail'}
          data-testid="contact-tab-detail"
          onClick={() => setTab('detail')}
          style={tabStyle(tab === 'detail')}
        >
          详情
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'graph'}
          data-testid="contact-tab-graph"
          onClick={() => setTab('graph')}
          style={tabStyle(tab === 'graph')}
        >
          🕸️ 关系图
        </button>
      </div>

      {tab === 'graph' && (
        <section className="section" style={{ marginTop: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 12, color: '#64748b' }}>筛选类型:</span>
            {ALL_TYPES.map((t) => {
              const meta = TYPE_META[t];
              const checked = visibleTypes.has(t);
              return (
                <label
                  key={t}
                  data-testid={`graph-filter-${t}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    border: `1px solid ${checked ? meta.color : '#e2e8f0'}`,
                    borderRadius: 6,
                    background: checked ? `${meta.color}10` : '#fff',
                    fontSize: 13,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = new Set(visibleTypes);
                      if (e.target.checked) next.add(t);
                      else next.delete(t);
                      setVisibleTypes(next);
                    }}
                    style={{ margin: 0 }}
                  />
                  <span>{meta.icon}</span>
                  <span>{meta.label}</span>
                </label>
              );
            })}
            <button
              type="button"
              data-testid="graph-quick-create-open"
              onClick={() => setShowQuickCreate(true)}
              className="btn btn-primary"
              style={{ marginLeft: 'auto', padding: '6px 12px' }}
            >
              + 新建
            </button>
          </div>
          <EntityGraph
            centerType="contact"
            centerId={id}
            visibleTypes={visibleTypes}
            onNeighborOpen={(n: EntityGraphNode) => {
              emit('graph_node_click', {
                entity_type: n.entity_type,
                center_type: 'contact',
                action: 'detail',
              });
              navigate(detailHrefFromNode(n));
            }}
            onNeighborDrill={(n, e) => {
              e.stopPropagation();
              if (!['contact', 'project', 'event', 'action', 'note', 'interaction'].includes(n.entity_type)) return;
              emit('graph_node_click', {
                entity_type: n.entity_type,
                center_type: 'contact',
                action: 'drill',
              });
              navigate(`/graph/${n.entity_type}/${n.id}`);
            }}
          />
          <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
            单击节点 = 打开详情页;↗ = 以此节点为中心重画图。
            需要看更多关联?点右上「⤢ 完整图」去全屏视图。
          </div>
        </section>
      )}

      {tab === 'detail' && infoFields.length > 0 && (
        <section className="section">
          <h2 className="section__title">基本信息</h2>
          <div className="card" style={{ marginTop: 10, padding: 16 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px 24px',
              }}
            >
              {infoFields.map(([k, v]) => (
                <div key={k}>
                  <div className="text-xs text-muted" style={{ marginBottom: 2 }}>
                    {k}
                  </div>
                  <div style={{ fontSize: 'var(--text-base)' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === 'detail' && (
      <>
      <section className="section">
        <h2 className="section__title">保持联系</h2>
        <div className="card" style={{ marginTop: 10, padding: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <CadencePicker
            importance={contact.importance || 'low'}
            value={contact.keep_in_touch_cadence_days ?? null}
            onChange={(next) => cadenceMutation.mutate(next)}
          />
          {cadenceMutation.isPending && (
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>保存中…</span>
          )}
          {cadenceMutation.isError && (
            <span role="alert" style={{ color: '#dc2626', fontSize: 'var(--text-sm)' }}>
              保存失败
            </span>
          )}
          <ReminderCountdown
            importance={contact.importance || 'low'}
            lastInteractionIso={contact.last_interaction_at}
            overrideDays={contact.keep_in_touch_cadence_days}
            size="md"
          />
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            调整后系统会按这个周期提醒你再次联系
          </span>
        </div>
      </section>

      {cardImages.length > 0 && (
        <section className="section">
          <h2 className="section__title">名片</h2>
          <div className="card" style={{ marginTop: 10, padding: 16 }}>
            <img
              src={cardImageUrl(cardImages[0])}
              alt={`${displayName} 的名片`}
              onClick={() => setViewingCard(true)}
              style={{ maxWidth: 320, maxHeight: 220, borderRadius: 6, cursor: 'pointer' }}
              data-testid="contact-card-image"
            />
          </div>
        </section>
      )}

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">相关日程</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Link
              to={`/events/new?contactId=${id}&from=${encodeURIComponent(`/contacts/${id}`)}`}
              className="section__view-all"
              data-testid="contact-new-event-link"
            >
              + 新建日程
            </Link>
            <Link to="/calendar" className="section__view-all">
              全部 →
            </Link>
          </div>
        </div>
        {isLoading ? (
          <div className="loading">加载中</div>
        ) : events.length === 0 ? (
          <div className="empty-state">没有相关日程</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {events.map((e) => (
              <Link
                key={e.id}
                to={`/events/${e.id}?from=/contacts/${id}`}
                className="row-card"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <span style={{ fontSize: 'var(--text-lg)' }}>📅</span>
                <span className="row-card__title">{e.title}</span>
                <span className="row-card__meta">
                  {new Date(e.start_at).toLocaleDateString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                  })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">待办</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Link
              to={`/actions/new?contactId=${id}&from=${encodeURIComponent(`/contacts/${id}`)}`}
              className="section__view-all"
              data-testid="contact-new-action-link"
            >
              + 新建待办
            </Link>
            <Link to="/actions" className="section__view-all">
              全部 →
            </Link>
          </div>
        </div>
        {isLoading ? (
          <div className="loading">加载中</div>
        ) : actions.length === 0 ? (
          <div className="empty-state">没有相关待办</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {actions.map((a) => (
              <Link
                key={a.id}
                to={`/actions/${a.id}?from=/contacts/${id}`}
                className="row-card"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <span style={{ fontSize: 'var(--text-lg)' }}>{a.status === 'done' ? '✅' : '📌'}</span>
                <span
                  className="row-card__title"
                  style={{
                    textDecoration: a.status === 'done' ? 'line-through' : 'none',
                    color: a.status === 'done' ? 'var(--muted)' : 'var(--fg)',
                  }}
                >
                  {a.title}
                </span>
                <span className="row-card__meta">{a.status}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <BacklinksPanel entityType="contact" entityId={id} />

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">互动</h2>
        </div>

        <form onSubmit={handleCreateInteraction} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <select
              className="input-sm"
              value={interactionChannel}
              onChange={(e) => setInteractionChannel(e.target.value)}
              data-testid="interaction-channel"
            >
              <option value="">渠道（可选）</option>
              <option value="微信">微信</option>
              <option value="电话">电话</option>
              <option value="邮件">邮件</option>
              <option value="见面">见面</option>
            </select>
            <textarea
              className="input-base"
              placeholder="+ 记一笔这次互动…"
              value={interactionSummary}
              onChange={(e) => setInteractionSummary(e.target.value)}
              required
              style={{ minHeight: 60, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={createInteractionMutation.isPending || !interactionSummary.trim()}
              >
                {createInteractionMutation.isPending ? '保存中…' : '记录'}
              </button>
            </div>
          </div>
        </form>

        {interactionsQuery.isLoading ? (
          <div className="loading">加载中</div>
        ) : interactions.length === 0 ? (
          <div className="empty-state">还没有互动记录</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {interactions.map((i) => (
              <Link
                key={i.id}
                to={`/interactions/${i.id}?from=/contacts/${id}`}
                className="row-card"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <span style={{ fontSize: 'var(--text-lg)' }}>💬</span>
                <span className="row-card__meta">
                  {new Date(i.occurred_at).toLocaleString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </span>
                <span className="row-card__title">{i.summary}</span>
                <InteractionSourceTag source={i.source} />
                {i.channel && <span className="badge badge--muted">{i.channel}</span>}
              </Link>
            ))}
          </div>
        )}
      </section>
      </>
      )}

      {viewingAvatar && contactAvatarUrl && (
        <AvatarViewModal
          src={contactAvatarUrl}
          alt={displayName}
          onClose={() => setViewingAvatar(false)}
        />
      )}

      {viewingCard && cardImages.length > 0 && (
        <CardImageViewModal
          src={cardImageUrl(cardImages[0])}
          alt={`${displayName} 的名片`}
          onClose={() => setViewingCard(false)}
        />
      )}

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={onCropConfirm}
        />
      )}

      {showQuickCreate && (
        <GraphQuickCreateModal
          centerType="contact"
          centerId={id}
          onClose={() => setShowQuickCreate(false)}
        />
      )}
    </div>
  );
}