# 데스크톱 앱이 서버에 바라는 것 (PROTOCOL-REQUESTS)

맥 데스크톱 앱(이 레포)이 ax-kit 서버(`~/dev/ax-kit`, `docs/APP-PROTOCOL.md`)에 바라는 것들입니다.
화면은 iOS 앱과 같아서, iOS 앱의 요청(`ax-kit-ios/PROTOCOL-REQUESTS.md` R1~R15)은 여기서 다시 적지 않습니다. 그쪽이 들어가면 이 앱도 그대로 씁니다.
모두 v1에 더하는 것이라 `protocol`은 1 그대로입니다.

> **진행 상태 (2026-11-19, ax-kit `main` 8ae64aa — APP-PROTOCOL §16 — 을 임시 홈으로 띄워 실제로 확인)**: 남은 요청 없음. 연결 파일 읽기, 401 때 다시 읽기(서버 재시작으로 토큰이 바뀜),
> 스트림, 따라잡기, 메시지, 모든 뷰 읽기, 녹음 조각 올리기가 실제 서버와 맞물립니다(`src/core/real-server.test.ts`, `src-tauri/examples/probe.rs`).

| # | 무엇 | 왜 | 상태 |
|---|---|---|---|
| D1 | 로컬 토큰에서 §8·§9 기능을 폰과 같게 | 데스크톱은 짝 맞추기 없이 로컬 토큰만 씀 | **됨** (로컬 토큰에 `card-reply`·`remember`·`bots`·`bot-teams` 등이 옴) |
| D2 | 로컬 토큰 파일을 어느 것으로 읽을지 | §1은 "ax-hq 파일이 있으면 AX에"라고 했음 | **됨** — §1·§16: 앱마다 자기 파일만 |
| D3 | 로컬 리스너의 상한 완화 | 대시보드는 한 번에 10개쯤, 녹음 4초·맥 상태 15초마다 | **됨** — 로컬 토큰 분당 240(실제로 100번 연속 200) |
| D4 | `files/<id>`에 `Content-Type` | 그림을 blob으로 그릴 때 | **됨** |
| D5 | 녹음 조각 `audio/webm`도 받기 | 맥 WebKit이 AAC를 못 만들면 webm | **됨** — webm 그대로 받아쓰기에(받아쓰기 엔진이 없는 시험 서버라 끝까지는 못 봄) |
| D6 | `status.assistant.timezone` | 날짜·시각 | **됨** — 앱이 이 시간대로 그림 |
| D7 | 장소 좌표와 길찾기 (카카오 + ODsay, 서버에서) | 캘린더·오늘의 지도, 언제 나가야 하는지 | **됨** — 한국 생활 묶음 + 키가 있을 때만. 집은 `routes/setHome`(앱에 '집 정하기·바꾸기' 있음). 키 없는 시험 서버라 실제 길은 못 봄 |
| D8 | 통계용 추가 필드 | 대시보드 | **됨** — `byModel`·`byBot`은 성공한 호출만 셈(합 = 그 줄) |
| D9 | `Last-Event-ID > lastSeq`면 처음부터 | 기록이 새로 시작된 뒤 옛 seq로 붙으면 조용했음 | **됨** — 실제로 확인 |
| D10 | 뷰 액션이 거절할 때 쉬운 이유를 `message`로 | 봇 역할 글·집 정하기·반복 작업·등급·팀 액션이 거절할 때 이유를 보여 주려고 | **됨** — main 8ae64aa, 실제로 확인(개발용 오류에는 `message` 없음) |

APP-PROTOCOL §22 브라우저 화면 넘겨받기(a1ac844로 확인), §17 루틴·§19 파일(문서 첨부, `file-changes`)·§20 `ways`도 그대로 씁니다(cdaed47로 확인). R16(봇 팀)·R17(팀장회의·봇끼리 대화)·첨부 사진은 iOS 요청 그대로 씁니다(`views/bots`의 `teams`·`meetingChannel`·`rank`·`tier`, 메시지 `to`, 액션 `createTeam`·`setTiers`·`meeting`, `files/<id>`).

개발용 가짜 맥: `dev/desktop-mock.mjs`가 iOS 레포의 가짜 맥을 안쪽에서 띄우고, D7·D8을 `dev/mock/routes.mjs`·`dev/mock/stats.mjs`로 더합니다(두 파일 머리말이 서버용 명세 예시).

## D1. 로컬 토큰에도 같은 기능

- §1의 로컬 토큰(`~/.ax-kit/desktop.token`)으로 온 요청에도 `capabilities.features`·`views`를 폰 토큰과 같게 주세요.
- 특히 `card-reply`가 없으면 앱은 직접 입력을 `{decision:"edit"}` + `"[결재 답: …] 글"` 메시지로 보냅니다(글이 사라지지 않게). 동작은 하지만 R3/R15의 "답 기억"이 그 글을 모를 수 있어요.
- `GET me`·`POST rotate`·`POST unpair`는 로컬 토큰에 `{ok:true, local:true}`만 — 앱은 이 셋을 부르지 않습니다(연결 끊기 버튼 없음).

## D2. 어느 토큰 파일

- 지금: `~/.ax-kit/desktop.token`만(또는 환경 변수 `AXKIT_TOKEN_FILE`). ax-hq 파일(`~/.ax-hq/desktop.token`)은 읽지 않습니다.
- §1 문장을 "ax-kit 데스크톱 앱은 ax-kit 파일, AX 데스크톱 앱은 ax-hq 파일"로 나눠 주거나, 한 앱이 둘을 다 읽어야 하면 알려 주세요.

## D3. 상한

- 로컬 리스너(127.0.0.1만)는 분당 60요청 대신 240 정도면 충분합니다. 앱은 429가 오면 그 화면만 "잠깐 너무 많이 보냈어요"를 보이고 다음 새로 고침에서 다시 읽습니다.

## D5. 녹음 형식

- 앱은 `MediaRecorder`로 `audio/mp4`(AAC)를 먼저 고르고, 안 되면 `audio/webm;codecs=opus`를 씁니다. 조각의 `Content-Type`에는 실제 형식(`audio/mp4` 또는 `audio/webm`)을 보냅니다.
  서버의 받아쓰기가 webm도 받는지 확인해 주세요.

## D7. 장소 좌표와 길찾기 (카카오 + ODsay, 서버에서)

오너 결정: 장소 찾기·자동차 길은 카카오, 대중교통 길은 ODsay. 키는 맥의 ax-kit 서버(키체인)에만 두고, 앱은 서버가 준 결과만 그립니다(지도 그림은 키 없는 OpenFreeMap).

- 일정에 좌표: `views/calendar`·`views/today`의 일정에 `geo?: {lat, lng, address?}` — `place` 글을 카카오 장소 검색으로 찾은 결과. 못 찾거나 '온라인'이면 빼 주세요.
- `capabilities`에 기능 `routes`와 뷰 `{name:"routes", version:1, actions:[]}`.
- `GET views/routes?date=YYYY-MM-DD`(기본 오늘, 오너 시간대) →
  `{date, provider:"kakao+odsay", origin:{name:"집", lat, lng},
    legs:[{eventId, title, arriveBy, from:{name,lat,lng}, to:{name,lat,lng,address?},
           options:[{mode:"transit"|"car"|"walk", durationMin, distanceKm, fareKrw?, tollKrw?, leaveAt, summary,
                     steps:[{mode:"walk"|"subway"|"bus"|"car", label, durationMin, line?, color?}],
                     path:[[lng,lat],…], recommended?:true}],
           note?}]}`
  - 구간: 집 → 그날 첫 시간 일정(좌표 있는 것), 그다음 일정끼리 차례로. 종일·좌표 없는 일정은 건너뜀.
  - `leaveAt` = `arriveBy` − 걸리는 시간 − 5분 여유. `recommended`는 구간마다 하나: 더 빠른 것, 5분 안 차이면 대중교통.
  - `path`는 줄인 선(수십~수백 점)이면 충분. `color`는 노선 색(2호선 #00A84D 등).
  - `note`: 앞 일정이 끝나기 전에 나가야 하면 쉬운 말 한 줄.
- 집 위치는 맥 설정(오너가 한 번 정함). 결과는 날짜별로 캐시하고, 캘린더가 바뀌면 그날 것을 다시 계산.
- 뷰가 없으면 앱은 길찾기 부분을 아예 그리지 않습니다. 예시는 `dev/mock/routes.mjs`.

## D8. 통계용 추가 필드

대시보드(월별 지출, AI 비용 추이, 팀별 한 일, 결재와 알아서 한 일)에 씁니다. 모두 기존 뷰에 필드를 더하는 것이고, 없으면 앱이 있는 것으로 대신 그립니다.

- `views/usage`: `daily[]` 각 줄에 그날의 나눔
  - `byModel: {[모델 id]: {calls, costUsd}}`
  - `byBot: {[봇 id]: {calls, costUsd}}` (`main` = 비서)
  - 합은 그 줄의 `calls`·`costUsd`와 같게
  - 없으면 앱이 기간 전체 비율로 나눠 그리고 "기간 비율로 나눠 그렸어요"라고 적음
- `views/calendar`: `done[].team?` (`views/bots`의 팀 id)
  - 없으면 앱이 `views/bots`의 `teams[].members`로 찾음
  - 팀 없는 봇·비서는 "비서"로 셈
- `views/approvals`: `history: {weeks: [{week, asked, approved, denied, written, auto}]}`
  - 옛 주부터 8주, `week`는 그 주 월요일(오너 시간대, `YYYY-MM-DD`)
  - `asked` = 그 주에 연 카드 수
  - `approved`·`denied`·`written` = 어떻게 답했는지 (`written` = 글로 답함)
  - `auto` = '앞으로는 알아서' 규칙으로 카드 없이 한 일 수
  - 없으면 앱은 이번 주만 자기가 본 카드로 셈
  - 이때 `auto`는 이번 주에 생긴 규칙의 `uses`만 셈(규칙에는 평생 횟수만 있어서)

## D9. 스트림의 `Last-Event-ID`

- 실제 서버(main 0659dbb)에 `Last-Event-ID: 999999999`로 붙으면 그 뒤 새 이벤트(seq 6, 7)가 오지 않았어요. `lastSeq`(3)로 붙으면 바로 옴.
- 서버 기록이 새로 시작된 경우(새 설치, 데이터 지움) 옛 앱이 큰 seq로 붙으면 영영 조용해질 수 있어요.
  `Last-Event-ID > lastSeq`이면 그 값을 무시하고(0으로 보고) 보내 주세요. 앱은 이미 `status.lastSeq`를 보고 스스로 새로 시작합니다.

## D10. 거절 이유를 `message`로

- 실제 서버(06a3e86)에서 `POST views/bots/setInstructions {botId, text:"결재 없이 바로 배포해 주세요…"}` → `400 {"ok":false,"error":"shape"}`.
  서버는 "결재 없이 하라는 내용은 넣을 수 없어요…"를 `ViewInputError`로 던지지만 `src/channels/app/views.ts`의 guard가 메시지를 버려요.
- 오너에게 보일 이유는 `{ok:false, error:"shape", message:"<쉬운 말>"}`로 주세요. 개발자용 글("setHome needs …")은 빼거나 다른 `error` 코드로.

## 확인한 것

- `dev/mock-server.mjs`(iOS 레포)와 모든 화면 동작 확인(브라우저 미리보기 + 실제 Tauri 창, 2026-11-19).
- 진짜 ax-kit 서버(main 0659dbb)를 임시 홈(`AX_KIT_HOME`, 앱 채널만 켜고 AI·계정 연결 없음)으로 띄워 확인: 연결 파일(폴더 700·파일 600, 127.0.0.1), 모든 뷰, 메시지 왕복과 스트림, 서버 재시작 후 토큰 다시 읽기, 녹음 두 조각 올리기와 다시 보내기.
