import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { formatNumber } from '../lib/format';
import { useStore } from '../store';

export function TaskStrip() {
  const task = useStore((s) => s.task);
  if (!task) return null;
  const pct = task.total ? Math.round((task.done / task.total) * 100) : null;
  return (
    <div className="taskstrip" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="taskstrip-label">
        {task.label}
        {task.total > 0 && ` ${formatNumber(task.done)} / ${formatNumber(task.total)}`}
      </span>
      {pct !== null && (
        <span className="progress" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {task.cancel && (
        <button type="button" className="btn btn-sm" onClick={task.cancel}>
          중지
        </button>
      )}
    </div>
  );
}

const ICONS = { info: Info, success: CircleCheck, error: CircleAlert };

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div key={t.id} className={`toast is-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <Icon size={17} aria-hidden="true" />
            <span className="toast-text">{t.text}</span>
            <button type="button" className="icon-btn" onClick={() => dismiss(t.id)} aria-label="알림 닫기">
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
