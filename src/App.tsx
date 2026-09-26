import { useEffect } from 'react';
import { GOOGLE_CLIENT_ID } from './config';
import { ChannelsView } from './components/ChannelsView';
import { TaskStrip, Toasts } from './components/Feedback';
import { FeedView } from './components/FeedView';
import { GroupHeader, GroupNav } from './components/GroupNav';
import { Header } from './components/Header';
import { LoginScreen, SetupScreen, Splash } from './components/Screens';
import { useStore } from './store';

function DemoBanner() {
  return (
    <div className="demo-banner">
      샘플 데이터로 둘러보는 중이에요. 실제 YouTube 계정과는 연결되지 않아요.
      <a href="./" className="link">
        나가기
      </a>
    </div>
  );
}

function Main() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const mode = useStore((s) => s.mode);
  return (
    <div className="app">
      <Header />
      {mode === 'demo' && <DemoBanner />}
      <TaskStrip />
      <div className="layout">
        <aside className="sidebar">
          <GroupNav />
        </aside>
        <main className="content">
          <GroupHeader />
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={view === 'channels'} onClick={() => setView('channels')}>
              채널
            </button>
            <button type="button" role="tab" aria-selected={view === 'feed'} onClick={() => setView('feed')}>
              새 영상
            </button>
          </div>
          {view === 'channels' ? <ChannelsView /> : <FeedView />}
        </main>
      </div>
    </div>
  );
}

function Screen() {
  const ready = useStore((s) => s.ready);
  const mode = useStore((s) => s.mode);
  const account = useStore((s) => s.account);
  if (!ready) return <Splash />;
  if (mode === 'live' && !GOOGLE_CLIENT_ID) return <SetupScreen />;
  if (!account) return mode === 'demo' ? <Splash /> : <LoginScreen />;
  return <Main />;
}

export default function App() {
  const checkAuth = useStore((s) => s.checkAuth);

  // The access token expires after about an hour; keep the login indicator honest.
  useEffect(() => {
    const timer = setInterval(checkAuth, 30_000);
    return () => clearInterval(timer);
  }, [checkAuth]);

  return (
    <>
      <Screen />
      <Toasts />
    </>
  );
}
