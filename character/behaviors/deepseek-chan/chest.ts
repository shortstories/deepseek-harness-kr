// DeepSeek짱 행동: 가슴. 탭할수록 부끄러워하다(숙임·"헤~" 입·왼손으로 가리기) 다섯 번째엔 떨며 진정할 때까지 터치를 안 받는다.
// 가슴을 누른 채 위로 끌면 끌어올린 만큼 가슴이 따라오고, 3초 넘게 흔들면 대사가 바뀌며, 놓으면 출렁이며 부끄러워한다.
// 가리는 팔 궤적은 character/motion.ts coverForearm, 끌기 입력은 모델이 물리 뒤 가슴 파라미터에 더한다(ctx.chestDrag).
import { EVENTS, TAGS, type BehaviorEvent } from "../../behavior.ts";
import { clamp, seg, spring, sstep, coverForearm } from "../../motion.ts";
import { PARAMS } from "../../model-profile.ts";
import type { CharacterBehavior } from "../context.ts";

export const chest: CharacterBehavior = {
  id: "deepseek-chan.chest",
  adult: true,
  create(ctx) {
    const shy = { count: 0, last: -1e9, cooldownUntil: 0 };
    let touchLeanUntil = 0, touchLean = 0, shyUntil = 0;
    // 왼손으로 가슴 가리기 (데스크톱 펫의 "가슴에 손" 값): Param59 위팔 원근, Param60 아래팔, Param61 손목, Param62 위팔, Movement2 = 몸 앞용 팔 그림
    const cover = { until: 0, start: -1e9, q: 0 };   // q: 0 = 팔 내림, 1 = 가슴을 가림
    let pulling = false, target = 0, shiftTarget = 0, longTimer = 0;
    const shake = { x: 0, y: 0, acc: 0, last: 0, next: 0 };   // acc = 흔든 양, last = 마지막으로 흔든 시각
    const { lift, shift } = ctx.chestDrag;
    /**
     * 왼손으로 가슴 가리기 시작·연장
     * @param ms 지금부터 가리고 있을 시간
     */
    const coverChest = (ms: number) => { const now = ctx.now(); if (now >= cover.until) cover.start = now; cover.until = Math.max(cover.until, now + ms); };
    /**
     * 가슴 터치 반응. 8초 안에 이어 누른 횟수로 단계가 오르고, 다섯 번째엔 진정할 때까지 6초 터치 잠금
     * 180ms 안의 연타와 쿨다운 중 터치는 무시
     */
    const onTap = ({ now }: BehaviorEvent) => {
      if (now < shy.cooldownUntil || now - shy.last < 180) return;
      if (now - shy.last > 8000) shy.count = 0;
      shy.last = now; shy.count++;
      if (shy.count <= 4) {
        if (now < touchLeanUntil || Math.random() < 0.16) touchLeanUntil = now + 3000;   // 가끔 앞으로 숙임, 숙인 동안 누르면 3초 연장
        ctx.speak(shy.count <= 1 ? "chest1" : "chest2", 4000);
        if (shy.count >= 2) shyUntil = now + 4000;   // 2번째부터: 입꼬리 올리고 살짝 벌린 "헤~"
        if (shy.count >= 3) coverChest(2600);   // 3~4번째: 왼손으로 가슴을 가림
      } else {
        touchLeanUntil = 0; shy.count = 0;
        shy.cooldownUntil = now + 6000; ctx.lockInput(6000);   // 진정할 때까지 터치 안 받음
        ctx.shiver();
        ctx.speak("chest3", 3000);
        shyUntil = now + 6000;
        coverChest(6000);   // 마지막: 진정할 때까지 가린 채로
        ctx.timeline([{ at: 3000, do: () => ctx.speak("chest_calm", 2800) }]);
      }
    };
    /**
     * 가슴을 잡은 동안의 흔들기 대사 감시 시작
     * 3초 넘게 잡은 채로 '흔들어야' 더 자극적인 대사가 나옴 (잡고만 있으면 안 나옴), 4초를 넘겨 계속 흔들면 어지러워하는 대사로 바뀜
     */
    const armLong = () => {
      clearInterval(longTimer);
      const startedAt = ctx.now();
      shake.acc = 0; shake.last = 0; shake.next = startedAt + 3000;
      longTimer = ctx.life.interval(() => {
        if (!pulling) { clearInterval(longTimer); longTimer = 0; return; }
        const now = ctx.now();
        if (now < shake.next) return;                                   // 최소 3초는 잡고 있어야
        if (now - shake.last > 500 || shake.acc < 30) return;           // 그 사이 흔들지 않았으면 대사 없음
        // 4초를 넘기면 멀미(어지럼) 대사, 그 전에는 자극적인 대사
        ctx.speak(now - startedAt >= 4000 ? "chest_pull_dizzy" : "chest_pull_long", 4000);
        shake.acc = 0; shake.next = now + 3000;                         // 계속 흔들면 3초마다 한 번씩
      }, 300);
    };
    /** 끌기 그만: 목표를 풀고 흔들기 대사 감시를 끔 */
    const stopPull = () => { pulling = false; target = 0; shiftTarget = 0; clearInterval(longTimer); };
    /** 가슴 끌기 단계별 처리 (선택 지점이 위로 끄는 것을 확인한 뒤 start) */
    const onPull = ({ now, phase, dx = 0, dy = 0 }: BehaviorEvent) => {
      if (phase === "start") {
        pulling = true; shy.count = 0; ctx.resetTapCounters();
        cover.until = 0;   // 다시 잡았으면 가슴을 가리던 팔을 내린다 (떠는 중 재입력 대응)
        ctx.markTouched(); ctx.speak("chest_pull", 3000);
        armLong();   // 3초 넘게 붙잡고 있으면 자극적인 대사로
        ctx.flashExp("squint", 400); ctx.flashExp("blush", 400);
      }
      if (phase === "start" || phase === "move") {
        const curK = ctx.scale(), up = Math.max(0, -dy / curK);
        target = 1 - Math.exp(-up / 85);   // 조금만 끌어올려도 크게 반응
        // 마우스를 좌우로 움직이면 그 방향으로 가슴이 끌려간다 (끌어올린 만큼 좌우로도 크게)
        shiftTarget = clamp(dx / (curK * 110), -1, 1) * (0.45 + 0.55 * Math.min(1, target * 1.4));
        // 흔든 양을 누적 (잡고만 있는 것과 구분 — 이 값이 있어야 3초 뒤 긴 대사가 나온다)
        const moved = Math.hypot(dx - shake.x, dy - shake.y);
        shake.x = dx; shake.y = dy;
        if (moved > 1) { shake.acc += moved; shake.last = now; }
      } else if (phase === "end") {   // 놓기: 끌어올린 만큼 출렁이며 내려가고 부끄러워하는 반응, 2.5초 터치 잠금
        stopPull();
        const dropped = Math.max(0, lift.x);
        lift.v = Math.min(0, lift.v) - dropped * 2.5;   // 놓는 순간 끌어올린 만큼 아래로 탄력이 붙어 크게 출렁인 뒤 잦아듦
        ctx.speak("chest_drop", 3500); ctx.shiver();
        coverChest(3000); ctx.lockInput(2500); ctx.markTouched();
      } else stopPull();   // cancel: 집기로 넘어감
    };
    return {
      on: { [EVENTS.chestTap]: onTap, [EVENTS.chestPull]: onPull },
      touched: (region) => { if (region !== "chest") shy.count = 0; },
      frame: {
        /** 가슴 끌기 스프링: 끄는 동안 민첩하게 따라가고, 놓으면 출렁이며 잦아듦 */
        start: ({ dt }) => {
          spring(lift, pulling ? target : 0, dt, pulling ? 820 : 200, pulling ? 40 : 6);   // 끄는 동안 민첩하게, 놓으면 출렁이며 잦아듦
          spring(shift, pulling ? shiftTarget : 0, dt, pulling ? 700 : 220, pulling ? 42 : 7);   // 좌우로 끌면 그 방향으로 따라가고, 놓으면 제자리로 출렁
          if (!pulling && Math.abs(shift.x) < 0.0001 && Math.abs(shift.v) < 0.001) shift.x = shift.v = 0;
          if (!pulling && Math.abs(lift.x) < 0.0001 && Math.abs(lift.v) < 0.001) lift.x = lift.v = 0;
          if (pulling) {
            ctx.flashExp("squint", 400); ctx.flashExp("blush", 400);
            ctx.markTouched();
          }
        },
        /** 가슴 터치 때 가끔 앞으로 숙임 */
        motion: ({ now, dt }, motion) => {
          touchLean += ((now < touchLeanUntil ? -30 : 0) - touchLean) * Math.min(1, dt * 4);
          motion.lean += touchLean;
        },
        /** 왼손 가슴 가리기 진행(올리는 데 0.38초, 내릴 땐 같은 길을 거꾸로)과 팔 파라미터 쓰기 */
        params: ({ now, dt, seconds }) => {
          const leaning = now < touchLeanUntil || touchLean < -2;   // 앞으로 숙이는 동안엔 손을 움직이지 않음
          const want = now >= cover.start && now < cover.until && ctx.bodyWeight() < 0.5 && !ctx.displaced() && !leaning;   // 꼬마·산책·도망 중에도 안 함
          const coverBefore = cover.q;
          cover.q = clamp(cover.q + (want ? 1 : -1) * dt / 0.38, 0, 1);   // 올리는 데 0.38초
          if (cover.q > 0) {
            const coverAmount = cover.q;
            const forearm = coverForearm(coverAmount);
            const breath = Math.sin(seconds * Math.PI * 2 * 0.4) * 0.02 * sstep(seg(0.8, 1, coverAmount));   // 가린 채로도 미세하게 움직임
            const velocity = (cover.q - coverBefore) / Math.max(dt, 1e-3);   // 움직이는 중에만 손목이 늦게 따라오며 꺾임
            ctx.setParam(PARAMS.armFrontPose, 1);   // 몸 앞용 팔 그림 (손이 다 내려올 때까지 유지)
            ctx.addParam(PARAMS.upperArmLeft, 0.034 * sstep(coverAmount));
            ctx.addParam(PARAMS.upperArmDepthLeft, 0.48 * sstep(seg(0, 0.6, coverAmount)));   // 위팔 원근은 아래팔보다 먼저
            ctx.addParam(PARAMS.forearmLeft, forearm + breath);
            ctx.addParam(PARAMS.wristLeft, clamp(velocity * 0.06, -0.2, 0.2) * Math.sin(Math.PI * coverAmount));
          }
        },
      },
      tags: (now) => [...(now < shyUntil ? [TAGS.shySmile] : []), ...(cover.q > 0.3 ? [TAGS.armCover] : [])],
    };
  },
};
