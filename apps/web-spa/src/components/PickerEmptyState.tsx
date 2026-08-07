import { Link } from 'react-router-dom';

type Kind = 'project' | 'contact';

interface Props {
  kind: Kind;
}

const COPY: Record<Kind, { text: string; linkText: string; href: string }> = {
  project: {
    text: '还没有项目，先建一个吧',
    linkText: '新建项目',
    href: '/projects/new',
  },
  contact: {
    text: '还没有联系人，先加一个吧',
    linkText: '新建联系人',
    href: '/contacts/new',
  },
};

export function PickerEmptyState({ kind }: Props) {
  const c = COPY[kind];
  return (
    <div
      data-testid={`picker-empty-${kind}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}
    >
      <span style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>{c.text}</span>
      <Link
        to={c.href}
        data-testid={`picker-empty-${kind}-create`}
        className="btn btn-secondary btn-sm"
        style={{ pointerEvents: 'auto' }}
      >
        {c.linkText}
      </Link>
    </div>
  );
}