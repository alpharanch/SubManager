import { useState } from 'react';
import { Check, Copy, FolderPlus, LayoutList, LogIn, UserMinus } from 'lucide-react';
import { useStore } from '../store';
import { Logo } from './ui';

export function Splash() {
  return (
    <div className="splash" aria-busy="true">
      <Logo size={36} />
    </div>
  );
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-row">
      <code className="code">{value}</code>
      <button
        type="button"
        className="icon-btn"
        onClick={() =>
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
        aria-label="복사"
        title="복사"
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </span>
  );
}

export function SetupScreen() {
  const origin = window.location.origin;
  const isLocal = /^http:\/\/localhost(:\d+)?$/.test(origin);
  return (
    <div className="screen">
      <div className="screen-card">
        <div className="screen-brand">
          <Logo size={32} />
          <span>SubManager</span>
        </div>
        <h1 className="screen-title">Google Cloud 설정이 필요해요</h1>
        <p className="screen-lead">
          YouTube 공식 API로 구독 목록을 불러오려면, 처음 한 번 Google Cloud에서 OAuth 클라이언트 ID를 만들어야 해요.
        </p>
        <ol className="steps">
          <li>
            <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
              Google Cloud 콘솔
            </a>
            에서 새 프로젝트를 만들어요.
          </li>
          <li>
            <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">
              YouTube Data API v3
            </a>
            와{' '}
            <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">
              Google Drive API
            </a>
            를 사용 설정해요.
          </li>
          <li>
            Google 인증 플랫폼(Google Auth Platform)에서 시작하기를 누르고 앱 이름과 이메일을 넣어요. 대상은 ‘외부’를 골라요.
          </li>
          <li>대상(Audience)의 테스트 사용자에 YouTube에 로그인하는 구글 계정 이메일을 추가해요.</li>
          <li>
            클라이언트(Clients)에서 ‘웹 애플리케이션’ 클라이언트를 만들고, 승인된 JavaScript 원본에 이 주소를 넣어요.
            <CopyValue value={origin} />
            {!isLocal && (
              <span className="muted small">
                내 PC에서 개발할 때 쓰려면 <code className="code">http://localhost:5173</code>도 함께 넣어 주세요.
              </span>
            )}
          </li>
          <li>
            만든 클라이언트 ID를 프로젝트의 <code className="code">.env</code> 파일에 있는{' '}
            <code className="code">VITE_GOOGLE_CLIENT_ID</code>에 넣고 다시 배포하면 로그인 화면이 나와요.
          </li>
        </ol>
        <div className="screen-actions">
          <a className="btn" href="?demo">
            샘플 데이터로 먼저 둘러보기
          </a>
        </div>
      </div>
    </div>
  );
}

export function LoginScreen() {
  const signIn = useStore((s) => s.signIn);
  const initError = useStore((s) => s.initError);
  return (
    <div className="screen">
      <div className="screen-card">
        <div className="screen-brand">
          <Logo size={32} />
          <span>SubManager</span>
        </div>
        <h1 className="screen-title">YouTube 구독 채널을 정리해 보세요</h1>
        <ul className="feature-list">
          <li>
            <FolderPlus size={18} aria-hidden="true" /> 구독 채널을 그룹으로 나눠요
          </li>
          <li>
            <LayoutList size={18} aria-hidden="true" /> 그룹별로 새 영상만 모아 봐요
          </li>
          <li>
            <UserMinus size={18} aria-hidden="true" /> 오래 활동이 없는 채널을 찾아 구독을 취소해요
          </li>
        </ul>
        {initError && <p className="is-warn">{initError}</p>}
        <div className="screen-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => signIn()} disabled={!!initError}>
            <LogIn size={18} /> Google 계정으로 로그인
          </button>
          <a className="btn btn-lg" href="?demo">
            샘플 데이터로 둘러보기
          </a>
        </div>
        <ul className="notes">
          <li>그룹과 구독 취소 기록은 내 구글 드라이브의 앱 전용 공간에 저장돼서 다른 기기에서도 같게 보여요. 다른 서버로는 보내지 않아요.</li>
          <li>‘Google에서 확인하지 않은 앱’ 화면이 나오면 계속을 눌러 주세요. 직접 만든 앱이라 나오는 화면이에요.</li>
          <li>권한 요청 화면에서 YouTube와 드라이브 항목에 모두 체크해 주세요.</li>
          <li>브랜드 계정 채널을 쓴다면 계정 선택 화면에서 그 채널을 골라 주세요.</li>
        </ul>
      </div>
    </div>
  );
}
