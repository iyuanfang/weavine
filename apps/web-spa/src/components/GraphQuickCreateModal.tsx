import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { GraphQuickProjectForm } from './GraphQuickProjectForm';
import { GraphQuickEventForm } from './GraphQuickEventForm';
import { GraphQuickActionForm } from './GraphQuickActionForm';
import { GraphQuickNoteForm } from './GraphQuickNoteForm';
import { GraphQuickInteractionForm } from './GraphQuickInteractionForm';
import { TYPE_META } from './EntityGraph';
import type { EntityGraphNodeType } from '../lib/adapter/types';

export type CreateKind = 'project' | 'event' | 'action' | 'note' | 'interaction';

export interface GraphCenter {
  type: EntityGraphNodeType;
  id: string;
}

const ALL_CREATABLE: CreateKind[] = ['project', 'event', 'action', 'note', 'interaction'];

export interface GraphQuickCreateModalProps {
  center: GraphCenter;
  creatable?: CreateKind[];
  onClose: () => void;
  onCreated?: (kind: CreateKind, id: string) => void;
}

export function GraphQuickCreateModal({
  center,
  creatable,
  onClose,
  onCreated,
}: GraphQuickCreateModalProps) {
  const [kind, setKind] = useState<CreateKind | null>(null);
  const options = creatable ?? ALL_CREATABLE;

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="graph-quick-create"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 10,
          padding: 20,
          maxWidth: 480,
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.04)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {kind
              ? `新建${labelFor(kind)}`
              : `关联到此${TYPE_META[center.type].label}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            style={{ padding: '2px 10px' }}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {!kind && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {options.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  data-testid={`graph-quick-create-${k}`}
                  style={{
                    padding: 14,
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    background: '#fff',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 14,
                  }}
                >
                  <span style={{ fontSize: 20 }}>{TYPE_META[k].icon}</span>
                  <span>
                    <strong>{labelFor(k)}</strong>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{hintFor(k)}</div>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {kind === 'project' && (
          <GraphQuickProjectForm
            center={center}
            onClose={onClose}
            onCreated={(id) => onCreated?.('project', id)}
            onCancel={() => setKind(null)}
          />
        )}
        {kind === 'event' && (
          <GraphQuickEventForm
            center={center}
            onClose={onClose}
            onCreated={(id) => onCreated?.('event', id)}
            onCancel={() => setKind(null)}
          />
        )}
        {kind === 'action' && (
          <GraphQuickActionForm
            center={center}
            onClose={onClose}
            onCreated={(id) => onCreated?.('action', id)}
            onCancel={() => setKind(null)}
          />
        )}
        {kind === 'note' && (
          <GraphQuickNoteForm
            center={center}
            onClose={onClose}
            onCreated={(id) => onCreated?.('note', id)}
            onCancel={() => setKind(null)}
          />
        )}
        {kind === 'interaction' && (
          <GraphQuickInteractionForm
            center={center}
            onClose={onClose}
            onCreated={(id) => onCreated?.('interaction', id)}
            onCancel={() => setKind(null)}
          />
        )}
      </div>
    </div>
  );
}

function labelFor(k: CreateKind): string {
  return TYPE_META[k].label;
}

function hintFor(k: CreateKind): string {
  switch (k) {
    case 'project': return '长期协作的容器';
    case 'event': return '约见/会议/截止日';
    case 'action': return '下一步要做的';
    case 'note': return '随手记一段';
    case 'interaction': return '一次沟通互动';
  }
}

export function useGraphInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['entity-graph'] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['events'] });
    queryClient.invalidateQueries({ queryKey: ['actions'] });
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    queryClient.invalidateQueries({ queryKey: ['interactions'] });
  };
}
