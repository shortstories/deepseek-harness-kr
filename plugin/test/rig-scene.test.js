import test from 'node:test'
import assert from 'node:assert/strict'

/** FBXLoader 처럼 뼈마다 지역 변환 없는 같은 이름 복제 뼈를 겹겹이 붙이고, 메시마다 다른 복제 뼈를 가리키게 만든 모델 */
async function fbxLikeModel(THREE) {
  const model = new THREE.Group()
  const hips = new THREE.Bone(); hips.name = 'Hips'; hips.position.set(0, 1, 0)
  const hair = new THREE.Bone(); hair.name = 'Hair'; hair.position.set(0, 0.5, 0.1); hair.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3)
  model.add(hips); hips.add(hair)
  // 메시 3개 → 뼈마다 복제 2개 (원래 뼈 > 복제 > 복제, 원래 뼈의 실제 자식은 복제 뒤에 옴)
  const dupsOf = (bone) => { const a = new THREE.Bone(), b = new THREE.Bone(); a.name = b.name = bone.name; a.add(b); bone.children.unshift(a); a.parent = bone; return [a, b] }
  const [hipsA, hipsB] = dupsOf(hips), [hairA, hairB] = dupsOf(hair)
  model.updateMatrixWorld(true)
  const geometry = () => {
    const g = new THREE.BoxGeometry(0.1, 0.1, 0.1), n = g.attributes.position.count
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? (i / 4) % 2 : 0)), 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4))
    return g
  }
  const meshes = [[hips, hair], [hipsA, hairA], [hipsB, hairB]].map((bones) => { const m = new THREE.SkinnedMesh(geometry(), new THREE.MeshBasicMaterial()); model.add(m); m.bind(new THREE.Skeleton(bones)); return m })
  return { model, hips, hair, meshes }
}

test('FBX 복제 뼈 정리: 스켈레톤이 원래 뼈를 가리키고 복제 뼈는 떼어지며, 같은 스켈레톤은 합쳐지고 뼈 행렬은 그대로다', async () => {
  const THREE = await import('three')
  const { dedupeFbxBones } = await import('../../character/rig-three.ts')
  const { model, hips, hair, meshes } = await fbxLikeModel(THREE)
  const matricesBefore = meshes.map((m) => { m.skeleton.update(); return Array.from(m.skeleton.boneMatrices) })
  let bonesBefore = 0; model.traverse((n) => { if (n.isBone) bonesBefore++ })
  const result = dedupeFbxBones(model)
  let bonesAfter = 0; model.traverse((n) => { if (n.isBone) bonesAfter++ })
  assert.equal(bonesBefore, 6)
  assert.equal(bonesAfter, 2, '원래 뼈 Hips·Hair만 남음')
  assert.equal(result.removed, 4)
  for (const m of meshes) assert.deepEqual(m.skeleton.bones, [hips, hair])
  assert.equal(result.merged, 2, '역행렬이 같은 스켈레톤 3개 → 1개')
  assert.ok(meshes.every((m) => m.skeleton === meshes[0].skeleton))
  model.updateMatrixWorld(true)
  meshes.forEach((m, i) => { m.skeleton.update(); assert.deepEqual(Array.from(m.skeleton.boneMatrices), matricesBefore[i], '스키닝 뼈 행렬 같음') })
  assert.ok(hips.children.includes(hair), '실제 자식 뼈는 그대로')
})

test('복제 뼈 아래에 다른 노드가 있으면 떼지 않는다', async () => {
  const THREE = await import('three')
  const { dedupeFbxBones } = await import('../../character/rig-three.ts')
  const model = new THREE.Group(), bone = new THREE.Bone(), dup = new THREE.Bone(), extra = new THREE.Object3D()
  bone.name = dup.name = 'Head'; model.add(bone); bone.add(dup); dup.add(extra)
  assert.equal(dedupeFbxBones(model).removed, 0)
  assert.ok(bone.children.includes(dup))
})
