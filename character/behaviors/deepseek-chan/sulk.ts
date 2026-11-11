// DeepSeek짱 행동: 삐짐. 머리를 8초 안에 세 번 만지면 15초 동안 턱을 들고 고개를 홱 돌린 채 터치를 안 받는다.
// 그동안 사용자를 세 번 몰래 보다가 빠르게 다시 외면하고, 풀리면 정면을 똑바로 보며 한마디 한다.
import { EVENTS, TAGS } from "../../behavior.ts";
import { sstep } from "../../motion.ts";
import { PARAMS } from "../../model-profile.ts";
import type { CharacterBehavior } from "../context.ts";

/** 삐진 동안이라는 상태 표시 (확인용 __dsc.sulking) */
export const SULKING = "sulking";
const SULK_MS = 15000;                                       // 삐져 있는 시간 (터치 안 받음)
const STARE_MS = 4300;                                       // 풀리며 한마디 할 때 정면을 보는 시간
const SULK_CHIN = 10;                                        // 턱을 드는 정도 (AngleY, 위가 +)
const PEEK_RISE = 550, PEEK_HOLD = 450, PEEK_SNAP = 150;     // 몰래 보기: 천천히 돌아봄 → 잠깐 봄 → 홱 외면 (ms)
// 볼 부풀리기·입 삐죽·찡그린 눈썹 [파라미터, 몰래 볼 때 풀리는 정도]
const POUT: [string, number][] = [[PARAMS.cheekPuff, 0.5], [PARAMS.mouthPucker, 0.3], [PARAMS.frown, 0.5], [PARAMS.frownSecondary, 0.5]];

export const sulk: CharacterBehavior = {
  id: "deepseek-chan.sulk",
  create(ctx) {
    let start = -1e9, until = 0, stareUntil = 0, dir = 1, yaw = 0, roll = 0;
    let peeks: { at: number; flip: boolean; done: boolean }[] = [];
    let weight = 0, peek = 0;   // 이번 프레임 값 (blend가 정하고 face가 읽음)
    return {
      on: {
        [EVENTS.headRepeat]: ({ now }) => {
          ctx.resetTapCounters();
          ctx.clearExp(["dark", "smug"]);   // 정색 표정을 지우고 삐진 얼굴로
          ctx.cancelGesture();
          start = now; until = now + SULK_MS; ctx.lockInput(SULK_MS);
          dir = Math.random() < 0.5 ? 1 : -1; yaw = roll = 0;
          // 15초 동안 몰래 보기 3번 (약 3초·7초·11초, 조금씩 어긋나게)
          peeks = [0, 1, 2].map((i) => ({ at: 2800 + i * 4000 + (Math.random() - 0.5) * 1000, flip: Math.random() < 0.6, done: false }));
          ctx.speak("head_sulk", 4000);
          ctx.flashExp("blush", SULK_MS);
          ctx.timeline([{ at: SULK_MS, do: () => { stareUntil = ctx.now() + STARE_MS; ctx.speak("head_after", 4000); } }]);   // 풀리며 한마디 할 땐 정면을 똑바로 봄
        },
      },
      /** 0.35초에 턱을 들고 고개를 홱 돌리고, 끝나기 1.2초 전부터 천천히 돌아옴 */
      blend(motion, { now, dt }) {
        weight = now < until ? Math.min(sstep((now - start) / 350), sstep((until - now) / 1200)) : 0;
        peek = 0;   // 몰래 보기 정도 (0 = 외면, 1 = 사용자 쪽을 봄)
        if (weight <= 0) return null;
        const elapsed = now - start;
        for (const event of peeks) {
          const since = elapsed - event.at;
          if (since < 0 || since > PEEK_RISE + PEEK_HOLD + PEEK_SNAP) continue;
          if (since >= PEEK_RISE + PEEK_HOLD && !event.done) { event.done = true; if (event.flip) dir = -dir; }   // 다시 외면할 때 60% 확률로 반대쪽으로
          peek = since < PEEK_RISE ? sstep(since / PEEK_RISE) : since < PEEK_RISE + PEEK_HOLD ? 1 : 1 - sstep((since - PEEK_RISE - PEEK_HOLD) / PEEK_SNAP);
        }
        const away = 1 - 0.75 * peek, turnRate = Math.min(1, dt * 14);   // 고개는 빠르게 따라가서 방향을 바꿀 때 홱 돌아감
        yaw += (-24 * dir * away - yaw) * turnRate;
        roll += (-8 * dir * away - roll) * turnRate;
        motion.yaw = motion.yaw * (1 - weight) + yaw * weight; motion.roll = motion.roll * (1 - weight) + roll * weight;
        motion.pitch = motion.pitch * (1 - weight) + SULK_CHIN * (1 - 0.6 * peek) * weight;
        motion.bodyX = motion.bodyX * (1 - weight) + yaw / 6 * weight; motion.smile *= 1 - weight; motion.eyeSmileAdd *= 1 - weight;
        const eye = dir * (-0.45 + 0.85 * Math.min(1, peek * 1.8));   // 외면할 땐 눈도 피하고, 몰래 볼 땐 눈이 먼저 사용자 쪽으로
        return { weight, eye, peek };
      },
      frame: {
        /** 볼 부풀리기·입 삐죽·찡그린 눈썹 (몰래 볼 땐 조금 풀림) */
        face: () => { if (weight > 0.01) for (const [id, eased] of POUT) ctx.addParam(id, weight * (1 - eased * peek)); },
      },
      tags: (now) => [...(now < until ? [TAGS.busy, SULKING] : []), ...(now < stareUntil ? [TAGS.stare] : [])],   // 풀린 직후 다시 삐지면 둘 다
    };
  },
};
