import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { TagPicker } from '../components/TagPicker';
import { RescanCardModal } from '../components/RescanCardModal';
import type { ScannedFields } from '../components/CardScanner';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import {
  DEFAULT_IMPORTANCE,
  IMPORTANCE_OPTIONS,
  normalizeImportance,
  type Importance,
} from '../lib/contact-importance';
import type { UpdateContactInput } from '../lib/adapter/types';

export function ContactEdit() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const userId = useUserId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const contactQuery = useQuery({
    queryKey: ['contact', id],
    queryFn: () => adapter.contacts.get(id),
  });

  const [nickname, setNickname] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [wechat, setWechat] = useState('');
  const [importance, setImportance] = useState<Importance>(DEFAULT_IMPORTANCE);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [rescanOpen, setRescanOpen] = useState(false);

  useEffect(() => {
    if (contactQuery.data && !hydrated) {
      const c = contactQuery.data;
      setNickname(c.nickname);
      setName(c.name ?? '');
      setCompany(c.company ?? '');
      setTitle(c.title ?? '');
      setAddress(c.address ?? '');
      setEmail(c.email ?? '');
      setPhone(c.phone ?? '');
      setWechat(c.wechat ?? '');
      setImportance(normalizeImportance(c.importance));
      setSelectedTagIds(c.tags.map((t) => t.id));
      setHydrated(true);
    }
  }, [contactQuery.data, hydrated]);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateContactInput) => adapter.contacts.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact', id] });
      queryClient.invalidateQueries({ queryKey: ['contacts', userId] });
      navigate('/contacts');
    },
  });


  const handleRescanConfirm = async (input: {
    picked: Partial<Record<'name' | 'company' | 'title' | 'email' | 'phone' | 'address', boolean>>;
    scanned: ScannedFields;
    file: File | null;
  }) => {
    const { picked, scanned, file } = input;
    if (picked.name && scanned.name) setName(scanned.name);
    if (picked.company && scanned.company) setCompany(scanned.company);
    if (picked.title && scanned.title) setTitle(scanned.title);
    if (picked.email && scanned.email) setEmail(scanned.email);
    if (picked.phone && scanned.phone && scanned.phone.length > 0) {
      setPhone(scanned.phone.join(' / '));
    }
    if (picked.address && scanned.address) setAddress(scanned.address);
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
      await queryClient.invalidateQueries({ queryKey: ['media', 'card_image', 'contact', id] });
    }
    setRescanOpen(false);
  };


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    const patch: UpdateContactInput = {
      id,
      nickname: nickname.trim(),
      name: name.trim() || null,
      company: company.trim() || null,
      title: title.trim() || null,
      address: address.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      wechat: wechat.trim() || null,
      importance,
      tag_ids: selectedTagIds.length > 0 ? selectedTagIds : null,
    };
    updateMutation.mutate(patch);
  };

  if (contactQuery.isLoading || !hydrated) {
    return <div className="loading">加载中</div>;
  }

  if (contactQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载联系人失败: {String(contactQuery.error)}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="编辑联系人"
      />

      {updateMutation.isError && (
        <div className="error-banner">
          <div>
            <strong>保存失败</strong>
            <div style={{ marginTop: 2, fontSize: 'var(--text-sm)' }}>
              {String(updateMutation.error?.message ?? '未知错误')}
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <section className="section">
          <div className="section__header">
            <h2 className="section__title">基本信息</h2>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setRescanOpen(true)}
              data-testid="contact-rescan-btn"
            >
              📷 重新拍名片
            </button>
          </div>
          <div className="card" style={{ marginTop: 10 }}>
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label className="input-label">昵称 *</label>
                <input
                  className="input-base"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  required
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
                  />
                </div>
                <div>
                  <label className="input-label">公司</label>
                  <input
                    className="input-base"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
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
                  <label className="input-label">地址</label>
                  <input
                    className="input-base"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
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
                    onChange={(e) => setImportance(e.target.value as Importance)}
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

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/contacts')}
          >
            取消
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={updateMutation.isPending || !nickname.trim()}
          >
            {updateMutation.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>

      {rescanOpen && contactQuery.data && (
        <RescanCardModal
          contact={contactQuery.data}
          onClose={() => setRescanOpen(false)}
          onConfirm={handleRescanConfirm}
        />
      )}
    </div>
  );
}