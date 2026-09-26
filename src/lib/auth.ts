import { YT_SCOPE } from '../config';
import { AuthError, type Prompt } from './api';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'submanager:live:token';

interface StoredToken {
  value: string;
  expiresAt: number;
}

const MESSAGES: Record<string, string> = {
  popup_closed: '로그인 창이 닫혔어요.',
  popup_failed_to_open: '로그인 창을 열지 못했어요. 브라우저에서 이 사이트의 팝업을 허용해 주세요.',
  access_denied: '로그인이 거부됐어요. Google Cloud의 테스트 사용자에 이 계정이 등록돼 있는지 확인해 주세요.',
  scope_missing: 'YouTube 권한을 허용해야 쓸 수 있어요. 다시 로그인해서 권한에 체크해 주세요.',
  not_ready: 'Google 로그인을 준비하지 못했어요. 페이지를 새로고침해 주세요.',
};

const describe = (code: string) => MESSAGES[code] ?? `로그인에 실패했어요 (${code}).`;

let client: google.accounts.oauth2.TokenClient | null = null;
let pending: { resolve: () => void; reject: (e: Error) => void } | null = null;
let token: StoredToken | null = readStoredToken();

// The token lives in sessionStorage so a reload keeps the login until the tab is closed.
function readStoredToken(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    const t = raw ? (JSON.parse(raw) as StoredToken) : null;
    return t && t.expiresAt > Date.now() ? t : null;
  } catch {
    return null;
  }
}

function loadScript(): Promise<void> {
  if (typeof google !== 'undefined' && google.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error('Google 로그인 스크립트를 불러오지 못했어요. 네트워크나 광고 차단 설정을 확인해 주세요.'));
    };
    document.head.appendChild(script);
  });
}

export async function initAuth(clientId: string): Promise<void> {
  await loadScript();
  client = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: YT_SCOPE,
    callback: (resp) => {
      const p = pending;
      pending = null;
      if (resp.error) {
        p?.reject(new AuthError(resp.error, describe(resp.error)));
        return;
      }
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, YT_SCOPE)) {
        p?.reject(new AuthError('scope_missing', describe('scope_missing')));
        return;
      }
      // Renew a minute early so a request never starts with a token about to expire.
      token = { value: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) - 60) * 1000 };
      try {
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
      } catch {
        // Private mode: the token still works for this page load.
      }
      p?.resolve();
    },
    error_callback: (err) => {
      const p = pending;
      pending = null;
      p?.reject(new AuthError(err.type, describe(err.type)));
    },
  });
}

export function hasValidToken(): boolean {
  return !!token && token.expiresAt > Date.now();
}

export function accessToken(): string | null {
  return token && token.expiresAt > Date.now() ? token.value : null;
}

export function tokenExpiresAt(): number | null {
  return hasValidToken() ? token!.expiresAt : null;
}

/**
 * Opens the Google popup. Call it synchronously from a click handler
 * (before any await), or the browser blocks the popup.
 */
export function requestToken(prompt: Prompt): Promise<void> {
  if (!client) return Promise.reject(new AuthError('not_ready', describe('not_ready')));
  pending?.reject(new AuthError('superseded', ''));
  return new Promise<void>((resolve, reject) => {
    pending = { resolve, reject };
    client!.requestAccessToken({ prompt });
  });
}

/** Forgets the token without revoking the grant, so the next login skips the consent screen. */
export function invalidateToken() {
  token = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored.
  }
}
