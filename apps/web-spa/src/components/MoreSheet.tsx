import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface SheetItem {
  to: string;
  label: string;
  icon: string;
}

const items: SheetItem[] = [
  { to: '/projects', label: '项目', icon: '📁' },
  { to: '/notes', label: '笔记', icon: '📝' },
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleItemClick = (item: SheetItem) => {
    onClose();
    navigate(item.to);
  };

  return (
    <>
      <div className="more-sheet__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="more-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="更多"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="more-sheet__handle" aria-hidden="true" />
        <header className="more-sheet__header">
          <span className="more-sheet__title">更多</span>
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
          {items.map((item) => (
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
                <span className="more-sheet__item-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="more-sheet__safe-area" aria-hidden="true" />
      </div>
    </>
  );
}