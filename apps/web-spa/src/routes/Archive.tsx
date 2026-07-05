import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { ArchivedItem } from '../lib/adapter/types';

const ENTITY_LABEL: Record<'action' | 'event' | 'project', string> = {
  action: '待办',
  event: '日程',
  project: '项目',
};

const ENTITY_PATH: Record<'action' | 'event' | 'project', (id: string) => string> = {
  action: (id) => `/actions/${id}?from=/archive`,
  event: (id) => `/events/${id}?from=/archive`,
  project: (id) => `/projects/${id}?from=/archive`,
};

function formatArchived(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ArchivePage() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const queryClient = useQueryClient();

  const summaryQuery = useQuery({
    queryKey: ['archive', 'summary', ownerId],
    queryFn: () => adapter.archive.summary(ownerId!),
    enabled: !!ownerId,
    refetchOnMount: 'always',
  });

  const actionListQuery = useQuery({
    queryKey: ['archive', 'list', ownerId, 'action'],
    queryFn: () => adapter.archive.list(ownerId!, 'action'),
    enabled: !!ownerId,
    refetchOnMount: 'always',
  });

  const eventListQuery = useQuery({
    queryKey: ['archive', 'list', ownerId, 'event'],
    queryFn: () => adapter.archive.list(ownerId!, 'event'),
    enabled: !!ownerId,
    refetchOnMount: 'always',
  });

  const projectListQuery = useQuery({
    queryKey: ['archive', 'list', ownerId, 'project'],
    queryFn: () => adapter.archive.list(ownerId!, 'project'),
    enabled: !!ownerId,
    refetchOnMount: 'always',
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['archive'] });
    queryClient.invalidateQueries({ queryKey: ['actions'] });
    queryClient.invalidateQueries({ queryKey: ['events'] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['project-actions'] });
    queryClient.invalidateQueries({ queryKey: ['project-events'] });
    queryClient.invalidateQueries({ queryKey: ['today'] });
  };

  const unarchiveOne = useMutation({
    mutationFn: async ({ entity, id }: { entity: 'action' | 'event' | 'project'; id: string }) =>
      adapter.archive.unarchiveOne(ownerId!, entity, id),
    onSuccess: invalidateAll,
  });

  const bulkUnarchive = useMutation({
    mutationFn: async (entity: 'action' | 'event' | 'project') =>
      adapter.archive.bulkUnarchive(ownerId!, entity),
    onSuccess: invalidateAll,
  });

  const sections: {
    entity: 'action' | 'event' | 'project';
    items: ArchivedItem[] | undefined;
    isLoading: boolean;
  }[] = [
    { entity: 'action', items: actionListQuery.data, isLoading: actionListQuery.isLoading },
    { entity: 'event', items: eventListQuery.data, isLoading: eventListQuery.isLoading },
    { entity: 'project', items: projectListQuery.data, isLoading: projectListQuery.isLoading },
  ];

  const totals = useMemo(() => {
    return {
      total: sections.reduce((acc, s) => acc + (s.items?.length ?? 0), 0),
      total30d:
        (summaryQuery.data?.action_30d ?? 0) +
        (summaryQuery.data?.event_30d ?? 0) +
        (summaryQuery.data?.project_30d ?? 0),
    };
  }, [sections, summaryQuery.data]);

  if (!ownerId) return <div className="loading">正在加载用户…</div>;

  return (
    <div className="page">
      <PageHeader
        title="📦 已归档"
        subtitle={
          summaryQuery.data
            ? `共 ${totals.total} 项 · 最近 30 天新增 ${totals.total30d} 项`
            : '加载中…'
        }
      />

      {totals.total === 0 ? (
        <div className="empty-state">
          <h3 className="empty-state__title">还没有归档内容</h3>
          <p className="empty-state__hint">
            已完成超过 1 天的待办、已结束的日程、已收尾超过 7 天的项目会自动归档到这里。
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 24 }}>
          {sections.map((s) => (
            <ArchiveSection
              key={s.entity}
              entity={s.entity}
              items={s.items}
              isLoading={s.isLoading}
              onUnarchiveOne={(id) => unarchiveOne.mutate({ entity: s.entity, id })}
              onBulkUnarchive={() => bulkUnarchive.mutate(s.entity)}
              isMutating={unarchiveOne.isPending || bulkUnarchive.isPending}
            />
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 24, padding: 16, fontSize: 'var(--text-base)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong>归档规则</strong>
        <ul style={{ margin: '8px 0 0 0', paddingLeft: 18 }}>
          <li>待办：状态"已完成"且完成超过 1 天</li>
          <li>日程：已结束（按结束时间）</li>
          <li>项目：进入终止阶段（如"已完成 / 中标 / 丢单 / 已收尾"）且超过 7 天</li>
        </ul>
        <p style={{ margin: '8px 0 0 0' }}>
          取消归档后，条目会回到原列表中（状态/阶段保留，需要时可再次手动调整）。
        </p>
      </div>
    </div>
  );
}

interface ArchiveSectionProps {
  entity: 'action' | 'event' | 'project';
  items: ArchivedItem[] | undefined;
  isLoading: boolean;
  onUnarchiveOne: (id: string) => void;
  onBulkUnarchive: () => void;
  isMutating: boolean;
}

function ArchiveSection({
  entity,
  items,
  isLoading,
  onUnarchiveOne,
  onBulkUnarchive,
  isMutating,
}: ArchiveSectionProps) {
  const list = items ?? [];
  return (
    <section>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 0 12px',
          borderBottom: '1px solid var(--border, #e5e7eb)',
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>
          {ENTITY_LABEL[entity]} <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>· {list.length}</span>
        </h3>
        {list.length > 0 && (
          <button
            type="button"
            onClick={onBulkUnarchive}
            disabled={isMutating}
            className="btn btn-secondary"
            style={{ fontSize: 'var(--text-sm)', padding: '4px 10px' }}
          >
            全部取消归档
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="loading">加载中…</div>
      ) : list.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-base)', padding: '12px 4px' }}>
          没有已归档的 {ENTITY_LABEL[entity]}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {list.map((it) => (
            <div
              key={`${entity}-${it.id}`}
              className="card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                opacity: 0.7,
              }}
            >
              <Link
                to={ENTITY_PATH[entity](it.id)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: 'inherit',
                  textDecoration: 'none',
                }}
              >
                <div
                  style={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  📦 {it.title}
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
                  归档于 {formatArchived(it.archived_at)}
                </div>
              </Link>
              <button
                type="button"
                onClick={() => onUnarchiveOne(it.id)}
                disabled={isMutating}
                className="btn btn-secondary"
                style={{ fontSize: 'var(--text-sm)', padding: '4px 10px', marginLeft: 12, flexShrink: 0 }}
              >
                取消归档
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
