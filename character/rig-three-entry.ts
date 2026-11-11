// 3D 렌더러 묶음의 진입점 (assets/vendor/rig-three.js). 3D 모델을 켰을 때만 script 태그로 불러오고, 캐릭터 코드는 window.DscRigThree로 씀
import { createThreeRig } from "./rig-three.ts";
import "./globals.d.ts";

window.DscRigThree = { createThreeRig };
