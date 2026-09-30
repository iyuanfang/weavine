import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { ContactPickOrCreateModal } from './ContactPickOrCreateModal';
import { useGraphInvalidation, type GraphCenter } from './GraphQuickCreateModal';

export interface GraphQuickInteractionFormProps {
  center: GraphCenter;
  onClose: () => void;
  onCreated: (id: string) => void;
  onCancel: () => void;
  /** Override the default '创建并关联' submit text (standalone creation says just 创建). */
  submitLabel?: string;
}

export function GraphQuickInteractionForm({
  center,
  onClose,
  onCreated,
  onCancel,
  submitLabel,
}: GraphQuickInteractionFormProps) {
  const adapter = useAdapter();
  const userId = useUserId();
  const invalidate = useGraphInvalidation();
  const [summary, setSummary] = useState('');
  const [channel, setChannel] = useState('');
  const [error, setError] = useState<string | null>(null);
  // An interaction is always with someone: contact is required. It's fixed
  // when the center IS the contact; otherwise picked via the picker modal.
  const contactIsCenter = center.type === 'contact';
  const [contactId, setContactId] = useState<string | null>(
    contactIsCenter ? center.id : null,
  );
  const [pickingContact, setPickingContact] = useState(false);

  const pickedContactQuery = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => adapter.contacts.get(contactId!),
    enabled: !contactIsCenter && !!contactId,
  });
  const contactLabel = contactIsCenter
    ? null
    : pickedContactQuery.data?.nickname ?? pickedContactQuery.data?.name ?? '…';

  const mutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('未登录');
      if (!contactId) throw new Error('请先选择联系人');
      const interaction = await adapter.interactions.create({
        user_id: userId,
        summary: summary.trim() || '快速记录',
        channel: channel.trim() || null,
        occurred_at: new Date().toISOString(),
        contact_id: contactId,
        action_id: center.type === 'action' ? center.id : null,
        event_id: center.type === 'event' ? center.id : null,
      });
      return interaction;
    },
    onSuccess: (interaction) => {
      invalidate();
      onCreated(interaction.id);
      onClose();
    },
    onError: (e: unknown) => setError(String(e)),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        mutation.mutate();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <Field label="联系人（必选）">
        {contactIsCenter ? (
          <div style={{ ...inputStyle, color: 'var(--muted)', background: '#f8fafc' }}>
            当前联系人
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPickingContact(true)}
            data-testid="interaction-pick-contact"
            style={{ ...inputStyle, cursor: 'pointer', textAlign: 'left', color: contactId ? 'inherit' : 'var(--muted)' }}
          >
            {contactId ? contactLabel : '必选：点击选择联系人…'}
          </button>
        )}
      </Field>
      <Field label="内容">
        <input
          type="text"
          autoFocus
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="例:微信聊了几句 / 打了个电话"
          style={inputStyle}
        />
      </Field>
      <Field label="渠道（可选）">
        <input
          type="text"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          placeholder="例:微信 / 电话 / 面谈"
          style={inputStyle}
        />
      </Field>
      <div style={{ fontSize: 12, color: '#64748b' }}>
        {contactIsCenter || center.type === 'action' || center.type === 'event'
          ? `将自动关联到当前${center.type === 'contact' ? '联系人' : center.type === 'action' ? '待办' : '日程'}`
          : null}
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} className="btn btn-ghost">返回</button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={mutation.isPending || !contactId}
          title={contactId ? undefined : '请先选择联系人'}
          style={{ opacity: mutation.isPending ? 0.6 : 1 }}
        >
          {mutation.isPending ? '创建中…' : (submitLabel ?? '创建并关联')}
        </button>
      </div>
      {pickingContact && (
        <ContactPickOrCreateModal
          title="选择联系人"
          multiple={false}
          onConfirm={(ids) => {
            if (ids[0]) setContactId(ids[0]);
            setPickingContact(false);
          }}
          onClose={() => setPickingContact(false)}
        />
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#64748b' }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 14,
};
