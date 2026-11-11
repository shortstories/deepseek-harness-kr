import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { AO_DEFAULTS, aoParamsHash, aoReceivers, aoSettingsOf, aoStrengthOf, applyBakedAo, fibonacciDirections, loadAoCache, posedVertices, saveAoCache, splitByMesh } from '../../character/ao-bake.ts'
import { createBakedAoUniforms, createOutlineMaterial, createToonMaterial, enableBakedAo, toonDefines, toonUniforms } from '../../character/toon-material.ts'
import { restMorphs, restMorphWeights } from '../../character/rig-three.ts'
import { decodeAoCache, encodeAoCache } from '../../shared/ao-cache.js'

// 구운 AO: 방향·가중치, 설정 우선순위, 받는 메시 고르기, 재질 define·uniform, 캐시 주고받기

test('Fibonacci 방향은 길이 1로 구 전체에 고르게 퍼져, 어느 법선이든 반구 cos 가중치 합이 방향 수의 약 1/4이다', () => {
  for (const count of [32, 96, 256]) {
    const dirs = fibonacciDirections(count)
    assert.equal(dirs.length, count * 3)
    const mean = [0, 0, 0]
    for (let i = 0; i < count; i++) {
      assert.ok(Math.abs(Math.hypot(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]) - 1) < 1e-6)
      for (let k = 0; k < 3; k++) mean[k] += dirs[i * 3 + k] / count
    }
    assert.ok(Math.hypot(...mean) < 0.02, `평균 방향 ${mean}`)
    for (const normal of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0.48, -0.6, 0.64]]) {
      let weight = 0, inside = 0
      for (let i = 0; i < count; i++) { const cos = dirs[i * 3] * normal[0] + dirs[i * 3 + 1] * normal[1] + dirs[i * 3 + 2] * normal[2]; if (cos > 0) { weight += cos; inside++ } }
      assert.ok(Math.abs(weight / (count / 4) - 1) < 0.06, `cos 가중치 합 ${weight} (방향 ${count}, 법선 ${normal})`)
      assert.ok(Math.abs(inside / (count / 2) - 1) < 0.08, `반구 안 방향 ${inside}`)
    }
  }
})

test('AO는 기본 꺼짐이고 설정 화면이나 avatar.json 중 하나라도 켜면 켜지며, 세기는 설정 화면 값이 먼저다', () => {
  assert.equal(aoSettingsOf().enabled, false)
  assert.equal(aoSettingsOf({}, { ao: false }).enabled, false)
  assert.equal(aoSettingsOf({}, { ao: true }).enabled, true)
  assert.equal(aoSettingsOf({ enabled: true }, { ao: false }).enabled, true, '모델이 권하면 켜짐')
  assert.deepEqual(aoSettingsOf().params, { radius: AO_DEFAULTS.radius, directions: 96, resolution: 1024 })
  assert.deepEqual(aoSettingsOf({ radius: 9, directions: 1, resolution: 99999 }).params, { radius: 0.5, directions: 8, resolution: 4096 }, '범위 밖은 자름')
  assert.equal(aoSettingsOf({ shade: 0.5 }).shade, 0.5)
  assert.equal(aoSettingsOf().debug, false)
  assert.equal(aoStrengthOf(), 0.6)
  assert.equal(aoStrengthOf({ strength: 0.2 }), 0.2)
  assert.equal(aoStrengthOf({ strength: 0.2 }, { aoStrength: 0.9 }), 0.9)
  assert.equal(aoStrengthOf({}, { aoStrength: 3 }), 1)
  assert.equal(aoStrengthOf({ strength: Number.NaN }), 0.6)
})

test('굽기 설정 해시는 같은 설정이면 같고, 설정·모델 설정이 바뀌면 달라진다', () => {
  const params = { radius: 0.08, directions: 96, resolution: 1024 }
  const hash = aoParamsHash(params, { hide: ['a'] })
  assert.match(hash, /^[0-9a-f]{16}$/)
  assert.equal(aoParamsHash({ ...params }, { hide: ['a'] }), hash)
  assert.notEqual(aoParamsHash({ ...params, radius: 0.1 }, { hide: ['a'] }), hash)
  assert.notEqual(aoParamsHash({ ...params, directions: 64 }, { hide: ['a'] }), hash)
  assert.notEqual(aoParamsHash(params, { hide: ['b'] }), hash)
})

test('AO 기능은 기본 재질에 define·uniform이 없고, 켜면 표면 재질만 같은 uniform을 같이 쓴다', () => {
  assert.ok(!('TOON_BAKED_AO' in toonDefines({})))
  assert.ok(!('aoStrength' in toonUniforms({})))
  const plain = createToonMaterial({})
  assert.deepEqual(plain.defines, {})
  assert.ok(!('aoStrength' in plain.uniforms))
  const uniforms = createBakedAoUniforms(0.6, 0.3)
  const a = createToonMaterial({}), b = createToonMaterial({}), outline = createOutlineMaterial({ width: 1 })
  enableBakedAo(a, uniforms); enableBakedAo(b, uniforms, true); enableBakedAo(outline, uniforms)
  assert.deepEqual(Object.keys(a.defines), ['TOON_BAKED_AO'])
  assert.deepEqual(Object.keys(b.defines).sort(), ['TOON_BAKED_AO', 'TOON_BAKED_AO_DEBUG'])
  assert.equal(a.uniforms.aoStrength, uniforms.aoStrength, '같은 uniform 객체 (세기를 한 번 바꾸면 모두 반영)')
  assert.equal(b.uniforms.aoShade, uniforms.aoShade)
  assert.deepEqual(Object.keys(outline.defines), ['OUTLINE'], '외곽선은 AO 없음')
  assert.ok(!('aoStrength' in outline.uniforms))
  // 셰이더: AO를 끈 분기는 예전 간접광 줄을 그대로 둠
  assert.match(a.fragmentShader, /#else\s+reflectedLight\.indirectDiffuse \+= gi \* BRDF_Lambert\( material\.diffuseColor \);/)
})

/** 시험용 메시 (정점 n개, 툰 재질) */
const meshOf = (name, count = 3, material = createToonMaterial({})) => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3).map((_, i) => i), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  return mesh
}

test('받는 메시: 보이는 불투명 표면만, 외곽선·순서 복제와 숨긴 메시·같은 지오메트리는 빼고, 같은 재질을 쓰는 다른 메시는 막힘 없음으로 채운다', () => {
  const root = new THREE.Group()
  const body = meshOf('Body', 3), hair = meshOf('Hair', 2)
  const outline = new THREE.Mesh(body.geometry, createOutlineMaterial({ width: 1 })); outline.name = 'Body__outline'
  const order = new THREE.Mesh(body.geometry, createToonMaterial({})); order.name = 'Body__order2'
  const glass = meshOf('Glass', 2, createToonMaterial({ transparent: true }))
  const hidden = meshOf('Hidden', 2); hidden.visible = false
  const group = new THREE.Group(); group.visible = false; group.add(meshOf('InHiddenGroup', 2))
  const twin = new THREE.Mesh(hair.geometry, hair.material); twin.name = 'HairTwin'
  const sharer = meshOf('Sharer', 4, body.material); sharer.visible = false   // 숨겨 굽지 않지만 같은 재질
  root.add(body, hair, outline, order, glass, hidden, group, twin, sharer)
  const meshes = aoReceivers(root)
  assert.deepEqual(meshes.map((mesh) => mesh.name), ['Body', 'Hair'])
  const data = splitByMesh(meshes, Uint8Array.of(10, 20, 30, 40, 50))
  assert.deepEqual(data.map((each) => [...each]), [[10, 20, 30], [40, 50]])
  applyBakedAo(root, meshes, data, createBakedAoUniforms(0.6, 0.3))
  const ao = body.geometry.getAttribute('bakedAo')
  assert.equal(ao.normalized, true); assert.equal(ao.itemSize, 1); assert.deepEqual([...ao.array], [10, 20, 30])
  assert.equal(order.geometry.getAttribute('bakedAo'), ao, '순서 복제는 같은 속성')
  assert.ok('TOON_BAKED_AO' in order.material.defines, '순서 복제의 표면 재질도 켬')
  assert.ok('TOON_BAKED_AO' in body.material.defines)
  assert.ok(!('TOON_BAKED_AO' in glass.material.defines), '투명 재질은 그대로')
  assert.ok(!('TOON_BAKED_AO' in outline.material.defines))
  assert.deepEqual([...sharer.geometry.getAttribute('bakedAo').array], [255, 255, 255, 255])
  assert.equal(glass.geometry.getAttribute('bakedAo'), undefined)
})

test('굽기 전 모프는 모두 0에 baseMorphs만 (FBX 묶음 이름은 마지막 부분으로)', () => {
  const mesh = meshOf('Body')
  mesh.morphTargetDictionary = { 'Facials.Eye_Close': 0, 'Outfit.Roomwear_OFF': 1, Smile: 2 }
  mesh.morphTargetInfluences = [0.7, 0, 0.4]
  restMorphs([mesh, meshOf('NoMorph')], { Roomwear_OFF: 1, Smile: 2 })
  assert.deepEqual(mesh.morphTargetInfluences, [0, 1, 1])
  // 굽는 세기: 기본 모프 + 소품을 끈 상태 (invert 모프는 1 = 숨김, 아니면 0)
  assert.deepEqual(restMorphWeights({ baseMorphs: { Roomwear_OFF: 1 }, outfit: { glasses: [{ morph: 'Eyeglass_OFF', invert: true }], shoesOff: [{ morph: 'Shoes_OFF' }] } }),
    { Roomwear_OFF: 1, Eyeglass_OFF: 1 })
  assert.deepEqual(restMorphWeights({}), {})
})

test('지금 자세 정점: 월드 위치와 회전한 법선 (스킨이 없으면 모델 행렬만)', () => {
  const mesh = meshOf('Body', 2)
  mesh.position.set(1, 2, 3); mesh.rotation.z = Math.PI / 2; mesh.updateMatrixWorld(true)
  const { positions, normals } = posedVertices(mesh)
  const expected = new THREE.Vector3(3, 4, 5).applyMatrix4(mesh.matrixWorld)
  assert.ok(new THREE.Vector3().fromArray(positions, 3).distanceTo(expected) < 1e-5)
  assert.ok(new THREE.Vector3().fromArray(normals, 0).distanceTo(new THREE.Vector3(-1, 0, 0)) < 1e-6, '위 법선이 z축 90도 회전으로 -x')
})

test('캐시 주고받기: 맞는 파일만 쓰고, 경로가 없거나 메시가 다르면 다시 굽게 하며, 저장은 같은 형식으로 PUT', async () => {
  const meshes = [meshOf('Body', 3), meshOf('Hair', 2)]
  const saved = encodeAoCache({ params: 'p1', meshes: [{ name: 'Body', count: 3 }, { name: 'Hair', count: 2 }], data: Uint8Array.of(1, 2, 3, 4, 5) })
  const original = globalThis.fetch
  const calls = []
  try {
    globalThis.fetch = async (url, init = {}) => { calls.push({ url, init }); return url.includes('missing') ? new Response(null, { status: 404 }) : new Response(saved) }
    assert.deepEqual((await loadAoCache('/c?ok', 'p1', meshes)).map((each) => [...each]), [[1, 2, 3], [4, 5]])
    assert.equal(await loadAoCache('/c?missing', 'p1', meshes), null)
    assert.equal(await loadAoCache('/c?ok', 'p2', meshes), null, '설정 해시가 다름')
    assert.equal(await loadAoCache('/c?ok', 'p1', [meshOf('Body', 3), meshOf('Hair', 3)]), null, '정점 수가 다름 → 다시 굽기')
    assert.equal(await saveAoCache('/c?ok', 'p1', meshes, [Uint8Array.of(9, 8, 7), Uint8Array.of(6, 5)]), true)
    const put = calls.at(-1)
    assert.equal(put.init.method, 'PUT')
    const cache = decodeAoCache(put.init.body)
    assert.deepEqual(cache.meshes, [{ name: 'Body', count: 3 }, { name: 'Hair', count: 2 }])
    assert.deepEqual([...cache.data], [9, 8, 7, 6, 5])
    assert.equal(await saveAoCache('/c?missing', 'p1', meshes, [Uint8Array.of(9, 8, 7), Uint8Array.of(6, 5)]), false)
  } finally { globalThis.fetch = original }
})
