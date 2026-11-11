import test from 'node:test'
import assert from 'node:assert/strict'

test('모델 형식은 .vrm·.fbx만 받고(대소문자 무관), 다른 확장자·빈 값은 형식을 알려 주는 오류를 낸다', async () => {
  const { modelFormat } = await import('../../character/rig-three.ts')
  assert.equal(modelFormat('Seed-san.vrm'), 'vrm')
  assert.equal(modelFormat('Hayakawa_Aoi.FBX'), 'fbx')
  assert.equal(modelFormat(' sub/dir/model.vrm '), 'vrm')
  for (const bad of ['lacrimosa.glb', 'scene.gltf', 'model.vrma', 'noext', '', undefined]) {
    assert.throws(() => modelFormat(bad), /지원하는 모델 형식은 \.vrm·\.fbx/, String(bad))
  }
})
