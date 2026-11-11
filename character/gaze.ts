// 시선 반응성 프로필: 커서·볼 곳을 눈과 고개가 얼마나 빨리, 얼마나 크게 따라가는지.
// 기본값은 이 Live2D 모델에 맞춘 값이고, 3D 모델은 avatar.json의 gaze로 일부만 덮어쓴다 (설정 UI는 아직 없음).
// 각도·범위는 동작 코드(character/index.ts)가, bone은 3D rig(character/rig-three.ts)가 읽는다.

/** [가로, 세로] */
type Pair = [number, number];
export interface GazeProfile {
  /** 커서가 캔버스 가운데(세로는 머리 높이)에서 이만큼(px) 떨어지면 최대로 봄 */
  rangePx: Pair;
  /** 고개가 시선 목표를 따라가는 비율 (나머지는 눈이 맡음) */
  headShare: Pair;
  /** 고개 최대 회전 채널 값 (Live2D 파라미터 단위, ±30이 상한) */
  headDeg: Pair;
  /** 고개 스프링 [강성, 감쇠] */
  headSpring: Pair;
  /** 눈동자 최대 값 (머리 기준 상대값, 크면 흰자가 드러나 곁눈질처럼 보임) */
  eyeLimit: Pair;
  /** 눈 스프링 [강성, 감쇠] */
  eyeSpring: Pair;
  /** 시작 화면(가운데에 크게)에서의 눈 스프링 [강성, 감쇠] */
  eyeSpringCalm: Pair;
  /** 3D 뼈 변환: gain = 고개 채널 → 각도 배율 [yaw, pitch, roll], follow = 따라가는 빠르기(초당, 0이면 바로), neckShare = 목이 맡는 비율, eyeDeg = 눈 최대 각도(도) */
  bone: { gain: [number, number, number]; follow: number; neckShare: number; eyeDeg: Pair };
  /** 반응성 배율 (1 = 기본). 크면 커서 범위가 좁아지고(덜 움직여도 최대) 스프링·따라가기가 빨라진다 */
  responsiveness: number;
}
/** avatar.json gaze: 바꾸고 싶은 값만 (bone도 일부만) */
export type GazeOverrides = Partial<Omit<GazeProfile, "bone">> & { bone?: Partial<GazeProfile["bone"]> };

export const DEFAULT_GAZE: GazeProfile = {
  rangePx: [600, 500],
  headShare: [0.85, 0.8],
  headDeg: [22, 13],
  headSpring: [38, 9.5],
  eyeLimit: [0.45, 0.3],
  eyeSpring: [900, 55],
  eyeSpringCalm: [420, 42],
  bone: { gain: [0.6, 0.5, 0.5], follow: 7, neckShare: 0.4, eyeDeg: [18, 14] },
  responsiveness: 1,
};

/** 0 이상 유한한 수면 그 값, 아니면 기본값 */
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback);
/** 길이가 같은 수 배열이면 칸마다 확인, 아니면 기본값 */
const list = <T extends number[]>(value: unknown, fallback: T): T =>
  (Array.isArray(value) && value.length === fallback.length ? fallback.map((item, i) => num(value[i], item)) : fallback) as T;

/**
 * 기본값에 덮어쓰기를 합치고 반응성 배율을 적용한 실제 값
 * 반응성 r: 커서 범위 ÷ r, 스프링 강성 × r²·감쇠 × r (출렁임 비율은 그대로 두고 빠르기만 r배), 3D 따라가기 × r
 * 잘못된 값(음수·숫자 아님·길이 다름)은 그 칸만 기본값
 */
export function resolveGaze(overrides: GazeOverrides | null | undefined = {}): GazeProfile {
  const o = overrides || {}, bone = o.bone || {}, d = DEFAULT_GAZE;
  const r = num(o.responsiveness, d.responsiveness) || d.responsiveness;
  /** 스프링 [강성, 감쇠]에 반응성 적용 */
  const fast = ([k, c]: Pair): Pair => (r === 1 ? [k, c] : [k * r * r, c * r]);
  const range = list(o.rangePx, d.rangePx);
  return {
    rangePx: r === 1 ? range : [range[0] / r, range[1] / r],
    headShare: list(o.headShare, d.headShare),
    headDeg: list(o.headDeg, d.headDeg),
    headSpring: fast(list(o.headSpring, d.headSpring)),
    eyeLimit: list(o.eyeLimit, d.eyeLimit),
    eyeSpring: fast(list(o.eyeSpring, d.eyeSpring)),
    eyeSpringCalm: fast(list(o.eyeSpringCalm, d.eyeSpringCalm)),
    bone: {
      gain: list(bone.gain, d.bone.gain),
      follow: num(bone.follow, d.bone.follow) * r,
      neckShare: Math.min(1, num(bone.neckShare, d.bone.neckShare)),
      eyeDeg: list(bone.eyeDeg, d.bone.eyeDeg),
    },
    responsiveness: r,
  };
}
