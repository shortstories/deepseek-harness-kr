import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { halton, jitterOf, jitterProjection, withJitter, shouldResetHistory, TAA_SAMPLES, TAA_RESET_GAP } from '../../character/taa.ts'
import { boneTextureSize, morphBaseInfluence, createPrevFrameState, velocityDefines, injectVelocity, enableVelocity } from '../../character/taa-velocity.ts'
import { createOutlineMaterial, createToonMaterial } from '../../character/toon-material.ts'

// TAA(실험): 지터 수열·투영 지터 수식·투영 복원·히스토리 버림 판정·속도 출력(MRT)의 이전 프레임 상태·셰이더 끼워 넣기

const close = (actual, expected, eps = 1e-12) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≠ ${expected}`)

test('Halton 수열은 진법 자릿수를 소수점 뒤로 뒤집은 값이다', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => halton(i, 2)), [0.5, 0.25, 0.75, 0.125, 0.625])
  ;[[1, 1 / 3], [2, 2 / 3], [3, 1 / 9], [4, 4 / 9], [5, 7 / 9], [6, 2 / 9]].forEach(([i, v]) => close(halton(i, 3), v))
})

test('지터는 Halton(2,3) 1번째부터 − 0.5이고 TAA_SAMPLES마다 되풀이된다', () => {
  assert.deepEqual(jitterOf(0), [0, 1 / 3 - 0.5])
  assert.deepEqual(jitterOf(1), [-0.25, 2 / 3 - 0.5])
  assert.deepEqual(jitterOf(TAA_SAMPLES + 3), jitterOf(3))
  const seen = new Set()
  for (let i = 0; i < TAA_SAMPLES; i++) {
    const [x, y] = jitterOf(i)
    assert.ok(x >= -0.5 && x < 0.5 && y >= -0.5 && y < 0.5)
    seen.add(`${x},${y}`)
  }
  assert.equal(seen.size, TAA_SAMPLES)
})

test('투영 지터는 NDC에서 2×지터/크기만큼 민다 (직교는 평행 이동 칸만, 원근도 같은 화면 이동)', () => {
  const ortho = new THREE.OrthographicCamera(-150, 150, 150, -150, -10, 10)
  const before = ortho.projectionMatrix.clone()
  jitterProjection(ortho.projectionMatrix, [0.25, -0.4], 600, 400)
  const e = ortho.projectionMatrix.elements, b = before.elements
  close(e[12] - b[12], 2 * 0.25 / 600)
  close(e[13] - b[13], 2 * -0.4 / 400)
  for (let i = 0; i < 16; i++) if (i !== 12 && i !== 13) assert.equal(e[i], b[i])
  const perspective = new THREE.PerspectiveCamera(40, 1.5, 0.1, 100)
  const point = new THREE.Vector4(0.3, -0.2, -5, 1)
  const ndc = (m) => { const p = point.clone().applyMatrix4(m); return [p.x / p.w, p.y / p.w] }
  const [x0, y0] = ndc(perspective.projectionMatrix)
  jitterProjection(perspective.projectionMatrix, [0.5, 0.5], 800, 600)
  const [x1, y1] = ndc(perspective.projectionMatrix)
  close(x1 - x0, 1 / 800, 1e-9)
  close(y1 - y0, 1 / 600, 1e-9)
})

test('withJitter는 그리는 동안만 지터 투영이고 끝나면(예외여도) 원래 투영으로 되돌린다', () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const original = camera.projectionMatrix.clone()
  let inside = null
  withJitter(camera, [0.5, 0], 100, 100, () => { inside = camera.projectionMatrix.clone() })
  close(inside.elements[12] - original.elements[12], 0.01)
  assert.ok(camera.projectionMatrix.equals(original))
  assert.throws(() => withJitter(camera, [0.3, 0.3], 10, 10, () => { throw new Error('boom') }), /boom/)
  assert.ok(camera.projectionMatrix.equals(original))
})

test('히스토리는 첫 프레임·크기 변경·시간 역행·간격 초과 때만 버린다', () => {
  const frame = { width: 600, height: 600, time: 1000 }
  assert.equal(shouldResetHistory(null, frame), true)
  assert.equal(shouldResetHistory(frame, { ...frame, time: 1016.7 }), false)
  assert.equal(shouldResetHistory(frame, { ...frame, time: 1000 + TAA_RESET_GAP }), false)
  assert.equal(shouldResetHistory(frame, { ...frame, time: 1000 + TAA_RESET_GAP + 1 }), true)
  assert.equal(shouldResetHistory(frame, { ...frame, time: 900 }), true)
  assert.equal(shouldResetHistory(frame, { ...frame, width: 900, time: 1016 }), true)
  assert.equal(shouldResetHistory(frame, { ...frame, height: 300, time: 1016 }), true)
})

test('이전 뼈 텍스처 크기와 모프 바탕 가중치는 three.js와 같은 식이다', () => {
  for (const count of [1, 4, 17, 64, 65, 200]) {
    const skeleton = new THREE.Skeleton(Array.from({ length: count }, () => new THREE.Bone()))
    skeleton.computeBoneTexture()
    assert.equal(boneTextureSize(count), skeleton.boneTexture.image.width)
  }
  assert.equal(morphBaseInfluence(true, [0.3, 0.5]), 1)
  close(morphBaseInfluence(false, [0.3, 0.5]), 0.2)
})

/** 뼈 하나짜리 스킨 메시 (모프 가중치 2개) */
function skinnedMesh(skeleton, influences) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
  mesh.bind(skeleton)
  mesh.morphTargetInfluences = influences
  return mesh
}

test('이전 프레임 상태: commit 전까지 지난 값을 주고, 같은 스켈레톤·모프 배열은 메시끼리 같이 쓴다', () => {
  const bone = new THREE.Bone()
  bone.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton([bone])
  skeleton.update()
  const influences = [0.2, 0]
  const body = skinnedMesh(skeleton, influences), outline = skinnedMesh(skeleton, influences)
  const state = createPrevFrameState()
  const uniformsOf = () => ({ taaPrevModelMatrix: { value: new THREE.Matrix4() }, taaPrevBoneTexture: { value: null }, taaPrevMorphBase: { value: 0 }, taaPrevMorphInfluences: { value: null } })
  const a = uniformsOf(), b = uniformsOf()
  state.bind(a, body); state.bind(b, outline)
  assert.equal(a.taaPrevBoneTexture.value, b.taaPrevBoneTexture.value)
  assert.equal(a.taaPrevMorphInfluences.value, b.taaPrevMorphInfluences.value)
  close(a.taaPrevMorphInfluences.value[0], 0.2, 1e-7)
  close(a.taaPrevMorphBase.value, 0.8, 1e-7)   // 기본 BufferGeometry는 상대 모프가 아님 → 1 − 합
  // 다음 프레임: 뼈가 움직이고 모프가 바뀜 → commit 전에는 지난 값
  bone.position.set(1, 2, 3); bone.updateMatrixWorld(true); skeleton.update()
  influences[0] = 0.9
  body.position.set(5, 0, 0); body.updateMatrixWorld(true)
  state.bind(a, body)
  assert.equal(a.taaPrevBoneTexture.value.image.data[12], 0)
  close(a.taaPrevMorphInfluences.value[0], 0.2, 1e-7)
  assert.equal(a.taaPrevModelMatrix.value.elements[12], 0)
  state.commit()
  state.bind(a, body)
  assert.equal(a.taaPrevBoneTexture.value.image.data[12], 1)
  close(a.taaPrevMorphInfluences.value[0], 0.9, 1e-7)
  assert.equal(a.taaPrevModelMatrix.value.elements[12], 5)
  state.dispose()
})

test('속도 출력 define: 불투명은 속도만, 투명은 반응성(알파)과 블렌딩에 맞춘 속도 가중', () => {
  assert.match(velocityDefines(createToonMaterial({})), /TAA_MOTION_WEIGHT 1\.0/)
  assert.doesNotMatch(velocityDefines(createToonMaterial({})), /TAA_REACTIVE/)
  const blush = createToonMaterial({ transparent: true })
  assert.match(velocityDefines(blush), /#define TAA_REACTIVE\n#define TAA_MOTION_WEIGHT 1\.0/)   // NormalBlending: SRC_ALPHA가 속도를 덮은 만큼 섞음
  blush.premultipliedAlpha = true
  assert.match(velocityDefines(blush), /TAA_MOTION_WEIGHT gl_FragColor\.a/)                   // ONE 계수라 직접 곱함
  const additive = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending })
  assert.match(velocityDefines(additive), /TAA_REACTIVE\n#define TAA_MOTION_WEIGHT 0\.0/)
})

test('속도 출력 끼워 넣기: define은 맨 앞, 선언은 main 앞, 계산은 main 끝 (툰·외곽선·three.js 기본 재질 모두)', () => {
  const outline = createOutlineMaterial({ width: 0.01, widthAttribute: true })
  for (const source of [outline, createToonMaterial({}), { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader }]) {
    const shader = { vertexShader: source.vertexShader, fragmentShader: source.fragmentShader }
    injectVelocity(shader, '#define TAA_VELOCITY\n')
    for (const code of [shader.vertexShader, shader.fragmentShader]) {
      assert.ok(code.startsWith('#define TAA_VELOCITY\n'))
      const main = code.indexOf('void main()')
      assert.ok(code.indexOf('#ifdef TAA_VELOCITY') < main && code.lastIndexOf('#ifdef TAA_VELOCITY') > main)
      assert.ok(code.trimEnd().endsWith('#endif\n}'))
    }
    assert.ok(shader.fragmentShader.includes('layout( location = 1 ) out highp vec4 taaVelocity;'))
    assert.ok(shader.vertexShader.lastIndexOf('vTaaPrevClip =') > shader.vertexShader.lastIndexOf('#include <project_vertex>'))
  }
  // 원래 재질 셰이더는 그대로 (기본 MSAA 경로의 프로그램 유지)
  assert.ok(!createToonMaterial({}).vertexShader.includes('TAA'))
})

test('속도 출력 켜기: uniform을 셰이더에 더하고, 같은 재질을 다른 물체가 이어 그릴 때만 uniform을 다시 올린다', () => {
  const frame = { viewProjection: { value: new THREE.Matrix4() }, prevViewProjection: { value: new THREE.Matrix4() } }
  const state = createPrevFrameState()
  const material = createToonMaterial({})
  const before = material.customProgramCacheKey()
  const uniforms = enableVelocity(material, frame, state)
  assert.notEqual(material.customProgramCacheKey(), before)
  const shader = { uniforms: material.uniforms, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader }
  material.onBeforeCompile(shader)
  assert.equal(shader.uniforms.taaViewProjection, frame.viewProjection)
  assert.equal(shader.uniforms.taaPrevModelMatrix, uniforms.taaPrevModelMatrix)
  const a = new THREE.Mesh(), b = new THREE.Mesh()
  b.position.x = 3; b.updateMatrixWorld()
  const draw = (object) => material.onBeforeRender(null, null, null, null, object)
  draw(a)
  assert.equal(material.uniformsNeedUpdate, false)          // 프레임 첫 그리기: 재질이 바뀌어 three.js가 올림
  draw(a)
  assert.equal(material.uniformsNeedUpdate, false)
  draw(b)
  assert.equal(material.uniformsNeedUpdate, true)           // 같은 재질 이어 그리기: 이전 값이 다른 물체 것
  assert.equal(uniforms.taaPrevModelMatrix.value.elements[12], 3)
  material.uniformsNeedUpdate = false
  state.commit()
  draw(b)
  assert.equal(material.uniformsNeedUpdate, false)
})
