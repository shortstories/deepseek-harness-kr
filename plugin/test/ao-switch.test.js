import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createAoSwitch, restPoseRunner } from '../../character/rig-three.ts'
import { createBakedAoUniforms, createToonMaterial } from '../../character/toon-material.ts'

test('굽는 자세 감싸기는 기억한 자세·그때의 모프로 함수를 실행하고, 끝나면 실행 직전 자세·모프로 되돌린다', () => {
  const root = new THREE.Group(), arm = new THREE.Bone(), mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
  root.add(arm); root.add(mesh); mesh.morphTargetInfluences = [0, 0]
  const inRestPose = restPoseRunner(root)
  arm.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.2); arm.position.set(0, 2, 0); mesh.morphTargetInfluences[1] = 0.7
  const seen = inRestPose(() => { arm.updateMatrixWorld(); return { angle: arm.quaternion.angleTo(new THREE.Quaternion()), y: arm.position.y } })
  assert.ok(seen.angle < 1e-9, '굽는 동안 기억한 T자 자세')
  assert.equal(seen.y, 0)
  assert.ok(Math.abs(arm.quaternion.angleTo(new THREE.Quaternion()) - 1.2) < 1e-9, '끝나면 내린 팔 그대로')
  assert.equal(arm.position.y, 2)
  assert.equal(mesh.morphTargetInfluences[1], 0.7, '모프도 되돌림')
  assert.throws(() => inRestPose(() => { throw new Error('bake failed') }))
  assert.equal(arm.position.y, 2, '실패해도 되돌림')
})

test('AO 스위치는 처음 켤 때만 준비하고, 끄면 define만 빼며 다시 켜면 굽지 않고 되살린다', async () => {
  const material = createToonMaterial({}), uniforms = createBakedAoUniforms(0.6, 0.3)
  let calls = 0
  const prepare = async () => { calls++; material.defines.TOON_BAKED_AO = ''; Object.assign(material.uniforms, uniforms); return { uniforms, materials: new Set([material]) } }
  const ao = createAoSwitch(prepare)
  await ao.sync(false)
  assert.equal(calls, 0, '꺼져 있으면 굽지 않음')
  assert.equal(ao.uniforms, null)
  ao.sync(true); await ao.sync(true)
  assert.equal(calls, 1, '여러 프레임에 걸쳐 불러도 준비는 한 번')
  assert.equal(ao.uniforms, uniforms)
  ao.sync(false)
  assert.ok(!('TOON_BAKED_AO' in material.defines), '끄면 처음부터 끈 재질과 같은 define')
  assert.equal(ao.uniforms, null)
  ao.sync(true)
  assert.ok('TOON_BAKED_AO' in material.defines)
  assert.equal(calls, 1, '다시 켤 때 굽지 않음')
})

test('준비하는 사이 꺼지면 끝난 뒤 꺼진 상태로 맞추고, 준비가 실패하면 매 프레임 재시도하지 않고 껐다 켤 때만 다시 한다', async () => {
  const material = createToonMaterial({}), uniforms = createBakedAoUniforms(0.6, 0.3)
  const ao = createAoSwitch(async () => { material.defines.TOON_BAKED_AO = ''; return { uniforms, materials: new Set([material]) } })
  const pending = ao.sync(true); ao.sync(false); await pending
  assert.ok(!('TOON_BAKED_AO' in material.defines))
  assert.equal(ao.uniforms, null)
  let tries = 0
  const failing = createAoSwitch(async () => { tries++; return null })
  await failing.sync(true); await failing.sync(true); await failing.sync(true)
  assert.equal(tries, 1, '실패 뒤 켜진 채로는 다시 굽지 않음')
  failing.sync(false); await failing.sync(true)
  assert.equal(tries, 2, '껐다 켜면 한 번 더')
})

test('굽는 자세 감싸기는 matrixAutoUpdate가 꺼진 노드(three-vrm 흔들림 뼈)도 기억한 자세 행렬로 바꿨다 되돌린다', () => {
  const root = new THREE.Group(), spring = new THREE.Bone()
  root.add(spring); spring.matrixAutoUpdate = false; spring.updateMatrix()
  const inRestPose = restPoseRunner(root)
  spring.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.8); spring.updateMatrix(); root.updateMatrixWorld(true)
  const moved = spring.matrixWorld.clone()
  const during = inRestPose(() => spring.matrixWorld.clone())
  assert.ok(during.equals(new THREE.Matrix4()), '굽는 동안 기억한 자세의 월드 행렬')
  assert.ok(spring.matrixWorld.equals(moved), '끝나면 흔들린 자세 그대로')
})

test('재질에 AO 맵이 하나라도 있는 모델은 모델 AO를 쓴다(굽지 않음)', async () => {
  const { hasModelAo } = await import('../../character/rig-three.ts')
  assert.equal(hasModelAo({ materials: { Hair_M: { map: 'h.png', ao: 'h_ao.png' }, Face_M: { map: 'f.png' } } }), true)
  assert.equal(hasModelAo({ materials: { Face_M: { map: 'f.png' } } }), false)
  assert.equal(hasModelAo({}), false, 'VRM처럼 재질 설정이 없으면 자동 생성')
})
