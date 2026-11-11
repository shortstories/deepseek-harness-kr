// 캐릭터 코드가 읽는 브라우저 전역 (타입 검사 전용). PIXI·Live2D는 assets/vendor 스크립트가 실행 중에 넣는다.
import type { PetBridge } from "./types.ts";

declare global {
  /** PixiJS 전역 (assets/vendor 스크립트가 넣음) */
  // eslint-disable-next-line no-var
  var PIXI: any;
  interface Window {
    /** PixiJS 전역 (assets/vendor 스크립트가 넣음) */
    PIXI?: any;
    /** Live2D Cubism Core 전역 (assets/vendor 스크립트가 넣음) */
    Live2DCubismCore?: unknown;
    /** 디버그·말풍선 음성(dsh-tts)이 쓰는 캐릭터 핸들 */
    __dsc?: any;
    /** 펫 창(pet/index.html)이 켜는 표시 */
    __dscPetMode?: boolean;
    /** 펫 창 preload가 넣어 주는 메인 프로세스와의 통로 */
    dscPet?: PetBridge;
    /** 지금 열린 세션 id (플러그인 화면이 넣어 둠). 세션 모델을 빌려 쓸 때 쓴다 */
    __dscSessionId?: string;
    /** 옛 WebKit의 AudioContext */
    webkitAudioContext?: typeof AudioContext;
    /** 3D 렌더러 묶음(assets/vendor/rig-three.js)이 넣는 생성 함수 */
    DscRigThree?: { createThreeRig: typeof import("./rig-three.ts").createThreeRig };
  }
  /** Chromium 확장: 여러 모니터에서 화면 왼쪽 위 */
  interface Screen { availLeft?: number; availTop?: number }
}
export {};
