// VRM(0.x·1.0) 모델 불러오기. @pixiv/three-vrm(MIT, © pixiv)은 사람형 뼈·표정·흔들림 뼈·노드 제약·메타를 읽고 돌리는 데만 쓰고,
// MToon 재질은 three-vrm이 읽은 값을 자체 툰 재질(toon-material.ts)로 옮겨 그림. rig-three.ts가 모델 파일이 .vrm일 때 부름.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type MToonMaterial, type VRM } from "@pixiv/three-vrm";
import { createOutlineMaterial, createToonMaterial, updateUvTransforms, type OutlineMaterialOptions, type ToonMaterialOptions } from "./toon-material.ts";
import type { AvatarProfile, HumanBone, MorphBinding } from "./rig-three.ts";
import type { Lifetime } from "./lifetime.ts";

/** 동작 코드가 쓰는 사람형 뼈 (VRM 사람형 뼈 이름과 같음) */
const HUMAN_BONES: HumanBone[] = ["hips", "spine", "chest", "neck", "head", "leftEye", "rightEye",
  "leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm", "leftHand", "rightHand",
  "leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg", "leftFoot", "rightFoot"];
/** VRM 기본 자세(T자)에서 위팔을 내리는 기본 각도(도) */
export const VRM_ARM_DOWN = 70;
/** 채널 → VRM 표정 기본 대응 (눈 뜸은 깜빡임 표정을 뒤집어, 입 벌림은 "aa"를 줄여서) */
const VRM_CHANNELS: Record<string, MorphBinding[]> = {
  eyeOpenLeft: [{ expression: "blinkLeft", map: "invert" }],
  eyeOpenRight: [{ expression: "blinkRight", map: "invert" }],
  "mouthVowel.A": [{ expression: "aa" }], "mouthVowel.I": [{ expression: "ih" }], "mouthVowel.U": [{ expression: "ou" }],
  "mouthVowel.E": [{ expression: "ee" }], "mouthVowel.O": [{ expression: "oh" }],
  mouthOpen: [{ expression: "aa", scale: 0.6 }],
};
/** 동작 코드가 쓰는 표정 이름 (avatar.json expressions 키) */
const OUR_EXPRESSIONS = ["loading", "heart", "blush", "sweat", "dizzy", "tears", "squint", "smug", "dark"];
/** VRM에 같은 이름의 표정이 없을 때 쓰는 프리셋 표정 */
const EXPRESSION_PRESETS: Record<string, string> = { heart: "happy", tears: "sad", dark: "angry", smug: "relaxed", dizzy: "surprised" };

/** VRM에서 뽑은 평범한 값 (프로필 합성 입력, 테스트는 가짜 값을 씀) */
export type VrmInfo = {
  /** 사람형 뼈 → 노드 이름 (진단·avatar.json 호환용, 실제 뼈는 노드 객체로 넘김) */
  bones: Partial<Record<HumanBone, string>>;
  /** VRM 표정 이름 (프리셋 + 사용자 정의) */
  expressions: string[];
  /** 메타가 지나친 성적 표현을 허용하는지 */
  sexualAllowed: boolean;
};
/** avatar.json (VRM은 model만 있어도 됨) */
export type VrmOverrides = Partial<AvatarProfile> & Pick<AvatarProfile, "model">;

/** 모델 파일이 VRM인지 */
export const isVrmModel = (file: string) => /\.vrm$/i.test(file);

/**
 * VRM 메타의 성적 표현 허용 여부 (VRM 1.0 allowExcessivelySexualUsage, VRM 0.x sexualUssageName)
 * @returns 명시적으로 금지하지 않았으면 true
 */
export const sexualUsageAllowed = (meta?: { allowExcessivelySexualUsage?: boolean; sexualUssageName?: string } | null) =>
  meta?.allowExcessivelySexualUsage !== false && meta?.sexualUssageName !== "Disallow";

/**
 * 채널 기본 대응 중 VRM에 있는 표정만
 * @param names VRM 표정 이름
 */
export function defaultVrmChannels(names: string[]): Record<string, MorphBinding[]> {
  const has = new Set(names);
  const entries = Object.entries(VRM_CHANNELS).map(([channel, bindings]) => [channel, bindings.filter((binding) => has.has(binding.expression!))] as const);
  return Object.fromEntries(entries.filter(([, bindings]) => bindings.length));
}

/**
 * 표정 기본 대응: VRM에 같은 이름 표정이 있으면 그것, 없으면 프리셋 표(heart → happy 등), 둘 다 없으면 뺌
 * @param names VRM 표정 이름
 * @returns 표정 이름 → { VRM 표정: 1 }
 */
export function defaultVrmExpressions(names: string[]): Record<string, Record<string, number>> {
  const has = new Set(names);
  const out: Record<string, Record<string, number>> = {};
  for (const name of OUR_EXPRESSIONS) {
    const target = has.has(name) ? name : EXPRESSION_PRESETS[name];
    if (target && has.has(target)) out[name] = { [target]: 1 };
  }
  return out;
}

/**
 * VRM 값으로 프로필 합성: 뼈·채널·표정은 VRM 기본값에 avatar.json 값을 키마다 덮어쓰고, 나머지는 avatar.json 그대로
 * @param overrides avatar.json (model만 있어도 됨)
 */
export function profileFromVrm(info: VrmInfo, overrides: VrmOverrides): AvatarProfile {
  return {
    ...overrides,
    bones: { ...info.bones, ...overrides.bones },
    channels: { ...defaultVrmChannels(info.expressions), ...overrides.channels },
    expressions: { ...defaultVrmExpressions(info.expressions), ...overrides.expressions },
    armDown: overrides.armDown ?? VRM_ARM_DOWN,
    adultAllowed: info.sexualAllowed && overrides.adultAllowed !== false,   // 성적 표현 금지 모델이면 가슴·아랫배 같은 adult 행동을 끔 (character/behavior.ts)
  };
}

/** 이름 → 세기 표에 더하기 */
export const addWeight = (weights: Map<string, number>, name: string, w: number) => { weights.set(name, (weights.get(name) || 0) + w); };
/** 모프·VRM 표정 세기를 모으는 곳 (vrmNames = 모델의 VRM 표정 이름, FBX는 비어 있음) */
export type WeightSink = { morphs: Map<string, number>; expressions: Map<string, number>; vrmNames: ReadonlySet<string> };
/** 채널 대응 하나에 세기 더하기 (expression이면 VRM 표정, 아니면 모프) */
export const addBindingWeight = (sink: WeightSink, binding: MorphBinding, w: number) =>
  binding.expression ? addWeight(sink.expressions, binding.expression, w) : addWeight(sink.morphs, binding.morph!, w);
/** 표정 표의 대상 이름에 세기 더하기: VRM 표정 이름이면 VRM 표정, 아니면 모프 */
export const addTargetWeight = (sink: WeightSink, name: string, w: number) => addWeight(sink.vrmNames.has(name) ? sink.expressions : sink.morphs, name, w);

/** MToon 재질에서 읽는 값 (테스트는 가짜 객체) */
export type MToonValues = Pick<MToonMaterial, "name" | "color" | "opacity" | "map" | "normalMap" | "normalScale" | "emissive" | "emissiveIntensity" | "emissiveMap"
  | "shadeColorFactor" | "shadeMultiplyTexture" | "shadingShiftFactor" | "shadingShiftTexture" | "shadingShiftTextureScale" | "shadingToonyFactor" | "giEqualizationFactor"
  | "matcapFactor" | "matcapTexture" | "rimMultiplyTexture" | "parametricRimColorFactor" | "parametricRimFresnelPowerFactor" | "parametricRimLiftFactor" | "rimLightingMixFactor"
  | "outlineWidthMode" | "outlineWidthFactor" | "outlineWidthMultiplyTexture" | "outlineColorFactor" | "outlineLightingMixFactor"
  | "uvAnimationScrollXOffset" | "uvAnimationScrollYOffset" | "uvAnimationRotationPhase" | "alphaTest" | "transparent" | "side">;

/**
 * MToon 값 → 툰 재질 설정 (옵션 이름이 MToon 값과 1:1. UV 애니메이션은 지금 위치만, 텍스처 변환은 매 프레임 갱신)
 * UV 애니메이션 마스크·v0 호환 그늘은 옮기지 않음 (v0 호환 그늘은 three-vrm 기본값도 꺼짐)
 */
export function toonOptionsFromMToon(source: MToonValues): ToonMaterialOptions {
  return {
    name: source.name, color: source.color, map: source.map, opacity: source.opacity,
    shadeColor: source.shadeColorFactor, shadeMap: source.shadeMultiplyTexture,
    shadingShift: source.shadingShiftFactor, shadingToony: source.shadingToonyFactor,
    shadingShiftMap: source.shadingShiftTexture, shadingShiftMapScale: source.shadingShiftTextureScale,
    giEqualization: source.giEqualizationFactor,
    rim: { color: source.parametricRimColorFactor, fresnelPower: source.parametricRimFresnelPowerFactor, lift: source.parametricRimLiftFactor, lightingMix: source.rimLightingMixFactor,
      map: source.rimMultiplyTexture },
    normalMap: source.normalMap, normalScale: source.normalScale,
    emissive: source.emissive, emissiveIntensity: source.emissiveIntensity, emissiveMap: source.emissiveMap,
    matcap: source.matcapTexture ? { color: source.matcapFactor, map: source.matcapTexture } : undefined,
    uvOffset: [source.uvAnimationScrollXOffset, source.uvAnimationScrollYOffset], uvRotation: source.uvAnimationRotationPhase,
    alphaTest: source.alphaTest, transparent: source.transparent, side: source.side, uvTransforms: true,
  };
}

/**
 * MToon 외곽선 값 → 툰 외곽선 재질 설정 (두께 = outlineWidthFactor 월드 단위, 두께 맵 G 채널)
 * 화면 좌표 두께(screenCoordinates)도 같은 값을 월드 두께로 넘기므로, 그 모드는 convertMToon이 숨김
 */
export const outlineOptionsFromMToon = (source: MToonValues): OutlineMaterialOptions => ({
  ...toonOptionsFromMToon(source), width: source.outlineWidthFactor, outlineColor: source.outlineColorFactor,
  lightingMix: source.outlineLightingMixFactor, widthMap: source.outlineWidthMultiplyTexture,
});

/** 툰 재질 uniform ← MToon 색 속성. 같은 Color 객체를 써서 VRM 표정의 재질 색 바인드가 툰 재질에도 걸림 */
const SHARED_COLORS = [
  ["diffuse", "color"], ["shadeColor", "shadeColorFactor"], ["rimColor", "parametricRimColorFactor"],
  ["emissive", "emissive"], ["matcapColor", "matcapFactor"], ["outlineColor", "outlineColorFactor"],
] as const;

/**
 * MToon 재질 하나를 툰 재질로 바꿈 (외곽선 재질이면 툰 외곽선). 원래 재질은 GPU 자원만 정리하고 표정 바인드용 값 보관소로 남김
 * @returns 툰 재질 (화면 좌표 두께 외곽선은 숨긴 재질)
 */
export function convertMToon(source: MToonMaterial) {
  const material = source.isOutline ? createOutlineMaterial(outlineOptionsFromMToon(source)) : createToonMaterial(toonOptionsFromMToon(source));
  material.visible = source.visible && (!source.isOutline || source.outlineWidthMode === "worldCoordinates");
  material.depthWrite = source.depthWrite;
  for (const [ours, theirs] of SHARED_COLORS) if (material.uniforms[ours]) material.uniforms[ours].value = source[theirs];
  source.dispose();
  return material;
}

/**
 * 장면의 모든 MToon 재질을 툰 재질로 바꿈 (MToon이 아닌 재질은 그대로)
 * @returns [툰 재질, 원래 MToon] 목록 (매 프레임 불투명도·텍스처 변환을 옮겨 옴)
 */
export function convertMToonMaterials(scene: THREE.Object3D) {
  const pairs: Array<[THREE.ShaderMaterial, MToonMaterial]> = [];
  const swap = (material: THREE.Material) => {
    if (!(material as MToonMaterial).isMToonMaterial) return material;
    const toon = convertMToon(material as MToonMaterial);
    pairs.push([toon, material as MToonMaterial]);
    return toon;
  };
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return pairs;
}

/** VRM에서 프로필 합성용 값 뽑기 */
function vrmInfoOf(vrm: VRM): VrmInfo {
  const bones: Partial<Record<HumanBone, string>> = {};
  for (const name of HUMAN_BONES) { const node = vrm.humanoid.getRawBoneNode(name); if (node) bones[name] = node.name; }
  const expressions = (vrm.expressionManager?.expressions || []).map((expression) => expression.expressionName);
  return { bones, expressions, sexualAllowed: sexualUsageAllowed(vrm.meta as { allowExcessivelySexualUsage?: boolean; sexualUssageName?: string }) };
}

/**
 * 사람형 뼈 노드 (avatar.json bones로 이름을 준 뼈는 빼서 이름으로 찾게 함)
 * glTF 노드 이름은 겹칠 수 있어 이름 대신 three-vrm이 찾은 노드 객체를 씀
 */
function humanNodes(vrm: VRM, overrides: VrmOverrides) {
  const nodes = new Map<HumanBone, THREE.Object3D>();
  for (const name of HUMAN_BONES) {
    const node = vrm.humanoid.getRawBoneNode(name);
    if (node && !overrides.bones?.[name]) nodes.set(name, node);
  }
  return nodes;
}

/** rig-three가 매 프레임 부르는 VRM 런타임 */
export type VrmRuntime = {
  /** VRM 표정 이름 (표정 표 대상 이름 판정용) */
  expressionNames: ReadonlySet<string>;
  /** 사람형 뼈 노드 */
  nodes: Map<HumanBone, THREE.Object3D>;
  /** 기본 자세(방향 보정·팔 내림)를 잡고 월드 행렬을 갱신한 뒤 한 번: VRM 흔들림 뼈의 기준 상태를 지금 자세로 다시 잡음 */
  rested(): void;
  /** 이번 프레임 VRM 표정 세기 (없는 표정은 0) */
  setExpressions(weights: Map<string, number>): void;
  /** 뼈·모프를 적용하고 월드 행렬을 갱신한 뒤: 재질 동기화 → 표정 → 노드 제약 → 흔들림 뼈 */
  update(dt: number): void;
};

/**
 * VRM 런타임 만들기 (사람형 뼈는 raw 뼈를 직접 움직이므로 humanoid.update는 부르지 않음)
 * @param springs VRM 흔들림 뼈를 쓸지 (avatar.json springs가 없을 때)
 * @param pairs 툰 재질로 바꾼 [툰, 원래 MToon] 목록
 */
function createVrmRuntime(vrm: VRM, nodes: Map<HumanBone, THREE.Object3D>, springs: boolean, pairs: Array<[THREE.ShaderMaterial, MToonMaterial]>): VrmRuntime {
  const expressionNames = new Set((vrm.expressionManager?.expressions || []).map((expression) => expression.expressionName));
  const springBones = springs ? vrm.springBoneManager : undefined;
  return {
    expressionNames, nodes,
    rested() { springBones?.setInitState(); },
    setExpressions(weights) {
      for (const name of expressionNames) vrm.expressionManager!.setValue(name, Math.min(1, Math.max(0, weights.get(name) || 0)));
    },
    update(dt) {
      for (const [toon, source] of pairs) { toon.uniforms.opacity.value = source.opacity; updateUvTransforms(toon.uniforms); }
      vrm.expressionManager?.update();
      vrm.nodeConstraintManager?.update();
      springBones?.update(dt);
    },
  };
}

/**
 * VRM 불러오기: three-vrm으로 읽고, 프로필 합성·재질 변환·런타임 준비
 * @param url 모델 파일 주소
 * @param overrides avatar.json
 * @returns 모델 장면(아직 방향 보정 전), 합성 프로필, 런타임
 */
export async function loadVrm(url: string, overrides: VrmOverrides, life: Lifetime) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: false }));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM;
  vrm.humanoid.autoUpdateHumanBones = false;   // 동작 코드가 raw 뼈를 직접 움직임 (정규화 뼈 자세로 덮어쓰지 않게)
  vrm.humanoid.normalizedHumanBonesRoot.removeFromParent();   // 정규화 뼈는 안 써서 장면에서 뺌
  life.add(() => VRMUtils.deepDispose(vrm.scene));   // 텍스처까지 정리
  const profile = profileFromVrm(vrmInfoOf(vrm), overrides);
  const pairs = convertMToonMaterials(vrm.scene);
  const runtime = createVrmRuntime(vrm, humanNodes(vrm, overrides), !overrides.springs, pairs);
  return { model: vrm.scene, profile, runtime };
}
