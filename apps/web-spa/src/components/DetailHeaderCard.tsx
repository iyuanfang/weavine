import type { ReactNode } from 'react';

/**
 * Shared detail-page header card, extracted from ContactDetail:
 * a `.card` with the entity's identity on the left (icon/avatar, title,
 * badges, optional meta row) and all actions on the right.
 *
 * Every entity detail page renders this above the GraphTab so the
 * 详情 / 🕸️ 关系图 tabs always sit under an identical header.
 */
export function DetailHeaderCard({
  icon,
  title,
  badges,
  meta,
  actions,
}: {
  /** Left slot: avatar or icon badge. */
  icon?: ReactNode;
  /** Entity name — rendered as the page title. */
  title: ReactNode;
  /** Status/importance badges shown next to the title. */
  badges?: ReactNode;
  /** Secondary info line under the title (dates, tags, …). */
  meta?: ReactNode;
  /** Action buttons (back / edit / delete / quick actions). */
  actions?: ReactNode;
}) {
  return (
    <div
      className="card detail-header-card"
      style={{
        padding: '12px 16px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
        rowGap: 12,
      }}
    >
      <div className="detail-header-card__identity">
        {icon}
        <div className="detail-header-card__info" style={{ flex: 1, minWidth: 0 }}>
          <div className="cluster cluster--loose">
            <h1 className="page-title" style={{ margin: 0 }}>
              {title}
            </h1>
            {badges}
          </div>
          {meta && <div style={{ marginTop: 8 }}>{meta}</div>}
        </div>
      </div>
      {actions && (
        <div
          className="detail-header-card__actions"
          style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', rowGap: 8 }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * 56px circular icon for entities that have no avatar image, matching the
 * contact avatar slot in the header card.
 */
export function EntityIconBadge({
  children,
  background,
  color,
}: {
  children: ReactNode;
  background?: string;
  color?: string;
}) {
  return (
    <div
      className="avatar"
      style={{
        width: 56,
        height: 56,
        fontSize: 24,
        background: background ?? 'var(--accent-soft, #eff6ff)',
        color: color ?? 'var(--accent, #6366f1)',
      }}
    >
      {children}
    </div>
  );
}
