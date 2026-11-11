// 이 Live2D 모델(assets/model/) 전용 값 모음. 캐릭터 코드(character/index.ts)는 모델 ID·치수를 직접 쓰지 않고
// 여기 의미 이름(PARAMS.headTurn 등)으로만 접근한다. 값만 두는 파일이라 함수는 없다.
// 소품·체형 파라미터는 설정 화면·호스트·펫 메인 프로세스가 함께 쓰는 정의라 shared/settings.js에 있다.

/** 모델 파일 경로 (자산 폴더 assets/ 기준)와 대기 모션 그룹 */
export const MODEL_FILES = {
  model: "model/model.model3.json",   // 모델 정의 (텍스처·물리·모션 참조)
  moc: "model/model.moc3",            // Core Worker가 같은 모델을 따로 불러올 moc3
  idleMotionGroup: "Idle",            // model3.json의 대기 모션 그룹 이름
} as const;

/** 모델 파라미터: 의미 이름 → 이 모델의 파라미터 ID */
export const PARAMS = {
  // 머리·몸 (VBridger식 리깅: 아래 입력 값을 모델 물리가 늦게 따라가며 몸·머리카락을 움직임)
  headTurn: "AngleX",                 // 고개 좌우 돌림 (물리 입력)
  headTilt: "AngleY",                 // 고개 위아래 끄덕임 (물리 입력)
  headRoll: "AngleZ",                 // 고개 옆으로 갸웃 (물리 입력)
  headTurnDirect: "ParamAngleX",      // 고개 좌우 돌림 직접 값 (물리 출력 자리, 머리카락 물리 입력)
  headTiltDirect: "ParamAngleY",      // 고개 위아래 직접 값
  headRollDirect: "ParamAngleZ",      // 고개 갸웃 직접 값
  bodyShiftX: "PositionX",            // 몸 좌우 이동
  bodyShiftY: "PositionY",            // 몸 위아래 이동
  bodyShiftZ: "PositionZ",            // 몸 앞뒤 이동
  bodyLean: "LeanInput",              // 몸 앞으로 숙임
  breath: "ParamBreath",              // 숨쉬기
  // 눈·눈썹 (귀가 눈썹을 따라 움직임)
  eyeLookX: "ParamEyeBallX",          // 눈동자 좌우
  eyeLookY: "ParamEyeBallY",          // 눈동자 위아래
  eyeOpenLeft: "ParamEyeLOpen",       // 왼눈 뜸
  eyeOpenRight: "ParamEyeROpen",      // 오른눈 뜸
  eyeSmile: "EyeSmile",               // 눈웃음
  browRaiseLeft: "ParamBrowLY",       // 왼눈썹 높이
  browRaiseRight: "ParamBrowRY",      // 오른눈썹 높이
  browInnerRaise: "BrowInnerUp",      // 곤란한 눈썹 (안쪽 끝 올림)
  frown: "Angry",                     // 찡그린 얼굴 (삐짐)
  frownSecondary: "Angry2",           // 찡그린 얼굴 둘째 겹 (삐짐)
  // 입
  mouthOpen: "ParamMouthOpenY",       // 입 벌림
  jawOpen: "JawOpen",                 // 턱 벌림
  mouthClosed: "ParamSilence",        // 다문 입 (말하지 않는 정도)
  mouthForm: "ParamMouthForm",        // 입 모양 (웃음 쪽이 +)
  mouthSmileLeft: "MouthSmile_L",     // 왼쪽 입꼬리 올림
  mouthSmileRight: "MouthSmile_R",    // 오른쪽 입꼬리 올림
  cheekPuff: "CheeckPuff",            // 볼 부풀리기 (삐짐)
  mouthPucker: "Mouthpucker",         // 입 삐죽 (삐짐)
  mouthVowel: { A: "ParamA", I: "ParamI", U: "ParamU", E: "ParamE", O: "ParamO" },   // 모음 입 모양 (말풍선 음성의 모음 키와 같은 이름)
  // 왼팔 가슴 가리기
  armFrontPose: "Movement2",          // 몸 앞용 팔 그림으로 바꿈
  upperArmLeft: "Param62",            // 왼 위팔 들기
  upperArmDepthLeft: "Param59",       // 왼 위팔 원근 (아래팔보다 먼저)
  forearmLeft: "Param60",             // 왼 아래팔 들기
  wristLeft: "Param61",               // 왼 손목 꺾임
  // 가슴 물리 (끌어올리기·끌어당기기, 물리 계산 뒤에 더함)
  chestSwayVertical: ["ChestY1", "ChestY2", "ChestY3", "ChestY4"],   // 가슴 위아래 흔들림
  chestSwayHorizontal: ["ChestX1", "ChestX2", "ChestX3"],            // 가슴 좌우 흔들림
  // 소품·체형 (나머지 소품 파라미터는 shared/settings.js의 OUTFIT_ITEMS)
  basinProp: "key10",                 // 세숫대야 소품 (머리를 천천히 쓸어내리면)
  bodyType: "Clothes2",               // 체형 (0 기본, 0.4 체형 1, 1 꼬마. 값은 shared/settings.js의 BODY_TYPES)
} as const;

/** 가슴 끌기 방향 부호 (모델의 가슴 파라미터 +방향이 위·오른쪽이면 1, 반대면 -1) */
export const CHEST_DRAG_SIGN = 1;

/** 모음 입 모양 세기 배율. 이 모델은 "이"·"에" 입 모양이 볼과 아래 눈꺼풀까지 올려 눈이 가늘어져 약하게 씀 (없는 모음은 1) */
export const VOWEL_EYE_SAFE: Record<string, number> = { I: 0.45, E: 0.45 };

/** 모델 파츠 ID */
export const PARTS: { animalEars: string; chestCenter: readonly string[] } = {
  animalEars: "Part159",              // 동물귀 (파라미터가 아니라 파트 불투명도로 감춤)
  chestCenter: ["Part88", "Part86"],  // 가슴 메시 (보이는 가슴의 가운데를 터치 판정 기준으로 씀)
};

/** 터치 부위 표: 파트 ID → 부위 이름 (drawable은 가장 가까운 조상 파트의 부위를 따름) */
export const PART_REGIONS: Record<string, string> = {
  Part99: "head", Part47: "head", Part155: "head", Part156: "head", Part161: "head", Part64: "head", Part66: "head", Part10: "head", Part8: "head",
  Part127: "arm", Part94: "arm", Part68: "arm", Part93: "arm", Part117: "arm", Part54: "arm", Part42: "arm",
  Part114: "leg", Part97: "lower", Part107: "lower", Part125: "lower", Part126: "lower",
  Part89: "waist", Part85: "chestpart", Part88: "chestpart", Part136: "tail",
};

/** 표정: 의미 이름(코드·펫 창 메시지가 쓰는 이름) → 표정 파일 경로 (자산 폴더 기준, 이 순서로 섞음) */
export const EXPRESSION_FILES: Record<string, string> = {
  loading: "model/exp/loading.exp3.json",   // 작업 중 표시
  heart: "model/exp/heart.exp3.json",       // 하트 눈
  blush: "model/exp/blush.exp3.json",       // 홍조
  sweat: "model/exp/sweat.exp3.json",       // 식은땀
  dizzy: "model/exp/dizzy.exp3.json",       // 빙글빙글 눈
  tears: "model/exp/tears.exp3.json",       // 눈물
  squint: "model/exp/squint.exp3.json",     // >< 눈
  smug: "model/exp/smug.exp3.json",         // 얄미운 눈
  dark: "model/exp/dark.exp3.json",         // 어두운 얼굴 (정색)
};

/** 눈 그림 자체를 바꾸는 표정 (서로 겹치지 않게 하나만 켜고, 바뀌는 순간 깜빡여 감춤) */
export const EYE_SWAP_EXPRESSIONS: readonly string[] = ["heart", "squint", "smug", "dizzy"];

/** 이 모델이 쓰는 캐릭터 고유 행동 목록 (character/behaviors, 순서 의미 없음) */
export const BEHAVIORS: readonly string[] = ["deepseek-chan.pot", "deepseek-chan.basin", "deepseek-chan.sulk", "deepseek-chan.chest",
  "deepseek-chan.lower", "deepseek-chan.outfit-lines"];

/** 모델 형상 비율 (모두 보이는 그림 영역 대비 비율, 실측) */
export const GEOMETRY = {
  bustCut: 0.47,          // 상반신 잘림선(허리): 전신 높이 중 위에서부터의 비율 (창 안은 이 위만 보임)
  noseOffset: 0.055,      // 코(얼굴) 가운데: 상반신 가로 중심에서 오른쪽으로 상반신 폭 대비 거리 (말풍선 꼬리 기준)
  headBottom: 0.3,        // 터치: 머리로 치는 아래 끝 (전신 높이 비율)
  chestBottom: 0.4,       // 터치: 가슴과 아랫배·허리 아래의 경계 (전신 높이 비율)
  coverArmBottom: 0.45,   // 터치: 가슴을 가린 팔을 가슴으로 치는 아래 끝 (전신 높이 비율)
  chestCenterX: 0.45,     // 터치: 가슴 타원 가운데 x (전신 폭 비율)
  chestCenterY: 0.295,    // 터치: 가슴 타원 가운데 y (전신 높이 비율)
  chestRadiusX: 0.13,     // 터치: 가슴 타원 가로 반지름 (전신 폭 비율)
  chestRadiusY: 0.045,    // 터치: 가슴 타원 세로 반지름 (전신 높이 비율)
  chibiHeadBottom: 0.45,  // 꼬마 모습 터치: 보이는 그림 위에서부터 머리로 치는 비율
} as const;
