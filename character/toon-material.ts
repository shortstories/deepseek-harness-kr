// 3D 모델용 툰 재질 (THREE.ShaderMaterial). 빛·그림자·림·외곽선 수식은 MToon(three-vrm, MIT License, © pixiv)의 셰이더를 따라 옮김.
// 얼굴 SDF 그림자와 UTS식 HighColor는 이 재질의 기능(define·uniform)으로 들어 있음.
// 옵션 이름은 VRM MToon 값(litFactor·shadeColorFactor·shadingShiftFactor 등)을 그대로 옮겨 담을 수 있게 맞춤.
import * as THREE from "three";

/** 얼굴 SDF 그림자 uniform (여러 재질이 같은 객체를 같이 쓰고 매 프레임 머리·빛 방향으로 문턱값·채널을 갱신) */
export type FaceSdfUniforms = {
  faceSdfMap: THREE.IUniform<THREE.Texture | null>; faceSdfThreshold: THREE.IUniform<number>;
  faceSdfUseR: THREE.IUniform<number>; faceSdfSoft: THREE.IUniform<number>;
};
/** UTS HighColor(스페큘러 하이라이트): power = 날카로움(0~1), mask = 마스크 맵(G), onShadow = 그림자 쪽 세기, strength = 전체 세기, toon = 경계가 딱 떨어지는 툰 모드 */
export type HighColorOptions = { color: THREE.ColorRepresentation; power?: number; mask?: THREE.Texture | null; onShadow?: number; strength?: number; toon?: boolean };
/** 림 라이트 (MToon parametric rim): fresnelPower = 가장자리에 모이는 정도, lift = 림을 안쪽까지 끌어올림, lightingMix = 조명 영향, map = 림(매트캡 포함)에 곱하는 마스크 맵 (MToon rimMultiplyTexture) */
export type RimOptions = { color?: THREE.ColorRepresentation; fresnelPower?: number; lift?: number; lightingMix?: number; map?: THREE.Texture | null };
/** 툰 재질 설정 (빠진 값은 MToon 기본값) */
export type ToonMaterialOptions = {
  name?: string;
  /** 바탕색(MToon litFactor)과 바탕 맵 */
  color?: THREE.ColorRepresentation; map?: THREE.Texture | null;
  /** 그늘 색(MToon shadeColorFactor)과 곱하는 그늘 맵 */
  shadeColor?: THREE.ColorRepresentation; shadeMap?: THREE.Texture | null;
  /** 그림자 경계 위치(-1~1)와 딱 떨어지는 정도(0~1) */
  shadingShift?: number; shadingToony?: number;
  /** 그림자 경계를 텍셀(R)×scale만큼 미는 맵 (MToon shadingShiftTexture, lilToon 그림자 마스크·AO 용도) */
  shadingShiftMap?: THREE.Texture | null; shadingShiftMapScale?: number;
  /** 간접광 방향 차이를 위·아래 평균으로 고르게 하는 정도 (빛 프로브·반구광이 있을 때만 차이남) */
  giEqualization?: number;
  rim?: RimOptions;
  /** UV 애니메이션의 지금 위치 (MToon uvAnimation): 스크롤 오프셋, 가운데 기준 회전(라디안). 바탕·그늘·경계 맵에 적용 */
  uvOffset?: [number, number]; uvRotation?: number;
  /** 얼굴 SDF 그림자 (createFaceSdfUniforms로 만든 공유 uniform) */
  faceSdf?: FaceSdfUniforms;
  highColor?: HighColorOptions;
  alphaTest?: number; transparent?: boolean; side?: THREE.Side;
  /** 불투명도 (MToon opacity, 기본 1) */
  opacity?: number;
  /** 접선 공간 노멀 맵과 세기 (MToon normalMap·normalScale, 접선은 화면 미분으로 구함) */
  normalMap?: THREE.Texture | null; normalScale?: THREE.Vector2;
  /** 발광 (MToon emissive·emissiveIntensity·emissiveMap): 조명과 무관하게 더함. emissive를 주면 켜짐 */
  emissive?: THREE.ColorRepresentation; emissiveIntensity?: number; emissiveMap?: THREE.Texture | null;
  /** 매트캡 (MToon matcapFactor·matcapTexture): 시선 기준 법선으로 읽어 림에 더함 */
  matcap?: { color?: THREE.ColorRepresentation; map: THREE.Texture };
  /** 맵마다 텍스처 변환(offset·repeat·rotation: KHR_texture_transform, VRM 표정 UV 바인드)을 적용. 값은 updateUvTransforms로 갱신 */
  uvTransforms?: boolean;
};
/**
 * 외곽선 재질 설정: width = 두께(월드 단위), widthAttribute = 정점 속성 outlineWidth를 두께에 곱함, lightingMix = 조명 영향
 * widthMap = 두께에 G 채널을 곱하는 맵 (MToon outlineWidthMultiplyTexture)
 */
export type OutlineMaterialOptions = ToonMaterialOptions & { width: number; outlineColor?: THREE.ColorRepresentation; lightingMix?: number; widthAttribute?: boolean; widthMap?: THREE.Texture | null };

/**
 * 얼굴 SDF 그림자 uniform 만들기
 * @param map SDF 맵 (R·G = 양쪽 빛용 문턱값, 색 공간 변환 없이 읽는 맵)
 * @param softness 경계 부드러움
 */
export const createFaceSdfUniforms = (map: THREE.Texture | null, softness = 0.02): FaceSdfUniforms => ({
  faceSdfMap: { value: map }, faceSdfThreshold: { value: 0.5 }, faceSdfUseR: { value: 1 }, faceSdfSoft: { value: softness },
});

/**
 * HighColor 설정 → uniform. 지수 = 2^(11-10×power) (UTS _HighColor_Power), 툰 경계 = 1-power⁵ (툰이 아니면 -1)
 */
export function highColorUniforms(spec: HighColorOptions) {
  const power = spec.power ?? 0.7;
  return {
    highColor: { value: new THREE.Color(spec.color) }, highColorExponent: { value: Math.pow(2, 11 - 10 * power) },
    highColorOnShadow: { value: spec.onShadow ?? 0.5 }, highColorMask: { value: spec.mask ?? null },
    highColorStrength: { value: spec.strength ?? 1 }, highColorToonEdge: { value: spec.toon ? 1 - Math.pow(power, 5) : -1 },
  };
}

/** 림 설정 → uniform (빠진 값은 MToon 기본값: 색 검정 = 림 없음, 지수 5, 끌어올림 0, 조명 영향 1) */
const rimUniforms = (rim: RimOptions = {}) => ({
  rimColor: { value: new THREE.Color(rim.color ?? 0x000000) }, rimFresnelPower: { value: rim.fresnelPower ?? 5 },
  rimLift: { value: rim.lift ?? 0 }, rimLightingMix: { value: rim.lightingMix ?? 1 },
});

/** 텍스처 uniform → 그 텍스처 변환 행렬 uniform (uvTransforms 기능) */
const UV_TRANSFORMS = [
  ["map", "mapUvTransform"], ["shadeMap", "shadeMapUvTransform"], ["shadingShiftMap", "shadingShiftMapUvTransform"], ["normalMap", "normalMapUvTransform"],
  ["emissiveMap", "emissiveMapUvTransform"], ["matcapMap", "matcapMapUvTransform"], ["outlineWidthMap", "outlineWidthMapUvTransform"],
  ["rimMap", "rimMapUvTransform"],
] as const;

/** 켠 기능에만 있는 uniform (노멀 맵·발광·매트캡·텍스처 변환). 끈 기능의 uniform은 만들지 않아 FBX 재질은 예전과 같음 */
function featureUniforms(options: OutlineMaterialOptions | ToonMaterialOptions): Record<string, THREE.IUniform> {
  const widthMap = (options as OutlineMaterialOptions).widthMap;
  return {
    ...options.normalMap && { normalMap: { value: options.normalMap }, normalScale: { value: (options.normalScale ?? new THREE.Vector2(1, 1)).clone() } },
    ...options.emissive !== undefined && { emissive: { value: new THREE.Color(options.emissive) }, emissiveIntensity: { value: options.emissiveIntensity ?? 1 }, emissiveMap: { value: options.emissiveMap ?? null } },
    ...options.matcap && { matcapColor: { value: new THREE.Color(options.matcap.color ?? 0xffffff) }, matcapMap: { value: options.matcap.map } },
    ...options.rim?.map && { rimMap: { value: options.rim.map } },
    ...widthMap && { outlineWidthMap: { value: widthMap } },
    ...options.uvTransforms && Object.fromEntries(UV_TRANSFORMS.map(([, transform]) => [transform, { value: new THREE.Matrix3() }])),
  };
}

/**
 * 텍스처 변환 행렬 uniform을 지금 텍스처의 offset·repeat·rotation으로 갱신 (MToon update()의 _updateTextureMatrix와 같음)
 * @param uniforms uvTransforms로 만든 툰 재질의 uniform
 */
export function updateUvTransforms(uniforms: Record<string, THREE.IUniform>) {
  for (const [map, transform] of UV_TRANSFORMS) {
    const texture = uniforms[map]?.value as THREE.Texture | null | undefined;
    if (!texture || !uniforms[transform]) continue;
    if (texture.matrixAutoUpdate) texture.updateMatrix();
    (uniforms[transform].value as THREE.Matrix3).copy(texture.matrix);
  }
}

/**
 * 툰 재질 설정 → uniform (three.js 조명·공통 uniform 포함, 빠진 값은 MToon 기본값)
 * 텍스처는 UniformsUtils.merge가 복제하지 않게 합친 뒤에 넣음. 얼굴 SDF uniform은 같은 객체를 그대로 씀
 */
export function toonUniforms(options: ToonMaterialOptions): Record<string, THREE.IUniform> {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.common, THREE.UniformsLib.lights]);
  Object.assign(uniforms, {
    diffuse: { value: new THREE.Color(options.color ?? 0xffffff) }, map: { value: options.map ?? null },
    shadeColor: { value: new THREE.Color(options.shadeColor ?? 0x000000) }, shadeMap: { value: options.shadeMap ?? null },
    shadingShift: { value: options.shadingShift ?? 0 }, shadingToony: { value: options.shadingToony ?? 0.9 },
    shadingShiftMap: { value: options.shadingShiftMap ?? null }, shadingShiftMapScale: { value: options.shadingShiftMapScale ?? 1 },
    giEqualization: { value: options.giEqualization ?? 0.9 },
    uvScrollOffset: { value: new THREE.Vector2(...(options.uvOffset ?? [0, 0])) }, uvRotationPhase: { value: options.uvRotation ?? 0 },
  }, rimUniforms(options.rim), options.highColor ? highColorUniforms(options.highColor) : {}, options.faceSdf ?? {}, featureUniforms(options));
  uniforms.alphaTest.value = options.alphaTest ?? 0;
  uniforms.opacity.value = options.opacity ?? 1;
  return uniforms;
}

/**
 * 셰이더 기능 define (켠 기능만). three.js는 define이 다르면 다른 프로그램으로 컴파일함
 * @param outline 외곽선 재질 설정 (외곽선이 아니면 없음)
 */
export function toonDefines(options: ToonMaterialOptions, outline?: Pick<OutlineMaterialOptions, "widthAttribute" | "widthMap">) {
  const flags: Record<string, boolean> = {
    TOON_MAP: !!options.map, TOON_SHADE_MAP: !!options.shadeMap, TOON_SHADING_SHIFT_MAP: !!options.shadingShiftMap,
    TOON_FACE_SDF: !!options.faceSdf, TOON_HIGHCOLOR: !!options.highColor, TOON_HIGHCOLOR_MASK: !!options.highColor?.mask,
    TOON_NORMAL_MAP: !!options.normalMap, TOON_EMISSIVE: options.emissive !== undefined, TOON_EMISSIVE_MAP: options.emissive !== undefined && !!options.emissiveMap,
    TOON_MATCAP: !!options.matcap, TOON_RIM_MAP: !!options.rim?.map, TOON_UV_TRANSFORM: !!options.uvTransforms,
    OUTLINE: !!outline, OUTLINE_WIDTH_ATTRIBUTE: !!outline?.widthAttribute, OUTLINE_WIDTH_MAP: !!outline?.widthMap,
  };
  return Object.fromEntries(Object.entries(flags).filter(([, on]) => on).map(([name]) => [name, ""]));
}

const VERTEX = /* glsl */ `
// 툰 재질 정점 셰이더 (MToon(three-vrm, MIT, © pixiv)의 정점·외곽선 계산을 따름)
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <normal_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vUv;
varying vec3 vViewPosition;
#ifdef TOON_UV_TRANSFORM
  #define TOON_UV( transform, base ) ( ( transform * vec3( base, 1.0 ) ).xy )
#else
  #define TOON_UV( transform, base ) ( base )
#endif
#ifdef TOON_BAKED_AO
  attribute float bakedAo;
  varying float vBakedAo;
#endif
#ifdef OUTLINE
  uniform float outlineWidthFactor;
  #ifdef OUTLINE_WIDTH_ATTRIBUTE
    attribute float outlineWidth;
  #endif
  #ifdef OUTLINE_WIDTH_MAP
    uniform sampler2D outlineWidthMap;
    #ifdef TOON_UV_TRANSFORM
      uniform mat3 outlineWidthMapUvTransform;
    #endif
  #endif
#endif

void main() {
  vUv = uv;
  #ifdef TOON_BAKED_AO
    vBakedAo = bakedAo;
  #endif
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  objectNormal = normalize( objectNormal );   // 외곽선 두께를 법선 길이와 무관하게
  #include <defaultnormal_vertex>
  #include <normal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
  vViewPosition = - mvPosition.xyz;
  #ifdef OUTLINE
    // 외곽선: 법선 방향으로 월드 단위 두께만큼 부풀림
    float worldNormalLength = length( transformedNormal );
    #ifdef OUTLINE_WIDTH_ATTRIBUTE
      vec3 outlineOffset = outlineWidthFactor * outlineWidth * worldNormalLength * objectNormal;
    #else
      vec3 outlineOffset = outlineWidthFactor * worldNormalLength * objectNormal;
    #endif
    #ifdef OUTLINE_WIDTH_MAP
      outlineOffset *= texture2D( outlineWidthMap, TOON_UV( outlineWidthMapUvTransform, vUv ) ).g;   // MToon 두께 맵(G)
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * vec4( outlineOffset + transformed, 1.0 );
    gl_Position.z += 1E-6 * gl_Position.w;   // 본체와 깊이가 겹쳐 깨지는 것 방지
  #endif
}
`;

const FRAGMENT = /* glsl */ `
// 툰 재질 조각 셰이더. getShading·그늘 섞기·림·외곽선 색은 MToon(three-vrm, MIT, © pixiv)의 수식을 따름
uniform vec3 diffuse;
uniform float opacity;
uniform vec3 shadeColor;
uniform float shadingShift;
uniform float shadingToony;
uniform float giEqualization;
uniform vec3 rimColor;
uniform float rimFresnelPower;
uniform float rimLift;
uniform float rimLightingMix;
uniform vec2 uvScrollOffset;
uniform float uvRotationPhase;
#ifdef TOON_MAP
  uniform sampler2D map;
#endif
#ifdef TOON_SHADE_MAP
  uniform sampler2D shadeMap;
#endif
#ifdef TOON_SHADING_SHIFT_MAP
  uniform sampler2D shadingShiftMap;
  uniform float shadingShiftMapScale;
#endif
#ifdef TOON_FACE_SDF
  uniform sampler2D faceSdfMap;
  uniform float faceSdfThreshold;
  uniform float faceSdfUseR;
  uniform float faceSdfSoft;
#endif
#ifdef TOON_HIGHCOLOR
  uniform vec3 highColor;
  uniform float highColorExponent;
  uniform float highColorOnShadow;
  uniform float highColorStrength;
  uniform float highColorToonEdge;
  #ifdef TOON_HIGHCOLOR_MASK
    uniform sampler2D highColorMask;
  #endif
#endif
#ifdef OUTLINE
  uniform vec3 outlineColor;
  uniform float outlineLightingMix;
#endif
#ifdef TOON_NORMAL_MAP
  uniform sampler2D normalMap;
  uniform vec2 normalScale;
#endif
#ifdef TOON_EMISSIVE
  uniform vec3 emissive;
  uniform float emissiveIntensity;
  #ifdef TOON_EMISSIVE_MAP
    uniform sampler2D emissiveMap;
  #endif
#endif
#ifdef TOON_MATCAP
  uniform vec3 matcapColor;
  uniform sampler2D matcapMap;
#endif
#ifdef TOON_RIM_MAP
  uniform sampler2D rimMap;
#endif
#ifdef TOON_BAKED_AO
  uniform float aoStrength;
  uniform float aoShade;
  varying float vBakedAo;
  // 구운 AO를 세기만큼 (1 = 막힘 없음)
  float bakedAoAmount() {
    return mix( 1.0, vBakedAo, aoStrength );
  }
#endif
// 맵마다 텍스처 변환 (MToon의 <맵>UvTransform과 같음). 끄면 UV 그대로
#ifdef TOON_UV_TRANSFORM
  uniform mat3 mapUvTransform;
  uniform mat3 shadeMapUvTransform;
  uniform mat3 shadingShiftMapUvTransform;
  uniform mat3 normalMapUvTransform;
  uniform mat3 emissiveMapUvTransform;
  uniform mat3 matcapMapUvTransform;
  uniform mat3 rimMapUvTransform;
  #define TOON_UV( transform, base ) ( ( transform * vec3( base, 1.0 ) ).xy )
#else
  #define TOON_UV( transform, base ) ( base )
#endif

#include <common>
#include <alphatest_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vUv;
varying vec3 vViewPosition;

struct ToonMaterial {
  vec3 diffuseColor;
  vec3 shadeColor;
  float shadingShift;
};

float linearstep( float a, float b, float t ) {
  return clamp( ( t - a ) / ( b - a ), 0.0, 1.0 );
}

// N·L → 밝은 쪽 비율 (shadingShift로 경계를 밀고 shadingToony로 경계 폭을 좁힘)
float getShading( const in float dotNL, const in float shift ) {
  return linearstep( -1.0 + shadingToony, 1.0 - shadingToony, dotNL + shift );
}

#ifdef TOON_FACE_SDF
  // 얼굴 SDF: 빛이 얼굴 정면에서 돌아간 각도(문턱값)로 SDF 맵을 잘라 경계를 정함. R·G가 모두 0인 곳(귀·목 등)은 원래 조명
  float faceSdfShading( const in float shading ) {
    vec3 sdfTexel = texture2D( faceSdfMap, vUv ).rgb;
    if ( max( sdfTexel.r, sdfTexel.g ) <= 0.02 ) return shading;
    float sdfValue = mix( sdfTexel.g, sdfTexel.r, faceSdfUseR );
    return smoothstep( faceSdfThreshold - faceSdfSoft, faceSdfThreshold + faceSdfSoft, sdfValue );
  }
#endif

#ifdef TOON_NORMAL_MAP
  // 화면 미분으로 만든 접선 공간 (MToon·three.js getTangentFrame과 같음, 모델에 접선 속성이 없어도 됨)
  mat3 toonTangentFrame( const in vec3 eyePos, const in vec3 surfNormal, const in vec2 mapUv ) {
    vec3 q0 = dFdx( eyePos.xyz );
    vec3 q1 = dFdy( eyePos.xyz );
    vec2 st0 = dFdx( mapUv.st );
    vec2 st1 = dFdy( mapUv.st );
    vec3 q1perp = cross( q1, surfNormal );
    vec3 q0perp = cross( surfNormal, q0 );
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float det = max( dot( T, T ), dot( B, B ) );
    float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
    return mat3( T * scale, B * scale, surfNormal );
  }
#endif

#ifdef TOON_HIGHCOLOR
  // UTS2 HighColor: half-Lambert(N·H)를 거듭제곱(툰이면 1 - power⁵에서 딱 끊음)해 빛 색·마스크와 곱함. 그림자 쪽은 onShadow만큼
  vec3 highColorLight( const in IncidentLight directLight, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in float shading ) {
    float highHalfLambert = 0.5 * dot( normalize( directLight.direction + geometryViewDir ), geometryNormal ) + 0.5;
    float highAmount = highColorToonEdge >= 0.0
      ? smoothstep( highColorToonEdge - 0.005, highColorToonEdge + 0.005, highHalfLambert )
      : pow( clamp( highHalfLambert, 0.0, 1.0 ), highColorExponent );
    #ifdef TOON_HIGHCOLOR_MASK
      highAmount *= texture2D( highColorMask, vUv ).g;
    #endif
    return highColor * directLight.color * highAmount * highColorStrength * mix( highColorOnShadow, 1.0, shading );
  }
#endif

void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  float dotNL = clamp( dot( geometryNormal, directLight.direction ), -1.0, 1.0 );
  reflectedLight.directSpecular += directLight.color;   // 림의 조명 섞기용 (실제 스페큘러 아님)
  float shading = getShading( dotNL, material.shadingShift );
  #ifdef TOON_FACE_SDF
    shading = faceSdfShading( shading );
  #endif
  #ifdef TOON_HIGHCOLOR
    reflectedLight.directDiffuse += highColorLight( directLight, geometryNormal, geometryViewDir, shading );
  #endif
  reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( mix( material.shadeColor, material.diffuseColor, shading ) );
}

// 방향에 따라 다른 간접광(빛 프로브·반구광)의 위·아래 평균 (GI equalization)
vec3 equalizedIrradiance() {
  vec3 up = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  vec3 sum = vec3( 0.0 );
  #if defined( USE_LIGHT_PROBES )
    sum += getLightProbeIrradiance( lightProbe, up ) + getLightProbeIrradiance( lightProbe, - up );
  #endif
  #if ( NUM_HEMI_LIGHTS > 0 )
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
      sum += getHemisphereLightIrradiance( hemisphereLights[ i ], up ) + getHemisphereLightIrradiance( hemisphereLights[ i ], - up );
    }
    #pragma unroll_loop_end
  #endif
  return getAmbientLightIrradiance( ambientLightColor ) + 0.5 * sum;
}

void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  vec3 gi = irradiance;
  #if defined( USE_LIGHT_PROBES ) || ( NUM_HEMI_LIGHTS > 0 )
    gi = mix( irradiance, equalizedIrradiance(), giEqualization );
  #endif
  #ifdef TOON_BAKED_AO
    reflectedLight.indirectDiffuse += gi * BRDF_Lambert( material.diffuseColor ) * bakedAoAmount();   // 막힌 만큼 간접광을 줄임
  #else
    reflectedLight.indirectDiffuse += gi * BRDF_Lambert( material.diffuseColor );   // 간접광은 그늘 색 없이 바탕색만
  #endif
  reflectedLight.directSpecular += gi;
}

#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon

void main() {
  #include <clipping_planes_fragment>
  // UV 애니메이션 위치 (MToon과 같이 바탕·그늘·경계 맵에만): 가운데 기준 회전 후 스크롤
  float uvRotCos = cos( uvRotationPhase );
  float uvRotSin = sin( uvRotationPhase );
  vec2 uv = mat2( uvRotCos, -uvRotSin, uvRotSin, uvRotCos ) * ( vUv - 0.5 ) + 0.5;
  uv = uv + uvScrollOffset;
  vec4 diffuseColor = vec4( diffuse, opacity );
  ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
  #ifdef TOON_MAP
    diffuseColor *= texture2D( map, TOON_UV( mapUvTransform, uv ) );
  #endif
  #include <alphatest_fragment>

  vec3 normal = normalize( vNormal );
  #ifdef DOUBLE_SIDED
    normal *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  #ifdef TOON_NORMAL_MAP
    // 접선 공간은 뒤집기 전 법선으로 (MToon과 같은 순서: 외곽선이면 노멀 맵 법선이 뒤집기를 덮어씀)
    vec2 normalMapUv = TOON_UV( normalMapUvTransform, uv );
    mat3 tbn = toonTangentFrame( - vViewPosition, normal, normalMapUv );
    #ifdef DOUBLE_SIDED
      tbn[0] *= gl_FrontFacing ? 1.0 : -1.0;
      tbn[1] *= gl_FrontFacing ? 1.0 : -1.0;
    #endif
  #endif
  #ifdef OUTLINE
    normal *= -1.0;   // 뒤집어 그린 면의 법선을 바깥쪽으로 되돌림
  #endif
  #ifdef TOON_NORMAL_MAP
    vec3 mapN = texture2D( normalMap, normalMapUv ).xyz * 2.0 - 1.0;
    mapN.xy *= normalScale;
    normal = normalize( tbn * mapN );
  #endif

  ToonMaterial material;
  material.diffuseColor = diffuseColor.rgb;
  material.shadeColor = shadeColor;
  #ifdef TOON_SHADE_MAP
    material.shadeColor *= texture2D( shadeMap, TOON_UV( shadeMapUvTransform, uv ) ).rgb;
  #endif
  material.shadingShift = shadingShift;
  #ifdef TOON_SHADING_SHIFT_MAP
    material.shadingShift += texture2D( shadingShiftMap, TOON_UV( shadingShiftMapUvTransform, uv ) ).r * shadingShiftMapScale;
  #endif
  #ifdef TOON_BAKED_AO
    material.shadingShift -= aoShade * ( 1.0 - bakedAoAmount() );   // 막힌 곳은 그림자 쪽으로 (AO 맵을 그림자 경계 맵으로 쓰는 것과 같은 효과)
  #endif

  #include <lights_fragment_begin>
  #include <lights_fragment_maps>
  #include <lights_fragment_end>
  vec3 col = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;

  // 림: 시선과 법선이 비껴갈수록 밝게, 받은 빛(직접 + 간접)을 rimLightingMix만큼 곱함
  vec3 viewDir = normalize( vViewPosition );
  reflectedLight.directSpecular /= PI;
  vec3 rimMix = mix( vec3( 1.0 ), reflectedLight.directSpecular, rimLightingMix );
  vec3 rim = rimColor * pow( saturate( 1.0 - dot( viewDir, normal ) + rimLift ), rimFresnelPower );
  #ifdef TOON_MATCAP
    // 매트캡: 시선에 수직인 두 축으로 법선을 투영한 구면 UV (MToon과 같음)
    vec3 matcapX = normalize( vec3( viewDir.z, 0.0, -viewDir.x ) );
    vec3 matcapY = cross( viewDir, matcapX );
    vec2 sphereUv = 0.5 + 0.5 * vec2( dot( matcapX, normal ), -dot( matcapY, normal ) );
    rim += matcapColor * texture2D( matcapMap, TOON_UV( matcapMapUvTransform, sphereUv ) ).rgb;
  #endif
  #ifdef TOON_RIM_MAP
    // 림 마스크: 림·매트캡을 이 맵의 색만큼만 (MToon rimMultiplyTexture, 머리카락 등 가장자리 밝힘을 고를 때)
    rim *= texture2D( rimMap, TOON_UV( rimMapUvTransform, uv ) ).rgb;
  #endif
  col += rimMix * rim;

  #ifdef TOON_EMISSIVE
    vec3 totalEmissive = emissive * emissiveIntensity;
    #ifdef TOON_EMISSIVE_MAP
      totalEmissive *= texture2D( emissiveMap, TOON_UV( emissiveMapUvTransform, uv ) ).rgb;
    #endif
    col += totalEmissive;
  #endif

  #ifdef OUTLINE
    col = outlineColor * mix( vec3( 1.0 ), col, outlineLightingMix );
  #endif
  #ifdef TOON_BAKED_AO_DEBUG
    col = vec3( vBakedAo * vBakedAo );   // 확인용: AO만 회색으로 (출력 sRGB 변환을 대략 되돌려 화면 밝기 ≈ AO 값)
  #endif
  #ifdef OPAQUE
    diffuseColor.a = 1.0;
  #endif
  gl_FragColor = vec4( col, diffuseColor.a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}
`;

/**
 * 툰 재질 만들기 (스키닝·모프 위치·모프 법선·클리핑·알파 테스트·색 공간·톤 매핑은 three.js 셰이더 조각 그대로)
 * @param defines 기능 define (외곽선이면 외곽선 define 포함)
 */
function buildMaterial(options: ToonMaterialOptions, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string>) {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, defines, lights: true, clipping: true,
    transparent: !!options.transparent, alphaTest: options.alphaTest ?? 0, side: options.side ?? THREE.FrontSide,
  });
  material.name = options.name ?? "";
  return material;
}

/** 표면 툰 재질 만들기 */
export const createToonMaterial = (options: ToonMaterialOptions = {}) => buildMaterial(options, toonUniforms(options), toonDefines(options));

/**
 * 외곽선 재질 만들기: 뒷면만 법선 방향으로 부풀려 그리고, 표면 조명 결과를 lightingMix만큼 외곽선 색에 곱함
 * 표면 설정(map·alphaTest 등)은 툰 재질과 같고, 빠진 값은 MToon 기본값
 */
export function createOutlineMaterial(options: OutlineMaterialOptions) {
  const uniforms = toonUniforms(options);
  Object.assign(uniforms, {
    outlineWidthFactor: { value: options.width }, outlineColor: { value: new THREE.Color(options.outlineColor ?? 0x000000) },
    outlineLightingMix: { value: options.lightingMix ?? 1 },
  });
  return buildMaterial({ ...options, side: THREE.BackSide }, uniforms, toonDefines(options, options));
}

/** 구운 AO uniform (여러 재질이 같은 객체를 같이 쓰고 매 프레임 설정 화면 세기로 갱신): aoStrength = 세기(0~1), aoShade = 막힌 만큼 그림자 쪽으로 미는 정도 */
export type BakedAoUniforms = { aoStrength: THREE.IUniform<number>; aoShade: THREE.IUniform<number> };
/** 구운 AO uniform 만들기 */
export const createBakedAoUniforms = (strength: number, shade: number): BakedAoUniforms => ({ aoStrength: { value: strength }, aoShade: { value: shade } });
/**
 * 표면 툰 재질에 구운 AO 켜기 (TOON_BAKED_AO: 정점 속성 bakedAo로 간접광을 줄이고 그림자 경계를 밈). 처음 그리기 전에 불러야 함
 * 켜지 않은 재질은 define·uniform이 그대로라 예전과 같은 프로그램. 외곽선 재질은 켜지 않음
 * @param uniforms 같이 쓰는 AO uniform @param debug true면 AO만 회색으로 그림 (TOON_BAKED_AO_DEBUG, 확인용)
 */
export function enableBakedAo(material: THREE.ShaderMaterial, uniforms: BakedAoUniforms, debug = false) {
  if ("OUTLINE" in material.defines) return;
  material.defines.TOON_BAKED_AO = "";
  if (debug) material.defines.TOON_BAKED_AO_DEBUG = "";
  Object.assign(material.uniforms, uniforms);
  material.needsUpdate = true;
}

/**
 * 구운 AO 끄기: enableBakedAo로 넣은 define을 빼 처음부터 AO를 끈 재질과 같은 프로그램으로 다시 컴파일 (uniform·정점 속성은 남겨 다시 켤 때 굽지 않음)
 */
export function disableBakedAo(material: THREE.ShaderMaterial) {
  if (!("TOON_BAKED_AO" in material.defines)) return;
  delete material.defines.TOON_BAKED_AO;
  delete material.defines.TOON_BAKED_AO_DEBUG;
  material.needsUpdate = true;
}

/** 재질의 바탕 맵 (툰 재질은 uniform, three.js 기본 재질은 map 속성) */
export const mapOf = (material: THREE.Material): THREE.Texture | null =>
  (material as THREE.MeshBasicMaterial).map ?? (material as THREE.ShaderMaterial).uniforms?.map?.value ?? null;
