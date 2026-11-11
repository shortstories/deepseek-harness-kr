// Live2D(Cubism 4, pixi-live2d-display) 렌더러. character/index.ts에 있던 모델 불러오기·크기 계산·Core Worker·
// 표정 파일·동물귀·터치용 메시 판정·그리기를 옮겨 왔고, 동작 코드는 rig.ts의 AvatarRig 통로로만 씀.
import { MODEL_FILES, PARAMS, CHEST_DRAG_SIGN, PARTS, PART_REGIONS, EXPRESSION_FILES, GEOMETRY, BEHAVIORS } from "./model-profile.ts";
import { meshBounds, meshHit } from "./hit.ts";
import { DEFAULT_GAZE } from "./gaze.ts";
import { clamp } from "./motion.ts";
import { log } from "./log.ts";
import type { Lifetime } from "./lifetime.ts";
import type { CharacterPrefs, Spring } from "./types.ts";
import type { AvatarRig, RigFeature, RigMetrics, TouchShape } from "./rig.ts";
import "./globals.d.ts";

/** 이 rig가 지원하는 기능 (Live2D 모델은 전부) */
const FEATURES: ReadonlySet<RigFeature> = new Set<RigFeature>(["bodyType", "earHide"]);

/**
 * Live2D 런타임 스크립트(Cubism Core·PixiJS·pixi-live2d-display) 불러오기
 * @param load 자산 폴더 기준 스크립트 불러오기 (태그는 life가 정리)
 */
export async function loadLive2DScripts(load: (src: string) => Promise<unknown>) {
  if (!window.Live2DCubismCore) await load("vendor/live2dcubismcore.min.js");
  if (!window.PIXI) await load("vendor/pixi.min.js");
  if (!window.PIXI.live2d) await load("vendor/cubism4.patched.js");
}

/**
 * Live2D rig 생성: 캔버스에 PIXI 앱과 모델을 올리고 크기 값을 계산
 * @param chestDrag 가슴 끌기 스프링 (lift = 위아래 0~1, shift = 좌우 -1~1). 물리 계산 뒤 가슴 파라미터에 더함
 * @returns rig, 불러오는 사이 꺼졌으면 null
 */
export async function createLive2DRig({ base, life, pet, prefs, canvas, W, H, chestDrag }: {
  base: string; life: Lifetime; pet: unknown; prefs: CharacterPrefs; canvas: HTMLCanvasElement; W: number; H: number;
  chestDrag: { lift: Spring; shift: Spring };
}): Promise<AvatarRig | null> {
  const BASE = base;
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
  if (life.stopped) { model.destroy(); return null; }
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
  if (internalModel.physics) {
    const evaluate = internalModel.physics.evaluate;
    const chestParams = PARAMS.chestSwayVertical.map(paramRange).filter((found): found is { id: string; min: number; max: number } => !!found);     // 위아래
    const chestXParams = PARAMS.chestSwayHorizontal.map(paramRange).filter((found): found is { id: string; min: number; max: number } => !!found);   // 좌우
    /** 물리 계산 뒤 끌어올린·끌어당긴 정도만큼 가슴 파라미터에 더하기 */
    internalModel.physics.evaluate = function (this: unknown, ...args: unknown[]) {
      const result = evaluate.apply(this, args);
      // 물리가 덮어쓴 뒤 가슴에만 더함 (파라미터 범위를 꽉 쓰고, 좌우는 방향 따라)
      const lift = chestDrag.lift.x * CHEST_DRAG_SIGN, shift = chestDrag.shift.x * CHEST_DRAG_SIGN;
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
  if (life.stopped) return null;   // 표정 파일을 받는 사이 꺼졌으면 여기서 멈춤
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

  // ---------- 터치용 메시 판정 ----------
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
    const alphaMap = alphaMaps![textureIndex]; if (!alphaMap) return 255;   // pick이 먼저 만든다
    return alphaMap[Math.min(ALPHA_SIZE - 1, Math.max(0, Math.floor((1 - v) * ALPHA_SIZE))) * ALPHA_SIZE + Math.min(ALPHA_SIZE - 1, Math.max(0, Math.floor(u * ALPHA_SIZE)))];
  };
  /** 터치를 받을 수 있는 drawable 여부. 귀는 earHide 감쇠 전 가시성으로 터치 판정 유지 */
  const touchable = (i: number) => earSet.has(i) ? earHitVisible(i) : !(drawables.opacities[i] < 0.05 || !(drawables.dynamicFlags[i] & 1));

  const DPR = (devicePixelRatio || 1) * 1.5;   // 1.5배로 그려 줄여 보여 줌 (윤곽선 매끄럽게)
  const metrics: RigMetrics = {
    W, H, visW: bodyWidth * modelScale, noseX: model.x + noseModelX * model.scale.x, chibiHeadDrop, walkBodyWidth: WALK_BODY_WIDTH,
    waistPet: WAIST_PET, waistWin: WAIST_WIN, waistPct: WAIST_PCT, petHeadRatio: PET_HEAD_RATIO, headGain: HEAD_GAIN,
    petKMin: PET_K_MIN, petKMax: PET_K_MAX, petBubble: PET_BUBBLE, petBustOffset: (BUST_CX - FULL_CX) * fullScale,
  };
  return {
    metrics,
    behaviors: BEHAVIORS,
    gaze: DEFAULT_GAZE,
    adultAllowed: true,
    supports: (feature) => FEATURES.has(feature),
    set: setParam,
    add: addParam,
    multiply: multiplyParam,
    expressionNames: () => Object.keys(expressionParams),
    expression(name, w) {
      for (const entry of expressionParams[name] || []) {
        if (entry.Blend === "Multiply") multiplyParam(entry.Id, entry.Value, w);
        else if (entry.Blend === "Add") addParam(entry.Id, entry.Value, w);
        else setParam(entry.Id, entry.Value, w);
      }
    },
    earHide(on, dt) {
      const earWas = earWeight;
      earWeight = earOpacityStep(earWeight, on, dt);
      if (earPartIndex >= 0) {
        if (earWeight > 0.005) applyEarOpacity(cubismModel.parts, earPartIndex, earWeight);
        else if (earWas > 0.005) cubismModel.parts.opacities[earPartIndex] = 1;
      }
    },
    bodyShape(weight) { model.y = baseY + chibiDrop * clamp(weight, 0, 1); },
    onFrame(fn) {
      internalModel.motionManager.expressionManager = {
        /** 정리할 것 없음 (Live2D 표정 매니저 자리 채우기용) */
        destroy() {},
        /** 한 프레임의 절차 애니메이션 (Live2D 모델 갱신 중 표정 매니저 자리에서 불림) */
        update: fn,
      };
    },
    pick(x, y) {
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
    },
    touchShape(x, y, drawable): TouchShape {
      const scale = model.scale.x, currentChest = chestCenter();
      const shiftX = currentChest && chestBase ? currentChest.x - chestBase.x : 0, shiftY = currentChest && chestBase ? currentChest.y - chestBase.y : 0;
      const ratioX = (x - model.x - (bodyBounds.minX + shiftX) * scale) / (bodyBounds.w * scale);
      const ratioY = (y - model.y - (bodyBounds.minY + shiftY) * scale) / (bodyBounds.h * scale);
      const inChest = Math.pow((ratioX - GEOMETRY.chestCenterX) / GEOMETRY.chestRadiusX, 2) + Math.pow((ratioY - GEOMETRY.chestCenterY) / GEOMETRY.chestRadiusY, 2) <= 1;
      return { part: drawRegion[drawable], ratioY, inChest };
    },
    chibiRegion(y) {
      let y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < drawables.count; i++) {
        if (drawables.opacities[i] < 0.05) continue;
        const vertices = internalModel.getDrawableVertices(i);
        for (let j = 1; j < vertices.length; j += 2) { if (vertices[j] < y0) y0 = vertices[j]; if (vertices[j] > y1) y1 = vertices[j]; }
      }
      return ((y - model.y) / model.scale.y - y0) / (y1 - y0) < GEOMETRY.chibiHeadBottom ? "head" : "body";
    },
    setResolution(k) { const res = DPR * Math.max(1, k); if (app.renderer.resolution === res) return; app.renderer.resolution = res; app.renderer.resize(W, H); },
    resetClock() { app.ticker.lastTime = performance.now(); },
    tick(time) { app.ticker.update(time); },
    systemTicker,
  };
}
