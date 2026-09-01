type Kind = 'project' | 'contact';

const COPY: Record<Kind, string> = {
  project: '还没有项目，先建一个吧',
  contact: '还没有联系人，先加一个吧',
};

export function PickerEmptyState({ kind }: { kind: Kind }) {
  return (
    <div
      data-testid={`picker-empty-${kind}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}
    >
      <span style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>{COPY[kind]}</span>
    </div>
  );
}
