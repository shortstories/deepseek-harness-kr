# AGENTS.md — 코드를 고칠 때 필요한 메모

이 저장소는 [noire113-dev/deepseek-chan-plugin-for-dsh-with-KR](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR)를 포크해 **캐릭터 대화(모델 연결)** 를 더한 것입니다. 사용자용 설명은 [README.md](README.md), 여기에는 **작업자(사람·에이전트)가 알아야 할 것**만 적습니다.

## 빌드·검사

```bash
npm install                 # esbuild·typescript·jsdom·react 등 devDependencies
npm run typecheck           # tsc -p tsconfig.json
npm run build               # assets/dsc.js, lib/client.js, pet/settings.cjs, cordis.patch.yml 생성
npm test                    # node --test (plugin/test/*.test.js, plugins/dsh-tts/test/*.test.js)
npm run trace:diff -- <기준 체크아웃>   # JSDOM 프레임 비교(기본 테스트에는 없음)
```

- **빌드 산출물도 커밋 대상**입니다(`assets/dsc.js`, `lib/client.js`, `pet/settings.cjs`). 소스만 고치고 `npm run build`를 잊으면 설치본에 반영되지 않습니다. `package.json`의 `files`에도 새 파일을 넣어야 배포됩니다.
- 로컬 반영: `dsh plugin --profile web update deepseek-harness-kr` (프로필은 `github:` 의존성으로 설치됨). `node_modules`에 손으로 복사하지 마세요 — 다음 설치 때 고정 커밋으로 되돌아갑니다.
- 클라이언트 번들은 파일 내용이 바뀌면 rev가 바뀌어 **새로고침만으로** 갱신됩니다. 호스트 코드(`plugin/host.js`)는 **dsh-web 재시작**이 필요합니다.

## 파일 지도

| 경로 | 역할 |
|---|---|
| `character/index.ts` | 화면 속 캐릭터 본체(배치·집기·터치·우클릭·말풍선). 가장 큰 파일 |
| `character/chat.ts` | 모델 대화: 상태 조회·혼잣말·결과 요약·대화 패널. `createChat(deps)` |
| `character/pet-link.ts` | 창 밖 펫 창과의 메시지 중계(`onChat` 훅 포함) |
| `character/harness-signals.ts` | Harness 상태 → 도구 상태 문구 표(`TOOLS`) |
| `plugin/host.js` | 호스트 진입: 설정 스키마(`Config`)·라우트 등록. **재시작 필요** |
| `plugin/chat-config.js` | `config.chat` 정규화(`normalizeChat`)와 검증 |
| `plugin/chat-host.js` | `GET /chat/state`, `POST /chat` 구현(API 직접 호출·세션 모델 빌리기) |
| `plugin/client.ts` | 설정 창 UI(말풍선 음성·캐릭터 대화 칸) |
| `pet/main.cjs` | Electron 펫 창, 우클릭 메뉴(`대화하기…` → `toHost({type:'chat'})`) |
| `plugins/dsh-tts/` | 말풍선 음성(TTS)과 `dsc:say` 소비. 테스트가 캐릭터 소스를 문자열로 검사 |

## 함정 (전부 실제로 밟은 것)

1. **호스트 라우트는 재시작 전까지 없다.** 플러그인만 업데이트하면 `/deepseek-harness-kr/chat/state`가 404이고, 클라이언트는 404·503을 "꺼짐"으로 읽어 **조용히 규칙 기반으로 퇴행**합니다. 진단:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:13080/deepseek-harness-kr/chat/state
   # 401 = 라우트 있음(인증만 없음, 정상) · 404 = 라우트 없음(재시작) · 403 = trust fence(Host 헤더 확인)
   ```

   404를 만나면 `character/chat.ts`가 콘솔에 한 번 경고합니다(`warned` 플래그).

2. **우클릭 메뉴 판정은 `overChat`**(캔버스 칸 전체 +4% 여백)입니다. `overBody`(몸 사각형)는 캔버스 양옆을 잘라내 도킹한 작은 크기에서 실제 폭이 절반이라, 그걸 쓰면 조금만 빗나가도 `preventDefault`가 실행되지 않아 브라우저 기본 메뉴가 뜹니다. `overBody`는 집기·펫 창용으로만 남겨 두세요. 창 안 우클릭은 곧바로 대화를 열지 않고 `#dsc-menu`(`대화하기…`·`창 밖으로 내보내기`·`소품·옷 ▸`·`체형 ▸`·`캐릭터 잠시 숨기기`)를 띄웁니다. 항목 이름·순서는 펫 창 메뉴(`pet/main.cjs`)와 맞추되, 창 안에는 Electron 메뉴 API가 없어 `fillMenu`/`openRow`가 DOM 서브메뉴를 만듭니다(오른쪽으로 넘치면 `flip` 클래스로 왼쪽으로 펼침. 세로로 넘칠 때는 `sub.style.top`을 밀어 올리는데, **재기 전에 `sub.style.top = ""`와 `flip`을 반드시 지워야** 합니다 — 지우지 않으면 지난번에 밀어 둔 위치를 기준으로 다시 재서 열 때마다 서브메뉴가 아래로 내려갑니다). **`#dsc-menu`에 `overflow`를 주면 안 됩니다** — 서브메뉴가 절대 위치라 부모 상자 밖으로 나가는데, `overflow: auto/hidden`이면 통째로 잘려 항목이 하나도 안 보입니다(0.8.11 회귀 사고). 스크롤이 필요하면 서브메뉴 쪽(`.dsc-submenu`)에만 겁니다. 외형 항목은 `onSetting`(= `applyPetConfig`) 통로로 저장해야 캐릭터가 다음 프레임에 읽고, `캐릭터 잠시 숨기기`는 펫 창의 '설정 끄기'와 달리 `hooks.toggleCanvas`(캔버스만 숨김·복구 칩)를 씁니다 — 항목이 하나도 없으면 `openMenu`가 false를 돌려 브라우저 기본 메뉴에 맡깁니다. 메뉴 블록은 `life.listen(document, "pointerdown", …)` 아래에 있어야 합니다(위에 두면 mouse-chord.test.js가 잘라 쓰는 `armChordGrab` 블록에 섞여 테스트가 깨집니다).

2-0. **`창 밖으로 내보내기` 항목은 `link.supported`일 때만** 넣습니다. 바깥 펫 창은 Windows·macOS 데스크톱 앱에서만 뜨고(`plugin/pet-host.js`의 `supportedOn`), 웹 프로필(Linux·브라우저)에서는 `/deepseek-harness-kr/pet/poll`이 `{"supported":false}`를 돌려줍니다. 조건 없이 넣으면 눌러도 아무 일이 없는 항목이 남습니다.

2-1. **대화 패널은 채팅창이 아니라 명령 한 줄 입력**입니다(`#dsc-chat`). `state.log`·`.dsc-chat-line`·`append()`는 없습니다 — 답은 `speakModel`로 캐릭터 말풍선에만 나가고, 보내면 입력 칸만 비웁니다(패널은 열어 둔 채 포커스 복귀). 기록은 `state.history`(최근 20줄)로만 남아 요청 본문 `history`에 실립니다. 로그를 되살리면 "반응은 캐릭터한테 보면 되니까"라는 요구와 어긋납니다.

2-2. **세션을 옮기면 "생성 중지" 버튼이 DOM에서 사라져** 400ms 감시 루프가 턴 종료로 오인합니다. 그대로 두면 남의 세션 답변으로 요약 LLM을 부릅니다(실측: 전환 직후 summary 1회). 그래서 `reactToRunning`이 작업 시작 시 `runningSession = chat.sessionId()`를 기억하고, 끝났을 때 `chat.sessionId()`가 다르면 `reactToFinish(false)`로 **모델을 부르지 않습니다**. 캐릭터가 `window.__dscSessionId`를 직접 읽지 않도록 세션 id는 `chat.sessionId()` 한 곳에서만 봅니다(`character/index.ts`는 전역 사용 금지 — `page-visibility.test.js`가 검사).

3. **설정을 못 읽은 첫 몇 초는 `available()`로 판정**합니다. `ready()`는 상태 조회가 끝나야 true라서, 그것만 쓰면 화면을 막 띄운 직후 우클릭이 브라우저 메뉴가 됩니다.

4. **펫 창에서는 `ready()`가 항상 false**입니다(`deps.petWindow`). 펫 창에서 대화를 여는 경로는 메뉴 `대화하기…` → `onChat` 하나뿐입니다.

5. **`Plugins` 패널을 열면 캐릭터 캔버스가 `display: none`** 이 되어 판정이 모두 빗나갑니다. 이때 브라우저 메뉴가 뜨는 것은 정상입니다(`pageHiddenNow()`).

6. **터치에서는 `contextmenu`가 발생하지 않습니다.** `character/index.ts`가 `touchstart` 기본 동작을 막고(스크롤로 집기가 풀리는 `pointercancel` 방지) 길게 누르기를 집기 제스처로 소비하기 때문입니다. 모바일 입구는 펫 창 메뉴뿐입니다.

7. **말풍선은 두 개**입니다. 본 말풍선(`#dsc-bubble`)과 상태 칩(`#dsc-bubble-status`). `say()`는 `kind === "status"`면 칩으로만 보내고 **`lastSayAt`을 갱신하지 않습니다** — 갱신하면 혼잣말 게이트(`mutterOpen`, 2.5초)가 막혀 상태 표시와 혼잣말이 동시에 안 보입니다. 두 요소의 표시/숨김은 `setBubbleDisplay`로 함께 토글하고, 캐릭터를 숨기는 모든 경로(`showAt`·`hideForPage`·`setHidden`·`fleeX`)가 이 헬퍼를 지나야 합니다.

8. **`dsc:say`의 `kind`는 TTS와 직결**됩니다. `plugins/dsh-tts/src/client/index.js`의 `kindAllowed`가 `reaction`·`status`·`mutter`·그 외를 각각 다른 설정 스위치로 매핑하므로, 새 kind를 만들면 TTS 쪽도 같이 봐야 합니다.

9. **headless에서 캐릭터 캔버스는 `document.body`의 자식**입니다(`#dsc-stage` 아님). `document.querySelector('canvas')`로 찾으세요. `#dsc-stage` 아래를 뒤지면 null입니다.

10. **headless Chrome은 검증이 끝나면 반드시 정리한다.** 2026-11-09에 `--remote-debugging-port`로 띄운 Chrome을 5시간 방치해 `chrome --type=gpu-process` 두 개가 각각 **746%·733%**(총 CPU 1500%, load average 29)를 먹었습니다. 코드 문제가 아니라 잔여 프로세스였고, 그 상태로는 사용자 화면도 느려집니다.
    - 띄우기: `run_in_background` 잡 + `--user-data-dir=<임시 경로>`. 셸 `&`·`nohup`은 세션 종료 시 같이 죽습니다.
    - 지우기: `pkill -f "<패턴>"`의 패턴이 **자기 명령줄에 들어 있으면 그 셸도 SIGTERM/SIGKILL로 죽습니다**(`rm -rf /tmp/chrome-xxx` 줄까지 매칭됨). `pgrep`으로 PID를 뽑아 `kill` 하고, 패턴 문자열은 쪼개 쓰세요.
    - 확인: `ps -eo pcpu,pid,comm --sort=-pcpu | head`, 그리고 `curl -s -m 2 http://127.0.0.1:<포트>/json/version` 무응답 + 임시 `--user-data-dir` 삭제.
    - DSH의 `gemini-web` 서비스가 쓰는 Chrome(서비스 부모 프로세스)은 건드리지 마세요.

## 테스트가 소스를 문자열로 잠근다

`plugins/dsh-tts/test/dsc-hooks.test.js`는 `character/index.ts`·`character/chat.ts`를 읽어 **문자열·정규식**으로 검사합니다(타입을 지운 뒤 `read()` 헬퍼가 연속 공백을 1칸으로 정규화). 그래서:

- 판정 조건(`overChat`, `available`, 우클릭 분기)이나 말풍선 라우팅을 바꾸면 **테스트도 같이** 고쳐야 합니다.
- 새 요소를 `character/index.ts`에서 참조하면 `plugin/test/character-controls.test.js`·`page-visibility.test.js`·`plugin.test.js`의 vm 샌드박스에 스텁을 추가해야 합니다(없으면 `ReferenceError`).

## 릴리스 절차

1. `npm run typecheck && npm run build && npm test`
2. `package.json`의 `version` 올리기(포크 버전: 0.8.x)
3. 커밋 → `main` push (자격증명은 `~/.config/gh/hosts.yml`의 oauth 토큰을 `git -c credential.helper= push https://x-access-token:<토큰>@github.com/...`로)
4. `dsh plugin --profile web update deepseek-harness-kr` → 버전 확인
5. `host.js`를 건드렸으면 dsh-web 재시작(에이전트 셸은 sudo가 거부되므로 사용자에게 요청), 아니면 새로고침

## 검증 레시피

- **로직**: JSDOM. `plugin/test/trace/harness.mjs`의 `bundleCharacter(root)`로 `character/`를 묶고, `installFakeTime`·`installFakeModel`·`installLayout`(내부 함수라 임시 사본에서 export)로 시간·모델·레이아웃을 고정합니다. 가짜 `fetch`로 `/deepseek-harness-kr/chat/state`만 200으로 응답시키면 모델 대화가 켜진 상태를 재현할 수 있습니다.
- **실제 브라우저**: headless Chrome + CDP.
  1. `data/startup.log`의 `token=` 값으로 `GET http://127.0.0.1:13080/?token=<토큰>`(redirect manual) → 303의 `Set-Cookie`를 `Network.setCookie`(domain `127.0.0.1`)로 심습니다. 이게 없으면 라우트가 401입니다.
  2. `--headless=new --no-sandbox --disable-gpu --user-data-dir=<임시> --remote-debugging-port=<포트>`를 백그라운드 잡으로 띄웁니다.
  3. `Page.captureScreenshot`의 `clip`으로 캐릭터·말풍선 영역만 잘라 확인합니다.
- 공개 URL(`https://ai.ocha.ng`)은 nginx basic auth(PAM) 앞단이라 로컬에서 재현되지 않습니다. 인증된 사용자 브라우저가 유일한 관측점입니다.

## upstream 동기화

`upstream` 리모트가 원본입니다. 2026-11-08에 0.8.0(JS → TypeScript 리팩터링)을 머지할 때는 **upstream의 TS 구조를 채택하고 우리 기능을 TS로 재포팅**했습니다(`git checkout --theirs` 8개 + `plugin/client.js` 삭제). 충돌 시 우리 쪽 `plugin/chat-config.js`·`plugin/chat-host.js`는 upstream이 건드리지 않아 그대로 살아남습니다.
