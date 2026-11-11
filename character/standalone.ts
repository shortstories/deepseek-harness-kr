// assets/dsc.js 진입점: <script src=".../dsc.js">로 바로 실행되는 곳(바깥 펫 창 pet/index.html)에서 쓴다.
// 자산 폴더는 이 스크립트 주소 기준이고, 수명은 창이 닫힐 때까지라 정리하지 않는다.
// 펫 창은 pet/index.html이 __dscPetMode를, preload가 window.dscPet(메인 프로세스와의 통로)을 넣어 준다.
// 설정값(소품·옷·이동 키·3D 조절값)은 창 안 캐릭터가 펫 연결로 보내 준다. 3D 모델 여부는 시작할 때 메인 프로세스에서 받는다(dscPet.config).
import { createCharacter } from './index.ts'
import { createLifetime } from './lifetime.ts'

const base = new URL('./', (document.currentScript as HTMLScriptElement).src).href   // currentScript는 처음 실행 중에만 있음
const pet = window.__dscPetMode ? window.dscPet ?? null : null
Promise.resolve(pet?.config?.()).catch(() => null).then((boot) => {
  createCharacter({ base, life: createLifetime(), pet, prefs: boot?.avatar ? { avatar: boot.avatar } : {} })
})
