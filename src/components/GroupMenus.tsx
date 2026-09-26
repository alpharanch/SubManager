import { useState, type FormEvent } from 'react';
import { FolderPlus, Plus } from 'lucide-react';
import { useStore } from '../store';
import { Dot, Popover } from './ui';

function NewGroupInput({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name);
    setName('');
  };
  return (
    <form className="menu-new" onSubmit={submit}>
      <Plus size={14} aria-hidden="true" />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="새 그룹 이름 입력 후 Enter" maxLength={40} />
    </form>
  );
}

/** Checkbox list of groups for one channel. */
function ChannelGroupMenu({ channelId }: { channelId: string }) {
  const groups = useStore((s) => s.groups);
  const toggleInGroup = useStore((s) => s.toggleInGroup);
  const createGroup = useStore((s) => s.createGroup);
  return (
    <>
      <div className="menu-label">그룹 지정</div>
      {groups.length === 0 && <p className="menu-empty">아직 그룹이 없어요. 아래에서 만들어 보세요.</p>}
      {groups.map((g) => (
        <label key={g.id} className="menu-item menu-check">
          <input type="checkbox" checked={g.channelIds.includes(channelId)} onChange={() => toggleInGroup(g.id, channelId)} />
          <Dot color={g.color} />
          <span className="menu-text">{g.name}</span>
        </label>
      ))}
      <div className="menu-sep" />
      <NewGroupInput onCreate={(name) => createGroup(name, [channelId])} />
    </>
  );
}

export function ChannelGroupPicker({ channelId, title }: { channelId: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          type="button"
          className="icon-btn"
          onClick={() => setOpen((o) => !o)}
          aria-label={`${title} 그룹 지정`}
          aria-expanded={open}
          title="그룹 지정"
        >
          <FolderPlus size={17} />
        </button>
      }
    >
      <ChannelGroupMenu channelId={channelId} />
    </Popover>
  );
}

/** Adds many channels to one group at once. */
export function BulkGroupMenu({ channelIds, onDone }: { channelIds: string[]; onDone: () => void }) {
  const groups = useStore((s) => s.groups);
  const addToGroup = useStore((s) => s.addToGroup);
  const createGroup = useStore((s) => s.createGroup);
  const toast = useStore((s) => s.toast);

  const add = (id: string, name: string) => {
    addToGroup(id, channelIds);
    toast(`채널 ${channelIds.length}개를 '${name}' 그룹에 넣었어요.`, 'success');
    onDone();
  };

  return (
    <>
      <div className="menu-label">채널 {channelIds.length}개를 넣을 그룹</div>
      {groups.length === 0 && <p className="menu-empty">아직 그룹이 없어요. 아래에서 만들어 보세요.</p>}
      {groups.map((g) => (
        <button key={g.id} type="button" className="menu-item" onClick={() => add(g.id, g.name)}>
          <Dot color={g.color} />
          <span className="menu-text">{g.name}</span>
        </button>
      ))}
      <div className="menu-sep" />
      <NewGroupInput
        onCreate={(name) => {
          if (createGroup(name, channelIds)) {
            toast(`'${name.trim()}' 그룹에 채널 ${channelIds.length}개를 넣었어요.`, 'success');
            onDone();
          }
        }}
      />
    </>
  );
}
