import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface SheetItem {
  to?: string;
  label: string;
  icon: string;
  children?: SheetItem[];
}

const items: SheetItem[] = [
  { to: '/projects', label: '项目', icon: '📁' },
  {
    label: '笔记',
    icon: '📝',
    children: [
      { to: '/notes', label: '笔记列表', icon: '📄' },
      { to: '/notes/new', label: '新建笔记', icon: '✍️' },
    ],
  },
  { to: '/tags', label: '标签', icon: '🏷️' },
  { to: '/archive', label: '归档', icon: '📦' },
  { to: '/settings', label: '设置', icon: '⚙️' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function MoreSheet({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [stack, setStack] = useState<SheetItem[]>([]);

  useEffect(() => {
    if (!open) {
      setStack([]);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (stack.length > 0) setStack((s) => s.slice(0, -1));
        else onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, stack.length]);

  if (!open) return null;

  const currentItems = stack.length > 0 ? stack[stack.length - 1].children ?? [] : items;
  const parent = stack.length > 0 ? stack[stack.length - 1] : null;

  const handleItemClick = (item: SheetItem) => {
    if (item.children && item.children.length > 0) {
      setStack((s) => [...s, item]);
    } else if (item.to) {
      onClose();
      navigate(item.to);
    }
  };

  return (
    <>
      <div className="more-sheet__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="more-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={parent ? parent.label : '更多'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="more-sheet__handle" aria-hidden="true" />
        <header className="more-sheet__header">
          {stack.length > 0 && (
            <button
              type="button"
              className="more-sheet__back"
              onClick={() => setStack((s) => s.slice(0, -1))}
              aria-label="返回上一层"
            >
              ‹
            </button>
          )}
          <span className="more-sheet__title">{parent ? parent.label : '更多'}</span>
          <button
            type="button"
            className="more-sheet__close"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </header>
        <ul className="more-sheet__list">
          {currentItems.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                className="more-sheet__item"
                onClick={() => handleItemClick(item)}
              >
                <span className="more-sheet__item-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="more-sheet__item-label">{item.label}</span>
                {item.children && item.children.length > 0 ? (
                  <span className="more-sheet__item-chevron" aria-hidden="true">
                    ›
                  </span>
                ) : (
                  <span className="more-sheet__item-chevron" aria-hidden="true">
                    ›
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="more-sheet__safe-area" aria-hidden="true" />
      </div>
    </>
  );
}