import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import { TagPicker } from '../components/TagPicker';
import type { CreateContactInput } from '../lib/adapter/types';

// ── Constants ───────────────────────────────────────

const IMPORTANCE_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
] as const;

// ── Page ────────────────────────────────────────────

export function ContactNew() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  const createMutation = useMutation({
    mutationFn: (input: CreateContactInput) => adapter.contacts.create(input),
    onSuccess: (contact) => {
      queryClient.invalidateQueries({ queryKey: ['contacts', ownerId] });
      navigate(`/contacts/${contact.id}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || !ownerId) return;
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

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  return (
    <div className="page page--narrow">
      <div className="page-header">
        <div>
          <h1 className="page-title">新建联系人</h1>
          <p className="page-subtitle">把一个最近见过的人加进你的人脉网络</p>
        </div>
      </div>

      {createMutation.isError && (
        <div className="error-banner" role="alert">
          <div>
            <strong>保存失败</strong>
            <div style={{ marginTop: 2, fontSize: 12 }}>
              {String(createMutation.error?.message ?? '未知错误')}
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <section className="section">
          <h2 className="section__title">基本信息</h2>
          <div className="card" style={{ marginTop: 10 }}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label className="input-label">昵称 *</label>
                <input
                  className="input-base"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  required
                  placeholder="给他/她起个昵称"
                  autoFocus
                />
              </div>
              <div className="grid-2">
                <div>
                  <label className="input-label">姓名</label>
                  <input
                    className="input-base"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="真实姓名"
                  />
                </div>
                <div>
                  <label className="input-label">公司</label>
                  <input
                    className="input-base"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="所在公司"
                  />
                </div>
              </div>
              <div className="grid-2">
                <div>
                  <label className="input-label">职位</label>
                  <input
                    className="input-base"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div>
                  <label className="input-label">城市</label>
                  <input
                    className="input-base"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid-2">
                <div>
                  <label className="input-label">邮箱</label>
                  <input
                    className="input-base"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="input-label">电话</label>
                  <input
                    className="input-base"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid-2">
                <div>
                  <label className="input-label">微信</label>
                  <input
                    className="input-base"
                    value={wechat}
                    onChange={(e) => setWechat(e.target.value)}
                  />
                </div>
                <div>
                  <label className="input-label">重要性</label>
                  <select
                    className="input-base"
                    style={{ cursor: 'pointer' }}
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
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">标签</h2>
          <div className="card" style={{ marginTop: 10 }}>
            <TagPicker
              selectedIds={selectedTagIds}
              onChange={setSelectedTagIds}
            />
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">备注</h2>
          <div className="card" style={{ marginTop: 10 }}>
            <textarea
              className="input-base"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="关于这个人的备注…"
            />
          </div>
        </section>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/contacts')}>
            取消
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={createMutation.isPending || !nickname.trim()}
          >
            {createMutation.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}