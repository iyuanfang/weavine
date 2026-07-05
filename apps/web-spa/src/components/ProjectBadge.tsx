import { Link } from 'react-router-dom';

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
    <Link
      to={`/projects/${project.id}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
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
      } as React.CSSProperties}
    >
      <span
        aria-hidden
        className="dot dot--xs"
        style={{ background: color }}
      />
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
    </Link>
  );
}
