import { stageColor } from '../lib/projectStageColor';

export interface ProjectBadgeProject {
  id: string;
  title: string;
  template: string;
  stage: string;
}

interface ProjectBadgeProps {
  project: ProjectBadgeProject | null | undefined;
}

export function ProjectBadge({ project }: ProjectBadgeProps) {
  if (!project) return null;

  const color = stageColor(project.template, project.stage);

  return (
    <span
      className="pill pill--colored"
      style={{
        '--pill-bg': `${color}14`,
        '--pill-border': `${color}30`,
        '--pill-fg': color,
        fontWeight: 500,
        textDecoration: 'none',
        maxWidth: 160,
        minWidth: 0,
        flexShrink: 1,
        cursor: 'default',
      } as React.CSSProperties}
    >
      <span
        aria-hidden
        className="dot dot--xs"
        style={{ background: color }}
      />
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
        {project.title}
      </span>
    </span>
  );
}