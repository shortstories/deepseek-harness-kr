// DeepSeek짱 행동: 소품·옷·체형을 켠 순간 한마디. 어떤 콘셉트를 말할지는 소품 정의(shared/settings.js line)가 정하고, 대사는 assets/dsc-lines.json에 있다.
import { EVENTS } from "../../behavior.ts";
import type { CharacterBehavior } from "../context.ts";

export const outfitLines: CharacterBehavior = {
  id: "deepseek-chan.outfit-lines",
  create(ctx) {
    return { on: { [EVENTS.outfitChange]: ({ concept }) => { if (concept) ctx.speak(concept, 4000); } } };
  },
};
