// 행동이 쓸 수 있는 캐릭터 기능. 캐릭터 코드(character/index.ts)가 만들어 행동마다 넘긴다.
// 행동은 이 기능만으로 반응하므로, 창 안 → 펫 창 복제(play·say·표정)도 기본 요소를 거쳐 그대로 된다.
import type { Lifetime } from "../lifetime.ts";
import type { BehaviorDef, TimelineRun, TimelineStep } from "../behavior.ts";
import type { Spring } from "../types.ts";

export interface BehaviorContext {
  /** 캐릭터 수명 (연출 DOM 정리용 own) */
  life: Lifetime;
  /** 지금 시각 (performance.now 기준 ms) */
  now(): number;
  /** 지금 캐릭터 배율 (화면 px / 캔버스 px) */
  scale(): number;
  /** 시점 이벤트 묶음 예약 (캐릭터가 내려가면 함께 취소) */
  timeline(steps: readonly TimelineStep[]): TimelineRun;
  /** 몸짓 한 번 */
  play(name: string, ms: number): void;
  /** 진행 중인 몸짓 멈춤 (스프링이 이어받아 대기 자세로 풀림) */
  cancelGesture(): void;
  /** 콘셉트 대사 하나 ([표정] 꼬리표가 있으면 그 표정도) */
  speak(concept: string, ms: number): void;
  /** 표정 잠깐 켜기 */
  flashExp(name: string, ms: number): void;
  /** 잠깐 켠 표정 끄기 (유지 중인 표정은 그대로) */
  clearExp(names: readonly string[]): void;
  /** 몸 떨림 시작 (부끄러움·충격) */
  shiver(): void;
  /** 지금부터 ms 동안 터치 안 받음 */
  lockInput(ms: number): void;
  /** 사용자가 만졌다고 기록 (산책 대기 시간 계산) */
  markTouched(): void;
  /** 부위 탭 연타·머리 연타 횟수 초기화 */
  resetTapCounters(): void;
  /** 켜진 행동 중 하나라도 지금 그 상태 표시를 달고 있는지 */
  tagged(tag: string): boolean;
  /** 모델 파라미터에 더하기 (프레임 기여 안에서만) */
  addParam(id: string, value: number): void;
  /** 모델 파라미터 덮어쓰기 (프레임 기여 안에서만) */
  setParam(id: string, value: number): void;
  /** 지금 체형의 꼬마 정도 (0 = 기본 ~ 1 = 꼬마, 산책·절전 중 꼬마 모습 포함) */
  bodyWeight(): number;
  /** 도망·산책으로 옆으로 비켜나 있는지 */
  displaced(): boolean;
  /** 가슴 끌기 입력 스프링 (lift = 위아래 0~1, shift = 좌우 -1~1). 모델이 물리 뒤 가슴 파라미터에 더함 (Live2D만) */
  chestDrag: { lift: Spring; shift: Spring };
  /** 화면 밖으로 도망쳤다가 돌아옴 (펫 창이면 멀어지며 사라짐). 끌고 있거나 펫 창으로 넘어가는 중이면 안 함. onBack = 돌아오고 0.4초 뒤 */
  flee(onBack: () => void): void;
}
export type CharacterBehavior = BehaviorDef<BehaviorContext>;
