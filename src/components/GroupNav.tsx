import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Inbox, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { formatNumber } from '../lib/format';
import { channelIdsFor, groupLabel } from '../selectors';
import { ALL, UNGROUPED, useStore } from '../store';
import { Dialog, Dot } from './ui';

function NavItem({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`nav-item${active ? ' is-active' : ''}`} onClick={onClick} aria-current={active ? 'true' : undefined}>
      {icon}
      <span className="nav-label">{label}</span>
      <span className="nav-count">{formatNumber(count)}</span>
    </button>
  );
}

export function GroupNav() {
  const subs = useStore((s) => s.subs);
  const groups = useStore((s) => s.groups);
  const groupKey = useStore((s) => s.groupKey);
  const setGroupKey = useStore((s) => s.setGroupKey);
  const createGroup = useStore((s) => s.createGroup);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const counts = useMemo(() => {
    const subscribed = new Set(subs.map((s) => s.channelId));
    const byGroup: Record<string, number> = {};
    for (const g of groups) byGroup[g.id] = g.channelIds.filter((id) => subscribed.has(id)).length;
    return { all: subs.length, ungrouped: channelIdsFor(UNGROUPED, subs, groups).length, byGroup };
  }, [subs, groups]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = createGroup(name);
    if (id) setGroupKey(id);
    setName('');
    setAdding(false);
  };

  return (
    <nav className="groupnav" aria-label="그룹">
      <NavItem active={groupKey === ALL} icon={<Layers size={16} />} label="전체" count={counts.all} onClick={() => setGroupKey(ALL)} />
      <NavItem
        active={groupKey === UNGROUPED}
        icon={<Inbox size={16} />}
        label="그룹 없음"
        count={counts.ungrouped}
        onClick={() => setGroupKey(UNGROUPED)}
      />
      <div className="groupnav-title">그룹</div>
      {groups.map((g) => (
        <NavItem
          key={g.id}
          active={groupKey === g.id}
          icon={<Dot color={g.color} />}
          label={g.name}
          count={counts.byGroup[g.id] ?? 0}
          onClick={() => setGroupKey(g.id)}
        />
      ))}
      {adding ? (
        <form className="groupnav-new" onSubmit={submit}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (!name.trim()) setAdding(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="그룹 이름"
            maxLength={40}
            aria-label="새 그룹 이름"
          />
        </form>
      ) : (
        <button type="button" className="nav-item nav-add" onClick={() => setAdding(true)}>
          <Plus size={16} />
          <span className="nav-label">새 그룹</span>
        </button>
      )}
    </nav>
  );
}

/** Title of the selected group, with rename and delete for real groups. */
export function GroupHeader() {
  const groups = useStore((s) => s.groups);
  const groupKey = useStore((s) => s.groupKey);
  const renameGroup = useStore((s) => s.renameGroup);
  const deleteGroup = useStore((s) => s.deleteGroup);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);

  const group = groups.find((g) => g.id === groupKey);
  const title = groupLabel(groupKey, groups);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (group) renameGroup(group.id, draft);
    setEditing(false);
  };

  return (
    <div className="group-head">
      {group && <Dot color={group.color} />}
      {editing && group ? (
        <form onSubmit={save} className="group-rename">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
            }}
            maxLength={40}
            aria-label="그룹 이름"
          />
        </form>
      ) : (
        <h1>{title}</h1>
      )}
      {group && !editing && (
        <div className="group-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setDraft(group.name);
              setEditing(true);
            }}
            aria-label="그룹 이름 바꾸기"
            title="이름 바꾸기"
          >
            <Pencil size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setConfirming(true)} aria-label="그룹 삭제" title="그룹 삭제">
            <Trash2 size={16} />
          </button>
        </div>
      )}
      <Dialog
        open={confirming && !!group}
        onClose={() => setConfirming(false)}
        title={`'${group?.name ?? ''}' 그룹을 지울까요?`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              돌아가기
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                if (group) deleteGroup(group.id);
                setConfirming(false);
              }}
            >
              그룹 지우기
            </button>
          </>
        }
      >
        <p>그룹만 지워지고 채널 구독은 그대로 남아요.</p>
      </Dialog>
    </div>
  );
}
