import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { useGraphInvalidation, type GraphCenter } from './GraphQuickCreateModal';
import type { NoteEntityLink } from '../lib/adapter/types';

const CENTER_TYPES: NoteEntityLink['entity_type'][] = [
  'contact',
  'project',
  'event',
  'action',
  'interaction',
];

export interface GraphQuickNoteFormProps {
  center: GraphCenter;
  onClose: () => void;
  onCreated: (id: string) => void;
  onCancel: () => void;
}

export function GraphQuickNoteForm({
  center,
  onClose,
  onCreated,
  onCancel,
}: GraphQuickNoteFormProps) {
  const adapter = useAdapter();
  const userId = useUserId();
  const invalidate = useGraphInvalidation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canLink = (CENTER_TYPES as readonly string[]).includes(center.type);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('未登录');
      const linkEntityType = CENTER_TYPES.find((t) => t === center.type);
      const note = await adapter.notes.create(userId, {
        title: title.trim(),
        body: body.trim(),
        entity_links: linkEntityType
          ? [{ entity_type: linkEntityType, entity_id: center.id }]
          : undefined,
      });
      return note;
    },
    onSuccess: (note) => {
      invalidate();
      onCreated(note.id);
      onClose();
    },
    onError: (e: unknown) => setError(String(e)),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) {
          setError('请填写标题');
          return;
        }
        setError(null);
        mutation.mutate();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <Field label="标题">
        <input
          type="text"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例:2026-08-30 与张总碰头"
          style={inputStyle}
        />
      </Field>
      <Field label="内容">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="随便记点什么…"
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </Field>
      {canLink && (
        <div style={{ fontSize: 12, color: '#64748b' }}>
          将自动关联
        </div>
      )}
      {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} className="btn btn-ghost">返回</button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={mutation.isPending}
          style={{ opacity: mutation.isPending ? 0.6 : 1 }}
        >
          {mutation.isPending ? '创建中…' : '创建并关联'}
        </button>
      </div>
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
