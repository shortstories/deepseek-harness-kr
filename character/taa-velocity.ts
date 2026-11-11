// TAA 속도 출력: 장면 재질이 색과 함께 두 번째 출력(location 1)에 화면 속도(지금 위치 − 이전 프레임 위치, UV 단위)를 쓰게 함 (MRT 한 패스).
// 툰 재질·외곽선 재질·그 밖의 three.js 재질 모두 onBeforeCompile로 같은 GLSL을 끼워 넣음 → TAA를 안 쓰면 재질·프로그램이 그대로.
// 이전 위치는 정점 셰이더에서 이전 프레임 뼈 행렬·모프 가중치·모델 행렬·뷰 투영으로 다시 계산 (모프 → 스킨 → 외곽선 부풀림, toon-material.ts와 같은 순서).
// 투명 재질: 두 번째 출력 알파에 자기 알파를 써서, 첨부마다 그 출력 알파로 계산되는 NormalBlending이 속도를 덮은 만큼 섞고 알파에 투명 덮임(반응성)을 쌓게 함.
import * as THREE from "three";
import type { Lifetime } from "./lifetime.ts";

/** 프레임 공통 행렬 uniform (모든 재질이 같은 객체를 씀) */
export type FrameMatrices = { viewProjection: THREE.IUniform<THREE.Matrix4>; prevViewProjection: THREE.IUniform<THREE.Matrix4> };

const VERTEX_PARS = /* glsl */ `
#ifdef TAA_VELOCITY
  uniform mat4 taaViewProjection;
  uniform mat4 taaPrevViewProjection;
  uniform mat4 taaPrevModelMatrix;
  varying vec4 vTaaClip;
  varying vec4 vTaaPrevClip;
  #ifdef USE_SKINNING
    uniform highp sampler2D taaPrevBoneTexture;
    // 뼈 텍스처에서 뼈 행렬 하나 (three.js getBoneMatrix와 같음, 텍스처만 인자)
    mat4 taaBone( highp sampler2D bones, const in float i ) {
      int size = textureSize( bones, 0 ).x;
      int j = int( i ) * 4;
      int x = j % size;
      int y = j / size;
      return mat4( texelFetch( bones, ivec2( x, y ), 0 ), texelFetch( bones, ivec2( x + 1, y ), 0 ),
        texelFetch( bones, ivec2( x + 2, y ), 0 ), texelFetch( bones, ivec2( x + 3, y ), 0 ) );
    }
    // 가중치를 섞은 스킨 행렬 (모델 좌표 기준)
    mat4 taaSkin( highp sampler2D bones ) {
      mat4 blend = skinWeight.x * taaBone( bones, skinIndex.x ) + skinWeight.y * taaBone( bones, skinIndex.y )
        + skinWeight.z * taaBone( bones, skinIndex.z ) + skinWeight.w * taaBone( bones, skinIndex.w );
      return bindMatrixInverse * blend * bindMatrix;
    }
  #endif
  #ifdef USE_MORPHTARGETS
    uniform float taaPrevMorphBase;
    uniform float taaPrevMorphInfluences[ MORPHTARGETS_COUNT ];
  #endif
#endif
`;

// main 끝: 지금 위치는 three.js 조각이 만든 transformed(+ 외곽선 부풀림), 이전 위치는 이전 값으로 다시 계산
const VERTEX_MAIN = /* glsl */ `
#ifdef TAA_VELOCITY
  vec3 taaCurrent = transformed;
  vec3 taaPrevious = position;
  vec3 taaPrevNormal = normal;
  #ifdef USE_MORPHTARGETS
    taaPrevious *= taaPrevMorphBase;
    #ifdef USE_MORPHNORMALS
      taaPrevNormal *= taaPrevMorphBase;
    #endif
    for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
      if ( taaPrevMorphInfluences[ i ] != 0.0 ) {
        taaPrevious += getMorph( gl_VertexID, i, 0 ).xyz * taaPrevMorphInfluences[ i ];
        #ifdef USE_MORPHNORMALS
          taaPrevNormal += getMorph( gl_VertexID, i, 1 ).xyz * taaPrevMorphInfluences[ i ];
        #endif
      }
    }
  #endif
  #ifdef USE_SKINNING
    mat4 taaPrevSkin = taaSkin( taaPrevBoneTexture );
    taaPrevious = ( taaPrevSkin * vec4( taaPrevious, 1.0 ) ).xyz;
    taaPrevNormal = ( taaPrevSkin * vec4( taaPrevNormal, 0.0 ) ).xyz;
  #endif
  #ifdef OUTLINE
    // 툰 외곽선: 지금은 셰이더가 만든 outlineOffset, 이전은 같은 식(두께 × 법선 길이 × 단위 법선)을 이전 법선으로
    taaCurrent += outlineOffset;
    vec3 taaPrevUnit = normalize( taaPrevNormal );
    float taaWidth = outlineWidthFactor * length( normalMatrix * taaPrevUnit );
    #ifdef OUTLINE_WIDTH_ATTRIBUTE
      taaWidth *= outlineWidth;
    #endif
    #ifdef OUTLINE_WIDTH_MAP
      taaWidth *= texture2D( outlineWidthMap, TOON_UV( outlineWidthMapUvTransform, vUv ) ).g;
    #endif
    taaPrevious += taaWidth * taaPrevUnit;
  #endif
  vTaaClip = taaViewProjection * modelMatrix * vec4( taaCurrent, 1.0 );
  vTaaPrevClip = taaPrevViewProjection * taaPrevModelMatrix * vec4( taaPrevious, 1.0 );
#endif
`;

const FRAGMENT_PARS = /* glsl */ `
#ifdef TAA_VELOCITY
  layout( location = 1 ) out highp vec4 taaVelocity;
  varying vec4 vTaaClip;
  varying vec4 vTaaPrevClip;
#endif
`;

// main 끝: RG = 속도(UV) × TAA_MOTION_WEIGHT, A = 투명 재질이면 자기 알파(블렌딩 계수·반응성), 불투명이면 0
const FRAGMENT_MAIN = /* glsl */ `
#ifdef TAA_VELOCITY
  taaVelocity = vec4( ( vTaaClip.xy / vTaaClip.w - vTaaPrevClip.xy / vTaaPrevClip.w ) * 0.5 * ( TAA_MOTION_WEIGHT ), 0.0, 0.0 );
  #ifdef TAA_REACTIVE
    taaVelocity.a = gl_FragColor.a;
  #endif
#endif
`;

/**
 * 재질 설정 → 속도 출력 define 줄
 * 투명이면 반응성(A = 알파). 속도 가중: 보통은 1(블렌딩이 SRC_ALPHA로 곱함), premultiplied면 알파를 직접 곱함, NormalBlending이 아닌 투명은 0(반응성만)
 */
export function velocityDefines(material: THREE.Material) {
  const lines = ["#define TAA_VELOCITY"];
  let weight = "1.0";
  if (material.transparent) {
    lines.push("#define TAA_REACTIVE");
    if (material.blending !== THREE.NormalBlending) weight = "0.0";
    else if (material.premultipliedAlpha) weight = "gl_FragColor.a";
  }
  lines.push(`#define TAA_MOTION_WEIGHT ${weight}`);
  return lines.join("\n") + "\n";
}

/** 셰이더 문자열에 끼워 넣기: define은 맨 앞, 선언은 첫 main 앞, 계산은 마지막 } 앞 (three.js 기본 재질·툰 재질 모두 main이 마지막 함수) */
const inject = (source: string, defines: string, pars: string, main: string) => {
  const at = source.indexOf("void main()");
  const withPars = source.slice(0, at) + pars + source.slice(at);
  return defines + withPars.replace(/\}\s*$/, main + "}\n");
};

/** 정점·조각 셰이더에 속도 출력 끼워 넣기 (onBeforeCompile에서 부름) */
export const injectVelocity = (shader: { vertexShader: string; fragmentShader: string }, defines: string) => {
  shader.vertexShader = inject(shader.vertexShader, defines, VERTEX_PARS, VERTEX_MAIN);
  shader.fragmentShader = inject(shader.fragmentShader, defines, FRAGMENT_PARS, FRAGMENT_MAIN);
};

/** three.js Skeleton.computeBoneTexture와 같은 뼈 텍스처 한 변 길이 (뼈 하나 = 4텍셀) */
export const boneTextureSize = (boneCount: number) => Math.max(4, Math.ceil(Math.sqrt(boneCount * 4) / 4) * 4);

/** 이전 프레임 모프 바탕 가중치 (three.js와 같음: 상대 모프면 1, 아니면 1 − 합) */
export const morphBaseInfluence = (relative: boolean, influences: ArrayLike<number>) => {
  if (relative) return 1;
  let sum = 0;
  for (let i = 0; i < influences.length; i++) sum += influences[i];
  return 1 - sum;
};

/**
 * 이전 프레임 상태 (뼈 행렬·모프 가중치·모델 행렬). 뼈는 스켈레톤마다, 모프는 가중치 배열마다 하나라
 * 같은 스켈레톤·모프 배열을 쓰는 외곽선 메시와 splitByOrder 복제 메시가 원본과 같은 이전 값을 씀
 */
export function createPrevFrameState() {
  const models = new WeakMap<THREE.Object3D, THREE.Matrix4>();
  const bones = new Map<THREE.Skeleton, THREE.DataTexture>();
  const morphs = new Map<number[], Float32Array>();
  const seen = new Set<THREE.Object3D>();
  /** 이전 모델 행렬 (처음 보면 지금 값) */
  const prevModel = (object: THREE.Object3D) => models.get(object) ?? models.set(object, object.matrixWorld.clone()).get(object)!;
  /** 이전 뼈 텍스처 (처음 보면 지금 뼈 행렬 복사) */
  const prevBones = (skeleton: THREE.Skeleton) => {
    let texture = bones.get(skeleton);
    if (!texture) {
      const size = boneTextureSize(skeleton.bones.length), data = new Float32Array(size * size * 4);
      data.set(skeleton.boneMatrices!);
      texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
      texture.needsUpdate = true;
      bones.set(skeleton, texture);
    }
    return texture;
  };
  /** 이전 모프 가중치 (처음 보면 지금 값) */
  const prevMorphs = (influences: number[]) => morphs.get(influences) ?? morphs.set(influences, Float32Array.from(influences)).get(influences)!;
  const state = {
    /** commit할 때마다 1씩 (재질이 이번 프레임에 이미 값을 넣었는지 판단) */
    frame: 0,
    /** 그리기 직전: 물체의 이전 프레임 값을 uniform에 넣음 */
    bind(uniforms: Record<string, THREE.IUniform>, object: THREE.Object3D) {
      seen.add(object);
      uniforms.taaPrevModelMatrix.value.copy(prevModel(object));
      const mesh = object as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh && mesh.skeleton) uniforms.taaPrevBoneTexture.value = prevBones(mesh.skeleton);
      if (mesh.morphTargetInfluences) {
        const prev = prevMorphs(mesh.morphTargetInfluences);
        uniforms.taaPrevMorphInfluences.value = prev;
        uniforms.taaPrevMorphBase.value = morphBaseInfluence(mesh.geometry.morphTargetsRelative, prev);
      }
    },
    /** 프레임을 다 그린 뒤: 지금 값을 다음 프레임의 이전 값으로 */
    commit() {
      for (const object of seen) prevModel(object).copy(object.matrixWorld);
      for (const [skeleton, texture] of bones) { (texture.image.data as Float32Array).set(skeleton.boneMatrices!); texture.needsUpdate = true; }
      for (const [influences, prev] of morphs) prev.set(influences);
      seen.clear();
      state.frame++;
    },
    /** 이전 뼈 텍스처 정리 */
    dispose() { for (const texture of bones.values()) texture.dispose(); },
  };
  return state;
}
type PrevFrameState = ReturnType<typeof createPrevFrameState>;

/**
 * 재질이 속도를 두 번째 출력에 쓰게 함 (셰이더 끼워 넣기 + 그리기마다 이전 프레임 값 넣기)
 * 같은 재질을 다른 물체가 이어 그리면 three.js가 재질 uniform을 다시 올리지 않으므로 ShaderMaterial은 uniformsNeedUpdate로 올림.
 * three.js 기본 재질(VRM PBR·unlit 등)은 그 경로가 없어, 여러 물체가 같은 재질을 이어 그리면 둘째부터 이전 값이 앞 물체 것으로 남음
 */
export function enableVelocity(material: THREE.Material, frame: FrameMatrices, state: PrevFrameState) {
  const uniforms: Record<string, THREE.IUniform> = {
    taaViewProjection: frame.viewProjection, taaPrevViewProjection: frame.prevViewProjection, taaPrevModelMatrix: { value: new THREE.Matrix4() },
    taaPrevBoneTexture: { value: null }, taaPrevMorphBase: { value: 1 }, taaPrevMorphInfluences: { value: new Float32Array(1) },
  };
  const defines = velocityDefines(material);
  material.onBeforeCompile = (shader) => { Object.assign(shader.uniforms, uniforms); injectVelocity(shader, defines); };
  material.customProgramCacheKey = () => "taa-velocity\n" + defines;
  let boundFrame = -1, boundObject: THREE.Object3D | null = null;
  material.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => {
    const fresh = boundFrame !== state.frame;
    if (!fresh && object === boundObject) return;
    boundFrame = state.frame; boundObject = object;
    state.bind(uniforms, object);
    // 프레임 첫 그리기는 앞 그리기가 다른 재질이라 three.js가 재질 uniform을 올림. 같은 재질을 이어 그릴 때만 다시 올리게 함
    if (!fresh) (material as THREE.ShaderMaterial).uniformsNeedUpdate = true;
  };
  material.needsUpdate = true;
  return uniforms;
}

/**
 * 속도 출력 준비: prepare(장면, 한 번) → 프레임마다 begin(지터 전 카메라) → 장면 그리기(MRT) → commit
 * @param life 이전 뼈 텍스처 정리 등록
 */
export function createVelocityOutputs(life: Pick<Lifetime, "add">) {
  const frame: FrameMatrices = { viewProjection: { value: new THREE.Matrix4() }, prevViewProjection: { value: new THREE.Matrix4() } };
  const state = createPrevFrameState();
  const enabled = new WeakSet<THREE.Material>();
  let started = false;
  life.add(() => state.dispose());
  return {
    /** 장면 메시의 모든 재질에 속도 출력 켜기 (재질이 다 정해진 뒤 첫 프레임에 한 번) */
    prepare(scene: THREE.Object3D) {
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const material of ([] as THREE.Material[]).concat(mesh.material)) {
          if (!enabled.has(material)) { enabled.add(material); enableVelocity(material, frame, state); }
        }
      });
    },
    /** 지터 없는 지금 뷰 투영 기억 (첫 프레임은 이전 값도 같게 = 속도 0) */
    begin(camera: THREE.Camera) {
      frame.viewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      if (!started) frame.prevViewProjection.value.copy(frame.viewProjection.value);
    },
    /** 이번 프레임 값을 이전 값으로 넘김 */
    commit() {
      frame.prevViewProjection.value.copy(frame.viewProjection.value);
      state.commit();
      started = true;
    },
  };
}
