import { useEffect, useState } from 'react';

export interface ReminderToastItem {
  id: string;
  title: string;
  body?: string;
  trigger_at: string;
}

interface ReminderToastProps {
  reminders: ReminderToastItem[];
  onDismiss: (id: string) => void;
}

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 8000;
const FADE_OUT_MS = 300;

function ReminderToastCard({
  item,
  onDismiss,
}: {
  item: ReminderToastItem;
  onDismiss: (id: string) => void;
}) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setLeaving(true), AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => onDismiss(item.id), FADE_OUT_MS);
    return () => window.clearTimeout(t);
  }, [leaving, item.id, onDismiss]);

  return (
    <div
      className={`reminder-toast${leaving ? ' reminder-toast--leaving' : ''}`}
      role="status"
    >
      <button
        type="button"
        className="reminder-toast__close"
        aria-label="关闭提醒"
        onClick={() => setLeaving(true)}
      >
        ✕
      </button>
      <h4 className="reminder-toast__title">{item.title}</h4>
      {item.body ? <p className="reminder-toast__body">{item.body}</p> : null}
      <div className="reminder-toast__time">
        {new Date(item.trigger_at).toLocaleString('zh-CN')}
      </div>
    </div>
  );
}

export function ReminderToastContainer({ reminders, onDismiss }: ReminderToastProps) {
  const visible = reminders.slice(0, MAX_VISIBLE);
  const hiddenCount = reminders.length - visible.length;
  return (
    <div className="reminder-toast-container">
      {visible.map((item) => (
        <ReminderToastCard key={item.id} item={item} onDismiss={onDismiss} />
      ))}
      {hiddenCount > 0 && <div className="reminder-toast-more">+{hiddenCount} 更多</div>}
    </div>
  );
}
