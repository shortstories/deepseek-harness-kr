// 바깥 펫 창과의 연결 (창 안 캐릭터 쪽). 플러그인 호스트가 /deepseek-harness-kr/pet/ 아래에서 펫 프로세스를 띄우고 메시지를 이어 준다.
// 연결 상태·송수신·알림 처리·동기화 주기·미리 띄우기·토글 규칙은 이 파일이 맡고,
// 화면 좌표·표정 같은 캐릭터 동작은 deps 콜백으로 받는다 (character/index.js).
//
// 상태 (link.*)
//   open: 펫 창이 대신 보여 주는 중, opening: 열기를 요청한 시각(0이면 아님),
//   follow: 끄는 도중 창 밖으로 나가 펫 창이 커서를 따라오는 중 ({ shown }), boot: 화면을 처음 불러온 뒤 첫 조회 전,
//   petState: 호스트가 알려 준 펫 프로세스 상태 (none | starting | hidden | shown),
//   seq: 펫 창을 열 때마다 올리는 회차 번호. 펫 창 알림에 같은 번호가 붙어 와서, 이전 회차에서 늦게 온 알림을 가려냄
//   queue: 펫 창으로 보낼 반응 묶음 ([이름, 인자] 목록, 150ms마다 보냄)
//
// deps
//   url: 펫 경로 주소(없으면 연결하지 않음), fetch, setTimeout, setInterval, requestAnimationFrame, now
//   onUse(): 펫 창을 쓴 적이 있다고 표시 (플러그인이 내려갈 때 펫 창도 숨김)
//   onEnter(): 펫 창이 보이기 시작함 → 창 안 캐릭터는 숨기고 그리기를 멈춤
//   onLeave(): 펫 창이 붙었거나 닫힘 → 창 안 제자리로 되돌리고 다시 그림
//   onConfig(key, value): 펫 창 메뉴·설정 패널에서 바꾼 값
//   snapshot(): 지금 표정·자세를 펫 창에 맞출 메시지 목록, dragMessages(): 이동 키 메시지 목록
//   dockState(): { dock, outfit, avatar? } 붙을 자리와 소품·옷, 3D 모델 조절값(바뀌면 펫 창에 보냄), dragKey(): 이동 키, voice(): 외부 음성 상태
//   avatar(): 창 안 캐릭터의 3D 모델 사용 여부·외곽선 (warm·open에 실어 펫 창이 같은 렌더러로 그리게 함, 없으면 안 보냄)
//   idle(): 미리 띄워도 되는 한가한 때인지, hidden(): 캔버스를 숨긴 상태인지, openPose(): 지금 자리(화면 좌표 { k, x, y })
//   log: 진단 기록 통로 (기본 character/log.ts의 log, 시험에서 바꿔 끼움)
import { log as defaultLog, type Logger } from "./log.ts";
/** 펫 창으로 보내는 메시지: [이름, 인자 목록] */
export type PetMessage = [string, unknown[]];
/** 펫 연결이 캐릭터 쪽에서 받는 환경·콜백 (위 deps 설명 참고) */
export interface PetLinkDeps {
  url: string | null;
  fetch: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status?: number; json(): Promise<any> }>;
  setTimeout: (fn: () => void, ms?: number) => unknown;
  setInterval: (fn: () => void, ms?: number) => unknown;
  requestAnimationFrame: (fn: () => void) => unknown;
  now?: () => number;
  onUse(): void;
  onEnter(): void;
  onLeave(): void;
  onConfig(key: string, value: unknown): void;
  /** 펫 창 우클릭 메뉴 "대화하기…": 창 안으로 돌아와 입력 말풍선을 연다 */
  onChat?(): void;
  snapshot(): PetMessage[];
  dragMessages(): PetMessage[];
  dockState(): { dock: unknown; outfit: unknown; avatar?: unknown };
  avatar?(): unknown;
  dragKey(): string;
  voice(): unknown;
  idle(): boolean;
  hidden(): boolean;
  openPose(): { k: number; x: number; y: number };
  log?: Logger;
}
/** 펫 연결 상태와 동작 (위 상태 설명 참고) */
export interface PetLink {
  open: boolean; opening: number; supported: boolean; queue: PetMessage[]; last: string; polling: boolean;
  voiceSent: unknown; follow: { shown: boolean } | null; boot: boolean; petState: string; peek: number; seq: number; dragMod?: string;
  relay(name: string, args: unknown[]): void;
  post(path: string, body?: unknown): Promise<any>;
  enter(): void;
  leave(): void;
  poll(): void;
  tick(): void;
  start(): void;
  toggle(): void;
}
/** 펫 창 알림 하나 */
interface PetEvent { type: string; seq?: number; list?: unknown; message?: unknown; code?: unknown; signal?: unknown; stderr?: unknown; level?: unknown; text?: unknown }

/** 펫 창 연결 생성 (start()를 불러야 조회·주기 동작 시작) */
export function createPetLink(deps: PetLinkDeps): PetLink {
  const { url, fetch, setTimeout, setInterval, requestAnimationFrame, now = () => performance.now(), log = defaultLog } = deps;
  // 메서드는 아래에서 채운다
  const link = { open: false, opening: 0, supported: false, queue: [], last: "", polling: false, voiceSent: null, follow: null, boot: true, petState: "none", peek: 0, seq: 0 } as unknown as PetLink;

  /**
   * 펫 창으로 보낼 반응 추가. 펫 창이 보이는 동안(따라오는 중 포함)만 모아 보냄
   * @param name 펫 창에서 부를 캐릭터 동작 이름
   */
  link.relay = (name, args) => { if (link.open || link.follow?.shown) link.queue.push([name, args]); };

  /**
   * 펫 경로로 POST 요청. 응답의 펫 프로세스 상태(state)를 반영
   * @param path 펫 경로 아래 이름 (open, send, hide, warm)
   * @returns 응답 JSON (실패하면 null)
   */
  link.post = (path, body = {}) => {
    deps.onUse();
    if ((path === "warm" || path === "open") && deps.avatar) body = { ...(body as object), avatar: deps.avatar() };   // 펫 창도 창 안과 같은 렌더러(Live2D·3D)로
    return fetch(url! + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      // 숨기라고 보낸 직후 응답은 아직 shown일 수 있다 (펫 프로세스가 숨기 전). 그대로 믿으면, 창 안으로 돌아온 뒤에는 조회를 쉬므로
      // 다음 단축키가 '다른 화면이 연 펫 창'으로 잘못 보고 숨은 펫 창을 이어받아 캐릭터가 사라진다
      .then((response) => (response.ok ? response.json() : postRefused(path, response))).then((reply) => { if (reply?.state) link.petState = path === "hide" && reply.state === "shown" ? "hidden" : reply.state; return reply; })
      .catch((error) => { const reason = String(error?.message ?? error); log.warnOnce(`post:${path}:${reason}`, `펫 요청 오류 (${path}):`, reason); return null; });
  };

  /**
   * 거절된 POST 응답 경고 (상태 코드와 응답 본문의 error 필드)
   * @returns 응답 대신 넘길 값 (항상 null)
   */
  const postRefused = async (path: string, response: { status?: number; json(): Promise<any> }) => {
    const reply = await response.json().catch(() => null);
    const reason = typeof reply?.error === "string" ? reply.error : "";
    log.warnOnce(`post:${path}:${response.status}:${reason}`, `펫 요청 실패 (${path}): HTTP ${response.status}`, reason);
    return null;
  };

  /** 펫 프로세스 알림 중 진단할 것(오류·비정상 종료·펫 창 기록) 경고. 회차와 상관없이 같은 내용은 한 번만 */
  const report = (event: PetEvent) => {
    const stderr = event.stderr ? ["\n" + String(event.stderr)] : [];
    if (event.type === "error") log.warnOnce(`error:${event.message}`, "펫 창 오류:", event.message, ...stderr);
    else if (event.type === "closed" && ((event.code ?? 0) !== 0 || event.signal)) {
      const exit = [event.code !== undefined && `code ${event.code}`, event.signal && `signal ${event.signal}`].filter(Boolean).join(", ");
      log.warnOnce(`closed:${exit}`, `펫 프로세스 비정상 종료 (${exit}):`, ...stderr);
    }
    else if (event.type === "log") log.warnOnce(`log:${event.text}`, `펫 창 ${event.level}:`, event.text);
  };

  /** 펫 창이 보이기 시작함 처리 */
  link.enter = () => {
    const already = !!link.follow?.shown;
    link.open = true; link.opening = 0; link.last = ""; deps.onUse();
    deps.onEnter();
    if (!already) link.queue.push(...deps.snapshot());   // 따라오는 동안·숨어 있는 동안 바뀐 표정·자세를 한 번에 맞춤
    link.queue.push(...deps.dragMessages());   // 펫 창 안에서도 같은 이동 키로 옮길 수 있게
  };

  /** 펫 창이 제자리에 붙었거나 닫힘 처리 */
  link.leave = () => {
    if (!link.open) { link.opening = 0; return; }   // 아직 안 떴으면 창 안 캐릭터는 그대로
    link.open = false; link.opening = 0; link.queue = [];
    deps.onLeave();
    // 창 안 캐릭터가 다시 그려지는 프레임에 바로 펫 창을 숨김 (펫 창이 스스로 숨을 때까지 둘이 겹쳐 보이던 것 방지)
    requestAnimationFrame(() => { if (!link.open && !link.follow) link.post("hide"); });
  };

  /** 보임 알림 처리. 이쪽이 연(따라오게 했거나 던져서 연) 경우만 받음. 이미 숨기라고 한 뒤 늦게 온 알림은 무시 */
  const onShown = () => {
    if (!link.follow) { if (link.opening) link.enter(); return; }
    if (!link.follow.shown) { link.follow.shown = true; link.queue.push(...deps.snapshot()); }
  };
  /** 숨음 알림 처리. 펫 창이 맡고 있던 때만 돌아옴. 따라오던 펫 창이 숨으면 창 안 캐릭터가 다시 보이게 함 (방금 이쪽이 숨긴 따라오기 창이면 무시) */
  const onHidden = () => {
    if (link.open) link.leave();
    else if (link.follow?.shown) link.follow.shown = false;
  };
  /**
   * 펫 창 우클릭 메뉴·설정 패널에서 바꾼 값 반영
   * @param list [설정 키, 값] 쌍 목록 (형식이 다른 항목은 무시)
   */
  const onConfig = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const pair of list as unknown[]) if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string") {
      try { deps.onConfig(pair[0], pair[1]); } catch {}
    }
  };
  /** 펫 창 알림 하나 처리 */
  const handle = (event: PetEvent) => {
    report(event);
    if (event.seq !== undefined && event.seq !== link.seq) return;   // 이전 회차(붙고 숨은 뒤 늦게 남은) 알림은 버림
    if (event.type === "shown") onShown();
    // 붙음·닫힘·오류: 창 안 캐릭터로 돌아옴
    else if (event.type === "attach" || event.type === "closed" || event.type === "error") { link.follow = null; link.leave(); }
    else if (event.type === "hidden") onHidden();
    else if (event.type === "config") onConfig(event.list);
    // 펫 창 메뉴 "대화하기…": 창 안으로 돌아온 뒤 입력 말풍선을 연다
    else if (event.type === "chat") { link.follow = null; link.leave(); deps.onChat?.(); }
  };

  /** 호스트에 펫 상태·알림 조회 (이전 조회가 끝나기 전이면 건너뜀) */
  link.poll = () => {
    if (link.polling) return;
    link.polling = true;
    fetch(url! + "poll", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((status) => {
      link.polling = false;
      if (!status) return;
      link.supported = !!status.supported; link.petState = status.state || "none";
      if (link.boot && Number.isInteger(status.seq)) link.seq = Math.max(link.seq, status.seq);   // 새로 불러온 화면은 회차 번호를 이어받음
      for (const event of (status.events || []) as PetEvent[]) handle(event);
      // 이 화면을 새로 불러왔는데 펫 창이 떠 있음 (처음 한 번만: 붙은 직후 잠깐 남은 펫 창 때문에 다시 숨으면 안 됨)
      if (link.boot && status.state === "shown" && !link.open) { if (Number.isInteger(status.seq)) link.seq = status.seq; link.enter(); }
      link.boot = false;
    }).catch((error) => { link.polling = false; log.debug("펫 상태 조회 실패:", error); });
  };

  /** 150ms마다 하는 일: 열기 시간 초과 정리, 붙을 자리·소품·옷·이동 키가 바뀌면 전송, 모인 반응을 한 번에 보낸 뒤 알림 조회 */
  link.tick = () => {
    if (link.opening && now() - link.opening > 15000) link.opening = 0;   // 펫 창이 끝내 안 뜨면 포기
    if (!link.open && !link.opening && !link.follow) return;
    if (link.open || link.follow) {
      const { dock, outfit, avatar } = deps.dockState();
      const sig = JSON.stringify([dock, outfit, avatar]);
      if (sig !== link.last) { link.last = sig; link.queue.push(["dock", [dock]], ["outfit", [outfit]]); if (avatar !== undefined) link.queue.push(["avatar", [avatar]]); }
      // 이동 보조 키 설정이 바뀌면 펫 창에도 알려 줌 (펫 창은 설정 파일을 읽지 않는다)
      const dragNow = deps.dragKey();
      if (dragNow !== link.dragMod) { link.dragMod = dragNow; link.queue.push(["drag", [dragNow]]); }
      if (link.queue.length) { const list = link.queue; link.queue = []; link.post("send", { list }); }
    }
    link.poll();
  };

  /** 연결 시작: 첫 조회, 미리 띄우기 예약, 150ms 동기화·60ms 입 모양 전송 주기 등록 (url이 없으면 아무것도 안 함) */
  link.start = () => {
    if (!url) return;
    link.poll();
    /**
     * 숨긴 펫 창 미리 띄우기. 처음 끌 때 펫 프로세스가 준비되길 기다리지 않게(약 2.5초, 그동안 창 밖에서 캐릭터가 잘리다 튐), 화면이 자리 잡고 한가할 때 숨긴 채 미리 띄워 둠
     * 시작 인사·작업 중·창이 안 보일 때는 3초씩 미루고, 한가한 때(requestIdleCallback)에 한 번만. 시작하는 동안은 호스트가 낮은 우선순위로 돌림
     * @param tries 호스트 지원 여부를 다시 물어본 횟수 (8번까지)
     */
    const warmUp = (tries = 0): void => {
      if (link.open || link.follow || (link.supported && link.petState !== "none")) return;
      if (!link.supported) { link.poll(); if (tries < 8) setTimeout(() => warmUp(tries + 1), 3000); return; }   // 호스트가 늦게 뜨면 처음 조회가 실패했을 수 있어 다시 물어봄 (지원 안 하면 포기)
      if (!deps.idle()) { setTimeout(() => warmUp(tries), 3000); return; }
      ((globalThis as any).requestIdleCallback || ((callback: () => void) => setTimeout(callback, 0)))(() => { if (link.petState === "none") link.post("warm"); }, { timeout: 5000 });
    };
    setTimeout(warmUp, 5000);
    setInterval(link.tick, 150);
    // 입 모양(외부 음성 상태)은 따로 자주 보냄
    setInterval(() => {
      const voice = deps.voice();
      if (!link.open || voice === link.voiceSent) return;
      link.voiceSent = voice;
      link.post("send", { list: [["voice", [voice]]] });
    }, 60);
  };

  /**
   * 단축키 처리: 펫 창으로 내보내기 / 돌아오기
   * 돌아오기는 창 안 캐릭터가 먼저 제자리에 나타나고(leave), 그 프레임에 펫 창을 숨긴다.
   * 펫 창을 먼저 숨기고 hidden 알림(150ms 조회)을 기다리면 그 사이 캐릭터가 어디에도 없어 깜빡인다
   */
  link.toggle = () => {
    // 캔버스를 숨긴 상태에서는 펫 창으로 내보내지 않는다 (명시적 no-op).
    // 숨김은 '잠시 그리기만 멈춤'이고 복구 칩·설정·단축키로 되돌리는 경로가 이미 있다.
    // 여기서 펫 창을 열면 숨긴 캐릭터가 바깥에 나타나 의도와 어긋나고, 보이지 않는 상태의
    // 옛 포즈(shown)로 창을 배치하게 된다. 복구 후 다시 누르면 정상 동작한다.
    if (deps.hidden()) return;
    if (link.open) { link.leave(); return; }   // 펫 창이 대신 보여 주는 중 → 창 안에서 먼저 그리고 펫 창을 숨김 (leave가 다음 프레임에 hide)
    if (link.follow?.shown) { link.opening = 0; link.post("hide"); return; }   // 끄는 도중 따라오던 펫 창 → 숨기면 창 안에서 이어 감
    if (!url) return;
    if (link.petState === "shown") { link.enter(); return; }   // 다른 화면에서 열어 둔 펫 창이 이어받게
    const pose = deps.openPose();
    link.opening = now();
    link.post("open", { from: pose, to: pose, seq: ++link.seq });
  };

  return link;
}
