// 내장 행동 레지스트리. 프로필(model-profile.ts BEHAVIORS·avatar.json behaviors)은 여기 있는 ID만 고를 수 있다.
// 사용자 폴더의 코드는 실행하지 않는다.
import type { CharacterBehavior } from "./context.ts";
import { basin } from "./deepseek-chan/basin.ts";
import { chest } from "./deepseek-chan/chest.ts";
import { lower } from "./deepseek-chan/lower.ts";
import { outfitLines } from "./deepseek-chan/outfit-lines.ts";
import { pot } from "./deepseek-chan/pot.ts";
import { sulk } from "./deepseek-chan/sulk.ts";

export const BUILTIN_BEHAVIORS: readonly CharacterBehavior[] = [pot, basin, sulk, chest, lower, outfitLines];
