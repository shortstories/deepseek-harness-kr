// 3D 모델 정점 앰비언트 오클루전(AO) 굽기. 모델을 불러와 방향을 맞춘 직후(팔 내림·애니메이션 전, 기본 T자 자세) GPU로 한 번 굽고
// 결과(정점마다 0~255)는 툰 재질의 bakedAo 속성으로 씀(toon-material.ts TOON_BAKED_AO). 굽기 결과는 호스트 캐시 파일로 남김(plugin/avatar-cache.js).
// 방법(오프라인 굽기 도구식): 구 위 Fibonacci 방향마다 정사영 깊이 맵을 그리고, 정점 점 그리기로 그 방향이 막혔는지 누적한 뒤 한 번 읽음.
// 범위가 있는 오브스큐런스: 막는 면이 정점에서 그 방향으로 radius 안에 있을 때만(멀어질수록 약하게) 막힌 것으로 봄 → 몸 전체가 자기 몸에 어두워지지 않음.
import * as THREE from "three";
import { aoCacheMatches, decodeAoCache, encodeAoCache } from "../shared/ao-cache.js";
import { enableBakedAo, mapOf, type BakedAoUniforms } from "./toon-material.ts";

/** 굽기 방식 버전 (굽는 방법이 바뀌면 올려 예전 캐시를 버림, 굽기 설정 해시에 들어감) */
export const AO_BAKE_VERSION = 1;
/** avatar.json ao (rig-three.ts AvatarProfile.ao와 같은 모양) */
export type AoOption = { enabled?: boolean; strength?: number; shade?: number; radius?: number; directions?: number; resolution?: number; debug?: boolean };
/** 굽기 설정 (캐시 키에 들어가는 값): radius = 모델 키 대비 범위, directions = 방향 수, resolution = 깊이 맵 한 변 텍셀 */
export type AoBakeParams = { radius: number; directions: number; resolution: number };
/** 기본값: 세기 0.6, 그림자 쪽으로 미는 정도 0.3, 범위 키의 8%, 96방향, 1024² */
export const AO_DEFAULTS = { strength: 0.6, shade: 0.3, radius: 0.08, directions: 96, resolution: 1024 } as const;
/** 사용자 설정 중 AO 값 (설정 화면, rig-three.ts RigTuning) */
export type AoTuning = { ao?: boolean; aoStrength?: number };

/** 값 자르기 (숫자가 아니면 기본값) */
const clampOr = (value: unknown, lo: number, hi: number, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback;

/**
 * AO 켜짐 여부·굽기 설정·그림자 쪽으로 미는 정도·확인용 회색 보기: 설정 화면(avatarAo)이나 avatar.json ao.enabled 중 하나라도 켜면 켬
 * (모델 작성자가 avatar.json에서 켜 두면 설정과 상관없이 켜짐, 끈 기본값은 굽지도 재질을 바꾸지도 않음)
 * @param option avatar.json ao @param tuning 설정 화면 값
 */
export function aoSettingsOf(option: AoOption = {}, tuning: AoTuning = {}) {
  const params: AoBakeParams = {
    radius: clampOr(option.radius, 0.005, 0.5, AO_DEFAULTS.radius),
    directions: Math.round(clampOr(option.directions, 8, 512, AO_DEFAULTS.directions)),
    resolution: Math.round(clampOr(option.resolution, 128, 4096, AO_DEFAULTS.resolution)),
  };
  return { enabled: tuning.ao === true || option.enabled === true, params, shade: clampOr(option.shade, 0, 2, AO_DEFAULTS.shade), debug: option.debug === true };
}
/**
 * AO 세기 (0~1, 매 프레임): 설정 화면 값이 있으면 그것, 없으면 avatar.json ao.strength, 둘 다 없으면 0.6
 * @param option avatar.json ao @param tuning 설정 화면 값
 */
export const aoStrengthOf = (option: AoOption = {}, tuning: AoTuning = {}) => clampOr(tuning.aoStrength, 0, 1, clampOr(option.strength, 0, 1, AO_DEFAULTS.strength));

/**
 * 구 위에 고르게 퍼진 방향 (Fibonacci 나선, 각 방향이 같은 넓이를 맡아 가중치는 모두 같음)
 * @param count 방향 수 @returns xyz 반복 (길이 1)
 */
export function fibonacciDirections(count: number) {
  const out = new Float32Array(count * 3), golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * i + 1) / count, r = Math.sqrt(1 - y * y), phi = i * golden;
    out[i * 3] = Math.cos(phi) * r; out[i * 3 + 1] = y; out[i * 3 + 2] = Math.sin(phi) * r;
  }
  return out;
}

/**
 * 굽기 설정 해시 (FNV-1a 32비트 두 개 → 16진수 16자). 캐시 키·캐시 머리말 확인에 씀
 * @param params 굽기 설정 @param extra 결과에 영향을 주는 모델 설정 (숨김·기본 모프·재질 설정 등)
 */
export function aoParamsHash(params: AoBakeParams, extra: unknown = null) {
  const text = JSON.stringify({ version: AO_BAKE_VERSION, ...params, extra });
  let a = 0x811c9dc5, b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(text.length - 1 - i), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** 재질 목록 (한 재질이면 배열로) */
const materialsOf = (mesh: THREE.Mesh) => ([] as THREE.Material[]).concat(mesh.material);
/** AO를 받는 표면 재질인지: 보이고, 불투명하고, 외곽선이 아닌 툰 재질 */
export const isAoSurface = (material: THREE.Material) => {
  const shader = material as THREE.ShaderMaterial;
  return material.visible && !material.transparent && !!shader.uniforms?.shadingShift && !("OUTLINE" in (shader.defines || {}));
};
/** 노드와 모든 조상이 보이는지 */
const shownInScene = (node: THREE.Object3D | null) => {
  for (; node; node = node.parent) if (!node.visible) return false;
  return true;
};
/** 외곽선·그리는 순서 복제 메시 (본체 지오메트리를 같이 쓰거나 본체를 따라 그림) */
const isCopy = (mesh: THREE.Object3D) => mesh.name.endsWith("__outline") || mesh.name.includes("__order");

/**
 * AO를 굽고 받는 메시: 보이는 메시 중 복제가 아니고 불투명 표면 재질이 하나라도 있는 것 (같은 지오메트리는 한 번만)
 * 이 메시들이 막는 면이자 받는 면 (투명·숨김 재질 그룹은 막는 면에서 뺌)
 */
export function aoReceivers(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [], geometries = new Set<THREE.BufferGeometry>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || isCopy(mesh) || geometries.has(mesh.geometry) || !shownInScene(mesh) || !materialsOf(mesh).some(isAoSurface)) return;
    geometries.add(mesh.geometry);
    meshes.push(mesh);
  });
  return meshes;
}

const skinMatrix = new THREE.Matrix4(), boneMatrix = new THREE.Matrix4();
/**
 * 스킨 법선: 뼈 가중치로 섞은 행렬을 법선에 곱함 (three.js skinnormal_vertex와 같은 방식)
 * @param target 메시 지역 법선 (바로 고침)
 */
function skinNormal(mesh: THREE.SkinnedMesh, index: number, target: THREE.Vector3) {
  const skinIndex = mesh.geometry.getAttribute("skinIndex"), skinWeight = mesh.geometry.getAttribute("skinWeight");
  if (!skinIndex || !skinWeight) return target;
  skinMatrix.elements.fill(0);
  for (let k = 0; k < 4; k++) {
    const weight = skinWeight.getComponent(index, k), bone = mesh.skeleton.bones[skinIndex.getComponent(index, k)];
    if (!weight || !bone) continue;
    boneMatrix.multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[skinIndex.getComponent(index, k)]);
    for (let e = 0; e < 16; e++) skinMatrix.elements[e] += boneMatrix.elements[e] * weight;
  }
  return target.transformDirection(mesh.bindMatrix).transformDirection(skinMatrix).transformDirection(mesh.bindMatrixInverse);
}

/** 지금 자세의 정점 위치·법선 (월드, 모프는 지금 세기, 스킨은 지금 뼈) */
export type PosedVertices = { positions: Float32Array; normals: Float32Array };
/** 메시 정점을 지금 자세로 옮김 (getVertexPosition = 모프 + 스킨) */
export function posedVertices(mesh: THREE.Mesh): PosedVertices {
  const position = mesh.geometry.getAttribute("position"), normal = mesh.geometry.getAttribute("normal"), count = position.count;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for (let i = 0; i < count; i++) {
    mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
    if (normal) n.fromBufferAttribute(normal, i); else n.set(0, 0, 0);
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skinNormal(mesh as THREE.SkinnedMesh, i, n);
    n.applyMatrix3(normalMatrix).normalize().toArray(normals, i * 3);
  }
  return { positions, normals };
}

const DEPTH_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
// 깊이 맵: R = 가장 가까운 면(앞·뒷면 모두), G = 가장 가까운 뒷면(정점 쪽을 보는 면). 깊이 검사 대신 MIN 섞기
const DEPTH_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float alphaTest;
varying vec2 vUv;
void main() {
  #ifdef ALPHA_MAP
    if ( texture2D( map, vUv ).a < alphaTest ) discard;
  #endif
  float z = gl_FragCoord.z;
  gl_FragColor = vec4( z, gl_FrontFacing ? 1.0 : z, 1.0, 1.0 );
}`;
// 정점마다 한 점: 정점 번호 → 누적 텍셀. 방향이 법선 반구 안이면 cos 가중치로 (보임, 가중치) 더함
const GATHER_VERTEX = /* glsl */ `
uniform sampler2D depthMap;
uniform mat4 bakeViewProjection;
uniform vec3 bakeDirection;
uniform float depthRange;
uniform float radius;
uniform float normalBias;
uniform float depthBias;
uniform int gatherWidth;
uniform vec2 gatherSize;
varying vec2 vResult;
void main() {
  ivec2 texel = ivec2( gl_VertexID % gatherWidth, gl_VertexID / gatherWidth );
  gl_Position = vec4( ( vec2( texel ) + 0.5 ) / gatherSize * 2.0 - 1.0, 0.0, 1.0 );
  gl_PointSize = 1.0;
  vResult = vec2( 0.0 );
  vec3 n = normalize( normal );
  float cosine = dot( n, bakeDirection );
  if ( cosine <= 0.0 ) return;
  vec4 clip = bakeViewProjection * vec4( position + n * normalBias, 1.0 );
  vec3 ndc = clip.xyz / clip.w;
  float z = ndc.z * 0.5 + 0.5 - depthBias;
  vec2 nearest = texture2D( depthMap, ndc.xy * 0.5 + 0.5 ).rg;
  // 정점 쪽을 보는 뒷면이 앞에 있으면 그것이 가장 가까운 막는 면, 없으면 가장 앞 면
  float blocker = nearest.g < z ? nearest.g : nearest.r;
  float occlusion = blocker < z ? 1.0 - smoothstep( radius * 0.3, radius, ( z - blocker ) * depthRange ) : 0.0;
  vResult = vec2( cosine * ( 1.0 - occlusion ), cosine );
}`;
const GATHER_FRAGMENT = /* glsl */ `
varying vec2 vResult;
void main() { gl_FragColor = vec4( vResult, 0.0, 1.0 ); }`;
const RESOLVE_VERTEX = /* glsl */ `void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;
// 누적 (보임 합, 가중치 합) → AO = 보임 비율 (가중치가 없으면 1)
const RESOLVE_FRAGMENT = /* glsl */ `
uniform sampler2D gathered;
void main() {
  vec2 sum = texelFetch( gathered, ivec2( gl_FragCoord.xy ), 0 ).rg;
  gl_FragColor = vec4( vec3( sum.y > 0.0 ? sum.x / sum.y : 1.0 ), 1.0 );
}`;

/**
 * 막는 면 재질 (원래 재질마다): 알파 테스트 재질은 바탕 맵 알파로 잘라냄, 양면 모두 그림
 * @returns 표면 재질이 아니면 null (그 그룹은 막지 않음)
 */
function occluderMaterial(source: THREE.Material) {
  if (!isAoSurface(source)) return null;
  const map = mapOf(source), alpha = source.alphaTest > 0 && !!map;
  return new THREE.ShaderMaterial({
    vertexShader: DEPTH_VERTEX, fragmentShader: DEPTH_FRAGMENT, defines: alpha ? { ALPHA_MAP: "" } : {},
    uniforms: { map: { value: map }, alphaTest: { value: source.alphaTest } }, side: THREE.DoubleSide,
    depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.MinEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
}
const hidden = new THREE.MeshBasicMaterial({ visible: false });

/**
 * 막는 면 메시: 지금 자세 위치(월드)를 고정 위치로 쓰는 복사본 (스킨 없음). 좌우 반전 행렬이면 삼각형 감김을 뒤집어 앞뒷면을 맞춤
 * @param materials 원래 재질 → 막는 면 재질 (같은 재질은 한 번만 만듦)
 */
function occluderMesh(mesh: THREE.Mesh, posed: PosedVertices, materials: Map<THREE.Material, THREE.ShaderMaterial | null>) {
  const source = mesh.geometry, geometry = new THREE.BufferGeometry(), uv = source.getAttribute("uv");
  geometry.setAttribute("position", new THREE.BufferAttribute(posed.positions, 3));
  if (uv) geometry.setAttribute("uv", uv);
  const index = source.index ? Uint32Array.from(source.index.array) : Uint32Array.from({ length: posed.positions.length / 3 }, (_, i) => i);
  if (mesh.matrixWorld.determinant() < 0) for (let i = 0; i + 2 < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  const own = materialsOf(mesh).map((material) => {
    if (!materials.has(material)) materials.set(material, occluderMaterial(material));
    return materials.get(material) ?? hidden;
  });
  const out = new THREE.Mesh(geometry, Array.isArray(mesh.material) ? own : own[0]);
  out.frustumCulled = false;
  return out;
}

/** 굽기 준비물: 막는 면 장면, 정점 점 그리기, 경계 구 */
type BakeScene = { occluders: THREE.Scene; points: THREE.Points; center: THREE.Vector3; sphere: number; height: number; count: number; dispose(): void };
/**
 * 받는 메시들을 지금 자세로 옮겨 굽기 장면 만들기
 * @param smooth 같은 위치 법선 평균 (각진 면·쪼개진 정점에서도 AO가 이어지게, rig-three smoothOutlineNormals)
 */
function bakeScene(meshes: THREE.Mesh[], smooth: (positions: ArrayLike<number>, normals: ArrayLike<number>, tolerance: number) => Float32Array): BakeScene {
  const posed = meshes.map(posedVertices), occluders = new THREE.Scene(), materials = new Map<THREE.Material, THREE.ShaderMaterial | null>();
  meshes.forEach((mesh, i) => occluders.add(occluderMesh(mesh, posed[i], materials)));
  const count = posed.reduce((sum, each) => sum + each.positions.length / 3, 0);
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const box = new THREE.Box3();
  let offset = 0;
  for (const each of posed) { positions.set(each.positions, offset); offset += each.positions.length; }
  box.setFromArray(positions);
  const height = box.max.y - box.min.y, sphere = box.getBoundingSphere(new THREE.Sphere());
  offset = 0;
  for (const each of posed) { normals.set(smooth(each.positions, each.normals, height * 1e-5), offset); offset += each.normals.length; }
  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  pointsGeometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  const points = new THREE.Points(pointsGeometry);
  points.frustumCulled = false;
  return {
    occluders, points, center: sphere.center, sphere: sphere.radius * 1.01, height, count,
    dispose() {
      occluders.traverse((node) => { (node as THREE.Mesh).geometry?.dispose(); });
      for (const material of materials.values()) material?.dispose();
      pointsGeometry.dispose();
    },
  };
}

/** 굽기용 렌더 타깃 (가까운 텍셀, 깊이 버퍼 없음) */
const target = (width: number, height: number, type: THREE.TextureDataType) =>
  new THREE.WebGLRenderTarget(width, height, { type, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });

/** 방향 하나의 정사영 카메라: 경계 구에 맞춰 direction 쪽 바깥에서 가운데를 봄 */
function directionCamera(center: THREE.Vector3, sphere: number, direction: THREE.Vector3) {
  const camera = new THREE.OrthographicCamera(-sphere, sphere, sphere, -sphere, 0, sphere * 2);
  camera.up.set(0, 1, 0);
  if (Math.abs(direction.y) > 0.99) camera.up.set(1, 0, 0);
  camera.position.copy(center).addScaledVector(direction, sphere);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  return camera;
}

/** 렌더러 상태 보관·복구 (굽기는 장면 그리기 전에 한 번) */
function keepRendererState(renderer: THREE.WebGLRenderer) {
  const color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha(), autoClear = renderer.autoClear, target = renderer.getRenderTarget();
  return () => { renderer.setClearColor(color, alpha); renderer.autoClear = autoClear; renderer.setRenderTarget(target); };
}

/**
 * 정점 AO 굽기 (GPU): 방향마다 깊이 맵 → 정점 점 그리기로 누적 → 끝나고 한 번 읽음
 * @param meshes aoReceivers 결과 (지금 자세·모프 세기로 구움)
 * @param smooth 같은 위치 법선 평균 (rig-three smoothOutlineNormals)
 * @returns 메시마다 정점 AO (0~255, 255 = 막힘 없음)
 */
export function bakeAo(renderer: THREE.WebGLRenderer, meshes: THREE.Mesh[], params: AoBakeParams,
  smooth: (positions: ArrayLike<number>, normals: ArrayLike<number>, tolerance: number) => Float32Array) {
  const scene = bakeScene(meshes, smooth), restore = keepRendererState(renderer);
  const width = 1024, rows = Math.max(1, Math.ceil(scene.count / width));
  const depth = target(params.resolution, params.resolution, THREE.HalfFloatType);   // MIN 섞기는 반정밀도면 확장 없이 됨
  const gathered = target(width, rows, renderer.extensions.has("EXT_float_blend") ? THREE.FloatType : THREE.HalfFloatType);
  const resolved = target(width, rows, THREE.UnsignedByteType);
  const texel = scene.sphere * 2 / params.resolution;
  const uniforms = {
    depthMap: { value: depth.texture }, bakeViewProjection: { value: new THREE.Matrix4() }, bakeDirection: { value: new THREE.Vector3() },
    depthRange: { value: scene.sphere * 2 }, radius: { value: params.radius * scene.height }, normalBias: { value: texel * 1.5 }, depthBias: { value: 0.75 / params.resolution },
    gatherWidth: { value: width }, gatherSize: { value: new THREE.Vector2(width, rows) },
  };
  const gather = new THREE.ShaderMaterial({ vertexShader: GATHER_VERTEX, fragmentShader: GATHER_FRAGMENT, uniforms,
    depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
  scene.points.material = gather;
  const resolve = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: RESOLVE_VERTEX, fragmentShader: RESOLVE_FRAGMENT, uniforms: { gathered: { value: gathered.texture } }, depthTest: false, depthWrite: false }));
  resolve.frustumCulled = false;
  const pass = new THREE.Camera(), directions = fibonacciDirections(params.directions), direction = new THREE.Vector3();
  try {
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0); renderer.setRenderTarget(gathered); renderer.clear();
    for (let i = 0; i < params.directions; i++) {
      direction.fromArray(directions, i * 3);
      const camera = directionCamera(scene.center, scene.sphere, direction);
      renderer.setClearColor(0xffffff, 1); renderer.setRenderTarget(depth); renderer.clear(); renderer.render(scene.occluders, camera);
      uniforms.bakeViewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      uniforms.bakeDirection.value.copy(direction);
      renderer.setRenderTarget(gathered); renderer.render(scene.points, pass);
    }
    renderer.setRenderTarget(resolved); renderer.render(resolve, pass);
    const pixels = new Uint8Array(width * rows * 4);
    renderer.readRenderTargetPixels(resolved, 0, 0, width, rows, pixels);
    return splitByMesh(meshes, Uint8Array.from({ length: scene.count }, (_, i) => pixels[i * 4]));
  } finally {
    restore();
    for (const each of [depth, gathered, resolved]) each.dispose();
    gather.dispose(); (resolve.material as THREE.Material).dispose(); resolve.geometry.dispose(); scene.dispose();
  }
}

/** 이어 붙인 정점 AO를 메시마다 나눔 (메시 순서·정점 수대로) */
export function splitByMesh(meshes: Array<{ geometry: THREE.BufferGeometry }>, data: Uint8Array) {
  let offset = 0;
  return meshes.map((mesh) => { const count = mesh.geometry.getAttribute("position").count; offset += count; return data.subarray(offset - count, offset); });
}

/** 캐시 머리말용 메시 목록 (이름·정점 수) */
export const aoEntries = (meshes: THREE.Mesh[]) => meshes.map((mesh) => ({ name: mesh.name, count: mesh.geometry.getAttribute("position").count }));

/**
 * 캐시 파일 받기: 형식·설정 해시·메시 이름·정점 수가 모두 맞을 때만 씀
 * @param url 캐시 주소 (file·params 포함) @returns 메시마다 AO, 없거나 안 맞으면 null
 */
export async function loadAoCache(url: string, params: string, meshes: THREE.Mesh[]) {
  const response = await fetch(url);
  if (!response.ok) return null;
  const cache = decodeAoCache(new Uint8Array(await response.arrayBuffer()));
  return aoCacheMatches(cache, params, aoEntries(meshes)) ? splitByMesh(meshes, cache!.data) : null;
}

/**
 * 캐시 파일 저장 (덮어씀)
 * @returns 저장했으면 true
 */
export async function saveAoCache(url: string, params: string, meshes: THREE.Mesh[], data: Uint8Array[]) {
  const all = new Uint8Array(data.reduce((sum, each) => sum + each.length, 0));
  let offset = 0;
  for (const each of data) { all.set(each, offset); offset += each.length; }
  const response = await fetch(url, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: encodeAoCache({ params, meshes: aoEntries(meshes), data: all }) as Uint8Array<ArrayBuffer> });
  return response.ok;
}

/**
 * 구운 AO를 메시에 붙이고 표면 재질에 AO 기능을 켬 (외곽선·투명 재질은 그대로)
 * 받는 메시와 지오메트리를 같이 쓰는 그리는 순서 복제(__order)의 표면 재질도 켬 (같은 정점 AO)
 * AO 재질을 쓰는데 속성이 없는 메시(같은 재질을 쓰는 다른 메시)는 막힘 없음(255)으로 채워 검게 되지 않게 함
 * @param root 모델 장면 @param meshes aoReceivers 결과 @param data 메시마다 정점 AO
 * @param uniforms 같이 쓰는 AO uniform @param debug true면 AO만 회색으로 그림 (확인용)
 * @returns AO를 켠 재질 (실행 중 끄고 켤 때 씀)
 */
export function applyBakedAo(root: THREE.Object3D, meshes: THREE.Mesh[], data: Uint8Array[], uniforms: BakedAoUniforms, debug = false) {
  meshes.forEach((mesh, i) => mesh.geometry.setAttribute("bakedAo", new THREE.BufferAttribute(data[i], 1, true)));
  const baked = new Set(meshes.map((mesh) => mesh.geometry)), enabled = new Set<THREE.Material>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !baked.has(mesh.geometry)) return;
    for (const material of materialsOf(mesh)) if (isAoSurface(material) && !enabled.has(material)) { enableBakedAo(material as THREE.ShaderMaterial, uniforms, debug); enabled.add(material); }
  });
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || mesh.geometry.getAttribute("bakedAo") || !materialsOf(mesh).some((material) => enabled.has(material))) return;
    mesh.geometry.setAttribute("bakedAo", new THREE.BufferAttribute(new Uint8Array(mesh.geometry.getAttribute("position").count).fill(255), 1, true));
  });
  return enabled;
}
