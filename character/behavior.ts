// 행동 시스템: 캐릭터 고유 행동(냄비·삐짐 등)을 기본 동작과 나눠, 모델 프로필이 쓸 행동을 목록으로 고른다.
// 기본 시스템은 입력·상태를 판정해 이벤트 키 하나를 정하고(선택 지점), 그 키를 맡은 행동 하나로 보낸다.
// 맡은 행동이 없으면 기본 반응을 한다. 행동끼리 순서·체인은 없다.
// DOM·모델을 직접 모르는 순수 모듈이라 행동이 쓸 기능(ctx)은 캐릭터 코드(character/index.ts)가 만들어 넘긴다.
import type { Motion } from "./types.ts";

/** 선택 지점이 내는 이벤트 키 */
export const EVENTS = {
  /** 머리를 누른 채 빠르게 쓸어내림 */
  headStrokeFast: "touch.head.stroke.fast",
  /** 머리를 누른 채 천천히 쓸어내림 */
  headStrokeSlow: "touch.head.stroke.slow",
  /** 머리 탭이 8초 안에 세 번째 (맡은 행동이 없으면 평소 머리 탭) */
  headRepeat: "touch.head.repeat",
  /** 가슴 부위 탭 (맡은 행동이 없으면 가슴 부위는 몸으로 침) */
  chestTap: "touch.chest.tap",
  /** 가슴을 누른 채 위로 끌기. phase = start → move… → end(놓음) 또는 cancel(집기로 넘어감) */
  chestPull: "touch.chest.pull",
  /** 아랫배(치마) 부위 탭 (맡은 행동이 없으면 몸으로 침) */
  lowerTap: "touch.lower.tap",
  /** 소품·옷·체형을 켠 순간. concept = 소품 정의(shared/settings.js line)가 정한 대사 콘셉트 */
  outfitChange: "outfit.change",
} as const;
/** 기본 시스템이 읽는 상태 표시 */
export const TAGS = {
  /** 행동이 자기 연출 중: 대기 몸짓·산책·소품 대사·가슴 끌기 같은 자율 동작을 하지 않음 */
  busy: "busy",
  /** 정면을 똑바로 봄: 시선을 고정하고 얼굴·몸 흔들림을 거의 멈춤 */
  stare: "gaze.stare",
  /** 부끄럽지만 좋아서 입꼬리가 올라간 "헤~" 입과 곤란한 눈썹 */
  shySmile: "face.shy",
  /** 팔이 몸 앞에서 가슴을 가리는 중: 그 팔을 누르면 가슴 터치로 봄 */
  armCover: "pose.arm-cover",
} as const;
export type EventKey = (typeof EVENTS)[keyof typeof EVENTS];

/** 이벤트 데이터: 시각과 선택 지점이 아는 자리 (창 좌표). 끌기 이벤트는 단계(phase)와 누른 자리에서 움직인 거리(dx·dy, 창 px) */
export type BehaviorEvent = { now: number; x: number; y: number; phase?: "start" | "move" | "end" | "cancel"; dx?: number; dy?: number; concept?: string };
/**
 * 프레임 기여 자리 (파이프라인 순서): start = 프레임 처음 (모델 입력 스프링 등), motion = 몸짓 뒤 고개·몸 값에 더하기,
 * face = 입 모양 쓰는 중 (볼·입·눈썹 표정), params = 모델 파라미터 쓰기 (가슴 가리기 팔·소품 자리)
 */
export type FrameSlot = "start" | "motion" | "face" | "params";
/** 프레임 기여가 받는 값 */
export type BehaviorFrame = { now: number; dt: number; seconds: number };
/**
 * 자세 덮어쓰기 결과 (삐짐 외면 등): weight = 덮어쓴 정도(0~1, 기본 표정·눈동자를 이만큼 줄임),
 * eye = 덮어쓴 눈동자 가로 값, peek = 몰래 보기 정도(0~1)
 */
export type BlendResult = { weight: number; eye: number; peek: number };
/** 덮어쓰는 행동이 없을 때 */
export const NO_BLEND: BlendResult = { weight: 0, eye: 0, peek: 0 };

/** 행동 하나의 실행 상태 (캐릭터마다 create가 한 번 만든다. 상태는 클로저에 둔다) */
export interface BehaviorInstance {
  /** 맡는 이벤트 */
  on: Partial<Record<EventKey, (event: BehaviorEvent) => void>>;
  /** 프레임 기여 (motion 자리에서만 motion을 고친다) */
  frame?: Partial<Record<FrameSlot, (frame: BehaviorFrame, motion: Motion) => void>>;
  /** 고개·몸 자세 덮어쓰기 (몸짓·걷기·관성 뒤). motion을 섞어 고치고 덮어쓴 정도를 돌려줌, 안 하면 null */
  blend?(motion: Motion, frame: BehaviorFrame): BlendResult | null;
  /** 지금 붙어 있는 상태 표시 (다른 행동·기본 시스템이 tagged로 물어봄). 예: "head.covered" */
  tags?(now: number): readonly string[];
  /** 어느 부위든 터치가 받아들여질 때마다 알림 (맡은 이벤트와 상관없이 모두에게. 다른 부위를 만지면 연타 횟수를 푸는 데 씀) */
  touched?(region: string, now: number): void;
}
/** 행동 정의 */
export interface BehaviorDef<Ctx> {
  /** 프로필 목록에 쓰는 ID (예: "deepseek-chan.pot") */
  id: string;
  /** 성적 표현이 든 행동 (모델이 허용하지 않으면 목록에 있어도 끔, 예: VRM 메타가 금지) */
  adult?: boolean;
  create(ctx: Ctx): BehaviorInstance;
}
/** 켜진 행동 묶음 */
export interface Behaviors {
  /** 켜진 행동 ID (프로필 목록 중 알려진 것) */
  readonly ids: readonly string[];
  /** 그 이벤트를 맡은 행동이 있는지 (선택 지점이 감지를 준비할지 정할 때) */
  has(key: EventKey): boolean;
  /** 그 이벤트를 맡은 행동에 보냄. 맡은 행동이 없으면 false (호출한 쪽이 기본 반응) */
  dispatch(key: EventKey, event: BehaviorEvent): boolean;
  /** 프레임 기여 자리 실행 */
  frame(slot: FrameSlot, frame: BehaviorFrame, motion?: Motion): void;
  /** 터치 알림을 켜진 행동 모두에게 */
  touched(region: string, now: number): void;
  /** 자세 덮어쓰기 실행. 여럿이 덮어쓰면 가장 세게 덮어쓴 결과 (없으면 NO_BLEND) */
  blend(motion: Motion, frame: BehaviorFrame): BlendResult;
  /** 켜진 행동 중 하나라도 지금 그 상태 표시를 달고 있는지 */
  tagged(tag: string, now: number): boolean;
}

/**
 * 프로필 목록대로 행동을 만들고 이벤트 바인딩 확인
 * - 모르는 ID는 경고 후 무시, 같은 ID가 두 번 있으면 한 번만, 성적 표현을 허용하지 않는 모델이면 adult 행동은 경고 후 끔
 * - 이벤트 하나를 둘 이상이 맡으면 설정 오류: 경고 후 그 이벤트는 기본 반응 (목록 순서로 이기는 쪽을 정하지 않음)
 * @param defs 내장 행동 정의
 * @param ids 프로필의 행동 목록
 * @param ctx 행동이 쓸 기능 (create에 그대로 넘김)
 */
export function createBehaviors<Ctx>(defs: readonly BehaviorDef<Ctx>[], ids: readonly string[], ctx: Ctx,
  { allowAdult = true, warn = () => {} }: { allowAdult?: boolean; warn?: (message: string) => void } = {}): Behaviors {
  const byId = new Map(defs.map((def) => [def.id, def]));
  const enabled: { def: BehaviorDef<Ctx>; instance: BehaviorInstance }[] = [];
  for (const id of new Set(ids)) {
    const def = byId.get(id);
    if (!def) { warn(`알 수 없는 행동: ${id}`); continue; }
    if (def.adult && !allowAdult) { warn(`성적 표현을 허용하지 않는 모델이라 끔: ${id}`); continue; }
    enabled.push({ def, instance: def.create(ctx) });
  }
  const owners = new Map<EventKey, ((event: BehaviorEvent) => void)[]>();
  for (const { instance } of enabled) for (const [key, handler] of Object.entries(instance.on) as [EventKey, (event: BehaviorEvent) => void][]) {
    if (!handler) continue;
    owners.set(key, [...(owners.get(key) || []), handler]);
  }
  const handlers = new Map<EventKey, (event: BehaviorEvent) => void>();
  for (const [key, list] of owners) {
    if (list.length === 1) handlers.set(key, list[0]);
    else warn(`이벤트를 둘 이상의 행동이 맡음 (기본 반응으로 처리): ${key}`);
  }
  type SlotFn = (frame: BehaviorFrame, motion: Motion) => void;
  const slots = (slot: FrameSlot) => enabled.map(({ instance }) => instance.frame?.[slot]).filter((fn): fn is SlotFn => !!fn);
  const frameSlots: Record<FrameSlot, SlotFn[]> = { start: slots("start"), motion: slots("motion"), face: slots("face"), params: slots("params") };
  const touchedFns = enabled.map(({ instance }) => instance.touched?.bind(instance)).filter((fn): fn is NonNullable<BehaviorInstance["touched"]> => !!fn);
  const noMotion = {} as Motion;
  const blends = enabled.map(({ instance }) => instance.blend?.bind(instance)).filter((fn): fn is NonNullable<BehaviorInstance["blend"]> => !!fn);
  return {
    ids: enabled.map(({ def }) => def.id),
    has: (key) => handlers.has(key),
    dispatch(key, event) {
      const handler = handlers.get(key);
      if (!handler) return false;
      handler(event);
      return true;
    },
    frame(slot, frame, motion = noMotion) { for (const fn of frameSlots[slot]) fn(frame, motion); },
    touched(region, now) { for (const fn of touchedFns) fn(region, now); },
    blend(motion, frame) {
      let best = NO_BLEND;
      for (const fn of blends) { const result = fn(motion, frame); if (result && result.weight > best.weight) best = result; }
      return best;
    },
    tagged: (tag, now) => enabled.some(({ instance }) => !!instance.tags && instance.tags(now).includes(tag)),
  };
}

/** 타임라인의 시점 하나: 시작 뒤 at(ms)에 do 실행 */
export type TimelineStep = { at: number; do: () => void };
/** 실행 중인 타임라인 */
export interface TimelineRun {
  /** 아직 실행되지 않은 시점을 모두 취소 */
  cancel(): void;
}
/**
 * 타임라인 만들기: 시점 이벤트를 주어진 순서대로 타이머에 예약 (실행 순서·시각은 setTimeout을 차례로 건 것과 같음)
 * @param timeout 예약 함수 (캐릭터 수명이 끝나면 취소되는 life.timeout)
 * @param clear 예약 취소 함수
 */
export function createTimeline(timeout: (fn: () => void, ms: number) => unknown, clear: (id: unknown) => void) {
  return (steps: readonly TimelineStep[]): TimelineRun => {
    const ids = steps.map((step) => timeout(step.do, step.at));
    return { cancel() { for (const id of ids) clear(id); } };
  };
}
