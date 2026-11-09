// DeepSeek짱 — Harness 화면에 밝은 파스텔 테마와 Live2D 캐릭터(상반신)를 띄우고,
// 지금 열린 대화의 Harness 작업 상태(작업 중 / 도구 / 승인·질문 대기 / 완료 / 실패)에 반응한다.
// 바깥 신호는 받지 않는다(포트 없음).
// base: 캐릭터 자산 폴더(assets/) 주소. life: 타이머·프레임·리스너·DOM 노드를 묶는 수명 객체(character/lifetime.js).
// 플러그인 화면은 기능을 끌 때 life를 정리하고, 펫 창은 창이 닫힐 때까지 그대로 둔다.
// pet: 바깥 펫 창에서 돌 때 preload가 넣어 준 window.dscPet (창 안이면 null).
// prefs: 플러그인 설정에서 온 값 { outfit, sleep, intro, mobile, drag, pageHidden }. 매 프레임·이벤트마다 읽으므로 setPrefs로 바꾸면 바로 반영된다.
// onSetting(key, value): 펫 창 메뉴에서 바꾼 설정을 플러그인 설정에 저장하도록 알린다.
// 반환: { setPrefs, togglePet, toggleCanvas, canvasHidden } — 플러그인 화면(plugin/client.js)이 쓰는 유일한 통로.
import { OUTFIT_ITEMS, BODY_TYPES } from "../shared/settings.js";
import { HOME_GAP, SHOW_K, MIN_SHOW_K, homeLayout, bubbleLayout, bubbleTail, tailRight, tailLeft, introBubbleSize } from "./layout.ts";
import { chordDown, chordWithinGrace, chordUp, type Chord } from "./chord.ts";
import { clamp, noise, S, spring, sstep, addGesture, blinkClose, seg, coverForearm } from "./motion.ts";
import { readStatus, scanAddedNode, readThought, thoughtLine } from "./harness-signals.ts";
import { createPetLink, type PetMessage } from "./pet-link.ts";
import { createChat } from "./chat.ts";
import { log } from "./log.ts";
import { parseSyllables } from "./speech.ts";
import { meshBounds, meshHit } from "./hit.ts";
import { walkAreaValid, sameWalkArea, walkDisplayArea, walkBodySpan, planWalkOut, walkSafePose, planWalkReturn, walkOutAlpha, walkInAlpha, walkClipInset, walkEasePetOut,
  type WalkArea, type WalkClipInset, type WalkDisplay, type WalkPlan } from "./pet-walk.ts";
import { MODEL_FILES, PARAMS, CHEST_DRAG_SIGN, VOWEL_EYE_SAFE, PARTS, PART_REGIONS, EXPRESSION_FILES, EYE_SWAP_EXPRESSIONS, GEOMETRY } from "./model-profile.ts";
import type { Lifetime } from "./lifetime.ts";
import type { CharacterApi, CharacterPrefs, Motion, PetBridge, Pose, Rect, Viewport } from "./types.ts";
import type { Syllable } from "./speech.ts";

/** 외부 음성(말풍선 음성 플러그인) 상태: 재생 중인지, 오디오 레벨, 모음별 세기, 유효 시각 */
type VoiceState = { speaking?: boolean; level: number; vowels?: Record<string, number>; until?: number };
/** 펫 창이 붙을 자리 (화면 좌표, win = DSH 창 영역) */
type PetDock = { k: number; x: number; y: number; win?: { l: number; t: number; r: number; b: number } };
/**
 * 제자리 배치 결과 (homePose): 자리·입력 카드·카드 사각형·컴포저 위 여부·뷰포트
 * r = 입력 카드 사각형(없으면 null), noSafe = 컴포저 위·아래 어디에도 피할 자리가 없음, vp = 배치에 쓴 뷰포트
 */
type Home = Pose & { card: Element | null | undefined; r: Rect | null; above: boolean; noSafe: boolean; vp: Viewport };
/** 자유 위치 애니메이션: 미끄러짐(to 있음) 또는 제자리로 붙기(snap). t0 = 시작 시각, ms = 길이 */
type FreeAnim = { t0: number; ms: number; from: Pose; to: Pose | null; snap: boolean };
/** 말풍선 배치에 쓰는 값 (noseX·headTop = 코 가운데 x·머리 꼭대기 y, 창 좌표) */
type BubbleSpot = { k: number; noseX: number; headTop: number; vp: Viewport; home: Home; introProgress: number };
/** 한 프레임 애니메이션의 공통값 (frameContext) */
type Frame = { now: number; dt: number; seconds: number; introCalm: boolean; talking: boolean; muttering: boolean; laughing: boolean };
/** 삐짐 단계 결과 (applySulk) */
type Sulk = { sulkWeight: number; peek: number; sulkEye: number };
/**
 * 집기 예약 (pointerdown이 만들고 pointermove·pointerup이 씀)
 * id = 포인터 번호, sx·sy = 누른 자리, h = 누른 곳의 캐릭터 지점(hitAt, 몸 밖이면 null), ox·oy = 캔버스 왼쪽 위에서 누른 자리까지의 거리
 */
type DragPending = { id: number; sx: number; sy: number; h: number[] | null; ox: number; oy: number; touchGrab?: boolean; touchStroke?: boolean };
/** 펫 창 프로세스가 보낸 메시지 */
type PetMsg = { type: string; [key: string]: any };
/** 사각 영역 (왼쪽·위·오른쪽·아래 경계). 펫 창 메시지·클릭 영역 형식이라 필드 이름 고정 */
type PetBox = { l: number; t: number; r: number; b: number };
import "./globals.d.ts";

/**
 * 캐릭터 생성: 테마·Live2D 모델·말풍선을 띄우고 작업 상태 감시와 배치 루프 시작
 * @returns 플러그인 화면이 쓰는 통로 { setPrefs, togglePet, toggleCanvas, canvasHidden }
 */
export function createCharacter({ base, life, pet = null, prefs: initialPrefs = {}, onSetting = null }: {
  base: string; life: Lifetime; pet?: PetBridge | null; prefs?: CharacterPrefs; onSetting?: ((key: string, value: unknown) => void) | null;
}): CharacterApi {
  const BASE = base;
  const prefs: CharacterPrefs = { ...initialPrefs };
  const hooks: { syncPageHidden?: () => void; togglePet?: () => void; toggleCanvas?: () => boolean; canvasHidden?: () => boolean } = {};   // 모델이 준비된 뒤 채워지는 동작 (펫 창·캔버스 토글, 패널 숨김 반영)
  let petUsed = false;   // 이 화면에서 바깥 펫 창을 쓴 적이 있는지 (내려갈 때 펫 창도 숨긴다)
  const previousDsc = window.__dsc;
  life.add(() => {
    if (window.__dsc !== previousDsc) { if (previousDsc === undefined) delete window.__dsc; else window.__dsc = previousDsc; }
    document.documentElement.classList.remove("dsc-hover", "dsc-grabbing");
    if (petUsed) { try { fetch(new URL("../pet/hide", new URL(BASE, location.href)).href, { method: "POST", keepalive: true }).catch(() => {}); } catch {} }
  });
  // 아래 코드가 쓰는 타이머·프레임·창 리스너·DOM 감시는 모두 life에 묶여 한 번에 정리된다
  const setTimeout = life.timeout, setInterval = life.interval, requestAnimationFrame = life.frame;
  /** life에 묶인 window 리스너 등록 (끌 때 함께 해제) */
  const addEventListener = (type: string, fn: (event: any) => void, options?: boolean | AddEventListenerOptions) => life.listen(window, type, fn, options);
  /** life에 묶인 DOM 감시 생성 (MutationObserver 대신 쓰는 생성자) */
  const MutationObserver = function (fn: MutationCallback) { return life.observe(fn); } as unknown as typeof window.MutationObserver;
  const TEXT = {
    hello: "안녕하세요, 주인님! 오늘은… 저랑 뭐 해 볼까요?",
    start: "알겠어요! …잘 부탁드려요, 주인님",
    approval: "확인이 필요해요! …이거, 저 대신 눌러 주실 거죠?",
    question: "여쭤볼 게 있어요! …잠깐만 저만 봐 주세요",
    done: "다 했어요! …칭찬해 주실 거죠?",
    error: "앗, 문제가 생겼어요… …한 번만 더 봐 주세요",
  };
  // DSH 화면에서 작업 상태를 읽는 부분(도구 이름·화면 문구·셀렉터)은 character/harness-signals.js

  /** 문서 본문(document.body)이 생긴 뒤 실행 */
  const ready = (fn: () => void) => (document.body ? fn() : addEventListener("DOMContentLoaded", fn, { once: true }));
  ready(() => {
    // ---------- 상태 감시 ----------
    let running = false, lastError = -1e9, lastToolSay = 0, waitingKind: "approval" | "question" | null = null;
    const listeners: { tool: ((text: string) => void) | null } = { tool: null };
    /** 새로 붙은 DOM 노드에서 오류 표시·도구 실행 신호 확인 */
    const scanAdded = (node: Node) => {
      const found = scanAddedNode(node, { running: running && !!listeners.tool });
      if (found.error) lastError = performance.now();
      if (found.tool) listeners.tool!(found.tool);   // running && listeners.tool일 때만 tool을 찾는다
    };
    if (!pet) new MutationObserver((records) => {
      for (const record of records) for (const n of record.addedNodes) scanAdded(n);
    }).observe(document.body, { childList: true, subtree: true });

    // ---------- Live2D ----------
    /**
     * 자산 폴더의 스크립트를 script 태그로 불러오기 (태그는 life가 정리)
     * @param src 자산 폴더(BASE) 기준 상대 경로
     */
    const load = (src: string) => new Promise((ok, fail) => {
      const script = life.own(document.createElement("script"), (node) => node.remove()); script.src = BASE + src; script.onload = ok;
      /** 불러오기 실패 시 경로를 담은 오류로 거부 */
      script.onerror = () => fail(new Error(src));
      document.head.appendChild(script);
    });
    (async () => {
      if (!window.Live2DCubismCore) await load("vendor/live2dcubismcore.min.js");
      if (!window.PIXI) await load("vendor/pixi.min.js");
      if (!window.PIXI.live2d) await load("vendor/cubism4.patched.js");
      if (life.stopped) return;   // 불러오는 사이 꺼졌으면 여기서 멈춤

      const W = 300, H = 300;
      const canvas = life.own(document.createElement("canvas"), (node) => node.remove()); canvas.id = "dsc-stage";
      const bubble = life.own(document.createElement("div"), (node) => node.remove()); bubble.id = "dsc-bubble";
      // 작업 상태(명령 실행 중 등)는 본 말풍선과 따로 띄운다. 혼잣말·대사가 상태 문구를 덮어쓰지 않아 둘이 동시에 보인다
      const bubbleStatus = life.own(document.createElement("div"), (node) => node.remove()); bubbleStatus.id = "dsc-bubble-status";
      document.body.append(canvas, bubble, bubbleStatus);
      /** 말풍선(본·상태) 표시를 함께 바꾼다 */
      const setBubbleDisplay = (value: string) => { bubble.style.display = bubbleStatus.style.display = value; };
      // 티커는 스스로 rAF를 돌지 않는다(autoStart: false). 배치 루프(raf)가 배치 바로 뒤에 같은 프레임에서 app.ticker.update로 갱신·그리기를 돌린다
      const app = new PIXI.Application({ view: canvas, width: W, height: H, sharedTicker: false, autoStart: false, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: (devicePixelRatio || 1) * 1.5 });   // 1.5배로 그려 줄여 보여 줌
      /**
       * PIXI 상호작용 매니저(InteractionManager)의 Ticker.system 구독 켜고 끄기
       * PIXI 상호작용은 쓰지 않음(autoInteract: false, 터치 판정은 hitAt). 이 구독은 app.ticker를 멈춰도 프레임마다 화면을 깨우므로 배치 루프가 쉬는 동안만 끔
       * (늘 꺼 두면 캐릭터가 보이는 동안 renderer 문맥 전환이 약 7% 늘어서 보이는 동안은 원래대로 둠, 실측)
       * @param on true면 구독 켬
       */
      const systemTicker = (on: boolean) => { try { app.renderer.plugins.interaction.useSystemTicker = on; } catch {} };
      life.add(() => app.destroy(true, { children: true }));   // 플러그인을 끄면 PIXI 앱·WebGL 자원 해제
      const model = await PIXI.live2d.Live2DModel.from(BASE + MODEL_FILES.model, { autoUpdate: false, autoInteract: false, idleMotionGroup: MODEL_FILES.idleMotionGroup });
      if (life.stopped) { model.destroy(); return; }
      app.stage.addChild(model);
      // 전용 티커로 모델도 갱신하고 긴 프레임은 제한
      app.ticker.add(() => model.update(Math.min(app.ticker.deltaMS, 100)), undefined, PIXI.UPDATE_PRIORITY.HIGH);
      const internalModel = model.internalModel, core = internalModel.coreModel;
      internalModel.eyeBlink = undefined; internalModel.breath = undefined;
      // ---- 모델 파라미터 통로: 애니메이션이 모델 파라미터를 읽고 쓰는 곳은 아래 함수들뿐 (ID는 model-profile.ts의 PARAMS) ----
      /**
       * 모델 파라미터 값 덮어쓰기
       * @param id 파라미터 ID (PARAMS 값, 표정·소품 정의의 ID)
       * @param value 쓸 값
       * @param weight 지금 값과 섞는 비율 (1이면 그대로 덮어씀)
       */
      const setParam = (id: string, value: number, weight = 1) => core.setParameterValueById(id, value, weight);
      /**
       * 모델 파라미터에 값 더하기
       * @param id 파라미터 ID (PARAMS 값, 표정·소품 정의의 ID)
       * @param value 더할 값
       * @param weight 더할 값에 곱하는 비율
       */
      const addParam = (id: string, value: number, weight = 1) => core.addParameterValueById(id, value, weight);
      /**
       * 모델 파라미터에 값 곱하기 (표정 파일의 Multiply 섞기)
       * @param id 파라미터 ID (표정 정의의 ID)
       * @param value 곱할 값
       * @param weight 곱하는 정도 (0이면 그대로, 1이면 value를 그대로 곱함)
       */
      const multiplyParam = (id: string, value: number, weight = 1) => core.multiplyParameterValueById(id, value, weight);
      /** 모델 파라미터의 id·최솟값·최댓값 (파라미터가 없거나 범위가 유한하지 않으면 null) */
      const paramRange = (id: string) => {
        const i = core.getParameterIndex(id);
        if (i < 0) return null;
        const min = core.getParameterMinimumValue(i), max = core.getParameterMaximumValue(i);
        return Number.isFinite(min) && Number.isFinite(max) ? { id, min, max } : null;
      };
      const dragLift = { x: 0, v: 0 };    // 위아래로 끌어올린 정도 (0~1)
      const dragShift = { x: 0, v: 0 };   // 좌우로 끌어당긴 정도 (-1~1)
      let chestFrom: { x: number; y: number; id: number; h: number[] } | null = null, chestDragging = false, chestTarget = 0, chestShiftTarget = 0;
      let chestLongTimer = 0;   // 3초 넘게 '흔들었을' 때 자극적인 대사로 넘어가는 감시 타이머
      const chestShake = { x: 0, y: 0, acc: 0, last: 0, next: 0 };   // acc = 흔든 양, last = 마지막으로 흔든 시각
      if (internalModel.physics) {
        const evaluate = internalModel.physics.evaluate;
        const chestParams = PARAMS.chestSwayVertical.map(paramRange).filter((found): found is { id: string; min: number; max: number } => !!found);     // 위아래
        const chestXParams = PARAMS.chestSwayHorizontal.map(paramRange).filter((found): found is { id: string; min: number; max: number } => !!found);   // 좌우
        /** 물리 계산 뒤 끌어올린·끌어당긴 정도만큼 가슴 파라미터에 더하기 */
        internalModel.physics.evaluate = function (this: unknown, ...args: unknown[]) {
          const result = evaluate.apply(this, args);
          // 물리가 덮어쓴 뒤 가슴에만 더함 (파라미터 범위를 꽉 쓰고, 좌우는 방향 따라)
          const lift = dragLift.x * CHEST_DRAG_SIGN, shift = dragShift.x * CHEST_DRAG_SIGN;
          if (lift) for (const chestParam of chestParams) addParam(chestParam.id, lift * (lift > 0 ? chestParam.max : -chestParam.min));
          if (shift) for (const chestParam of chestXParams) addParam(chestParam.id, shift * (shift > 0 ? chestParam.max : -chestParam.min) * 0.9);
          return result;
        };
      }

      // 창 안 캐릭터는 상반신(머리 ~ 허리)만 캔버스에 담고 아래는 잘린다.
      // 바깥 펫 창(PET)은 다리·신발까지 전신이 보이도록 모델 전체를 캔버스에 맞춘다.
      const WHOLE_BODY = !!pet;
      core.update();
      const cubismModel = core.getModel();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      /** 보이는(불투명도 0.01 이상) drawable의 모든 정점(모델 좌표) 순회 */
      const each = (fn: (x: number, y: number) => void) => {
        for (let i = 0; i < cubismModel.drawables.count; i++) {
          if (cubismModel.drawables.opacities[i] < 0.01) continue;
          const vertices = internalModel.getDrawableVertices(i);
          for (let j = 0; j < vertices.length; j += 2) fn(vertices[j], vertices[j + 1]);
        }
      };
      each((x: number, y: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
      const cutY = minY + (maxY - minY) * GEOMETRY.bustCut;
      let bustMinX = Infinity, bustMaxX = -Infinity;   // 상반신(cutY 위) 정점의 가로 범위 (모델 좌표)
      each((x: number, y: number) => { if (y < cutY) { bustMinX = Math.min(bustMinX, x); bustMaxX = Math.max(bustMaxX, x); } });
      // 창 안(상반신 크롭) 배율. 펫 창은 전신을 담아 이보다 작게 그려지므로, 이 값과의 비율만큼 배율을 올려 머리 크기를 맞춘다
      const bustScale = Math.min((W * 0.98) / (bustMaxX - bustMinX), (H * 0.95) / (cutY - minY));
      // 펫 창(전신) 배율과, 창 안↔펫 창의 머리 크기 비율 (붙을 때·넘길 때 같은 비율을 쓴다)
      const fullScale = Math.min((W * 0.98) / (maxX - minX), (H * 0.95) / (maxY - minY));
      const PET_HEAD_RATIO = bustScale / fullScale;
      // 펫 창 배율 범위. 상한은 '화면에 들어가는 만큼'뿐이고, 창 크기는 캐릭터에 맞춰 스스로 바뀐다 (pet/main.cjs 의 fit)
      const PET_K_MIN = 0.45, PET_BUBBLE = 150;
      const PET_K_MAX = Math.max(1.2, ((typeof screen !== "undefined" && screen.availHeight ? screen.availHeight : 1080) - PET_BUBBLE) / H);
      // 허리(잘린 단면) 기준 정렬용 값. 펫 창과 창 안은 배율이 달라 캔버스 안 허리 높이도 다르다
      const BUST_CX = (bustMinX + bustMaxX) / 2, FULL_CX = (minX + maxX) / 2;   // 모델 좌표에서 상반신·전신의 가로 중심
      const WAIST_PET = H * 0.05 + (cutY - minY) * fullScale;   // 펫 창 캔버스(k=1)에서 허리 y
      const WAIST_WIN = H * 0.05 + (cutY - minY) * bustScale;   // 창 안 캔버스(k=1)에서 허리 y
      const WAIST_PCT = WAIST_PET / H * 100;                // 하반신 페이드를 시작할 높이(%)
      // 펫 창(전신): 모델 전체의 가로·세로를 캔버스에 맞추고 몸 가운데를 캔버스 가운데에 둔다
      const bodyWidth = WHOLE_BODY ? maxX - minX : bustMaxX - bustMinX;   // 캔버스에 담을 몸의 가로 (모델 좌표)
      const modelScale = WHOLE_BODY ? fullScale : bustScale;
      // 화면상 크기는 모델 배율 × 캔버스 배율(k). HEAD_GAIN을 곱하면 펫 창의 머리 크기가 창 안과 같아진다
      const HEAD_GAIN = bustScale / modelScale;
      model.scale.set(modelScale);
      model.x = W / 2 - ((WHOLE_BODY ? minX : bustMinX) + bodyWidth / 2) * modelScale;
      model.y = H * 0.05 - minY * modelScale;
      // 꼬마 모습(체형 2)은 몸 전체가 작아져 공중에 뜨므로, 그만큼 내려서 발이 화면 바닥에 닿게 한다 (데스크톱 펫과 같음)
      setParam(PARAMS.bodyType, 1); core.update();
      let chibiMinY = Infinity, chibiMaxY = -Infinity, chibiMinX = Infinity, chibiMaxX = -Infinity;
      each((x: number, y: number) => { chibiMinY = Math.min(chibiMinY, y); chibiMaxY = Math.max(chibiMaxY, y); chibiMinX = Math.min(chibiMinX, x); chibiMaxX = Math.max(chibiMaxX, x); });
      setParam(PARAMS.bodyType, 0); core.update();
      const baseY = model.y;
      // 산책은 꼬마 모습으로 걷는다. 경계 계산·fade는 실제 걷는 몸 폭(꼬마 bbox, 캔버스 px)을 쓴다.
      const CHIBI_WIDTH = Number.isFinite(chibiMinX) && chibiMaxX > chibiMinX ? (chibiMaxX - chibiMinX) * modelScale : bodyWidth * modelScale;
      const WALK_BODY_WIDTH = Math.max(1, Math.min(bodyWidth * modelScale, CHIBI_WIDTH));
      const chibiDrop = Math.max(0, H * 0.99 - chibiMaxY * modelScale - baseY);   // 꼬마일 때 내리는 거리 (캔버스 px)
      const chibiHeadDrop = (chibiMinY - minY) * modelScale + chibiDrop;            // 꼬마일 때 머리 꼭대기가 내려가는 거리 (말풍선 위치용)
      // 말풍선 꼬리 기준 = 얼굴(코) 가운데. 상반신 bbox에서 얼굴 중심이 놓이는 가로 비율로 잡는다(GEOMETRY.noseOffset).
      const noseModelX = BUST_CX + (bustMaxX - bustMinX) * GEOMETRY.noseOffset;
      // ---------- Core 계산을 Worker로 (결과는 1프레임 늦게 반영) ----------
      // 정점 변형(Core update)은 Worker의 같은 모델이 맡고, 메인은 받은 결과를 Core 배열에 복사만 한다.
      // 렌더러·터치 판정은 그대로 Core 배열을 읽는다. Worker를 못 쓰거나 실패하면 원래대로 메인에서 계산.
      (() => {
        const drawables = cubismModel.drawables, drawableCount = drawables.count;
        /** 원래 Core update를 메인에서 실행 (Worker를 못 쓸 때) */
        const localUpdate = () => Object.getPrototypeOf(cubismModel).update.call(cubismModel);
        let w;
        try { w = new Worker(BASE + "dsc-core-worker.js"); } catch { return; }
        life.add(() => { try { w.terminate(); } catch {} });   // Worker는 PIXI 앱과 수명이 달라 따로 정리
        let lo = Infinity, hi = 0;
        for (let i = 0; i < drawableCount; i++) { const positions = drawables.vertexPositions[i]; lo = Math.min(lo, positions.byteOffset); hi = Math.max(hi, positions.byteOffset + positions.byteLength); }
        const offsets = Array.from(drawables.vertexPositions as Float32Array[], (positions) => positions.byteOffset - lo).join();
        const vertexBytes = new Uint8Array(drawables.vertexPositions[0].buffer, lo, hi - lo);
        let ready = false, busy = false, result: ArrayBuffer | null = null, spare: ArrayBuffer | null = null;
        /** Worker 사용 중단: 메인 계산으로 되돌리고 Worker 종료 */
        const stop = () => { ready = false; delete cubismModel.update; try { w.terminate(); } catch {} };
        /**
         * Worker가 계산한 결과를 Core 배열에 복사
         * @param buf 정점·불투명도·그리기 순서·렌더 순서·곱 색·스크린 색·동적 플래그를 이어 붙인 버퍼
         */
        const apply = (buf: ArrayBuffer) => {
          const bytes = new Uint8Array(buf); let offset = 0;
          vertexBytes.set(bytes.subarray(0, vertexBytes.length)); offset += vertexBytes.length;
          drawables.opacities.set(new Float32Array(buf, offset, drawableCount)); offset += drawableCount * 4;
          drawables.drawOrders.set(new Int32Array(buf, offset, drawableCount)); offset += drawableCount * 4;
          drawables.renderOrders.set(new Int32Array(buf, offset, drawableCount)); offset += drawableCount * 4;
          drawables.multiplyColors.set(new Float32Array(buf, offset, drawableCount * 4)); offset += drawableCount * 16;
          drawables.screenColors.set(new Float32Array(buf, offset, drawableCount * 4)); offset += drawableCount * 16;
          drawables.dynamicFlags.set(bytes.subarray(offset, offset + drawableCount));
        };
        /** Worker 오류 시 메인 계산으로 전환 (디버그 로그에 사유 기록) */
        w.onerror = (event) => { log.debug("Core Worker 오류, 메인 계산으로 전환:", event.message); stop(); };
        /** Worker 메시지 처리: 준비 확인(ready)·계산 결과(frame)·실패(fail) */
        w.onmessage = (e) => {
          const message = e.data;
          if (message.type === "ready") {   // 같은 모델인지(개수·정점 배치) 확인한 뒤에만 넘김
            if (message.count === drawableCount && message.params === cubismModel.parameters.count && message.parts === cubismModel.parts.count && message.offs.join() === offsets) ready = true; else { log.debug("Core Worker 모델 불일치, 메인 계산으로 전환"); stop(); }
          } else if (message.type === "frame") { result = message.buf; busy = false; }
          else if (message.type === "fail") { log.debug("Core Worker 실패, 메인 계산으로 전환:", message.message ?? "(사유 없음)"); stop(); }
        };
        /** Core update 대체: 지난 결과를 반영하고 이번 파라미터를 Worker로 보냄 (결과는 1프레임 늦게 반영) */
        cubismModel.update = () => {
          if (!ready) return localUpdate();
          if (result) { apply(result); spare = result; result = null; }
          if (!busy) {   // 이전 결과가 오기 전엔 새로 보내지 않음 (밀리지 않게)
            const paramCount = cubismModel.parameters.count, inputs = new Float32Array(paramCount + cubismModel.parts.count);
            inputs.set(cubismModel.parameters.values); inputs.set(cubismModel.parts.opacities, paramCount);
            const transfer = [inputs.buffer]; if (spare) transfer.push(spare);
            w.postMessage({ type: "frame", inp: inputs.buffer, out: spare }, transfer);
            spare = null; busy = true;
          }
        };
        w.postMessage({ type: "init", url: BASE + MODEL_FILES.moc });
      })();

      // 표정
      const expressionParams: Record<string, Array<{ Id: string; Value: number; Blend?: string }>> = {};
      await Promise.all(Object.entries(EXPRESSION_FILES).map(async ([expName, file]) => {
        try { expressionParams[expName] = (await (await fetch(BASE + file)).json()).Parameters || []; } catch (error) { log.debug("표정 파일 로드 실패:", expName, error); expressionParams[expName] = []; }
      }));
      if (life.stopped) return;   // 표정 파일을 받는 사이 꺼졌으면 여기서 멈춤
      const weight: Record<string, number> = {}, hold: Record<string, boolean> = {}, until: Record<string, number> = {};
      // 소품·옷: [설정 이름, 모델 파라미터, 켰을 때 값] (데스크톱 펫의 표정 파일과 같은 값)
      // 항목 정의는 shared/settings.js: [설정 이름, 모델 파라미터, 켰을 때 값], 켤 때 대사 묶음, 체형 = PARAMS.bodyType 값
      const OUTFIT_PARAMS = OUTFIT_ITEMS.filter((item) => item.param).map((item) => [item.key, item.param, item.on] as [string, string, number]);
      const OUTFIT_LINE = Object.fromEntries(OUTFIT_ITEMS.filter((item) => item.line).map((item) => [item.key, item.line])) as Record<string, string>;
      const BODY_VALUE = Object.fromEntries(BODY_TYPES.map((body) => [body.key, body.value]));
      const outfitWeight: Record<string, number> = {};
      for (const [key] of OUTFIT_PARAMS) outfitWeight[key] = (prefs.outfit || {})[key] ? 1 : 0;   // 처음엔 저장된 모습 그대로 (서서히 나타나지 않게)
      // 동물귀(#22): 파라미터가 아니라 모델의 별도 파트(PARTS.animalEars)다. 파트 ID로 런타임 인덱스를 찾고,
      // 파트가 없으면(다른 모델) 조용히 아무 것도 하지 않는다. 실제 적용은 bbox 계산이 끝난 뒤 프레임에서만 한다.
      const EAR_PART_ID = PARTS.animalEars;
      /**
       * 파트 ID의 런타임 인덱스
       * @returns 파트 목록에서 찾은 위치, 없으면 -1
       */
      const earPartIndexFor = (ids: ArrayLike<string> | null | undefined, id: string) => {
        if (!ids) return -1;
        const found = Array.from(ids).indexOf(id);
        return found >= 0 ? found : -1;
      };
      const earPartIndex = earPartIndexFor(cubismModel.parts && cubismModel.parts.ids, EAR_PART_ID);
      const earDrawables = [];
      if (earPartIndex >= 0) for (let i = 0; i < cubismModel.drawables.count; i++) if (cubismModel.drawables.parentPartIndices[i] === earPartIndex) earDrawables.push(i);
      const earSet = new Set(earDrawables);
      /**
       * drawable이 보이는지 여부 (불투명도 0.05 이상이고 보임 플래그가 켜짐)
       * @param flags drawable의 동적 플래그 (1번 비트 = 보임)
       */
      const earVisible = (opacity: number, flags: number) => opacity >= 0.05 && (flags & 1) !== 0;
      const earBaseVisible = new Map(earDrawables.map((i) => [i, earVisible(cubismModel.drawables.opacities[i], cubismModel.drawables.dynamicFlags[i])]));
      /**
       * 귀 숨김 정도에 맞춘 귀 파트 불투명도
       * @param w 귀 숨김 정도 (0~1, 1이면 완전히 숨김)
       */
      const earOpacityValue = (w: number) => Math.max(0, Math.min(1, 1 - w));
      /**
       * 귀 숨김 정도를 목표 쪽으로 한 프레임만큼 옮긴 값
       * @param w 지금 귀 숨김 정도 (0~1)
       * @param on true면 숨기는 쪽(1), false면 보이는 쪽(0)으로
       * @param dt 지난 프레임부터의 시간(초)
       */
      const earOpacityStep = (w: number, on: boolean, dt: number) => Math.min(1, Math.max(0, w + ((on ? 1 : 0) - w) * Math.min(1, dt * 6)));
      /**
       * 귀 파트 불투명도를 숨김 정도에 맞춰 설정
       * @param w 귀 숨김 정도 (0~1)
       * @returns 설정했으면 true (파트 배열이 없거나 인덱스가 없으면 false)
       */
      const applyEarOpacity = (parts: { opacities: Float32Array } | null | undefined, index: number, w: number) => {
        if (!parts || !parts.opacities || index < 0) return false;
        parts.opacities[index] = earOpacityValue(w);
        return true;
      };
      let earWeight = (prefs.outfit || {}).earHide ? 1 : 0;   // 처음엔 저장된 상태 그대로 (로드 직후 깜빡이지 않게)
      /**
       * 터치 판정용 drawable 보임 여부. 귀 drawable은 earHide로 감쇠되기 전의 가시성을 hit 판정에만 유지(이슈 #22: 터치 영역 불변)
       * earHide가 꺼져 있으면 평소처럼 현재 opacity/플래그로 판정하므로, 다른 원인으로 숨겨진 메시는 클릭 불가
       * @param i drawable 번호
       */
      const earHitVisible = (i: number) => earWeight > 0.005
        ? earBaseVisible.get(i) === true
        : earVisible(cubismModel.drawables.opacities[i], cubismModel.drawables.dynamicFlags[i]);
      let basinUntil = 0, basinWeight = 0;   // 세숫대야 (머리를 천천히 쓸어내리면)
      let bodyWeight = BODY_VALUE[(prefs.outfit || {}).bodyType] || 0, outfitPrev: Record<string, any> | null = null, outfitTalk: ((key: string) => void) | null = null;
      // ---------- 바깥 펫 창 ----------
      // PET: 이 코드가 바깥 펫 창 안에서 도는 중 (preload가 window.dscPet을 넣어 줌). 좌표 = 화면 px, 창이 캐릭터를 따라 움직임.
      // link: 창 안 캐릭터 쪽에서 펫 창이 열려 있으면 캐릭터를 숨기고, 반응(말·몸짓·표정)을 플러그인 호스트를 거쳐 펫 창으로 보냄.
      const PET = pet;
      const PET_URL = PET ? null : (() => { try { return new URL("../pet/", new URL(BASE, location.href)).href; } catch { return null; } })();
      // 연결 상태·송수신·알림 처리·주기·토글 규칙은 character/pet-link.js. 캐릭터 쪽 동작은 아래 "바깥 펫 창 연결" 구간에서 정의한다
      // (연결이 이 콜백들을 실제로 부르는 것은 모두 정의된 뒤다)
      const link = createPetLink({
        url: PET_URL,
        /** 전역 fetch 호출 (window에 묶인 채로 부르도록 감쌈) */
        fetch: (...args) => fetch(...args),
        setTimeout, setInterval, requestAnimationFrame,
        /** 펫 창 사용 기록 (플러그인이 내려갈 때 펫 창을 숨길지 판단) */
        onUse: () => { petUsed = true; },
        /** 펫 창 메뉴에서 바꾼 설정을 플러그인 설정에 저장하도록 전달 */
        onConfig: (key, value) => onSetting?.(key, value),
        /** 펫 창 메뉴 "대화하기…": 창 안으로 돌아온 뒤 대화 입력을 연다 */
        onChat: () => chat.openSoon(),
        /** 펫 창이 열려 창 안 캐릭터가 물러날 때 */
        onEnter: () => petLinkEnter(),
        /** 펫 창이 닫혀 창 안 캐릭터가 돌아올 때 */
        onLeave: () => petLinkLeave(),
        /** 펫 창에 넘길 지금 상태 */
        snapshot: () => petLinkSnapshot(),
        /** 끌어서 넘기는 동안 펫 창에 보낼 메시지 */
        dragMessages: () => petLinkDragMessages(),
        /** 펫 창이 붙을 자리 */
        dockState: () => petLinkDock(),
        /** 지금 끌기 상태의 비교용 키 */
        dragKey: () => dragKeyRaw(),
        /** 외부 음성 상태 */
        voice: () => voiceState,
        /** 시작 연출이 끝났고 작업 중이 아니며 화면이 보이는 상태 여부 */
        idle: () => intro.phase === "done" && !running && !document.hidden,
        /** 캔버스만 숨김 상태 여부 */
        hidden: () => hidden,
        /** 펫 창을 열 때 쓸 화면 좌표 자리 */
        openPose: () => petOpenScreenPose(),
      });
      const relay = link.relay;   // 펫 창이 보이는 동안(따라오는 중 포함)만 반응을 모아 보냄
      const EYE_EXP = EYE_SWAP_EXPRESSIONS;   // 눈 그림을 바꾸는 표정 (model-profile.ts)
      /** 눈 표정(EYE_EXP)을 켤 때 나머지 눈 표정 끄기 */
      const clearOtherEyes = (name: string) => { if (EYE_EXP.includes(name)) for (const e of EYE_EXP) if (e !== name) { until[e] = 0; hold[e] = false; } };
      /**
       * 표정 유지 켜고 끄기 (펫 창에도 전달)
       * @param on true면 켜 둠, false면 끔
       */
      const setExp = (name: string, on: boolean) => { relay("setExp", [name, on]); if (on) clearOtherEyes(name); hold[name] = on; };
      /**
       * 표정을 잠깐 켜기 (펫 창에도 전달)
       * @param ms 켜 둘 시간
       */
      const flashExp = (name: string, ms: number) => { relay("flashExp", [name, ms]); clearOtherEyes(name); until[name] = performance.now() + ms; };

      // 버튜버식 몸짓: 한 번씩 재생하는 동작(gesture) + 지금 상태에 따른 자세(mood)
      const gestureState: { name: string | null; start: number; dur: number; dir: number } = { name: null, start: 0, dur: 0, dir: 1 };
      // 왼손으로 가슴 가리기 (데스크톱 펫의 "가슴에 손" 값): Param59 위팔 원근, Param60 아래팔, Param61 손목, Param62 위팔, Movement2 = 몸 앞용 팔 그림
      const cover = { until: 0, start: -1e9, q: 0 };   // q: 0 = 팔 내림, 1 = 가슴을 가림
      /**
       * 왼손으로 가슴 가리기 시작·연장
       * @param ms 지금부터 가리고 있을 시간
       */
      const coverChest = (ms: number) => { const now = performance.now(); if (now >= cover.until) cover.start = now; cover.until = Math.max(cover.until, now + ms); };
      /**
       * 몸짓 한 번 재생 (펫 창에도 전달, 방향은 무작위, 튕김이 있는 몸짓은 몸도 튕김)
       * @param dur 몸짓 길이(ms)
       */
      const play = (name: string, dur: number) => { relay("play", [name, dur]); gestureState.name = name; gestureState.start = performance.now(); gestureState.dur = dur; gestureState.dir = Math.random() < 0.5 ? -1 : 1; if (BOB_KICK[name]) bobKick(BOB_KICK[name]); };
      const BOB_KICK: Record<string, number> = { bounce: 60, laugh: 50, nod: -45 };   // 몸짓 시작 때 몸 튕김 세기
      let mood = "idle", moodUntil = 0, nextIdleGesture = performance.now() + 6000;
      /**
       * 상태에 따른 자세(mood) 설정 (펫 창에도 전달)
       * @param ms 유지 시간 (0이면 계속)
       */
      const setMood = (moodName: string, ms = 0) => { relay("setMood", [moodName, ms]); mood = moodName; moodUntil = ms ? performance.now() + ms : 0; };
      const pose: Record<"lean" | "headZ" | "headY" | "bodyY" | "swayAmp", number> = { lean: 0, headZ: 0, headY: 0, bodyY: 0, swayAmp: 0 };   // 부드럽게 따라가는 자세 값
      let shiverStarted = -1e9, touchLeanUntil = 0, touchLean = 0;
      let shiverBobAt = 0, shiverBobSign = 1;
      let happyMouthUntil = 0, happyMouth = 0;   // 가슴 터치 2번째부터 "헤~" 입   // 떨릴 때 가슴을 출렁이게 하는 위아래 툭툭
      // 머리를 계속 만지면 삐짐: 턱을 들고 고개를 홱 돌림. 삐진 동안 몇 번 사용자를 몰래 보다가 빠르게 다시 외면
      let stareUntil = 0, stareWeight = 0;   // 정면을 똑바로 보는 동안 (삐짐이 풀리며 한마디)
      let sulkStart = -1e9, sulkUntil = 0, sulkDir = 1, sulkPeeks: { at: number; flip: boolean; done?: boolean }[] = [], sulkYaw = 0, sulkRoll = 0;
      const SULK_CHIN = 10;                                        // 턱을 드는 정도 (AngleY, 위가 +)
      const PEEK_RISE = 550, PEEK_HOLD = 450, PEEK_SNAP = 150;     // 몰래 보기: 천천히 돌아봄 → 잠깐 봄 → 홱 외면 (ms)

      // 위치: 오른쪽 아래 구석, 입력창을 가리지 않는 가장 큰 크기
      const visW = bodyWidth * modelScale, visH = H * 0.95;
      // 모바일(터치 전용) 화면에서 캐릭터를 숨기는 설정과, 브라우저 시각 뷰포트(주소창·키보드) 보정
      // 캐릭터가 매 프레임 읽으므로 MediaQueryList는 한 번만 만들고 값(matches)만 새로 읽는다.
      let coarseMql: MediaQueryList | null = null;
      /** 터치 전용 화면(hover 없음·굵은 포인터) 여부 */
      const coarsePointer = () => {
        if (typeof matchMedia !== "function") return false;
        if (!coarseMql) coarseMql = matchMedia("(hover: none) and (pointer: coarse)");
        return coarseMql.matches;
      };
      /** 설정에서 모바일 표시를 끈 상태로 터치 전용 화면에 있는지 */
      const mobileHidden = () => !!prefs.mobile && prefs.mobile.enabled === false && coarsePointer();
      /**
       * 모바일 키보드가 열린 상태 여부. 입력 중이면 캐릭터·말풍선을 잠시 숨김 — 입력창과 대화를 가리지 않고, 키보드가 화면을 밀 때 따라 올라가지도 않게
       * 주의: DSH 컴포저는 마운트 직후 포커스만 잡고 키보드를 열지 않을 수 있음. 포커스만으로 숨기면
       * 모바일에서 캐릭터가 항상 사라지므로, 실제 visualViewport 축소/pan 신호가 있을 때만 숨김
       */
      const keyboardOpen = () => {
        const visualVp = typeof visualViewport !== "undefined" && visualViewport ? visualViewport : null;
        if (!visualVp || visualVp.scale !== 1) return false;
        // 크롬 안드로이드: 키보드가 비주얼 뷰포트를 줄이거나 화면을 위로 pan 한다 (innerHeight 는 그대로인 경우가 많다)
        return (innerHeight - visualVp.height) > 120 || visualVp.offsetTop > 4;
      };
      /** 터치 화면에서 키보드를 열고 입력 중인지 */
      const typingActive = () => coarsePointer() && keyboardOpen();
      /** 브라우저 시각 뷰포트 영역 (없으면 창 크기) */
      const viewport = () => {
        const visualVp = typeof visualViewport !== "undefined" && visualViewport ? visualViewport : null;
        return visualVp ? { w: visualVp.width, h: visualVp.height, top: visualVp.offsetTop, left: visualVp.offsetLeft } : { w: innerWidth, h: innerHeight, top: 0, left: 0 };
      };
      /** 배치에 쓸 뷰포트. 모바일에서만 시각 뷰포트(주소창·키보드) 사용, 데스크톱은 예전처럼 창 크기 */
      const layoutViewport = () => coarsePointer() ? viewport() : { w: innerWidth, h: innerHeight, top: 0, left: 0 };
      // 제자리·말풍선 위치 계산은 character/layout.js
      let curK = 1, fleeX = 0;     // 현재 배율, 도망·산책으로 옆으로 비켜난 거리(px, + 오른쪽 · - 왼쪽)
      // 자유 위치: 끌어서 옮긴 자리 (창 안 = 창 좌표, 펫 창 = 화면 좌표). 제자리 근처에 놓으면 다시 붙음.
      const free: { on: boolean; x: number; y: number; k: number; anim: any; mode: string | null; applied: boolean; fx?: number; fy?: number } = { on: false, x: 0, y: 0, k: 1, anim: null, mode: null, applied: true };
      const drag: { pending: any; on: boolean; x: number; y: number; samples: number[][]; touch?: boolean } = { pending: null, on: false, x: 0, y: 0, samples: [] };
      let chord: Chord = { at: null, button: null, valid: false };   // 좌우 버튼 코드(첫 버튼 누른 시각) — 150ms grace 판정용
      let rightPress: { at: number; hit: boolean; id: number | undefined } | null = null;   // 마우스 오른쪽 첫 버튼 { at, hit, id } — pointerdown/pointermove/mousedown 공용
      let mouseButtons = 0;    // 마지막 포인터 이벤트의 buttons&3 (두 번째 버튼 합류 감지)
      const carry = { vx: 0, vy: 0 };              // 끄는 속도(px/초) → 몸이 관성으로 쏠리고 머리카락·치마가 흔들림
      const shown = { k: 1, x: 0, y: 0 };          // 지난 프레임에 그린 자리 (끌기 시작점)
      // 펫 창: 현재 표시장치의 Electron DIP workArea (pet/main.cjs가 screen.getDisplayNearestPoint로 회신).
      // DOM screen.avail*는 배율이 다른 모니터에서 창 좌표와 어긋날 수 있어, 산책은 출발할 때 이 값을 고정해 쓴다.
      // request = 마지막으로 보낸 요청 번호, answered = 응답받은 가장 큰 요청 번호, at = 마지막 응답 시각, displays = 전체 표시장치 목록
      const petDisplay: { id: string; area: WalkArea | null; scaleFactor: number; request: number; answered: number; at: number; displays: WalkDisplay[] | null } =
        { id: "", area: null, scaleFactor: 0, request: 0, answered: 0, at: 0, displays: null };
      let petBounds: { x: number; y: number; width: number; height: number; at: number } | null = null;   // pet/main.cjs가 알려 준 실제 native 창 위치 (clip은 요청 pose가 아니라 이 값 기준)
      /**
       * 펫 창 메인 프로세스에 현재 표시장치 정보 요청 (응답은 display 메시지)
       * @param at 기준 점 (화면 DIP). 없으면 지난 프레임에 그린 몸 가운데
       * @returns 요청 번호 (펫 창이 아니면 undefined)
       */
      const requestPetDisplay = (at?: { x: number; y: number }) => {
        if (!PET) return;
        const id = ++petDisplay.request;
        const point = displayPoint(at);
        try { PET.send({ type: "display", request: id, point }); } catch (error) { log.debug("펫 표시장치 요청 실패:", error); }
        return id;
      };
      /**
       * 표시장치 요청 기준 점 (화면 DIP)
       * @param at 넘겨받은 점. 좌표가 유한하지 않으면 지난 프레임에 그린 몸 가운데
       * @returns 기준 점, 그린 자리도 모르면 undefined (메인 프로세스가 창 bounds로 찾음)
       */
      const displayPoint = (at?: { x: number; y: number }) => {
        if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) return at;
        if (!Number.isFinite(shown.x) || !Number.isFinite(shown.y)) return undefined;
        const k = Number.isFinite(curK) && curK > 0 ? curK : 1;
        return { x: shown.x + W * k / 2, y: shown.y + H * k * 0.5 };
      };
      let touchHold = 0;   // 터치에서 길게 눌러 집기 모드로 들어가는 타이머 (오른쪽 버튼이 없는 화면용)
      let petDock: PetDock | null = null, petDocked = false, snapProgress = 0;   // 펫 창: 붙을 자리(DSH 창의 제자리, 화면 좌표), 붙은 뒤, 붙는 진행도
      // 바깥 펫 창 전용: 우클릭 메뉴 상태 ↔ 설정 패널 ↔ 크기. 크기는 '기본(머리 크기 맞춤) 대비 배율'로,
      // 펫 창 프로필(localStorage)에 남겨 다시 켜도 기억한다.
      const PET_SIZE_KEY = "dsc-pet-size";
      let petPanel: HTMLElement | null = null, petPanelOpen = false, petPanelWin = { w: 0, h: 0 };
      let petBaseK = 1, petPendingRatio: number | null = null, petSizeTimer = 0, petMenuSig = "";
      // 자유 위치는 입력 모드별로 따로 기억한다. 같은 브라우저에서 터치 모드와 데스크톱 모드가
      // 서로의 자리를 덮어쓰지 않게 하기 위해서다.
      const FREE_KEY = "dsc-free-pos";
      const FREE_KEY_MOBILE = "dsc-free-pos-mobile";
      /** 지금 입력 모드 ("mobile" | "desktop") */
      const freeMode = () => coarsePointer() ? "mobile" : "desktop";
      /** 입력 모드별 자유 위치 저장 키 (localStorage) */
      const freeStorageKey = (mode: string) => mode === "mobile" ? FREE_KEY_MOBILE : FREE_KEY;
      /**
       * 창 안 자유 위치를 창 크기 비율로 기록: 몸 가운데의 가로 비율(fx)·그림 아래 끝의 세로 비율(fy)
       * 창 크기가 바뀌면 같은 비율 자리로 옮겨 가서, 최대화를 풀어도 옛 픽셀 자리에 남아 화면 밖으로 밀리지 않음
       */
      const freeToRatio = () => { free.fx = (free.x + W * free.k / 2) / innerWidth; free.fy = (free.y + H * free.k) / innerHeight; };
      if (!PET) try {
        const mode = freeMode();
        const saved = JSON.parse(localStorage.getItem(freeStorageKey(mode)) || "null");
        // 예전 단일 키는 데스크톱 자리로 복원한다. 모바일은 새 키만 읽어 서로 덮어쓰지 않는다.
        if (saved && isFinite(saved.fx) && isFinite(saved.fy) && saved.k > 0 && (!saved.mode || saved.mode === mode)) {
          Object.assign(free, { on: true, fx: saved.fx, fy: saved.fy, k: saved.k, mode, applied: true });
        }
      } catch {}
      /**
       * 자유 위치를 입력 모드별 키로 localStorage에 저장 (자유 위치가 아니면 지움)
       * @param fromPose true면 지금 x·y에서 비율을 다시 계산 (휠처럼 크기만 바꿀 땐 false로 비율을 그대로 둠)
       */
      const saveFree = (fromPose = true) => {
        if (PET || free.applied === false) return;   // 다른 입력 모드에서 보류한 자리는 그 모드의 저장 키를 건드리지 않는다
        if (free.on && fromPose) freeToRatio();
        try {
          const mode = free.mode || freeMode();
          const key = freeStorageKey(mode);
          if (free.on) localStorage.setItem(key, JSON.stringify({ mode, fx: +free.fx!.toFixed(4), fy: +free.fy!.toFixed(4), k: +free.k.toFixed(3) }));
          else localStorage.removeItem(key);
        } catch {}
      };
      // 산책: 가끔 가까운 쪽 화면 밖으로 걸어 나갔다가 잠시 뒤 같은 쪽에서 걸어 들어옴 (phase: "" | ready | out | away | in | recover, dir: -1 왼쪽 · 1 오른쪽)
      // 바깥 펫 창 전용: plan = 출발 계획, area = 출발 때 고정한 workArea, base = 출발 때 고정한 제자리, displayId·displayRequest = 출발 표시장치와 그 요청 번호,
      // alpha·opacityApplied = 경계 fade 불투명도와 적용 여부, returnFade = 복귀 fade 구간, recoverTimer·recover = 표시장치 변경 복구 대기 타이머와 목표 창 자리,
      // safeHold = 복구 뒤 안전 영역 clip 유지 중, faceDir = 복귀 때 바라볼 실제 이동 방향
      const walk: {
        phase: string; face: number; dir: number; out: number; timers: number[]; slideId: number; lastTouch: number; next: number;
        plan: WalkPlan | null; area: WalkArea | null; base: Pose | null; displayId: string; displayRequest: number; alpha: number; opacityApplied: boolean;
        returnFade: number; recoverTimer: number; safeHold: boolean; faceDir: number | null; recover: { x: number; y: number; width: number; height: number } | null;
      } = { phase: "", face: 0, dir: -1, out: 0, timers: [], slideId: 0, lastTouch: 0, next: performance.now() + (180 + Math.random() * 180) * 1000,
        plan: null, area: null, base: null, displayId: "", displayRequest: 0, alpha: 1, opacityApplied: false, returnFade: 0, recoverTimer: 0, safeHold: false, faceDir: null, recover: null };
      let walkCheck: ((now: number) => void) | null = null;
      // 시작 연출: 처음엔 화면 가운데에 크게 인사 → 본 화면이 뜨면 오른쪽 아래 제자리로 이동
      const DPR = (devicePixelRatio || 1) * 1.5;   // 1.5배로 그려 줄여 보여 줌 (윤곽선 매끄럽게)
      const intro: { phase: string; start: number; moveStart: number; from: any; kc: number; skip?: boolean; begun?: boolean; cardAt?: number } = { phase: "center", start: performance.now(), moveStart: 0, from: null, kc: 1 };
      const veil = life.own(document.createElement("div"), (node) => node.remove());
      veil.style.cssText = "position:fixed;inset:0;z-index:29;background:radial-gradient(circle at 50% 55%,var(--dsc-veil1,#ffffffd9),var(--dsc-veil2,#eef0ffcc) 70%);backdrop-filter:blur(8px);opacity:0;transition:none;cursor:pointer";
      document.body.append(veil);
      veil.addEventListener("pointerdown", () => { if (intro.phase === "center") intro.skip = true; });
      /**
       * 배율에 맞춘 렌더 해상도 설정. 크기를 다시 정하면 WebGL 버퍼가 지워지므로 해상도가 실제로 바뀔 때만 다시 정함
       * 지워진 버퍼는 같은 프레임의 그리기가 채움(raf)
       */
      const setRes = (k: number) => { const res = DPR * Math.max(1, k); if (app.renderer.resolution === res) return; app.renderer.resolution = res; app.renderer.resize(W, H); };
      /**
       * 부드러운 가감속 곡선 (smoothstep, 0~1 밖은 잘라 냄)
       * @param progress 진행도 (0~1)
       */
      const ease = (progress: number) => (progress < 0 ? 0 : progress > 1 ? 1 : progress * progress * (3 - 2 * progress));
      /**
       * 입력 카드 요소 찾기. 입력 카드 표시(dsc-composer)는 다음 프레임에 붙으므로, 세션 전환으로 카드가 새로 생긴 프레임에는 같은 조건으로 직접 찾음
       * (못 찾으면 최대 크기로 한 프레임 커졌다가 돌아옴)
       */
      const findCard = () => document.querySelector(".dsc-composer") ||
        [...document.querySelectorAll('[class*="_card"]')].find((e) => e.closest('[class*="_root"]') && e.querySelector('[class*="_input"]'));
      /**
       * 입력 카드의 화면 사각형. 질문·승인 카드가 입력창 자리를 대신하면 입력 카드는 숨겨져 크기가 0이 되므로, 같은 자리에 뜬 카드로 잼
       * @returns 크기가 있는 사각형, 없으면 null
       */
      const cardRect = (card: Element) => {
        const rect = card.getBoundingClientRect();
        if (rect.width) return rect;
        const seat = card.closest('[class*="composerSeat"]');
        for (const alt of seat ? seat.querySelectorAll('[class*="_card"]') : []) {
          if (alt === card) continue;   // 표시가 붙기 전 프레임에도 자기 자신은 건너뜀
          const altRect = alt.getBoundingClientRect();
          if (altRect.width) return altRect;
        }
        return null;
      };
      /** 오른쪽 아래 제자리 (원래 배치): 입력창을 가리지 않는 가장 큰 크기와 자리 */
      const homePose = () => {
        const card = findCard();
        // 창 여유 공간에 맞춰 커진다. 상한은 창 높이의 92%와, 펫 창이 그대로 따라갈 수 있는 배율(PET_K_MAX / PET_HEAD_RATIO) 중 작은 쪽
        //  (펫 창이 따라가지 못하는 크기로 키우면 창 밖으로 나갈 때 크기가 튀므로 그 선을 넘지 않게 한다)
        const viewArea = layoutViewport();
        const maxK = Math.min(PET_K_MAX / PET_HEAD_RATIO, (viewArea.h * 0.92) / visH);
        const cardBox = card ? cardRect(card) : null;
        // 컴포저 오른쪽·아래 여유가 부족한 좁은 화면(모바일 세로 등)이면 컴포저 위로 올린다 (입력창·전송 버튼을 가리지 않게)
        const pose = homeLayout({ vp: viewArea, r: cardBox, maxK, W, visW, H, visH, minK: SHOW_K, allowAbove: coarsePointer() });
        return { k: pose.k, x: pose.x + fleeX, y: pose.y, card, r: cardBox, above: pose.above, noSafe: !!pose.noSafe, vp: viewArea };
      };
      /** 시작 연출의 가운데 자리 */
      const centerPose = () => {
        // 가운데 아래에 붙여 상반신이 화면 아래에서 올라온 모습 (잘린 선이 화면 중간에 뜨지 않게)
        const viewArea = layoutViewport();
        const k = Math.min(viewArea.h * 0.74 / visH, viewArea.w * 0.55 / visW, 3.2);
        return { k, x: viewArea.left + viewArea.w / 2 - W * k / 2, y: viewArea.top + viewArea.h - H * k };
      };
      // 설정에서 '시작할 때 등장 연출'을 끄면 가운데 인사 없이 처음부터 제자리에 뜬다
      const introOff = !!prefs.intro && prefs.intro.enabled === false;
      if (!introOff) { intro.kc = centerPose().k; setRes(intro.kc); }
      /** 시작 연출 건너뛰기: 펫 창이거나 이미 펫 창이 떠 있으면 시작 연출 없이 바로 제자리 */
      const skipIntro = () => {
        if (intro.phase === "done") return;
        intro.phase = "done"; setRes(1); veil.remove(); canvas.style.opacity = "";
        bubble.style.left = ""; bubble.style.fontSize = ""; bubble.style.padding = "";   // 시작 연출용 큰 말풍선 스타일 해제
      };
      if (PET || introOff) skipIntro();

      // ---------- 자유 위치 계산 ----------
      /**
       * 캔버스 왼쪽 위(x, y)·배율 k일 때 보이는 몸 영역 (양옆 빈 곳·머리 위 여백 제외). 커서가 몸 위인지 판정할 때 씀
       * @param x 캔버스 왼쪽 (창 좌표)
       * @param y 캔버스 위 (창 좌표)
       */
      const bodyRect = (x: number, y: number, k: number) => { const side = (W - visW) / 2 * k; return { l: x + side, t: y + H * 0.05 * k, r: x + W * k - side, b: y + H * k }; };
      /**
       * 끝에서 느려지는 곡선 (cubic ease-out)
       * @param progress 진행도 (0~1)
       */
      const easeOut = (progress: number) => 1 - Math.pow(1 - progress, 3);
      /**
       * 끝에서 살짝 넘쳤다 돌아오는 곡선 (자석에 붙는 느낌)
       * @param progress 진행도 (0~1)
       */
      const easeBack = (progress: number) => { const overshoot = 1.25, fromEnd = progress - 1; return 1 + (overshoot + 1) * fromEnd * fromEnd * fromEnd + overshoot * fromEnd * fromEnd; };
      /** 몸이 머물 수 있는 영역 (펫 창 = 화면 작업 영역의 화면 좌표, 창 안 = 창 크기) */
      const area = (): PetBox => PET ? { l: screen.availLeft!, t: screen.availTop!, r: screen.availLeft! + screen.availWidth, b: screen.availTop! + screen.availHeight }
        : { l: 0, t: 0, r: innerWidth, b: innerHeight };
      /**
       * 보이는 몸이 영역 밖으로 다 나가지 않도록 자리 보정
       * @param limit 영역 대신 쓸 workArea (펫 산책 복구 뒤 안전 영역). 없으면 area()
       */
      const keepIn = (candidate: Pose, limit?: PetBox) => {
        const bounds = limit || area(), side = (W - visW) / 2 * candidate.k;
        return { k: candidate.k, x: Math.min(Math.max(candidate.x, bounds.l - side), bounds.r - W * candidate.k + side), y: Math.min(Math.max(candidate.y, bounds.t - H * candidate.k * 0.05), bounds.b - H * candidate.k * 0.3) };
      };
      /** 창 좌표 → 화면 좌표 (창 테두리·제목 표시줄 두께를 뺌) */
      const screenOf = (x: number, y: number) => { const border = (outerWidth - innerWidth) / 2; return { x: screenX + border + x, y: screenY + Math.max(0, outerHeight - innerHeight - border) + y }; };
      /**
       * 붙을 자리 = 제자리. 제자리 크기가 SHOW_K보다 작으면 입력창을 피할 자리가 없음 (SHOW_K는 위 HOME_GAP 줄에서 정의)
       * 창이 좁아 제자리 크기가 SHOW_K보다 작으면(예전엔 숨김) 보일 수 있는 가장 작은 크기로 오른쪽 아래 구석
       * 컴포저 위로 올린 자리(above)는 그 자리를 그대로 씀 — 아래 구석으로 되돌리면 입력창을 다시 가림
       * 매 프레임 다시 계산하므로 창 크기가 바뀌면 붙어 있는 캐릭터의 크기·위치도 따라 바뀜
       */
      const dockTarget = (home: Home): Pose & { above?: boolean } => (home.k >= SHOW_K || home.above || home.noSafe ? home : { k: SHOW_K, x: innerWidth - 4 - (W + visW) / 2 * SHOW_K + fleeX, y: innerHeight - H * SHOW_K });
      /**
       * 보이는 몸의 창 밖 여부. 경계에서 판정이 왔다 갔다 하지 않게 회색 지대를 둠
       * @param entering true면 넘어갈 때 기준(몸의 15%가 밖으로 나가야 함, 아래쪽은 제자리가 창 아래 끝에 붙어 있어 그림의 50%),
       *   false면 이미 펫 창이 따라오는 중의 기준(몸이 거의 다 창 안으로 돌아와야(가장자리 2% 안쪽, 아래쪽은 20%만 남음) 창 안으로 봄)
       * @returns 창 밖이면 true
       */
      const bodyOut = (candidate: Pose, entering = true) => {
        const side = (W - visW) / 2 * candidate.k, edge = visW * candidate.k * (entering ? 0.15 : -0.02), low = entering ? 0.5 : 0.8;
        return candidate.x + side < -edge || candidate.x + W * candidate.k - side > innerWidth + edge || candidate.y < -edge || candidate.y + H * candidate.k * low > innerHeight;
      };
      /**
       * 펫 창: 몸이 DSH 창 안으로 거의 다 들어왔는지 (가장자리 2% 안쪽, 아래쪽은 그림의 20%만 남음)
       * @param w DSH 창 영역 (화면 좌표)
       */
      const inWindow = (candidate: Pose, w: PetBox) => {
        const side = (W - visW) / 2 * candidate.k, edge = visW * candidate.k * 0.02;
        return candidate.x + side >= w.l + edge && candidate.x + W * candidate.k - side <= w.r - edge && candidate.y >= w.t + edge && candidate.y + H * candidate.k * 0.8 <= w.b;
      };
      /** 놓은 뒤 미끄러짐·제자리로 붙기 애니메이션 마무리: 자유 위치를 확정하거나(붙었으면) 풀고, 펫 창은 붙었다고 알림 */
      const finishFreeAnim = (anim: FreeAnim, to: Pose) => {
        free.anim = null;
        if (anim.snap && !PET) { free.on = false; saveFree(); }
        else { Object.assign(free, { on: true, x: to.x, y: to.y, k: to.k }); saveFree(); }
        if (anim.snap && PET) { petDocked = true; PET.send({ type: "attach" }); }
        if (PET) { petSyncMenu(); renderPetPanel(); }   // 크기 애니메이션이 끝난 뒤 메뉴·슬라이더를 새 값으로
      };
      /**
       * 미끄러짐·붙기 애니메이션의 지금 자리 (붙기는 끝에서 살짝 넘쳤다 돌아옴). 붙기면 붙는 진행도(snapProgress)도 갱신
       * @param now 지금 시각(ms, performance.now)
       */
      const freeAnimPose = (anim: FreeAnim, home: Home, now: number) => {
        const progress = Math.min(1, (now - anim.t0) / anim.ms), to = anim.snap ? (PET ? petDock : dockTarget(home)) || anim.from : anim.to;
        const e = anim.snap ? easeBack(progress) : easeOut(progress), scaleEase = easeOut(progress);
        const target = to!;   // 붙기면 petDock·dockTarget, 아니면 anim.to (미끄러짐은 늘 to가 있음)
        const pose = { k: anim.from.k + (target.k - anim.from.k) * scaleEase, x: anim.from.x + (target.x - anim.from.x) * e, y: anim.from.y + (target.y - anim.from.y) * e };
        if (anim.snap) snapProgress = scaleEase;
        if (progress >= 1) finishFreeAnim(anim, target);
        return pose;
      };
      /** 창 안 자유 위치: 창 크기 비율 자리, 크기는 지금 창에 들어가는 최대치까지만 */
      const freeWindowPose = (home: Home) => {
        if (!isFinite(free.fx!) || !isFinite(free.fy!)) freeToRatio();
        // 모바일에서는 카드가 있을 때 자동 배치 크기(컴포저 위 = 자동 크기의 30%)를 따르고,
        // 카드가 잠깐 사라진 프레임에는 마지막 자유 크기를 써서 캐릭터가 갑자기 커지지 않게 한다.
        const floor = coarsePointer() ? MIN_SHOW_K : SHOW_K;
        const baseK = coarsePointer() && home.r ? home.k : free.k;
        const k = Math.max(floor, Math.min(baseK, Math.min(1.25, (innerHeight * 0.45) / visH)));
        return { k, x: free.fx! * innerWidth - W * k / 2, y: free.fy! * innerHeight - H * k };   // 위에서 비율 자리를 채움
      };
      const walkDockPose: Pose = { k: 1, x: 0, y: 0 };   // petWalkPose 결과 (매 프레임 새 객체를 만들지 않게 같은 객체를 채워 돌려줌)
      /** 펫 창 산책 fade·workArea clip 적용 여부: 산책·복구 중이거나, 복구 뒤 안전 영역을 유지하는 중 (펫 창에서만 부름) */
      const petWalkClipOn = () => walking() || walk.phase === "recover" || (walk.safeHold && walkAreaValid(walk.area));
      /**
       * 펫 창 산책 중의 캐릭터 자리 (산책이 자리를 정하지 않으면 null)
       * 산책 중: 출발 때 고정한 제자리·배율에 fleeX만 더함 (창이 다른 모니터로 넘어가며 DOM screen.avail*가 바뀌어도 keepIn이 제자리를 다시 clamp해 튀지 않게)
       * 복구 중: DOM keepIn으로 다시 밀지 않음. 복구 직후(safeHold): main이 준 새 workArea로만 clamp해 안전 자리가 다시 밀리지 않게 함
       * (사용자가 끌거나 새로 열면 safeHold가 풀려 기존 일반 동작으로 돌아감)
       */
      const petWalkPose = (): Pose | null => {
        if (!PET) return null;
        let pose: Pose;
        if (walk.base && walking()) pose = walk.base;
        else if (walk.phase === "recover") pose = free;
        else if (walk.safeHold && !free.anim) {
          const limit = walkAreaValid(walk.area) ? walk.area : petDisplay.area;
          if (!walkAreaValid(limit)) return null;
          pose = keepIn(free, limit);
        } else return null;
        walkDockPose.k = pose.k; walkDockPose.x = pose.x + fleeX; walkDockPose.y = pose.y;
        return walkDockPose;
      };
      /**
       * 이번 프레임의 캐릭터 자리: 끄는 중·펫 창 산책·놓은 뒤 애니메이션·자유 위치·제자리 순으로 결정
       * @param now 지금 시각(ms, performance.now)
       */
      const dockPose = (home: Home, now: number): Pose => {
        snapProgress = 0;
        if (drag.on) return { k: free.k, x: drag.x, y: drag.y };
        const walkPose = petWalkPose();
        if (walkPose) return walkPose;
        if (free.anim) return freeAnimPose(free.anim, home, now);
        const currentMode = freeMode();
        if (!PET && free.on && free.mode && free.mode !== currentMode) {
          // 다른 입력 모드에서 저장된 자리(예: 모바일 터치 드래그)는 이 화면에 적용하지 않는다.
          // 상태는 지우지 않아, 원래 모드로 돌아오면 그 자리를 그대로 다시 쓸 수 있게 한다.
          free.applied = false;
          return dockTarget(home);
        }
        free.applied = true;
        if (!free.on) return dockTarget(home);
        const kept = keepIn(PET ? free : freeWindowPose(home));
        return { k: kept.k, x: kept.x + fleeX, y: kept.y };
      };
      const GLIDE = 0.066;   // 놓을 때 속도 × 이 시간(초)만큼 미끄러짐
      /**
       * 손을 놓을 때: 속도만큼 조금만 미끄러짐(GLIDE). 멈출 자리가 제자리(펫 창이면 DSH 창의 제자리) 근처면 자석으로 붙고, 창 밖이면 펫 창으로
       * @param vx 놓을 때 가로 속도(px/초)
       * @param vy 놓을 때 세로 속도(px/초)
       * @param touch true면 터치로 놓음 (붙는 범위가 좁음)
       */
      const release = (vx: number, vy: number, touch = false) => {
        const k = free.k, from = { k, x: drag.x, y: drag.y }, glided = { k, x: from.x + vx * GLIDE, y: from.y + vy * GLIDE };
        const home: Pose | null = PET ? petDock : dockTarget(homePose());
        /** 자리·배율에 맞춘 캔버스 가운데 [x, y] */
        const mid = (at: Pose, scale: number) => [at.x + W * scale / 2, at.y + H * scale * 0.5];
        const [px, py] = mid(glided, k);
        // 창 밖이 자석보다 먼저: 제자리는 창 구석에 붙어 있어 자석 범위가 창 밖까지 걸치므로, 순서가 반대면 구석에서 밖으로 던져도 다시 붙음
        const outside = !PET && bodyOut(glided);
        // 펫 창은 몸이 DSH 창 안으로 거의 다 돌아왔을 때만 붙음 (창 밖 바로 옆, 제자리 근처에 놓았을 때 다시 붙지 않게. 창 안 쪽의 '나올 때' 기준과 같음)
        const backIn = !PET || !(home as PetDock)?.win || inWindow(glided, (home as PetDock).win!);   // 펫 창이면 home은 petDock(창 영역 포함)
        // 터치도 제자리 근처에 놓으면 snap되게 한다. 모바일에는 우클릭/휠 리셋이 없으므로,
        // 이 경로가 없으면 자유 위치가 영구 저장되어 컴포저를 계속 가릴 수 있다.
        const snapRange = touch ? Math.max(80, visW * k * 0.35) : Math.max(140, visW * k * 0.7);
        const snap = !outside && backIn && !!home && Math.hypot(px - mid(home, home.k)[0], py - mid(home, home.k)[1]) < snapRange;
        if (Math.hypot(vx, vy) > 2600) flashExp("dizzy", 1500);   // 세게 던지면 빙글빙글
        if (outside && link.supported) {
          const fromScreen = screenOf(from.x, from.y), toScreen = screenOf(glided.x, glided.y);
          link.opening = performance.now();
          link.post("open", { from: { k, x: fromScreen.x, y: fromScreen.y }, to: { k, x: toScreen.x, y: toScreen.y }, seq: ++link.seq });
        }
        free.on = true;
        if (snap) { free.anim = { t0: performance.now(), ms: 650, from, to: null, snap: true }; return; }
        const to = keepIn(glided);   // 미끄러진 자리 (화면 밖으로 나간 부분은 살짝 당겨 들임)
        // 펫 창: 끌어낸 뒤에는 기억해 둔 배율로 맞춘다 (놓은 자리의 아래 가운데를 기준으로). 붙는 중이면 위에서 끝났다.
        let target = to;
        if (PET && petPendingRatio != null) { target = keepIn(petSizedPose(glided, k, petPendingRatio)); petPendingRatio = null; }
        if (target.x !== from.x || target.y !== from.y || target.k !== from.k) free.anim = { t0: performance.now(), ms: 300, from, to: target, snap: false };
        else { free.anim = null; Object.assign(free, { x: from.x, y: from.y, k }); saveFree(); }
      };
      let lastPlaceKey = "";
      let hidden = false;   // 캔버스만 숨김 상태 (캐릭터는 내리지 않음)
      let pageHiddenApplied = false;   // 플러그인·자동화 패널 때문에 창 안 캐릭터를 숨긴 상태 (사용자 hidden 과 별개)
      /** 패널 때문에 창 안 캐릭터를 숨겨야 하는지. 패널 상태는 URL이 아니라 플러그인 클라이언트가 알려 주는 값(layout.activePanelId)을 따름 */
      const pageHiddenNow = () => !PET && prefs.pageHidden === true;
      let petPower = !PET;   // 펫 창: 창이 보이는 동안만 그린다 (숨으면 pet 프로세스가 power off 를 보냄)
      let lastClip = "";
      let lastMask = "", lastMaskComposite = "";
      const petWin = { x: NaN, y: NaN };
      let petWinSize = { w: 0, h: 0 };   // 펫 창: 캐릭터 크기에 맞춰 요청한 창 크기 (pet/main.cjs 가 실제로 조절)
      let petTracking = false, petGrab: { x: number; y: number } | null = null;   // petGrab: 따라오는 중 커서가 몸을 잡은 자리   // 펫 프로세스가 커서를 직접 따라 창을 옮기는 중 (이때 여기서 창을 옮기면 서로 밀어 끊김)
      let petBox = "";   // 펫 창: 마지막으로 알린 몸 영역
      /**
       * 펫 창: 캔버스는 창 아래 가운데, 창을 화면 좌표로 옮김
       * @param pose 캔버스 자리 (화면 좌표)
       * @returns 캔버스의 창 안 좌표 { x, y }
       */
      const movePet = (pose: Pose) => {
        const cx = (innerWidth - W * pose.k) / 2, cy = innerHeight - H * pose.k;
        const winX = Math.round(pose.x - cx), winY = Math.round(pose.y - cy);
        if (petTracking) petWin.x = petWin.y = NaN;   // 끝난 뒤 다시 계산한 자리로 옮기게
        else if (winX !== petWin.x || winY !== petWin.y || walk.phase === "recover") {
          petWin.x = winX; petWin.y = winY;
          PET!.move(winX, winY, walking() || walk.phase === "recover");   // 펫 창에서만 부른다. 산책 중에만 main이 실제 native bounds를 회신
        }
        return { x: cx, y: cy };
      };
      // 그리기 여부. 처음엔 켜 둔다(창이 보이기 전에 첫 그리기·셰이더 준비를 끝내 두려고). 실제 그리기는 raf가 배치 다음에 한다.
      let renderOn = true;
      /**
       * 그리기 켜고 끄기. 켤 때는 멈춰 있던 시간만큼 모델이 튀지 않게 티커 시각을 맞추고 쉬던 배치 루프를 깨움
       * @param on true면 그리기 켬
       */
      const setRender = (on: boolean) => {
        if (renderOn === on) return;
        renderOn = on;
        if (!on) return;
        app.ticker.lastTime = performance.now();   // 멈춰 있던 시간만큼 모델이 한꺼번에 움직이지 않게
        wakeRaf();   // 쉬고 있던 배치 루프가 있으면 깨워야 그려진다
      };
      // ---------- 배치: 한 프레임에 캐릭터 캔버스와 말풍선을 어디에 얼마나 크게 둘지 ----------
      // place()가 아래 단계를 순서대로 부른다. 단계 순서와 DOM을 읽고 쓰는 순서가 곧 동작이므로 바꾸지 않는다
      // (리팩터링 때는 npm run trace:diff로 데스크톱 경로를 프레임마다 비교).
      /** 캔버스·말풍선 숨김 */
      const hideCharacter = () => { canvas.style.display = "none"; setBubbleDisplay("none"); };
      /**
       * 그릴 수 없는 상태면 숨김 처리. 패널 숨김에서 돌아왔으면 표시 복원
       * @returns 이번 프레임 배치를 멈춰야 하면 true
       */
      const placeBlocked = () => {
        if (hidden) { hideCharacter(); return true; }
        if (pageHiddenNow()) { hideForPage(); return true; }
        if (pageHiddenApplied) {   // 이벤트를 놓쳤더라도 정상 배치로 돌아오면 페이지 숨김 표시를 푼다
          pageHiddenApplied = false;
          veil.style.opacity = ""; veil.style.pointerEvents = "";
          lastPlaceKey = "";
          wakeRaf();
        }
        // 설정에서 모바일 표시를 껐을 때, 입력 중(키보드 열림)에는 입력창·대화를 가리지 않게 잠시 숨김
        if (mobileHidden() || typingActive()) {
          skipIntro();   // 숨긴 상태에서 인트로가 멈춰 렌더러가 계속 돌거나, 다시 켰을 때 가운데 인트로가 재생되지 않게 한다
          setRender(false);
          hideCharacter(); veil.style.opacity = "0"; veil.style.pointerEvents = "none"; lastPlaceKey = ""; return true;
        }
        if (link.open || link.follow?.shown) { setRender(false); hideCharacter(); lastPlaceKey = ""; return true; }   // 펫 창이 대신 보여 줌 (붙을 자리는 150ms 틱이 계산)
        return false;
      };
      /**
       * 시작 연출 단계의 자리: 가운데에서 인사하다가 베일을 누르면 제자리로 옮겨 감
       * @param dock 연출이 끝나면 갈 자리
       * @param now 지금 시각(ms, performance.now)
       * @returns 자리와 연출 중 여부, 제자리로 옮겨 간 진행도 { k, x, y, introOn, introProgress }, 대기 중이면 null (흐린 배경만)
       */
      const introPose = (home: Home, dock: Pose, now: number) => {
        let { k, x, y } = dock;
        let introOn = intro.phase !== "done", veilOpacity = 0, introProgress = 0;
        if (introOn && !intro.begun) {   // 호스트 화면(입력 카드)이 뜨고 잠잠해진 뒤에 등장: 창이 막 떠서 메인 스레드가 바쁜 구간의 끊김을 안 보이게 (최대 8초 대기)
          if (home.card && !intro.cardAt) intro.cardAt = now;
          if (!(intro.cardAt && now - intro.cardAt > 300) && now - intro.start < 8000) { veil.style.opacity = "1"; veil.style.pointerEvents = "none"; return null; }   // 대기 중에는 아바타 없이 흐린 배경만
          intro.begun = true; intro.start = now;
        }
        if (introOn) {
          const center = centerPose();
          if (intro.phase === "center") {
            veilOpacity = 1;   // 대기 중에 이미 떠 있음
            k = center.k; x = center.x; y = center.y;
            if (intro.skip) { intro.phase = "move"; intro.moveStart = now; intro.from = center; }   // 빈 배경을 클릭해야만 제자리로 (저절로 넘어가지 않음)
          } else {
            const progress = ease((now - intro.moveStart) / 900);
            veilOpacity = 1 - progress; introProgress = progress;
            k = intro.from.k + (dock.k - intro.from.k) * progress; x = intro.from.x + (dock.x - intro.from.x) * progress; y = intro.from.y + (dock.y - intro.from.y) * progress;
            if (progress >= 1) { intro.phase = "done"; introOn = false; setRes(1); veil.remove(); bubble.style.left = ""; bubble.style.fontSize = ""; bubble.style.padding = ""; }
          }
          veil.style.opacity = String(veilOpacity); veil.style.pointerEvents = intro.phase === "center" ? "auto" : "none";
          canvas.style.opacity = intro.phase === "center" ? String(ease((now - intro.start) / 300)) : "";   // 아바타는 흐린 배경 위에서 서서히 등장
        }
        return { k, x, y, introOn, introProgress };
      };
      /**
       * 펫 산책 fade 적용: 산책 중엔 slide가 위치 기준으로 계산한 alpha(경계 근처에서만 흐려짐)를 캔버스 불투명도로, 끝나면 한 번만 되돌림
       * @param walkNow 펫 산책 fade·clip을 적용하는 중이면 true (petWalkClipOn)
       */
      const applyWalkOpacity = (walkNow: boolean) => {
        if (walkNow) {
          canvas.style.opacity = String(Math.max(0, Math.min(1, Number.isFinite(walk.alpha) ? walk.alpha : 1)));
          walk.opacityApplied = true;
        } else if (walk.opacityApplied) { canvas.style.opacity = ""; walk.opacityApplied = false; }
      };
      /** 펫 창 클릭 영역을 비워 둘 때 여부: 산책·복구·도망으로 몸이 제자리를 떠난 동안 (뒤 화면으로 통과) */
      const petBodyAway = () => walking() || walk.phase === "recover" || fleeX !== 0;
      /**
       * 펫 창: 창을 캐릭터에 맞추고 클릭 영역을 알림
       * @param dock 캐릭터 자리 (화면 좌표)
       * @param walkNow 펫 산책 fade·clip을 적용하는 중이면 true (petWalkClipOn)
       * @returns 캔버스의 창 안 좌표 { x, y }
       */
      const placePetWindow = (dock: Pose, k: number, walkNow: boolean) => {
        const { x, y } = movePet(dock);
        applyWalkOpacity(walkNow);
        // 창 크기를 캐릭터에 맞춘다 (배율 상한이 없으므로 화면에 들어가는 만큼 창도 커진다)
        const needW = Math.ceil(W * k) + 24, needH = Math.ceil(H * k) + PET_BUBBLE;
        // 설정 패널이 열려 있으면 패널이 들어갈 만큼은 창을 키운다 (캐릭터는 아래 가운데 그대로)
        const panelW = petPanelOpen && petPanel ? Math.ceil(petPanel.offsetWidth) + 24 : 0;
        const panelH = petPanelOpen && petPanel ? Math.ceil(petPanel.offsetHeight) + 24 : 0;
        const fitW = Math.max(needW, panelW), fitH = Math.max(needH, panelH);
        if (fitW !== petWinSize.w || fitH !== petWinSize.h) {
          petWinSize.w = fitW; petWinSize.h = fitH;
          PET!.send({ type: "fit", w: fitW, h: fitH });   // 펫 창에서만 부른다
        }
        // 창 크기가 바뀌면(패널을 열거나 크기를 바꿀 때) 패널을 보이는 화면 안에 다시 놓는다
        if (petPanelOpen && (innerWidth !== petPanelWin.w || innerHeight !== petPanelWin.h)) {
          petPanelWin = { w: innerWidth, h: innerHeight };
          fitPetPanel();
        }
        // 클릭을 받을 몸 영역(창 안 좌표)을 펫 프로세스에 알려 줌. 커서가 이 안에 있는지는 펫 프로세스가 직접 확인 (산책·도망 중엔 없음)
        const bodyBox = bodyRect(x, y, k), body = petBodyAway() ? null : { l: Math.round(bodyBox.l), t: Math.round(bodyBox.t), r: Math.round(bodyBox.r), b: Math.round(bodyBox.b) };
        const hitBox = petPanelBox(body);   // 설정 패널이 열려 있으면 패널 영역도 클릭을 받는다
        const sig = JSON.stringify(hitBox);
        if (sig !== petBox) { petBox = sig; PET!.send({ type: "hitbox", box: hitBox }); }
        return { x, y };
      };
      const walkClipSpec = { area: { l: 0, t: 0, r: 0, b: 0 } as WalkArea, screenX: 0, screenY: 0, width: 0, height: 0 };   // petWalkClip 입력 (매 프레임 같은 객체를 채워 씀)
      const walkClip: WalkClipInset = { left: 0, top: 0, right: 0, bottom: 0, any: false };   // petWalkClip 결과
      /**
       * 펫 산책·복귀·표시장치 변경 복구 중 선택한 workArea 밖을 자르는 clip 값 (다른 모니터에 픽셀이 보이지 않게)
       * native 창 origin은 placer가 알려 준 실제 bounds를 쓰되, DOM screenX와 한 프레임 어긋날 수 있으므로
       * 두 후보의 합집합으로 clip 상자를 잡고 pad만큼 더 안쪽을 자름 (어느 쪽이 실제여도 workArea 밖 픽셀 0)
       * 고정한 workArea(walk.area)가 없으면 자르지 않음
       * @param x 캔버스 왼쪽 (창 좌표)
       * @param y 캔버스 위 (창 좌표)
       * @returns CSS clip-path 값, 자를 곳이 없으면 ""
       */
      const petWalkClip = (k: number, x: number, y: number) => {
        const area = walk.area;
        if (!walkAreaValid(area)) return "";
        const border = (outerWidth - innerWidth) / 2;   // screenOf(x, y)와 같은 계산 (매 프레임 객체를 만들지 않게 풀어 씀)
        const domX = screenX + border + x, domY = screenY + Math.max(0, outerHeight - innerHeight - border) + y;
        const fresh = !!petBounds && performance.now() - petBounds.at < 2000;
        const nativeX = fresh ? petBounds!.x + x : domX, nativeY = fresh ? petBounds!.y + y : domY;
        const left = Math.min(domX, nativeX), top = Math.min(domY, nativeY);
        const right = Math.max(domX + W * k, nativeX + W * k), bottom = Math.max(domY + H * k, nativeY + H * k);
        walkClipSpec.area = area; walkClipSpec.screenX = left; walkClipSpec.screenY = top; walkClipSpec.width = right - left; walkClipSpec.height = bottom - top;
        const inset = walkClipInset(walkClipSpec, walkClip);
        return inset.any ? `inset(${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px)` : "";
      };
      /**
       * 승인·질문 카드가 입력 영역에 떠 있으면 캐릭터에서 카드 모양(둥근 모서리 포함)만 잘라 냄
       * 캐릭터는 계속 위(z=30)에 두므로 테마를 끈 상태의 불투명한 입력 영역 배경에도 몸이 가려지지 않음
       * (placeKey 비교보다 먼저: 입력창 위치가 그대로여도 카드가 뜨고 사라지거나 테마 전환으로 반지름이 바뀌면 갱신)
       * 카드가 없고 펫 산책 중이면 고정한 workArea 밖을 잘라 냄 (petWalkClip)
       * @param x 캔버스 왼쪽 (창 좌표)
       * @param y 캔버스 위 (창 좌표)
       * @param walkNow 펫 산책 fade·clip을 적용하는 중이면 true (petWalkClipOn)
       */
      const updateCardClip = (home: Home, introOn: boolean, k: number, x: number, y: number, walkNow: boolean) => {
        const seat = !introOn && home.card && home.card.closest('[class*="composerSeat"]');
        const popup = seat && seat.querySelector('[class*="_card"]:not(.dsc-composer)');
        let clip = "";
        if (popup) {
          const popupRect = popup.getBoundingClientRect(), popupStyle = getComputedStyle(popup), canvasWidth = W * k, canvasHeight = H * k;
          const left = popupRect.left - x, top = popupRect.top - y, right = popupRect.right - x, bottom = popupRect.bottom - y;   // 카드 경계 (캔버스 좌표)
          if (right > 0 && bottom > 0 && left < canvasWidth && top < canvasHeight) {
            /** CSS 모서리 반지름 값을 카드 크기 절반 안으로 제한한 px */
            const radius = (value: string) => Math.min(parseFloat(value) || 0, popupRect.width / 2, popupRect.height / 2);
            /** 경로 문자열용 소수 둘째 자리 숫자 */
            const fixed = (n: number) => +n.toFixed(2);
            const topLeftRadius = radius(popupStyle.borderTopLeftRadius), topRightRadius = radius(popupStyle.borderTopRightRadius), bottomRightRadius = radius(popupStyle.borderBottomRightRadius), bottomLeftRadius = radius(popupStyle.borderBottomLeftRadius);
            clip = `path(evenodd, "M0 0H${fixed(canvasWidth)}V${fixed(canvasHeight)}H0Z M${fixed(left + topLeftRadius)} ${fixed(top)}H${fixed(right - topRightRadius)}A${fixed(topRightRadius)} ${fixed(topRightRadius)} 0 0 1 ${fixed(right)} ${fixed(top + topRightRadius)}V${fixed(bottom - bottomRightRadius)}` +
              `A${fixed(bottomRightRadius)} ${fixed(bottomRightRadius)} 0 0 1 ${fixed(right - bottomRightRadius)} ${fixed(bottom)}H${fixed(left + bottomLeftRadius)}A${fixed(bottomLeftRadius)} ${fixed(bottomLeftRadius)} 0 0 1 ${fixed(left)} ${fixed(bottom - bottomLeftRadius)}V${fixed(top + topLeftRadius)}A${fixed(topLeftRadius)} ${fixed(topLeftRadius)} 0 0 1 ${fixed(left + topLeftRadius)} ${fixed(top)}Z")`;
          }
        } else if (walkNow) clip = petWalkClip(k, x, y);   // walkNow는 펫 창에서만 true
        if (clip !== lastClip) { canvas.style.clipPath = clip; lastClip = clip; }
      };
      /**
       * 캔버스 마스크 값: 펫 창이 제자리로 붙는 동안 창 밖 부분을 흐리게, 창 안 그림을 화면 아래에서 띄우면 잘린 허리를 흐리게
       * winBox = DSH 창 영역(화면 좌표), petFade = 펫 창이 붙는 진행도(0~1), fade = 허리를 흐리게 할 높이(px), x·y = 캔버스 자리(창 좌표)
       * @returns CSS mask-image 값과 합성 방식 { mask, maskComposite }
       */
      const canvasMask = ({ winBox, petFade, fade, x, y }: { winBox: PetBox | null; petFade: number; fade: number; x: number; y: number }) => {
        if (winBox && petFade > 0.001) {
          // 복귀 중에만: DSH 창 안쪽은 또렷(불투명), 바깥으로 나간 부분은 진행도에 따라 흐려져 도착하면 완전히 사라진다.
          //  · 허리 기준 정렬 덕분에 도착 시 하반신이 창 아래 = 바깥에 놓이므로, 하반신이 자연스럽게 지워진다
          //  · 평소(복귀 아닐 때)에는 이 마스크를 쓰지 않아 캐릭터가 그대로 또렷하게 보인다
          const origin = screenOf(0, 0), outsideAlpha = (1 - petFade).toFixed(3);
          const left = (winBox.l - origin.x - x).toFixed(1), right = (winBox.r - origin.x - x).toFixed(1);
          const top = (winBox.t - origin.y - y).toFixed(1), bottom = (winBox.b - origin.y - y).toFixed(1);
          return {
            mask: `linear-gradient(to right, rgba(0,0,0,${outsideAlpha}) 0 ${left}px, #000 ${left}px ${right}px, rgba(0,0,0,${outsideAlpha}) ${right}px 100%), `
              + `linear-gradient(to bottom, rgba(0,0,0,${outsideAlpha}) 0 ${top}px, #000 ${top}px ${bottom}px, rgba(0,0,0,${outsideAlpha}) ${bottom}px 100%)`,
            maskComposite: "intersect",
          };
        }
        if (petFade > 0.001) {
          // 펫 창 영역을 아직 받지 못했을 때의 대비: 허리 기준으로 페이드
          const alpha = (1 - petFade).toFixed(3), fadeFrom = Math.max(0, WAIST_PCT - 2.5).toFixed(2), fadeTo = Math.min(100, WAIST_PCT + 2.5).toFixed(2);
          return { mask: `linear-gradient(to bottom, #000 0 ${fadeFrom}%, rgba(0,0,0,${alpha}) ${fadeTo}% 100%)`, maskComposite: "" };
        }
        return { mask: fade > 0 ? `linear-gradient(to bottom, #000 calc(100% - ${fade}px), transparent)` : "", maskComposite: "" };
      };
      /** 캔버스 마스크 적용 (값이 바뀔 때만 스타일 갱신) */
      const applyCanvasMask = (spec: Parameters<typeof canvasMask>[0]) => {
        const { mask, maskComposite } = canvasMask(spec);
        if (mask !== lastMask || maskComposite !== lastMaskComposite) {
          canvas.style.maskImage = canvas.style.webkitMaskImage = mask;
          canvas.style.maskComposite = maskComposite || "add";
          canvas.style.webkitMaskComposite = maskComposite === "intersect" ? "source-in" : "source-over";
          lastMask = mask; lastMaskComposite = maskComposite;
        }
      };
      /**
       * 지금 말풍선 폭에 맞춘 꼬리 자리 설정 (최대폭을 정한 뒤 부름)
       * @returns 꼬리 자리(px)
       */
      const fitTail = () => { const t = bubbleTail(bubble.offsetWidth); bubble.style.setProperty("--dsc-tail-c", t - 2 + "px"); return t; };
      /**
       * 시작 연출 말풍선: 가운데에선 머리 위에 큰 말풍선. 꼬리는 코에 맞추고 화면 밖으로 넘치지 않게 자름
       * 제자리로 옮겨 가는 동안 크기도 캐릭터 배율과 같은 진행도로 평소 크기에 다가감 (도착 순간 크기가 튀지 않게)
       */
      const placeIntroBubble = ({ k, noseX, headTop, vp, introProgress }: BubbleSpot) => {
        const restMaxWidth = coarsePointer() ? Math.min(Math.max(150, visW * k * 1.1), vp.w - 16) : Math.max(150, visW * k * 1.1);   // 도착 뒤 배치(데스크톱·모바일)와 같은 최대폭
        const size = introBubbleSize(introProgress, restMaxWidth);
        bubble.style.right = "auto"; bubble.style.fontSize = size.font + "px"; bubble.style.padding = `${size.padY}px ${size.padX}px`; bubble.style.maxWidth = size.maxWidth + "px";
        const bubbleWidth = bubble.offsetWidth, bubbleHeight = bubble.offsetHeight, tail = fitTail();
        if (!coarsePointer()) {   // 데스크톱: 창 오른쪽 경계만 남기고 자른다
          bubble.style.left = tailLeft({ noseX, bw: bubbleWidth, width: innerWidth, tail }) + "px";
          bubble.style.top = Math.max(8, headTop - bubbleHeight - 6) + "px";
          return;
        }
        /** 말풍선 위쪽을 뷰포트 안(위아래 HOME_GAP 여백)으로 제한 */
        const clampY = (top: number) => Math.min(Math.max(vp.top + HOME_GAP, top), Math.max(vp.top + HOME_GAP, vp.top + vp.h - bubbleHeight - HOME_GAP));
        bubble.style.left = vp.left + tailLeft({ noseX: noseX - vp.left, bw: bubbleWidth, width: vp.w, tail }) + "px";
        bubble.style.top = clampY(Math.max(vp.top + HOME_GAP, headTop - bubbleHeight - 6)) + "px";
      };
      /** 데스크톱 말풍선: 꼬리(오른쪽 tail px)를 코에 맞추고 오른쪽 경계는 최소 여백만 남김. 입력창과 겹치면 입력창 바로 아래(머리 위)로 내림 */
      const placeDesktopBubble = ({ k, noseX, headTop, home }: BubbleSpot) => {
        const card = home.card;
        bubble.style.left = "auto";
        bubble.style.maxWidth = Math.max(150, visW * k * 1.1) + "px";
        const tail = fitTail();
        bubble.style.right = tailRight({ noseX, width: innerWidth, tail }) + "px";   // 꼬리(오른쪽 tail px)를 코에 맞추고 오른쪽 경계는 최소 여백만 남긴다
        bubble.style.top = Math.max(8, headTop - bubble.offsetHeight - 10) + "px";
        if (!(card && home.r)) return;
        const cardBox = home.r, bubbleLeft = bubble.offsetLeft, bubbleTop = bubble.offsetTop, bubbleBox = { left: bubbleLeft, top: bubbleTop, right: bubbleLeft + bubble.offsetWidth, bottom: bubbleTop + bubble.offsetHeight };   // 등장 애니메이션(transform) 영향 없는 레이아웃 크기
        if (!(bubbleBox.left < cardBox.right && bubbleBox.right > cardBox.left && bubbleBox.top < cardBox.bottom && bubbleBox.bottom > cardBox.top)) return;
        // 입력창 바로 아래(머리 위)로 내린다. 꼬리는 그대로 아래에서 코를 가리킨다
        const belowCard = cardBox.bottom + 8;
        if (belowCard + bubble.offsetHeight <= innerHeight - HOME_GAP) bubble.style.top = belowCard + "px";
        else {
          // 컴포저가 화면 아래 끝까지 차지해 아래로 피할 자리가 없으면, 화면 밖으로 내리지 않고
          // 캐릭터에 붙인 right 기준을 유지한 채 위쪽으로만 clamp한다.
          bubble.style.maxWidth = Math.min(Math.max(150, visW * k * 1.1), innerWidth - 16) + "px";
          bubble.style.top = Math.max(8, Math.min(innerHeight - bubble.offsetHeight - HOME_GAP, headTop - bubble.offsetHeight - 10)) + "px";
        }
      };
      /** 모바일·컴포저 위 말풍선: 머리 위가 기본. 카드와 겹치면 옆/아래로 피하고, 뷰포트(주소창·키보드) 밖으로는 나가지 않게 자름 */
      const placeMobileBubble = ({ k, noseX, headTop, vp, home }: BubbleSpot) => {
        const card = home.card;
        bubble.style.right = "auto";
        bubble.style.maxWidth = Math.min(Math.max(150, visW * k * 1.1), vp.w - 16) + "px";
        const placement = bubbleLayout({ vp, headX: noseX, headTop, bw: bubble.offsetWidth, bh: bubble.offsetHeight, r: card && home.r ? home.r : null, above: home.above, tail: fitTail() });
        bubble.style.left = placement.left + "px";
        bubble.style.top = placement.top + "px";
        if (placement.side && !home.above) bubble.classList.add("side");
      };
      /**
       * 배치에 쓰는 값을 한 줄로 묶은 비교용 키 (같으면 이번 프레임 배치를 건너뜀)
       * walkNow면 펫 산책 단계·불투명도·고정 workArea·실제 창 위치도 넣음 (fade·clip이 바뀌는 프레임은 건너뛰지 않게)
       */
      const placeKeyOf = ({ k, x, y, vp, home, noseX, fade, petFade, winBox, walkNow }: { k: number; x: number; y: number; vp: Viewport; home: Home; noseX: number; fade: number; petFade: number; winBox: PetBox | null; walkNow: boolean }) => {
        const cardBox = home.r;
        return [k, x, y, vp.left, vp.top, vp.w, vp.h, fleeX, Math.round(bodyWeight * 40), cardBox && cardBox.left, cardBox && cardBox.right, cardBox && cardBox.top, cardBox && cardBox.bottom,
          Math.round(noseX / 3), home.above ? 1 : 0, bubble.textContent, bubble.className.replace(/\bside\b/g, "").trim(),
          bubbleStatus.textContent, bubbleStatus.classList.contains("show") ? 1 : 0, fade, Math.round(petFade * 60), walkPlaceKey(walkNow),
          winBox ? [winBox.l, winBox.t, winBox.r, winBox.b].join(",") : ""].join("|");
      };
      /**
       * placeKey의 펫 산책 조각: 단계·불투명도·고정 workArea·실제 창 위치 (walkNow가 아니면 "")
       * @param walkNow 펫 산책 fade·clip을 적용하는 중이면 true (petWalkClipOn)
       */
      const walkPlaceKey = (walkNow: boolean) => {
        if (!walkNow) return "";
        const area = walk.area, bounds = petBounds;
        return `${walk.phase},${Math.round(walk.alpha * 100)},${area ? `${area.l},${area.t},${area.r},${area.b}` : ""},${bounds ? `${Math.round(bounds.x)},${Math.round(bounds.y)}` : ""}`;
      };
      /**
       * 화면 아래에서 띄운 만큼 잘린 허리를 흐리게 할 높이(px)와 펫 창이 붙는 진행도
       * @param y 캔버스 위 (창 좌표)
       * @returns { fade: 흐리게 할 높이(px), petFade: 붙는 진행도(0~1) }
       */
      const fadeAmounts = (k: number, y: number) => {
        // 허리 아래가 잘린 창 안 그림은 화면 아래에서 띄우면 띄운 만큼 아래쪽을 흐리게 (꼬마 모습은 발까지 그려져 안 흐림)
        // 펫 창은 전신을 그리지만, 제자리로 붙는 동안에는 하반신을 서서히 지워 도착할 때 창 안 상반신 그림과 이어지게 한다
        const lift = PET ? 0 : Math.max(0, innerHeight - (y + H * k));
        const fade = PET ? 0 : Math.round(Math.max(0, Math.min(lift, H * k * 0.18)) * (1 - Math.min(1, Math.max(0, bodyWeight))));
        const petFade = PET ? Math.min(1, Math.max(0, petDocked ? 1 : snapProgress)) : 0;   // 붙는 진행도 (0 = 전신 그대로, 1 = 하반신 완전히 사라짐)
        return { fade, petFade };
      };

      /**
       * 보일 크기인지 정해 캔버스·말풍선 표시와 그리기를 맞춤 (컴포저 위 자리는 최소 크기로도 보여 줌, 펫 창은 창이 보이는 동안에만 그림)
       * @returns 보이면 true
       */
      const showAt = (introOn: boolean, k: number, home: Home) => {
        const show = introOn || k >= SHOW_K || (home.above && k >= MIN_SHOW_K);
        canvas.style.display = show ? "block" : "none"; setBubbleDisplay(show ? "block" : "none");
        setRender(show && (!PET || petPower));
        return show;
      };
      /** 펫 창 마스크 기준이 될 DSH 창 영역 (안쪽은 또렷하게, 창 밖으로 나간 부분은 흐리게(반투명)). 펫 창이 아니거나 모르면 null */
      const petWinBox = () => (PET && petDock && petDock.win ? petDock.win : null);
      /** 상황에 맞는 말풍선 배치 (시작 연출 / 데스크톱 / 모바일·컴포저 위) */
      const placeBubble = (introOn: boolean, spot: BubbleSpot) => {
        if (introOn) placeIntroBubble(spot);
        else if (!coarsePointer() && !spot.home.above) placeDesktopBubble(spot);   // 데스크톱 말풍선은 기존 배치 그대로
        else placeMobileBubble(spot);
      };
      /**
       * 상태 말풍선(두 번째 말풍선) 자리: 본 말풍선이 떠 있으면 그 바로 위에, 아니면 머리 위에 붙인다
       * 폭은 본 말풍선 폭을 넘지 않게 해 화면 밖으로 밀리지 않게 하고, 본 말풍선과 같은 쪽 경계에 맞춘다
       */
      const placeStatusBubble = ({ noseX, headTop }: BubbleSpot) => {
        const mainOn = bubble.classList.contains("show");
        bubbleStatus.style.maxWidth = (mainOn ? Math.min(260, Math.max(120, bubble.offsetWidth)) : 240) + "px";
        const w = bubbleStatus.offsetWidth, h = bubbleStatus.offsetHeight;
        if (!w || !h) return;   // 아직 그려지지 않았으면 다음 프레임에 다시 배치한다
        const mainTop = parseFloat(bubble.style.top);
        const top = mainOn && Number.isFinite(mainTop) ? mainTop - h - 6 : headTop - h - 10;
        bubbleStatus.style.top = Math.max(8, Math.min(top, innerHeight - h - 8)) + "px";
        // 코 가운데를 기준으로 두되, 본 말풍선이 떠 있으면 그 가로 범위 안으로 밀어 넣어 삐져나오지 않게 한다
        let left = noseX - w / 2;
        const mainLeft = parseFloat(bubble.style.left);
        if (mainOn && Number.isFinite(mainLeft)) {
          const mainRight = mainLeft + bubble.offsetWidth;
          if (mainRight - w >= mainLeft) left = Math.min(Math.max(left, mainLeft), mainRight - w);
        }
        bubbleStatus.style.left = Math.max(8, Math.min(left, innerWidth - w - 8)) + "px";
        bubbleStatus.style.right = "auto";
      };
      /** 한 프레임 배치: 캐릭터 캔버스와 말풍선의 자리·크기·마스크 결정 (단계 순서가 곧 동작이라 바꾸지 않음) */
      const place = () => {
        if (placeBlocked()) return;
        const now = performance.now();
        const home = homePose();
        const dock = dockPose(home, now);
        const pose = introPose(home, dock, now);
        if (!pose) return;
        let { k, x, y } = pose;
        const { introOn, introProgress } = pose;
        if (!showAt(introOn, k, home)) return;
        // 배율이 바뀌면 그만큼 렌더 해상도를 올린다 (펫 창처럼 크게 그릴 때 버퍼가 모자라 뿌옇게 보이던 문제)
        if (curK !== k) { curK = k; setRes(k); }
        shown.k = k; shown.x = x; shown.y = y;
        const walkNow = PET ? petWalkClipOn() : false;
        if (PET) ({ x, y } = placePetWindow(dock, k, walkNow));
        updateCardClip(home, introOn, k, x, y, walkNow);
        // 배치에 쓰는 값이 그대로면 건너뜀: 매 프레임 side 클래스를 뗐다 붙이며 레이아웃을 3번씩 강제하던 것 방지
        const { fade, petFade } = fadeAmounts(k, y);

        const winBox = petWinBox();
        const noseX = x + (model.x + noseModelX * model.scale.x) * k;   // 말풍선 꼬리 기준: 얼굴(코) 가운데
        const viewArea = home.vp || viewport();
        const placeKey = introOn ? "" : placeKeyOf({ k, x, y, vp: viewArea, home, noseX, fade, petFade, winBox, walkNow });
        if (placeKey && placeKey === lastPlaceKey) return;
        lastPlaceKey = placeKey;
        applyCanvasMask({ winBox, petFade, fade, x, y });
        canvas.style.width = W * k + "px"; canvas.style.height = H * k + "px";
        if (fleeX !== 0) setBubbleDisplay("none");
        canvas.style.left = x + "px"; canvas.style.top = y + "px";
        const headTop = y + (H * 0.05 + chibiHeadDrop * Math.min(1, Math.max(0, bodyWeight))) * k;   // 꼬마일 땐 내려간 머리 위에 말풍선
        bubble.classList.remove("side");
        const spot = { k, noseX, headTop, vp: viewArea, home, introProgress };
        placeBubble(introOn, spot);
        placeStatusBubble(spot);
      };
      /**
       * 캔버스 숨김 칩을 보일지 여부: 캐릭터를 다시 부를 수 있는 상태에서만 보임
       * 모바일 숨김 설정(mobileCharacter=false)이면 칩도 남기지 않고, 설정을 되돌리면 다음 프레임에 다시 보임
       */
      const hideChipVisible = ({ pet = PET, isHidden = hidden, mobileHiddenNow = mobileHidden() } = {}) => !pet && isHidden && !mobileHiddenNow && !pageHiddenNow();
      let placeErrorWarned = false;
      // 배치 루프를 쉬는 중인지. 숨은 펫 창과, 펫 창이 대신 보여 주는 동안의 창 안 캐릭터는 배치할 것이 없으므로 쉬고 다시 필요해지면 wakeRaf로 깨운다
      let rafIdle = false;
      /** 쉬고 있던 배치 루프 깨우기 */
      const wakeRaf = () => { if (rafIdle) { rafIdle = false; systemTicker(true); requestAnimationFrame(raf); } };
      /**
       * 배치 루프 한 프레임: 배치한 뒤 같은 프레임에서 모델 갱신·그리기, 쉴 때가 아니면 다음 프레임 예약
       * @param time requestAnimationFrame 시각(ms)
       */
      const raf = (time: number) => {
        if (rafIdle) { systemTicker(false); return; }   // 펫/link/패널 때문에 쉬는 중이면 예약된 프레임도 즉시 쉰다
        if (hidden) {
          // 설정이 바뀌어도 복구 칩이 따라가게 한다 (모바일 숨김 설정이면 칩을 남기지 않는다)
          syncHideChip();
        } else if (SLEEP.state !== "asleep") {
          try { place(); placeErrorWarned = false; }
          catch (error) {
            // 배치 오류를 조용히 삼키지 않는다. 같은 오류가 이어지면 한 번만 알리고, 성공하면 다시 알릴 수 있게 푼다.
            if (!placeErrorWarned) { placeErrorWarned = true; console.warn("캐릭터 배치 실패:", error); }
          }
        }
        // 배치가 정한 크기·해상도로 같은 프레임에서 모델을 갱신하고 그린다 (모델 갱신 HIGH → 그리기 LOW).
        // 그리기를 따로 돌리면 그린 뒤에 해상도가 바뀌어 지워진 버퍼가 화면에 나갈 수 있다.
        if (renderOn) app.ticker.update(time);
        // 패널 숨김 때문에 쉬는 중이면(place가 hideForPage를 불렀거나 이벤트로 멈춘 경우) 다음 프레임을 예약하지 않는다.
        if (!PET && pageHiddenNow()) { rafIdle = true; systemTicker(false); return; }
        if (rafIdle) { systemTicker(false); return; }
        // 펫: 창이 숨음(open 이 오면 다시 시작). 창 안: 펫 창이 대신 보여 주는 중(link.leave·setHidden(false)에서 다시 시작)
        if (PET ? !petPower : link.open) { rafIdle = true; systemTicker(false); return; }
        requestAnimationFrame(raf);
      };
      requestAnimationFrame(raf);

      // 말풍선
      let bubbleTimer = 0;
      let statusTimer = 0;   // 상태 말풍선(명령 실행 중 등) 숨김 타이머
      let lastSayAt = 0;
      let lastSayText = "";   // 말풍선에 마지막으로 띄운 문장 (연속 터치에서 같은 대사 반복 방지)
      /**
       * 말풍선 숨김 타이머 예약. 외부 음성이 재생 중이면(voiceState.speaking) 말풍선을 붙잡아 두고 250ms 뒤 다시 확인
       * voiceState가 null(음성 없음)이면 예전처럼 setTimeout(ms) 한 번만 돌아 동작이 같음
       * @param delay 숨길 때까지 기다릴 시간(ms)
       */
      const hideBubble = (delay: number) => {
        bubbleTimer = setTimeout(() => {
          if (voiceState?.speaking === true) { hideBubble(250); return; }
          bubble.classList.remove("show");
        }, delay);
      };
      /**
       * 말풍선에 대사 띄우기 (펫 창에도 전달, 입 움직임 시작, dsc:say 이벤트 발생)
       * @param ms 띄워 둘 시간 (0이면 자동으로 숨기지 않음)
       * @param mutter true면 혼잣말 (점선 말풍선 + 생각하는 시선)
       * @param kind 대사 종류 (바깥에 알릴 때 씀, 없으면 mutter 또는 other)
       */
      /**
       * 상태 말풍선(명령 실행 중·파일 읽는 중 등) 숨기기. 본 말풍선은 건드리지 않는다
       * @param delay 숨길 때까지 기다릴 시간(ms, 없으면 바로)
       */
      const hideStatus = (delay = 0) => {
        clearTimeout(statusTimer);
        if (!delay) { bubbleStatus.classList.remove("show"); return; }
        statusTimer = setTimeout(() => bubbleStatus.classList.remove("show"), delay);
      };
      /**
       * 상태 말풍선에 작업 상태 띄우기. 본 말풍선과 따로 있어 혼잣말·대사가 옆에서 같이 보인다
       * lastSayAt을 갱신하지 않으므로 혼잣말 간격(2.5초)을 막지 않는다
       * @param text 띄울 문구
       * @param ms 띄워 둘 시간 (0이면 작업이 끝날 때까지)
       */
      const sayStatus = (text: string, ms: number) => {
        bubbleStatus.textContent = text;
        bubbleStatus.classList.add("show");
        clearTimeout(statusTimer);
        if (ms) hideStatus(ms);
      };
      const say = (text: string, ms = 3500, mutter = false, kind?: string) => {
        relay("say", [text, ms, mutter, kind]);
        kind = kind || (mutter ? "mutter" : "other");
        // 작업 상태는 두 번째 말풍선으로: 본 말풍선(혼잣말·대사)을 덮어쓰지 않는다
        if (kind === "status") {
          sayStatus(text, ms);
          try { window.dispatchEvent(new CustomEvent("dsc:say", { detail: { text, ms, kind } })); } catch {}
          return;
        }
        bubble.textContent = text; bubble.classList.add("show");
        lastSayText = text;
        bubble.classList.toggle("mutter", mutter);   // 혼잣말: 점선 말풍선 + 생각하는 시선
        lastSayAt = performance.now();
        startTalk(text, ms || 3000, mutter);   // 말하는 동안 글자 모음에 맞춰 입 움직임
        clearTimeout(bubbleTimer); if (ms) hideBubble(ms);
        // 바깥(자막·로깅·음성 엔진 등)이 대사를 알 수 있게 동기로 알린다. 실패해도 무시.
        try { window.dispatchEvent(new CustomEvent("dsc:say", { detail: { text, ms, kind } })); } catch {}
      };
      /** 말풍선 바로 숨기기 (펫 창에도 전달) */
      const hush = () => { relay("hush", []); clearTimeout(bubbleTimer); bubble.classList.remove("show"); hideStatus(); };
      // ---------- 캔버스만 숨김/표시 (설정에서 켠 사람만 단축키 사용) ----------
      // 캐릭터를 내리지 않고 그리기(티커·rAF)만 멈춰 즉시 전환한다. 설정 저장·재마운트(모델 16.5MB 재로딩)를 피하려는 선택 기능.
      // 숨김 상태에서 화면 구석에 남겨 두는 복구 칩 (단축키가 안 먹어도 클릭으로 되돌릴 수 있게)
      let hideChip: HTMLButtonElement | null = null;
      /** 숨김 복구 칩 표시 (이미 있거나 설정에서 끈 경우 생략) */
      const showHideChip = () => {
        if (hideChip || !hideChipVisible()) return;
        hideChip = life.own(document.createElement("button"), (node) => node.remove());
        hideChip.type = "button";
        hideChip.id = "dsc-hide-chip";
        hideChip.textContent = "캐릭터 숨김 · 다시 표시";
        hideChip.addEventListener("click", () => setHidden(false));
        document.body.append(hideChip);
      };
      /** 숨김 복구 칩 제거 */
      const clearHideChip = () => { if (hideChip) { hideChip.remove(); hideChip = null; } };
      /** 숨김 상태의 복구 칩을 설정·화면 상태에 맞춤 (매 프레임 호출해도 가벼움) */
      const syncHideChip = () => { if (hideChipVisible()) showHideChip(); else clearHideChip(); };
      /**
       * 플러그인·자동화 패널을 위한 창 안 캐릭터만의 숨김
       * setHidden()과 달리 hush/link.post를 쓰지 않으므로 이미 밖으로 나간 독립 펫 창은 닫히거나 돌아오지 않음
       */
      const hideForPage = () => {
        pageHiddenApplied = true;
        canvas.style.display = "none"; setBubbleDisplay("none");
        veil.style.opacity = "0"; veil.style.pointerEvents = "none";
        setRender(false);
        clearHideChip();
        lastPlaceKey = "";
        // rafIdle은 여기서 직접 켜지 않는다: 이미 예약된 프레임이 있으면 wakeRaf가 중복 루프를 만들 수 있다.
        // 다음 프레임의 raf() 하단이 pageHiddenNow()를 보고 스스로 쉰다 (외부 펫 link.open과 같은 방식).
        systemTicker(false);
      };
      /** 패널 숨김(hideForPage) 해제 후 원래 표시 상태로 복구 (사용자 숨김·잠든 상태는 그대로 유지) */
      const restoreFromPage = () => {
        if (PET) return;
        const applied = pageHiddenApplied;
        pageHiddenApplied = false;
        if (!applied) { syncHideChip(); return; }
        veil.style.opacity = ""; veil.style.pointerEvents = "";
        // 같은 프레임 안에 패널을 닫으면 rafIdle은 아직 false다. wakeRaf의 조건과 별개로 구독을 복구한다.
        systemTicker(true);
        if (!hidden && SLEEP.state !== "asleep") {
          canvas.style.display = ""; setBubbleDisplay("");
          lastPlaceKey = "";
          wakeRaf();
          try { place(); } catch (error) { console.warn("캐릭터 배치 실패:", error); }
        } else {
          canvas.style.display = "none"; setBubbleDisplay("none");
          setRender(false);
          wakeRaf();   // 칩·절전 감시가 다시 돌도록 배치 루프를 되돌린다 (숨김/잠든 상태는 place가 그대로 유지)
        }
        syncHideChip();
      };
      /** 지금 화면(플러그인·자동화 패널 여부)에 맞춘 창 안 캐릭터 숨김·복구 (펫 창에서는 무시) */
      const syncPageHidden = () => {
        if (PET) return;
        if (pageHiddenNow()) hideForPage(); else restoreFromPage();
      };
      if (!PET) hooks.syncPageHidden = syncPageHidden;
      if (pageHiddenNow()) hideForPage();
      /**
       * 캔버스 숨김·표시 전환 (펫 창에서는 무시)
       * @param next true면 숨김, false면 다시 표시
       * @returns 바뀐 뒤의 숨김 여부
       */
      const setHidden = (next: boolean) => {
        if (PET || hidden === next) return hidden;
        hidden = next;
        if (hidden) {
          drag.pending = null; drag.on = false; strokeFrom = null; chestFrom = null;
          hush();
          canvas.style.display = "none"; setBubbleDisplay("none");
          veil.style.display = "none";
          document.documentElement.classList.remove("dsc-hover", "dsc-grabbing");
          setRender(false);
          if (link.open || link.follow) { link.opening = 0; try { link.post("hide"); } catch {} }   // 펫 창이 대신 보여 주던 중이면 함께 숨김
          showHideChip();
        } else {
          clearHideChip();
          veil.style.display = "";
          setBubbleDisplay("");
          canvas.style.display = "";
          lastPlaceKey = "";
          // 숨김 동안 절전 상태로 들어갔을 수 있으니 즉시 깨워 제자리로 되돌린다
          if (SLEEP.state === "asleep" || SLEEP.state === "leaving") {
            clearTimeout(sleepTimer); sleepTimer = 0;
            cancelSleepSlide?.(); cancelSleepSlide = null;
            SLEEP.state = "active"; fleeX = 0; SLEEP.lastActive = performance.now();
          }
          setRender(true);
          // 펫 창이 떠 있었거나 정리 이벤트를 놓쳐 link가 붙잡혀 있으면, 창 안 표시를 위해 닫고 그린다
          if (link.open || link.follow) { link.open = false; link.follow = null; link.opening = 0; try { link.post("hide"); } catch {} }
          wakeRaf();
          place();
          // 링크 정리·자리 계산이 늦게 끝나는 경우를 대비해 한 번 더 자리를 계산한다 (배치·그리기는 다음 프레임의 raf가 같은 순서로)
          requestAnimationFrame(() => { if (!hidden && !link.open && !link.follow && canvas.style.display === "none") lastPlaceKey = ""; });
          setTimeout(() => { if (!hidden && !link.open && !link.follow) { lastPlaceKey = ""; place(); } }, 350);
        }
        return hidden;
      };
      if (!PET) {
        /** 캔버스 숨김·표시 뒤집기 (단축키용) */
        hooks.toggleCanvas = () => setHidden(!hidden);
        /** 캔버스 숨김 여부 */
        hooks.canvasHidden = () => hidden;
      }

      // ---------- 버튜버식 움직임 (얼굴 추적처럼) ----------
      // 이 모델은 VBridger식 리깅: 머리 = PARAMS.headTurn·headTilt·headRoll, 몸 = PARAMS.bodyShiftX/Y/Z·bodyLean(물리 엔진이 늦게 따라감),
      // 머리카락 물리 입력 = PARAMS.head*Direct, 귀 = 눈썹(PARAMS.browRaiseLeft/Right)을 따라 쫑긋. 입 = PARAMS.mouthVowel 모음.
      let mouseX = innerWidth / 2, mouseY = innerHeight / 2, lastMove = 0;
      addEventListener("mousemove", (e) => { mouseX = e.clientX; mouseY = e.clientY; lastMove = performance.now(); }, { passive: true });

      // 잡음·스프링·곡선 같은 순수 계산은 character/motion.js
      const headLookX = S(), headLookY = S(), eyeLookX = S(), eyeLookY = S();
      // 몸 위아래 튕김: 통통·웃음·끄덕임 몸짓을 시작할 때 살짝 차 주면 스프링이 출렁이며 돌아오고, 물리 엔진이 가슴을 한 박자 늦게 흔든다
      // (말할 때는 차지 않음: 몸 위아래 값은 머리도 함께 움직여 글자마다 얼굴이 떨려 보임)
      const bob = S();
      /** 몸 위아래 튕김 스프링에 속도 더하기 */
      const bobKick = (velocity: number) => { bob.v += velocity; };
      let energy = 0.6;                                   // 움직임 크기 (상태마다 다름)
      const attention = { x: 0, y: 0.05, next: 0 };       // 지금 바라보는 곳 (-1~1, 캔버스 기준)

      /**
       * 바라볼 곳 고르기: 말할 땐 정면(시청자), 작업 중엔 대화창을 읽듯 왼쪽, 가끔 입력창·딴 곳
       * @param now 지금 시각(ms, performance.now 기준)
       */
      const pickAttention = (now: number, talking: boolean) => {
        let spot;
        const chance = Math.random();
        if (talking) spot = chance < 0.85 ? [0, 0.05] : [-0.5, 0.1];
        else if (mood === "work") spot = chance < 0.55 ? [-0.75, 0.12] : chance < 0.75 ? [-0.55, -0.3] : chance < 0.9 ? [0, 0.05] : [0.35, 0.3];
        else if (mood === "wait") spot = chance < 0.7 ? [0, 0.05] : [-0.7, 0.05];
        else if (mood === "sad") spot = chance < 0.6 ? [0.1, -0.45] : [-0.3, -0.3];
        else spot = chance < 0.4 ? [0, 0.05] : chance < 0.6 ? [-0.7, 0.1] : [(Math.random() - 0.5) * 1.2, (Math.random() - 0.4) * 0.7];
        attention.x = spot[0] + (Math.random() - 0.5) * 0.12; attention.y = spot[1] + (Math.random() - 0.5) * 0.1;
        attention.next = now + (talking ? 2500 : mood === "work" ? 1200 : 1500) + Math.random() * 3000;
        if (Math.random() < 0.35) blink.next = Math.min(blink.next, now + 60);   // 시선을 옮길 때 자주 깜빡임
        if (Math.random() < 0.3) browKick = Math.max(browKick, 0.25);
      };

      // ---- 말하기: 말풍선 글자의 모음으로 입 모양 ----
      // 글자 → 입 모양 음절은 character/speech.ts
      let talk: { syl: Syllable[]; t0: number; total: number; quiet: boolean } | null = null;   // { syl: [{v, d, amp, stress}], t0, total, quiet }
      /**
       * 말풍선 글자를 음절로 나눠 입 움직임 시작
       * @param ms 말하는 시간(ms)
       * @param quiet true면 혼잣말(입을 작게)
       */
      const startTalk = (text: string, ms: number, quiet: boolean) => {
        const { syl, total } = parseSyllables(text, ms);
        talk = { syl, t0: performance.now(), total, quiet };
      };
      const VOWELS = ["A", "I", "U", "E", "O"];
      const VOWEL_PARAMS: Record<string, string> = PARAMS.mouthVowel;   // 모음 → 입 모양 파라미터 ID (모음별 세기 배율은 model-profile.ts의 VOWEL_EYE_SAFE)
      const vowel: Record<string, number> = { A: 0, I: 0, U: 0, E: 0, O: 0 };
      let mouthOpen = 0, talkSway = 0, browKick = 0, browValue = 0, nodKick = 0, lastStressIndex = -1;   // browKick = 눈썹(귀) 목표, browValue = 실제로 부드럽게 따라가는 값
      let voiceState: VoiceState | null = null;   // 외부 음성 상태(선택): { speaking, level, vowels, until } | null — 없으면 예전 그대로

      const look = { x: 0, y: 0 };   // (터치·확인용으로 남겨 둔 값)
      const pose1: Record<"lean" | "headZ" | "headY" | "bodyY", number> = { lean: 0, headZ: 0, headY: 0, bodyY: 0 };   // 자세 1단계 (S자 전환용)
      // 제스처 출력용 채널별 스프링. 게스처가 끝나거나 다른 반응으로 바뀌어도 그 순간의 속도를 이어받아 풀린다.
      //   머리(빠름) → 몸통(중간) → 팔·표정(늦음) 순으로 강성을 낮춰 시차를 만든다. 머리카락·꼬리는 모델 물리가 한 박자 늦게 따라온다.
      const gestureSprings: Record<string, { x: number; v: number }> = {};
      const GESTURE_SPRING: Record<string, [number, number]> = {
        yaw: [90, 19], pitch: [90, 19], roll: [90, 19],                 // 고개: 약 0.42초에 안정
        bodyX: [55, 14.8], bodyY: [55, 14.8], bodyZ: [55, 14.8], lean: [48, 13.8],   // 몸통: 약 0.5~0.6초
        smile: [40, 12.6], eyeSmile: [40, 12.6], eyeClose: [40, 12.6], mouth: [40, 12.6],   // 팔·표정: 약 0.65초
      };
      for (const channel in GESTURE_SPRING) gestureSprings[channel] = { x: 0, v: 0 };
      let blink = { next: performance.now() + 2000, start: -1e9, double: false }, lastFrameAt = performance.now();

      // ---------- 한 프레임의 절차 애니메이션 ----------
      // 표정 매니저 자리(모션 뒤·물리 앞)에서 불린다. 아래 단계들은 이 순서대로 돌고, 단계의 순서와
      // 난수(Math.random)를 쓰는 순서가 곧 동작이므로 바꾸지 않는다 (리팩터링 때는 npm run trace:diff로 프레임마다 비교).
      // 고개·몸 값은 motion(yaw·pitch·roll·bodyX/Y/Z·lean·smile·eyeSmileAdd·eyeClose·mouthAdd)에 모았다가 한 번에 쓴다.

      /**
       * 가슴 끌기 스프링 갱신: 끄는 동안 민첩하게 따라가고, 놓으면 출렁이며 잦아듦
       * @param now 지금 시각(ms)
       * @param dt 지난 프레임부터 흐른 시간(초)
       */
      const updateChestDrag = (now: number, dt: number) => {
        spring(dragLift, chestDragging ? chestTarget : 0, dt, chestDragging ? 820 : 200, chestDragging ? 40 : 6);   // 끄는 동안 민첩하게, 놓으면 출렁이며 잦아듦
        spring(dragShift, chestDragging ? chestShiftTarget : 0, dt, chestDragging ? 700 : 220, chestDragging ? 42 : 7);   // 좌우로 끌면 그 방향으로 따라가고, 놓으면 제자리로 출렁
        if (!chestDragging && Math.abs(dragShift.x) < 0.0001 && Math.abs(dragShift.v) < 0.001) dragShift.x = dragShift.v = 0;
        if (!chestDragging && Math.abs(dragLift.x) < 0.0001 && Math.abs(dragLift.v) < 0.001) dragLift.x = dragLift.v = 0;
        if (chestDragging) {
          flashExp("squint", 400); flashExp("blush", 400);
          walk.lastTouch = now;
        }
      };
      /**
       * 이 프레임에 여러 단계가 같이 쓰는 값 모음
       * 만료된 음성 상태 비우기와 기분 만료 처리도 여기서 함께
       * @param now 지금 시각(ms)
       * @param dt 지난 프레임부터 흐른 시간(초)
       */
      const frameContext = (now: number, dt: number) => {
        const introCalm = intro.phase !== "done";   // 시작 화면(가운데에 크게): 눈·눈썹·귀를 차분하게
        const seconds = now / 1000;
        if (voiceState && voiceState.until && now > voiceState.until) voiceState = null;   // 만료된 음성 상태 비우기
        const talking = (voiceState?.speaking === true) || (bubble.classList.contains("show") && fleeX === 0);
        const muttering = talking && bubble.classList.contains("mutter");
        if (moodUntil && now > moodUntil) { mood = "idle"; moodUntil = 0; }
        const laughing = gestureState.name === "laugh";
        return { now, dt, seconds, introCalm, talking, muttering, laughing };
      };
      /** 움직임 크기 갱신: 대기 < 작업 < 말하기, 웃을 땐 크게, 시무룩하면 작게 */
      const updateEnergy = ({ dt, talking, muttering, laughing }: Frame) => {
        const energyTarget = (mood === "sad" ? 0.35 : mood === "wait" ? 0.55 : mood === "work" ? 0.75 : 0.6) + (talking && !muttering ? 0.35 : 0) + (laughing ? 0.5 : 0);
        energy += (energyTarget - energy) * Math.min(1, dt * 1.5);
      };
      // ---- 바라보는 곳 ----
      /** 시선 목표 정하기와 눈·고개 스프링 갱신 (눈은 빠르게, 고개는 천천히 따라감) */
      const updateGaze = ({ now, dt, introCalm, talking, muttering }: Frame) => {
        let targetX, targetY;
        if (now < stareUntil) { targetX = 0; targetY = 0.05; }                // 삐짐이 풀리며 한마디: 고개 고정, 눈 맞춤
        else if (muttering) { targetX = 0.4; targetY = 0.38; }                    // 혼잣말: 옆 위를 보며 생각
        else if (talking && introCalm) { targetX = attention.x * 0.25; targetY = 0.05 + attention.y * 0.2; }   // 시작 화면에서 말할 땐 보는 사람을 봄 (마우스·딴 곳을 따라가지 않음)
        else if (now - lastMove < 2500 && !talking) {             // 마우스를 움직이면 눈은 커서를, 고개는 반쯤
          const rect = canvas.getBoundingClientRect();
          targetX = clamp((mouseX - (rect.left + rect.width / 2)) / 600, -1, 1);
          targetY = clamp(((rect.top + rect.height * 0.25) - mouseY) / 500, -1, 1);
        } else {
          if (now > attention.next || (!introCalm && talking && Math.abs(attention.x) > 0.3 && Math.random() < dt * 2)) pickAttention(now, talking);
          targetX = attention.x; targetY = attention.y;
        }
        // 눈은 빠르게(휙), 고개는 천천히 따라감 → 눈이 먼저 가고 고개가 뒤따르는 버튜버 느낌
        const eyeStiffness = introCalm ? 420 : 900, eyeDamping = introCalm ? 42 : 55;   // 시작 화면(크게 보일 때)은 눈이 튀지 않게 조금 부드럽게
        spring(eyeLookX, targetX, dt, eyeStiffness, eyeDamping); spring(eyeLookY, targetY, dt, eyeStiffness, eyeDamping);
        spring(headLookX, targetX * 0.85, dt, 38, 9.5); spring(headLookY, targetY * 0.8, dt, 38, 9.5);
        look.x = headLookX.x; look.y = headLookY.x;
      };
      // ---- 말하기 (입 모양 · 고개 끄덕 · 눈썹) ----
      /**
       * 낱말 첫소리 반응: 눈썹 살짝(귀 쫑긋) + 가끔 끄덕 (시작 화면에서는 눈썹을 덜, 가끔만)
       * @param introCalm true면 시작 화면(가운데에 크게)
       */
      const stressKick = (introCalm: boolean) => {
        if (!introCalm) browKick = Math.max(browKick, 0.35 + Math.random() * 0.35);
        else if (Math.random() < 0.35) browKick = Math.max(browKick, 0.2 + Math.random() * 0.15);
        if (Math.random() < 0.45) nodKick = Math.max(nodKick, 0.6 + Math.random() * 0.5);
      };
      /**
       * 말풍선 글자를 따라 지금 음절의 입 벌림 계산 (다 읽었으면 talk를 비움)
       * 모음별 입 모양(vowel) 갱신과 강세 음절의 눈썹·끄덕 반응도 함께
       * @param now 지금 시각(ms)
       * @param introCalm true면 시작 화면(가운데에 크게)
       * @returns 입 벌림 정도(0~1, 모음 없는 음절이거나 다 읽었으면 0)
       */
      const talkOpen = (now: number, introCalm: boolean) => {
        const current = talk!;   // updateSpeech가 talk가 있을 때만 부른다
        let t = (now - current.t0) / 1000;
        if (t >= current.total) { talk = null; return 0; }
        let i = 0; while (i < current.syl.length && t > current.syl[i].d) { t -= current.syl[i].d; i++; }
        const syllable = current.syl[i];
        if (!(syllable && syllable.v)) return 0;
        const progress = t / syllable.d, envelope = Math.pow(Math.sin(Math.PI * Math.min(1, progress)), 0.7);
        const open = envelope * syllable.amp! * (current.quiet ? 0.3 : 1);   // 입 모양이 있는 음절은 세기가 있다
        vowel[syllable.v] = Math.max(vowel[syllable.v], open);
        if (syllable.stress && i !== lastStressIndex) {
          lastStressIndex = i;
          if (!current.quiet) stressKick(introCalm);
        }
        return open;
      };
      /** 입 벌림·모음 모양과 눈썹·끄덕 세기 갱신 (외부 음성이 재생 중이면 그 레벨·모음 우선) */
      const updateSpeech = ({ now, dt, introCalm }: Frame) => {
        let open = 0;
        for (const key of VOWELS) vowel[key] *= Math.max(0, 1 - dt * 14);
        if (talk) open = talkOpen(now, introCalm);
        if (voiceState?.speaking) {   // 실제 재생 중이면 오디오 레벨·모음이 입 모양을 덮어쓴다
          open = clamp(voiceState.level, 0, 1) * 0.9;
          if (voiceState.vowels) for (const key of VOWELS) vowel[key] = Math.max(vowel[key] * 0.4, clamp(voiceState.vowels[key] || 0, 0, 1));
        }
        mouthOpen += (open - mouthOpen) * Math.min(1, dt * 16);   // 입은 조금 부드럽게 따라감 (너무 파닥거리지 않게)
        browKick *= Math.max(0, 1 - dt * (introCalm ? 2 : 3.5));
        browValue = introCalm ? browValue + (browKick - browValue) * Math.min(1, dt * 5) : browKick;   // 시작 화면에선 눈썹·귀가 툭 튀지 않고 부드럽게 오르내림
        nodKick *= Math.max(0, 1 - dt * 5);
      };
      // ---- 상태별 자세 (작업 중 = 살짝 앞으로, 대기 = 숙이고 갸웃, 실패 = 고개 숙임) ----
      /**
       * 기분별 자세(pose.lean·headZ·headY·bodyY)를 두 단계로 따라가게 갱신
       * @param dt 지난 프레임부터 흐른 시간(초)
       */
      const updateMoodPose = (dt: number) => {
        const goal: Record<"lean" | "headZ" | "headY" | "bodyY", number> = { lean: 0, headZ: 0, headY: 0, bodyY: 0 };
        if (mood === "work") { goal.lean = -7; goal.headY = -5; }          // 작업 중: 상체를 조금 내밀고 화면을 내려다봄
        if (mood === "wait") { goal.lean = -9; goal.headZ = 8; goal.headY = 3; }   // 대기: 다가와 갸웃하며 사용자를 올려다봄
        if (mood === "sad") { goal.headY = -10; goal.bodyY = -5; }
        const followRate = Math.min(1, dt * 2.2);   // 두 단계로 따라가서 S자 곡선 (툭 끊기지 않게)
        for (const key of Object.keys(goal) as (keyof typeof goal)[]) { pose1[key] += (goal[key] - pose1[key]) * followRate; pose[key] += (pose1[key] - pose[key]) * followRate; }
      };
      // ---- 고개 (AngleX/Y/Z): 시선 + 잔잔한 흔들림 + 말할 때 끄덕 / 몸: 숨쉬기 + 튕김 ----
      /**
       * 이 프레임의 기본 고개·몸 값 계산: 시선 + 잔잔한 흔들림 + 말할 때 끄덕·기울임, 숨쉬기 + 튕김
       * 눈 맞춤 정도(stareWeight)와 말할 때 흔들림 정도(talkSway) 갱신도 함께
       * @returns 다음 단계들이 더해 갈 고개·몸 값
       */
      const baseMotion = ({ now, dt, seconds, talking, muttering }: Frame) => {
        const motion = { yaw: headLookX.x * 22 + noise(seconds * 0.33, 1) * 6 * energy } as Motion;   // 나머지 값은 아래에서 차례로 채운다
        motion.pitch = headLookY.x * 13 + noise(seconds * 0.41, 2) * 4.5 * energy + pose.headY - nodKick * 4 - mouthOpen * 1.5;
        motion.roll = noise(seconds * 0.27, 3) * 7.5 * energy - headLookX.x * headLookY.x * 7 + pose.headZ;
        // 말하는 동안 고개를 천천히 좌우로 기울이고 살짝 돌림 (입만 움직이고 얼굴이 굳어 보이지 않게)
        stareWeight += ((now < stareUntil ? 1 : 0) - stareWeight) * Math.min(1, dt * 6);
        talkSway += ((talking && !muttering && now >= stareUntil ? 1 : 0) - talkSway) * Math.min(1, dt * 2.5);
        motion.swayYaw = Math.sin(seconds * Math.PI * 2 * 0.31 + 1.3) * 4.5 * talkSway; motion.swayPitch = Math.sin(seconds * Math.PI * 2 * 0.47 + 0.6) * 1.5 * talkSway;
        if (talkSway > 0.01) { motion.roll += Math.sin(seconds * Math.PI * 2 * 0.55) * 4 * talkSway; motion.yaw += motion.swayYaw; motion.pitch += motion.swayPitch; }
        // ---- 몸 (PositionX/Y/Z·LeanInput → 물리가 몸통을 늦게 따라 움직임) ----
        motion.bodyX = headLookX.x * 8 + noise(seconds * 0.17, 4) * 5 * energy;
        motion.bodyZ = motion.roll * 0.5 + noise(seconds * 0.21, 5) * 3 * energy;
        spring(bob, 0, dt, 70, 6);   // 살짝 덜 감쇠: 한두 번 출렁이다 멈춤
        motion.bodyY = pose.bodyY + Math.sin(seconds * 2 * Math.PI / 3.6) * 1.8 + clamp(bob.x, -14, 14);   // 숨쉬기 + 튕김
        motion.lean = pose.lean; motion.smile = 0; motion.eyeSmileAdd = 0; motion.eyeClose = 0; motion.mouthAdd = 0;
        if (mood === "work") motion.bodyZ += Math.sin(seconds * 2.1) * 1.2;        // 작업 중엔 리듬 타기
        return motion;
      };
      /**
       * 몸짓 더하기: 출력은 바로 더하지 않고 채널별 스프링을 거쳐 더함
       * 반응이 끝나거나 다른 반응으로 바뀌어도 그 순간의 자세·속도에서 이어지고, 0.5~0.8초에 걸쳐 대기 자세로 풀림. 가만히 있을 때 가끔 대기 몸짓 시작
       */
      const applyGesture = (motion: Motion, { now, dt }: Frame) => {
        const gestureOut = { yaw: 0, pitch: 0, roll: 0, bodyX: 0, bodyY: 0, bodyZ: 0, lean: 0, smile: 0, eyeSmile: 0, eyeClose: 0, mouth: 0 };
        if (gestureState.name) {
          const progress = (now - gestureState.start) / gestureState.dur;
          if (progress >= 1) {
            gestureState.name = null;
            nextIdleGesture = Math.max(nextIdleGesture, now + 2500 + Math.random() * 3500);   // 복귀 직후 대기 몸짓이 곧바로 붙어 다시 움직이지 않게
          } else addGesture(gestureOut, gestureState.name, progress, gestureState.dir);
        }
        // 스프링을 거친 게스처 출력을 더한다 (게스처가 없을 땐 목표가 0이라 현재 속도에서 감속하며 대기 자세로 돌아간다)
        for (const channel of Object.keys(gestureOut) as (keyof typeof gestureOut)[]) { const springParams = GESTURE_SPRING[channel]; spring(gestureSprings[channel], gestureOut[channel], dt, springParams[0], springParams[1]); }
        motion.yaw += gestureSprings.yaw.x; motion.pitch += gestureSprings.pitch.x; motion.roll += gestureSprings.roll.x;
        motion.bodyX += gestureSprings.bodyX.x; motion.bodyY += gestureSprings.bodyY.x; motion.bodyZ += gestureSprings.bodyZ.x; motion.lean += gestureSprings.lean.x;
        motion.smile += gestureSprings.smile.x; motion.eyeSmileAdd += gestureSprings.eyeSmile.x; motion.eyeClose += gestureSprings.eyeClose.x; motion.mouthAdd += gestureSprings.mouth.x;
        if (!gestureState.name && mood === "idle" && now > nextIdleGesture && now >= sulkUntil) {   // 가만히 있을 때 가끔 몸짓 (삐진 동안은 안 함)
          const chance = Math.random();
          const pick = chance < 0.3 ? "tilt" : chance < 0.5 ? "sway" : chance < 0.72 ? "lean" : chance < 0.88 ? "nod" : "laugh";
          play(pick, pick === "lean" ? 2600 : pick === "sway" ? 2300 : pick === "laugh" ? 1500 : 1800);
          nextIdleGesture = now + 7000 + Math.random() * 9000;
        }
      };
      /** 가슴 터치 때 가끔 앞으로 숙임 + 부끄러워 떨기 (5초에 걸쳐 잦아듦) */
      const applyTouchAndShiver = (motion: Motion, { now, dt }: Frame) => {
        touchLean += ((now < touchLeanUntil ? -30 : 0) - touchLean) * Math.min(1, dt * 4);
        motion.lean += touchLean;
        const shiverSec = (now - shiverStarted) / 1000;
        if (shiverSec >= 0 && shiverSec < 5) {
          const tremor = Math.sin(shiverSec * Math.PI * 2 * 8) * Math.min(1, shiverSec / 0.2) * Math.pow(1 - shiverSec / 5, 1.5);
          motion.bodyZ -= tremor * 3; motion.roll += tremor * 2;
          // 떨림은 너무 빨라 가슴 물리가 따라오지 못하므로, 0.2초 안팎으로 몸을 위아래로 툭툭 쳐서 가슴이 그 박자에 출렁이게 함 (잦아들면 같이 약해짐)
          if (now > shiverBobAt) { bobKick((shiverBobSign = -shiverBobSign) * 40 * Math.pow(1 - shiverSec / 5, 1.5)); shiverBobAt = now + 170 + Math.random() * 90; }
        }
      };
      /**
       * 도망가며 종종걸음, 산책: 걸어가는 쪽으로 몸을 돌리고 통통 걸음. 돌아올 땐 반대쪽을 봄
       * walk.face: -1 = 왼쪽을 봄, 1 = 오른쪽을 봄. 산책 진행 확인(walkCheck)도 여기서 호출
       * 펫 창 복귀는 faceDir(실제 이동 방향)을 명시해 창 안의 -walk.dir 규칙과 섞이지 않게 함
       */
      const applyWalk = (motion: Motion, { now, dt, seconds }: Frame) => {
        if (fleeX !== 0 && !walk.phase) motion.bodyZ += Math.sin(seconds * 16) * 8;
        const faceTo = walk.phase === "out" ? walk.dir : walk.phase === "in" ? (walk.faceDir == null ? -walk.dir : walk.faceDir) : 0;
        walk.face += (faceTo - walk.face) * Math.min(1, dt * 5);
        const facing = Math.abs(walk.face);
        if (facing > 0.01) {
          const stepPhase = seconds * Math.PI * 2 * 1.8, faceDirection = walk.face;
          motion.yaw = motion.yaw * (1 - facing) + 22 * faceDirection; motion.pitch -= 2 * facing; motion.roll += Math.sin(stepPhase) * 2.5 * facing;
          motion.bodyX += 6 * faceDirection; motion.bodyY += Math.abs(Math.sin(stepPhase)) * 6 * facing; motion.bodyZ += Math.sin(stepPhase) * 4 * facing;
        }
        if (walkCheck) walkCheck(now);
      };
      /** 끌기·던지기: 움직이는 반대쪽으로 몸이 쏠리고(관성) 머리카락·치마·리본은 물리로 따라 흔들림. 손을 멈추거나 놓으면 잦아듦 */
      const applyCarry = (motion: Motion, { now, dt }: Frame) => {
        const lastSample = drag.samples.length ? drag.samples[drag.samples.length - 1][0] : 0;
        if (!drag.on || now - lastSample > 60) { const decay = Math.max(0, 1 - dt * 5); carry.vx *= decay; carry.vy *= decay; }
        const carryVx = clamp(carry.vx / 1600, -1, 1), carryVy = clamp(carry.vy / 1600, -1, 1);
        if (Math.abs(carryVx) + Math.abs(carryVy) > 0.002) {
          motion.bodyX -= carryVx * 16; motion.bodyZ -= carryVx * 14; motion.roll -= carryVx * 12; motion.yaw += carryVx * 8;
          motion.bodyY -= carryVy * 12; motion.pitch += carryVy * 10;
        }
      };
      /**
       * 삐짐: 0.35초에 턱을 들고 고개를 홱 돌리고, 끝나기 1.2초 전부터 천천히 돌아옴
       * @returns sulkWeight(삐짐 정도 0~1), peek(몰래 보기 0~1), sulkEye(눈동자)
       */
      const applySulk = (motion: Motion, { now, dt }: Frame): Sulk => {
        const sulkWeight = now < sulkUntil ? Math.min(sstep((now - sulkStart) / 350), sstep((sulkUntil - now) / 1200)) : 0;
        let peek = 0;   // 몰래 보기 정도 (0 = 외면, 1 = 사용자 쪽을 봄)
        if (sulkWeight > 0) {
          const sulkElapsed = now - sulkStart;
          for (const peekEvent of sulkPeeks) {
            const sincePeek = sulkElapsed - peekEvent.at;
            if (sincePeek < 0 || sincePeek > PEEK_RISE + PEEK_HOLD + PEEK_SNAP) continue;
            if (sincePeek >= PEEK_RISE + PEEK_HOLD && !peekEvent.done) { peekEvent.done = true; if (peekEvent.flip) sulkDir = -sulkDir; }   // 다시 외면할 때 60% 확률로 반대쪽으로
            peek = sincePeek < PEEK_RISE ? sstep(sincePeek / PEEK_RISE) : sincePeek < PEEK_RISE + PEEK_HOLD ? 1 : 1 - sstep((sincePeek - PEEK_RISE - PEEK_HOLD) / PEEK_SNAP);
          }
          const away = 1 - 0.75 * peek, turnRate = Math.min(1, dt * 14);   // 고개는 빠르게 따라가서 방향을 바꿀 때 홱 돌아감
          sulkYaw += (-24 * sulkDir * away - sulkYaw) * turnRate;
          sulkRoll += (-8 * sulkDir * away - sulkRoll) * turnRate;
          motion.yaw = motion.yaw * (1 - sulkWeight) + sulkYaw * sulkWeight; motion.roll = motion.roll * (1 - sulkWeight) + sulkRoll * sulkWeight;
          motion.pitch = motion.pitch * (1 - sulkWeight) + SULK_CHIN * (1 - 0.6 * peek) * sulkWeight;
          motion.bodyX = motion.bodyX * (1 - sulkWeight) + sulkYaw / 6 * sulkWeight; motion.smile *= 1 - sulkWeight; motion.eyeSmileAdd *= 1 - sulkWeight;
        }
        const sulkEye = sulkDir * (-0.45 + 0.85 * Math.min(1, peek * 1.8));   // 외면할 땐 눈도 피하고, 몰래 볼 땐 눈이 먼저 사용자 쪽으로
        return { sulkWeight, peek, sulkEye };
      };
      /** 눈 맞춤 동안 얼굴·몸 흔들림을 거의 멈추고 고개·몸 파라미터 쓰기 (±30으로 자름) */
      const writeHeadBody = (motion: Motion) => {
        if (stareWeight > 0.01) { const k = 1 - stareWeight * 0.92; motion.yaw = headLookX.x * 22 * (1 - stareWeight) + (motion.yaw - headLookX.x * 22) * k; motion.pitch *= k; motion.roll *= k; motion.bodyX *= k; motion.bodyZ *= k; }
        motion.yaw = clamp(motion.yaw, -30, 30); motion.pitch = clamp(motion.pitch, -30, 30); motion.roll = clamp(motion.roll, -30, 30);
        for (const [id, value] of [[PARAMS.headTurn, motion.yaw], [PARAMS.headTilt, motion.pitch], [PARAMS.headRoll, motion.roll], [PARAMS.headTurnDirect, motion.yaw], [PARAMS.headTiltDirect, motion.pitch], [PARAMS.headRollDirect, motion.roll],
          [PARAMS.bodyShiftX, clamp(motion.bodyX, -30, 30)], [PARAMS.bodyShiftY, clamp(motion.bodyY, -30, 30)], [PARAMS.bodyShiftZ, clamp(motion.bodyZ, -30, 30)], [PARAMS.bodyLean, clamp(motion.lean, -30, 30)]] as [string, number][]) addParam(id, value);
      };
      // ---- 눈: 눈동자는 고개보다 먼저 (머리 기준 상대 위치), 숨쉬기 ----
      /** 눈동자(머리 기준 상대 위치, 삐짐 중엔 외면·몰래 보기)와 숨쉬기 파라미터 쓰기 */
      const writeEyes = (motion: Motion, { seconds }: Frame, { sulkWeight, sulkEye }: Sulk) => {
        // 눈동자는 작게만 (크게 움직이면 흰자가 드러나 곁눈질처럼 보임)
        addParam(PARAMS.eyeLookX, clamp(((eyeLookX.x - headLookX.x) * 0.9 + headLookX.x * 0.2) * 0.6, -0.45, 0.45) * (1 - sulkWeight) + sulkEye * sulkWeight - motion.swayYaw / 30 * (1 - sulkWeight));   // 말하며 고개를 돌려도 눈동자는 정면을 봄
        addParam(PARAMS.eyeLookY, clamp(((eyeLookY.x - headLookY.x) * 0.9 + headLookY.x * 0.2) * 0.6 - motion.swayPitch / 30, -0.3, 0.3));
        setParam(PARAMS.breath, 0.5 + 0.5 * Math.sin(seconds * 2 * Math.PI / 3.6));
      };
      // ---- 눈썹 (귀가 따라 움직임) ----
      /** 눈썹 파라미터 쓰기 (귀가 따라 움직임, 부끄러울 땐 곤란한 눈썹) */
      const writeBrows = ({ seconds }: Frame) => {
        const brow = browValue + noise(seconds * 0.5, 7) * 0.12 + (mood === "wait" ? 0.25 : mood === "sad" ? -0.3 : 0) - 0.15 * happyMouth;
        if (happyMouth > 0.01) addParam(PARAMS.browInnerRaise, 0.55 * happyMouth);   // 곤란한 눈썹 (안쪽 끝이 올라감)
        addParam(PARAMS.browRaiseLeft, clamp(brow, -1, 1));
        addParam(PARAMS.browRaiseRight, clamp(brow + noise(seconds * 0.6, 8) * 0.06, -1, 1));
        if (browValue > 0.15) addParam(PARAMS.browInnerRaise, Math.min(1, browValue * 0.6));
      };
      // ---- 입: 모음 모양 + 늘 살짝 웃는 입꼬리 ----
      /** 입 파라미터 쓰기: 모음 모양 + 늘 살짝 웃는 입꼬리, 삐짐 표정·눈웃음 포함 (happyMouth 갱신도 함께) */
      const writeMouth = (motion: Motion, { now, dt, seconds }: Frame, { sulkWeight, peek }: Sulk) => {
        const openNow = clamp(mouthOpen + motion.mouthAdd + 0.14 * happyMouth, 0, 1);   // 살짝 벌린 입
        if (openNow > 0.01) {
          setParam(PARAMS.mouthOpen, openNow * 0.9);
          addParam(PARAMS.jawOpen, openNow * 0.45);
          setParam(PARAMS.mouthClosed, 1 - openNow);
          for (const key of VOWELS) if (vowel[key] > 0.01) addParam(VOWEL_PARAMS[key], Math.min(1, vowel[key]) * (VOWEL_EYE_SAFE[key] || 1));
          if (motion.mouthAdd > 0.01) addParam(PARAMS.mouthVowel.A, motion.mouthAdd * 0.8);
        }
        happyMouth += ((now < happyMouthUntil ? 1 : 0) - happyMouth) * Math.min(1, dt * 5);
        const baseSmile = (mood === "sad" ? 0 : mood === "wait" ? 0.15 : 0.35) * (1 - sulkWeight) + 0.2 * happyMouth;   // 부끄럽지만 좋아서 입꼬리가 조금 올라감 (곤란함이 섞여 크게는 안 웃음)
        if (sulkWeight > 0.01) for (const [id, eased] of [[PARAMS.cheekPuff, 0.5], [PARAMS.mouthPucker, 0.3], [PARAMS.frown, 0.5], [PARAMS.frownSecondary, 0.5]] as [string, number][]) addParam(id, sulkWeight * (1 - eased * peek));   // 볼 부풀리기·입 삐죽·찡그린 눈썹 (몰래 볼 땐 조금 풀림)
        addParam(PARAMS.mouthForm, clamp(baseSmile + motion.smile * 0.4, -1, 1));
        addParam(PARAMS.mouthSmileLeft, clamp(baseSmile + motion.smile * 0.5 + 0.3 * happyMouth, 0, 1));   // 한쪽만 더 올라간 어색한 웃음
        addParam(PARAMS.mouthSmileRight, clamp(baseSmile + motion.smile * 0.5 + noise(seconds * 0.3, 9) * 0.05, 0, 1));
        const eyeSmile = clamp((mood === "sad" ? 0 : 0.12) + motion.smile * 0.35 + motion.eyeSmileAdd, 0, 1);
        if (eyeSmile > 0.01) addParam(PARAMS.eyeSmile, eyeSmile);
      };
      // ---- 눈 깜빡임: 2~6초 불규칙, 가끔 두 번 ----
      /** 눈 깜빡임 예약(2~6초 불규칙, 가끔 두 번, 웃는 중엔 안 함)과 눈 뜸 파라미터 쓰기 */
      const writeBlink = (motion: Motion, { now, laughing }: Frame) => {
        if (now >= blink.next && !laughing) {
          blink.start = now;
          blink.next = blink.double ? now + 2000 + Math.random() * 4000 : (Math.random() < 0.18 ? now + 260 : now + 2000 + Math.random() * 4000);
          blink.double = !blink.double && blink.next - now < 400;
        }
        const sinceBlink = (now - blink.start) / 1000;
        const eyeOpen = clamp((mood === "work" ? 0.92 : 0.97) * (1 - blinkClose(sinceBlink)) * (1 - motion.eyeClose), 0, 1.2);
        setParam(PARAMS.eyeOpenLeft, eyeOpen); setParam(PARAMS.eyeOpenRight, eyeOpen);
      };
      /** 표정 파일(하트·눈물·땀 등)을 무게에 따라 섞기 */
      const writeExpressions = ({ now, dt }: Frame) => {
        for (const [name, params] of Object.entries(expressionParams)) {
          const target = hold[name] || (until[name] || 0) > now ? 1 : 0;
          // 하트·><·얄미운·빙글빙글 눈은 눈 그림 자체를 바꾸므로 한 번에 바꾸고, 그 순간 깜빡여 감춤
          const EYE_SWAP = EYE_EXP.includes(name);
          if (EYE_SWAP && (weight[name] > 0.5) !== (target > 0.5)) { blink.start = now - 0.07 * 1000; blink.next = Math.max(blink.next, now + 1500); }
          const w = weight[name] = EYE_SWAP ? target : (weight[name] || 0) + (target - (weight[name] || 0)) * Math.min(1, dt * 6);
          if (w < 0.01) continue;
          for (const entry of params) {
            if (entry.Blend === "Multiply") multiplyParam(entry.Id, entry.Value, w);
            else if (entry.Blend === "Add") addParam(entry.Id, entry.Value, w);
            else setParam(entry.Id, entry.Value, w);
          }
        }
      };
      // ---- 왼손 가슴 가리기 (팔 궤적은 character/motion.js coverForearm). 내릴 땐 같은 길을 거꾸로 ----
      /** 왼손 가슴 가리기 진행(올리는 데 0.38초, 내릴 땐 같은 길을 거꾸로)과 팔 파라미터 쓰기 */
      const writeCoverChest = ({ now, dt, seconds }: Frame) => {
        const leaning = now < touchLeanUntil || touchLean < -2;   // 앞으로 숙이는 동안엔 손을 움직이지 않음
        const want = now >= cover.start && now < cover.until && bodyWeight < 0.5 && fleeX === 0 && !leaning;   // 꼬마·산책·도망 중에도 안 함
        const coverBefore = cover.q;
        cover.q = clamp(cover.q + (want ? 1 : -1) * dt / 0.38, 0, 1);   // 올리는 데 0.38초
        if (cover.q > 0) {
          const coverAmount = cover.q;
          const forearm = coverForearm(coverAmount);
          const breath = Math.sin(seconds * Math.PI * 2 * 0.4) * 0.02 * sstep(seg(0.8, 1, coverAmount));   // 가린 채로도 미세하게 움직임
          const velocity = (cover.q - coverBefore) / Math.max(dt, 1e-3);   // 움직이는 중에만 손목이 늦게 따라오며 꺾임
          setParam(PARAMS.armFrontPose, 1);   // 몸 앞용 팔 그림 (손이 다 내려올 때까지 유지)
          addParam(PARAMS.upperArmLeft, 0.034 * sstep(coverAmount));
          addParam(PARAMS.upperArmDepthLeft, 0.48 * sstep(seg(0, 0.6, coverAmount)));   // 위팔 원근은 아래팔보다 먼저
          addParam(PARAMS.forearmLeft, forearm + breath);
          addParam(PARAMS.wristLeft, clamp(velocity * 0.06, -0.2, 0.2) * Math.sin(Math.PI * coverAmount));
        }
      };
      // ---- 소품·옷·체형 (플러그인 설정 → prefs.outfit) ----
      /** 소품·옷 파라미터를 켠 정도(outfitWeight)만큼 서서히 더하기 */
      const writeOutfitParams = (outfit: Record<string, any>, dt: number) => {
        for (const [key, id, value] of OUTFIT_PARAMS) {
          const w = outfitWeight[key] = (outfitWeight[key] || 0) + ((outfit[key] ? 1 : 0) - (outfitWeight[key] || 0)) * Math.min(1, dt * 6);
          if (w > 0.005) addParam(id, value * w);
        }
      };
      /**
       * 동물귀 숨김: 파라미터가 아니라 귀 파트(PARTS.animalEars)의 opacity 보간. 파트가 없으면 no-op
       * bbox·크기·다른 파트는 건드리지 않음. 완전히 복구된 프레임에서만 opacity를 1로 되돌림
       */
      const writeEarHide = (outfit: Record<string, any>, dt: number) => {
        const earWas = earWeight;
        earWeight = earOpacityStep(earWeight, outfit.earHide === true, dt);
        if (earPartIndex >= 0) {
          if (earWeight > 0.005) applyEarOpacity(cubismModel.parts, earPartIndex, earWeight);
          else if (earWas > 0.005) cubismModel.parts.opacities[earPartIndex] = 1;
        }
      };
      /** 세숫대야와 체형 파라미터 쓰기 (산책·절전으로 나갈 때는 꼬마 모습, 꼬마 모습만큼 모델을 아래로) */
      const writeBodyShape = (outfit: Record<string, any>, now: number, dt: number) => {
        const walkingBody = walk.phase === "out" || walk.phase === "away" || walk.phase === "in" || SLEEP.state === "leaving" || SLEEP.state === "waking";   // 산책은 꼬마 모습으로 (데스크톱 펫과 같음)
        basinWeight += ((now < basinUntil ? 1 : 0) - basinWeight) * Math.min(1, dt * 4);   // 세숫대야는 천천히 씌우고 천천히 벗음
        if (basinWeight > 0.005) addParam(PARAMS.basinProp, basinWeight);
        bodyWeight += ((walkingBody ? 1 : BODY_VALUE[outfit.bodyType] || 0) - bodyWeight) * Math.min(1, dt * 4);   // 체형은 조금 천천히 바뀜
        if (bodyWeight > 0.002) addParam(PARAMS.bodyType, bodyWeight);
        model.y = baseY + chibiDrop * clamp(bodyWeight, 0, 1);
      };
      /** 소품·옷·체형을 켜는 순간 한마디 (처음 불러올 때는 말 안 함), 이번 설정을 다음 비교용으로 보관 */
      const talkOutfitChange = (outfit: Record<string, any>) => {
        if (outfitPrev && outfitTalk) {   // 켜는 순간 한마디 (처음 불러올 때는 말 안 함)
          for (const [key] of OUTFIT_PARAMS) if (outfit[key] && !outfitPrev[key]) outfitTalk(OUTFIT_LINE[key]);
          if ((outfit.bodyType || "default") !== (outfitPrev.bodyType || "default")) outfitTalk("body_" + (outfit.bodyType || "default"));
        }
        outfitPrev = { ...outfit };
      };
      /** 소품·옷·귀 숨김·체형 단계 (prefs.outfit 기준) */
      const writeOutfit = ({ now, dt }: Frame) => {
        const outfit = prefs.outfit || {};
        writeOutfitParams(outfit, dt);
        writeEarHide(outfit, dt);
        writeBodyShape(outfit, now, dt);
        talkOutfitChange(outfit);
      };
      internalModel.motionManager.expressionManager = {
        /** 정리할 것 없음 (Live2D 표정 매니저 자리 채우기용) */
        destroy() {},
        /** 한 프레임의 절차 애니메이션: 위 단계들을 정해진 순서대로 실행 (dt는 0.05초 상한) */
        update() {
          const now = performance.now(), dt = Math.min(0.05, (now - lastFrameAt) / 1000); lastFrameAt = now;
          updateChestDrag(now, dt);
          const frame = frameContext(now, dt);
          updateEnergy(frame);
          updateGaze(frame);
          updateSpeech(frame);
          updateMoodPose(dt);
          const motion = baseMotion(frame);
          applyGesture(motion, frame);
          applyTouchAndShiver(motion, frame);
          applyWalk(motion, frame);
          applyCarry(motion, frame);
          const sulk = applySulk(motion, frame);
          writeHeadBody(motion);
          writeEyes(motion, frame, sulk);
          writeBrows(frame);
          writeMouth(motion, frame, sulk);
          writeBlink(motion, frame);
          writeExpressions(frame);
          writeCoverChest(frame);
          writeOutfit(frame);
        },
      };

      // ---------- 터치 (데스크톱 펫과 같은 부위 판정) ----------
      // 대사: 펫 코드(lines.js)에 든 기본 대사 + 기본 대사가 없는 상황만 짧게 채움. [표정] 꼬리표로 표정 지정.
      const LINES: Record<string, string[]> = {
        head: [
          "[어두운, 얄미운] …거긴, 그렇게 쓰다듬지 마세요. 버릇 들면 어쩌려고요.",
          "[어두운, 얄미운] …주인님, 그 손… 계속 두실 생각이세요?",
          "[어두운, 얄미운] …한 번만 봐드리는 거예요.",
          "[어두운, 얄미운] …머리카락 엉키면, 내일 아침에 빗겨 주셔야 해요.",
          "[어두운, 얄미운] …손 놓으세요. 그렇게 보시면… 저도 참아야 하잖아요.",
          "[어두운, 얄미운] …이번엔 그냥 넘어갈게요. 착한 척은 여기까지예요.",
        ],
        head_sulk: [
          "[홍조] 흥! 그럼 오늘은 안아 드리지 않을 거예요!",
          "[홍조] 흥, 나중에 후회하실 거예요…!",
          "[홍조] …만질 거면, 아예 달래 주시던가요.",
          "[홍조] 흥! 등 돌리고 있을 거예요. …곁에 있으면 안 되지만.",
          "[홍조] …한 번만 더 그러시면, 진짜 삐질 거예요.",
        ],
        head_after: [
          "[홍조] …이번만 봐주는 거예요. 다음엔… 각오하세요.",
          "[홍조] …다음엔 진짜, 책임지셔야 해요.",
          "[홍조] 후… 이제 됐어요. …손은 아직 놓지 마시고요.",
          "[홍조] …이번 일은 비밀로 해 드릴게요. 대신, 나중에.",
          "[홍조] …주인님 나쁜 손. 오늘은 그렇게 기억해 둘게요.",
        ],
        // 소품·옷·체형을 바꿨을 때 (데스크톱 펫 대사.md와 같은 대사)
        outfit_glasses: [
          "안경 쓴 비서… 오늘 밤은 엄격하게 굴어 드릴까요, 주인님?",
          "이런 지적인 얼굴… 마음에 드세요? 렌즈 너머로 다 보여요♪",
          "주인님 취향이… 이런 쪽이었나요? 메모해 둘게요♪",
          "안경 쓴 채로 보는 얼굴… 꽤 위험한데요. 감당하시겠어요?",
          "선생님, 숙제 다 했어요. …칭찬은 어떻게 해 주실 거예요?",
        ],
        outfit_shoes: [
          "주인님 앞에서 신발까지 벗다니… 이제 도망칠 데도 없네요",
          "[홍조] 앗… 맨발을 그렇게 보시면… 발끝이 저려요…",
          "바닥이 차가워요… 안아 올려 주실 거죠?",
          "[얄미운] 발끝만 보시는 거예요? …조금 서운한데요.",
        ],
        outfit_tail: [
          "꼬리 숨기니… 기분을 들키지 않겠네요♪ …입꼬리는 못 숨기지만요",
          "쉿, 이건 주인님만 아는 거예요~",
          "[얄미운] 꼬리로 감으면… 붙잡히지 않을 자신 있는데요?",
          "꼬리 끝까지 다 보이니까… 이제 숨기는 건 없네요.",
        ],
        outfit_clothes: [
          "[홍조] 앗… 이 옷, 생각보다 몸에 붙어서… 시선이 어디 가는지 아시죠?",
          "에헤헤, 좋다면… 조금 더 가까이 가도 돼요…",
          "[><, 홍조] 주, 주인님… 눈이 너무 노골적이세요…!",
          "[하트] 이 정도면… 만족하실 수 있어요? 아니면… 더?",
          "[홍조] 움직일 때마다… 느껴져서, 조금 곤란해요…",
          "[얄미운] 굳이 안 벗어도 괜찮죠. …필요하시면 말씀하시고요♪",
        ],
        body_default: [
          "익숙한 몸으로 돌아왔네요… 이게 제일 좋으시죠? 다 보이는데요",
          "원래 모습으로 복귀 완료! …다시 유혹해 볼까요♪",
          "역시 익숙한 게 좋으세요? …손이 먼저 움직이시네요.",
          "이 모습이 가장 편하다고… 그렇게 말씀하셨죠? 잘 기억해요.",
        ],
        body_type1: [
          "어라… 몸매가 달라 보이지 않나요, 주인님? …어디가요?",
          "평소보다 색다른 느낌인데… 직접 확인하실 거예요?",
          "이 몸엔… 주인님 시선이 더 붙는 것 같네요. 기분 탓인가요?",
          "[얄미운] 어느 쪽이 마음에 드세요? …정직하게 말해 주세요.",
        ],
        body_type2: [
          "앗, 작아졌어요! …안아 주시면 커질지도 몰라요♪",
          "[하트] 꼬마 모습이 됐어요… 무릎에 앉혀 주세요~",
          "작아도… 할 일은 다 할 수 있어요. 믿어 주세요♪",
          "[하트] 이 모습, 귀여우세요? …아니면 다른 게 좋으세요?",
          "작은 손으로도… 주인님 옷자락은 잘 잡아요.",
        ],
        basin_on: [
          "[하트] 밥 먹을 시간이에요? …입 벌려 주세요♪",
          "[얄미운] 세숫대야 쓴 채로 먹는 거… 생각보다 불편해요.",
          "잘 먹을게요. …다 먹으면 칭찬해 주세요.",
        ],
        pot_guard: [
          "[얄미운] 후훗, 이 정도는… 주인님 손길보다 약해요~",
          "[얄미운] 후훗, 제가 막을 줄 몰랐죠? 칭찬해 주세요♪",
          "[하트] 방어 성공이에요! 이번 판은 제 승리네요.",
          "[얄미운] 냄비보다 가벼운 손길이었어요. 아쉽네요♪",
          "[하트] 막았으니까… 이제 쓰다듬어 주실 차례죠?",
        ],
        pot_hit: [
          "[눈물] 아야야…! 머리 아파요…",
          "[눈물] 으앗! 별이 보여요…",
          "[눈물] …방금 그거 냄비였죠?!",
          "[눈물] 이마가… 좀 부풀었죠? 나중에 불어 주세요…",
          "[눈물] 아파서 그래요… 잠깐만 안아 주세요. 진짜로.",
        ],
        walk_out: [
          "산책 좀 다녀올게요~ …따라오시면 안 돼요♪",
          "잠깐 바람 쐬고 올게요! 몸 좀 풀고요",
          "다리 좀 풀고 올게요~ 금방 올게요",
          "혼자 걷는 게 좋아요. …돌아올 땐 옆에 있어 주세요.",
          "바람이 좋아서요. 이 기분, 같이 나누고 싶네요.",
        ],
        walk_back: [
          "다녀왔어요! …기다리셨죠? 얼굴에 쓰여 있어요♪",
          "산책 끝! 그새 보고 싶으셨어요?",
          "[하트] 다녀왔어요~ 안아 주세요.",
          "금방 다녀왔는데… 왜 벌써 반가운 거예요.",
          "[홍조] 발이 차가워졌어요… 손 좀 잡아 주시겠어요?",
        ],
        body: [
          "[하트] 불렀어요? …손, 잡아 주세요.",
          "[홍조] 왜요… 그렇게 빤히 보시면 더 부끄러운데.",
          "[얄미운] 흐응~? 만지고 싶으신 거죠?",
          "[식은땀] 앗, 깜짝이야! …놀라면 심장에 안 좋아요.",
          "[하트, 홍조] 오늘도 화이팅이에요! …조금 가까이 있어도 돼요?",
          "[얄미운] 그렇게 부르시면… 거절할 수 없잖아요.",
          "[홍조] 옆에 있으면 마음이 놓여요. …그러니까 계속 있어 주세요.",
          "[하트] 한 번 불러 주시면… 하루 종일 기분이 좋아요.",
        ],
        arm: [
          "[홍조] 손 잡고 싶으신 거예요? …놓치면 안 돼요.",
          "[홍조] 팔은 왜요~? …팔찌라도 채워 주실 거예요?",
          "[얄미운] 그렇게 붙잡으면… 도망칠 맘도 없어지잖아요.",
          "손끝이 따뜻해요… 조금만 더 있어 주세요.",
          "[홍조] 팔에 힘이 들어오시는데… 저, 이러면 못 움직여요.",
        ],
        leg: [
          "[식은땀, 홍조] 다, 다리는… 아직 안 돼요…!",
          "[식은땀, 홍조] 거기 만지면… 힘이 확 풀려요…!",
          "[홍조, ><] 으… 무릎은… 그렇게 안아 주시면 안 돼요…!",
          "[식은땀, 홍조] 서 있는 것도 벅차요… 놓아 주세요…",
          "[홍조, 하트] 거기, 감각이 예민하다니까요…",
        ],
        chest1: [
          "[홍조, 얄미운] 앗… 거긴… 그렇게 세게 하면 안 돼요.",
          "[홍조, 얄미운] 제 반응이 그렇게 궁금하세요…? 나쁜 주인님.",
          "[홍조, ><] 잠깐… 거기, 옷 위로도 다 느껴져요…",
          "[홍조, 얄미운] 손끝이… 너무 정확하신데요…?",
          "[홍조, 얄미운] 한 번은 봐드릴게요… 딱 한 번만이에요.",
          "[홍조, ><] 아… 그렇게 갑자기 만지시면… 숨이 멈춰요…",
          "[홍조, 얄미운] 앗…! 아직 마음의 준비도 안 했는데요…",
          "[홍조, ><] 손… 손이 너무 빨라요…!",
          "[홍조, 얄미운] 그렇게 놀라게 하시면… 반응이 다 보이잖아요.",
          "[홍조, ><] 잠깐… 여기, 사람 있는 데서는…",
          "[홍조, 하트] 지금… 일부러 그러신 거죠?",
          "[홍조, 얄미운] 옷 위로도 이렇게 느껴지는데… 어쩌죠?",
          "[홍조, ><] 앗… 그 손가락, 거기 두지 마세요…",
          "[홍조, 식은땀] 하… 갑자기 숨이 막혀서…",
          "[홍조, 얄미운] 주인님은… 이런 거 잘 아시네요.",
          "[홍조, 하트] 한 번만… 정말 한 번만이라고 했는데.",
          "[홍조, ><] 으… 이거, 웃으면서 넘길 일이 아니에요…",
          "[홍조, 얄미운] 거기, 손끝이 아직도 남아 있는데요…",
          "[홍조, 식은땀] 숨… 조금만 정리하게 해 주세요.",
          "[홍조, ><] 아… 아직 마음 준비가…",
          "[홍조, 하트] 그렇게 만지시면… 저, 나중에 못 참아요.",
          "[홍조, 얄미운] 한 번 더 하시면… 저도 방법을 생각해 볼게요.",
          "[홍조, ><] 앗, 거긴… 옷이 얇아서…",
          "[홍조, 식은땀] 잠깐만… 손 좀 내려 주세요… 아니, 그대로…",
          "[홍조, 하트] 지금 그 표정… 마음에 들어요.",
          "[홍조, 얄미운] …이번 건, 나중에 청구할 거예요.",
        ],
        chest2: [
          "[하트, 홍조] 자꾸 그러면… 숨소리가 이상해지잖아요!",
          "[하트, 홍조] 으으… 장난치지 말아 주세요… 손에 힘이 없어져요…",
          "[하트, 홍조] 하아… 그렇게 만지작거리면… 저도 모르게 몸이…",
          "[홍조, 식은땀] 잠깐… 이거, 그만두실 생각 없으시죠…?",
          "[하트, 홍조] 주인님 손… 너무 따뜻해서 자꾸 기대게 돼요…",
          "[하트, ><] 으… 소리 내면 안 되는데… 참는 게 더 힘들어요…",
          "[하트, 홍조] 제가… 이상한 표정 짓고 있죠? 보지 마세요…",
          "[홍조, 식은땀] 손 떼 주세요… 이대로면 제가 먼저 무너져요…",
          "[하트, 홍조] 하아… 이제… 자꾸 손이 가잖아요…",
          "[하트, ><] 으… 숨소리, 주인님한테 다 들려요…",
          "[하트, 홍조] 잠깐만… 저, 지금 표정 관리가 안 돼요…",
          "[홍조, 식은땀] 하… 거기, 계속 만지면… 무릎 힘이…",
          "[하트, 홍조] 주인님 손, 왜 이렇게 따뜻해요…",
          "[하트, ><] 으으… 이러면 저, 아무 말도 못 해요…",
          "[하트, 홍조] 자꾸 그러시면… 제가 먼저 손을 잡을지도 몰라요.",
          "[홍조, 식은땀] 하아… 이거, 장난이 아니잖아요…",
          "[하트, 홍조] 소리… 소리 내면 안 되는데…",
          "[하트, ><] 잠깐… 살짝만… 천천히…",
          "[홍조, 하트] 저… 지금 얼굴, 보지 마세요…",
          "[하트, 홍조] 심장이 너무 뛰어서… 주인님 손에 다 느껴질 거예요.",
          "[하트, ><] 으… 옷자락 좀… 정리하게 해 주세요…",
          "[홍조, 식은땀] 하아… 이대로 있으면… 저, 이상해져요…",
          "[하트, 홍조] 주인님… 이거, 언제 멈추실 거예요…?",
          "[하트, ><] 아… 아직… 마음 준비 안 됐다니까요…",
          "[홍조, 하트] 손끝이 움직일 때마다… 저도 따라 움직여요…",
          "[하트, 식은땀] 잠깐… 숨 좀… 쉬게 해 주세요…",
          "[하트, 홍조] 이런 거… 익숙해지면 안 되는데…",
          "[홍조, ><] 주인님… 웃지 마세요… 지금 제가 우습죠…?",
        ],
        chest3: [
          "[하트, 홍조] 이제… 진짜 부끄러우니까 잠깐만요!",
          "[홍조, 식은땀] 더 하시면… 저, 가만히 못 있어요…!",
          "[하트, 눈물] 그만… 그만해 주세요… 심장이 터질 것 같아요…",
          "[하트, 홍조] 주인님… 이러다 정말… 되돌릴 수 없게 돼요…",
          "[홍조, ><] 으으… 이제 팔에 힘이 안 들어가요…",
          "[홍조, 식은땀] 이제… 정말 그만해 주세요…!",
          "[하트, 눈물] 으으… 저, 이제 한계예요…",
          "[홍조, ><] 더 하시면… 쓰러질지도 몰라요…",
          "[하트, 식은땀] 잠깐… 잠깐만… 숨이…",
          "[홍조, 눈물] 주인님… 이러다 진짜…!",
          "[하트, ><] 으아… 이제 팔에 힘이…",
          "[홍조, 식은땀] 그만… 부탁이에요… 이러다간…",
          "[하트, 눈물] 저… 눈물 날 것 같아요…",
          "[홍조, ><] 잠깐… 이건… 너무해요…",
          "[하트, 식은땀] 하아… 아직… 끝난 것도 아닌데…",
          "[홍조, 눈물] 주인님… 손… 놓아 주세요… 아니, 그대로…",
          "[하트, ><] 으으… 이제… 아무 생각도 안 나요…",
          "[홍조, 식은땀] 잠깐만… 머리가… 어지러워요…",
          "[하트, 눈물] 이러다… 저, 울어 버릴 것 같아요…",
          "[홍조, ><] 제발… 조금만 쉬게 해 주세요…",
          "[하트, 식은땀] 하아… 지금 제 얼굴… 부끄러워요…",
          "[홍조, 눈물] 주인님은… 진짜… 못 말리겠어요…",
          "[하트, ><] 으으… 이제… 제가 뭘 하는지도…",
          "[홍조, 식은땀] 이제… 정말 안아 주세요… 그만하고…",
          "[하트, 눈물] …이번엔, 제가 먼저 항복할게요…",
        ],
        chest_calm: [
          "[하트, 홍조] 후우… 심장이 아직도 두근거려요.",
          "[홍조, 얄미운] …이제 진정됐어요. 다음엔 각오하세요.",
          "[하트, 홍조] 이런 얼굴… 처음 보여 드리는 거예요.",
          "[홍조] …잠깐만 이대로 있게 해 주세요. 아직 다리가 후들거려요.",
          "[하트, 홍조] 후… 아직… 다리 힘이 안 들어오네요.",
          "[홍조] …조금만 더 이렇게 있어 주세요.",
          "[하트, 홍조] 이제… 말할 수 있을 것 같아요. …아니, 아직.",
          "[홍조, 얄미운] …다음엔, 제가 먼저 할지도 몰라요.",
          "[하트] 자꾸 생각나요… 아까 그 느낌.",
          "[홍조] …지금 얼굴 보이면 안 되는데, 늦었죠.",
          "[하트, 홍조] 숨은 돌아왔는데… 마음이 안 진정돼요.",
          "[홍조, 얄미운] …주인님 손, 인제 다 알겠네요.",
          "[하트] 이런 거… 자주 하면 저 먼저 지치는 거 아닐까요.",
          "[홍조] …앉아 있을게요. 잠깐만.",
          "[하트, 홍조] 손, 아직 떼지 마세요… 아니, 떼 주세요…",
          "[홍조, 얄미운] …오늘 일은, 저만 아는 걸로 해 둘게요.",
          "[하트] 심장… 아직도 응원 소리 같아요.",
          "[홍조] …다음에 또 그러실 거죠? 대답 안 하셔도 알아요.",
          "[하트, 홍조] 이제 제 눈 똑바로 못 보세요, 주인님.",
          "[홍조, 얄미운] …손끝, 기억났어요. 이 정도면 됐죠?",
          "[하트] 잠깐… 웃음이 안 멈춰요. 이상하죠.",
          "[홍조] …저 더워요. 창문 좀…",
          "[하트, 홍조] 이제 조금… 진정되었어요. 조금만요.",
          "[홍조, 얄미운] …다음엔 안 봐드릴 거예요. 진짜로.",
        ],
        chest_pull: [
          "[홍조, ><] 아흣…?! 그, 그쪽은…!",
          "[홍조, ><] 히잇…! 거기 잡으면… 몸이 이상해져요…!",
          "[홍조, 하트] 으으… 거긴… 예민한 데라고요…",
          "[홍조, ><] 자, 잠깐… 그렇게 당기면… 모양이…!",
          "[홍조, 식은땀] 하앗…! 손… 힘 좀 빼 주세요… 숨이…",
          "[홍조, 하트] 으… 그렇게 만지면… 몸에 힘이 하나도 안 들어가요…",
          "[홍조, ><] 주, 주인님…! 이런 건… 밤에 하세요…!",
          "[홍조, 하트] 하아… 일부러 그러시죠… 재미있으세요…?",
          "[홍조, ><] 엇…! 거기, 위로… 그렇게 끌어올리면…!",
          "[홍조, 식은땀] 으으으… 손대지 마세요… 아니, 놓지도 마시고요…",
          "[홍조, ><] 주인님 손가락… 너무 정확해요… 그런 데까지…",
          "[홍조, 하트] 숨이… 잘 안 쉬어져요… 조금만 천천히…",
          "[홍조, ><] 으앗…! 그렇게 한 번에…!",
          "[홍조, 식은땀] 하앗… 거기, 힘 빼면 안 돼요…",
          "[홍조, ><] 앗… 손이… 손이 떨려서…",
          "[홍조, 하트] 그만… 위로 올리지 마세요…",
          "[홍조, ><] 으으… 이거, 생각보다…!",
          "[홍조, 식은땀] 잠깐… 숨이… 안 쉬어져요…",
          "[홍조, ><] 아… 옷이… 옷이 걸려서…",
          "[홍조, 하트] 주인님… 조금만… 살살요…",
          "[홍조, ><] 으… 거긴 잡는 게 아니에요…",
          "[홍조, 식은땀] 하아… 이러다 진짜…",
          "[홍조, ><] 손가락… 하나씩 다 느껴져요…",
          "[홍조, 하트] 잠깐만… 마음 준비…",
          "[홍조, ><] 아앗… 조금만 천천히…!",
          "[홍조, 식은땀] 으으… 저, 소리 낼 것 같아요…",
          "[홍조, ><] 주인님… 이거, 놀이가 아니죠…?",
          "[홍조, 하트] 그렇게 당기시면… 몸이 따라올라와요…",
          "[홍조, ><] 잠깐… 손이 미끄러져요…!",
          "[홍조, 식은땀] 하… 하아… 조금만 쉬게…",
          "[홍조, ><] 거기… 정말 예민하다니까요…",
          "[홍조, 하트] …계속 이러시면, 저도… 각오할게요.",
        ],
        chest_pull_long: [
          "[홍조, 하트] 하아… 아직도… 놓지 않으실 거예요…?",
          "[홍조, ><] 으으… 이러다간… 제가 먼저… 이상해져요…",
          "[홍조, 하트] 잠깐… 그만… 몸에 힘이 풀려서… 녹아내릴 것 같아요…",
          "[홍조, 식은땀] 하앗… 손 떼 주세요… 이러다… 소리 낼지도 몰라요…",
          "[홍조, 하트] 주인님… 너무해요… 이런 건… 반칙이라고요…",
          "[홍조, ><] 히으… 계속 그러시면… 저… 참을 수 없어요…",
          "[홍조, 하트] 으… 머리가… 하얘져서… 아무것도 안 보여요…",
          "[홍조, 얄미운] 하아… 이렇게까지 하실 거면서… 놀리기만 하시고…",
          "[홍조, 하트] 하아… 이거… 언제까지 하실 거예요…?",
          "[홍조, ><] 저… 이미… 참는 게 한계예요…",
          "[홍조, 하트] 제발… 조금만… 아니, 조금만 더…",
          "[홍조, ><] 주인님… 이러다 제가 먼저 손을… 아니에요, 아무것도 아니에요…",
          "[홍조, 하트] 하아… 아직… 계속하시는 거예요…?",
          "[홍조, ><] 으응… 이제… 어지러워요… 기분 좋게…",
          "[홍조, 하트] 잠깐… 저… 지금 제 목소리 이상하죠…",
          "[홍조, 식은땀] 하앗… 손가락 힘… 조금만 빼 주세요…",
          "[홍조, ><] 으으… 이러다간… 진짜 소리 질러요…",
          "[홍조, 하트] 주인님… 저… 이상해요… 몸이…",
          "[홍조, ><] 히으… 머리가… 자꾸 새하얘져요…",
          "[홍조, 식은땀] 잠깐만… 이대로면… 제가 먼저 손을 뻗어요…",
          "[홍조, 하트] 흔들지 마세요… 그럼… 더…",
          "[홍조, ><] 으… 그만… 아니, 아직…",
          "[홍조, 하트] 하아… 이제 정말… 한계에 가까워요…",
          "[홍조, ><] 주인님… 이러다 저… 참지 못해요…",
          "[홍조, 식은땀] 손… 손을… 놓을 수가 없잖아요…",
          "[홍조, 하트] 하앗… 이거… 오래 하시면 저… 녹아요…",
          "[홍조, ><] 으으… 숨… 숨이 안 나와요…",
          "[홍조, 하트] 이제… 조금만 더하면… 저…",
          "[홍조, ><] 잠깐… 눈물 날 것 같아요… 이상하게…",
          "[홍조, 식은땀] 하아… 주인님… 이거… 정말 반칙이에요…",
          "[홍조, 하트] …계속 이러시면, 오늘 밤 못 자요…",
          "[홍조, ><] 으… 이제… 그만… 정말로 그만…",
        ],
        chest_pull_dizzy: [
          "[어지럼, 홍조] 으으… 자꾸 흔들면… 어지러워요…",
          "[어지럼, 홍조] 잠깐… 세상이… 빙글빙글 돌아요…",
          "[어지럼, 하트] 아이… 머리가 핑 돌아서… 못 서겠어요…",
          "[어지럼, 식은땀] 하아… 그만… 눈앞이 흔들려요…",
          "[어지럼, 홍조] 으… 어지러워서… 잠깐만 기대도 돼요…?",
        ],
        chest_drop: [
          "[홍조, ><] 꺅!",
          "[홍조, 눈물] 꺅…! 이, 이건 반칙이에요…!",
          "[홍조, 하트] 하아… 갑자기 놓으면… 몸이 아직… 어지러워요…",
          "[홍조, 식은땀] 아… 아직… 감각이 안 돌아와요…",
          "[홍조, ><] 으으… 다리 힘이… 풀려 버렸잖아요…",
          "[홍조, 하트] 잠깐만… 심장이 너무 뛰어서… 숨 좀 돌릴게요…",
          "[홍조, 눈물] 부, 부끄러워서… 얼굴을 못 들겠어요…",
          "[홍조, 얄미운] …이번엔 봐드린 거예요… 다음엔… 각오하세요…",
          "[홍조, 하트] 아… 아직 거기… 감각이 남아 있어요…",
          "[홍조, 식은땀] 이 상태로 일어나면… 다리에 힘이 안 들어가요…",
          "[홍조, ><] 주인님… 이거… 책임지실 거죠…?",
          "[홍조, 눈물] 하아… 창피해서 어디 숨고 싶어요…",
          "[홍조, ><] 하앗…!",
          "[홍조, 눈물] 아… 아직… 아직 거기…",
          "[홍조, 하트] 으으… 갑자기 놓으면… 몸이 휘청…",
          "[홍조, 식은땀] 하아… 다리에 힘 안 들어가요…",
          "[홍조, ><] 잠깐… 숨… 돌릴 시간…",
          "[홍조, 하트] 주인님… 손 좀… 놓지 마세요…",
          "[홍조, 눈물] 이제… 이제 된 거예요…?",
          "[홍조, ><] 으으… 아직… 여운이…",
          "[홍조, 식은땀] 하아… 이러면… 일할 수가 없어요…",
          "[홍조, 하트] 잠깐만… 마음이… 안 정리돼요…",
          "[홍조, ><] 아… 아직 감각이… 남아 있어요…",
          "[홍조, 눈물] 부끄러워… 부끄러워요…",
          "[홍조, 식은땀] 이제… 제 얼굴… 다 보였죠…?",
          "[홍조, 하트] 놓고 나니까… 더… 이상해요…",
          "[홍조, ><] 으으… 다리… 풀렸어요…",
          "[홍조, 눈물] 주인님… 이거… 저만 아는 거예요…",
          "[홍조, 식은땀] 하아… 물 좀… 마실 수 있게…",
          "[홍조, ><] 잠깐… 그 자리에… 서 있을게요…",
          "[홍조, 하트] …이번엔, 제가 진 거네요…",
          "[홍조, 눈물] …다음엔, 조용한 데서 해요… 제발요…",
        ],
        lower1: [
          "[홍조, 식은땀] 거, 거기는… 치마는 안 돼요…!",
          "[홍조, 식은땀] 거기 만지면… 정말 화낼 거예요…!",
          "[홍조, ><] 으… 치마 자락… 놓아 주세요…!",
          "[홍조, 식은땀] 거긴… 스스로도 함부로 안 만지는 데예요…",
          "[홍조, ><] 주인님… 그 손, 지금 위험한 거 아세요…?",
        ],
        lower2: [
          "[홍조, ><] 진짜… 이러시면 오늘 밤은 안 자요…!",
          "[홍조, ><] 그만해 주세요… 제발…!",
          "[홍조, 식은땀] 으으… 이러다 진짜 소리 질러요…!",
          "[홍조, ><] 한 번만 더 하시면… 정말로 삐질 거예요…",
          "[홍조, 눈물] 주인님… 지금 표정… 무서워요… 아니, 좋아요…",
        ],
        lower3: [
          "[><, 식은땀] 히익…!",
          "[><, 눈물] 으아…! 이제 진짜…!",
          "[><, 식은땀] 잠깐…! 거기… 진짜 안 돼요…!",
        ],
        lower_after: [
          "[홍조, 눈물] …다시는 그러지 마세요. 진짜예요.",
          "[홍조, 눈물] 흥… 이번만 봐준 거예요.",
          "[홍조] …나중에, 조용한 데서 다시 얘기해요.",
          "[홍조, 얄미운] 이번 일은… 둘만 아는 걸로 해요.",
          "[홍조, 눈물] 흥… 이제 저 멀리 가 있을 거예요.",
        ],
        spam: [
          "[어두운, 얄미운] …그만 좀 눌러요. 반응 다 보이잖아요.",
          "[어두운, 얄미운] …주인님, 손가락이 너무 성실하시네요.",
          "[어두운, 얄미운] …부탁인데, 잠깐만 쉬어 주세요.",
        ],
        makeup: [
          "[홍조] …이제 안 누르실 거죠? 약속하세요.",
          "[홍조] …이번엔 넘어갈게요. 대신 기억해 둘게요.",
          "[홍조] …이제 진정하셨어요? 저는 아직인데.",
        ],
        working: [
          "[식은땀] 지금 일하는 중이에요~ …나중에 하세요, 나중에♪",
          "[식은땀] 잠깐만요… 지금 집중해야 하는데… 손이 자꾸…",
          "[식은땀] 일 끝나면… 그때 만져 주세요. 약속하시고요.",
          "[식은땀] 으… 지금 그러시면 작업이 안 끝나요…",
        ],
        sleep_out: [
          "잠깐 쉬고 올게요~ …그리워하시면 금방 와요♪",
          "절전 모드 들어갑니다~ 불러 주시면 바로요!",
          "좀 쉬었다 올게요, 주인님♪ …꿈에서 봬요.",
          "눈 좀 붙이고 올게요. …몰래 보고 계시면 안 돼요.",
          "충전하러 갑니다~ 다녀오면 안아 주세요.",
        ],
        sleep_back: [
          "다녀왔어요! …보고 싶으셨죠?",
          "돌아왔어요! 기다리게 해서 죄송해요♪",
          "[하트] 부르셨죠? …이리 와요.",
          "푹 잤더니… 얼굴이 좋아 보이세요, 주인님.",
          "[홍조] 자는 동안… 계속 곁에 있으셨어요?",
        ],
      };
      const EXP_NAME: Record<string, string> = { "홍조": "blush", "><": "squint", "하트": "heart", "얄미운": "smug", "식은땀": "sweat", "어두운": "dark", "눈물": "tears", "어지럼": "dizzy" };
      const lastLine: Record<string, number> = {};
      /**
       * 상황별 대사 중 하나를 골라 말풍선 표시. [표정] 꼬리표가 있으면 그 표정도 같은 시간 동안 켬
       * @param key LINES의 상황 키
       * @param ms 말풍선·표정 표시 시간
       */
      const speak = (key: string, ms = 3500) => {
        const list = LINES[key]; if (!list) return;
        // 연속 터치에서 같은 대사가 또 나오지 않게: 화면에 떠 있던 직전 문장과 같은 후보는 뺀다
        const candidates = [];
        for (let i = 0; i < list.length; i++) {
          if (list.length > 1 && i === lastLine[key]) continue;   // 같은 상황의 직전 대사도 제외
          const raw = list[i], tagMatch = raw.match(/^\[([^\]]+)\]\s*/);
          const text = tagMatch ? raw.slice(tagMatch[0].length) : raw;
          if (text === lastSayText) continue;                     // 방금 띄운 문장과 겹치면 제외
          candidates.push({ i, text, exp: tagMatch ? tagMatch[1] : "" });
        }
        if (!candidates.length) return;                           // 새로 할 말이 없으면 조용히 넘어감 (같은 대사 반복 방지)
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        lastLine[key] = pick.i;
        for (const n of pick.exp.split(",")) { const e = EXP_NAME[n.trim()]; if (e) flashExp(e, ms); }
        const text = pick.text;
        say(text, ms);
      };
      /** 소품·옷·체형을 바꿨을 때의 대사. 도망·산책·삐진 중에는 말 안 함 */
      outfitTalk = (key: string) => { if (fleeX === 0 && performance.now() >= sulkUntil) speak(key, 4000); };

      const drawables = cubismModel.drawables, parts = cubismModel.parts;
      const drawRegion = Array.from({ length: drawables.count }, (_, i) => {
        for (let part = drawables.parentPartIndices[i]; part >= 0; part = parts.parentIndices[part]) if (PART_REGIONS[parts.ids[part]]) return PART_REGIONS[parts.ids[part]];
        return null;
      });
      const chestDraw: number[] = [];
      for (let i = 0; i < drawables.count; i++) for (let part = drawables.parentPartIndices[i]; part >= 0; part = parts.parentIndices[part]) if (PARTS.chestCenter.includes(parts.ids[part])) { chestDraw.push(i); break; }
      /** 지금 보이는 가슴 메시들의 가운데(모델 좌표). 다 숨었으면 null */
      const chestCenter = () => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const i of chestDraw) {
          if (drawables.opacities[i] < 0.05) continue;
          const vertices = internalModel.getDrawableVertices(i);
          for (let j = 0; j < vertices.length; j += 2) { x0 = Math.min(x0, vertices[j]); x1 = Math.max(x1, vertices[j]); y0 = Math.min(y0, vertices[j + 1]); y1 = Math.max(y1, vertices[j + 1]); }
        }
        return x0 === Infinity ? null : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      };
      const chestBase = chestCenter();
      const bodyBounds = { minX, minY, w: maxX - minX, h: maxY - minY };   // 전신 그림 영역 (펫과 같은 기준)
      const ALPHA_SIZE = 512;
      let alphaMaps: (Uint8Array | null)[] | null = null;
      /** 텍스처마다 ALPHA_SIZE×ALPHA_SIZE 알파 지도 생성. 읽지 못한 텍스처는 null */
      const buildAlpha = () => {
        alphaMaps = model.textures.map((t: any) => {
          try {
            const alphaCanvas = life.own(document.createElement("canvas"), (node) => node.remove()); alphaCanvas.width = alphaCanvas.height = ALPHA_SIZE;
            const ctx = alphaCanvas.getContext("2d", { willReadFrequently: true })!;   // 실패하면 아래에서 예외 → null
            ctx.drawImage(t.baseTexture.resource.source, 0, 0, ALPHA_SIZE, ALPHA_SIZE);
            const pixels = ctx.getImageData(0, 0, ALPHA_SIZE, ALPHA_SIZE).data, alpha = new Uint8Array(ALPHA_SIZE * ALPHA_SIZE);
            for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
            return alpha;
          } catch { return null; }
        });
      };
      /**
       * 텍스처 좌표 자리의 알파값(0~255). 알파 지도가 없는 텍스처는 255(불투명)로 취급
       * @param textureIndex 텍스처 번호
       * @param u 텍스처 가로 좌표(0~1)
       * @param v 텍스처 세로 좌표(0~1, 아래가 0)
       */
      const alphaAt = (textureIndex: number, u: number, v: number) => {
        const alphaMap = alphaMaps![textureIndex]; if (!alphaMap) return 255;   // pickDrawable이 먼저 만든다
        return alphaMap[Math.min(ALPHA_SIZE - 1, Math.max(0, Math.floor((1 - v) * ALPHA_SIZE))) * ALPHA_SIZE + Math.min(ALPHA_SIZE - 1, Math.max(0, Math.floor(u * ALPHA_SIZE)))];
      };
      /** 터치를 받을 수 있는 drawable 여부. 귀는 earHide 감쇠 전 가시성으로 터치 판정 유지 */
      const touchable = (i: number) => earSet.has(i) ? earHitVisible(i) : !(drawables.opacities[i] < 0.05 || !(drawables.dynamicFlags[i] & 1));
      /**
       * 그 자리에서 가장 앞에 그려진, 그림(알파)이 있는 터치 가능 메시 찾기
       * @param x 캔버스(배율 1) x 좌표
       * @param y 캔버스(배율 1) y 좌표
       * @returns drawable 번호, 없으면 -1
       */
      const pickDrawable = (x: number, y: number) => {
        if (!alphaMaps) buildAlpha();
        const px = (x - model.x) / model.scale.x, py = (y - model.y) / model.scale.y;
        let best = -1, bestOrder = -Infinity;
        for (let i = 0; i < drawables.count; i++) {
          if (!touchable(i)) continue;
          const order = drawables.renderOrders[i];
          if (order <= bestOrder) continue;
          const vertices = internalModel.getDrawableVertices(i);
          const [x0, y0, x1, y1] = meshBounds(vertices);
          if (px < x0 || px > x1 || py < y0 || py > y1) continue;
          if (meshHit(vertices, drawables.indices[i], drawables.vertexUvs[i], px, py, (u, v) => alphaAt(drawables.textureIndices[i], u, v))) { best = i; bestOrder = order; }
        }
        return best;
      };
      /**
       * 꼬마 모습(체형 2)의 터치 부위. 가슴 반응 없이 머리(보이는 그림 위쪽 45%)·몸만 구분 (데스크톱 펫과 같음)
       * @param y 캔버스 y 좌표
       */
      const chibiRegion = (y: number) => {
        let y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < drawables.count; i++) {
          if (drawables.opacities[i] < 0.05) continue;
          const vertices = internalModel.getDrawableVertices(i);
          for (let j = 1; j < vertices.length; j += 2) { if (vertices[j] < y0) y0 = vertices[j]; if (vertices[j] > y1) y1 = vertices[j]; }
        }
        return ((y - model.y) / model.scale.y - y0) / (y1 - y0) < GEOMETRY.chibiHeadBottom ? "head" : "body";
      };
      /**
       * 부위 그림(drawRegion)과 가슴 타원·높이로 터치 부위 결정
       * @param region 누른 메시가 속한 부위 그림 이름(없으면 null)
       * @param ratioY 전신 그림 영역 안 세로 위치(0 = 위, 1 = 아래)
       * @param inChest 가슴 타원 안이면 true
       */
      const regionByShape = (region: string | null, ratioY: number, inChest: boolean) => {
        if (region === "head" && ratioY > GEOMETRY.headBottom) region = null;
        if (region === "arm" && cover.q > 0.3 && ratioY < GEOMETRY.coverArmBottom) return "chest";   // 왼손으로 가슴을 가린 동안엔 그 손을 눌러도 가슴 터치로 (반응이 이어지게)
        if (region === "arm" || region === "leg" || region === "head") return region;
        if (inChest) return "chest";
        if (region === "lower") return "lower";
        if (region === "waist") return ratioY > GEOMETRY.chestBottom ? "lower" : "chest";
        if (region === null && ratioY < GEOMETRY.headBottom) return "head";
        return ratioY < GEOMETRY.chestBottom ? "chest" : "body";
      };
      /**
       * 누른 자리의 터치 부위(head·arm·leg·chest·lower·body) 판정. 가슴이 움직인 만큼 전신 기준 영역도 옮겨 판정
       * @param x 캔버스 x 좌표
       * @param y 캔버스 y 좌표
       * @param drawable 누른 메시 번호
       */
      const touchRegion = (x: number, y: number, drawable: number) => {
        if (bodyWeight > 0.5) return chibiRegion(y);
        const scale = model.scale.x, currentChest = chestCenter();
        const shiftX = currentChest && chestBase ? currentChest.x - chestBase.x : 0, shiftY = currentChest && chestBase ? currentChest.y - chestBase.y : 0;
        const ratioX = (x - model.x - (bodyBounds.minX + shiftX) * scale) / (bodyBounds.w * scale);
        const ratioY = (y - model.y - (bodyBounds.minY + shiftY) * scale) / (bodyBounds.h * scale);
        const inChest = Math.pow((ratioX - GEOMETRY.chestCenterX) / GEOMETRY.chestRadiusX, 2) + Math.pow((ratioY - GEOMETRY.chestCenterY) / GEOMETRY.chestRadiusY, 2) <= 1;
        return regionByShape(drawRegion[drawable], ratioY, inChest);
      };
      // 버튼·입력 요소와 입력 영역의 카드(승인·질문 팝업)는 아바타와 겹쳐도 클릭이 그대로 통하게
      const UI_HIT = 'button, a[href], input, textarea, select, summary, [contenteditable="true"], [class*="composerSeat"] [class*="_card"]';
      /**
       * 화면 좌표 → 캔버스 좌표 변환과 캐릭터 위 여부 판정
       * @param cx 창 x 좌표(clientX)
       * @param cy 창 y 좌표(clientY)
       * @returns 캐릭터 위면 [캔버스 x, 캔버스 y, 메시 번호], 아니면 null
       */
      const hitAt = (cx: number, cy: number) => {
        if (canvas.style.display === "none" || fleeX !== 0) return null;
        const rect = canvas.getBoundingClientRect();
        if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) return null;
        if (document.elementFromPoint(cx, cy)?.closest(UI_HIT)) return null;
        const x = (cx - rect.left) / curK, y = (cy - rect.top) / curK;
        const drawable = pickDrawable(x, y);
        return drawable >= 0 ? [x, y, drawable] : null;
      };

      let clicks: number[] = [], headClicks: number[] = [], spamAt = -1e9, inputLockedUntil = 0;
      const shy = { count: 0, last: -1e9, cooldownUntil: 0 }, low = { count: 0, last: -1e9, cooldownUntil: 0 };
      /**
       * 가슴 터치 반응. 8초 안에 이어 누른 횟수로 단계가 오르고, 다섯 번째엔 진정할 때까지 6초 터치 잠금
       * 180ms 안의 연타와 쿨다운 중 터치는 무시
       * @param now performance.now() 시각(ms)
       */
      const onChest = (now: number) => {
        if (now < shy.cooldownUntil || now - shy.last < 180) return;
        if (now - shy.last > 8000) shy.count = 0;
        shy.last = now; shy.count++;
        if (shy.count <= 4) {
          if (now < touchLeanUntil || Math.random() < 0.16) touchLeanUntil = now + 3000;   // 가끔 앞으로 숙임, 숙인 동안 누르면 3초 연장
          speak(shy.count <= 1 ? "chest1" : "chest2", 4000);
          if (shy.count >= 2) happyMouthUntil = now + 4000;   // 2번째부터: 입꼬리 올리고 살짝 벌린 "헤~"
          if (shy.count >= 3) coverChest(2600);   // 3~4번째: 왼손으로 가슴을 가림
        } else {
          touchLeanUntil = 0; shy.count = 0;
          shy.cooldownUntil = inputLockedUntil = now + 6000;   // 진정할 때까지 터치 안 받음
          shiverStarted = now;
          speak("chest3", 3000);
          happyMouthUntil = now + 6000;
          coverChest(6000);   // 마지막: 진정할 때까지 가린 채로
          setTimeout(() => speak("chest_calm", 2800), 3000);
        }
      };
      /** 가까운 쪽 화면 끝(-1 = 왼쪽, 1 = 오른쪽) */
      const nearSide = () => { const areaRect = area(), centerX = shown.x - fleeX + W * curK / 2; return centerX - areaRect.l < areaRect.r - centerX ? -1 : 1; };
      /**
       * 그쪽 화면 끝으로 완전히 나가는 거리. 높이는 그대로 두고 좌우로만 움직임
       * @param dir -1 = 왼쪽, 1 = 오른쪽
       * @returns fleeX로 쓸 가로 이동량(px, 왼쪽이면 음수)
       */
      const outDistance = (dir: number) => { const areaRect = area(), x = shown.x - fleeX; return dir < 0 ? -(x + W * curK - areaRect.l + 20) : areaRect.r - x + 20; };
      // 도망
      //  · 창 안: 창 경계 밖으로 걸어 나가 사라졌다가 10초 뒤 같은 쪽에서 돌아옴 (원래 동작)
      //  · 펫 창: 멀티 모니터에서는 '화면 끝'이 다른 모니터라 지워지지 않으므로, 일정 거리 이동 + 페이드로 확실히 사라지게 한다
      const FLEE_DIST = 300, FLEE_OUT_MS = 700, FLEE_IN_MS = 900, FLEE_HIDE_MS = 10000;
      let fleeFade = 1;   // 도망 중 캔버스 불투명도 (1 = 평소)
      /**
       * 도망용 가로 이동(fleeX) 애니메이션. 처음·끝은 부드럽게(ease-in-out)
       * @param from 시작 fleeX(px)
       * @param to 끝 fleeX(px)
       * @param done 다 움직인 뒤 부를 함수
       */
      const fleeSlide = (from: number, to: number, ms: number, done?: () => void) => {
        const startedAt = performance.now();
        /** 한 프레임만큼 fleeX 갱신, 끝나면 done 호출 */
        const step = () => {
          const progress = Math.min(1, (performance.now() - startedAt) / ms), e = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          fleeX = from + (to - from) * e;
          if (progress < 1) requestAnimationFrame(step); else done && done();
        };
        requestAnimationFrame(step);
      };
      /** 아래(치마) 터치가 쌓였을 때 화면 밖으로 도망쳤다가 돌아옴 */
      const flee = () => {
        if (drag.pending || drag.on || link.open || link.follow) return;   // 예약된 사이 집었거나 펫 창으로 넘어갔으면 취소
        hush();
        if (!PET) {   // 창 안: 화면(창) 경계 밖으로 나가면 그림이 잘려 자연스럽게 사라진다
          const off = outDistance(nearSide());
          fleeSlide(Math.sign(off) * 0.01, off, 700, () => setTimeout(() => fleeSlide(off, 0, 1100, () => {
            fleeX = 0; setTimeout(() => speak("lower_after", 4000), 400);
          }), 10000));
          return;
        }
        // 펫 창: 거리 이동 + 페이드
        const dist = nearSide() * Math.max(FLEE_DIST, W * curK * 0.5);     // 캐릭터가 클수록 조금 더 멀리
        /** 도망 끝: 제자리·불투명도 복구 후 한마디 */
        const finish = () => { fleeX = 0; fleeFade = 1; canvas.style.opacity = ""; setTimeout(() => speak("lower_after", 4000), 400); };
        /** 사라진 자리에서 제자리까지 서서히 나타나며 돌아옴 (끌기 시작하면 즉시 복귀) */
        const runIn = () => {
          const inStartedAt = performance.now();
          /** 돌아오는 한 프레임 진행. 끌기가 시작되면 즉시 finish */
          const step = () => {
            if (drag.pending || drag.on) return finish();
            const progress = Math.min(1, (performance.now() - inStartedAt) / FLEE_IN_MS);
            fleeX = dist * (1 - progress * progress * (3 - 2 * progress));
            fleeFade = progress * progress * (3 - 2 * progress);
            canvas.style.opacity = String(Math.min(1, fleeFade));
            if (progress < 1) requestAnimationFrame(step); else finish();
          };
          requestAnimationFrame(step);
        };
        const outStartedAt = performance.now();
        /** 멀어지며 옅어지는 한 프레임 진행. 다 사라지면 FLEE_HIDE_MS 뒤 runIn */
        const runOut = () => {
          const progress = Math.min(1, (performance.now() - outStartedAt) / FLEE_OUT_MS);
          fleeX = dist * (1 - Math.pow(1 - progress, 3));                       // 빠르게 출발해 끝에서 감속
          fleeFade = Math.max(0, 1 - Math.pow(progress, 1.5));                  // 갈수록 빠르게 옅어져 도착하면 완전히 투명
          canvas.style.opacity = String(fleeFade);
          if (progress < 1) requestAnimationFrame(runOut);
          else setTimeout(runIn, FLEE_HIDE_MS);
        };
        requestAnimationFrame(runOut);
      };
      // ---------- 산책 ----------
      const WALK_SPEED = 320;   // 걷는 속도 (px/초)
      /**
       * 출발·도착만 부드럽게, 중간은 일정한 속도인 산책 진행 곡선
       * @param progress 시간 진행도(0~1)
       * @returns 거리 진행도(0~1)
       */
      const walkEase = (progress: number) => { const ramp = 0.12, rampNorm = 2 * ramp * (1 - ramp); return progress < ramp ? progress * progress / rampNorm : progress > 1 - ramp ? 1 - (1 - progress) * (1 - progress) / rampNorm : (progress - ramp / 2) / (1 - ramp); };
      /**
       * 산책용 예약 타이머. walk.timers에 묶어 집어 들면 한 번에 멈춤
       * @returns setTimeout id
       */
      const walkLater = (fn: () => void, ms: number) => { const id = setTimeout(() => { walk.timers = walk.timers.filter((t) => t !== id); fn(); }, ms); walk.timers.push(id); return id; };
      /**
       * 펫 창 산책 경계 fade: 걸은 거리 기준 불투명도 갱신 (프레임률과 무관, 나갈 때는 경계에 닿으면 0, 돌아올 때는 fade 구간을 지나면 1)
       * @param from 이번 걷기의 시작 fleeX(px)
       */
      const updateWalkAlpha = (from: number) => {
        if (!PET) return;
        if (walk.plan && walk.phase === "out") walk.alpha = walkOutAlpha(Math.abs(fleeX - from), walk.plan.run, walk.plan.fade);
        else if (walk.phase === "in" && walk.returnFade > 0) walk.alpha = walkInAlpha(Math.abs(fleeX - from), walk.returnFade);
      };
      /**
       * 걷기 애니메이션(WALK_SPEED 속도로 fleeX 이동). walk.slideId로 묶어 새 걷기가 시작되거나 집어 들면 멈춤
       * 펫 창 복귀는 첫 프레임을 '반대 경계 시작 위치(alpha 0)'에 붙잡아 둠 (첫 rAF가 늦게 와도 시간 기준 진행도가 점프해 반투명 상태로 중간에 나타나지 않게)
       * @param from 시작 fleeX(px)
       * @param to 끝 fleeX(px)
       * @returns 이 걷기를 멈추는 함수
       */
      const slide = (from: number, to: number, done: () => void) => {
        let startedAt = performance.now(), started = !(PET && walk.phase === "in");
        const ms = Math.abs(to - from) / WALK_SPEED * 1000, id = ++walk.slideId;
        let cancelled = false;
        /** 걷기 한 프레임 진행. 멈췄거나 다른 걷기가 시작됐으면 중단 */
        const step = () => {
          if (cancelled || id !== walk.slideId) return;   // 멈춤
          if (!started) { startedAt = performance.now(); started = true; }
          const progress = ms ? Math.min(1, (performance.now() - startedAt) / ms) : 1;
          const eased = PET && walk.phase === "out" ? walkEasePetOut(progress) : walkEase(progress);   // 펫 창이 경계로 나갈 때는 끝에서 감속하지 않음
          fleeX = from + (to - from) * eased;
          updateWalkAlpha(from);
          if (progress < 1) requestAnimationFrame(step); else done();
        };
        requestAnimationFrame(step);
        return () => { cancelled = true; };
      };
      /** 산책 전용 plan·clip·fade 상태를 모두 되돌림 (복구 대기 타이머 포함) */
      const clearWalkVisual = () => {
        clearTimeout(walk.recoverTimer); walk.recoverTimer = 0;
        walk.plan = null; walk.area = null; walk.base = null; walk.displayId = ""; walk.displayRequest = 0; walk.alpha = 1; walk.returnFade = 0; walk.safeHold = false; walk.faceDir = null; walk.recover = null;
        if (walk.opacityApplied) { canvas.style.opacity = ""; walk.opacityApplied = false; }
        lastPlaceKey = "";
      };
      /** 출발 전(말하는 중)에 집어 들었을 때 산책 취소. 출발한 뒤에는 제자리에 올 때까지 집을 수 없음 */
      const cancelWalk = () => {
        if (walk.phase !== "ready") return;
        for (const t of walk.timers) clearTimeout(t);
        walk.timers = []; walk.slideId++; walk.phase = ""; walk.dir = -1; clearWalkVisual();
      };
      // 표시장치 구성이 바뀌어 고정한 경계를 믿을 수 없을 때: 완전히 투명한 채 새 workArea 안의 안전한 자리로 옮기고,
      // main이 보고한 실제 native bounds가 목표 자리와 맞은 뒤에만 fade-in을 시작한다. 확인이 늦으면 clip을 유지한 채
      // fade-in하고(안전), 확인 전에는 절대 clip을 풀지 않는다.
      /** 표시장치 변경 복구의 fade-in 시작. 끝나면 산책을 마치고 walk.area를 유지해 경계 clip을 계속 검 (safeHold, 사용자가 끌기 전까지) */
      const startRecoverFade = () => {
        if (walk.phase !== "recover" || !walk.recover) return;
        walk.recover = null;
        clearTimeout(walk.recoverTimer); walk.recoverTimer = 0;
        const startedAt = performance.now(), ms = 520;
        /** 복구 fade-in 한 프레임 진행. 복구가 끝났거나 다른 단계로 바뀌었으면 중단 */
        const step = () => {
          if (walk.phase !== "recover") return;
          const progress = Math.min(1, (performance.now() - startedAt) / ms);
          walk.alpha = progress * progress * (3 - 2 * progress);
          if (progress < 1) requestAnimationFrame(step);
          else {
            walk.phase = ""; walk.alpha = 1; walk.opacityApplied = false; canvas.style.opacity = ""; walk.faceDir = null;
            walk.safeHold = true; lastPlaceKey = "";
          }
        };
        requestAnimationFrame(step);
      };
      /** pet/main.cjs가 placer 적용 뒤 보낸 실제 bounds가 복구 목표 창 자리(±2px)와 맞으면 fade-in 시작 */
      const confirmRecoverBounds = () => {
        if (walk.phase !== "recover" || !walk.recover || !petBounds) return;
        const target = walk.recover;
        if (Math.abs(petBounds.x - target.x) <= 2 && Math.abs(petBounds.y - target.y) <= 2 &&
            Math.abs(petBounds.width - target.width) <= 2 && Math.abs(petBounds.height - target.height) <= 2) startRecoverFade();
      };
      /**
       * 표시장치 변경 복구: 산책을 멈추고 완전히 투명한 채 새 workArea 안의 안전한 자리로 옮김
       * 실제 bounds가 목표 자리에 오면(confirmRecoverBounds) fade-in, 1.2초 안에 확인이 안 되면 clip을 유지한 채 fade-in
       * @param area 새 workArea. 유효하지 않으면 투명한 채 기다림 (유효한 표시장치 응답이 오면 applyPetDisplay가 다시 부름)
       */
      const recoverWalk = (area: WalkArea | null) => {
        if (!PET) return;
        for (const t of walk.timers) clearTimeout(t);
        clearTimeout(walk.recoverTimer);
        walk.timers = []; walk.slideId++; walk.plan = null; walk.base = null; walk.returnFade = 0; walk.recover = null; walk.safeHold = false;
        const baseX = shown.x - fleeX, baseY = shown.y, k = Number.isFinite(shown.k) && shown.k > 0 ? shown.k : (free.k || 1);
        fleeX = 0; walk.phase = "recover"; walk.alpha = 0; walk.opacityApplied = true; canvas.style.opacity = "0"; lastPlaceKey = "";
        walk.area = walkAreaValid(area) ? area : null;
        if (!walk.area) return;
        const safe = walkSafePose({ area: walk.area, x: baseX, y: baseY, k, canvasW: W, canvasH: H, bodyW: visW * k });   // 복구 뒤엔 보통 체형으로 돌아오므로 정상 몸 폭 기준
        free.anim = null; free.on = true; free.x = safe.x; free.y = safe.y; free.k = safe.k; free.applied = true;
        // 목표 native 창 자리 (movePet과 같은 계산). 실제 bounds가 이 값에 오면 fade-in.
        const cx = (innerWidth - W * safe.k) / 2, cy = innerHeight - H * safe.k;
        walk.recover = { x: Math.round(safe.x - cx), y: Math.round(safe.y - cy), width: innerWidth, height: innerHeight };
        try { place(); } catch (error) { log.debug("산책 복구 배치 실패:", error); }   // 즉시 이동 지시 → main onPlace가 실제 bounds 회신
        walk.recoverTimer = setTimeout(() => { if (walk.phase === "recover") startRecoverFade(); }, 1200);
      };
      /**
       * 표시장치 응답 기록: 현재 표시장치 id·workArea·배율·응답 시각과 응답받은 요청 번호
       * @param request 응답한 요청 번호 (pet/main.cjs는 top-level로 보냄, 없으면 display.request)
       */
      const recordPetDisplay = (display: WalkDisplay, area: WalkArea, request: number | undefined) => {
        petDisplay.id = display.id != null ? String(display.id) : ""; petDisplay.area = area; petDisplay.scaleFactor = Number(display.scaleFactor) || 0; petDisplay.at = performance.now();
        const answer = Number.isFinite(request) ? request : display.request;
        if (Number.isFinite(answer)) petDisplay.answered = Math.max(petDisplay.answered, answer as number);
      };
      /** 전체 표시장치 목록에서 출발한 표시장치 (목록·출발 id가 없거나 목록에 없으면 없음) */
      const departureDisplay = (list: WalkDisplay[] | null) => (list && walk.displayId ? list.find((item) => String(item.id) === walk.displayId) : null);
      /**
       * 복구 뒤 안전 영역 clip을 유지하는 중의 표시장치 알림: 구성 변경이 아니면 영역만 갱신, 출발 표시장치가 남아 있으면 그 workArea가 바뀐 경우에만 복구
       * @param fixedArea 출발 표시장치의 지금 workArea (목록에 없으면 null)
       */
      const holdSafeArea = (area: WalkArea, changed: boolean, fixedArea: WalkArea | null) => {
        if (!changed) { walk.area = fixedArea || area; return; }
        if (fixedArea) { if (!sameWalkArea(fixedArea, walk.area)) recoverWalk(fixedArea); return; }
        walk.displayId = petDisplay.id; recoverWalk(area);
      };
      /**
       * 산책 중 표시장치 구성 변경: 출발 표시장치가 남아 있으면 workArea가 바뀐 경우에만 복구, 실제로 사라졌으면 새 표시장치로 복구
       * 표시장치 추가만으로는 현재 window bounds가 산책 경계/overshoot에 걸려 nearest가 옆 모니터로 바뀔 수 있으므로 출발 id를 우선 신뢰
       * @param list 전체 표시장치 목록 (구버전 main이면 null)
       * @param fixedArea 출발 표시장치의 지금 workArea (목록에 없으면 null)
       */
      const followWalkDisplay = (area: WalkArea, list: WalkDisplay[] | null, fixedArea: WalkArea | null) => {
        if (fixedArea) { if (!sameWalkArea(fixedArea, walk.area)) recoverWalk(fixedArea); return; }
        const removed = !!list && !!walk.displayId;                                    // 실제 제거
        const legacyMoved = !!walk.displayId && petDisplay.id !== walk.displayId;      // 구버전 main 대비 (목록 없음)
        if (removed || legacyMoved) { walk.displayId = petDisplay.id; recoverWalk(area); return; }
        if (!sameWalkArea(area, walk.area)) recoverWalk(area);
      };
      /**
       * pet/main.cjs의 표시장치 정보 처리 (display 메시지). 응답을 기록하고, 산책·복구 중이면 표시장치 변경에 맞춰 복구
       * @param changed 표시장치 구성 변경 알림이면 true
       * @param request 응답한 요청 번호 (top-level로 옴)
       * @param displays 전체 표시장치 목록 (구버전 main이면 없음)
       */
      /**
       * 표시장치 응답에 따른 산책 처리: 복구 중이면 다시 복구, 복구 뒤 안전 영역 유지 중이면 holdSafeArea, 산책 중 구성 변경이면 followWalkDisplay
       * @param changed 표시장치 구성 변경 알림이면 true
       * @param list 전체 표시장치 목록 (구버전 main이면 null)
       * @param fixedArea 출발 표시장치의 지금 workArea (목록에 없으면 null)
       */
      const walkDisplayChange = (area: WalkArea, changed: boolean, list: WalkDisplay[] | null, fixedArea: WalkArea | null) => {
        if (walk.phase === "recover") recoverWalk(fixedArea || area);
        else if (walk.safeHold) holdSafeArea(area, changed, fixedArea);
        else if (changed && walk.phase && walk.phase !== "ready") followWalkDisplay(area, list, fixedArea);
      };
      /**
       * pet/main.cjs의 표시장치 정보 처리 (display 메시지). 응답과 전체 목록을 기록하고, 산책·복구 중이면 표시장치 변경에 맞춰 복구
       * @param changed 표시장치 구성 변경 알림이면 true
       * @param request 응답한 요청 번호 (top-level로 옴)
       * @param displays 전체 표시장치 목록 (구버전 main이면 없음)
       */
      const applyPetDisplay = (display: WalkDisplay, changed: boolean, request?: number, displays?: WalkDisplay[]) => {
        const area = walkDisplayArea(display);
        if (!area) return;
        recordPetDisplay(display, area, request);
        if (!PET) return;
        const list = Array.isArray(displays) ? displays : null;
        if (list) petDisplay.displays = list;
        const fixed = departureDisplay(list);
        walkDisplayChange(area, changed, list, fixed ? walkDisplayArea(fixed) : null);
      };
      /** 산책에서 돌아옴: 창 안은 반대쪽(오른쪽) 화면 밖에서, 펫 창은 출발의 반대 경계에서 원래 자리까지 걸어 들어옴 */
      const walkBack = () => {
        if (walk.phase !== "away") return;
        for (const t of walk.timers) clearTimeout(t);
        walk.timers = [];
        if (PET) { petWalkBack(); return; }
        walk.phase = "in"; walk.dir = 1;   // 오른쪽에서 들어와 왼쪽으로 걸어옴
        slide(outDistance(1), 0, () => {
          fleeX = 0; walk.phase = "";
          walkLater(() => { if (!walk.phase) speak("walk_back", 3500); }, 450);   // 정면으로 돌아선 뒤 인사
        });
      };
      /** 출발 표시장치가 사라졌는지 여부: 전체 목록이 있으면 목록에 없을 때, 목록이 없는 구버전 main이면 현재 표시장치 id가 바뀌었을 때 */
      const departureDisplayGone = () => {
        const removed = !!(petDisplay.displays && walk.displayId && !departureDisplay(petDisplay.displays));
        const legacyMoved = !petDisplay.displays && !!(walk.displayId && petDisplay.id && petDisplay.id !== walk.displayId);
        return removed || legacyMoved;
      };
      /** 펫 창 복귀 마무리: 제자리·불투명도·산책 상태를 되돌리고, 정면으로 돌아선 뒤 인사 */
      const finishPetWalkBack = () => {
        fleeX = 0; walk.phase = ""; walk.alpha = 1; walk.opacityApplied = false; canvas.style.opacity = "";
        walk.plan = null; walk.area = null; walk.base = null; walk.displayId = ""; walk.returnFade = 0; walk.faceDir = null; lastPlaceKey = "";
        walkLater(() => { if (!walk.phase) speak("walk_back", 3500); }, 450);
      };
      /** 펫 창 복귀: 출발의 반대 경계에서 같은 표시장치 안으로 걸어 들어옴. 영역을 모르거나 출발 표시장치가 사라졌으면 복구(recoverWalk) */
      const petWalkBack = () => {
        const area = walkAreaValid(walk.area) ? walk.area : (walkAreaValid(petDisplay.area) ? petDisplay.area : null);
        if (!area || departureDisplayGone()) { recoverWalk(area); return; }
        walk.area = area; walk.phase = "in";
        const dir = walk.plan ? walk.plan.dir : walk.dir;
        // dir = 출발 방향 = 반대 경계에서 돌아오는 실제 이동 방향. faceDir을 그 값으로 명시한다.
        // (창 안은 faceTo(in) = -walk.dir 규칙을 쓰지만, 펫 창 복귀는 faceDir로 직접 지정)
        walk.dir = dir; walk.faceDir = dir;
        const k = Number.isFinite(shown.k) && shown.k > 0 ? shown.k : curK;
        const plan = planWalkReturn({ area, dir, x: shown.x - fleeX, k, canvasW: W, bodyW: WALK_BODY_WIDTH * k });
        walk.returnFade = plan.fade; walk.alpha = 0; walk.opacityApplied = true; canvas.style.opacity = "0"; lastPlaceKey = "";
        fleeX = plan.from;   // 반대 경계로의 텔레포트를 alpha 0에서 먼저 확정한다 (첫 slide 프레임 지연으로 반투명 노출 방지)
        try { place(); } catch (error) { log.debug("산책 복귀 배치 실패:", error); }
        slide(plan.from, 0, finishPetWalkBack);
      };
      /** 산책 시작: 말하고 → 꼬마로 바뀐 뒤 → 창 안은 왼쪽 화면 밖까지(높이 그대로), 펫 창은 선택 경계까지 걸어감 → 8~14초 뒤 반대쪽(펫 창은 반대 경계)에서 돌아옴 */
      const startWalk = () => {
        if (SLEEP.state !== "active") return;
        if (PET && petPanelOpen) return;   // 자체 펫 설정 패널이 열린 동안엔 창을 끌고 다니지 않는다 (DSH 플러그인 화면과 무관)
        walk.phase = "ready"; walk.dir = -1;   // 연출: 창 안은 항상 왼쪽으로 걸어 나갔다가 오른쪽에서 들어온다
        walk.faceDir = null; walk.plan = null; walk.area = null; walk.base = null; walk.displayId = ""; walk.alpha = 1; walk.returnFade = 0; walk.safeHold = false; walk.recover = null;
        if (PET) walk.displayRequest = requestPetDisplay() ?? 0;   // 출발 전에 현재 DIP workArea를 확보 (응답 없으면 산책 취소)
        speak("walk_out", 2200);
        walkLater(() => {
          walk.phase = "out"; hush();
          walkLater(() => {
            if (PET) { petWalkDepart(); return; }
            walk.out = outDistance(walk.dir); slide(0, walk.out, () => {
              walk.phase = "away";
              walkLater(walkBack, 8000 + Math.random() * 6000);
            });
          }, 700);   // 꼬마 모습으로 바뀐 뒤 출발
        }, 2300);
      };
      /**
       * 제자리(보이는 몸)가 workArea 안(여유 12px)인지 여부
       * @param x 캔버스 왼쪽 (화면 DIP)
       * @param y 캔버스 위 (화면 DIP)
       */
      const homeInsideArea = (area: WalkArea, x: number, y: number, k: number) => {
        const home = walkBodySpan({ x, k, canvasW: W, bodyW: visW * k });
        return home.l >= area.l - 12 && home.r <= area.r + 12 && y + H * k * 0.05 >= area.t - 12 && y + H * k <= area.b + 12;
      };
      /** 이번 출발 요청에 대한 표시장치 응답의 workArea (요청 뒤 응답이 왔고 5초 안이면 신뢰, 아니면 null) */
      const departureWorkArea = () => {
        const fresh = walk.displayRequest > 0 && petDisplay.answered >= walk.displayRequest &&
          petDisplay.at > 0 && performance.now() - petDisplay.at < 5000;
        return fresh && walkAreaValid(petDisplay.area) ? petDisplay.area : null;
      };
      /**
       * 펫 창 산책 출발: 이번 출발 요청에 대한 표시장치 응답의 workArea로 경계까지 걷기 계획을 세우고 걸어감
       * 응답이 없으면 취소 (fail-closed: DOM 값으로 다른 모니터에 나가지 않음), 제자리가 새 workArea 밖이면 걷지 않고 완전 투명 상태로 안전 자리 복구부터
       */
      const petWalkDepart = () => {
        if (petPanelOpen) { walk.phase = ""; walk.dir = -1; clearWalkVisual(); return; }   // 대기 중 설정 패널이 열렸으면 취소
        const area = departureWorkArea();
        if (!area) { walk.phase = ""; walk.dir = -1; clearWalkVisual(); return; }
        const x = shown.x, y = shown.y, k = Number.isFinite(shown.k) && shown.k > 0 ? shown.k : curK;
        if (!homeInsideArea(area, x, y, k)) { recoverWalk(area); return; }
        const plan = planWalkOut({ area, x, k, canvasW: W, bodyW: WALK_BODY_WIDTH * k, speed: WALK_SPEED });
        walk.plan = plan; walk.area = area; walk.base = { k, x, y }; walk.displayId = petDisplay.id || "";
        walk.dir = plan.dir; walk.out = plan.travel * plan.dir; walk.alpha = 1; walk.opacityApplied = false;
        lastPlaceKey = "";
        slide(0, walk.out, () => {
          walk.phase = "away"; walk.alpha = 0; walk.opacityApplied = true; canvas.style.opacity = "0";
          walkLater(walkBack, 8000 + Math.random() * 6000);
        });
      };
      /** 산책을 떠나면 안 되는 때 여부: 시작 연출·작업·대기·삐짐·도망 중 */
      const walkMoodBusy = (now: number) => intro.phase !== "done" || mood !== "idle" || running || !!waitingKind || now < sulkUntil || now < inputLockedUntil || fleeX !== 0;
      /** 누르거나 들고 있을 때·움직이는 중·펫 창으로 넘긴 동안 여부. 이때는 산책 안 함 (펫 창이 대신 산책) */
      const walkInputBusy = () => !!(drag.pending || drag.on || free.anim || link.open || link.opening || link.follow);
      /** 말하는 중, 최근 1분 안에 만졌거나 15초 안에 말했을 때, 화면이 안 보일 때 여부 */
      const walkRecentlyActive = (now: number) => bubble.classList.contains("show") || now - walk.lastTouch < 60000 || now - lastSayAt < 15000 || document.hidden;
      /**
       * 프레임마다 산책 시작·조기 귀환 판단. 갈 때가 아니면 30초 뒤, 떠나면 4~8분 뒤 다시 확인
       * @param now performance.now() 시각(ms)
       */
      walkCheck = (now: number) => {
        if (SLEEP.state !== "active") return;   // 절전 중에는 산책하지 않음
        if (walk.phase === "away" && running) return walkBack();   // 나가 있는 동안 작업이 시작되면 바로 돌아옴
        if (walk.phase || now < walk.next) return;
        walk.next = now + 30000;   // 지금은 갈 때가 아니면 30초 뒤 다시 확인
        if (walkMoodBusy(now) || walkInputBusy() || walkRecentlyActive(now)) return;
        walk.next = now + (240 + Math.random() * 240) * 1000;   // 다음 산책은 4~8분 뒤
        startWalk();
      };
      // ---------- 절전(슬립): 입력이 없으면 말 한마디 후 오른쪽 화면 밖으로 나가 렌더링(티커)을 멈춤 ----------
      const SLEEP = { enabled: true, minutes: 1, lastActive: performance.now(), state: "active" };   // active → leaving → asleep → waking
      let sleepTimer = 0, cancelSleepSlide: (() => void) | null = null;
      /** 화면 오른쪽 밖 좌표(그 자리까지 갈 fleeX, px) */
      const SLEEP_OFF = () => innerWidth - (canvas.getBoundingClientRect().left - fleeX) + 40;
      /** 절전(나가는 중 포함)에서 깨어나 제자리로 걸어 돌아옴. 펫 창으로 꺼내 둔 동안이면 걷지 않고 바로 활성 상태로 */
      const startWake = () => {
        if (SLEEP.state !== "asleep" && SLEEP.state !== "leaving") return;
        clearTimeout(sleepTimer); sleepTimer = 0;
        cancelSleepSlide?.(); cancelSleepSlide = null;
        if (link.open || link.follow?.shown) { SLEEP.state = "active"; fleeX = 0; return; }
        hush();
        SLEEP.state = "waking";
        setRender(true);
        place();
        slide(fleeX, 0, () => {
          fleeX = 0; SLEEP.state = "active"; SLEEP.lastActive = performance.now();
          if (!running && !waitingKind) speak("sleep_back", 3500);
        });
      };
      /** 사용자 입력 시각 기록과 절전 해제. 숨김 상태면 무시 */
      const sleepActivity = () => {
        if (hidden) return;
        SLEEP.lastActive = performance.now();
        startWake();
      };
      for (const t of (PET ? [] : ["pointerdown", "pointermove", "mousedown", "keydown", "wheel", "touchstart"])) addEventListener(t, sleepActivity, { passive: true, capture: true });
      /**
       * 절전 진입: 한마디 후 오른쪽 화면 밖으로 걸어 나가 렌더링 멈춤
       * 숨김·펫 창·끌기·움직임·시작 연출·도망·산책 중이면 건너뜀
       */
      const sleepGo = () => {
        if (hidden || PET || drag.on || drag.pending || free.anim || SLEEP.state !== "active" || intro.phase !== "done" || fleeX !== 0 || walk.phase) return;
        if (link.open || link.follow?.shown) { SLEEP.lastActive = performance.now(); return; }   // 펫 창으로 밖에 꺼내 둔 동안엔 절전 안 함
        SLEEP.state = "leaving";
        speak("sleep_out", 2600);
        sleepTimer = setTimeout(() => {
          sleepTimer = 0;
          if (SLEEP.state !== "leaving") return;
          hush();
          cancelSleepSlide = slide(fleeX, SLEEP_OFF(), () => {
            cancelSleepSlide = null;
            SLEEP.state = "asleep";
            canvas.style.display = "none"; setBubbleDisplay("none");
            setRender(false);   // 렌더·모션 업데이트·Worker 프레임 전부 멈춤
          });
        }, 2500);
      };
      /**
       * 아래(치마) 터치 반응. 8초 안에 이어 누른 횟수로 단계가 오르고, 다섯 번째엔 도망 후 14초 쿨다운
       * 도망 중·쿨다운 중 터치와 180ms 안의 연타는 무시
       * @param now performance.now() 시각(ms)
       */
      const onLower = (now: number) => {
        if (fleeX !== 0 || now < low.cooldownUntil || now - low.last < 180) return;
        if (now - low.last > 8000) low.count = 0;
        low.last = now; low.count++;
        if (low.count <= 2) speak("lower1", 4000);
        else if (low.count <= 4) speak("lower2", 4000);
        else {
          low.count = 0;
          low.cooldownUntil = now + 14000;
          shiverStarted = now;
          speak("lower3", 900);
          setTimeout(flee, 900);
        }
      };
      // ---------- 냄비: 위에서 떨어져 머리를 "쾅" 치고 튕겨 나감 ----------
      const POT_SVG = '<svg viewBox="0 0 140 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><linearGradient id="dscPotBody" x1="0" x2="1"><stop offset="0" stop-color="#7d8794"/><stop offset=".35" stop-color="#e3e8ee"/><stop offset=".6" stop-color="#b8c0ca"/><stop offset="1" stop-color="#6c7580"/></linearGradient></defs>' +
        '<rect x="2" y="34" width="26" height="10" rx="5" fill="#3d434b"/><rect x="112" y="34" width="26" height="10" rx="5" fill="#3d434b"/>' +
        '<path d="M22 30 H118 V78 Q118 96 100 96 H40 Q22 96 22 78 Z" fill="url(#dscPotBody)" stroke="#4b525b" stroke-width="3"/>' +
        '<ellipse cx="70" cy="30" rx="50" ry="10" fill="#d7dde4" stroke="#4b525b" stroke-width="3"/>' +
        '<ellipse cx="70" cy="30" rx="40" ry="6" fill="#59616b"/><path d="M38 48 Q44 70 40 86" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55" fill="none"/></svg>';
      /**
       * 충격 그림: 별 모양 터짐 + 바깥 충격선 (막았을 땐 은색 반짝임)
       * @param guarded true면 세숫대야로 막았을 때 그림
       * @returns SVG 문자열
       */
      const impactSvg = (guarded: boolean) => {
        const points = [];
        for (let i = 0; i < 20; i++) { const radius = i % 2 ? 22 : 46, angle = (i / 20) * Math.PI * 2 - Math.PI / 2; points.push((50 + Math.cos(angle) * radius).toFixed(1) + "," + (50 + Math.sin(angle) * radius).toFixed(1)); }
        const fill = guarded ? "#f1f5f9" : "#ffe14d", stroke = guarded ? "#64748b" : "#ea580c", core = guarded ? "#ffffff" : "#fff7c2";
        let rays = "";
        for (let i = 0; i < 8; i++) { const angle = (i / 8) * Math.PI * 2 + 0.2, cos = Math.cos(angle), sin = Math.sin(angle); rays += `<line x1="${(50 + cos * 50).toFixed(1)}" y1="${(50 + sin * 50).toFixed(1)}" x2="${(50 + cos * 62).toFixed(1)}" y2="${(50 + sin * 62).toFixed(1)}" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>`; }
        return `<svg viewBox="-14 -14 128 128" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${rays}<polygon points="${points.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/><circle cx="50" cy="50" r="12" fill="${core}"/></svg>`;
      };
      let audioCtx: AudioContext | null = null;
      /**
       * 효과음 (파일 없이 합성): 맞으면 둔탁한 "통", 세숫대야로 막으면 금속이 울리는 "깡~"
       * @param guarded true면 세숫대야로 막았을 때 소리
       */
      const impactSound = (guarded: boolean) => {
        try {
          audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
          const audio = audioCtx, t = audio.currentTime, out = audio.createGain();
          out.gain.value = 0.22; out.connect(audio.destination);
          /**
           * 점점 잦아드는 단음 하나
           * @param freq 시작 주파수(Hz)
           * @param dur 길이(초)
           * @param vol 시작 음량
           * @param drop 끝 주파수 배율(1이면 고정)
           */
          const tone = (freq: number, dur: number, vol: number, type: OscillatorType = "sine", drop = 1) => {
            const oscillator = audio.createOscillator(), gainNode = audio.createGain();
            oscillator.type = type; oscillator.frequency.setValueAtTime(freq, t); if (drop !== 1) oscillator.frequency.exponentialRampToValueAtTime(freq * drop, t + dur);
            gainNode.gain.setValueAtTime(vol, t); gainNode.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            oscillator.connect(gainNode); gainNode.connect(out); oscillator.start(t); oscillator.stop(t + dur + 0.02);
          };
          /**
           * 부딪히는 순간의 "탁" (점점 잦아드는 잡음)
           * @param dur 길이(초)
           * @param vol 음량
           * @param highpassHz 고역 통과 필터 기준 주파수(Hz)
           */
          const noise = (dur: number, vol: number, highpassHz: number) => {
            const noiseBuffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * dur), audio.sampleRate), samples = noiseBuffer.getChannelData(0);
            for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples.length, 3);
            const src = audio.createBufferSource(), filter = audio.createBiquadFilter(), gainNode = audio.createGain();
            src.buffer = noiseBuffer; filter.type = "highpass"; filter.frequency.value = highpassHz; gainNode.gain.value = vol;
            src.connect(filter); filter.connect(gainNode); gainNode.connect(out); src.start(t);
          };
          if (guarded) { noise(0.05, 0.7, 2500); for (const [freq, dur, vol] of [[640, 1.1, 0.5], [1370, 0.9, 0.35], [2230, 0.7, 0.25], [3150, 0.5, 0.15]]) tone(freq, dur, vol, "sine", 0.995); }
          else { noise(0.07, 0.8, 900); tone(190, 0.28, 0.9, "triangle", 0.45); tone(470, 0.35, 0.35, "sine", 0.9); tone(1130, 0.22, 0.18, "sine", 0.95); }
        } catch {}
      };
      /**
       * 냄비 떨어뜨리기: 위에서 떨어져 머리를 치고 튕겨 나감. 세숫대야를 쓰고 있으면 막아 냄
       * @param x 냄비가 떨어질 창 x 좌표(clientX)
       * @param y 냄비가 떨어질 창 y 좌표(clientY)
       */
      const potHit = (x: number, y: number) => {
        const now = performance.now();
        walk.lastTouch = now; clicks = []; headClicks = [];
        const guarded = now < basinUntil;   // 세숫대야를 쓰고 있으면 막아 냄
        inputLockedUntil = now + (guarded ? 1200 : 3200);   // 맞고 정신 차릴 때까지 터치 안 받음
        const w = Math.max(64, 150 * curK), h = w * 100 / 140;
        const pot = life.own(document.createElement("div"), (node) => node.remove());
        pot.style.cssText = `position:fixed;left:${x - w / 2}px;top:${y - h * 0.9}px;width:${w}px;height:${h}px;z-index:40;pointer-events:none;will-change:transform,opacity`;
        pot.innerHTML = POT_SVG;
        document.body.append(pot);
        const fall = y + h + 20, animMs = 1250;
        const anim = pot.animate([
          { transform: `translateY(${-fall}px) rotate(-14deg)`, offset: 0, easing: "cubic-bezier(.5,0,1,.6)" },
          { transform: "translateY(0) rotate(0deg) scale(1.12,.86)", offset: 0.4, easing: "ease-out" },   // 쾅
          guarded ? { transform: `translate(${w * 0.45}px,${-h * 1.6}px) rotate(60deg)`, offset: 0.66, easing: "ease-in" }   // 세숫대야에 튕겨 더 높이
                  : { transform: `translate(${w * 0.25}px,${-h * 0.6}px) rotate(32deg)`, offset: 0.62, easing: "ease-in" },
          { transform: `translate(${w * 0.7}px,${h * 0.9}px) rotate(85deg)`, opacity: 0, offset: 1 },
        ], { duration: animMs, fill: "forwards" });
        /** 다 떨어진 냄비 정리 */
        anim.onfinish = () => pot.remove();
        setTimeout(() => {   // 부딪히는 순간
          const burstSize = Math.max(60, 130 * curK), burst = life.own(document.createElement("div"), (node) => node.remove());   // 글자 없이 만화식 충격 별 + 충격선
          burst.style.cssText = `position:fixed;left:${x - burstSize / 2}px;top:${y - h * 0.9 - burstSize / 2}px;width:${burstSize}px;height:${burstSize}px;z-index:41;pointer-events:none`;
          burst.innerHTML = impactSvg(guarded);
          document.body.append(burst);
          /** 다 터진 충격 그림 정리 */
          burst.animate([{ transform: "scale(.2) rotate(-20deg)", opacity: 0 }, { transform: "scale(1.15) rotate(5deg)", opacity: 1, offset: 0.25 }, { transform: "scale(1.3) rotate(10deg)", opacity: 0 }], { duration: 620, fill: "forwards" }).onfinish = () => burst.remove();
          impactSound(guarded);
          if (guarded) { play("flinch", 600); speak("pot_guard", 3000); return; }   // 막아 냄: 살짝 움찔하고 의기양양
          play("bonk", 1100); shiverStarted = performance.now();
          speak("pot_hit", 3000);
          flashExp("dizzy", 2800);   // 빙글빙글 눈 (말풍선 꼬리표의 눈물과 함께)
        }, animMs * 0.4);
      };
      // ---------- 세숫대야: 머리를 천천히 쓸어내리면 살며시 씌우고 10초 뒤 벗음 ----------
      /** 세숫대야 씌우기 (10초 뒤 벗음) */
      const putBasin = () => {
        const now = performance.now();
        walk.lastTouch = now; clicks = []; headClicks = [];
        basinUntil = now + 10000;
        speak("basin_on", 3800);
      };
      const HEAD_SULK_AT = 3, SULK_MS = 15000;   // 머리 1~2번째 = 정색, 3번째 = 삐져서 15초 동안 터치 안 받음
      /**
       * 머리를 연달아 만졌을 때 삐짐: SULK_MS 동안 터치 안 받고 고개를 돌린 채 몰래 보기 3번, 풀리면 한마디
       * @param now performance.now() 시각(ms)
       */
      const sulk = (now: number) => {
        clicks = []; headClicks = [];
        until.dark = until.smug = 0;   // 정색 표정을 지우고 삐진 얼굴로
        gestureState.name = null;
        sulkStart = now; sulkUntil = inputLockedUntil = now + SULK_MS;
        sulkDir = Math.random() < 0.5 ? 1 : -1; sulkYaw = sulkRoll = 0;
        // 15초 동안 몰래 보기 3번 (약 3초·7초·11초, 조금씩 어긋나게)
        sulkPeeks = [0, 1, 2].map((i) => ({ at: 2800 + i * 4000 + (Math.random() - 0.5) * 1000, flip: Math.random() < 0.6, done: false }));
        speak("head_sulk", 4000);
        flashExp("blush", SULK_MS);
        setTimeout(() => { stareUntil = performance.now() + 4300; speak("head_after", 4000); }, SULK_MS);   // 풀리며 한마디 할 땐 정면을 똑바로 봄
      };
      /**
       * 짧은 터치 반응: 부위별 대사, 3초 안 6번 연타·작업 중·머리 8초 안 3번(삐짐) 판정
       * @param x 캔버스 x 좌표
       * @param y 캔버스 y 좌표
       * @param drawable 누른 메시 번호
       */
      const onTouch = (x: number, y: number, drawable: number) => {
        const now = performance.now();
        if (now < inputLockedUntil) return;
        walk.lastTouch = now;
        const region = touchRegion(x, y, drawable);
        if (region === "chest") { clicks = []; headClicks = []; low.count = 0; return onChest(now); }
        if (region === "lower") { clicks = []; headClicks = []; shy.count = 0; return onLower(now); }
        shy.count = 0; low.count = 0;
        clicks = clicks.filter((t) => now - t < 3000); clicks.push(now);
        if (clicks.length >= 6) { clicks = []; headClicks = []; spamAt = now; return speak("spam", 3000); }
        if (running && Math.random() < 0.5) return speak("working");
        if (region === "head") {
          if (now - spamAt < 10000) { spamAt = -1e9; return speak("makeup"); }
          headClicks = headClicks.filter((t) => now - t < 8000); headClicks.push(now);
          if (headClicks.length >= HEAD_SULK_AT) return sulk(now);
          return speak("head");
        }
        if (region === "arm") return speak("arm");
        if (region === "leg") return speak("leg");
        play("sway", 1600);
        speak("body");
      };
      // 캔버스는 클릭을 통과시키므로, 문서 단계에서 캐릭터 위 클릭만 가로챔 (투명한 곳은 뒤 화면으로 그대로)
      // 짧게 눌렀다 떼면 터치, 누른 채 6px 넘게 움직이면 집어 들어 옮김
      // 머리에서 아래로 쓸어내리면 끌기 대신 냄비(빠르게)·세숫대야(천천히)
      const POT_MS = 130;   // 머리에서 이 시간(ms) 안에 55px 넘게 쓸어내리면 냄비, 아니면 세숫대야
      let swallowClick = false, strokeFrom: { x: number; y: number; t: number; h: number[] } | null = null;   // strokeFrom: 머리를 누른 채 쓸어내리는지 지켜보는 중
      /** 이벤트의 포인터 좌표. 창 안 = 창 좌표, 펫 창 = 화면 좌표 */
      const pointerPoint = (e: MouseEvent): [number, number] => PET ? [e.screenX, e.screenY] : [e.clientX, e.clientY];
      /**
       * 몸 전체 영역(캔버스 양옆 빈 곳·머리 위 여백 제외) 안 여부. 펫 창은 클릭을 통과시키다 이 안에 커서가 오면 받기 시작하므로,
       * 반투명한 머리카락 끝처럼 그림 판정이 빗나가는 곳도 집을 수 있게 이 영역으로 판단
       * @param cx 창 x 좌표(clientX)
       * @param cy 창 y 좌표(clientY)
       */
      const overBody = (cx: number, cy: number) => {
        if (canvas.style.display === "none" || fleeX !== 0) return false;
        const canvasRect = canvas.getBoundingClientRect(), body = bodyRect(canvasRect.left, canvasRect.top, curK);
        return cx >= body.l && cx <= body.r && cy >= body.t && cy <= body.b;
      };
      /**
       * 우클릭 대화용 판정. 몸 영역(bodyRect)은 캔버스 양옆을 잘라내 실제보다 좁아서, 조금만 빗나가도 브라우저 메뉴가 떴다.
       * 대화는 그림이 있는 캔버스 칸 전체(+여백)로 받고, 그 위에 놓인 버튼·입력 칸은 그대로 통과시킨다
       * @param cx 창 x 좌표(clientX)
       * @param cy 창 y 좌표(clientY)
       */
      const overChat = (cx: number, cy: number) => {
        if (canvas.style.display === "none") return false;
        const rect = canvas.getBoundingClientRect(), padX = Math.max(6, rect.width * 0.04), padY = Math.max(6, rect.height * 0.04);
        if (cx < rect.left - padX || cx > rect.right + padX || cy < rect.top - padY || cy > rect.bottom + padY) return false;
        return !document.elementFromPoint(cx, cy)?.closest(UI_HIT);
      };
      /** 산책으로 걷는 중 여부 (출발한 뒤 ~ 제자리 도착 전) */
      const walking = () => walk.phase === "out" || walk.phase === "away" || walk.phase === "in";
      /**
       * 가슴 끌기를 시작할 수 있는지 여부. 놓은 직후 부끄러워 떠는 동안에도 바로 다시 잡을 수 있음 (inputLockedUntil은 머리 터치에만 적용)
       * @param now performance.now() 시각(ms)
       */
      const canPullChest = (now: number) => bodyWeight <= 0.5 && fleeX === 0 && !walk.phase && intro.phase === "done" && !drag.on && !link.opening && now >= sulkUntil;
      /**
       * 가슴을 잡은 동안의 흔들기 대사 감시 시작
       * 3초 넘게 잡은 채로 '흔들어야' 더 자극적인 대사가 나옴 (잡고만 있으면 안 나옴), 4초를 넘겨 계속 흔들면 어지러워하는 대사로 바뀜
       */
      const armChestLong = () => {
        clearInterval(chestLongTimer);
        const startedAt = performance.now();
        chestShake.acc = 0; chestShake.last = 0; chestShake.next = startedAt + 3000;
        chestLongTimer = setInterval(() => {
          if (!chestDragging) { clearInterval(chestLongTimer); chestLongTimer = 0; return; }
          const now = performance.now();
          if (now < chestShake.next) return;                                   // 최소 3초는 잡고 있어야
          if (now - chestShake.last > 500 || chestShake.acc < 30) return;      // 그 사이 흔들지 않았으면 대사 없음
          // 4초를 넘기면 멀미(어지럼) 대사, 그 전에는 자극적인 대사
          speak(now - startedAt >= 4000 ? "chest_pull_dizzy" : "chest_pull_long", 4000);
          chestShake.acc = 0; chestShake.next = now + 3000;                    // 계속 흔들면 3초마다 한 번씩
        }, 300);
      };
      /** 가슴 끌기 놓기: 끌어올린 만큼 출렁이며 내려가고 부끄러워하는 반응, 2.5초 터치 잠금 */
      const releaseChest = () => {
        chestFrom = null;
        if (!chestDragging) return;
        chestDragging = false; chestTarget = 0; chestShiftTarget = 0;
        clearInterval(chestLongTimer);   // 더 이상 붙잡고 있지 않으니 자극적인 대사 감시도 끔
        const now = performance.now();
        const dropped = Math.max(0, dragLift.x);
        dragLift.v = Math.min(0, dragLift.v) - dropped * 2.5;   // 놓는 순간 끌어올린 만큼 아래로 탄력이 붙어 크게 출렁인 뒤 잦아듦
        speak("chest_drop", 3500); shiverStarted = now;
        coverChest(3000); inputLockedUntil = now + 2500; walk.lastTouch = now;
      };
      /**
       * 두 번째 버튼 합류 시 집기 예약 복원. 그 사이 예약된 쓰다듬기·가슴 끌기는 버림
       * 좌우 버튼 코드: 첫 버튼을 누른 채 150ms 안에 다른 버튼을 누르면 집기로 자연스럽게 넘어가게 하는 시간 마진.
       * 두 버튼을 함께 오래 누르는 기존 동작은 pointermove의 both 판정이 그대로 처리하므로 150ms 제한 없음
       * pointerdown은 첫 버튼에만 오므로, 두 번째 버튼은 mousedown/pointermove에서 호출
       * @param pointerId 집기 예약에 기록할 포인터 id
       */
      const armChordGrab = (e: PointerEvent | MouseEvent, pointerId = (e as PointerEvent).pointerId) => {
        if (chestDragging) { clearInterval(chestLongTimer); chestDragging = false; chestTarget = 0; chestShiftTarget = 0; }
        strokeFrom = null; chestFrom = null;
        if (!drag.pending) {
          const [px, py] = pointerPoint(e);
          drag.pending = { id: pointerId, sx: px, sy: py, h: null, ox: px - shown.x, oy: py - shown.y };
        }
        chord.valid = true;
        if (PET) PET.press(true);
        try { e.preventDefault(); e.stopPropagation(); } catch {}
        swallowClick = true;
      };
      /**
       * 오른쪽 첫 버튼이 캐릭터 위에서 유효하게 시작했는지 판정 (왼쪽 pointerdown과 같은 가드)
       * @param id 기록할 포인터 id
       * @returns 유효하면 { at, hit, id }, 아니면 null
       */
      const rightStart = (e: PointerEvent | MouseEvent, id = (e as PointerEvent).pointerId ?? rightPress?.id) => {
        if (PET && petPanelOpen && petPanel && petPanel.contains(e.target as Node)) return null;
        if (walking()) return null;
        if (intro.phase !== "done" || fleeX !== 0 || link.opening) return null;
        const h = hitAt(e.clientX, e.clientY);
        if (!h && !(PET && overBody(e.clientX, e.clientY))) return null;
        return { at: performance.now(), hit: true, id };
      };
      /**
       * pointermove의 buttons 변화로 두 번째 버튼 합류 감지. pointerdown은 첫 버튼만 오고,
       * 왼쪽 pointerdown의 preventDefault가 compatibility mousedown을 막을 수 있어 이 경로가 기준
       * @returns 집기 예약을 되살렸으면 true
       */
      const chordButtonsMoved = (e: PointerEvent, now: number) => {
        const mask = e.buttons & 3, prev = mouseButtons;
        mouseButtons = mask;
        if (mask !== 3 || prev === 3) return false;
        if (prev === 2) {   // 오른쪽 먼저: 유효한 right start일 때만
          if (!rightPress?.hit) return false;
          armChordGrab(e, rightPress.id ?? e.pointerId);
          return true;
        }
        if (prev === 1) {   // 왼쪽 먼저: 150ms grace
          if (!chordWithinGrace(chord, 2, mask, now)) return false;
          armChordGrab(e, drag.pending?.id ?? e.pointerId);
          return true;
        }
        return false;
      };
      // ---- 포인터 누르기: 오른쪽 버튼 → 캐릭터 위인지 → 머리·가슴 제스처 예약 → 집기 예약 순서 ----
      /**
       * 왼쪽이 아닌 버튼의 pointerdown 처리. 오른쪽 버튼 단독으로는 다른 동작 없음
       * @param nowDown 누른 시각(performance.now(), ms)
       */
      const rightButtonDown = (e: PointerEvent, nowDown: number) => {
        if (e.button === 2) {
          rightPress = rightStart(e);
          if ((e.buttons & 3) === 3 && rightPress) armChordGrab(e, e.pointerId);
        }
        // 오른쪽 버튼이 왼쪽을 누른 채 150ms 안에 눌리면, 그 사이 예약된 쓰다듬기·가슴 끌기를 버리고
        // 집기 예약을 되살린다. (두 버튼을 함께 오래 누르는 기존 동작은 pointermove의 both 판정이 처리한다.)
        if ((e.buttons & 1) && chordWithinGrace(chord, e.button, e.buttons, nowDown)) armChordGrab(e);
      };
      /**
       * 머리면 쓰다듬기 예약, 가슴이면 위로 끄는지 지켜보기 예약 (위로 끌면 가슴 끌기, 옆·아래로 움직이면 평소처럼 집어 옮김)
       * @param h 누른 자리의 hitAt 결과(그림 위가 아니면 null)
       * @returns 머리였으면 true
       */
      const armHeadOrChest = (e: PointerEvent, h: number[] | null) => {
        const head = !!h && performance.now() >= inputLockedUntil && touchRegion(h[0], h[1], h[2]) === "head";
        if (head) strokeFrom = { x: e.clientX, y: e.clientY, t: performance.now(), h };
        else if (h && canPullChest(performance.now()) && touchRegion(h[0], h[1], h[2]) === "chest") chestFrom = { x: e.clientX, y: e.clientY, id: e.pointerId, h };
        return head;
      };
      /** 터치 길게 누르기의 집기 모드 전환 예약. 터치 화면에는 오른쪽 버튼이 없기 때문 (그 뒤 움직이면 옮겨짐, 그냥 떼면 터치 반응) */
      const armTouchHold = (e: PointerEvent) => {
        clearTimeout(touchHold);
        touchHold = setTimeout(() => {
          if (!drag.pending || drag.pending.id !== e.pointerId || drag.pending.touchStroke) return;   // 이미 쓰다듬기로 판정했으면 집기로 바꾸지 않는다
          drag.pending.touchGrab = true;
          strokeFrom = null; chestFrom = null;   // 길게 눌렀으면 쓰다듬기·가슴 끌기 판정은 취소
          if (PET) PET.press(true);
        }, TOUCH.grabMs);
      };
      /** 누르는 순간 펫 창을 숨긴 채 미리 띄우기(끌 수도 있으므로). 붙은 직후 아직 남은 펫 창이 있으면 바로 숨김 */
      const preparePetOnPress = () => {
        if (link.supported && link.petState === "none") link.post("warm");
        else if (!PET && link.petState === "shown" && !link.open && !link.follow) link.post("hide");
      };
      life.listen(document, "pointerdown", (e) => {
        if (hidden) return;
        const nowDown = performance.now();
        mouseButtons = e.buttons & 3;
        chord = chordDown(chord, e.button, e.buttons, nowDown);
        if (e.button !== 0) { rightButtonDown(e, nowDown); return; }
        if (chestFrom) { e.preventDefault(); e.stopPropagation(); swallowClick = true; return; }
        swallowClick = false; strokeFrom = null;
        if (PET && petPanelOpen && petPanel && petPanel.contains(e.target)) return;   // 패널 안 조작은 끌기·터치로 보지 않음
        if (walking()) return;   // 산책을 떠난 뒤에는 돌아올 때까지 클릭을 받지 않음 (뒤 화면으로 통과)
        const h = hitAt(e.clientX, e.clientY);
        if (!h && !(PET && overBody(e.clientX, e.clientY))) return;
        e.preventDefault(); e.stopPropagation(); swallowClick = true;
        const head = armHeadOrChest(e, h);
        if (intro.phase !== "done" || fleeX !== 0 || link.opening) { if (h && !head) onTouch(h[0], h[1], h[2]); return; }   // 시작 연출·도망·펫 창 여는 중엔 끌기 없음 (머리는 떼는 순간 터치)
        const [px, py] = pointerPoint(e);
        drag.pending = { id: e.pointerId, sx: px, sy: py, h, ox: px - shown.x, oy: py - shown.y };
        chord.valid = true;   // 캐릭터 위에서 시작한 누름만 코드 그레이스 대상 (빈 곳 클릭은 제외)
        if (e.pointerType === "touch") armTouchHold(e);
        if (PET) PET.press(true);   // 누르고 있는 동안은 커서가 몸 밖으로 벗어나도 클릭을 계속 받음
        preparePetOnPress();
      }, true);
      // 마우스 좌우 버튼 코드 보완: Pointer Events는 첫 버튼에만 pointerdown을 준다.
      //  · 우→좌: 오른쪽으로 시작했으면 pending이 없으므로, 왼쪽이 합류하는 mousedown에서 예약을 만든다.
      //  · 좌→우: 두 번째 오른쪽은 pointerdown이 없으므로, 같은 grace를 mousedown에서도 처리한다.
      //  · 오른쪽 단독 클릭은 여기서 pending을 만들지 않아 우클릭 메뉴·빈 곳 클릭이 그대로 동작한다.
      life.listen(document, "mousedown", (e) => {
        if (hidden) return;
        const now = performance.now();
        if (e.button === 2) {
          if (!(e.buttons & 1)) rightPress = rightStart(e);
          if ((e.buttons & 1) && chordWithinGrace(chord, 2, e.buttons, now)) armChordGrab(e, rightPress?.id ?? e.pointerId);
          return;
        }
        if (e.button !== 0) return;
        // 우→좌: 첫 오른쪽이 캐릭터 위였고 왼쪽이 아직 pending을 만들지 않았으면 여기서 만든다.
        if ((e.buttons & 2) && rightPress?.hit && Number.isFinite(rightPress.id) && !drag.pending && !drag.on) {
          chord = chordDown(chord, 0, e.buttons, now);   // 첫 버튼(오른쪽) 시각 유지
          const [px, py] = pointerPoint(e);
          drag.pending = { id: rightPress.id, sx: px, sy: py, h: null, ox: px - shown.x, oy: py - shown.y };
          chord.valid = true;
          if (PET) PET.press(true);
          try { e.preventDefault(); e.stopPropagation(); } catch {}
          swallowClick = true;
        }
      }, true);
      life.listen(document, "mouseup", (e) => { if (e.button === 2) rightPress = null; }, true);
      /**
       * 머리 쓸기 종류 판정: 빠르면 냄비, 느리면 세숫대야 (확실히 빠르게 쓸어야 냄비, 짧고 조금 비스듬해도 세숫대야)
       * @param stroke 쓸기를 시작한 자리와 시각(strokeFrom)
       * @returns "pot"·"basin", 아직 어느 쪽도 아니면 null
       */
      const strokeKind = (stroke: { x: number; y: number; t: number }, e: PointerEvent) => {
        const dy = e.clientY - stroke.y, dx = Math.abs(e.clientX - stroke.x);
        if (performance.now() - stroke.t < POT_MS) return dy > 55 && dy > dx * 1.2 ? "pot" : null;
        return dy > 40 && dy > dx * 0.8 ? "basin" : null;
      };
      // 집어 옮기기 키: 설정(prefs.drag.key)을 누른 채 왼쪽 버튼으로 끌면 옮길 수 있다.
      // 수식 키(Alt·Ctrl·Shift·Cmd)는 포인터 이벤트의 상태로, 그 밖의 키 하나는 keydown/keyup으로 기억한다.
      // 기존처럼 왼쪽·오른쪽 버튼을 함께 누르는 방식도 그대로 동작한다.
      /** 설정의 이동 키 원문(기본 "Alt"). 빈 문자열은 '이동 키 없음'으로 유지 */
      const dragKeyRaw = () => String(prefs.drag?.key ?? "Alt").trim();
      /**
       * 이동 키 설정을 비교용 토큰으로 정규화
       * @returns 수식 키면 "alt"·"ctrl"·"shift"·"meta", 그 밖은 소문자 KeyboardEvent.key 값, 이동 키 없음이면 ""
       */
      const dragKeyToken = () => {
        const text = dragKeyRaw().toLowerCase();
        if (!text || text === "none") return "";
        if (text === "alt" || text === "option") return "alt";
        if (text === "ctrl" || text === "control") return "ctrl";
        if (text === "shift") return "shift";
        if (text === "meta" || text === "cmd" || text === "command" || text === "win" || text === "windows") return "meta";
        return text === "space" ? " " : text === "plus" ? "+" : text;
      };
      const pressedKeys = new Set();
      // 펫 창은 별도 창이라 키 입력을 직접 못 받을 수 있다(창에 포커스가 없음). 창 안 캐릭터가 키 상태를 대신 전달한다.
      // 수식 키는 포인터 이벤트의 상태로 알 수 있어, 일반 키만 전달하면 된다.
      const DRAG_MODIFIER_TOKENS = new Set(["alt", "ctrl", "shift", "meta"]);
      /**
       * 일반 이동 키의 눌림 상태를 열린 펫 창에 전달 (창 안 캐릭터에서만)
       * @param token 정규화한 키 토큰
       * @param on true면 눌림, false면 뗌
       */
      const relayDragKey = (token: string, on: boolean) => {
        if (PET || !link.open || !token || DRAG_MODIFIER_TOKENS.has(token)) return;
        if (dragKeyToken() !== token) return;
        try { link.post("send", { list: [["dragheld", [token, on]]] }); } catch {}
      };
      /**
       * 키 눌림 상태 기억과 펫 창 전달
       * @param on true면 keydown, false면 keyup
       */
      const rememberKey = (e: KeyboardEvent, on: boolean) => {
        const token = String((e && e.key) || "").toLowerCase();
        if (!token) return;
        if (on) pressedKeys.add(token); else pressedKeys.delete(token);
        relayDragKey(token, on);
      };
      addEventListener("keydown", (e) => rememberKey(e, true));
      addEventListener("keyup", (e) => rememberKey(e, false));
      addEventListener("blur", () => pressedKeys.clear());
      /** 왼쪽 버튼과 함께 설정한 이동 키를 누르고 있는지 여부 */
      const dragKeyHeld = (e: MouseEvent) => {
        if ((e.buttons & 1) !== 1) return false;
        const token = dragKeyToken();
        if (!token) return false;
        if (token === "alt") return !!e.altKey;
        if (token === "ctrl") return !!e.ctrlKey;
        if (token === "shift") return !!e.shiftKey;
        if (token === "meta") return !!e.metaKey;
        return pressedKeys.has(token);
      };
      // 터치 제스처 판정: 움직인 방향으로 쓰다듬기/끌기를 정하고, 가만히 길게 누르면 집기로 본다.
      // 세로로 임계(8px) 이상 움직이면 쓰다듬기로 보고 길게 누르기 타이머를 취소한다(느린 스트로크가 집기로 바뀌지 않게).
      const TOUCH = { grabMs: 320, movePx: 14, verticalPx: 8 };
      /**
       * 터치 이동량·누른 시간으로 제스처 판정
       * @returns "grab"(집기), "stroke"(쓰다듬기), "wait"(아직 판단 보류)
       */
      const touchGesture = ({ dx = 0, dy = 0, heldMs = 0, grabMs = TOUCH.grabMs, movePx = TOUCH.movePx, verticalPx = TOUCH.verticalPx }) => {
        if (Math.hypot(dx, dy) > movePx && Math.abs(dx) > Math.abs(dy) * 1.2) return "grab";
        if (Math.abs(dy) > verticalPx || Math.hypot(dx, dy) > movePx) return "stroke";
        return heldMs >= grabMs ? "grab" : "wait";
      };
      // ---- 포인터 이동: 터치 제스처 판정 → 가슴 끌기 → 쓰다듬기 → 집어 옮기기 순서로 넘긴다 ----
      /** 터치 이동 분류: 가로로 끌면 길게 누르기를 기다리지 않고 바로 집기, 세로로 움직이면 쓰다듬기로 남김 */
      const classifyTouchMove = (e: PointerEvent) => {
        if (!(e.pointerType === "touch" && drag.pending && !drag.pending.touchGrab && !drag.pending.touchStroke && e.pointerId === drag.pending.id)) return;
        const dx = e.clientX - drag.pending.sx, dy = e.clientY - drag.pending.sy;
        const gesture = touchGesture({ dx, dy });
        if (gesture === "wait") return;
        clearTimeout(touchHold);   // 움직이기 시작했으면 길게 누르기로 넘어가지 않는다
        if (gesture === "grab") drag.pending.touchGrab = true;
        else drag.pending.touchStroke = true;   // 세로 쓰다듬기: 타이머가 뒤늦게 집기로 바꾸지 않게
      };
      /**
       * 가슴을 누른 채 움직임 처리: 위로 끌면 가슴 끌기, 다른 쪽이면 평소 끌기로 넘김. chestFrom이 있을 때만 호출
       * @returns 이 이동을 여기서 끝냈으면 true
       */
      const chestMove = (e: PointerEvent) => {
        const dy = e.clientY - chestFrom!.y, dx = e.clientX - chestFrom!.x, now = performance.now();
        if (!chestDragging) {
          if (dy < -12 && Math.abs(dy) > Math.abs(dx) && canPullChest(now)) {
            chestDragging = true; shy.count = 0; headClicks = []; clicks = [];
            cover.until = 0;   // 다시 잡았으면 가슴을 가리던 팔을 내린다 (떠는 중 재입력 대응)
            drag.pending = null;   // 가슴 끌기로 넘어가면 집어 옮기기는 취소 (펫 창은 놓을 때까지 클릭을 계속 받음)
            walk.lastTouch = now; speak("chest_pull", 3000);
            armChestLong();   // 3초 넘게 붙잡고 있으면 자극적인 대사로
            flashExp("squint", 400); flashExp("blush", 400);
          } else if (Math.hypot(dx, dy) >= 6 && !(dy < 0 && Math.abs(dy) > Math.abs(dx))) chestFrom = null;   // 위가 아닌 쪽으로 움직이면 평소 끌기
          else { e.preventDefault(); return true; }
        }
        if (!chestDragging) return false;
        const up = Math.max(0, -dy / curK);
        chestTarget = 1 - Math.exp(-up / 85);   // 조금만 끌어올려도 크게 반응
        // 마우스를 좌우로 움직이면 그 방향으로 가슴이 끌려간다 (끌어올린 만큼 좌우로도 크게)
        chestShiftTarget = clamp(dx / (curK * 110), -1, 1) * (0.45 + 0.55 * Math.min(1, chestTarget * 1.4));
        // 흔든 양을 누적 (잡고만 있는 것과 구분 — 이 값이 있어야 3초 뒤 긴 대사가 나온다)
        const moved = Math.hypot(dx - chestShake.x, dy - chestShake.y);
        chestShake.x = dx; chestShake.y = dy;
        if (moved > 1) { chestShake.acc += moved; chestShake.last = now; }
        e.preventDefault(); e.stopPropagation(); swallowClick = true;
        return true;
      };
      /**
       * 머리를 누른 채 움직임 처리: 빠르게 쓸면 냄비, 천천히 쓸면 세숫대야. strokeFrom이 있을 때만 호출
       * @returns 이 이동을 여기서 끝냈거나 아직 판단을 미뤄야 하면 true (끌기 시작 안 함)
       */
      const strokeMove = (e: PointerEvent) => {
        const stroke = strokeFrom!, kind = strokeKind(stroke, e);
        if (kind) {
          strokeFrom = null; if (drag.pending) { drag.pending = null; if (PET) PET.press(false); }
          if (kind === "pot") potHit(stroke.x, stroke.y); else putBasin();
          return true;
        }
        const dy = e.clientY - stroke.y, dx = Math.abs(e.clientX - stroke.x);
        // 아직 6px 안 움직였거나 아래로 쓸어내리는 중일 수 있으면 끌기 시작을 미룸, 끌 수 없는 때(시작 연출·도망 중)는 떼는 순간 터치
        if (!drag.pending || Math.hypot(dx, dy) < 6 || (dy > 0 && dy > dx * 0.8)) return true;
        strokeFrom = null;
        return false;
      };
      /**
       * 집어 옮기기 시작 (들고 있는 동안 식은땀, 펫 창이면 창 이동을 펫 프로세스에 맡김)
       * @param pending 누를 때 만든 끌기 예약
       * @param px 커서 x (창 안 = 창 좌표, 펫 창 = 화면 좌표)
       * @param py 커서 y (창 안 = 창 좌표, 펫 창 = 화면 좌표)
       */
      const beginCarry = (e: PointerEvent, pending: DragPending, px: number, py: number, now: number) => {
        cancelWalk();   // 산책 가려고 말하던 중이면 취소
        drag.on = true; drag.touch = e.pointerType === "touch" || !!(pending && pending.touchGrab); drag.samples = []; free.anim = null; free.k = shown.k; free.mode = freeMode(); free.applied = true; petDocked = false;
        walk.safeHold = false; walk.area = null; walk.displayId = "";   // 펫 산책 복구 뒤 안전 영역 유지는 사용자가 끌면 해제
        try { document.documentElement.setPointerCapture(e.pointerId); } catch {}
        document.documentElement.classList.add("dsc-grabbing");
        until.sweat = Infinity;   // 들고 있는 동안 식은땀
        walk.lastTouch = now;
        if (PET) {   // 펫 창을 직접 끌 때도 창은 펫 프로세스가 커서를 읽는 즉시 옮김 (이벤트 → 페이지 계산 → 되돌려 받는 왕복은 몇 프레임 늦고 끊김)
          petGrab = { x: pending.ox, y: pending.oy }; petTracking = true;
          drag.x = px - pending.ox; drag.y = py - pending.oy; drag.samples = [[now, px, py]];
          PET.send({ type: "track", on: true, grab: petGrab, off: { x: (innerWidth - W * free.k) / 2, y: innerHeight - H * free.k } });
        }
      };
      /**
       * 들고 움직이는 중 처리: 위치와 던질 속도 갱신, 창 밖으로 나가면 펫 창이 따라오게 함
       * @param pending 누를 때 만든 끌기 예약
       */
      const carryMove = (e: PointerEvent, pending: DragPending) => {
        strokeFrom = null; chestFrom = null;   // 좌우 함께 = 무조건 집어 옮기기 (남아 있던 제스처 예약을 버림)
        const [px, py] = pointerPoint(e), now = performance.now();
        if (!drag.on) beginCarry(e, pending, px, py, now);
        if (PET && petTracking) { e.preventDefault(); return; }   // 이후 위치·속도는 펫 프로세스가 보내는 cursor 메시지로 갱신
        drag.x = px - pending.ox; drag.y = py - pending.oy;
        drag.samples.push([now, px, py]);
        while (drag.samples.length > 2 && now - drag.samples[0][0] > 100) drag.samples.shift();
        const [t0, x0, y0] = drag.samples[0], dt = Math.max(16, now - t0) / 1000;
        carry.vx += ((px - x0) / dt - carry.vx) * 0.5; carry.vy += ((py - y0) / dt - carry.vy) * 0.5;
        if (!PET) followPet(now);
        e.preventDefault();
      };
      /**
       * 곧바로 집어 옮길 조건 여부: 왼쪽·오른쪽을 함께 누르거나, 보조 키(기본 Alt)를 누른 채 움직임 (머리 쓰다듬기·가슴 끌기 판정과 6px 기준을 거치지 않음)
       * 터치에서 길게 누르거나 가로로 끌어 집기 모드가 되면 오른쪽 버튼을 누른 것처럼 취급
       */
      const carryHeld = (e: PointerEvent) => {
        const touchGrab = !!(drag.pending && drag.pending.touchGrab && e.pointerId === drag.pending.id);
        const both = (e.buttons & 3) === 3 || touchGrab || dragKeyHeld(e);
        return both;
      };
      life.listen(document, "pointermove", (e) => {
        if (hidden) return;
        if (PET && petPanelOpen && petPanel && petPanel.contains(e.target)) return;   // 패널 안 조작은 캐릭터 끌기로 이어지지 않음
        if (e.pointerType !== "touch") chordButtonsMoved(e, performance.now());   // 두 번째 마우스 버튼 합류 (pointerdown preventDefault와 무관)
        classifyTouchMove(e);
        const both = carryHeld(e);
        if (chestFrom && !both && e.pointerId === chestFrom.id && chestMove(e)) return;
        if (strokeFrom && !both && strokeMove(e)) return;
        const pending = drag.pending;
        if (!pending || e.pointerId !== pending.id) return;
        // 손을 뗀 이벤트(pointerup)를 놓쳤으면 버튼 상태로 알아채고 그 자리에서 놓음 (펫 창이 커서 아래로 따라오며 다시 그려질 때 등)
        if (e.buttons === 0) return endDrag(e, false);
        // 집어 옮기기는 왼쪽·오른쪽 버튼을 함께 눌렀을 때만. 한쪽만 누른 채 끌면 예전처럼 터치·머리 쓰다듬기·가슴 끌기로 남는다
        if (!both) { if (drag.on) endDrag(e, false); return; }
        carryMove(e, pending);
      }, true);
      /**
       * 끄는 도중 몸이 창 밖으로 나가면 같은 자리에 펫 창을 띄워 커서를 따라오게 함 (창 안 그림은 창 경계에서 잘리므로)
       * 펫 창이 준비된 뒤에만 따라붙고, 위치는 한 번에 하나만 보냄 (여러 요청이 겹치면 도착 순서가 뒤섞여 예전 자리로 튐)
       * @param now 현재 시각(performance.now(), ms)
       */
      const followPet = (now: number) => {
        if (!link.supported || link.open) return;
        const k = free.k;
        // 몸의 15% 넘게 창 밖으로 나가야 넘김 (제자리는 창 오른쪽 끝에서 4px 안쪽이라 살짝만 끌어도 넘어가던 것 방지)
        const out = bodyOut({ k, x: drag.x, y: drag.y });
        const screenPos = screenOf(drag.x, drag.y), pose = { k, x: screenPos.x, y: screenPos.y };
        if (!link.follow) {
          if (!out) return;
          if (link.petState !== "hidden") {   // 아직 준비 중이면 상태만 다시 확인 (그동안은 창 안에서 끄는 그대로)
            if (now - link.peek > 250) { link.peek = now; if (link.petState === "none") link.post("warm"); else link.poll(); }
            return;
          }
          link.follow = { shown: false }; link.last = "";
          link.post("open", { from: pose, to: pose, follow: true, grab: { x: drag.pending?.ox ?? 0, y: drag.pending?.oy ?? 0 }, seq: ++link.seq });   // grab: 커서가 몸을 잡은 자리 (몸 위치 = 커서 − grab)
        }
        // 열린 뒤 위치는 보내지 않음: 펫 프로세스가 커서를 직접 읽어 따라옴 (HTTP 왕복은 수십~수백 ms 걸려 끌 때 끊김)
      };
      /**
       * 손을 놓을 때 펫 창이 따라오던 중이면 마무리: 창 밖이면 펫 창이 이어받고, 창 안으로 돌아왔으면 펫 창을 숨기고 창 안에서 이어 감. link.follow가 있을 때만 호출
       * @param vx 던질 속도 x(px/s)
       * @param vy 던질 속도 y(px/s)
       * @returns 펫 창이 이어받았으면 true, 평소처럼 놓아야 하면 false
       */
      const finishFollow = (vx: number, vy: number) => {
        const follow = link.follow;
        link.follow = null; link.queue = []; lastPlaceKey = "";   // 숨김으로 끝날 수도 있으니 이번 회차 반응은 버림 (이어받으면 link.enter가 표정·자세를 다시 맞춤)
        // 놓을 때도 끌어낼 때와 같은 기준 (몸 가운데로 보면 일부만 밖으로 끌고 놓았을 때 창 안으로 처리돼 다시 붙었음)
        // 미끄러진 뒤 자리 기준. 펫 창이 이미 보이면 나올 때 기준, 아직 안 떴으면 release와 같은 넘어갈 때 기준 (둘 사이에서 놓쳐 둘로 보이지 않게)
        const outside = bodyOut({ k: free.k, x: drag.x + vx * GLIDE, y: drag.y + vy * GLIDE }, !follow!.shown);
        if (outside && follow!.shown) { link.post("send", { list: [["release", [vx, vy]]] }); link.enter(); return true; }
        if (!outside) link.post("hide");
        return false;   // 아직 안 떴으면 평소처럼 놓기 (창 밖이면 펫 창을 다시 열어 미끄러짐)
      };
      /**
       * 누름·끌기 끝내기: 끌지 않고 뗐으면 터치 반응, 들고 있었으면 놓기(던지기·펫 창 이어받기)
       * @param cancel true면 취소(pointercancel·포커스 잃음)라 터치 반응 없음
       */
      const endDrag = (e: PointerEvent, cancel: boolean) => {
        const pending = drag.pending;
        if (!pending || e.pointerId !== pending.id) return;   // 다른 손가락의 이벤트가 첫 손가락의 길게 누르기를 취소하지 않게 함
        clearTimeout(touchHold);
        drag.pending = null; strokeFrom = null;
        if (PET) PET.press(false);
        if (!drag.on) { if (!cancel && pending.h) onTouch(pending.h[0], pending.h[1], pending.h[2]); return; }   // 끌지 않고 뗌 = 터치 (그림 위에서 눌렀을 때만)
        drag.on = false;
        if (PET && petTracking) { petTracking = false; petGrab = null; PET.send({ type: "track", on: false }); }   // 이제부터 창 이동은 다시 페이지가 맡음 (놓은 뒤 미끄러짐·붙기)
        try { document.documentElement.releasePointerCapture(e.pointerId); } catch {}
        document.documentElement.classList.remove("dsc-grabbing");
        until.sweat = performance.now() + 400;
        const moving = performance.now() - drag.samples[drag.samples.length - 1][0] < 80;   // 멈췄다가 놓으면 던지지 않음
        const vx = moving ? carry.vx : 0, vy = moving ? carry.vy : 0;
        if (link.follow && finishFollow(vx, vy)) return;
        release(vx, vy, drag.touch);
      };
      life.listen(document, "pointerup", (e) => {
        if (hidden) return;
        mouseButtons = e.buttons & 3;
        chord = chordUp(chord, e.buttons);
        if (chestFrom && e.pointerId === chestFrom.id) {
          const dragged = chestDragging;
          releaseChest();
          if (dragged) { if (PET) PET.press(false); return; }   // 끌지 않고 뗐으면 아래 endDrag가 원래 가슴 터치 반응
        }
        const stroke = strokeFrom; strokeFrom = null;
        if (drag.pending) return endDrag(e, false);
        if (stroke) onTouch(stroke.h[0], stroke.h[1], stroke.h[2]);   // 쓸어내리지 않고 떼면 원래 머리 터치 반응
      }, true);
      addEventListener("blur", () => { mouseButtons = 0; chord = chordUp(chord, 0); rightPress = null; releaseChest(); if (drag.pending) endDrag({ pointerId: drag.pending.id } as PointerEvent, !drag.on); });   // 창 포커스를 잃으면 끄기를 끝냄
      life.listen(document, "pointercancel", (e) => {
        mouseButtons = 0; chord = chordUp(chord, e.buttons); rightPress = null;
        if (chestFrom && e.pointerId === chestFrom.id) { const wasDragging = chestDragging; releaseChest(); if (wasDragging && PET) PET.press(false); }
        endDrag(e, true);
      }, true);
      for (const type of ["pointerup", "mousedown", "mouseup", "click", "dblclick"]) {
        life.listen(document, type, (e) => {
          if (!swallowClick) return;
          e.preventDefault(); e.stopPropagation();
          if (type === "click" || type === "dblclick") setTimeout(() => { if (!chestFrom) swallowClick = false; }, 0);
        }, true);
      }
      let hoverCheck = 0;
      life.listen(document, "mousemove", (e) => {   // 캐릭터 위에서는 손가락 커서
        if (hidden) return;
        const now = performance.now(); if (now - hoverCheck < 80) return; hoverCheck = now;
        if (PET && petPanelOpen && petPanel && petPanel.contains(e.target)) { document.documentElement.classList.remove("dsc-hover"); return; }
        const over = !walking() && !!hitAt(e.clientX, e.clientY);
        document.documentElement.classList.toggle("dsc-hover", over);
      }, { passive: true });
      // 우클릭은 집어 옮기기의 보조 버튼이라, 끄는 중에는 메뉴를 열지 않는다 (펫 창에서는 놓은 뒤에만 메뉴)
      life.listen(document, "contextmenu", (e) => {
        if (hidden) return;
        if (drag.pending || drag.on) { e.preventDefault(); e.stopPropagation(); return; }
        if (!PET) {
          // 창 안: 캐릭터를 우클릭하면 말을 거는 입력 말풍선을 연다 (모델 대화의 직접 대화가 켜져 있을 때만).
          // 설정을 아직 못 읽었을 때도 열어 본다 — 첫 화면에서 몇 초 동안 우클릭이 그냥 브라우저 메뉴가 되던 문제
          if (chat.available() && overChat(e.clientX, e.clientY)) { e.preventDefault(); e.stopPropagation(); chat.open(); return; }
          // 터치 화면에서 캐릭터를 길게 누를 때 뜨는 브라우저 메뉴·선택을 막는다 (집기가 풀리던 원인). 데스크톱 우클릭은 그대로 둔다
          if (coarsePointer() && overBody(e.clientX, e.clientY)) { e.preventDefault(); e.stopPropagation(); }
          return;
        }
        e.preventDefault();
        if (!petPanelOpen && !walking() && overBody(e.clientX, e.clientY)) PET.menu();
      }, true);
      // 터치에서 캐릭터를 잡고 있는 동안 손가락 움직임이 페이지 스크롤로 해석되면 pointercancel이 와서 집기가 풀린다.
      // touch-action 대신 터치 이벤트에서 직접 기본 동작을 막는다 (스크롤이 시작되기 전에 취소해야 함)
      /** 터치가 창 안 캐릭터 그림 위에서 시작했는지 여부 (펫 창은 제외) */
      const touchOnBody = (e: TouchEvent) => {
        const t = e.touches && e.touches[0];
        return !!t && !PET && hitAt(t.clientX, t.clientY) !== null;
      };
      life.listen(document, "touchstart", (e) => { if (touchOnBody(e)) e.preventDefault(); }, { passive: false, capture: true });
      life.listen(document, "touchmove", (e) => {
        // 캐릭터에서 시작한 제스처만 막는다. 바깥에서 시작한 스크롤이 캐릭터를 지나가며 막히지 않게 한다.
        if (drag.on || drag.pending) e.preventDefault();
      }, { passive: false, capture: true });
      // 휠로 크기 조절: 몸 위에서 올리면 커지고 내리면 작아짐 (몸 아래 가운데를 기준으로). 들고 있을 때·움직이는 중·산책·도망 중엔 무시
      //   펫 창 = 0.45배 ~ 화면에 들어가는 크기 (넘겨받을 때는 HEAD_GAIN으로 머리 크기를 창 안과 맞춤)
      //   창 안 = 자유 위치일 때만 0.42배~그 창에 들어가는 최대치. 제자리에 붙어 있으면 크기는 자동이라 휠은 대화 스크롤 그대로
      /** 휠이 캐릭터 크기를 바꾸는 때 여부: 모바일이 아니고(캐릭터 위 휠이 대화 스크롤을 막지 않게), 지금 입력 모드의 자유 위치이고, 몸 위일 때 */
      const wheelResizes = (e: WheelEvent) => (PET || !coarsePointer()) && free.applied && intro.phase === "done" && free.on && overBody(e.clientX, e.clientY);
      life.listen(document, "wheel", (e) => {
        if (hidden) return;
        if (PET && petPanelOpen && petPanel && petPanel.contains(e.target)) return;   // 패널 안에서는 휠로 크기를 건드리지 않음
        if (!wheelResizes(e)) return;
        e.preventDefault(); e.stopPropagation();   // 캐릭터 위에서는 대화 스크롤 대신 크기 조절
        if (drag.on || free.anim || walk.phase || fleeX !== 0) return;
        const kMin = PET ? PET_K_MIN : SHOW_K, kMax = PET ? PET_K_MAX : Math.min(1.25, (innerHeight * 0.45) / visH);
        const fromK = Math.min(free.k, kMax), k = Math.min(kMax, Math.max(kMin, fromK * Math.exp(-e.deltaY * 0.0012)));
        if (k === fromK) return;
        if (PET) { free.x += W * (fromK - k) / 2; free.y += H * (fromK - k); }   // 창 안은 비율 자리(몸 가운데·아래 끝)라 그대로 둬도 아래 가운데 기준
        free.k = k;
        if (!PET) saveFree(false);
        else { petRememberRatio(petRatio()); petSyncMenu(); renderPetPanel(); }   // 펫 창: 메뉴·패널과 같은 배율을 함께 쓴다
      }, { capture: true, passive: false });

      // ---------- 바깥 펫 창: 설정 패널 (우클릭 메뉴의 설정/크기에서 연다) ----------
      // 패널은 펫 창 안에만 만든다. 클릭이 통과되는 창이라, 패널이 열려 있는 동안에는 패널 영역도 클릭을 받도록
      // place()가 hitbox에 패널 사각형을 더하고, 패널이 들어갈 만큼 창도 키운다.
      const PET_OUTFIT_ROWS = OUTFIT_ITEMS.map((item) => [item.key, item.ko]);
      const PET_BODY_ROWS = BODY_TYPES.map((body) => [body.key, body.ko]);
      /** 펫 창이 화면에 들어가며 그릴 수 있는 최대 배율 */
      function petKFit() {
        return Math.min(PET_K_MAX, (screen.availHeight - PET_BUBBLE) / H, (screen.availWidth - 40) / W);
      }
      /**
       * 펫 창 배율을 최소 배율~화면에 들어가는 최대 배율로 제한
       * @returns 유한한 수가 아니면 null
       */
      function petClampK(k: number) {
        const n = Number(k);
        return Number.isFinite(n) ? Math.min(petKFit(), Math.max(PET_K_MIN, n)) : null;
      }
      /** 기본(머리 맞춤) 크기 대비 지금 펫 창 배율 */
      function petRatio() { return petBaseK > 0 ? free.k / petBaseK : 1; }
      /**
       * 기본 크기 대비 배율로 고를 수 있는 범위
       * @returns minR·maxR (기본 대비 배율, maxR은 minR보다 최소 0.01 큼)
       */
      function petRatioBounds() {
        const minR = Math.max(0.05, PET_K_MIN / petBaseK);
        return { minR, maxR: Math.max(minR + 0.01, petKFit() / petBaseK) };
      }
      /**
       * localStorage에 기억해 둔 펫 창 크기(기본 대비 배율) 읽기
       * @returns 0.1~8 범위의 저장값, 없거나 범위 밖이거나 펫 창이 아니면 1
       */
      function petLoadRatio() {
        if (!PET) return 1;
        try {
          const n = parseFloat(localStorage.getItem(PET_SIZE_KEY) || "");
          return Number.isFinite(n) && n >= 0.1 && n <= 8 ? n : 1;
        } catch { return 1; }
      }
      /**
       * 펫 창 크기(기본 대비 배율) 저장. 연속 변경을 250ms 뒤 한 번으로 묶음
       * @param ratio 기본(머리 맞춤) 크기 대비 배율
       */
      function petRememberRatio(ratio: number) {
        if (!PET || !Number.isFinite(ratio) || ratio <= 0) return;
        clearTimeout(petSizeTimer);
        petSizeTimer = setTimeout(() => { try { localStorage.setItem(PET_SIZE_KEY, String(+ratio.toFixed(3))); } catch {} }, 250);
      }
      /**
       * 아래 가운데를 기준으로 크기만 바꾼 자리
       * @param fromK pose의 지금 배율
       * @param ratio 기본(머리 맞춤) 크기 대비 목표 배율, null이면 pose 그대로
       */
      function petSizedPose(pose: Pose, fromK: number, ratio: number) {
        if (ratio == null) return pose;
        const k = petClampK(petBaseK * ratio);
        if (k == null || Math.abs(k - fromK) < 1e-3) return pose;
        return { k, x: pose.x + W * (fromK - k) / 2, y: pose.y + H * (fromK - k) };
      }
      /** 우클릭 메뉴 체크 표시용 상태(크기·소품) 전송. 펫 프로세스가 메뉴를 만들 때 씀, 바뀌었을 때만 보냄 */
      function petSyncMenu() {
        if (!PET) return;
        const outfit = prefs.outfit || {};
        const sig = JSON.stringify([+petRatio().toFixed(3), outfit]);
        if (sig === petMenuSig) return;
        petMenuSig = sig;
        PET.send({ type: "state", value: { size: +petRatio().toFixed(3), outfit } });
      }
      /**
       * 클릭을 받을 영역에 열린 설정 패널 사각형을 더함 (창 좌표)
       * @param body 몸의 클릭 영역, 없으면 null
       * @returns 패널이 닫혀 있으면 body 그대로
       */
      function petPanelBox(body: PetBox | null) {
        if (!PET || !petPanelOpen || !petPanel) return body;
        const rect = petPanel.getBoundingClientRect();
        const box = { l: Math.round(rect.left), t: Math.round(rect.top), r: Math.round(rect.right), b: Math.round(rect.bottom) };
        return body ? { l: Math.min(body.l, box.l), t: Math.min(body.t, box.t), r: Math.max(body.r, box.r), b: Math.max(body.b, box.b) } : box;
      }
      /**
       * 메뉴·슬라이더에서 펫 창 크기 변경 (아래 가운데 기준)
       * @param ratio 기본(머리 맞춤) 크기 대비 배율
       * @param ms 크기 애니메이션 시간, 0이면 바로 적용
       */
      function petSetRatio(ratio: number, ms: number) {
        const k = petClampK(petBaseK * ratio);
        if (k == null || drag.on) return;
        const from = free.on && shown.k ? { k: shown.k, x: shown.x, y: shown.y } : { k: free.k, x: free.x, y: free.y };
        if (Math.abs(k - from.k) >= 1e-3) {
          const x = from.x + W * (from.k - k) / 2, y = from.y + H * (from.k - k);
          if (free.on) {
            if (ms > 0) free.anim = { t0: performance.now(), ms, from, to: { k, x, y }, snap: false };
            else { free.anim = null; free.x = x; free.y = y; free.k = k; }
          } else free.k = k;
        }
        petRememberRatio(k / petBaseK);
        petSyncMenu();
        renderPetPanel();
      }
      /** 설정 패널의 크기 슬라이더·소품·체형 표시를 지금 상태로 갱신 */
      function renderPetPanel() {
        if (!petPanel) return;
        const { minR, maxR } = petRatioBounds();
        const minPercent = Math.max(5, Math.ceil(minR * 100)), maxPercent = Math.max(minPercent + 1, Math.floor(maxR * 100));
        const percent = Math.min(maxPercent, Math.max(minPercent, Math.round(petRatio() * 100)));
        const slider = petPanel.querySelector<HTMLInputElement>("[data-size-slider]");
        if (slider) {
          if (slider.min !== String(minPercent)) slider.min = String(minPercent);
          if (slider.max !== String(maxPercent)) slider.max = String(maxPercent);
          if (slider.value !== String(percent)) slider.value = String(percent);
        }
        const out = petPanel.querySelector("[data-size-value]");
        if (out) out.textContent = percent + "%";
        const outfit = prefs.outfit || {};
        for (const input of petPanel.querySelectorAll<HTMLInputElement>("[data-outfit]")) input.checked = outfit[input.dataset.outfit!] === true;
        const body = outfit.bodyType || "default";
        for (const input of petPanel.querySelectorAll<HTMLInputElement>("[data-body]")) input.checked = input.value === body;
      }
      /** 펫 창 설정 패널 DOM 생성과 조작 연결 */
      function createPetPanel() {
        const root = life.own(document.createElement("div"), (node) => node.remove());
        root.id = "dsc-pet-panel";
        root.setAttribute("role", "dialog");
        root.setAttribute("aria-label", "캐릭터 설정");
        root.innerHTML = [
          '<div class="dsc-panel-head"><strong>설정</strong><button type="button" class="dsc-panel-close" data-close aria-label="닫기">×</button></div>',
          '<section class="dsc-panel-section"><div class="dsc-panel-row"><span>크기 <small>기본 대비</small></span><output data-size-value>100%</output></div>',
          '<input type="range" min="50" max="200" step="1" data-size-slider aria-label="캐릭터 크기"></section>',
          '<section class="dsc-panel-section"><div class="dsc-panel-sub">소품·옷</div>',
          ...PET_OUTFIT_ROWS.map(([key, label]) => `<label class="dsc-panel-check"><input type="checkbox" data-outfit="${key}"> ${label}</label>`),
          '</section>',
          '<section class="dsc-panel-section"><div class="dsc-panel-sub">체형</div>',
          ...PET_BODY_ROWS.map(([value, label]) => `<label class="dsc-panel-check"><input type="radio" name="dsc-pet-body" value="${value}" data-body> ${label}</label>`),
          '</section>',
          '<section class="dsc-panel-section dsc-panel-actions"><button type="button" data-hide>캐릭터 잠시 숨기기</button></section>',
        ].join("");
        document.body.append(root);
        root.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-close]")) closePetPanel(); });
        const slider = root.querySelector<HTMLInputElement>("[data-size-slider]")!;   // 위 HTML에 있는 요소
        slider.addEventListener("input", () => petSetRatio(Number(slider.value) / 100, 0));
        for (const input of root.querySelectorAll<HTMLInputElement>("[data-outfit]")) input.addEventListener("change", () => PET!.send({ type: "config", list: [[input.dataset.outfit, input.checked]] }));
        for (const input of root.querySelectorAll<HTMLInputElement>("[data-body]")) input.addEventListener("change", () => { if (input.checked) PET!.send({ type: "config", list: [["bodyType", input.value]] }); });
        root.querySelector("[data-hide]")!.addEventListener("click", () => { closePetPanel(); PET!.send({ type: "config", list: [["character", false]] }); });
        return root;
      }
      /** 창이 화면 밖으로 걸쳐 있어도 설정 패널을 보이는 화면 안에 놓기. 펫 창(Chromium)에서만 호출 */
      function fitPetPanel() {
        if (!petPanel) return;
        const rect = petPanel.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const left = Math.max(0, screen.availLeft! - screenX), top = Math.max(0, screen.availTop! - screenY);
        const right = Math.min(innerWidth, screen.availLeft! + screen.availWidth - screenX);
        const bottom = Math.min(innerHeight, screen.availTop! + screen.availHeight - screenY);
        const x = Math.max(left + 4, Math.min(right - rect.width - 4, (left + right - rect.width) / 2));
        const y = Math.max(top + 4, Math.min(bottom - rect.height - 4, (top + bottom - rect.height) / 2));
        petPanel.style.left = Math.round(x) + "px";
        petPanel.style.top = Math.round(y) + "px";
        petPanel.style.transform = "none";
      }
      /**
       * 펫 창 설정 패널 열기 (처음이면 만듦)
       * @param focus "size"면 크기 슬라이더에 포커스
       */
      function openPetPanel(focus: string) {
        if (!PET) return;
        if (!petPanel) petPanel = createPetPanel();
        renderPetPanel();
        petPanel.classList.add("show");
        petPanelOpen = true;
        // 패널이 화면보다 커지면 그때만 스크롤: 화면 작업 영역에 맞춰 상한을 둔다
        const room = Number(screen?.availHeight) > 0 ? Math.round(screen.availHeight - 48) : 560;
        petPanel.style.maxHeight = Math.max(260, Math.min(560, room)) + "px";
        petPanelWin = { w: innerWidth, h: innerHeight };
        fitPetPanel();
        const slider = focus === "size" && petPanel.querySelector<HTMLInputElement>("[data-size-slider]");
        if (slider) slider.focus({ preventScroll: true });
        petSyncMenu();
      }
      /** 펫 창 설정 패널 닫기 */
      function closePetPanel() {
        if (!petPanel) return;
        petPanelOpen = false;
        petPanelWin = { w: 0, h: 0 };
        petPanel.classList.remove("show");
      }

      // ---------- Harness 상태 → 반응 ----------
      /** 도구 실행 상태 문구 말하기. 대기 중이거나 직전 말한 지 1.5초 안이면 건너뜀 */
      listeners.tool = (text: string) => {
        const now = performance.now();
        if (waitingKind || now - lastToolSay < 1500) return;
        lastToolSay = now; say(text, 0, false, "status");
      };
      let lastThought = "", lastMutterAt = 0;
      // 캐릭터 대화: 켜져 있으면 혼잣말·결과 요약·직접 대화를 모델이 맡는다 (character/chat.ts)
      // 규칙 기반 반응은 그대로 두고, 모델이 실패하거나 꺼져 있으면 아래 규칙 쪽으로 돌아간다
      const chat = createChat({
        say, flashExp, play, expName: EXP_NAME, lifetime: life, petWindow: !!PET,
        /** 혼잣말 간격(6초)·다른 말 뒤(2.5초)를 지켰는지 */
        mutterOpen: () => performance.now() - lastMutterAt >= 6000 && performance.now() - lastSayAt >= 2500,
        /** 혼잣말을 한 것으로 표시 */
        mutterMark: () => { lastMutterAt = performance.now(); },
      });
      /**
       * 추론 혼잣말: 작업 중 화면의 추론 요약 줄(방금 끝난 문단의 첫 줄)이 바뀌면, 한국어·영어 문장을 가끔 중얼거림
       * 혼잣말 사이 6초, 다른 말 뒤 2.5초 간격 유지
       */
      const mutterCheck = () => {
        const raw = readThought(document);
        if (!raw || raw === lastThought) return;
        lastThought = raw;
        const now = performance.now();
        if (now - lastMutterAt < 6000 || now - lastSayAt < 2500) return;
        // 모델이 켜져 있으면 추론 요약을 그대로 넘겨 한국어 한 문장으로 받는다 (규칙 변환은 실패했을 때만)
        if (chat.ready("mutter")) { void chat.mutter(raw); return; }
        const line = thoughtLine(raw);
        if (!line) return;
        lastMutterAt = now;
        say(line, Math.min(5200, Math.max(3800, 1500 + line.length * 55)), true);
        if (Math.random() < 0.35) play("tilt", 1600);
      };

      // 시작 인사 (가운데 연출 중): 0.7초 뒤 5.8초 동안
      if (!PET) setTimeout(() => { if (!link.open) { say(TEXT.hello, 5800, false, "reaction"); play("sway", 2300); } }, 700);
      if (life.stopped) return;
      window.__dsc = {   // 확인용
        say, play, setMood, flashExp,
        /** 삐침 중 여부 */
        sulking: () => performance.now() < sulkUntil,
        /** 삐친 동안 몰래 보기 예정(삐친 뒤 시각 ms 반올림·flip 여부) */
        sulkPeeks: () => sulkPeeks.map((peek: { at: number; flip: boolean }) => ({ at: Math.round(peek.at), flip: peek.flip })),
        /** 산책 시작(산책·도망 중이 아니면) 후 산책 단계 */
        walk: () => { if (!walk.phase && fleeX === 0) startWalk(); return walk.phase; },
        /** 지금 산책 단계 */
        walking: () => walk.phase,
        /** 절전 상태 */
        sleep: () => SLEEP.state,
        /** 창 좌표 자리의 몸 부위 이름, 그림 밖이면 null */
        regionAt: (cx: number, cy: number) => { const h = hitAt(cx, cy); return h && touchRegion(h[0], h[1], h[2]); },
        /** 도망·산책으로 옆으로 비켜난 거리(px, + 오른쪽 · - 왼쪽) */
        fleeX: () => fleeX,
        /** 보이는 말풍선 문구, 없으면 빈 문자열 */
        bubble: () => bubble.classList.contains("show") ? bubble.textContent : "",
        /** 보이는 상태 말풍선(명령 실행 중 등) 문구, 없으면 빈 문자열 */
        status: () => bubbleStatus.classList.contains("show") ? bubbleStatus.textContent : "",
        lines: TEXT,
        /** 외부 음성 상태 설정. speaking이 false거나 null이면 해제 */
        voice: (state: VoiceState | null) => { voiceState = state && state.speaking !== false ? state : null; },
      };

      // ---------- 바깥 펫 창 연결 (창 안 캐릭터 쪽) ----------
      // 연결 상태·송수신·알림 처리·동기화 주기·미리 띄우기·토글은 character/pet-link.js. 여기는 연결이 부르는 캐릭터 동작만 둔다.
      /** 펫 창이 보이기 시작할 때 처리: 창 안 캐릭터는 숨기고 그리기를 멈춤 */
      const petLinkEnter = () => { skipIntro(); hideStatus(); free.anim = null; drag.pending = null; drag.on = false; setRender(false); };
      /** 펫 창이 제자리에 붙었거나 닫혔을 때 처리: 창 안 제자리로 (창이 좁으면 구석, 매 프레임 다시 계산) */
      const petLinkLeave = () => {
        wakeRaf();
        SLEEP.state = "active"; SLEEP.lastActive = performance.now();
        free.on = false; free.anim = null; saveFree(); lastPlaceKey = "";
        if (!hidden) setRender(true);
      };
      /**
       * 펫 창이 보이기 시작할 때 지금 표정·자세를 한 번에 맞추는 메시지 목록 (따라오는 동안·숨어 있는 동안 바뀐 것, 예: 작업이 끝나 로딩 표정이 꺼짐)
       */
      const petLinkSnapshot = () => {
        const left = moodUntil ? Math.max(1, moodUntil - performance.now()) : 0;
        const list: PetMessage[] = [...Object.keys(hold).map((name): PetMessage => ["setExp", [name, !!hold[name]]]), ["setMood", [mood, left]]];
        if (!bubble.classList.contains("show")) list.push(["hush", []]);
        return list;
      };
      /** 펫 창 안에서도 같은 이동 키로 옮길 수 있게 보내는 메시지 목록 (일반 키는 포커스 없는 펫 창에 눌림 상태도 전달) */
      const petLinkDragMessages = () => {
        const list: PetMessage[] = [["drag", [dragKeyRaw()]]];
        const dragToken = dragKeyToken();
        if (dragToken && !DRAG_MODIFIER_TOKENS.has(dragToken)) list.push(["dragheld", [dragToken, pressedKeys.has(dragToken)]]);
        return list;
      };
      /** 펫 창이 붙을 자리(DSH 창의 제자리, 창이 좁으면 구석, 화면 좌표)와 소품·옷 */
      const petLinkDock = () => {
        const dockSpot = dockTarget(homePose()), dockSpotScreen = screenOf(dockSpot.x - fleeX, dockSpot.y);
        // 붙는 순간 창 안 상반신 그림과 정확히 겹치도록, 허리(잘린 단면)와 가슴 중심을 기준으로 자리를 잡는다.
        //  · 창 안: 허리는 캔버스 y = WAIST_WIN, 상반신 가로 중심은 캔버스 가운데
        //  · 펫 창: 같은 허리·중심이 그 지점에 오도록 배율(PET_HEAD_RATIO)과 위치를 역산
        const petK = dockSpot.k * PET_HEAD_RATIO;
        const bustCenterX = dockSpotScreen.x + W * dockSpot.k / 2;   // 창 안 상반신 가로 중심 (화면)
        const waistY = dockSpotScreen.y + dockSpot.k * WAIST_WIN;    // 창 안 허리 (화면)
        const topLeft = screenOf(0, 0), bottomRight = screenOf(innerWidth, innerHeight);   // DSH 창 영역 (펫 창이 다시 붙을지 판단)
        const dock = {
          k: +petK.toFixed(3),
          x: Math.round(bustCenterX - petK * (W / 2 + (BUST_CX - FULL_CX) * fullScale)),
          y: Math.round(waistY - petK * WAIST_PET),
          win: { l: Math.round(topLeft.x), t: Math.round(topLeft.y), r: Math.round(bottomRight.x), b: Math.round(bottomRight.y) },
        };
        return { dock, outfit: prefs.outfit || {} };
      };
      /** 단축키로 펫 창을 열 자리: 지금 그린 자리 (잠들었거나 그린 적이 없으면 제자리), 화면 좌표 */
      const petOpenScreenPose = () => {
        const pose = SLEEP.state === "active" && shown.k > 0 ? { k: shown.k, x: shown.x, y: shown.y } : dockTarget(homePose());
        const screenPos = screenOf(pose.x, pose.y);
        return { k: pose.k, x: screenPos.x, y: screenPos.y };
      };
      link.start();   // 펫 경로가 없으면(펫 창 자신·ASAR) 아무것도 하지 않는다
      // 단축키: 바깥 펫 창으로 내보내기 / 돌아오기 (창 안 캐릭터만)
      if (!PET) hooks.togglePet = link.toggle;
      // ---------- 펫 창 쪽: 창 안 캐릭터가 보낸 반응을 그대로 재생 ----------
      if (PET) {
        const local: Record<string, (...args: any[]) => void> = { say, play, setMood, flashExp, setExp, hush };
        /** 따라오는 중 커서 처리 (화면 좌표). 몸 위치 = 커서 − 잡은 자리 */
        const onPetCursor = (message: PetMsg) => {
          if (!drag.on || !petGrab) return;
          const now = performance.now();
          drag.x = message.x - petGrab.x; drag.y = message.y - petGrab.y;
          drag.samples.push([now, message.x, message.y]);
          while (drag.samples.length > 2 && now - drag.samples[0][0] > 100) drag.samples.shift();
          const [t0, x0, y0] = drag.samples[0], dt = Math.max(16, now - t0) / 1000;
          carry.vx += ((message.x - x0) / dt - carry.vx) * 0.5; carry.vy += ((message.y - y0) / dt - carry.vy) * 0.5;
        };
        /** 펫 창 보임·숨김 처리. 창이 숨으면 그리기를 멈춰 CPU·GPU를 쓰지 않음 (숨은 창도 백그라운드 제한이 꺼져 있어 계속 그려짐) */
        const onPetPower = (message: PetMsg) => {
          if (!message.on) {
            petTracking = false; petGrab = null; closePetPanel();
            // 숨는 순간 진행 중이던 산책을 끝내고 상태를 비운다 (다시 열 때 옛 경계/투명도가 남지 않게)
            for (const t of walk.timers) clearTimeout(t);
            walk.timers = []; walk.slideId++; walk.phase = ""; walk.dir = -1; fleeX = 0; clearWalkVisual();
          }
          petPower = !!message.on;
          setRender(petPower);
          if (petPower) wakeRaf();
          if (petPower) requestPetDisplay();
        };
        /** 펫 창 메인 프로세스가 placer로 실제 적용한 native 창 bounds 기록 (산책 clip 기준), 표시장치 변경 복구 중이면 목표 자리 확인 */
        const onPetBounds = (message: PetMsg) => {
          const bounds = message.bounds;
          if (bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every((value) => Number.isFinite(value))) petBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, at: performance.now() };
          confirmRecoverBounds();
        };
        /** 펫 창 열기 처리: 창 밖으로 던진 자리에서 나타나 남은 거리만큼 미끄러짐. follow면 놓을 때까지 창 안 커서를 따라옴 */
        const onPetOpen = (message: PetMsg) => {
          petPower = true;
          setRender(true);
          wakeRaf();
          // 이전 회차에 남은 상태(끄는 중·식은땀·산책·도망)를 모두 지우고 시작
          for (const t of walk.timers) clearTimeout(t);
          walk.timers = []; walk.slideId++; walk.phase = ""; fleeX = 0; clearWalkVisual(); petBounds = null; drag.pending = null; PET.press(false);
          closePetPanel();
          petDocked = false; free.on = true; Object.assign(free, message.from);
          petGrab = message.follow ? (message.grab || { x: 0, y: 0 }) : null; petTracking = !!message.follow;
          // 펫 창은 전신이라 같은 배율이면 머리가 작아진다. 창 안 배율과의 비율(HEAD_GAIN)만큼 키워 머리 크기를 맞추고,
          // 창(과 화면)에 들어가는 크기로 자른다. 아래 가운데를 고정한 채 배율만 바꾼다
          const kFrom = Number(message.from.k) || 1;
          const kBase = Math.min(petKFit(), Math.max(PET_K_MIN, kFrom * HEAD_GAIN));   // 기본(머리 맞춤) 크기
          petBaseK = kBase;
          // 기억해 둔 배율: 따라오는 중에는 놓을 때(release)에 맞추고, 바로 나타날 때는 미끄러지며 맞춘다
          const ratio = petLoadRatio();
          petPendingRatio = message.follow ? ratio : null;
          const kApply = message.follow ? kBase : petClampK(kBase * ratio)!;   // 유한한 값이면 null이 아님
          if (kApply !== kFrom) {
            const kDelta = kFrom - kApply;
            free.x += W * kDelta / 2; free.y += H * kDelta; free.k = kApply;
            if (petGrab) petGrab = { x: petGrab.x * kApply / kFrom, y: petGrab.y * kApply / kFrom };
          }
          const pose = { k: free.k, x: free.x, y: free.y }, to = { k: kApply, x: message.to.x + W * (kFrom - kApply) / 2, y: message.to.y + H * (kFrom - kApply) };
          PET.send({ type: "track", on: !!message.follow, grab: petGrab, off: { x: (innerWidth - W * pose.k) / 2, y: innerHeight - H * pose.k } });   // 따라오기: 펫 프로세스가 커서를 따라 창을 옮기고 커서를 보내 줌
          drag.on = !!message.follow; drag.x = pose.x; drag.y = pose.y; drag.samples = [[performance.now(), pose.x + (petGrab?.x ?? 0), pose.y + (petGrab?.y ?? 0)]];
          free.anim = message.follow ? null : { t0: performance.now(), ms: 300, from: pose, to: keepIn(to), snap: false };
          until.sweat = message.follow ? Infinity : 0;
          movePet(pose); PET.send({ type: "placed" });
          requestPetDisplay({ x: pose.x + W * pose.k / 2, y: pose.y + H * pose.k * 0.5 });   // 이 창이 실제로 놓인 모니터
          petSyncMenu();
        };
        /** 우클릭 메뉴의 창으로 돌아가기 처리 */
        const onPetHome = () => {
          closePetPanel();   // 붙을 자리(원래 크기)로 애니메이션되고 펫 창은 닫힌다
          if (petDock) free.anim = { t0: performance.now(), ms: 650, from: { ...shown }, to: null, snap: true };
          else PET.send({ type: "attach" });
        };
        /**
         * 창 안 캐릭터가 창 밖에서 놓았을 때 처리: 여기서 이어서 미끄러지거나 붙음
         * @param vx 던질 속도 x(px/s)
         * @param vy 던질 속도 y(px/s)
         */
        const releaseFromHost = (vx: number, vy: number) => {
          petGrab = null; petTracking = false; PET.send({ type: "track", on: false });
          drag.on = false; until.sweat = performance.now() + 400; release(vx, vy);
        };
        // 창 안 캐릭터가 보낸 명령 하나 (펫 창 쪽 상태 갱신, 아니면 반응 재생)
        const PET_COMMANDS: Record<string, (args: any[]) => void> = {
          /** 소품·옷 설정 반영 */
          outfit: (args: any[]) => { prefs.outfit = args[0]; renderPetPanel(); petSyncMenu(); },
          /** 붙을 자리 갱신 */
          dock: (args: any[]) => { petDock = args[0]; },
          /** 외부 음성 상태 반영 */
          voice: (args: any[]) => { voiceState = args[0]; },
          /** 창 안 캐릭터와 같은 이동 키 설정 */
          drag: (args: any[]) => { prefs.drag = { key: args[0] }; },
          /** 포커스 없는 펫 창에 일반 이동 키의 눌림 상태 전달 */
          dragheld: (args: any[]) => { if (args[1]) pressedKeys.add(args[0]); else pressedKeys.delete(args[0]); },
          /** 창 안 캐릭터가 창 밖에서 놓음(던질 속도 vx·vy) */
          release: (args: number[]) => { if (drag.on) releaseFromHost(args[0], args[1]); },
        };
        /** 명령 목록 메시지 처리: PET_COMMANDS에 있으면 펫 창 쪽 상태 갱신, 아니면 반응 함수 재생 */
        const onPetCommands = (message: PetMsg) => {
          for (const [fn, args] of message.list || []) {
            if (Object.hasOwn(PET_COMMANDS, fn)) PET_COMMANDS[fn](args);
            else if (Object.hasOwn(local, fn) && Array.isArray(args)) local[fn](...args);
          }
        };
        const PET_MESSAGES: Record<string, (message: PetMsg) => void> = {
          cursor: onPetCursor,
          power: onPetPower,
          /** pet/main.cjs: 현재 표시장치 DIP workArea (산책 출발 시 고정). request·displays는 top-level로 옴 */
          display: (message: PetMsg) => applyPetDisplay(message.display, !!message.changed, message.request, message.displays),
          bounds: onPetBounds,
          /** 우클릭 메뉴: 설정(또는 크기) 패널 열기 */
          panel: (message: PetMsg) => openPetPanel(message.focus),
          /** 우클릭 메뉴: 정해진 배율로 (기본 대비) */
          size: (message: PetMsg) => petSetRatio(Number(message.ratio), 220),
          open: onPetOpen,
          home: onPetHome,
          cmd: onPetCommands,
        };
        PET.on((message: PetMsg) => { if (Object.hasOwn(PET_MESSAGES, message.type)) PET_MESSAGES[message.type](message); });
        petPower = false;
        setRender(false);   // 처음엔 숨은 채 대기 (open 이 오면 그리기 시작)
        PET.send({ type: "ready" });
        requestPetDisplay();   // 창이 아직 숨은 상태에서도 현재 표시장치를 미리 받아 둔다
      }
      // ---- 400ms마다: DSH 작업 상태 → 반응, 절전 판정 ----
      /** 절전 설정 읽기 (0.5~60분, 기본 1분) */
      const readSleepPrefs = () => {
        const sleepPrefs = prefs.sleep || {};
        SLEEP.enabled = !PET && sleepPrefs.enabled !== false;
        const minutes = Number(sleepPrefs.minutes);
        SLEEP.minutes = Number.isFinite(minutes) ? Math.min(60, Math.max(0.5, minutes)) : 1;
      };
      /**
       * 승인·질문 대기가 생기거나 풀릴 때 반응
       * @param kind 지금 대기 종류, 대기가 없으면 null
       */
      const reactToWaiting = (kind: "approval" | "question" | null) => {
        if (kind === waitingKind) return;
        waitingKind = kind;
        setExp("sweat", kind === "approval");
        setExp("squint", kind === "question");
        if (kind) { say(TEXT[kind], 0, false, "reaction"); setMood("wait"); play("tilt", 1800); }
        else { setMood(running ? "work" : "idle"); if (running) hush(); }
      };
      /** 작업이 끝났을 때 반응: 실패 문구가 8초 안에 보였으면 시무룩, 아니면 칭찬해 달라고 함 */
      const reactToFinish = () => {
        if (running) return;
        hideStatus();   // 작업이 끝났으므로 상태 말풍선을 내린다
        if (performance.now() - lastError < 8000) { flashExp("tears", 5000); flashExp("dizzy", 2500); say(TEXT.error, 5000, false, "reaction"); setMood("sad", 5000); play("droop", 2000); }
        else if (chat.ready("summary")) {   // 결과 요약도 모델이 맡는다 (실패하면 규칙 대사로)
          setMood("idle"); play("laugh", 1700);
          void chat.summary().then((ok) => { if (!ok) { flashExp("heart", 4000); flashExp("blush", 4000); say(TEXT.done, 4000, false, "reaction"); } });
        }
        else { flashExp("heart", 4000); flashExp("blush", 4000); say(TEXT.done, 4000, false, "reaction"); setMood("idle"); play("laugh", 1700); }
      };
      /**
       * 작업이 시작되거나 끝날 때 반응
       * @param nowRunning 이번 확인에서 작업 중이면 true
       */
      const reactToRunning = (nowRunning: boolean) => {
        if (nowRunning && !running) {
          running = true; lastError = -1e9;
          setExp("loading", true);
          if (!waitingKind) { say(TEXT.start, 2500, false, "reaction"); setMood("work"); play("nod", 1300); }
        } else if (!nowRunning && running) {
          running = false;
          setExp("loading", false);
          setTimeout(reactToFinish, 600);   // 실패 문구가 늦게 그려질 수 있어 잠깐 기다림
        }
      };
      /** 절전 판정: 설정된 시간 동안 입력·작업·대기·화면 전환이 없으면(말한 뒤 5초, 말풍선 없음 포함) 잠시 쉬러 갈 때 여부 */
      const sleepDue = () => SLEEP.enabled && SLEEP.state === "active" && !running && !waitingKind && !document.hidden &&
        performance.now() - SLEEP.lastActive > SLEEP.minutes * 60000 &&
        performance.now() - lastSayAt > 5000 && !bubble.classList.contains("show");
      if (!PET) setInterval(() => {
        const { running: nowRunning, waiting: kind } = readStatus(document);
        readSleepPrefs();
        // 잠든 동안에도 대기 카드를 확인하고 기존 반응으로 이어감
        if (nowRunning || kind || !SLEEP.enabled) sleepActivity();
        if (SLEEP.state === "asleep") return;
        if (nowRunning && !waitingKind && !kind) mutterCheck();
        reactToWaiting(kind);
        reactToRunning(nowRunning);
        if (sleepDue()) sleepGo();
      }, 400);
    })().catch((e) => console.warn("DeepSeek짱 캐릭터 로드 실패:", e));
  });
  return {
    /** 플러그인 설정 변경 반영. 패널 숨김(pageHidden)이 바뀌면 바로 숨김/복구 */
    setPrefs(next) {
      const pageChanged = "pageHidden" in next && next.pageHidden !== prefs.pageHidden;
      Object.assign(prefs, next);
      if (pageChanged) hooks.syncPageHidden?.();
    },
    /** 펫 창 토글 함수. 모델이 준비되기 전에는 null (단축키는 이때 키 입력을 가로채지 않음) */
    get togglePet() { return hooks.togglePet || null; },
    /** 창 안 캐릭터 숨기기·보이기 토글 함수. 모델이 준비되기 전과 펫 창에서는 null */
    get toggleCanvas() { return hooks.toggleCanvas || null; },
    /** 창 안 캐릭터 숨김 여부 */
    canvasHidden: () => hooks.canvasHidden?.() === true,
  };
}
