// DeepSeek짱 행동: 아랫배(치마). 8초 안에 이어 누를수록 반응이 세지고, 다섯 번째엔 떨며 화면 밖으로 도망쳤다가 14초 쿨다운.
// 화면 밖으로 나갔다 돌아오는 이동은 기본 기능(ctx.flee, 산책·절전과 같은 옆 이동)이 맡고, 이 행동은 도망을 고르고 돌아온 뒤 한마디만 한다.
import { EVENTS, type BehaviorEvent } from "../../behavior.ts";
import type { CharacterBehavior } from "../context.ts";

export const lower: CharacterBehavior = {
  id: "deepseek-chan.lower",
  adult: true,
  create(ctx) {
    const low = { count: 0, last: -1e9, cooldownUntil: 0 };
    /** 아래(치마) 터치 반응. 도망 중·쿨다운 중 터치와 180ms 안의 연타는 무시 */
    const onTap = ({ now }: BehaviorEvent) => {
      if (ctx.displaced() || now < low.cooldownUntil || now - low.last < 180) return;
      if (now - low.last > 8000) low.count = 0;
      low.last = now; low.count++;
      if (low.count <= 2) ctx.speak("lower1", 4000);
      else if (low.count <= 4) ctx.speak("lower2", 4000);
      else {
        low.count = 0;
        low.cooldownUntil = now + 14000;
        ctx.shiver();
        ctx.speak("lower3", 900);
        ctx.timeline([{ at: 900, do: () => ctx.flee(() => ctx.speak("lower_after", 4000)) }]);
      }
    };
    return {
      on: { [EVENTS.lowerTap]: onTap },
      touched: (region) => { if (region !== "lower") low.count = 0; },
    };
  },
};
