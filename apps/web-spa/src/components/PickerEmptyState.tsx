import { Link } from 'react-router-dom';

type Kind = 'project' | 'contact';

const COPY: Record<Kind, string> = {
  project: '还没有项目，先建一个吧',
  contact: '还没有联系人，先加一个吧',
};

const CREATE_HREF: Record<Kind, string> = {
  project: '/projects/new',
  contact: '/contacts/new',
};

const CREATE_LABEL: Record<Kind, string> = {
  project: '新建项目',
  contact: '新建联系人',
};

export function PickerEmptyState({ kind }: { kind: Kind }) {
  return (
    <div
      data-testid={`picker-empty-${kind}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}
    >
      <span style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>{COPY[kind]}</span>
      <Link
        to={CREATE_HREF[kind]}
        data-testid={`picker-empty-${kind}-create`}
        className="btn btn-secondary"
        style={{ padding: '4px 12px', fontSize: 'var(--text-sm)' }}
      >
        {CREATE_LABEL[kind]}
      </Link>
    </div>
  );
}
