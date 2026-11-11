// 시간 누적 안티앨리어싱(TAA, 실험). avatar.json render.antialias = "taa"일 때만 씀 (기본은 MSAA + 1.5배 렌더 배율 그대로).
// 프레임마다 투영 행렬을 Halton(2,3) 서브픽셀만큼 밀어 장면을 그리고, 속도 버퍼로 이전 결과(히스토리)를 재투영해 섞음.
// 흐름: 장면 한 패스(MRT: 색 선형 HalfFloat + 속도, 깊이·스텐실 텍스처) → 해석(히스토리와 섞기) → 캔버스로 복사
// 속도는 재질마다 끼워 넣은 두 번째 출력이 씀(taa-velocity.ts). 장면 순회·그리기·uniform 업로드가 색과 함께 한 번
// 투명 재질은 확장 없이 블렌딩으로 처리: 첨부마다 그 출력 알파로 블렌드 계수를 계산하므로, 속도 출력 알파 = 자기 알파면
// 속도는 덮은 만큼 섞이고 알파에는 투명 덮임이 쌓여 반응성 마스크가 됨 (불투명은 블렌딩 없이 알파 0)
// 참고: Karis "High Quality Temporal Supersampling"(SIGGRAPH 2014: YCoCg 클램프, 3x3 가장 가까운 깊이의 속도),
// Pedersen "Temporal Reprojection Anti-Aliasing in INSIDE"(GDC 2016, Playdead MIT 코드: AABB 클리핑), Salvi(GDC 2016: 분산 클리핑),
// Catmull-Rom 5탭 히스토리 샘플링(MJP, MIT). 코드는 옮기지 않고 식을 다시 씀
import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { createVelocityOutputs } from "./taa-velocity.ts";
import type { Lifetime } from "./lifetime.ts";

/** 지터 표본 수 (Halton 수열 길이) */
export const TAA_SAMPLES = 8;
/** 히스토리 비중 (클수록 매끈하지만 변화가 늦게 반영됨) */
export const TAA_FEEDBACK = 0.9;
/** 투명 재질이 완전히 덮은 픽셀의 히스토리 비중 (속도가 없는 효과 재질의 잔상 줄임) */
export const TAA_REACTIVE_FEEDBACK = 0.5;
/** 지금 속도와 이전 위치의 지난 속도가 이만큼(픽셀/프레임) 다르면 히스토리를 버림 (가려졌다 드러난 곳: 깜빡임으로 드러나는 눈 등) */
export const TAA_VELOCITY_REJECT = 2;
/** 이 시간(ms)보다 프레임 간격이 벌어지면 히스토리를 버림 (탭 숨김·멈춤 뒤 낡은 화면 방지) */
export const TAA_RESET_GAP = 250;

/**
 * Halton 수열 값 (base 진법 자릿수를 소수점 뒤로 뒤집음)
 * @param index 1부터
 * @returns 0~1
 */
export function halton(index: number, base: number) {
  let fraction = 1, result = 0;
  for (let i = index; i > 0; i = Math.floor(i / base)) { fraction /= base; result += fraction * (i % base); }
  return result;
}

/**
 * 프레임 번호의 서브픽셀 지터 (Halton(2,3) 1~TAA_SAMPLES번째 − 0.5)
 * @returns 픽셀 단위 [x, y], 각 -0.5~0.5
 */
export const jitterOf = (frame: number): [number, number] => {
  const index = (frame % TAA_SAMPLES) + 1;
  return [halton(index, 2) - 0.5, halton(index, 3) - 0.5];
};

/**
 * 투영 행렬을 픽셀 단위 지터만큼 화면에서 밀기 (NDC 이동 = 2 × 지터 / 크기)
 * NDC 평행 이동을 앞에 곱함: 1·2행 += 이동 × 4행. 직교 투영은 4행이 (0,0,0,1)이라 평행 이동 칸만 바뀜
 * @param width·height 렌더 대상 픽셀 크기
 */
export function jitterProjection(matrix: THREE.Matrix4, jitter: [number, number], width: number, height: number) {
  const e = matrix.elements, dx = (2 * jitter[0]) / width, dy = (2 * jitter[1]) / height;
  for (let column = 0; column < 4; column++) {
    e[column * 4] += dx * e[column * 4 + 3];
    e[column * 4 + 1] += dy * e[column * 4 + 3];
  }
}

/** withJitter가 되돌릴 투영 행렬 (프레임마다 새로 만들지 않음) */
const saved = new THREE.Matrix4();
/**
 * 지터 투영으로 draw를 부르고 투영 행렬을 원래대로 되돌림 (선택·터치용 투영은 늘 지터 없음)
 */
export function withJitter(camera: THREE.Camera, jitter: [number, number], width: number, height: number, draw: () => void) {
  saved.copy(camera.projectionMatrix);
  jitterProjection(camera.projectionMatrix, jitter, width, height);
  try { draw(); } finally { camera.projectionMatrix.copy(saved); }
}

/** 히스토리 판정용 프레임 정보 (렌더 픽셀 크기, 시각 ms) */
export type TaaFrame = { width: number; height: number; time: number };
/**
 * 히스토리를 버릴지: 첫 프레임, 크기(배율) 변경, 시간이 거꾸로 가거나 TAA_RESET_GAP보다 벌어짐
 * @param last 지난 프레임 (없으면 첫 프레임)
 */
export const shouldResetHistory = (last: TaaFrame | null, next: TaaFrame) =>
  !last || last.width !== next.width || last.height !== next.height || next.time < last.time || next.time - last.time > TAA_RESET_GAP;

const QUAD_VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const RESOLVE_FRAGMENT = /* glsl */ `
// TAA 해석: 지금 색(선형, premultiplied)을 표시 인코딩(sRGB, premultiplied)으로 바꾸고,
// 3x3에서 가장 가까운 깊이 픽셀의 속도로 히스토리를 Catmull-Rom 재투영 → 이웃 YCoCg·알파 범위로 클리핑 → 섞기
// 이전 위치의 지난 속도가 지금 속도와 크게 다르면(다른 물체가 덮고 있던 곳) 히스토리 비중을 줄임 (SMAA T2x의 속도 가중과 같은 생각)
uniform sampler2D currentTexture;
uniform sampler2D velocityTexture;
uniform sampler2D prevVelocityTexture;
uniform float velocityReject;
uniform sampler2D depthTexture;
uniform sampler2D historyTexture;
uniform vec2 resolution;
uniform float feedback;
uniform float reactiveFeedback;

// 선형 → sRGB 전달 함수 (three.js sRGBTransferOETF와 같은 식)
vec3 srgbEncode( const in vec3 c ) {
  return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
}
// premultiplied 선형 → premultiplied sRGB: 알파를 나눠 인코딩하고 다시 곱함 (지금의 직접 그리기와 같은 값, 투명 경계 후광 없음)
vec4 toDisplay( const in vec4 c ) {
  if ( c.a <= 0.0 ) return vec4( 0.0 );
  return vec4( srgbEncode( clamp( c.rgb / c.a, 0.0, 1.0 ) ) * c.a, c.a );
}
vec4 toYCoCg( const in vec4 c ) {
  return vec4( dot( c.rgb, vec3( 0.25, 0.5, 0.25 ) ), dot( c.rgb, vec3( 0.5, 0.0, -0.5 ) ), dot( c.rgb, vec3( -0.25, 0.5, -0.25 ) ), c.a );
}
vec4 fromYCoCg( const in vec4 c ) {
  return vec4( c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z, c.a );
}
// 상자 가운데 쪽으로 잘라 상자 안으로 (Playdead clip_aabb와 같은 방식, 알파 포함 4차원)
vec4 clipToBox( const in vec4 q, const in vec4 lo, const in vec4 hi ) {
  vec4 center = 0.5 * ( hi + lo );
  vec4 extent = 0.5 * ( hi - lo ) + 1e-5;
  vec4 offset = q - center;
  vec4 unit = abs( offset / extent );
  float most = max( max( unit.x, unit.y ), max( unit.z, unit.w ) );
  return most > 1.0 ? center + offset / most : q;
}
// Catmull-Rom 5탭 (쌍선형 샘플 5번, 모서리 4탭 생략 후 가중치 합으로 나눔): 움직일 때 쌍선형보다 덜 흐려짐
vec4 sampleHistory( const in vec2 uv ) {
  vec2 position = uv * resolution;
  vec2 center = floor( position - 0.5 ) + 0.5;
  vec2 f = position - center;
  vec2 w0 = f * ( -0.5 + f * ( 1.0 - 0.5 * f ) );
  vec2 w1 = 1.0 + f * f * ( -2.5 + 1.5 * f );
  vec2 w2 = f * ( 0.5 + f * ( 2.0 - 1.5 * f ) );
  vec2 w3 = f * f * ( -0.5 + 0.5 * f );
  vec2 w12 = w1 + w2;
  vec2 p0 = ( center - 1.0 ) / resolution;
  vec2 p3 = ( center + 2.0 ) / resolution;
  vec2 p12 = ( center + w2 / w12 ) / resolution;
  vec4 sum = texture2D( historyTexture, vec2( p12.x, p0.y ) ) * w12.x * w0.y
    + texture2D( historyTexture, vec2( p0.x, p12.y ) ) * w0.x * w12.y
    + texture2D( historyTexture, p12 ) * w12.x * w12.y
    + texture2D( historyTexture, vec2( p3.x, p12.y ) ) * w3.x * w12.y
    + texture2D( historyTexture, vec2( p12.x, p3.y ) ) * w12.x * w3.y;
  return sum / ( w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y );
}

void main() {
  ivec2 pixel = ivec2( gl_FragCoord.xy );
  ivec2 last = ivec2( resolution ) - 1;
  vec4 center = vec4( 0.0 ), sum = vec4( 0.0 ), sumSq = vec4( 0.0 ), lo = vec4( 1e4 ), hi = vec4( -1e4 );
  float closest = 2.0;
  ivec2 closestPixel = pixel;
  for ( int y = -1; y <= 1; y ++ ) {
    for ( int x = -1; x <= 1; x ++ ) {
      ivec2 q = clamp( pixel + ivec2( x, y ), ivec2( 0 ), last );
      vec4 c = toYCoCg( toDisplay( texelFetch( currentTexture, q, 0 ) ) );
      if ( x == 0 && y == 0 ) center = c;
      sum += c; sumSq += c * c; lo = min( lo, c ); hi = max( hi, c );
      float depth = texelFetch( depthTexture, q, 0 ).r;
      if ( depth < closest ) { closest = depth; closestPixel = q; }
    }
  }
  // 분산 상자(평균 ± 표준편차)와 최소·최대 상자의 교집합
  vec4 mean = sum / 9.0;
  vec4 sigma = sqrt( max( sumSq / 9.0 - mean * mean, 0.0 ) );
  vec4 boxLo = max( lo, mean - sigma ), boxHi = min( hi, mean + sigma );
  vec2 uv = ( vec2( pixel ) + 0.5 ) / resolution;
  vec2 velocity = texelFetch( velocityTexture, closestPixel, 0 ).xy;
  vec2 prevUv = uv - velocity;
  vec2 prevVelocity = texelFetch( prevVelocityTexture, clamp( ivec2( prevUv * resolution ), ivec2( 0 ), last ), 0 ).xy;
  float weight = mix( feedback, min( feedback, reactiveFeedback ), texelFetch( velocityTexture, pixel, 0 ).a );
  weight *= clamp( 1.0 - length( ( velocity - prevVelocity ) * resolution ) / velocityReject, 0.0, 1.0 );
  if ( any( lessThan( prevUv, vec2( 0.0 ) ) ) || any( greaterThan( prevUv, vec2( 1.0 ) ) ) ) weight = 0.0;   // 이전 위치가 화면 밖: 히스토리 없음
  vec4 result = center;
  if ( weight > 0.0 ) result = mix( center, clipToBox( toYCoCg( sampleHistory( prevUv ) ), boxLo, boxHi ), weight );
  gl_FragColor = max( fromYCoCg( result ), 0.0 );
}
`;

const COPY_FRAGMENT = /* glsl */ `
// 히스토리(이미 premultiplied sRGB)를 그대로 캔버스로
uniform sampler2D sourceTexture;
void main() {
  gl_FragColor = texelFetch( sourceTexture, ivec2( gl_FragCoord.xy ), 0 );
}
`;

/** 전체 화면 패스 재질 (블렌딩·깊이 없음, 색 공간 변환은 셰이더가 직접) */
const passMaterial = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({ vertexShader: QUAD_VERTEX, fragmentShader, uniforms, blending: THREE.NoBlending, depthTest: false, depthWrite: false });

/** 깊이·스텐실 텍스처 (장면 깊이를 해석에서 읽음) */
const depthStencilTexture = () => {
  const texture = new THREE.DepthTexture(1, 1, THREE.UnsignedInt248Type);
  texture.format = THREE.DepthStencilFormat;
  return texture;
};
/**
 * TAA 렌더 대상 (모두 RGBA HalfFloat): 장면 2장(지금·지난, MRT textures[0] 색·[1] 속도 + 깊이·스텐실 텍스처), 히스토리 2장
 * 스텐실은 눈썹이 앞머리 위로 비치는 재질에 필요. 지난 장면의 속도는 속도 차이 배제에 씀
 */
function createTargets() {
  const color = { type: THREE.HalfFloatType, format: THREE.RGBAFormat };
  return {
    scene: [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { ...color, count: 2, depthBuffer: true, stencilBuffer: true, depthTexture: depthStencilTexture() })),
    history: [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { ...color, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })),
  };
}
type Targets = ReturnType<typeof createTargets>;
/** 모든 렌더 대상 목록 */
const allTargets = (targets: Targets) => [...targets.scene, ...targets.history];

/**
 * TAA 렌더러 만들기
 * @param renderer antialias: false로 만든 렌더러 (캔버스에는 해석 결과만 씀)
 * @param life 렌더 대상·재질 정리 등록
 * @returns render(장면, 카메라, 시각 ms): renderer.render 대신 매 프레임 부름
 */
export function createTaa(renderer: THREE.WebGLRenderer, life: Pick<Lifetime, "add">) {
  const targets = createTargets();
  const velocity = createVelocityOutputs(life);
  const resolve = passMaterial(RESOLVE_FRAGMENT, {
    currentTexture: { value: null }, velocityTexture: { value: null }, prevVelocityTexture: { value: null }, depthTexture: { value: null },
    historyTexture: { value: null }, velocityReject: { value: TAA_VELOCITY_REJECT }, resolution: { value: new THREE.Vector2() }, feedback: { value: TAA_FEEDBACK }, reactiveFeedback: { value: TAA_REACTIVE_FEEDBACK },
  });
  const copy = passMaterial(COPY_FRAGMENT, { sourceTexture: { value: null } });
  const quad = new FullScreenQuad();
  life.add(() => { for (const target of allTargets(targets)) { target.dispose(); target.depthTexture?.dispose(); } resolve.dispose(); copy.dispose(); quad.dispose(); });
  const size = new THREE.Vector2();
  let last: TaaFrame | null = null, frame = 0, read = 0, prepared = false;
  /** 전체 화면 패스 하나 그리기 */
  const draw = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) => { quad.material = material; renderer.setRenderTarget(target); quad.render(renderer); };
  return {
    render(scene: THREE.Scene, camera: THREE.Camera, time: number) {
      renderer.getDrawingBufferSize(size);
      const next = { width: size.x, height: size.y, time }, reset = shouldResetHistory(last, next);
      if (!last || last.width !== next.width || last.height !== next.height) for (const target of allTargets(targets)) target.setSize(size.x, size.y);
      last = next;
      frame = reset ? 0 : frame + 1;
      if (!prepared) { velocity.prepare(scene); prepared = true; }
      // read = 지난 프레임 것(히스토리·장면 속도), 1 - read = 이번 프레임에 쓰는 것
      const current = targets.scene[1 - read], uniforms = resolve.uniforms;
      velocity.begin(camera);
      withJitter(camera, jitterOf(frame), size.x, size.y, () => { renderer.setRenderTarget(current); renderer.render(scene, camera); });
      velocity.commit();
      uniforms.currentTexture.value = current.textures[0];
      uniforms.velocityTexture.value = current.textures[1];
      uniforms.depthTexture.value = current.depthTexture;
      uniforms.prevVelocityTexture.value = targets.scene[read].textures[1];
      uniforms.historyTexture.value = targets.history[read].texture;
      uniforms.feedback.value = reset ? 0 : TAA_FEEDBACK;
      uniforms.resolution.value.copy(size);
      resolve.uniformsNeedUpdate = true;
      draw(resolve, targets.history[1 - read]);
      copy.uniforms.sourceTexture.value = targets.history[1 - read].texture;
      draw(copy, null);
      read = 1 - read;
    },
  };
}
