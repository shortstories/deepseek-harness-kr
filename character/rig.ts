// 캐릭터 동작(index.ts)과 모델 렌더러 사이의 경계. 동작 코드는 모델 형식(Live2D·3D)을 모르고 이 통로만 쓴다.
// 채널 이름은 model-profile.ts의 PARAMS 값(Live2D 파라미터 ID)과 소품 정의(shared/settings.js)의 ID를 그대로 쓰고,
// 다른 형식의 rig는 그 이름을 의미 이름으로 되찾아 뼈·모프에 대응시킴 (없는 채널은 조용히 무시).
import type { GazeProfile } from "./gaze.ts";

/** 캔버스(배율 1) 기준 크기 값. 배치·말풍선·펫 창 계산이 읽음 */
export type RigMetrics = {
  /** 캔버스 가로·세로 (px) */
  W: number; H: number;
  /** 보이는 몸의 가로 (px, 창 안은 상반신, 펫 창은 전신) */
  visW: number;
  /** 말풍선 꼬리 기준이 되는 얼굴(코) 가운데 x (px) */
  noseX: number;
  /** 꼬마 모습일 때 머리 꼭대기가 내려가는 거리 (px) */
  chibiHeadDrop: number;
  /** 산책 경계 계산에 쓰는 몸 폭 (px, 꼬마 모습 기준) */
  walkBodyWidth: number;
  /** 펫 창(전신)·창 안(상반신) 캔버스의 허리 높이 (px)와 펫 창 하반신 페이드 시작 높이(%) */
  waistPet: number; waistWin: number; waistPct: number;
  /** 창 안 대비 펫 창 머리 크기 비율, 펫 창 배율 보정값 */
  petHeadRatio: number; headGain: number;
  /** 펫 창 배율 하한·상한, 펫 창 말풍선 자리 높이 (px) */
  petKMin: number; petKMax: number; petBubble: number;
  /** 펫 창 붙을 자리 계산용: 상반신 가운데와 전신 가운데의 차이 (펫 캔버스 배율 1 기준 px) */
  petBustOffset: number;
};

/** 터치 지점의 모양 정보. 최종 부위(head·chest 등)는 동작 쪽 regionByShape가 정함 */
export type TouchShape = {
  /** 누른 곳이 속한 부위 그림 이름 (head·arm·leg·lower·waist·chestpart·tail, 모르면 null) */
  part: string | null;
  /** 전신 영역 안 세로 위치 (0 = 위, 1 = 아래) */
  ratioY: number;
  /** 가슴 타원 안이면 true */
  inChest: boolean;
};

/** rig마다 있거나 없는 기능 */
export type RigFeature =
  | "bodyType"       // 꼬마 체형
  | "earHide";       // 동물귀 숨기기

/** 렌더러 통로. 동작 코드는 매 프레임 onFrame 콜백 안에서 채널·표정을 쓰고, tick이 갱신·그리기를 함 */
export interface AvatarRig {
  readonly metrics: RigMetrics;
  /** 이 모델이 쓰는 캐릭터 고유 행동 ID 목록 (character/behaviors). 비면 모든 입력이 기본 반응 */
  readonly behaviors: readonly string[];
  /** 시선 반응성 (기본값에 모델 설정을 합치고 반응성 배율을 적용한 값, character/gaze.ts) */
  readonly gaze: GazeProfile;
  /** 성적 표현이 든 행동을 켜도 되는 모델인지 (VRM 메타가 금지하면 false) */
  readonly adultAllowed: boolean;
  /** 기능 지원 여부 */
  supports(feature: RigFeature): boolean;
  /** 채널 값 덮어쓰기 (weight는 지금 값과 섞는 비율) */
  set(id: string, value: number, weight?: number): void;
  /** 채널 값에 더하기 */
  add(id: string, value: number, weight?: number): void;
  /** 채널 값에 곱하기 */
  multiply(id: string, value: number, weight?: number): void;
  /** 표정 이름 목록 (동작 쪽이 세기를 계산하는 순서) */
  expressionNames(): string[];
  /** 표정을 세기만큼 적용 (이번 프레임) */
  expression(name: string, weight: number): void;
  /** 동물귀 숨김 정도를 목표 쪽으로 한 프레임만큼 옮겨 적용 */
  earHide(on: boolean, dt: number): void;
  /** 꼬마 체형 정도(0~1)에 맞춰 모델 위치 보정 */
  bodyShape(weight: number): void;
  /** 매 프레임 애니메이션 콜백 등록 (모델 갱신 직전, 채널이 기본값으로 돌아간 뒤 불림) */
  onFrame(fn: () => void): void;
  /** 그 자리(캔버스 배율 1 좌표)에서 가장 앞의 터치 가능한 그림 번호, 없으면 -1 */
  pick(x: number, y: number): number;
  /** 터치 지점 모양 정보 */
  touchShape(x: number, y: number, handle: number): TouchShape;
  /** 꼬마 모습의 터치 부위 (머리·몸만) */
  chibiRegion(y: number): string;
  /** 배율에 맞춘 렌더 해상도 (실제로 바뀔 때만) */
  setResolution(k: number): void;
  /** 멈춰 있던 시간만큼 튀지 않게 시계 맞추기 (그리기를 다시 켤 때) */
  resetClock(): void;
  /** 이번 프레임 모델 갱신과 그리기 */
  tick(time: number): void;
  /** 화면을 계속 깨우는 시스템 티커 구독 켜고 끄기 (쉬는 동안 끔) */
  systemTicker(on: boolean): void;
  /** 몸짓(동작 코드의 play) 알림. 몸 애니메이션 클립이 있는 rig만 구현 (Live2D는 채널로 몸짓을 그림) */
  gesture?(name: string, ms: number): void;
}
