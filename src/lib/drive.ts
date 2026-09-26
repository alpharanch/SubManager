import * as auth from './auth';

// Files live in appDataFolder: hidden from the user's Drive and only readable by this app.
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

const MESSAGES: Record<string, string> = {
  accessNotConfigured: 'Google Cloud 프로젝트에서 Google Drive API가 사용 설정되지 않았어요.',
  SERVICE_DISABLED: 'Google Cloud 프로젝트에서 Google Drive API가 사용 설정되지 않았어요.',
  insufficientPermissions: '드라이브 권한이 없어요. 드라이브를 다시 연결해 주세요.',
  expired: '로그인이 만료됐어요. 다시 로그인해 주세요.',
};

export class DriveError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

async function request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const token = auth.accessToken();
  if (!token) throw new DriveError(401, 'expired', MESSAGES.expired);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  } catch {
    throw new DriveError(0, 'network', '네트워크 오류로 드라이브에 연결하지 못했어요.');
  }
  if (res.ok) return res;
  const data = await res.json().catch(() => null);
  const error = data?.error;
  const reason: string = error?.errors?.[0]?.reason ?? error?.details?.[0]?.reason ?? error?.status ?? 'unknown';
  if (res.status === 401) auth.invalidateToken();
  throw new DriveError(res.status, reason, MESSAGES[reason] ?? `드라이브 오류가 났어요 (${res.status} ${reason}).`);
}

/** Newest file with this name in the app folder, or null. */
export async function findAppFile(name: string): Promise<string | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${name}' and trashed = false`,
    fields: 'files(id)',
    orderBy: 'modifiedTime desc',
    pageSize: '10',
  });
  const data = (await (await request(`${FILES}?${params}`)).json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

export async function readAppFile(id: string): Promise<unknown> {
  return (await request(`${FILES}/${id}?alt=media`)).json();
}

export async function createAppFile(name: string, content: unknown): Promise<string> {
  const boundary = `submanager-${Math.random().toString(36).slice(2)}`;
  const metadata = { name, parents: ['appDataFolder'], mimeType: 'application/json' };
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(content),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  const res = await request(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return ((await res.json()) as { id: string }).id;
}

export async function updateAppFile(id: string, content: unknown): Promise<void> {
  await request(`${UPLOAD}/${id}?uploadType=media&fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(content),
  });
}
