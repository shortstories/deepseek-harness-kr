// 3D 모델(FBX·VRM) 렌더러. three.js FBXLoader(VRM은 rig-vrm.ts)로 모델을 불러와 자체 툰 재질(toon-material.ts)로 그리고, 동작 코드가 쓰는 채널을 뼈·모프로 옮김.
// 모델 파일과 모델별 대응표(avatar.json)는 저장소 밖 사용자 폴더에 있고, 플러그인 호스트가 /deepseek-harness-kr/avatar/로 서빙함.
// 이 파일은 따로 묶여(assets/vendor/rig-three.js) 3D 모델을 켰을 때만 불러옴 (window.DscRigThree).
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { createBakedAoUniforms, createFaceSdfUniforms, createOutlineMaterial, createToonMaterial, disableBakedAo, enableBakedAo, mapOf, type FaceSdfUniforms, type ToonMaterialOptions } from "./toon-material.ts";
import { PARAMS } from "./model-profile.ts";
import { addBindingWeight, addTargetWeight, loadVrm, type VrmRuntime, type WeightSink } from "./rig-vrm.ts";
import { OUTFIT_ITEMS } from "../shared/settings.js";
import { createTaa } from "./taa.ts";
import { aoParamsHash, aoReceivers, aoSettingsOf, aoStrengthOf, applyBakedAo, bakeAo, loadAoCache, saveAoCache, type AoBakeParams, type AoOption } from "./ao-bake.ts";
import { log } from "./log.ts";
import { resolveGaze, type GazeOverrides } from "./gaze.ts";
import type { Lifetime } from "./lifetime.ts";
import type { AvatarRig, RigFeature, RigMetrics, TouchShape } from "./rig.ts";

/** 동작 코드가 움직이는 사람형 뼈 이름 (VRM 사람형 뼈 이름과 같음) */
export type HumanBone = "hips" | "spine" | "chest" | "neck" | "head" | "leftEye" | "rightEye"
  | "leftUpperArm" | "rightUpperArm" | "leftLowerArm" | "rightLowerArm" | "leftHand" | "rightHand"
  | "leftUpperLeg" | "rightUpperLeg" | "leftLowerLeg" | "rightLowerLeg" | "leftFoot" | "rightFoot";
/**
 * 채널 값 → 모프 세기 변환. linear = 값×scale, invert = (1-값)×scale, positive·negative = 양수·음수 쪽만
 * 대상은 morph(모프 이름) 또는 expression(VRM 표정 이름) 중 하나
 */
export type MorphBinding = { morph?: string; expression?: string; map?: "linear" | "invert" | "positive" | "negative"; scale?: number };
/** 모델 폴더의 avatar.json 형식 (모델별 대응표) */
export type AvatarProfile = {
  /** 모델 파일 (폴더 기준 상대 경로, FBX 또는 VRM. VRM은 이 값만 있어도 되고 나머지는 덮어쓰기) */
  model: string;
  /** 숨길 오브젝트 이름 (외곽선용 복제 메시 등) */
  hide?: string[];
  /** 재질 이름 → 툰 재질 설정 (텍스처는 폴더 기준 상대 경로) */
  materials?: Record<string, { map?: string; shade?: string; ao?: string; aoScale?: number;
    /** UTS HighColor(스페큘러 하이라이트): color = 색, power = 날카로움(0~1, UTS _HighColor_Power), mask = 마스크 맵, onShadow = 그림자 쪽 세기, strength = 전체 세기(장면 빛 세기 보정), toon = 경계가 딱 떨어지는 툰 모드(UTS 스페큘러 끔) */
    highColor?: { color: string; power?: number; mask?: string; onShadow?: number; strength?: number; toon?: boolean }; alphaTest?: number; transparent?: boolean; shadingShift?: number; shadingToony?: number; hidden?: boolean; doubleSided?: boolean;
    /**
     * 스텐실 (Unity 재질의 Stencil 설정 옮김): write = 그린 곳에 ref를 씀, test = ref와 비교해 맞는 곳에만 그림
     * 예: 눈썹이 ref 4를 쓰고 앞머리가 notEqual 4로 그리면 눈썹이 앞머리 위로 비침
     */
    stencil?: { ref: number; write?: boolean; test?: "equal" | "notEqual" };
    /** 그리는 순서 (작을수록 먼저, 기본 0). 스텐실을 쓰는 재질이 읽는 재질보다 먼저 그려지게 할 때 */
    order?: number }>;
  /** 사람형 뼈 → 모델 뼈 이름 (VRM은 VRM 사람형 뼈가 기본) */
  bones: Partial<Record<HumanBone, string>>;
  /** 의미 채널(PARAMS 키, 모음은 mouthVowel.A 등) → 모프·VRM 표정 대응 */
  channels?: Record<string, MorphBinding[]>;
  /** 표정 이름 → 대상 세기 (0~1). 대상 이름은 VRM 표정 이름이 먼저, 아니면 모프 이름 */
  expressions?: Record<string, Record<string, number>>;
  /** 소품·옷 키(shared/settings.js) → 모프 (invert면 켰을 때 0, 껐을 때 1 = 숨김 모프) */
  outfit?: Record<string, Array<{ morph: string; invert?: boolean }>>;
  /** 늘 걸어 두는 모프 (기본 옷차림 등) */
  baseMorphs?: Record<string, number>;
  /** 기본 자세: 위팔을 아래로 내리는 정도(도, 0이면 그대로) */
  armDown?: number;
  /** 지원하는 기능 (기본은 없음) */
  features?: RigFeature[];
  /** 쓸 캐릭터 고유 행동 ID (character/behaviors, 기본은 없음 = 모든 입력이 기본 반응) */
  behaviors?: string[];
  /** 시선 반응성 덮어쓰기 (character/gaze.ts GazeProfile 중 바꿀 값만, 예: { "responsiveness": 1.5, "headDeg": [30, 18] }) */
  gaze?: GazeOverrides;
  /** 성적 표현이 든 행동을 켜도 되는지 (기본 true, VRM은 메타의 성적 표현 허용 여부) */
  adultAllowed?: boolean;
  /** 함께 켜면 모양이 겹쳐 깨지는 모프 묶음 (예: 눈웃음 + 눈 감기). 앞쪽 모프가 우선이고, 합이 1을 넘으면 뒤쪽을 줄임 */
  exclusiveMorphs?: string[][];
  /**
   * 외곽선 (툰 재질 외곽선, 뒷면을 부풀려 그림): width = 모델 키 대비 두께, color = 선 색, skip = 외곽선을 빼는 재질 이름
   * normals = smooth(같은 위치 법선 평균, 기본) 또는 model(모델에 든 "<메시>_Outline" 메시의 다듬은 법선과 정점 색 R 두께 배율)
   */
  outline?: { width: number; color?: string; skip?: string[]; normals?: OutlineNormals };
  /**
   * 얼굴 SDF 그림자: 빛이 얼굴 정면에서 돌아간 각도를 문턱값으로 SDF 맵을 잘라 얼굴 그림자 경계를 정함
   * material = 적용할 재질 이름, map = SDF 맵(R·G = 양쪽 빛용 문턱값), swap = R·G가 맡는 쪽을 바꿈, softness = 경계 부드러움
   */
  faceSdf?: { material: string; map: string; swap?: boolean; softness?: number };
  /** 조명: direction = 빛이 오는 방향(모델 기준, +x 화면 오른쪽·+y 위·+z 카메라 쪽), intensity·ambient = 세기 */
  light?: { direction?: [number, number, number]; intensity?: number; ambient?: number };
  /** 림 라이트: color = 색, power = 가장자리에 모이는 정도(클수록 얇음), mix = 조명 영향 */
  rim?: { color: string; power?: number; mix?: number };
  /** 몸 애니메이션 (폴더 기준 FBX): idle = 대기 반복 클립, gestures = 몸짓 이름(동작 코드의 play) → 클립 */
  animations?: { idle?: string; gestures?: Record<string, string> };
  /** 흔들림(스프링) 사슬: roots 아래 모든 뼈. stiffness = 제자리로 돌아오는 힘, drag = 감쇠(0~1), gravity = 아래로 끄는 힘 */
  springs?: Array<{ roots: string[]; stiffness?: number; drag?: number; gravity?: number; radius?: number; colliders?: ColliderGroup[] }>;
  /** 흔들림 충돌체: 사람형 뼈로 자동 생성. scale = 반지름 배율 (기본 1) */
  colliders?: { scale?: number };
  /** 채널별 부드럽게 따라가는 시간(초, 지수 평활 시간 상수). 동작 코드가 값을 순간적으로 바꾸는 채널(눈썹 등)이 튀지 않게 */
  channelSmooth?: Record<string, number>;
  /**
   * 모델 방향 보정 (파일마다 다른 위·정면·좌우 손잡이를 화면 기준으로 맞춤). 기본은 사람형 뼈 위치로 자동 판정
   * auto = false면 자동 판정 끔, mirror = 좌우 반전을 직접 지정, yaw = 세로축으로 더 돌릴 각도(도)
   */
  orientation?: { auto?: boolean; mirror?: boolean; yaw?: number };
  /**
   * 렌더링 (실험): antialias = msaa(기본, MSAA + 1.5배 렌더 배율) 또는 taa(MSAA 끔 + 화면 배율 그대로 + 시간 누적 안티앨리어싱, taa.ts)
   * scale = 렌더 배율에 더 곱할 값 (기본 1)
   */
  render?: { antialias?: "msaa" | "taa"; scale?: number };
  /**
   * 구운 앰비언트 오클루전 (실험, ao-bake.ts): 기본 T자 자세에서 정점 AO를 굽고 호스트 캐시 파일로 남김
   * 재질에 AO 맵(materials.*.ao)이 하나라도 있는 모델은 모델 AO를 쓰고 굽지 않음 (hasModelAo)
   * enabled = 켜기 (설정 화면 avatarAo와 둘 중 하나라도 켜면 켜짐), strength = 세기 0~1 (설정 화면 값이 있으면 그것이 먼저, 기본 0.6)
   * shade = 막힌 만큼 그림자 경계를 미는 정도 (기본 0.3), radius = 막는 면으로 치는 거리(모델 키 대비, 기본 0.08)
   * directions = 굽는 방향 수 (기본 96), resolution = 방향마다 깊이 맵 한 변 텍셀 (기본 1024), debug = AO만 회색으로 그림 (확인용)
   */
  ao?: AoOption;
};

/** 외곽선 법선 출처 */
export type OutlineNormals = "smooth" | "model";
/** 자동 충돌체 묶음 (흔들림 사슬마다 부딪힐 묶음을 고름) */
export type ColliderGroup = "head" | "body" | "arms" | "legs";
const DEG = Math.PI / 180;
/** 값 자르기 */
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

// 동작 코드는 Live2D 파라미터 ID(PARAMS 값)·소품 ID로 쓰므로 의미 이름으로 되찾는 표
const CHANNEL_OF: Record<string, string> = {};
for (const [key, id] of Object.entries(PARAMS)) {
  if (typeof id === "string") CHANNEL_OF[id] = key;
  else if (Array.isArray(id)) for (const each of id) CHANNEL_OF[each] = key;
  else for (const [vowel, vowelId] of Object.entries(id as Record<string, string>)) CHANNEL_OF[vowelId] = `mouthVowel.${vowel}`;
}
const OUTFIT_OF: Record<string, { key: string; on: number }> = {};
for (const item of OUTFIT_ITEMS) if (item.param) OUTFIT_OF[item.param] = { key: item.key, on: item.on || 1 };

/** 모프 이름의 마지막 부분 (FBX는 "Facials.Eye_Close"처럼 묶음 이름이 붙음) */
export const morphKey = (name: string) => name.slice(name.lastIndexOf(".") + 1);
/**
 * 동작 코드가 쓴 채널 ID의 저장 키
 * @param id PARAMS 값(Live2D 파라미터 ID) 또는 소품 정의의 ID
 * @returns 의미 이름(모음은 mouthVowel.A 등, 소품은 outfit.<키>), 모르는 ID는 null
 */
export const channelKeyOf = (id: string) => CHANNEL_OF[id] || (OUTFIT_OF[id] ? "outfit." + OUTFIT_OF[id].key : null);
/**
 * 채널 값 하나를 모프 세기로 변환
 * @param value 이번 프레임 채널 값
 * @returns 모프에 더할 세기 (자르기 전)
 */
export const bindingWeight = (binding: MorphBinding, value: number) => {
  const scale = binding.scale ?? 1;
  switch (binding.map || "linear") {
    case "invert": return (1 - value) * scale;
    case "positive": return Math.max(0, value) * scale;
    case "negative": return Math.max(0, -value) * scale;
    default: return value * scale;
  }
};

/**
 * 외곽선용 매끄러운 법선: 같은 위치(격자 tolerance 안)에 있는 정점들의 법선을 평균 (UTS·lilToon의 아웃라인 법선 변환과 같은 목적)
 * 각진 경계에서 법선이 갈라져 외곽선이 끊기거나 두께가 들쭉날쭉한 것을 막음
 * @param positions 정점 위치 (xyz 반복)
 * @param normals 정점 법선 (xyz 반복)
 * @param tolerance 같은 위치로 볼 거리
 * @returns 정점마다 평균 법선 (길이 1, 합이 0이면 원래 법선)
 */
export function smoothOutlineNormals(positions: ArrayLike<number>, normals: ArrayLike<number>, tolerance = 1e-4) {
  const count = positions.length / 3, keyOf = (i: number) => `${Math.round(positions[i * 3] / tolerance)},${Math.round(positions[i * 3 + 1] / tolerance)},${Math.round(positions[i * 3 + 2] / tolerance)}`;
  const sums = new Map<string, [number, number, number]>();
  for (let i = 0; i < count; i++) {
    const key = keyOf(i), sum = sums.get(key) || [0, 0, 0];
    sum[0] += normals[i * 3]; sum[1] += normals[i * 3 + 1]; sum[2] += normals[i * 3 + 2]; sums.set(key, sum);
  }
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = sums.get(keyOf(i))!, length = Math.hypot(x, y, z);
    if (length > 1e-8) { out[i * 3] = x / length; out[i * 3 + 1] = y / length; out[i * 3 + 2] = z / length; }
    else { out[i * 3] = normals[i * 3]; out[i * 3 + 1] = normals[i * 3 + 1]; out[i * 3 + 2] = normals[i * 3 + 2]; }
  }
  return out;
}

/**
 * 두 지오메트리의 정점 위치가 모두 같은지 (작가 외곽선 메시가 본체와 같은 모양일 때만 쓰기 위함)
 * @param tolerance 같은 위치로 볼 거리
 */
function samePositions(a: THREE.BufferGeometry, b: THREE.BufferGeometry, tolerance: number) {
  const p = a.getAttribute("position"), q = b.getAttribute("position");
  if (!p || !q || p.count !== q.count) return false;
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - q.getX(i)) > tolerance || Math.abs(p.getY(i) - q.getY(i)) > tolerance || Math.abs(p.getZ(i) - q.getZ(i)) > tolerance) return false;
  return true;
}

/**
 * 외곽선 메시용 지오메트리: 위치·스킨·UV·모프 위치는 원본과 공유하고 법선만 매끄러운 외곽선 법선으로 바꿈
 * 모프 법선은 빼서 표정 모프가 외곽선 방향을 흔들지 않게 함
 */
function outlineGeometry(source: THREE.BufferGeometry, tolerance: number) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) if (name !== "normal") geometry.setAttribute(name, attribute);
  const normal = source.getAttribute("normal");
  if (normal) geometry.setAttribute("normal", new THREE.BufferAttribute(smoothOutlineNormals(source.getAttribute("position").array, normal.array, tolerance), 3));
  if (source.index) geometry.setIndex(source.index);
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  if (source.morphAttributes.position) geometry.morphAttributes.position = source.morphAttributes.position;
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  return geometry;
}

/** 외곽선 메시 그리는 순서 (스텐실로 비친 부분을 덮지 않게 모든 재질 뒤) */
const OUTLINE_ORDER = 100;
const STENCIL_FUNCS = { equal: THREE.EqualStencilFunc, notEqual: THREE.NotEqualStencilFunc } as const;
/** 재질에 스텐실 쓰기·검사 설정 */
export function applyStencil(material: THREE.Material, stencil: { ref: number; write?: boolean; test?: "equal" | "notEqual" }) {
  material.stencilWrite = true;   // three.js는 이 값이 켜져야 스텐실 검사도 함
  material.stencilRef = stencil.ref;
  material.stencilFunc = stencil.test ? STENCIL_FUNCS[stencil.test] : THREE.AlwaysStencilFunc;
  material.stencilZPass = stencil.write ? THREE.ReplaceStencilOp : THREE.KeepStencilOp;
}
/** avatar.json 재질 하나의 설정 */
export type MaterialSpec = NonNullable<AvatarProfile["materials"]>[string];
/**
 * avatar.json 재질 설정 → 툰 재질 설정 (MToon으로 그리던 때와 같은 값: 그늘 색 흰색 × 그늘 맵, 경계 -0.05·0.95 기본)
 * @param texture 폴더 기준 텍스처 (linear = 색 공간 변환 없이 읽는 수치 맵)
 * @param rim avatar.json 림 라이트 (없으면 림 없음)
 * @param faceSdf 이 재질이 얼굴 SDF 재질이면 공유 uniform
 */
export function toonOptionsOf(name: string, spec: MaterialSpec, texture: (file?: string, linear?: boolean) => THREE.Texture | undefined,
  rim?: AvatarProfile["rim"], faceSdf?: FaceSdfUniforms): ToonMaterialOptions {
  return {
    name, map: texture(spec.map), shadeColor: 0xffffff, shadeMap: texture(spec.shade),
    // AO(lilToon의 그림자 경계 마스크): 어두운 텍셀일수록 그림자 경계를 밀어 늘 그늘지게 함
    shadingShiftMap: texture(spec.ao, true), shadingShiftMapScale: spec.aoScale ?? 1,
    shadingShift: spec.shadingShift ?? -0.05, shadingToony: spec.shadingToony ?? 0.95,
    transparent: !!spec.transparent, alphaTest: spec.alphaTest ?? 0, side: spec.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    rim: rim && { color: rim.color, fresnelPower: rim.power ?? 4, lightingMix: rim.mix ?? 0.5 },
    faceSdf, highColor: spec.highColor && { ...spec.highColor, mask: texture(spec.highColor.mask, true) },
  };
}
/**
 * 여러 재질 메시에서 순서(order)가 0이 아닌 재질을 같은 지오메트리·뼈·모프 배열을 쓰는 복제 메시로 떼어 renderOrder로 그림
 * (three.js는 한 메시 안 재질 순서를 정할 수 없어서)
 * @param orderOf 재질 이름 → 순서
 */
export function splitByOrder(root: THREE.Object3D, orderOf: (name: string) => number, life: { add(fn: () => void): void }) {
  const skip = new THREE.MeshBasicMaterial({ visible: false });
  life.add(() => skip.dispose());
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((node) => { const mesh = node as THREE.SkinnedMesh; if (mesh.isSkinnedMesh && Array.isArray(mesh.material) && !mesh.name.endsWith("__outline")) meshes.push(mesh); });
  for (const mesh of meshes) {
    const materials = mesh.material as THREE.Material[];
    const orders = [...new Set(materials.map((material) => orderOf(material.name)).filter((order) => order !== 0))];
    for (const order of orders) {
      const part = new THREE.SkinnedMesh(mesh.geometry, materials.map((material) => orderOf(material.name) === order ? material : skip));
      part.bind(mesh.skeleton, mesh.bindMatrix);
      part.morphTargetInfluences = mesh.morphTargetInfluences; part.morphTargetDictionary = mesh.morphTargetDictionary;
      part.frustumCulled = false; part.renderOrder = order; part.name = mesh.name + "__order" + order;
      part.position.copy(mesh.position); part.quaternion.copy(mesh.quaternion); part.scale.copy(mesh.scale);
      mesh.parent!.add(part);
    }
    if (orders.length) mesh.material = materials.map((material) => orderOf(material.name) === 0 ? material : skip);
  }
}

/**
 * 겹치면 깨지는 모프 묶음의 합을 1 이하로: 묶음 앞쪽부터 남은 몫 안에서만 씀
 * @param weights 모프 이름 → 세기 (바로 고침)
 * @param groups 묶음 목록 (앞쪽 모프 우선)
 */
export function limitExclusiveMorphs(weights: Map<string, number>, groups: string[][] = []) {
  for (const group of groups) {
    let left = 1;
    for (const morph of group) {
      const w = clamp(weights.get(morph) || 0, 0, left);
      if (weights.has(morph)) weights.set(morph, w);
      left -= w;
    }
  }
}

/**
 * 충돌체 (캡슐, to가 없으면 구): from·to 뼈의 지역 좌표 offset 지점을 잇는 선분에서 radius 안으로 흔들림 뼈 끝점이 못 들어옴
 */
export type SpringCollider = { from: THREE.Object3D; to?: THREE.Object3D | null; fromOffset?: THREE.Vector3; toOffset?: THREE.Vector3; radius: number };
/**
 * 흔들림 사슬 하나의 설정: roots 아래 모든 뼈. stiffness = 제자리로 돌아오는 힘, drag = 감쇠(0~1), gravity = 아래로 끄는 힘
 * radius = 뼈 끝점의 반지름(모델 단위), colliders = 부딪힐 충돌체
 */
export type SpringSpec = { roots: THREE.Object3D[]; stiffness?: number; drag?: number; gravity?: number; radius?: number; colliders?: SpringCollider[] };
const colliderA = new THREE.Vector3(), colliderB = new THREE.Vector3(), colliderAB = new THREE.Vector3(), colliderP = new THREE.Vector3();
/**
 * 점이 충돌체 안이면 표면 밖으로 밀어낸 위치로 바꿈 (선분에서 가장 가까운 점 기준)
 * @param point 바꿀 점 (월드)
 * @param a·b 충돌체 선분 양 끝 (월드, 구면 a = b)
 * @param distance 떨어져 있어야 할 거리 (충돌체 반지름 + 뼈 반지름)
 * @returns 밀어냈으면 true
 */
export function pushOutOfCapsule(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, distance: number) {
  colliderAB.copy(b).sub(a);
  const len2 = colliderAB.lengthSq(), t = len2 > 1e-12 ? clamp(colliderP.copy(point).sub(a).dot(colliderAB) / len2, 0, 1) : 0;
  const closest = colliderP.copy(a).addScaledVector(colliderAB, t);
  const away = point.clone().sub(closest), d = away.length();
  if (d >= distance) return false;
  if (d < 1e-9) away.set(0, 1, 0); else away.divideScalar(d);
  point.copy(closest).addScaledVector(away, distance);
  return true;
}
/** 점과 선분 사이 거리 */
export const capsuleDistance = (point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
  colliderAB.copy(b).sub(a);
  const len2 = colliderAB.lengthSq(), t = len2 > 1e-12 ? clamp(colliderP.copy(point).sub(a).dot(colliderAB) / len2, 0, 1) : 0;
  return point.distanceTo(colliderP.copy(a).addScaledVector(colliderAB, t));
};
/** 충돌체의 지금 선분 양 끝 (월드) */
const colliderEnds = (collider: SpringCollider, a: THREE.Vector3, b: THREE.Vector3) => {
  a.copy(collider.fromOffset || new THREE.Vector3()).applyMatrix4(collider.from.matrixWorld);
  if (collider.to) b.copy(collider.toOffset || new THREE.Vector3()).applyMatrix4(collider.to.matrixWorld); else b.copy(a);
};
/**
 * 흔들림(스프링) 뼈 준비: 뼈마다 끝점(자식 뼈 위치)이 관성·복원력·중력으로 따라가고, 뼈를 끝점 쪽으로 돌림 (VRM 스프링 본과 같은 방식)
 * 힘은 뼈 길이에 비례해 모델 단위(cm·m)와 무관. 부르기 전에 뼈의 월드 행렬이 지금 자세로 갱신돼 있어야 함
 * 마디마다 월드 행렬을 부모 월드 × 자기 지역 행렬로 바로 계산 (하위 트리·조상 재계산 없음), 마디가 아닌 자식 뼈(끝점)는 마지막에 한 번 갱신
 * @returns step(dt): 사슬 위쪽부터 한 프레임 진행
 */
export function createSprings(specs: SpringSpec[]) {
  type Joint = { node: THREE.Object3D; restLocal: THREE.Quaternion; axis: THREE.Vector3; length: number; prev: THREE.Vector3; tail: THREE.Vector3; stiffness: number; drag: number; gravity: number; colliders: Array<{ collider: SpringCollider; distance: number }> };
  const joints: Joint[] = [];
  const head = new THREE.Vector3(), restDir = new THREE.Vector3(), next = new THREE.Vector3(), inertia = new THREE.Vector3(), turn = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
  const unusedPosition = new THREE.Vector3(), unusedScale = new THREE.Vector3();
  for (const spec of specs) for (const root of spec.roots) {
    root.updateWorldMatrix(true, true);
    root.traverse((node) => {
      // FBXLoader는 여러 메시가 쓰는 뼈를 같은 자리(길이 0)에 복제해 첫 자식으로 붙이므로, 길이 있는 자식 뼈를 다음 마디로 씀
      const child = node.children.find((each) => (each as THREE.Bone).isBone && each.position.lengthSq() >= 1e-12);
      if (!child) return;
      const tail = child.getWorldPosition(new THREE.Vector3()), radius = spec.radius ?? 0;
      // 충돌 거리는 늘 충돌체 반지름 + 뼈 반지름 (기본 자세에서 가까운 뼈도 표면 밖으로 밀어 냄. 처음 거리로 줄이면 자세에 따라 파고듦)
      const colliders = (spec.colliders || []).map((collider) => ({ collider, distance: collider.radius + radius }));
      joints.push({ node, restLocal: node.quaternion.clone(), axis: child.position.clone().normalize(), length: tail.distanceTo(node.getWorldPosition(head)),
        prev: tail.clone(), tail, stiffness: spec.stiffness ?? 1, drag: spec.drag ?? 0.4, gravity: spec.gravity ?? 0, colliders });
    });
  }
  // 마디가 아닌 자식(끝점 뼈 등): 마디를 모두 돌린 뒤 그 아래만 한 번 갱신
  const jointNodes = new Set(joints.map((joint) => joint.node));
  const leaves = joints.flatMap((joint) => joint.node.children.filter((child) => !jointNodes.has(child)));
  return {
    count: joints.length,
    /** 한 프레임 진행 @param dt 초 */
    step(dt: number) {
      for (const joint of joints) {
        const { node } = joint, parentWorld = node.parent!.matrixWorld;
        node.quaternion.copy(joint.restLocal);
        parentWorld.decompose(unusedPosition, parentQ, unusedScale);   // = parent.getWorldQuaternion (부모 월드 행렬은 이미 최신)
        head.copy(node.position).applyMatrix4(parentWorld);             // = node.getWorldPosition (뼈 시작점은 자기 회전과 무관)
        restDir.copy(joint.axis).applyQuaternion(turn.copy(parentQ).multiply(joint.restLocal));   // 기본 자세의 뼈 방향 (월드)
        // 다음 끝점 = 지금 끝점 + 관성(감쇠) + 제자리 방향으로 당기는 힘 + 중력
        inertia.copy(joint.tail).sub(joint.prev).multiplyScalar(1 - joint.drag);
        next.copy(joint.tail).add(inertia).addScaledVector(restDir, joint.stiffness * dt * joint.length * 10);
        next.y -= joint.gravity * dt * joint.length * 10;
        next.sub(head).normalize().multiplyScalar(joint.length).add(head);   // 뼈 길이 유지
        // 밀어낸 뒤 길이를 맞추면 다시 안으로 들어갈 수 있어 몇 번 반복해 수렴시킴
        for (let pass = 0; pass < 4; pass++) {
          let pushed = false;
          for (const { collider, distance } of joint.colliders) { colliderEnds(collider, colliderA, colliderB); pushed = pushOutOfCapsule(next, colliderA, colliderB, distance) || pushed; }
          if (!pushed) break;
          next.sub(head).normalize().multiplyScalar(joint.length).add(head);
        }
        joint.prev.copy(joint.tail); joint.tail.copy(next);
        turn.setFromUnitVectors(restDir, next.clone().sub(head).normalize());
        node.quaternion.copy(parentQ.clone().invert().multiply(turn).multiply(parentQ).multiply(joint.restLocal));
        node.matrix.compose(node.position, node.quaternion, node.scale);   // = node.updateMatrixWorld 의 자기 몫만
        node.matrixWorld.multiplyMatrices(parentWorld, node.matrix);
      }
      for (const leaf of leaves) leaf.updateMatrixWorld(true);
    },
  };
}

/** 가장 가까운 좌표축 방향(±x·±y·±z 중 하나) */
const snapAxis = (vector: THREE.Vector3) => {
  const sizes = [Math.abs(vector.x), Math.abs(vector.y), Math.abs(vector.z)];
  const axis = sizes.indexOf(Math.max(...sizes));
  return new THREE.Vector3().setComponent(axis, Math.sign(vector.getComponent(axis)) || 1);
};
/** 방향 판정에 쓰는 사람형 뼈 위치 (월드) */
export type OrientationPoints = { hips: THREE.Vector3; head: THREE.Vector3; leftUpperArm: THREE.Vector3; rightUpperArm: THREE.Vector3; leftEye?: THREE.Vector3 | null; rightEye?: THREE.Vector3 | null };
/**
 * 사람형 뼈 위치로 모델을 화면 기준(이름상 왼쪽 → +x, 위 → +y, 얼굴 정면 → 카메라 +z)으로 옮기는 변환 판정
 * 파일 좌표계 차이(Z-up, 정면 축, 왼손·오른손)는 늘 90도 단위라 축 정렬 변환으로 반올림 (모델 자체의 기울어진 자세는 그대로 둠)
 * 정면은 두 눈이 머리 뼈보다 앞에 있는 쪽. 이름상 왼쪽·위로 정한 정면과 반대면 좌우가 뒤집힌 파일(mirror)
 * @returns 모델 좌표 → 화면 좌표 행렬(회전, mirror면 행렬식 -1), 판정할 수 없으면 null
 */
export function orientationOf(points: OrientationPoints): { matrix: THREE.Matrix4; mirror: boolean } | null {
  const rise = points.head.clone().sub(points.hips);
  const across = points.leftUpperArm.clone().sub(points.rightUpperArm);
  if (rise.lengthSq() < 1e-12) return null;
  const up = snapAxis(rise);
  across.addScaledVector(up, -across.dot(up));
  if (across.lengthSq() < 1e-12) return null;
  const left = snapAxis(across);
  const front = new THREE.Vector3().crossVectors(left, up);
  let mirror = false;
  if (points.leftEye && points.rightEye) {
    const eyes = points.leftEye.clone().add(points.rightEye).multiplyScalar(0.5).sub(points.head);
    eyes.addScaledVector(up, -eyes.dot(up));
    const ahead = eyes.dot(front);
    if (ahead < 0 && -ahead > Math.abs(eyes.dot(left))) { mirror = true; front.negate(); }
  }
  // 열이 left·up·front 인 행렬의 전치 = 모델 축을 화면 축으로 (직교 행렬이라 역행렬과 같음)
  return { matrix: new THREE.Matrix4().makeBasis(left, up, front).transpose(), mirror };
}
/**
 * 모델 방향 보정을 감싸는 그룹에 걸기: 자동 판정(orientationOf) → avatar.json orientation(mirror·yaw) 덮어쓰기
 * 좌우 반전은 그룹 scale.x = -1 (three.js가 행렬식이 음수면 앞면 판정을 뒤집어 면·외곽선이 그대로 맞음)
 * @param frame 모델을 담은 그룹 @param points 사람형 뼈 위치 (없으면 자동 판정 안 함)
 * @param option avatar.json orientation
 * @returns 적용한 보정 (진단용)
 */
export function applyOrientation(frame: THREE.Object3D, points: OrientationPoints | null, option: AvatarProfile["orientation"] = {}) {
  const auto = option.auto !== false && points ? orientationOf(points) : null;
  const matrix = auto ? auto.matrix.clone() : new THREE.Matrix4();
  let mirror = auto?.mirror ?? false;
  const flipX = new THREE.Matrix4().makeScale(-1, 1, 1);
  if (option.mirror !== undefined && option.mirror !== mirror) { matrix.premultiply(flipX); mirror = option.mirror; }
  if (option.yaw) matrix.premultiply(new THREE.Matrix4().makeRotationY(option.yaw * DEG));
  // 행렬 = 회전 × (반전이면 x 반전): 회전 부분만 quaternion으로
  const rotation = matrix.determinant() < 0 ? matrix.clone().multiply(flipX) : matrix;
  frame.quaternion.setFromRotationMatrix(rotation);
  frame.scale.set(matrix.determinant() < 0 ? -1 : 1, 1, 1);
  frame.updateMatrixWorld(true);
  return { auto: !!auto, mirror, matrix };
}

/** 지역 변환이 없는 노드 (위치 0·회전 없음·배율 1) */
const isIdentityLocal = (node: THREE.Object3D) => node.position.lengthSq() === 0 && node.quaternion.x === 0 && node.quaternion.y === 0 && node.quaternion.z === 0
  && node.quaternion.w === 1 && node.scale.x === 1 && node.scale.y === 1 && node.scale.z === 1;
/** FBXLoader 복제 뼈 여부: 부모 뼈와 이름이 같고 지역 변환이 없음 (월드 행렬이 부모와 같음) */
const isDuplicateBone = (node: THREE.Object3D) => (node as THREE.Bone).isBone && !!node.parent && (node.parent as THREE.Bone).isBone
  && node.parent.name === node.name && isIdentityLocal(node);
/** 뼈 역행렬이 모두 같은지 (같으면 스켈레톤을 하나로 합쳐도 스키닝 결과가 같음) */
const sameInverses = (a: THREE.Skeleton, b: THREE.Skeleton) => a.bones.length === b.bones.length
  && a.bones.every((bone, i) => bone === b.bones[i] && a.boneInverses[i].equals(b.boneInverses[i]));
/**
 * FBXLoader 복제 뼈 정리: 여러 메시가 같은 뼈를 쓰면 메시마다 지역 변환 없는 복제 뼈가 생겨 원래 뼈 밑에 겹겹이 붙음(뼈마다 메시 수만큼)
 * 스켈레톤이 가리키는 복제 뼈를 원래 뼈(같은 이름 중 계층 맨 위)로 바꾸고 복제 뼈를 떼어 냄, 뼈·역행렬이 같은 스켈레톤은 하나로 합침
 * 복제 뼈는 월드 행렬이 원래 뼈와 같아 스키닝 결과는 그대로. 행렬 갱신·뼈 행렬 계산이 메시 수 배에서 한 번으로 줄어듦
 * @returns 떼어 낸 복제 뼈 수와 합친 스켈레톤 수 (진단용)
 */
export function dedupeFbxBones(model: THREE.Object3D) {
  const original = (bone: THREE.Bone) => { let node: THREE.Object3D = bone; while (isDuplicateBone(node)) node = node.parent!; return node as THREE.Bone; };
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((node) => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(node as THREE.SkinnedMesh); });
  for (const mesh of meshes) mesh.skeleton.bones = mesh.skeleton.bones.map(original);
  const duplicates: THREE.Object3D[] = [];
  model.traverse((node) => { if (isDuplicateBone(node) && !isDuplicateBone(node.parent!)) duplicates.push(node); });
  let removed = 0;
  for (const top of duplicates) {
    let pure = true;   // 복제 뼈 아래에 복제 뼈가 아닌 것이 있으면(메시·다른 뼈) 그대로 둠
    top.traverse((node) => { if (node !== top && !isDuplicateBone(node)) pure = false; });
    if (!pure) continue;
    top.traverse(() => { removed++; });
    top.removeFromParent();
  }
  const shared: THREE.Skeleton[] = [];
  let merged = 0;
  for (const mesh of meshes) {
    const same = shared.find((skeleton) => sameInverses(skeleton, mesh.skeleton));
    if (same) { mesh.bind(same, mesh.bindMatrix); merged++; } else shared.push(mesh.skeleton);
  }
  return { removed, merged };
}

/** 눈썹 채널 (설정의 눈썹 세기·부드러움이 걸림). 동작 코드는 Live2D 기준 값을 써서 3D 모프에는 클 수 있음 */
export const BROW_CHANNELS: ReadonlySet<string> = new Set(["browRaiseLeft", "browRaiseRight", "browInnerRaise"]);
/** 사용자 표정 조정 (설정 화면, 매 프레임 읽음): browScale = 눈썹 값 배율, browSmooth = 눈썹이 따라가는 시간(초) */
export type RigTuning = { browScale?: number; browSmooth?: number;
  /** 구운 AO 켜기 (불러올 때만 읽음) */
  ao?: boolean;
  /** 구운 AO 세기 (0~1, 매 프레임 읽음) */
  aoStrength?: number };
/**
 * 지금 값에서 목표로 시간 상수 tau(초)만큼 부드럽게 다가감 (지수 평활, 프레임 간격과 무관)
 * tau가 0 이하면 바로 목표, 간격이 0이면 그대로
 */
export const smoothToward = (current: number, target: number, dt: number, tau: number) =>
  tau <= 0 ? target : dt <= 0 ? current : current + (target - current) * (1 - Math.exp(-dt / tau));
/**
 * 이번 프레임 채널 값: 동작 코드 값 × (눈썹이면 설정 배율) → 채널별 시간 상수로 부드럽게
 * 시간 상수: 눈썹은 설정값이 있으면 그것, 없으면 avatar.json channelSmooth, 둘 다 없으면 0(바로)
 * @param raw 동작 코드가 쓴 채널 값 @param smoothed 채널별 지난 값 (갱신됨, 처음 보는 채널은 지금 값에서 시작)
 */
export function tunedChannels(channels: Iterable<string>, raw: ReadonlyMap<string, number>, smoothed: Map<string, number>, dt: number,
  tuning: RigTuning = {}, channelSmooth: Record<string, number> = {}) {
  const out = new Map<string, number>();
  for (const channel of channels) {
    const brow = BROW_CHANNELS.has(channel);
    const target = (raw.get(channel) || 0) * (brow ? tuning.browScale ?? 1 : 1);
    const tau = (brow ? tuning.browSmooth : undefined) ?? channelSmooth[channel] ?? 0;
    const value = smoothToward(smoothed.get(channel) ?? target, target, dt, tau);
    smoothed.set(channel, value);
    out.set(channel, value);
  }
  return out;
}

/** 지원하는 모델 형식 (avatar.json model 확장자). 지금은 VRM(0.x·1.0)과 FBX만 */
export const SUPPORTED_MODEL_FORMATS = [".vrm", ".fbx"] as const;
/**
 * 모델 파일 형식 확인: 지원하지 않는 확장자면 다른 로더의 엉뚱한 오류 대신 이 오류를 냄
 * @param file avatar.json model 값 @returns "vrm" 또는 "fbx"
 */
export function modelFormat(file: string | undefined) {
  const match = /\.([a-z0-9]+)$/i.exec(String(file ?? "").trim());
  const ext = match ? "." + match[1].toLowerCase() : "";
  if (!(SUPPORTED_MODEL_FORMATS as readonly string[]).includes(ext)) throw new Error(`지원하는 모델 형식은 ${SUPPORTED_MODEL_FORMATS.join("·")}입니다 (avatar.json model: ${file ?? "없음"})`);
  return ext.slice(1) as "vrm" | "fbx";
}

/**
 * 굽는 자세의 모프 세기: avatar.json baseMorphs(늘 거는 기본 옷차림 등) + 소품·옷을 모두 끈 기본 상태(invert 모프 = 1, 예: 안경 숨김)
 * 표정·채널 모프는 0. 실행 중 applyMorphs가 같은 방식으로 더하는 값과 같음
 */
export function restMorphWeights(profile: Pick<AvatarProfile, "baseMorphs" | "outfit">) {
  const weights: Record<string, number> = { ...profile.baseMorphs };
  for (const bindings of Object.values(profile.outfit || {})) for (const binding of bindings) if (binding.invert) weights[binding.morph] = (weights[binding.morph] || 0) + 1;
  return weights;
}
/**
 * 굽기 전 모프: 모두 0에 restMorphWeights만 걸어 표정·켠 소품이 AO에 섞이지 않게 함
 * @param weights 모프 이름(마지막 부분) → 세기
 */
export function restMorphs(meshes: THREE.Mesh[], weights: Record<string, number> = {}) {
  for (const mesh of meshes) {
    if (!mesh.morphTargetInfluences || !mesh.morphTargetDictionary) continue;
    mesh.morphTargetInfluences.fill(0);
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) mesh.morphTargetInfluences[index] = clamp(weights[morphKey(name)] ?? 0, 0, 1);
  }
}

/**
 * 구운 AO 준비: 캐시 파일을 찾고, 없거나 메시가 안 맞으면 굽는 자세(inRestPose: 기본 T자·기본 모프)로 잠깐 바꿔 GPU로 구운 뒤 캐시에 덮어씀 (저장 실패는 디버그 기록만)
 * 걸린 시간은 performance 측정 "dsc-ao-bake"로 남김 (캐시 사용 여부·정점 수 포함)
 * @param cacheUrl 호스트 AO 캐시 주소 (file·params 붙기 전) @param file avatar.json model
 * @param texturesReady avatar.json 텍스처를 다 받으면 끝나는 약속 (알파 테스트 재질이 받기 전 빈 맵으로 구워지지 않게)
 * @param inRestPose 굽는 동안만 굽는 자세로 바꿨다 되돌리는 감싸기 (불러올 때도·실행 중에 켤 때도 같은 자세라 캐시 키가 같음)
 * @returns 같이 쓰는 AO uniform (세기는 매 프레임 갱신)과 AO를 켠 재질
 */
async function prepareBakedAo(renderer: THREE.WebGLRenderer, root: THREE.Object3D, profile: AvatarProfile, cacheUrl: string, file: string,
  settings: { params: AoBakeParams; shade: number; debug: boolean }, strength: number, texturesReady: Promise<unknown>, inRestPose: <T>(fn: () => T) => T) {
  const meshes = aoReceivers(root);
  const morphs = restMorphWeights(profile);
  const hash = aoParamsHash(settings.params, { hide: profile.hide ?? null, morphs, materials: profile.materials ?? null });
  const url = `${cacheUrl}?file=${encodeURIComponent(file)}&params=${hash}`;
  await texturesReady;
  const start = performance.now();
  const cached = await loadAoCache(url, hash, meshes).catch(() => null);
  const data = cached ?? inRestPose(() => { restMorphs(meshes, morphs); root.updateMatrixWorld(true); return bakeAo(renderer, meshes, settings.params, smoothOutlineNormals); });
  if (!cached) saveAoCache(url, hash, meshes, data).then((ok) => { if (!ok) log.debug("AO 캐시 경로가 없어 저장하지 않았습니다", url); }, (error) => log.debug("AO 캐시를 저장하지 못했습니다:", error));
  const vertices = data.reduce((sum, each) => sum + each.length, 0);
  performance.measure("dsc-ao-bake", { start, detail: { cached: !!cached, vertices, meshes: meshes.length } });
  log.debug("AO", cached ? "캐시 사용" : "굽기", `${Math.round(performance.now() - start)}ms`, vertices, "정점");
  const uniforms = createBakedAoUniforms(strength, settings.shade);
  const materials = applyBakedAo(root, meshes, data, uniforms, settings.debug);
  return { uniforms, materials };
}

/** 모델이 AO 맵을 이미 주는지 (avatar.json 재질 중 ao가 있는 것이 하나라도 있으면). 있으면 정점 AO를 굽지 않음 */
export const hasModelAo = (profile: Pick<AvatarProfile, "materials">) => Object.values(profile.materials ?? {}).some((spec) => !!spec?.ao);

/**
 * 지금 자세(노드마다 지역 위치·회전·배율)를 기억해 두고, 함수를 그 자세에서 잠깐 실행한 뒤 실행 직전 자세·모프로 되돌리는 감싸기를 만듦
 * 실행 중에 AO를 켤 때 팔 내림·애니메이션·흔들림이 걸린 자세 대신 불러올 때의 기본 T자 자세로 굽기 위함 (동기 실행이라 그 자세가 화면에 그려지지 않음)
 * three-vrm 흔들림 뼈처럼 matrixAutoUpdate가 꺼진 노드는 updateMatrixWorld가 지역 행렬을 다시 만들지 않아 직접 갱신
 */
export function restPoseRunner(root: THREE.Object3D) {
  const rest: Array<[THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3]> = [];
  root.traverse((node) => { rest.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]); });
  return <T>(fn: () => T): T => {
    const now = rest.map(([node]) => [node.position.clone(), node.quaternion.clone(), node.scale.clone()] as const);
    const morphs: Array<[number[], number[]]> = [];
    root.traverse((node) => { const influences = (node as THREE.Mesh).morphTargetInfluences; if (influences) morphs.push([influences, influences.slice()]); });
    for (const [node, position, quaternion, scale] of rest) { node.position.copy(position); node.quaternion.copy(quaternion); node.scale.copy(scale); if (!node.matrixAutoUpdate) node.updateMatrix(); }
    root.updateMatrixWorld(true);
    try { return fn(); } finally {
      rest.forEach(([node], i) => { node.position.copy(now[i][0]); node.quaternion.copy(now[i][1]); node.scale.copy(now[i][2]); if (!node.matrixAutoUpdate) node.updateMatrix(); });
      for (const [influences, saved] of morphs) for (let i = 0; i < saved.length; i++) influences[i] = saved[i];
      root.updateMatrixWorld(true);
    }
  };
}

/**
 * 구운 AO를 설정에 따라 실행 중에 켜고 끄는 상태: 켜면 캐시 파일(없으면 굽는 자세로 굽기)을 붙이고, 끄면 재질에서 AO만 빼 다시 컴파일
 * 한 번 붙인 AO는 남겨 두어 다시 켤 때 굽지 않음. 준비하는 동안 다시 바뀌면 끝난 뒤 지금 설정에 맞춤
 * 준비가 실패하면 매 프레임 다시 굽지 않고, 설정을 껐다 켤 때 한 번 더 시도
 * @param prepare 굽거나 캐시를 읽어 AO를 붙이는 함수 (prepareBakedAo)
 */
export function createAoSwitch(prepare: () => Promise<{ uniforms: ReturnType<typeof createBakedAoUniforms>; materials: Set<THREE.Material> } | null>) {
  let ready: { uniforms: ReturnType<typeof createBakedAoUniforms>; materials: Set<THREE.Material> } | null = null, on = false, pending: Promise<void> | null = null, want = false, failed = false;
  /** 켠 재질의 AO define을 켜거나 끔 */
  const show = (enabled: boolean) => {
    if (!ready || on === enabled) return;
    for (const material of ready.materials) if (enabled) enableBakedAo(material as THREE.ShaderMaterial, ready.uniforms); else disableBakedAo(material as THREE.ShaderMaterial);
    on = enabled;
  };
  return {
    /** 지금 AO uniform (켜졌을 때만) */
    get uniforms() { return on ? ready?.uniforms ?? null : null; },
    /** 설정 반영 (매 프레임 불러도 됨). 처음 켤 때만 준비(비동기) */
    sync(enabled: boolean) {
      want = enabled;
      if (!enabled) failed = false;
      if (ready) { show(enabled); return pending; }
      if (!enabled || pending || failed) return pending;
      pending = prepare().then((result) => { ready = result; on = !!result; failed = !result; if (result && !want) show(false); }, () => { failed = true; }).finally(() => { pending = null; });
      return pending;
    },
  };
}

/**
 * 3D rig 생성: avatar.json과 모델을 불러와 캔버스에 그릴 준비
 * @param base 모델 폴더 주소 (끝에 /)
 * @param pet 펫 창(전신)이면 true, 창 안(상반신)이면 false
 * @returns rig, 불러오는 사이 꺼졌으면 null
 */
export async function createThreeRig({ base, life, canvas, W, H, pet, outlineNormals, tuning }: {
  base: string; life: Lifetime; canvas: HTMLCanvasElement; W: number; H: number; pet: boolean;
  /** 외곽선 법선 출처 (설정 드롭다운, 없으면 avatar.json 값) */
  outlineNormals?: OutlineNormals;
  /** 사용자 표정 조정 (설정 화면 값, 매 프레임 읽음) */
  tuning?: () => RigTuning | undefined;
}): Promise<AvatarRig | null> {
  const json = await (await fetch(base + "avatar.json")).json() as AvatarProfile;
  if (json.outline && outlineNormals) json.outline.normals = outlineNormals;
  const textureLoader = new THREE.TextureLoader();
  const loader = new FBXLoader();
  // VRM: three-vrm으로 읽고 VRM 값으로 프로필을 합성(avatar.json은 덮어쓰기)·MToon을 툰 재질로 바꿈
  const vrm = modelFormat(json.model) === "vrm" ? await loadVrm(base + json.model, json, life) : null;
  const profile = vrm ? vrm.profile : json;
  const vrmRuntime: VrmRuntime | null = vrm ? vrm.runtime : null;
  const model = vrm ? vrm.model : await loader.loadAsync(base + profile.model);
  if (life.stopped) return null;
  if (!vrm) dedupeFbxBones(model);
  /** VRM 사람형 뼈 노드 (FBX·avatar.json으로 이름을 준 뼈는 없음 → 이름으로 찾음) */
  const vrmNode = (name: HumanBone) => vrmRuntime?.nodes.get(name);
  // 방향 보정 그룹: 파일 좌표계와 상관없이 위 +y·정면 +z·이름상 왼쪽 +x 로 (아래 코드는 이 화면 기준을 가정)
  const root = new THREE.Group();
  root.add(model);
  model.updateMatrixWorld(true);
  const pointOf = (name: HumanBone) => { const id = profile.bones[name]; const node = vrmNode(name) ?? (id ? model.getObjectByName(id) : null); return node ? node.getWorldPosition(new THREE.Vector3()) : null; };
  const [hipsAt, headAt, leftArmAt, rightArmAt] = (["hips", "head", "leftUpperArm", "rightUpperArm"] as const).map(pointOf);
  applyOrientation(root, hipsAt && headAt && leftArmAt && rightArmAt
    ? { hips: hipsAt, head: headAt, leftUpperArm: leftArmAt, rightUpperArm: rightArmAt, leftEye: pointOf("leftEye"), rightEye: pointOf("rightEye") } : null, profile.orientation);

  const taaMode = profile.render?.antialias === "taa", renderScale = profile.render?.scale ?? 1;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !taaMode, premultipliedAlpha: true, stencil: true });   // 스텐실(눈썹이 앞머리 위로 비침)에 필요, three.js 기본은 꺼짐
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(root);
  const light = new THREE.DirectionalLight(0xffffff, profile.light?.intensity ?? 2.2);
  light.position.set(...(profile.light?.direction ?? [0.6, 1.2, 1.6]));
  scene.add(light, new THREE.AmbientLight(0xffffff, profile.light?.ambient ?? 0.9));
  // 행렬 갱신은 tick에서 프레임당 한 번만 (three.js가 render마다 장면 전체를 다시 갱신하지 않게). 조명은 움직이지 않아 지금 한 번
  scene.matrixWorldAutoUpdate = false;
  light.updateMatrixWorld();
  life.add(() => {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      for (const material of ([] as THREE.Material[]).concat(mesh.material || [])) material.dispose();
    });
    renderer.dispose();
  });
  const taa = taaMode ? createTaa(renderer, life) : null;   // TAA는 MSAA 대신 지터·히스토리로 경계를 고름

  // ---------- 재질: 툰 재질로 바꾸고 숨길 것은 숨김 ----------
  const textures = new Map<string, THREE.Texture>();
  const textureLoads: Array<Promise<void>> = [];   // 텍스처 다 받기 (AO 굽기의 알파 테스트가 바탕 맵을 읽음, 실패도 끝난 것으로)
  /** 텍스처 불러오기 시작 (다 받거나 실패하면 끝나는 약속을 textureLoads에 모음) */
  const loadTexture = (url: string) => {
    let done = () => {};
    textureLoads.push(new Promise((resolve) => { done = resolve; }));
    return textureLoader.load(url, () => done(), undefined, () => done());
  };
  /**
   * 폴더 기준 텍스처 (같은 파일은 한 번만)
   * @param linear true면 색이 아닌 수치 맵(AO 등)이라 색 공간 변환 없이 읽음
   */
  const texture = (file?: string, linear = false) => {
    if (!file) return undefined;
    let found = textures.get(file);
    if (!found) { found = loadTexture(base + file); found.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace; found.wrapS = found.wrapT = THREE.RepeatWrapping;   /* Unity·UE처럼 반복 (효과 메시 UV가 0~1 밖을 씀) */ textures.set(file, found); life.add(() => found!.dispose()); }
    return found;
  };
  const hidden = new Set(profile.hide || []);
  // 얼굴 SDF 그림자 uniform (얼굴 재질이 같이 쓰고 매 프레임 머리·빛 방향으로 갱신)
  const faceSdfUniforms = createFaceSdfUniforms(profile.faceSdf ? texture(profile.faceSdf.map, true)! : null, profile.faceSdf?.softness);
  root.traverse((node) => {
    if (hidden.has(node.name)) node.visible = false;
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;   // 뼈로 움직인 메시가 경계 밖으로 잘리지 않게
    const swap = (material: THREE.Material) => {
      const spec = profile.materials?.[material.name];
      if (!spec) return material;
      const sdf = !!profile.faceSdf && profile.faceSdf.material === material.name;
      const toon = createToonMaterial(toonOptionsOf(material.name, spec, texture, profile.rim, sdf ? faceSdfUniforms : undefined));
      toon.visible = !spec.hidden;
      if (spec.stencil) applyStencil(toon, spec.stencil);
      material.dispose();
      return toon;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });

  // ---------- 외곽선: 같은 뼈·모프를 쓰는 복제 메시에 툰 외곽선 재질(뒤집어 부풀려 그림) ----------
  if (profile.outline) {
    const height = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
    const skip = new Set(profile.outline.skip || []);
    /**
     * 외곽선 재질 (원본 재질의 투명 처리·텍스처를 따름)
     * @param vertexWidth true면 정점 속성 outlineWidth를 두께에 곱함 (모델 제공 외곽선의 정점 색 R)
     */
    const outlineMaterial = (source: THREE.Material, vertexWidth = false) => {
      // 표면 설정은 바탕 맵·알파 테스트만 따르고 나머지는 기본값 (MToon 외곽선 재질로 그리던 때와 같은 색)
      const material = createOutlineMaterial({
        width: profile.outline!.width * height, outlineColor: profile.outline!.color || "#2b2430", lightingMix: 0.3,
        map: mapOf(source), alphaTest: source.alphaTest, widthAttribute: vertexWidth,
      });
      material.visible = source.visible && !skip.has(source.name);
      const stencil = profile.materials?.[source.name]?.stencil;
      if (stencil?.test) applyStencil(material, { ref: stencil.ref, test: stencil.test });   // 앞머리 외곽선도 비친 눈썹을 덮지 않게
      life.add(() => material.dispose());
      return material;
    };
    const meshes: THREE.SkinnedMesh[] = [], authored = new Map<string, THREE.SkinnedMesh>();
    root.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      if (mesh.name.endsWith("_Outline")) authored.set(mesh.name, mesh);
      else if (mesh.visible && !hidden.has(mesh.parent?.name || "")) meshes.push(mesh);
    });
    const used = new Set<THREE.Object3D>();   // 쓴 모델 제공 외곽선 (묶음을 켜도 나머지는 숨김)
    for (const mesh of meshes) {
      const candidate = profile.outline.normals === "model" ? authored.get(mesh.name + "_Outline") : undefined;
      const own = candidate && samePositions(candidate.geometry, mesh.geometry, height * 1e-4) ? candidate : undefined;   // 모양이 다른 외곽선 메시는 매끄러운 법선으로 대신
      if (own) {   // 모델 제공 외곽선 메시: 다듬은 법선·정점 색 R(두께 배율)을 그대로 쓰고 재질만 툰 외곽선으로
        const materials = ([] as THREE.Material[]).concat(mesh.material);
        const color = own.geometry.getAttribute("color");
        if (color) own.geometry.setAttribute("outlineWidth", new THREE.BufferAttribute(Float32Array.from({ length: color.count }, (_, i) => color.getX(i)), 1));
        const ownMaterials = ([] as THREE.Material[]).concat(own.material).map((_, i) => outlineMaterial(materials[Math.min(i, materials.length - 1)], !!color));
        own.material = Array.isArray(own.material) ? ownMaterials : ownMaterials[0];
        own.visible = true; own.frustumCulled = false; own.renderOrder = OUTLINE_ORDER;
        for (let node: THREE.Object3D | null = own.parent; node && node !== root; node = node.parent) node.visible = true;
        used.add(own);
        continue;
      }
      const materials = ([] as THREE.Material[]).concat(mesh.material);
      const geometry = outlineGeometry(mesh.geometry, height * 1e-5);   // 모델 키의 10만분의 1 안이면 같은 위치
      life.add(() => geometry.dispose());
      const outline = new THREE.SkinnedMesh(geometry, Array.isArray(mesh.material) ? materials.map((material) => outlineMaterial(material)) : outlineMaterial(materials[0]));
      outline.bind(mesh.skeleton, mesh.bindMatrix);
      outline.morphTargetInfluences = mesh.morphTargetInfluences;   // 같은 배열을 써서 표정·옷 모프를 그대로 따름
      outline.morphTargetDictionary = mesh.morphTargetDictionary;
      outline.frustumCulled = false; outline.renderOrder = OUTLINE_ORDER;
      outline.name = mesh.name + "__outline";
      mesh.parent!.add(outline);
      outline.position.copy(mesh.position); outline.quaternion.copy(mesh.quaternion); outline.scale.copy(mesh.scale);
    }
    for (const mesh of authored.values()) if (!used.has(mesh)) mesh.visible = false;
  }

  // ---------- 그리는 순서: order가 있는 재질은 같은 뼈·모프를 쓰는 복제 메시로 떼어 그 순서로 그림 ----------
  splitByOrder(root, (name) => profile.materials?.[name]?.order ?? 0, life);

  // ---------- 구운 AO: 기본 T자 자세(팔 내림·애니메이션 전)에서 굽거나 캐시 파일을 씀. 끄면 아무것도 바꾸지 않음 ----------
  // 지금(팔 내림 전) 자세를 기억해 두어 실행 중에 AO를 켜도 같은 자세·같은 캐시 키로 구움. 설정은 매 프레임 읽어 새로고침 없이 켜고 끔
  const inRestPose = restPoseRunner(root);
  const aoSettings = aoSettingsOf(profile.ao, tuning?.()), modelAo = hasModelAo(profile);   // 모델 AO 맵이 있으면 켜도 굽지 않음
  const ao = createAoSwitch(() => prepareBakedAo(renderer, root, profile, new URL("../avatar-cache/ao", new URL(base, location.href)).href, json.model, aoSettings,
    aoStrengthOf(profile.ao, tuning?.()), Promise.all(textureLoads), inRestPose)
    .catch((error) => { log.warnOnce("ao-bake", "AO를 굽지 못했습니다:", error); return null; }));
  await ao.sync(aoSettings.enabled && !modelAo);   // 처음부터 켜져 있으면 첫 화면 전에 붙임
  if (life.stopped) return null;

  // ---------- 뼈 ----------
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((node) => { if (!byName.has(node.name)) byName.set(node.name, node); });
  // 모델의 원래 지역 회전 (애니메이션 클립을 옮길 때 기준, 팔 내림 보정 전)
  const bindLocal = new Map<string, THREE.Quaternion>();
  for (const [name, node] of byName) bindLocal.set(name, node.quaternion.clone());
  const bone = (name: HumanBone) => { const id = profile.bones[name]; return vrmNode(name) ?? (id ? byName.get(id) || null : null); };
  root.updateMatrixWorld(true);
  const worldOf = (node: THREE.Object3D | null) => node ? node.getWorldPosition(new THREE.Vector3()) : null;
  /** 월드 축 기준 회전(delta)을 뼈의 지역 회전에 반영: L' = L × (W⁻¹ × D × W) */
  const turnWorld = (node: THREE.Object3D, delta: THREE.Quaternion, restLocal: THREE.Quaternion, restWorld: THREE.Quaternion) => {
    node.quaternion.copy(restLocal).multiply(restWorld.clone().invert().multiply(delta).multiply(restWorld));
  };
  // 기본 자세: T자로 벌린 위팔을 몸 옆으로 내림 (뼈 방향으로 계산해 모델 축과 무관)
  const hipsPos = worldOf(bone("hips")) || new THREE.Vector3();
  for (const side of ["left", "right"] as const) {
    const upper = bone(`${side}UpperArm`), lower = bone(`${side}LowerArm`);
    if (!upper || !lower || !profile.armDown) continue;
    const from = worldOf(lower)!.sub(worldOf(upper)!).normalize();
    const out = Math.sign(worldOf(upper)!.x - hipsPos.x) || 1;
    const angle = profile.armDown * DEG;
    const target = new THREE.Vector3(out * Math.cos(angle), -Math.sin(angle), 0.08).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(from, target);
    turnWorld(upper, delta, upper.quaternion.clone(), upper.getWorldQuaternion(new THREE.Quaternion()));
    root.updateMatrixWorld(true);
  }
  // 채널을 덧씌우는 뼈의 바탕 자세 (애니메이션이 정한 자세, 없으면 기본 자세). 매 프레임 여기서 시작해 덧씌움이 쌓이지 않게 함
  // AnimationMixer는 값이 직전 프레임과 같으면 뼈에 쓰지 않으므로, 기본 자세가 아니라 직전 바탕 자세로 되돌려야 함
  // (기본 자세로 되돌리면 클립 값이 몇 프레임 그대로인 구간에서 뼈가 기본 자세로 튐)
  const MOVED: HumanBone[] = ["hips", "spine", "chest", "neck", "head", "leftEye", "rightEye"];
  const basePose = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const name of MOVED) { const node = bone(name); if (node) basePose.set(node, node.quaternion.clone()); }

  // ---------- 크기·카메라 ----------
  const box = new THREE.Box3().setFromObject(root);
  const top = box.max.y, bottom = box.min.y, fullH = top - bottom;
  const shoulders = (() => { const l = worldOf(bone("leftUpperArm")), r = worldOf(bone("rightUpperArm")); return l && r ? l.distanceTo(r) : fullH * 0.2; })();
  const bodyWidthWorld = shoulders * 2.1;
  const centerX = (worldOf(bone("head")) || hipsPos).x;
  const cutY = top - fullH * 0.47;   // 창 안은 허리 위만 (Live2D 모델의 상반신 잘림선과 같은 비율)
  const bustScale = Math.min((W * 0.98) / bodyWidthWorld, (H * 0.95) / (top - cutY));
  const fullScale = Math.min((W * 0.98) / bodyWidthWorld, (H * 0.95) / fullH);
  const scale = pet ? fullScale : bustScale;   // 캔버스 px / 월드 단위
  const camera = new THREE.OrthographicCamera(-W / 2 / scale, W / 2 / scale, H / 2 / scale, -H / 2 / scale, -100 * fullH, 100 * fullH);
  // 모델 위 끝이 캔버스 y = H×0.05, 가로 가운데가 캔버스 가운데에 오게
  const camTop = top + (H * 0.05) / scale;
  camera.position.set(centerX, camTop - H / 2 / scale, 10 * fullH);
  camera.lookAt(centerX, camTop - H / 2 / scale, 0);
  camera.updateMatrixWorld(true);
  const projected = new THREE.Vector3();
  /** 월드 좌표 → 캔버스(배율 1) 좌표 */
  const toCanvas = (point: THREE.Vector3) => { projected.copy(point).project(camera); return { x: (projected.x + 1) / 2 * W, y: (1 - projected.y) / 2 * H }; };
  const headPos = worldOf(bone("head")) || new THREE.Vector3(centerX, top - fullH * 0.1, 0);
  const PET_BUBBLE = 150;
  const metrics: RigMetrics = {
    W, H, visW: bodyWidthWorld * scale, noseX: toCanvas(headPos).x, chibiHeadDrop: 0, walkBodyWidth: bodyWidthWorld * scale,
    waistPet: H * 0.05 + (top - cutY) * fullScale, waistWin: H * 0.05 + (top - cutY) * bustScale, waistPct: (H * 0.05 + (top - cutY) * fullScale) / H * 100,
    petHeadRatio: bustScale / fullScale, headGain: bustScale / scale,
    petKMin: 0.45, petKMax: Math.max(1.2, ((typeof screen !== "undefined" && screen.availHeight ? screen.availHeight : 1080) - PET_BUBBLE) / H), petBubble: PET_BUBBLE,
    petBustOffset: 0,
  };

  // ---------- 모프 ----------
  const morphSlots = new Map<string, Array<[THREE.Mesh, number]>>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.morphTargetDictionary) return;
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
      const key = morphKey(name);
      (morphSlots.get(key) || morphSlots.set(key, []).get(key)!).push([mesh, index]);
    }
  });

  // ---------- 몸 애니메이션 ----------
  const springRoots = new Set<THREE.Object3D>();
  for (const spec of profile.springs || []) for (const id of spec.roots) { const node = byName.get(id); if (node) springRoots.add(node); }
  const springBones = new Set<THREE.Object3D>();
  for (const node of springRoots) node.traverse((child) => { springBones.add(child); });
  /**
   * 클립 불러오기: 모델에 있는 뼈의 회전 트랙만 (흔들림 뼈·위치·모프 트랙은 뺌)
   * 다른 도구(UE 등)가 내보낸 클립은 좌표 변환이 기본 자세에 섞여 있어, 뼈마다 기본 자세 차이를 빼서 옮김:
   * 모델 회전 = 모델 기본 자세 × (클립 기본 자세)⁻¹ × 클립 회전
   */
  const loadClip = async (file: string) => {
    const source = await loader.loadAsync(base + file);
    const clip = source.animations[0];
    if (!clip) return null;
    const clipBind = new Map<string, THREE.Quaternion>();
    source.traverse((node) => { if (!clipBind.has(node.name)) clipBind.set(node.name, node.quaternion.clone()); });
    const q = new THREE.Quaternion(), offset = new THREE.Quaternion();
    clip.tracks = clip.tracks.filter((track) => {
      const dot = track.name.lastIndexOf("."), name = track.name.slice(0, dot), node = byName.get(name);
      if (track.name.slice(dot) !== ".quaternion" || !node || springBones.has(node)) return false;
      offset.copy(bindLocal.get(name)!).multiply(clipBind.get(name)?.clone().invert() || new THREE.Quaternion());
      for (let i = 0; i < track.values.length; i += 4) {
        q.fromArray(track.values, i).premultiply(offset).normalize().toArray(track.values, i);
      }
      return true;
    });
    return clip;
  };
  const mixer = new THREE.AnimationMixer(root);
  const idleClip = profile.animations?.idle ? await loadClip(profile.animations.idle).catch(() => null) : null;
  const idleAction = idleClip ? mixer.clipAction(idleClip) : null;
  idleAction?.play();
  const gestureActions = new Map<string, THREE.AnimationAction>();
  for (const [name, file] of Object.entries(profile.animations?.gestures || {})) {
    const clip = await loadClip(file).catch(() => null);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;   // 끝 자세를 붙잡은 채 대기 동작으로 섞여 돌아감
    gestureActions.set(name, action);
  }
  if (life.stopped) return null;
  let gesture: { action: THREE.AnimationAction; until: number } | null = null;
  /** 몸짓이 끝났으면 대기 동작으로 섞어 돌아가기 */
  const endGesture = (now: number) => {
    if (!gesture || now < gesture.until) return;
    gesture.action.fadeOut(0.3);
    if (idleAction) { idleAction.enabled = true; idleAction.fadeIn(0.3).play(); }
    gesture = null;
  };

  // ---------- 흔들림(스프링) ----------
  // 사람형 뼈로 만든 충돌체 (반지름은 모델 키 대비, 원본 VRChat 충돌체 크기 참고: 다리 5cm·머리 7cm·가슴 11~13cm 정도)
  const colliderScale = profile.colliders?.scale ?? 1;
  const headLocalUp = (() => { const node = bone("head"); return node ? new THREE.Vector3(0, fullH * 0.045, 0).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()).invert()) : undefined; })();
  const COLLIDERS: Array<[ColliderGroup, HumanBone, HumanBone | null, number, THREE.Vector3?]> = [
    ["head", "head", null, 0.05, headLocalUp],
    // 가슴은 원본 PhysBone 충돌체(가슴 구 13cm·11cm ≈ 키의 8%·7%)처럼 크게: 앞머리가 조끼 앞면을 뚫지 않게
    ["body", "chest", null, 0.08], ["body", "chest", "neck", 0.05], ["body", "spine", "chest", 0.065], ["body", "hips", "spine", 0.06],
    ["legs", "leftUpperLeg", "rightUpperLeg", 0.035],
    ["legs", "leftUpperLeg", "leftLowerLeg", 0.045], ["legs", "rightUpperLeg", "rightLowerLeg", 0.045],
    ["legs", "leftLowerLeg", "leftFoot", 0.03], ["legs", "rightLowerLeg", "rightFoot", 0.03],
    // 팔은 소매(걷어 올린 셔츠) 두께까지
    ["arms", "leftUpperArm", "leftLowerArm", 0.03], ["arms", "rightUpperArm", "rightLowerArm", 0.03],
    ["arms", "leftLowerArm", "leftHand", 0.026], ["arms", "rightLowerArm", "rightHand", 0.026],
  ];
  const collidersOf = (groups: ColliderGroup[] = []) => COLLIDERS.filter(([group, from]) => groups.includes(group) && bone(from)).map(([, from, to, ratio, offset]): SpringCollider =>
    ({ from: bone(from)!, to: to ? bone(to) : null, fromOffset: offset, radius: ratio * fullH * colliderScale }));
  root.updateMatrixWorld(true);
  vrmRuntime?.rested();   // VRM 흔들림 뼈는 월드 좌표로 끝점을 들고 있어, 방향 보정·팔 내림 뒤 자세를 기준으로 다시 잡음
  const springs = createSprings((profile.springs || []).map((spec) => ({ ...spec, radius: (spec.radius ?? 0.012) * fullH, colliders: collidersOf(spec.colliders),
    roots: spec.roots.map((id) => byName.get(id)).filter((node): node is THREE.Object3D => !!node) })));

  // ---------- 얼굴 SDF: 빛이 얼굴 정면에서 돌아간 각도 ----------
  // 처음 자세에서 모델은 카메라(+Z)를 봄 → 머리 뼈 지역 좌표의 앞·오른쪽·위 방향을 기억해 두고 매 프레임 월드로 돌림
  const headBone = bone("head");
  const headWorldQ = headBone ? headBone.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion();
  const faceAxes = { forward: new THREE.Vector3(0, 0, 1).applyQuaternion(headWorldQ), right: new THREE.Vector3(1, 0, 0).applyQuaternion(headWorldQ), up: new THREE.Vector3(0, 1, 0).applyQuaternion(headWorldQ) };
  const sdfQ = new THREE.Quaternion(), sdfF = new THREE.Vector3(), sdfR = new THREE.Vector3(), sdfU = new THREE.Vector3(), sdfL = new THREE.Vector3();
  /** 머리 수평면에 투영한 빛 방향으로 SDF 문턱값(정면 0 → 옆 0.5 → 뒤 1)과 쓸 채널 결정 */
  const updateFaceSdf = () => {
    if (!headBone) return;
    headBone.getWorldQuaternion(sdfQ);
    sdfF.copy(faceAxes.forward).applyQuaternion(sdfQ); sdfR.copy(faceAxes.right).applyQuaternion(sdfQ); sdfU.copy(faceAxes.up).applyQuaternion(sdfQ);
    sdfL.copy(light.position).normalize();
    sdfL.addScaledVector(sdfU, -sdfL.dot(sdfU));
    if (sdfL.lengthSq() < 1e-6) return;
    sdfL.normalize();
    faceSdfUniforms.faceSdfThreshold.value = Math.acos(clamp(sdfF.dot(sdfL), -1, 1)) / Math.PI;
    faceSdfUniforms.faceSdfUseR.value = (sdfR.dot(sdfL) > 0) !== !!profile.faceSdf!.swap ? 1 : 0;
  };

  // ---------- 매 프레임 ----------
  const values = new Map<string, number>();
  const expressionWeights = new Map<string, number>();
  let frameFn: (() => void) | null = null;
  let lastTick = performance.now();
  const keyOf = channelKeyOf;
  const euler = new THREE.Euler(), deltaQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), worldQ = new THREE.Quaternion();
  // 고개 채널은 Live2D 물리 입력값(±30)이라 실제 각도로 그대로 쓰면 크고 딱딱함 → 배율을 줄이고 관성을 줘서 따라가게 함
  // 배율·따라가는 빠르기(초당)·목 비율·눈 각도는 시선 프로필(avatar.json gaze.bone, character/gaze.ts)
  const gaze = resolveGaze(profile.gaze), { gain: headGain, neckShare, eyeDeg } = gaze.bone;
  // 고개·몸 채널은 Live2D에선 물리 입력이라 늦게 따라감 → 3D에선 뼈마다 덧씌움 회전을 들고 목표 쪽으로 slerp로 따라가게 함
  /** 고개·몸 뼈의 지금 덧씌움 회전 */
  const smoothed = new Map<HumanBone, THREE.Quaternion>((["neck", "head", "chest", "spine"] as HumanBone[]).map((name) => [name, new THREE.Quaternion()]));
  /**
   * 덧씌울 회전을 뼈의 지금 자세(애니메이션 포함) 월드 회전 앞에 곱함: L' = P⁻¹ × D × P × L
   * @param delta 월드 축 기준 회전
   */
  const applyDelta = (node: THREE.Object3D, delta: THREE.Quaternion) => {
    node.parent!.getWorldQuaternion(parentQ);
    worldQ.copy(parentQ).multiply(node.quaternion).premultiply(delta);
    node.quaternion.copy(parentQ.invert().multiply(worldQ));
  };
  /**
   * 이번 프레임 채널 값으로 뼈 회전 (고개는 목·머리로 나누고(기본 40%·60%) 쿼터니언 slerp로 따라감)
   * @param dt 지난 프레임부터 흐른 시간(초)
   */
  const applyBones = (dt: number) => {
    const v = (key: string) => values.get(key) || 0;
    const yaw = clamp(v("headTurn"), -30, 30) * headGain[0], pitch = clamp(v("headTilt"), -30, 30) * headGain[1], roll = clamp(v("headRoll"), -30, 30) * headGain[2];
    const follow = gaze.bone.follow > 0 ? Math.min(1, dt * gaze.bone.follow) : 1;   // 0이면 따라가지 않고 바로
    /** 목표 회전(월드 축, 도)을 쿼터니언으로 만들고 지금 회전에서 slerp로 따라가 적용 */
    const turnSmooth = (name: HumanBone, x: number, y: number, z: number) => {
      const node = bone(name), current = smoothed.get(name)!;
      if (!node || !node.parent) return;
      current.slerp(deltaQ.setFromEuler(euler.set(x * DEG, y * DEG, z * DEG, "YXZ")), follow);
      applyDelta(node, current);
    };
    /** 월드 축 회전(도) 바로 적용 */
    const turn = (name: HumanBone, x: number, y: number, z: number) => {
      const node = bone(name);
      if (!node || !node.parent || (!x && !y && !z)) return;
      applyDelta(node, deltaQ.setFromEuler(euler.set(x * DEG, y * DEG, z * DEG, "YXZ")));
    };
    turnSmooth("neck", -pitch * neckShare, yaw * neckShare, roll * neckShare);
    turnSmooth("head", -pitch * (1 - neckShare), yaw * (1 - neckShare), roll * (1 - neckShare));
    turnSmooth("chest", v("bodyLean") * 0.25 - v("breath") * 1.2, clamp(v("bodyShiftX"), -30, 30) * 0.2, 0);
    turnSmooth("spine", 0, 0, clamp(v("bodyShiftZ"), -30, 30) * 0.2);
    const eyeX = clamp(v("eyeLookX"), -1, 1) * eyeDeg[0], eyeY = clamp(v("eyeLookY"), -1, 1) * eyeDeg[1];
    turn("leftEye", -eyeY, eyeX, 0);
    turn("rightEye", -eyeY, eyeX, 0);
  };
  const vrmNames: ReadonlySet<string> = vrmRuntime?.expressionNames ?? new Set();
  /** 이번 프레임 채널·표정·소품으로 모프·VRM 표정 세기 계산·적용 @param dt 지난 프레임부터 흐른 시간(초, 채널 평활용) */
  const smoothedChannels = new Map<string, number>();
  const applyMorphs = (dt: number) => {
    const weights = new Map<string, number>(Object.entries(profile.baseMorphs || {}));
    const sink: WeightSink = { morphs: weights, expressions: new Map(), vrmNames };
    const add = (morph: string, w: number) => weights.set(morph, (weights.get(morph) || 0) + w);
    const channelValues = tunedChannels(Object.keys(profile.channels || {}), values, smoothedChannels, dt, tuning?.() ?? {}, profile.channelSmooth);
    for (const [channel, bindings] of Object.entries(profile.channels || {})) {
      const value = channelValues.get(channel) || 0;
      for (const binding of bindings) { const w = bindingWeight(binding, value); if (w) addBindingWeight(sink, binding, w); }
    }
    for (const [name, w] of expressionWeights) for (const [target, amount] of Object.entries(profile.expressions?.[name] || {})) addTargetWeight(sink, target, amount * w);
    for (const [key, bindings] of Object.entries(profile.outfit || {})) {
      const raw = values.get("outfit." + key) || 0, item = OUTFIT_ITEMS.find((each) => each.key === key);
      const on = clamp(raw / ((item && item.on) || 1), 0, 1);
      for (const binding of bindings) add(binding.morph, binding.invert ? 1 - on : on);
    }
    limitExclusiveMorphs(weights, profile.exclusiveMorphs);
    for (const slots of morphSlots.values()) for (const [mesh, index] of slots) mesh.morphTargetInfluences![index] = 0;
    for (const [morph, w] of weights) for (const [mesh, index] of morphSlots.get(morph) || []) mesh.morphTargetInfluences![index] = clamp(w, 0, 1);
    vrmRuntime?.setExpressions(sink.expressions);
  };

  // ---------- 터치: 뼈를 화면에 투영한 캡슐 ----------
  const SEGMENTS: Array<{ part: string; from: HumanBone; to: HumanBone; radius: number }> = [
    { part: "waist", from: "neck", to: "hips", radius: shoulders * 0.55 },
    { part: "arm", from: "leftUpperArm", to: "leftLowerArm", radius: shoulders * 0.16 },
    { part: "arm", from: "leftLowerArm", to: "leftHand", radius: shoulders * 0.14 },
    { part: "arm", from: "rightUpperArm", to: "rightLowerArm", radius: shoulders * 0.16 },
    { part: "arm", from: "rightLowerArm", to: "rightHand", radius: shoulders * 0.14 },
    { part: "leg", from: "leftUpperLeg", to: "leftLowerLeg", radius: shoulders * 0.2 },
    { part: "leg", from: "leftLowerLeg", to: "leftFoot", radius: shoulders * 0.16 },
    { part: "leg", from: "rightUpperLeg", to: "rightLowerLeg", radius: shoulders * 0.2 },
    { part: "leg", from: "rightLowerLeg", to: "rightFoot", radius: shoulders * 0.16 },
  ];
  const PARTS = ["head", ...SEGMENTS.map((segment) => segment.part)];
  /** 점과 선분 사이 거리의 제곱 */
  const segDist2 = (px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 > 1e-6 ? clamp(((px - a.x) * dx + (py - a.y) * dy) / len2, 0, 1) : 0;
    const qx = a.x + dx * t - px, qy = a.y + dy * t - py;
    return qx * qx + qy * qy;
  };
  const headRadiusWorld = Math.max(fullH * 0.07, (top - headPos.y) * 0.75);

  return {
    metrics,
    behaviors: profile.behaviors || [],
    gaze,
    adultAllowed: profile.adultAllowed !== false,
    supports: (feature) => (profile.features || []).includes(feature),
    set(id, value, weight = 1) { const key = keyOf(id); if (!key) return; const current = values.get(key) || 0; values.set(key, weight === 1 ? value : current + (value - current) * weight); },
    add(id, value, weight = 1) { const key = keyOf(id); if (key) values.set(key, (values.get(key) || 0) + value * weight); },
    multiply(id, value, weight = 1) { const key = keyOf(id); if (key) values.set(key, (values.get(key) || 0) * (1 + (value - 1) * weight)); },
    expressionNames: () => Object.keys(profile.expressions || {}),
    expression(name, weight) { expressionWeights.set(name, weight); },
    earHide() {},
    bodyShape() {},
    onFrame(fn) { frameFn = fn; },
    pick(x, y) {
      root.updateMatrixWorld(true);
      const head = toCanvas(worldOf(bone("head")) || headPos);
      const headTop = toCanvas(new THREE.Vector3(head.x, top, 0));
      const headR = headRadiusWorld * (metrics.visW / bodyWidthWorld);
      const headCenterY = (head.y + headTop.y) / 2;
      if ((x - head.x) ** 2 + (y - headCenterY) ** 2 <= headR * headR) return 0;
      for (let i = 0; i < SEGMENTS.length; i++) {
        const segment = SEGMENTS[i], a = worldOf(bone(segment.from)), b = worldOf(bone(segment.to));
        if (!a || !b) continue;
        const r = segment.radius * (metrics.visW / bodyWidthWorld);
        if (segDist2(x, y, toCanvas(a), toCanvas(b)) <= r * r) return i + 1;
      }
      return -1;
    },
    touchShape(_x, y, handle): TouchShape {
      const topY = toCanvas(new THREE.Vector3(centerX, top, 0)).y, bottomY = toCanvas(new THREE.Vector3(centerX, bottom, 0)).y;
      return { part: PARTS[handle] ?? null, ratioY: (y - topY) / (bottomY - topY), inChest: false };
    },
    chibiRegion(y) { return y < toCanvas(worldOf(bone("neck")) || headPos).y ? "head" : "body"; },
    setResolution(k) {
      const ratio = (devicePixelRatio || 1) * (taa ? 1 : 1.5) * Math.max(1, k) * renderScale;   // TAA는 화면 배율 그대로 (지터 누적이 초과 표본 역할)
      if (renderer.getPixelRatio() === ratio && canvas.width > 0) return;
      renderer.setPixelRatio(ratio);
      renderer.setSize(W, H, false);
    },
    resetClock() { lastTick = performance.now(); },
    tick(time) {
      const dt = clamp((time - lastTick) / 1000, 0, 0.05); lastTick = time;
      values.clear(); expressionWeights.clear();
      frameFn?.();
      for (const [node, pose] of basePose) node.quaternion.copy(pose);   // 지난 프레임의 덧씌움을 걷어 내고 바탕 자세에서 시작
      endGesture(performance.now());
      mixer.update(dt);
      for (const [node, pose] of basePose) pose.copy(node.quaternion);   // 믹서가 바꾼 값(안 바꿨으면 그대로)을 바탕 자세로 기억
      applyBones(dt);
      applyMorphs(dt);
      root.updateMatrixWorld(true);   // 프레임당 장면 갱신 (scene.matrixWorldAutoUpdate = false)
      if (dt > 0) springs.step(dt);   // 흔들림 마디는 자기 월드 행렬을 직접 계산
      if (vrmRuntime) { vrmRuntime.update(dt); root.updateMatrixWorld(true); }   // VRM 표정(바인드한 모프를 덮어씀)·노드 제약·흔들림 뼈가 바꾼 노드 반영 (VRM은 복제 뼈가 없어 노드가 적음)
      if (profile.faceSdf) updateFaceSdf();
      ao.sync(aoSettingsOf(profile.ao, tuning?.()).enabled && !modelAo);   // 설정에서 켜고 끄면 바로 반영 (처음 켤 때만 굽거나 캐시를 읽음)
      if (ao.uniforms) ao.uniforms.aoStrength.value = aoStrengthOf(profile.ao, tuning?.());
      if (taa) taa.render(scene, camera, time); else renderer.render(scene, camera);
    },
    gesture(name, ms) {
      const action = gestureActions.get(name);
      if (!action) return;
      if (gesture && gesture.action !== action) gesture.action.fadeOut(0.2);
      idleAction?.fadeOut(0.25);
      action.reset().setEffectiveWeight(1).fadeIn(0.25).play();
      gesture = { action, until: performance.now() + Math.max(action.getClip().duration * 1000, ms) };
    },
    systemTicker() {},
  };
}
