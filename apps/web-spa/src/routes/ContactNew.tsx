import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Tag, CreateContactInput } from '../lib/adapter/types';

// ── Constants ───────────────────────────────────────

const IMPORTANCE_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
] as const;

const FALLBACK_TAG_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6',
];

function tagColor(tag: Tag): string {
  return tag.color ?? FALLBACK_TAG_COLORS[tag.name.length % FALLBACK_TAG_COLORS.length];
}

// ── Page ────────────────────────────────────────────

export function ContactNew() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Form state ────────────────────────────────────

  const [nickname, setNickname] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [city, setCity] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [wechat, setWechat] = useState('');
  const [notes, setNotes] = useState('');
  const [importance, setImportance] = useState<string>('medium');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // ── Fetch tags ────────────────────────────────────

  const tagsQuery = useQuery({
    queryKey: ['tags', ownerId],
    queryFn: () => adapter.tags.list(ownerId!),
    enabled: !!ownerId,
  });

  const tags = tagsQuery.data ?? [];

  // ── Create mutation ───────────────────────────────

  const createMutation = useMutation({
    mutationFn: (input: CreateContactInput) => adapter.contacts.create(input),
    onSuccess: (contact) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', ownerId] });
      navigate(`/contacts/${contact.id}`);
    },
  });

  // ── Tag chip toggle ───────────────────────────────

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  };

  // ── Submit ────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    if (!ownerId) return;

    createMutation.mutate({
      owner_id: ownerId,
      nickname: nickname.trim(),
      name: name.trim() || null,
      company: company.trim() || null,
      title: title.trim() || null,
      city: city.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      wechat: wechat.trim() || null,
      notes: notes.trim() || null,
      importance,
      tag_ids: selectedTagIds.length > 0 ? selectedTagIds : null,
    });
  };

  const handleCancel = () => {
    navigate(-1);
  };

  // ── Guard ─────────────────────────────────────────

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  // ── Render ────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 14,
    background: '#fff',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    color: 'var(--muted)',
    marginBottom: 4,
    display: 'block',
  };

  return (
    <div className="today-page">
      <div className="section__header">
        <h1 className="section__title">新建联系人</h1>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Basic info */}
        <section className="section">
          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <label style={labelStyle}>昵称 *</label>
              <input
                style={inputStyle}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
                placeholder="给他/她起个昵称"
              />
            </div>
            <div>
              <label style={labelStyle}>姓名</label>
              <input
                style={inputStyle}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="真实姓名"
              />
            </div>
            <div>
              <label style={labelStyle}>公司</label>
              <input
                style={inputStyle}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>职位</label>
              <input
                style={inputStyle}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>城市</label>
              <input
                style={inputStyle}
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>邮箱</label>
              <input
                style={inputStyle}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>电话</label>
              <input
                style={inputStyle}
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>微信</label>
              <input
                style={inputStyle}
                value={wechat}
                onChange={(e) => setWechat(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>重要性</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={importance}
                onChange={(e) => setImportance(e.target.value)}
              >
                {IMPORTANCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Tags */}
        <section className="section">
          <label style={labelStyle}>标签</label>
          {tagsQuery.isLoading ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>加载中…</div>
          ) : tags.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>还没有标签</div>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {tags.map((tag) => {
                const active = selectedTagIds.includes(tag.id);
                const color = tagColor(tag);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: 12,
                      cursor: 'pointer',
                      border: `1px solid ${active ? color : 'var(--border)'}`,
                      background: active ? `${color}18` : '#fff',
                      color: active ? color : 'var(--fg)',
                      transition: 'all 0.1s',
                    }}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Notes */}
        <section className="section">
          <label style={labelStyle}>备注</label>
          <textarea
            style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="关于这个人的备注…"
          />
        </section>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            type="button"
            onClick={handleCancel}
            style={{
              padding: '8px 16px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            style={{
              padding: '8px 24px',
              border: 'none',
              borderRadius: 8,
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: createMutation.isPending ? 0.6 : 1,
            }}
          >
            {createMutation.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}