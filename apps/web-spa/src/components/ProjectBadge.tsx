export interface ProjectBadgeProject {
  id?: string;
  title: string;
  template?: string;
  stage?: string;
}

type ProjectBadgeInput = string | ProjectBadgeProject | null | undefined;

interface ProjectBadgeProps {
  project: ProjectBadgeInput;
  compact?: boolean;
}

export function ProjectBadge({ project, compact = false }: ProjectBadgeProps) {
  if (!project) return null;

  const title =
    typeof project === 'string' ? project.trim() : project.title.trim();
  if (!title) return null;

  return (
    <span
      className="pill pill--colored"
      style={{
        '--pill-bg': compact ? 'transparent' : undefined,
        '--pill-border': 'transparent',
        '--pill-fg': compact ? 'var(--muted)' : 'inherit',
        background: compact ? 'transparent' : undefined,
        borderColor: 'transparent',
        padding: compact ? '1px 6px' : undefined,
        fontSize: compact ? 'var(--text-xs)' : undefined,
        fontWeight: 500,
        textDecoration: 'none',
        maxWidth: 160,
        minWidth: 0,
        flexShrink: 1,
        cursor: 'default',
      } as React.CSSProperties}
    >
      <span aria-hidden style={{ flexShrink: 0, fontSize: '0.85em' }}>
        📁
      </span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {title}
      </span>
    </span>
  );
}