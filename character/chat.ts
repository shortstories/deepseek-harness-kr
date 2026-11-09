// 캐릭터 대화: 플러그인 호스트의 /deepseek-harness-kr/chat 을 불러 혼잣말·결과 요약·직접 대화를 모델이 맡는다.
// 규칙 기반 반응(터치·도구 상태)은 그대로 두고, 켜져 있을 때만 이 모듈이 대신 말한다.
// 펫 창은 dscpet:// 로 떠서 호스트에 닿지 않으므로 모델 기능은 창 안 캐릭터에서만 쓴다.
import type { Lifetime } from "./lifetime.ts";

/** 모델이 맡는 세 가지 역할 */
export type ChatRole = "mutter" | "summary" | "chat";
/** 호스트가 알려 주는 지금 대화 설정 (GET /deepseek-harness-kr/chat/state) */
type ChatState = { enabled?: boolean; roles?: Partial<Record<ChatRole, boolean>> };
/** 주고받은 대화 한 줄 (호스트가 history 로 받는다) */
type ChatTurn = { role: "user" | "assistant"; content: string };
/** 대화 모듈이 캐릭터 쪽에서 받는 것 */
export interface ChatDeps {
  /** 말풍선으로 말하기 (캐릭터의 say) */
  say(text: string, ms?: number, mutter?: boolean, kind?: string): void;
  /** 표정 잠깐 켜기 (캐릭터의 flashExp) */
  flashExp(name: string, ms: number): void;
  /** 몸짓 한 번 재생 (캐릭터의 play) */
  play(name: string, dur: number): void;
  /** 표정 이름 → 모델 표정 키 (캐릭터의 EXP_NAME) */
  expName: Record<string, string>;
  /** 지금 혼잣말을 해도 되는지 (혼잣말·말풍선 사이 간격) */
  mutterOpen(): boolean;
  /** 혼잣말을 한 것으로 표시 (간격 기준 시각 갱신) */
  mutterMark(): void;
  /** 바깥 펫 창 안에서 도는 중인지 */
  petWindow: boolean;
  /** 타이머·리스너 정리 통로 */
  lifetime: Lifetime;
}
/** 대화 모듈이 캐릭터에 내주는 통로 */
export interface ChatApi {
  /** 이 역할을 모델이 맡는지 (설정이 켜져 있고 역할도 켜져 있을 때) */
  ready(role: ChatRole): boolean;
  /** 추론 요약 문단을 혼잣말 한 줄로 바꿔 말하기. 실패하면 false */
  mutter(raw: string): Promise<boolean>;
  /** 방금 끝난 답변을 결과 요약 한 줄로 말하기. 실패하면 false */
  summary(): Promise<boolean>;
  /**
   * 대화 입구를 열어 볼 만한지 (설정을 아직 못 읽었으면 시도해 볼 값으로 true).
   * ready()는 설정을 읽은 뒤에만 true라서, 화면을 막 띄운 직후 우클릭이 그냥 브라우저 메뉴가 되어 버린다
   */
  available(): boolean;
  /** 직접 대화 입력 말풍선 열기 */
  open(): void;
  /** 직접 대화 입력 말풍선 닫기 */
  close(): void;
  /** 펫 창 메뉴에서 부를 때: 창 안으로 돌아온 뒤 대화 열기 (캐릭터가 넘겨받은 동작) */
  openSoon(): void;
}

/** 상태 조회 경로 (브라우저 쪽이 한 번 읽어 어느 역할을 붙일지 정한다) */
const CHAT_STATE_URL = "/deepseek-harness-kr/chat/state";
/** 대화 요청 경로 */
const CHAT_URL = "/deepseek-harness-kr/chat";
/** 답변 앞의 표정 꼬리표 ("[홍조] 본문") */
const CHAT_TAG = /^\[([^\]]{1,24})\]\s*/;
/** 혼잣말을 한 숨에 읽히는 선 (넘을 때만 줄인다) */
const MUTTER_MAX = 60;
/** 결과 요약을 한 숨에 읽히는 선 (넘을 때만 줄인다) */
const SUMMARY_MAX = 90;
/** 대화에 실어 보낼 최근 줄 수 */
const HISTORY_MAX = 20;
/** 설정 화면에서 켜고 끄면 따라오기까지의 확인 주기 */
const STATE_REFRESH_MS = 30000;

/** 넘칠 때만 줄이고 …로 맺기 (짧으면 그대로) */
const fit = (line: string, max: number) => (line.length > max ? line.slice(0, max - 2).trimEnd() + "…" : line);

/**
 * 캐릭터 대화 모듈 만들기
 * @param deps 캐릭터 쪽 통로 (말하기·표정·몸짓·간격·수명)
 */
export function createChat(deps: ChatDeps): ChatApi {
  const { say, flashExp, play, expName, lifetime } = deps;
  const state: { value: ChatState | null; known: boolean; loading: boolean; history: ChatTurn[]; busy: boolean; panel: HTMLDivElement | null; input: HTMLInputElement | null; log: HTMLDivElement | null; open: boolean } =
    { value: null, known: false, loading: false, history: [], busy: false, panel: null, input: null, log: null, open: false };
  /** 이 역할을 모델이 맡는지 (펫 창·꺼짐·역할 꺼짐이면 false) */
  const ready = (role: ChatRole) => !deps.petWindow && state.value?.enabled === true && state.value.roles?.[role] === true;
  /** 대화 입구를 열어 볼 만한지 (아직 설정을 못 읽었으면 시도해 본다) */
  const available = () => !deps.petWindow && (state.known ? state.value?.enabled === true && state.value.roles?.chat === true : true);

  /** 라우트 없음 경고를 한 번만 남겼는지 */
  let warned = false;
  /** 지금 대화 설정 읽기 (꺼져 있으면 value = null. 응답을 받았으면 known = true) */
  const loadState = () => {
    if (deps.petWindow || state.loading) return;
    state.loading = true;
    fetch(CHAT_STATE_URL, { headers: { accept: "application/json" } })
      .then((r) => {
        // 라우트가 없다 = 호스트가 아직 이 버전을 모른다 (플러그인만 올리고 dsh-web을 안 띄운 경우).
        // 화면은 조용히 규칙 기반으로 돌아가므로, 원인을 찾을 수 있게 콘솔에 한 번만 남긴다
        if (r.status === 404 && !warned) { warned = true; console.warn("[deepseek-harness-kr] 캐릭터 대화 라우트가 없습니다. 플러그인을 업데이트했다면 dsh-web을 재시작하세요."); }
        if (!r.ok) return null;
        return r.json() as Promise<ChatState>;
      })
      .then((s) => { state.value = s && typeof s === "object" ? s : null; state.known = true; })
      .catch(() => {})   // 물어보지 못했으면 known은 그대로 두고 다음에 다시 시도
      .finally(() => { state.loading = false; });
  };
  loadState();
  lifetime.interval(loadState, STATE_REFRESH_MS);

  /**
   * 호스트에 대화 요청 (역할별 지시문은 호스트가 고른다)
   * @param mode 역할
   * @param text 재료 (혼잣말이면 추론 요약, 요약이면 답변 본문, 대화면 사용자 말)
   * @param history 직접 대화에서만 싣는 앞선 대화
   * @returns 답변 본문, 실패하면 null
   */
  const request = async (mode: ChatRole, text: string, history?: ChatTurn[]): Promise<string | null> => {
    if (!ready(mode)) return null;
    const body: { mode: ChatRole; text: string; history?: ChatTurn[]; sessionId?: string } = { mode, text };
    if (mode === "chat" && history?.length) body.history = history;
    // 세션 모델을 빌려 쓸 때 어느 세션인지 알려 준다 (플러그인 화면이 채워 둔 값)
    if (typeof window.__dscSessionId === "string" && window.__dscSessionId) body.sessionId = window.__dscSessionId;
    try {
      const r = await fetch(CHAT_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { if (r.status === 404 || r.status === 503) state.value = null; return null; }   // 꺼졌거나 라우트 없음
      const data = await r.json();
      return typeof data?.text === "string" && data.text.trim() ? data.text.trim() : null;
    } catch { return null; }
  };

  /**
   * 모델 답변을 말한다. "[홍조] 본문" 의 꼬리표는 표정으로 바꾸고 본문만 말한다 (say 는 꼬리표를 모른다)
   * @param text 답변 (꼬리표가 붙어 있을 수 있음)
   * @param ms 말풍선 표시 시간
   * @param mutter 혼잣말 모양으로 말할지
   * @param kind 반응 종류 (말풍선 음성 연동용)
   */
  const speakModel = (text: string, ms: number, mutter: boolean, kind: string) => {
    let body = text, tag: string | null = null;
    const m = body.match(CHAT_TAG);
    if (m) { tag = m[1]; body = body.slice(m[0].length); }
    if (tag) for (const n of tag.split(",")) { const e = expName[n.trim()]; if (e) flashExp(e, Math.max(1200, ms || 3000)); }
    if (body.trim()) say(body.trim(), ms, mutter, kind);
  };

  /** 추론 요약을 혼잣말 한 줄로 (간격이 아니면 말하지 않고 true) */
  const mutter = async (raw: string) => {
    const got = await request("mutter", raw);
    if (!got) return false;
    const line = fit(got, MUTTER_MAX);
    if (!deps.mutterOpen()) return true;   // 말할 차례가 아니면 버린다 (요청 자체는 성공)
    deps.mutterMark();
    speakModel(line, Math.min(5200, Math.max(3800, 1500 + line.length * 55)), true, "mutter");
    if (Math.random() < 0.35) play("tilt", 1600);
    return true;
  };

  /** 방금 끝난 턴의 답변 본문 (요약 재료). 없으면 빈 문자열 */
  const lastAnswer = () => {
    const rows = [...document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')];
    const row = rows.pop();
    return row ? ((row as HTMLElement).innerText || "").trim().slice(0, 4000) : "";
  };

  /** 결과 요약을 한 줄로 (답변이 없거나 실패하면 false) */
  const summary = async () => {
    const answer = lastAnswer();
    if (!answer) return false;
    const got = await request("summary", answer);
    if (!got) return false;
    speakModel(fit(got, SUMMARY_MAX), 5000, false, "reaction");
    return true;
  };

  /** 대화 기록에 한 줄 붙이기 (줄마다 정리 목록에 쌓이지 않도록 요소를 직접 만들지 않는다) */
  const append = (who: "me" | "her", text: string) => {
    if (!state.log) return;
    state.log.insertAdjacentHTML("beforeend", '<div class="dsc-chat-line ' + who + '"></div>');
    const line = state.log.lastElementChild;
    if (line) line.textContent = text;
    state.log.scrollTop = state.log.scrollHeight;
  };

  /** 입력 칸의 말을 보내고 답을 말한다 */
  const send = async () => {
    if (!state.input || state.busy) return;
    const text = state.input.value.trim();
    if (!text) return;
    state.input.value = "";
    append("me", text);
    state.busy = true;
    const reply = await request("chat", text, state.history);
    state.busy = false;
    if (!reply) { append("her", "지금은 대답을 못 했어요. 잠시 뒤에 다시 말 걸어 주세요."); return; }
    state.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
    if (state.history.length > HISTORY_MAX) state.history = state.history.slice(-HISTORY_MAX);
    append("her", reply);
    speakModel(reply, Math.min(7000, Math.max(3000, 1200 + reply.length * 45)), false, "reaction");
  };

  /** 입력 말풍선 만들기 (처음 열 때 한 번) */
  const build = () => {
    const root = document.createElement("div");
    root.id = "dsc-chat";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "딥시크쨩에게 말 걸기");
    root.innerHTML = [
      '<div class="dsc-chat-head"><strong>딥시크쨩</strong><button type="button" data-close aria-label="닫기">×</button></div>',
      '<div class="dsc-chat-log" data-log aria-live="polite"></div>',
      '<form class="dsc-chat-form" data-form>',
      '<input type="text" data-input maxlength="500" autocomplete="off" placeholder="말을 걸어 보세요">',
      '<button type="submit" data-send>보내기</button>',
      '</form>',
    ].join("");
    document.body.append(root);
    lifetime.add(() => root.remove());
    state.input = root.querySelector<HTMLInputElement>("[data-input]");
    state.log = root.querySelector<HTMLDivElement>("[data-log]");
    root.querySelector<HTMLFormElement>("[data-form]")!.addEventListener("submit", (e) => { e.preventDefault(); void send(); });
    root.querySelector("[data-close]")!.addEventListener("click", () => close());
    return root;
  };

  /** 입력 말풍선 열기 (없으면 만든다) */
  function open() {
    if (deps.petWindow) return;
    if (!state.panel) state.panel = build();
    state.panel.classList.add("show");
    state.open = true;
    if (!state.known) loadState();   // 설정을 아직 못 읽었으면 열면서 다시 확인한다
    if (state.log && !state.log.childElementCount) append("her", "네, 주인님. 뭐든 말씀해 주세요.");
    try { state.input?.focus({ preventScroll: true }); } catch {}
  }
  /** 입력 말풍선 닫기 */
  function close() {
    if (!state.panel) return;
    state.panel.classList.remove("show");
    state.open = false;
  }

  // 바깥을 누르거나 Esc 로 닫기 (입력 칸 안을 누른 것은 예외)
  lifetime.listen(document, "pointerdown", (e: Event) => {
    if (!state.open || !state.panel || state.panel.contains(e.target as Node)) return;
    close();
  }, true);
  lifetime.listen(document, "keydown", (e: KeyboardEvent) => { if (e.key === "Escape" && state.open) close(); }, true);

  return {
    ready, available, mutter, summary, open, close,
    /** 펫 창 메뉴 "대화하기…": 창 안으로 돌아온 뒤 잠깐 기다렸다 연다 (돌아오는 그리기와 겹치지 않게) */
    openSoon() { lifetime.timeout(() => { if (!state.open) open(); }, 260); },
  };
}
