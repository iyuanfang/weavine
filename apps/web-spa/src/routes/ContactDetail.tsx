import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { AvatarCropModal } from '../components/AvatarCropModal';
import { AvatarViewModal } from '../components/AvatarViewModal';
import { CardImageViewModal } from '../components/CardImageViewModal';
import { RescanCardModal } from '../components/RescanCardModal';
import type { ScannedFields } from '../components/CardScanner';
import { avatarBg } from '../lib/contactColor';
import { tagColor } from '../lib/tagColor';
import { avatarUrlFor } from '../lib/avatarUrl';
import { backTarget } from '../lib/backNavigation';
import type { CreateInteractionInput, MediaItem } from '../lib/adapter/types';

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
  const [rescanOpen, setRescanOpen] = useState(false);

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
      navigate(fromParam || '/contacts');
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

  const handleRescanConfirm = async (input: {
    picked: Partial<Record<'name' | 'company' | 'title' | 'email' | 'phone' | 'address', boolean>>;
    scanned: ScannedFields;
    file: File | null;
  }) => {
    const { picked, scanned, file } = input;
    const patch: Record<string, string | null> = {};
    if (picked.name && scanned.name) patch.name = scanned.name;
    if (picked.company && scanned.company) patch.company = scanned.company;
    if (picked.title && scanned.title) patch.title = scanned.title;
    if (picked.email && scanned.email) patch.email = scanned.email;
    if (picked.phone && scanned.phone && scanned.phone.length > 0) {
      patch.phone = scanned.phone.join(' / ');
    }
    if (picked.address && scanned.address) patch.address = scanned.address;

    if (Object.keys(patch).length === 0 && !file) {
      throw new Error('请至少选择一个字段或换一张名片图片');
    }

    if (Object.keys(patch).length > 0) {
      await adapter.contacts.update({ id, ...patch });
    }
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await adapter.media.upload({
        kind: 'card_image',
        owner_type: 'contact',
        owner_id: id,
        bytes,
        mime: file.type || 'image/png',
        filename: file.name || 'card.png',
      });
    }
    await queryClient.invalidateQueries({ queryKey: ['contact', id] });
    await queryClient.invalidateQueries({ queryKey: ['media', 'card_image', 'contact', id] });
    setRescanOpen(false);
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
      setAvatarError(err instanceof Error ? err.message : '头像上传失败');
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
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
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
          <Link to={`/contacts/${id}/graph`} className="btn btn-secondary" data-testid="contact-graph-link">
            🕸️ 关系图
          </Link>
          <button
            type="button"
            onClick={() => setRescanOpen(true)}
            className="btn btn-secondary"
            data-testid="contact-rescan-btn"
          >
            📷 重新拍名片
          </button>
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

      {infoFields.length > 0 && (
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

      {contact.notes && (
        <section className="section">
          <h2 className="section__title">备注</h2>
          <div className="card" style={{ marginTop: 10 }}>
            <p style={{ margin: 0, fontSize: 'var(--text-base)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {contact.notes}
            </p>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">相关日程</h2>
          <Link to="/calendar" className="section__view-all">
            全部 →
          </Link>
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
          <Link to="/actions" className="section__view-all">
            全部 →
          </Link>
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

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">互动</h2>
        </div>

        <form onSubmit={handleCreateInteraction} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <input
              type="text"
              className="input-sm"
              placeholder="互动渠道（可选，如：微信、邮件）"
              value={interactionChannel}
              onChange={(e) => setInteractionChannel(e.target.value)}
            />
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
              <div key={i.id} className="row-card">
                <span style={{ fontSize: 'var(--text-lg)' }}>💬</span>
                <span className="row-card__meta">
                  {new Date(i.occurred_at).toLocaleDateString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                  })}
                </span>
                <span className="row-card__title">{i.summary}</span>
                {i.channel && <span className="badge badge--muted">{i.channel}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

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

      {rescanOpen && (
        <RescanCardModal
          contact={contact}
          onClose={() => setRescanOpen(false)}
          onConfirm={handleRescanConfirm}
        />
      )}
    </div>
  );
}