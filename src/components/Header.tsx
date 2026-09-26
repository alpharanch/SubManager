import { useRef, useState, type ChangeEvent } from 'react';
import {
  ArchiveRestore,
  Cloud,
  CloudAlert,
  CloudCheck,
  CloudOff,
  Download,
  Ellipsis,
  FileJson,
  LogIn,
  LogOut,
  RefreshCw,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import type { Backup } from '../types';
import { DAILY_QUOTA, WRITE_COST } from '../config';
import { channelUrl } from '../lib/api';
import { tokenExpiresAt } from '../lib/auth';
import { downloadFile, parseBackup, subscriptionsCsv } from '../lib/files';
import { formatDate, formatNumber, isoDate, timeAgo } from '../lib/format';
import { useStore } from '../store';
import { Avatar, Dialog, Logo, Popover } from './ui';

type SyncState = 'running' | 'signed-out' | 'no-access' | 'error' | 'ok';

const SYNC_ICONS = { running: RefreshCw, 'signed-out': CloudOff, 'no-access': CloudOff, error: CloudAlert, ok: CloudCheck };

function SyncStatus() {
  const mode = useStore((s) => s.mode);
  const account = useStore((s) => s.account);
  const authed = useStore((s) => s.authed);
  const driveAccess = useStore((s) => s.driveAccess);
  const running = useStore((s) => s.syncRunning);
  const error = useStore((s) => s.syncError);
  const meta = useStore((s) => s.syncMeta);
  const syncNow = useStore((s) => s.syncNow);
  const connectDrive = useStore((s) => s.connectDrive);
  const signIn = useStore((s) => s.signIn);
  const [open, setOpen] = useState(false);

  if (mode !== 'live' || !account) return null;

  const state: SyncState = running ? 'running' : !authed ? 'signed-out' : !driveAccess ? 'no-access' : error ? 'error' : 'ok';
  const label = {
    running: '드라이브와 맞추는 중',
    'signed-out': meta.dirty ? '드라이브에 저장하지 않은 변경이 있어요' : '로그인하면 드라이브와 맞춰요',
    'no-access': '드라이브 연결이 필요해요',
    error: '드라이브 동기화에 실패했어요',
    ok: meta.dirty ? '곧 드라이브에 저장해요' : '드라이브에 저장됨',
  }[state];
  const Icon = SYNC_ICONS[state];

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          type="button"
          className={`icon-btn sync-btn is-${state}${meta.dirty ? ' is-dirty' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-label={label}
          aria-expanded={open}
          title={label}
        >
          <Icon size={18} className={state === 'running' ? 'spin' : undefined} />
        </button>
      }
    >
      <div className="menu-account">
        <strong>{label}</strong>
        <span className="muted">{meta.lastSyncAt ? `마지막 동기화 ${timeAgo(meta.lastSyncAt)}` : '아직 동기화하지 않았어요'}</span>
      </div>
      {state === 'error' && <p className="menu-error">{error}</p>}
      <p className="menu-help">그룹과 구독 취소 기록을 내 구글 드라이브의 앱 전용 공간에 저장해서, 다른 기기에서 로그인해도 같게 보여요.</p>
      <div className="menu-sep" />
      {state === 'signed-out' && (
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            setOpen(false);
            signIn();
          }}
        >
          <LogIn size={16} /> 로그인
        </button>
      )}
      {state === 'no-access' && (
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            setOpen(false);
            connectDrive();
          }}
        >
          <Cloud size={16} /> 드라이브 연결
        </button>
      )}
      {(state === 'ok' || state === 'error') && (
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            setOpen(false);
            syncNow();
          }}
        >
          <RefreshCw size={16} /> 지금 동기화
        </button>
      )}
    </Popover>
  );
}

function QuotaPill() {
  const used = useStore((s) => s.quotaUsed);
  const ratio = Math.min(1, used / DAILY_QUOTA);
  return (
    <div
      className={`quota${ratio > 0.8 ? ' is-high' : ''}`}
      title="오늘 이 브라우저에서 쓴 YouTube API 사용량(추정)이에요. 한국 시간 오후 4~5시에 초기화돼요."
    >
      <span className="quota-label">API</span>
      <span className="quota-bar" aria-hidden="true">
        <span style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="quota-num">
        {formatNumber(used)}
        <span className="quota-max"> / {formatNumber(DAILY_QUOTA)}</span>
      </span>
    </div>
  );
}

function AccountMenu() {
  const account = useStore((s) => s.account);
  const authed = useStore((s) => s.authed);
  const mode = useStore((s) => s.mode);
  const signIn = useStore((s) => s.signIn);
  const signOut = useStore((s) => s.signOut);
  const forgetAccount = useStore((s) => s.forgetAccount);
  const [open, setOpen] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);

  if (!account) return null;
  const expiresAt = mode === 'live' ? tokenExpiresAt() : null;
  const minutesLeft = expiresAt ? Math.max(1, Math.round((expiresAt - Date.now()) / 60_000)) : null;

  return (
    <>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        trigger={
          <button type="button" className="account-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="계정 메뉴">
            <Avatar src={account.thumbnail} name={account.title} size={28} />
            <span className="account-name">{account.title}</span>
            <span className={`status-dot${authed ? ' is-on' : ''}`} aria-hidden="true" />
          </button>
        }
      >
        <div className="menu-account">
          <strong>{account.title}</strong>
          <span className="muted">
            {mode === 'demo' ? '샘플 데이터' : authed ? `로그인됨 · 약 ${minutesLeft}분 뒤 만료` : '로그인이 필요해요'}
          </span>
        </div>
        <div className="menu-sep" />
        {account.channelId && mode === 'live' && (
          <a className="menu-item" href={channelUrl(account.channelId)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <UserRound size={16} /> 내 채널 열기
          </a>
        )}
        {mode === 'live' && !authed && (
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              signIn();
            }}
          >
            <LogIn size={16} /> 다시 로그인
          </button>
        )}
        {mode === 'live' && (
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              signIn('select_account');
            }}
          >
            <UserRound size={16} /> 다른 계정으로 로그인
          </button>
        )}
        {mode === 'live' && authed && (
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
          >
            <LogOut size={16} /> 로그아웃
          </button>
        )}
        <button
          type="button"
          className="menu-item is-danger"
          onClick={() => {
            setOpen(false);
            setConfirmForget(true);
          }}
        >
          <Trash2 size={16} /> 이 브라우저에서 데이터 지우기
        </button>
      </Popover>
      <Dialog
        open={confirmForget}
        onClose={() => setConfirmForget(false)}
        title="이 브라우저에서 데이터를 지울까요?"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirmForget(false)}>
              돌아가기
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setConfirmForget(false);
                forgetAccount();
              }}
            >
              지우기
            </button>
          </>
        }
      >
        <p>불러온 구독 목록, 그룹, 구독 취소 기록을 이 브라우저에서 지우고 로그아웃해요. YouTube 구독은 바뀌지 않아요.</p>
        {mode === 'live' ? (
          <p className="muted">드라이브에 저장된 그룹과 기록은 지워지지 않아서, 다시 로그인하면 돌아와요.</p>
        ) : (
          <p className="muted">샘플 데이터가 처음 상태로 돌아가요.</p>
        )}
      </Dialog>
    </>
  );
}

function UnsubLogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const log = useStore((s) => s.unsubLog);
  const busy = useStore((s) => s.task !== null);
  const resubscribe = useStore((s) => s.resubscribe);
  return (
    <Dialog open={open} onClose={onClose} title="구독 취소 기록">
      {log.length === 0 ? (
        <p className="muted">이 앱에서 구독을 취소한 채널이 여기에 남아요.</p>
      ) : (
        <>
          <p className="muted">다시 구독하면 API {WRITE_COST}을 쓰고, 구독 시작일은 오늘 날짜로 새로 기록돼요.</p>
          <ul className="dialog-list">
            {log.map((entry) => (
              <li key={entry.channelId}>
                <Avatar src={entry.thumbnail} name={entry.title} size={28} />
                <div className="grow">
                  <a href={channelUrl(entry.channelId)} target="_blank" rel="noreferrer" className="link">
                    {entry.title}
                  </a>
                  <div className="muted small">
                    {formatDate(entry.subscribedAt)} 구독 · {formatDate(entry.unsubscribedAt)} 취소
                  </div>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => resubscribe(entry.channelId)} disabled={busy}>
                  다시 구독
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}

function DataMenu() {
  const [open, setOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [pending, setPending] = useState<Backup | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logCount = useStore((s) => s.unsubLog.length);
  const account = useStore((s) => s.account);
  const groupCount = useStore((s) => s.groups.length);
  const exportBackup = useStore((s) => s.exportBackup);
  const importBackup = useStore((s) => s.importBackup);
  const toast = useStore((s) => s.toast);

  const exportCsv = () => {
    const s = useStore.getState();
    downloadFile(`submanager-구독목록-${isoDate()}.csv`, subscriptionsCsv(s.subs, s.stats, s.activity, s.groups), 'text/csv;charset=utf-8');
  };

  const exportJson = () => {
    downloadFile(`submanager-backup-${isoDate()}.json`, JSON.stringify(exportBackup(), null, 2), 'application/json');
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const backup = parseBackup(await file.text());
    if (!backup) toast('SubManager 백업 파일이 아니에요.', 'error');
    else setPending(backup);
  };

  const otherAccount = pending?.account && account && pending.account.channelId !== account.channelId;

  return (
    <>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        trigger={
          <button type="button" className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="데이터 메뉴" aria-expanded={open}>
            <Ellipsis size={18} />
          </button>
        }
      >
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            setOpen(false);
            setLogOpen(true);
          }}
        >
          <ArchiveRestore size={16} /> 구독 취소 기록{logCount > 0 && <span className="menu-badge">{logCount}</span>}
        </button>
        <div className="menu-sep" />
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            setOpen(false);
            exportCsv();
          }}
        >
          <Download size={16} /> 구독 목록 CSV로 내보내기
        </button>
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            setOpen(false);
            exportJson();
          }}
        >
          <FileJson size={16} /> 그룹 백업 파일 내보내기
        </button>
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            setOpen(false);
            fileRef.current?.click();
          }}
        >
          <Upload size={16} /> 그룹 백업 파일 가져오기
        </button>
      </Popover>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
      <UnsubLogDialog open={logOpen} onClose={() => setLogOpen(false)} />
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="백업 파일을 가져올까요?"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setPending(null)}>
              돌아가기
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (pending) importBackup(pending);
                setPending(null);
              }}
            >
              가져오기
            </button>
          </>
        }
      >
        <p>
          지금 그룹 {groupCount}개를 백업 파일의 그룹 {pending?.groups.length ?? 0}개로 바꿔요.
          {pending?.exportedAt && ` (${formatDate(pending.exportedAt)}에 만든 백업)`}
        </p>
        {otherAccount && <p className="is-warn">이 백업은 ‘{pending?.account?.title}’ 계정에서 만들었어요. 지금 계정에 없는 채널은 그룹에 보이지 않아요.</p>}
      </Dialog>
    </>
  );
}

export function Header() {
  const account = useStore((s) => s.account);
  const authed = useStore((s) => s.authed);
  const mode = useStore((s) => s.mode);
  const signIn = useStore((s) => s.signIn);

  return (
    <header className="app-header">
      <div className="brand">
        <Logo />
        <span>SubManager</span>
        {mode === 'demo' && <span className="badge">샘플</span>}
      </div>
      <div className="header-right">
        <QuotaPill />
        <SyncStatus />
        {account && mode === 'live' && !authed && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => signIn()}>
            <LogIn size={15} /> 로그인
          </button>
        )}
        <AccountMenu />
        <DataMenu />
      </div>
    </header>
  );
}
