import { useState, type ReactNode } from 'react';

// List pages render their filters through this shell. Desktop (≥640px)
// shows the classic sticky left sidebar. Mobile collapses everything into
// one bar — search inline, filter groups tucked into a bottom-sheet
// drawer — so filters stop eating the vertical space the list needs.
export function FilterPanelShell({
  search,
  children,
  activeCount = 0,
}: {
  /** The search section — stays visible on mobile, above the list. */
  search?: ReactNode;
  /** The filter sections (状态 / 标签 / …). Desktop sidebar + mobile drawer. */
  children: ReactNode;
  /** Number of active non-search filters, shown on the mobile toggle. */
  activeCount?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="filter-panel">
        {search}
        {search && <div className="filter-panel__divider" />}
        {children}
      </aside>
      <div className="filter-bar-mobile" data-testid="filter-bar-mobile">
        <div className="filter-bar-mobile__search">{search}</div>
        <button
          type="button"
          className="filter-bar-mobile__toggle"
          data-testid="filter-bar-toggle"
          onClick={() => setOpen(true)}
        >
          ☰ 筛选{activeCount > 0 ? ` ·${activeCount}` : ''}
        </button>
      </div>
      {open && (
        <div className="filter-drawer" data-testid="filter-drawer" onClick={() => setOpen(false)}>
          <div className="filter-drawer__sheet" onClick={(e) => e.stopPropagation()}>
            <div className="filter-drawer__handle" />
            <aside className="filter-panel">
              {search}
              {search && <div className="filter-panel__divider" />}
              {children}
            </aside>
            <button
              type="button"
              className="btn btn-primary filter-drawer__done"
              onClick={() => setOpen(false)}
            >
              显示结果
            </button>
          </div>
        </div>
      )}
    </>
  );
}
