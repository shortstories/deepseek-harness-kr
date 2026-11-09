// dsc.js 훅 정적 검증 — node:test + node:fs.
// plugins/dsh-tts/package.json 의 모듈 타입(ESM/CJS)이 아직 없거나 바뀌어도 돌도록,
// 내장 모듈은 process.getBuiltinModule 로 동기 로드하고 이 파일 경로는 process.argv[1] 로 찾는다.
const { test } = process.getBuiltinModule("node:test");
const assert = process.getBuiltinModule("node:assert/strict");
const fs = process.getBuiltinModule("node:fs");
const os = process.getBuiltinModule("node:os");
const path = process.getBuiltinModule("node:path");
const { spawnSync } = process.getBuiltinModule("node:child_process");

const HERE = path.dirname(path.resolve(process.argv[1] || "plugins/dsh-tts/test/dsc-hooks.test.js"));
const DSC_JS = path.resolve(
  HERE,
  "../../../character/index.ts",
);
// 캐릭터 소스는 TypeScript라 타입 표기만 공백으로 지워 읽는다 (줄·열 위치 유지)
const { stripTypeScriptTypes } = process.getBuiltinModule("node:module");
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => { if (!String(warning).includes("stripTypeScriptTypes")) emitWarning.call(process, warning, ...rest); };
/** 타입 표기만 지운 소스 (줄·열 위치 유지) @param {string} file */
const read = (file) => stripTypeScriptTypes(fs.readFileSync(file, "utf8")).replace(/(?<=\S) {2,}(?=[),=])/g, (m, i, all) => (all[i + m.length] === "=" ? " " : ""));
const SRC = read(DSC_JS);
// 모델 대화(혼잣말·결과 요약·직접 대화)는 character/chat.ts 로 나뉘어 있다
const CHAT_SRC = read(path.resolve(HERE, "../../../character/chat.ts"));
process.emitWarning = emitWarning;

test("dsc.js 존재 + dsc:say CustomEvent 동기 디스패치", () => {
  assert.ok(SRC.length > 1000, "dsc.js 를 읽었다");
  assert.ok(SRC.includes('"dsc:say"'), "dsc:say 이벤트 이름");
  assert.ok(SRC.includes("CustomEvent"), "CustomEvent 사용");
  assert.match(
    SRC,
    /window\.dispatchEvent\(new CustomEvent\("dsc:say", \{ detail: \{ text, ms, kind \} \}\)\)/,
    "detail: { text, ms, kind } 로 동기 디스패치",
  );
  assert.match(
    SRC,
    /kind = kind \|\| \(mutter \? "mutter" : "other"\);/,
    "kind 기본값 처리(other/mutter)",
  );
});

test("호출지 kind 태깅: TEXT 5곳 reaction, TOOLS 1곳 status", () => {
  const tagged = [
    'say(TEXT.hello, 5800, false, "reaction")',
    'say(TEXT[kind], 0, false, "reaction")',
    'say(TEXT.start, 2500, false, "reaction")',
    'say(TEXT.error, 5000, false, "reaction")',
    'say(TEXT.done, 4000, false, "reaction")',
    'say(text, 0, false, "status")',
  ];
  for (const s of tagged) assert.ok(SRC.includes(s), "호출지 누락: " + s);
  // 모델 대화(혼잣말·결과 요약·직접 대화)는 character/chat.ts 에서도 reaction 으로 태깅한다
  const model = [
    'speakModel(fit(got, SUMMARY_MAX), 5000, false, "reaction")',
    'speakModel(reply, Math.min(7000, Math.max(3000, 1200 + reply.length * 45)), false, "reaction")',
  ];
  for (const s of model) assert.ok(CHAT_SRC.includes(s), "모델 호출지 누락: " + s);
  assert.equal(
    (SRC.match(/"reaction"/g) || []).length + (CHAT_SRC.match(/"reaction"/g) || []).length,
    8,
    "reaction 태그 8개 (모델 요약·대화 포함)",
  );
  // 상태(도구 실행) 문구는 두 번째 말풍선으로 보낸다: say()의 라우팅 + 도구 호출지
  assert.match(SRC, /if \(kind === "status"\) \{\s+sayStatus\(text, ms\);/, "status 는 상태 말풍선으로 라우팅");
  assert.equal((SRC.match(/"status"/g) || []).length, 2, "status 태그 2개 (호출지 + 라우팅)");
  // 그대로 둔 호출지: 터치 반응 = other, 혼잣말 = mutter
  assert.ok(SRC.includes("say(text, ms);"), "터치 반응 호출지는 인자 그대로");
  assert.match(
    SRC,
    /say\(line, Math\.min\(5200, Math\.max\(3800, 1500 \+ line\.length \* 55\)\), true\);/,
    "혼잣말 호출지는 mutter=true 그대로",
  );
});

test("__dsc.voice 훅 + lines 매니페스트", () => {
  assert.ok(SRC.includes("__dsc"), "window.__dsc");
  assert.ok(SRC.includes("voice:"), "voice 훅");
  assert.ok(SRC.includes("lines: TEXT"), "lines 매니페스트");
  assert.match(
    SRC,
    /voice: \(state\) => \{ voiceState = state && state\.speaking !== false \? state : null; \}/,
    "voice(state) 구현",
  );
  assert.ok((SRC.match(/voiceState = null/g) || []).length >= 2, "voiceState 선언/만료 정리");
});

test("렌더 루프: voiceState 만료 + talking/open/모음 오버라이드", () => {
  assert.match(SRC, /let voiceState = null;/, "voiceState 선언");
  assert.match(
    SRC,
    /if \(voiceState && voiceState\.until && now > voiceState\.until\) voiceState = null;/,
    "until 만료 시 null",
  );
  assert.match(
    SRC,
    /const talking = \(voiceState\?\.speaking === true\) \|\| \(bubble\.classList\.contains\("show"\) && fleeX === 0\);/,
    "talking = 음성 재생 중 또는 말풍선 표시 중",
  );
  assert.match(SRC, /open = clamp\(voiceState\.level, 0, 1\) \* 0\.9;/, "level → open 덮어쓰기");
  assert.match(
    SRC,
    /for \(const key of VOWELS\) vowel\[key\] = Math\.max\(vowel\[key\] \* 0\.4, clamp\(voiceState\.vowels\[key\] \|\| 0, 0, 1\)\);/,
    "vowels → vowel 덮어쓰기",
  );
});

test("말풍선 조건부 유지: 재생 중이면 250ms 재확인, voiceState 없으면 예전과 동일", () => {
  assert.match(SRC, /const hideBubble = \(delay\) => \{/, "숨김 헬퍼");
  assert.match(
    SRC,
    /if \(voiceState\?\.speaking === true\) \{ hideBubble\(250\); return; \}/,
    "재생 중이면 250ms 뒤 재확인",
  );
  assert.match(
    SRC,
    /clearTimeout\(bubbleTimer\); if \(ms\) hideBubble\(ms\);/,
    "say() 는 hideBubble(ms) 사용",
  );
  assert.ok(
    !SRC.includes('setTimeout(() => bubble.classList.remove("show"), ms)'),
    "예전 인라인 숨김 타이머 제거",
  );
});

test("말풍선 두 개: 상태 말풍선은 본 말풍선과 분리 배치·분리 수명", () => {
  const CSS = fs.readFileSync(path.resolve(HERE, "../../../assets/character.css"), "utf8");
  assert.ok(SRC.includes('bubbleStatus.id = "dsc-bubble-status"'), "상태 말풍선 요소 생성");
  assert.ok(CSS.includes("#dsc-bubble-status"), "상태 말풍선 스타일");
  // 본 말풍선을 건드리지 않고 상태 문구만 갈아 끼운다
  const statusBody = SRC.slice(SRC.indexOf("const sayStatus ="), SRC.indexOf("const say = (text"));
  assert.ok(statusBody.length > 40, "sayStatus 정의를 찾았다");
  assert.ok(statusBody.includes("bubbleStatus.textContent = text;"), "상태 문구는 상태 말풍선에");
  assert.ok(!statusBody.includes("bubble.textContent"), "본 말풍선은 건드리지 않는다");
  assert.ok(!statusBody.includes("lastSayAt"), "lastSayAt 을 갱신하지 않아 혼잣말 2.5초 간격을 막지 않는다");
  assert.ok(SRC.includes("const hideStatus = (delay = 0) => {"), "상태 말풍선 숨김");
  // 배치: 본 말풍선을 놓은 뒤 그 위에 상태 말풍선을 놓는다
  assert.match(SRC, /placeBubble\(introOn, spot\);\s+placeStatusBubble\(spot\);/, "place() 가 둘 다 배치");
  assert.ok(SRC.includes("const placeStatusBubble = ({ noseX, headTop }") || SRC.includes("const placeStatusBubble = ({ noseX, headTop })"), "배치 함수");
  // 작업이 끝나면 상태 말풍선을 내린다 (본 말풍선 결과 대사는 그대로)
  assert.ok(SRC.includes("hideStatus();   // 작업이 끝났으므로 상태 말풍선을 내린다"), "턴 종료 시 숨김");
  assert.ok(SRC.includes("bubbleStatus.classList.contains(\"show\") ? bubbleStatus.textContent : \"\""), "__dsc.status 훅");
});

test("모델 대화 훅: 상태 조회·역할 판정·태그 분리·우클릭 대화", () => {
  // 호스트 라우트 (플러그인 자신의 경로만 쓴다)
  assert.ok(CHAT_SRC.includes('const CHAT_STATE_URL = "/deepseek-harness-kr/chat/state";'), "상태 라우트");
  assert.ok(CHAT_SRC.includes('const CHAT_URL = "/deepseek-harness-kr/chat";'), "대화 라우트");
  // 역할별 on/off: 꺼져 있으면 규칙 기반 그대로
  assert.ok(
    CHAT_SRC.includes("const ready = (role) => !deps.petWindow && state.value?.enabled === true && state.value.roles?.[role] === true;"),
    "역할 판정",
  );
  // 모델 답변의 [태그]는 표정으로 바꾸고 본문만 말한다 (say 는 태그를 모른다)
  assert.match(CHAT_SRC, /const CHAT_TAG = \/\^\\\[\(\[\^\\\]\]\{1,24\}\)\\\]\\s\*\//, "태그 정규식");
  assert.ok(CHAT_SRC.includes("const e = expName[n.trim()]; if (e) flashExp(e, Math.max(1200, ms || 3000));"), "태그 → 표정");
  // 혼잣말·요약은 모델이 맡고, 실패하면 규칙 대사로 돌아간다 (캐릭터 쪽 위임 지점)
  assert.ok(SRC.includes('if (chat.ready("mutter")) { void chat.mutter(raw); return; }'), "혼잣말 위임");
  assert.ok(SRC.includes('else if (chat.ready("summary")) {'), "결과 요약 위임");
  assert.ok(SRC.includes("void chat.summary().then((ok) => { if (!ok) {"), "요약 실패 시 규칙 대사 폴백");
  // 우클릭 → 메뉴 (창 안 캐릭터에서만). 곧바로 대화를 열지 않고 메뉴에서 고르게 하고, 판정은 캔버스 칸 전체로 넓게 받는다
  assert.ok(
    SRC.includes('if (overChat(e.clientX, e.clientY) && openMenu(e.clientX, e.clientY)) { e.preventDefault(); e.stopPropagation(); return; }'),
    "우클릭 메뉴 열기",
  );
  assert.match(SRC, /const overChat = \(cx ?,\s?cy ?\) => \{/, "우클릭 판정 함수");
  assert.ok(
    CHAT_SRC.includes("const available = () => !deps.petWindow && (state.known ? state.value?.enabled === true && state.value.roles?.chat === true : true);"),
    "설정 확인 전에도 열어 보기",
  );
  assert.ok(CHAT_SRC.includes("root.id = \"dsc-chat\";"), "입력 말풍선 요소");
  // 길이는 지시문보다 느슨하게: 넘칠 때만 …로 줄인다 (문장을 잘라 어색해지지 않게)
  assert.ok(CHAT_SRC.includes('const fit = (line, max) => (line.length > max ? line.slice(0, max - 2).trimEnd() + "…" : line);'), "넘칠 때만 줄이기");
  // 라우트가 없을 때(플러그인만 올리고 dsh-web 을 안 띄운 경우) 조용히 넘어가지 않고 콘솔에 한 번 남긴다
  assert.ok(CHAT_SRC.includes('console.warn("[deepseek-harness-kr] 캐릭터 대화 라우트가 없습니다.'), "라우트 없음 경고");
  assert.ok(CHAT_SRC.includes("if (r.status === 404 && !warned) {"), "경고는 한 번만");
  assert.ok(CHAT_SRC.includes("const MUTTER_MAX = 60;"), "혼잣말 길이 제한 60자");
  assert.ok(CHAT_SRC.includes("const SUMMARY_MAX = 90;"), "요약 길이 제한 90자");
  // 세션 모델 빌리기: 지금 보고 있는 세션 id 를 함께 보낸다
  assert.ok(CHAT_SRC.includes('if (typeof window.__dscSessionId === "string" && window.__dscSessionId) body.sessionId = window.__dscSessionId;'), "세션 id 전달");
  // 펫 창 메뉴 "대화하기…" 는 창 안으로 돌아온 뒤 입력 말풍선을 연다
  assert.ok(SRC.includes("onChat: () => chat.openSoon(),"), "펫 창 메뉴 연결");
});

test("우클릭 메뉴: 캐릭터를 눌러도 대화가 바로 열리지 않고 메뉴에서 고른다", () => {
  // 메뉴 요소는 창 안 전용 (펫 창은 OS 메뉴를 쓴다)
  assert.ok(SRC.includes('menu.id = "dsc-menu"'), "메뉴 요소");
  assert.ok(SRC.includes("document.body.append(canvas, bubble, bubbleStatus, menu);"), "본문에 붙이기");
  // 캐릭터를 숨길 때(말풍선을 함께 내릴 때) 열려 있던 메뉴도 닫는다
  assert.ok(SRC.includes('if (value === "none") closeMenu();'), "숨길 때 메뉴도 닫기");
  // 항목: 대화하기… 는 모델 대화가 켜져 있을 때만, 창 밖으로 내보내기는 펫 창을 쓸 수 있을 때만
  assert.ok(SRC.includes('if (chat.available()) list.push({ label: "대화하기…", run: () => chat.open() });'), "대화하기 항목");
  assert.ok(SRC.includes('list.push({ label: "창 밖으로 내보내기", run: () => { try { hooks.togglePet?.(); }'), "내보내기 항목");
  // 항목이 없으면 열지 않고 브라우저 기본 메뉴에 맡긴다 (preventDefault 를 하지 않는다)
  assert.ok(SRC.includes("if (!list.length) { hideMenu(); return false; }"), "항목 없으면 열지 않음");
  // 화면 밖으로 나가지 않게 자리를 잡는다
  assert.ok(SRC.includes('menu.style.left = "0px"; menu.style.top = "0px";'), "자리 계산 전 초기화");
  assert.ok(SRC.includes("Math.min(innerWidth - box.width - 8, cx)"), "가로 클램프");
  assert.ok(SRC.includes("Math.min(innerHeight - box.height - 8, cy)"), "세로 클램프");
  // 바깥 누름·Esc·스크롤·창 크기 변경에서 닫는다
  assert.equal((SRC.match(/if \(menuOpen\(\)\) hideMenu\(\);/g) || []).length, 3, "닫기 경로(누름·스크롤·크기)");
  assert.ok(SRC.includes('if (e.key === "Escape" && menuOpen())'), "Esc 닫기");
});

test("우클릭 메뉴: 펫 창 메뉴와 같은 항목(소품·옷·체형·숨기기)을 서브메뉴로 낸다", () => {
  // 소품·옷과 체형은 플러그인 설정에 저장해야 캐릭터가 다음 프레임에 읽는다 (onSetting 통로)
  assert.ok(SRC.includes('if (onSetting) {'), "설정 통로가 있을 때만 외형 항목");
  assert.ok(SRC.includes('list.push({ label: "소품·옷", children: OUTFIT_ITEMS.map((item) => ({ label: item.ko, checked: outfit[item.key] === true, run: () => onSetting?.(item.key, outfit[item.key] !== true) })) });'), "소품·옷 서브메뉴");
  assert.ok(SRC.includes('list.push({ label: "체형", children: BODY_TYPES.map((body) => ({ label: body.ko, checked: (outfit.bodyType || "default") === body.key, run: () => onSetting?.("bodyType", body.key) })) });'), "체형 서브메뉴");
  assert.ok(SRC.includes('list.push({ label: "캐릭터 잠시 숨기기", run: () => { try { hooks.toggleCanvas?.(); }'), "숨기기 항목은 캔버스 숨김(다시 띄우기 쉬운 쪽)");
  // 서브메뉴는 한 겹 DOM으로 만들고, 화면 밖으로 넘치면 왼쪽으로 펼친다
  assert.ok(SRC.includes('sub.className = "dsc-menu dsc-submenu";'), "서브메뉴 상자");
  assert.ok(SRC.includes('if (box.right > innerWidth - 8) sub.classList.add("flip");'), "오른쪽 넘침이면 왼쪽으로");
  assert.ok(SRC.includes("for (const other of menu.querySelectorAll(\".dsc-menu-row.open\")) if (other !== row) other.classList.remove(\"open\");"), "한 번에 한 서브메뉴만");
  // 체크 표시는 글자 앞 ✓ 로 (OS 메뉴의 radio/checkbox 흉내)
  assert.ok(SRC.includes('button.textContent = (item.checked ? "✓ " : "") + item.label;'), "체크 표시");
});

test("dsc.js 는 특정 플러그인/URL 에 의존하지 않는다", () => {
  assert.ok(!/dsh-tts/i.test(SRC), "플러그인 이름 없음");
  // SVG 네임스페이스는 네트워크 주소가 아니므로 제외 (냄비·세숫대야 그림)
  assert.ok(!/https?:\/\//i.test(SRC.replaceAll("http://www.w3.org/2000/svg", "")), "http(s) URL 없음");
});

test("node --check 로 dsc.js 문법 검사", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsc-hooks-"));
  const tmp = path.join(dir, "dsc-check.mjs");
  try {
    fs.writeFileSync(tmp, SRC);
    const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    assert.equal(r.status, 0, "node --check 실패: " + (r.stderr || r.stdout));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
