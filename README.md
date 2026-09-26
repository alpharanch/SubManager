# SubManager

YouTube 구독 채널을 정리하는 웹앱이에요.

- 구독 채널을 그룹으로 나누고, 그룹별로 새 영상만 모아 봐요.
- 채널마다 구독 시작일과 마지막 업로드 날짜를 보고, 오래 활동이 없는 채널을 골라 구독을 취소해요.
- 취소한 채널은 기록에 남아서 다시 구독할 수 있어요.
- 구독 목록을 CSV로, 그룹을 백업 파일로 내보낼 수 있어요.

주소: https://alpharanch.github.io/SubManager/
샘플 데이터로 둘러보기: https://alpharanch.github.io/SubManager/?demo

## 동작 방식

서버 없이 브라우저에서만 동작해요. 브라우저가 Google 계정으로 로그인하고 YouTube Data API를 직접 호출해요.
구독 목록, 그룹, 구독 취소 기록은 그 브라우저의 IndexedDB에만 저장돼요. 다른 기기에서 쓰려면 그룹 백업 파일을 내보내서 가져오면 돼요.

로그인은 약 1시간 유지돼요. 만료돼도 저장된 목록과 그룹은 그대로 볼 수 있고, 새로고침이나 구독 취소를 할 때 다시 로그인하면 돼요.

## Google Cloud 설정 (처음 한 번)

1. [Google Cloud 콘솔](https://console.cloud.google.com/projectcreate)에서 새 프로젝트를 만들어요.
2. [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com)를 사용 설정해요.
3. Google 인증 플랫폼(Google Auth Platform)에서 시작하기를 누르고 앱 이름과 이메일을 넣어요. 대상은 ‘외부’를 골라요.
4. 대상(Audience)의 테스트 사용자에 YouTube에 로그인하는 구글 계정 이메일을 추가해요.
5. 클라이언트(Clients)에서 ‘웹 애플리케이션’ 클라이언트를 만들고, 승인된 JavaScript 원본에 두 주소를 넣어요.
   - `https://alpharanch.github.io`
   - `http://localhost:5173` (내 PC에서 개발할 때)
6. 만든 클라이언트 ID를 `.env` 파일의 `VITE_GOOGLE_CLIENT_ID`에 넣고 main 브랜치에 푸시해요.

클라이언트 ID는 비밀 정보가 아니라서 저장소에 올려도 괜찮아요. 테스트 모드에서는 테스트 사용자로 등록한 계정만 로그인할 수 있어요.

로그인할 때 ‘Google에서 확인하지 않은 앱’ 화면이 나오면 계속을 누르면 돼요. 직접 만든 앱이라 나오는 화면이에요.
브랜드 계정 채널을 쓴다면 계정 선택 화면에서 그 채널을 골라야 그 채널의 구독 목록이 나와요.

## API 사용량

YouTube Data API는 프로젝트마다 하루 10,000 단위를 무료로 쓸 수 있고, 한국 시간 오후 4~5시에 초기화돼요.

| 작업 | 사용량 |
|---|---|
| 구독 목록 새로고침 | 채널 50개당 약 2 |
| 마지막 업로드 확인, 새 영상 불러오기 | 채널 1개당 1 |
| 구독 취소, 다시 구독 | 1건당 50 (하루 약 200건) |

화면 오른쪽 위에 오늘 이 브라우저에서 쓴 양이 표시돼요. 채널이 50개 넘는 그룹의 새 영상은 사용량을 아끼려고 버튼을 눌러야 불러와요.

## 개발

```bash
npm install
npm run dev
```

http://localhost:5173 에서 열려요. 주소 뒤에 `?demo`를 붙이면 Google 설정 없이 샘플 데이터로 볼 수 있어요.

main 브랜치에 푸시하면 GitHub Actions가 빌드해서 GitHub Pages에 배포해요.

## 구조

- `src/lib/youtube.ts`: YouTube Data API 호출
- `src/lib/auth.ts`: Google 로그인 (Google Identity Services 토큰 방식)
- `src/lib/demo.ts`: 샘플 데이터
- `src/store.ts`: 앱 상태와 동작 (불러오기, 업로드 확인, 구독 취소, 그룹)
- `src/components/`: 화면
