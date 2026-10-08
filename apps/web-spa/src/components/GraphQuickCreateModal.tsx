import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { GraphQuickProjectForm } from './GraphQuickProjectForm';
import { GraphQuickEventForm } from './GraphQuickEventForm';
import { GraphQuickActionForm } from './GraphQuickActionForm';
import { GraphQuickNoteForm } from './GraphQuickNoteForm';
import { GraphQuickInteractionForm } from './GraphQuickInteractionForm';
import { ContactPickOrCreateModal } from './ContactPickOrCreateModal';
import { TYPE_META } from './EntityGraph';
import { useAdapter } from '../lib/adapter';
import type { EntityGraphNodeType } from '../lib/adapter/types';

export type CreateKind = 'contact' | 'project' | 'event' | 'action' | 'note' | 'interaction';

export interface GraphCenter {
  type: EntityGraphNodeType;
  id: string;
}

/** Default set of kinds callers pass when they want every possible option. */
export const ALL_CREATABLE_KINDS: CreateKind[] = [
  'contact',
  'project',
  'event',
  'action',
  'note',
  'interaction',
];

/** Single source of truth used by both the modal body and the GraphTab
 *  create button to decide whether a center has any valid create options. */
export function creatableForCenter(
  centerType: EntityGraphNodeType,
  requested: readonly CreateKind[] = ALL_CREATABLE_KINDS,
): CreateKind[] {
  const allowed = CREATABLE_BY_CENTER[centerType];
  if (!allowed) return [];
  return requested.filter((k) => allowed.has(k));
}

// For each center type, which new entity kinds produce a meaningful link back
// to the center. The new entity must expose a foreign-key column or a
// many-to-many table that references the center — otherwise the new node
// would float with no edge in the graph (worse than not creating it).
// 'contact' means "link an existing or freshly created contact" — the link
// semantics differ per center (event participant / action assignee /
// project member) and live in linkContactToCenter below.
const CREATABLE_BY_CENTER: Record<EntityGraphNodeType, ReadonlySet<CreateKind>> = {
  contact: new Set<CreateKind>(['project', 'event', 'action', 'note', 'interaction']),
  project: new Set<CreateKind>(['contact', 'event', 'action', 'note', 'interaction']),
  // Events/actions auto-log interactions (auto_log on the server), so
  // creating one by hand here would duplicate what the system already does.
  event: new Set<CreateKind>(['contact', 'note']),
  action: new Set<CreateKind>(['contact', 'note']),
  interaction: new Set<CreateKind>(['contact', 'note']),
  note: new Set<CreateKind>(),
};

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
  const options = creatableForCenter(center.type, creatable);
  if (options.length === 0) return null;

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
            {kind === 'contact'
              ? `关联到${TYPE_META[center.type].label}`
              : kind
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

        {kind === 'contact' && (
          <GraphQuickContactLink
            center={center}
            onClose={onClose}
            onLinked={(id) => onCreated?.('contact', id)}
            onCancel={() => setKind(null)}
          />
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
    case 'contact': return '选已有或当场新建';
    case 'project': return '长期协作的容器';
    case 'event': return '约见/会议/截止日';
    case 'action': return '下一步要做的';
    case 'note': return '随手记一段';
    case 'interaction': return '一次沟通互动';
  }
}

// Link semantics differ per center: event participants are multi-select
// (merged in one update); action/interaction have a single contact FK and
// project membership is created per contact. The picker is shared; the write
// path is not — each branch hits the relation its center actually has.
function GraphQuickContactLink({
  center,
  onClose,
  onLinked,
  onCancel,
}: {
  center: GraphCenter;
  onClose: () => void;
  onLinked: (contactId: string) => void;
  onCancel: () => void;
}) {
  const adapter = useAdapter();
  const invalidate = useGraphInvalidation();
  const multiple = center.type === 'event';

  const linkOne = async (contactId: string) => {
    if (center.type === 'project') {
      await adapter.projectContacts.add(center.id, contactId, null);
    } else if (center.type === 'event') {
      const ev = await adapter.events.get(center.id);
      const existing = (ev?.participants ?? []).map((p) => p.contact_id);
      const merged = existing.includes(contactId) ? existing : [...existing, contactId];
      await adapter.events.update({
        id: center.id,
        participant_contact_ids: merged.length > 0 ? merged : null,
        contact_id: merged[0] ?? ev?.contact_id ?? null,
      });
    } else if (center.type === 'action') {
      await adapter.actions.update({ id: center.id, contact_id: contactId });
    } else if (center.type === 'interaction') {
      // 互动必须有联系人 — 给悬空互动补上对象。
      await adapter.interactions.update({ id: center.id, contact_id: contactId });
    } else {
      throw new Error(`联系人无法直接关联到${TYPE_META[center.type].label}`);
    }
  };

  const link = async (contactIds: string[]) => {
    try {
      for (const contactId of contactIds) {
        await linkOne(contactId);
        onLinked(contactId);
      }
      invalidate();
      onClose();
    } catch (e) {
      alert(`关联联系人失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <ContactPickOrCreateModal
      title={`关联到${TYPE_META[center.type].label}`}
      multiple={multiple}
      confirmLabel={multiple ? '全部添加' : '关联'}
      onConfirm={(ids) => {
        if (ids.length > 0) void link(ids);
      }}
      onClose={onCancel}
    />
  );
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
