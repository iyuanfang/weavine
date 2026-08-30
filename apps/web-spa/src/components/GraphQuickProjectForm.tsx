import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { useGraphInvalidation, type GraphCenter } from './GraphQuickCreateModal';

export interface GraphQuickProjectFormProps {
  center: GraphCenter;
  onClose: () => void;
  onCreated: (id: string) => void;
  onCancel: () => void;
}

export function GraphQuickProjectForm({
  center,
  onClose,
  onCreated,
  onCancel,
}: GraphQuickProjectFormProps) {
  const adapter = useAdapter();
  const userId = useUserId();
  const invalidate = useGraphInvalidation();
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState('general');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('未登录');
      const project = await adapter.projects.create({
        user_id: userId,
        title: title.trim(),
        template,
      });
      if (center.type === 'contact') {
        await adapter.projectContacts.add(project.id, center.id).catch(() => {
          // Linking may fail (e.g. contact not loaded yet); creation is the
          // primary goal, the user can re-link manually.
        });
      }
      return project;
    },
    onSuccess: (project) => {
      invalidate();
      onCreated(project.id);
      onClose();
    },
    onError: (e: unknown) => {
      setError(String(e));
    },
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
          placeholder="例:6月客户分享会"
          style={inputStyle}
        />
      </Field>
      <Field label="类型">
        <select value={template} onChange={(e) => setTemplate(e.target.value)} style={inputStyle}>
          <option value="general">一般</option>
          <option value="client">客户</option>
          <option value="personal">个人</option>
        </select>
      </Field>
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
