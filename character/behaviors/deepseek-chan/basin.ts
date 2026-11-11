// DeepSeek짱 행동: 세숫대야. 머리를 천천히 쓸어내리면 살며시 씌우고 10초 뒤 벗음 (쓰고 있으면 냄비를 막아 냄)
import { EVENTS } from "../../behavior.ts";
import { PARAMS } from "../../model-profile.ts";
import type { CharacterBehavior } from "../context.ts";

/** 세숫대야를 쓰고 있다는 상태 표시 (냄비가 읽음) */
export const HEAD_COVERED = "head.covered";

export const basin: CharacterBehavior = {
  id: "deepseek-chan.basin",
  create(ctx) {
    let until = 0, weight = 0;
    return {
      on: {
        [EVENTS.headStrokeSlow]: ({ now }) => {
          ctx.markTouched(); ctx.resetTapCounters();
          until = now + 10000;
          ctx.speak("basin_on", 3800);
        },
      },
      frame: {
        params: ({ now, dt }) => {
          weight += ((now < until ? 1 : 0) - weight) * Math.min(1, dt * 4);   // 천천히 씌우고 천천히 벗음
          if (weight > 0.005) ctx.addParam(PARAMS.basinProp, weight);
        },
      },
      tags: (now) => (now < until ? [HEAD_COVERED] : []),
    };
  },
};
