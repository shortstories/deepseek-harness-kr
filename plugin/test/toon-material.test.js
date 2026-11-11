import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createFaceSdfUniforms, createOutlineMaterial, createToonMaterial, highColorUniforms, mapOf, toonDefines } from '../../character/toon-material.ts'
import { toonOptionsOf } from '../../character/rig-three.ts'

// 3D 모델은 MToon 대신 자체 툰 재질로 그린다: 설정 → uniform·define 대응과 avatar.json 호환을 확인

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`)

test('HighColor 지수는 2^(11-10×power), 툰 경계는 1-power⁵이고 툰이 아니면 -1이다', () => {
  close(highColorUniforms({ color: '#ffffff', power: 1 }).highColorExponent.value, 2)
  close(highColorUniforms({ color: '#ffffff', power: 0.5 }).highColorExponent.value, 64)
  close(highColorUniforms({ color: '#ffffff' }).highColorExponent.value, Math.pow(2, 4))   // 기본 power 0.7
  close(highColorUniforms({ color: '#ffffff', power: 0.8, toon: true }).highColorToonEdge.value, 1 - Math.pow(0.8, 5))
  assert.equal(highColorUniforms({ color: '#ffffff', power: 0.8 }).highColorToonEdge.value, -1)
  const defaults = highColorUniforms({ color: '#ffffff' })
  assert.equal(defaults.highColorOnShadow.value, 0.5)
  assert.equal(defaults.highColorStrength.value, 1)
  assert.equal(defaults.highColorMask.value, null)
})

test('기능 define은 켠 기능만 들어간다', () => {
  assert.deepEqual(toonDefines({}), {})
  const map = new THREE.Texture()
  assert.deepEqual(Object.keys(toonDefines({ map, shadeMap: map, shadingShiftMap: map })).sort(), ['TOON_MAP', 'TOON_SHADE_MAP', 'TOON_SHADING_SHIFT_MAP'])
  assert.ok('TOON_FACE_SDF' in toonDefines({ faceSdf: createFaceSdfUniforms(map) }))
  assert.ok(!('TOON_FACE_SDF' in toonDefines({})))
  assert.deepEqual(Object.keys(toonDefines({ highColor: { color: '#fff' } })), ['TOON_HIGHCOLOR'])
  assert.deepEqual(Object.keys(toonDefines({ highColor: { color: '#fff', mask: map } })).sort(), ['TOON_HIGHCOLOR', 'TOON_HIGHCOLOR_MASK'])
  assert.deepEqual(Object.keys(toonDefines({}, {})), ['OUTLINE'])
  assert.deepEqual(Object.keys(toonDefines({}, { widthAttribute: true })).sort(), ['OUTLINE', 'OUTLINE_WIDTH_ATTRIBUTE'])
})

test('기능 묶음이 다르면 셰이더 프로그램 키(define)가 다르고 같으면 같다', () => {
  const sdf = createFaceSdfUniforms(null)
  const keyOf = (material) => JSON.stringify(material.defines)
  const keys = [
    createToonMaterial({}), createToonMaterial({ faceSdf: sdf }), createToonMaterial({ highColor: { color: '#fff' } }),
    createOutlineMaterial({ width: 1 }), createOutlineMaterial({ width: 1, widthAttribute: true }),
  ].map(keyOf)
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(keyOf(createToonMaterial({ faceSdf: sdf })), keyOf(createToonMaterial({ faceSdf: createFaceSdfUniforms(null) })))
})

test('빠진 값은 MToon 기본값이고 조명·클리핑을 쓰는 ShaderMaterial이다', () => {
  const material = createToonMaterial()
  const u = material.uniforms
  assert.ok(material.isShaderMaterial && material.lights && material.clipping)
  assert.deepEqual(u.diffuse.value.toArray(), [1, 1, 1])
  assert.deepEqual(u.shadeColor.value.toArray(), [0, 0, 0])
  assert.equal(u.shadingShift.value, 0)
  assert.equal(u.shadingToony.value, 0.9)
  assert.equal(u.giEqualization.value, 0.9)
  assert.deepEqual(u.rimColor.value.toArray(), [0, 0, 0])
  assert.equal(u.rimFresnelPower.value, 5)
  assert.equal(u.rimLift.value, 0)
  assert.equal(u.rimLightingMix.value, 1)
  assert.deepEqual(u.uvScrollOffset.value.toArray(), [0, 0])
  assert.equal(u.uvRotationPhase.value, 0)
  assert.deepEqual(createToonMaterial({ uvOffset: [0.25, -0.5], uvRotation: 1 }).uniforms.uvScrollOffset.value.toArray(), [0.25, -0.5])
  assert.ok('directionalLights' in u && 'ambientLightColor' in u)
  assert.equal(material.side, THREE.FrontSide)
  assert.equal(material.transparent, false)
})

test('텍스처는 복제하지 않고, 얼굴 SDF uniform은 재질끼리 같은 객체를 쓴다', () => {
  const map = new THREE.Texture(), sdf = createFaceSdfUniforms(map, 0.05)
  const a = createToonMaterial({ map, faceSdf: sdf }), b = createToonMaterial({ faceSdf: sdf })
  assert.equal(a.uniforms.map.value, map)
  assert.equal(mapOf(a), map)
  assert.equal(a.uniforms.faceSdfThreshold, b.uniforms.faceSdfThreshold)
  sdf.faceSdfThreshold.value = 0.25
  assert.equal(b.uniforms.faceSdfThreshold.value, 0.25)
  assert.equal(sdf.faceSdfSoft.value, 0.05)
  assert.equal(createFaceSdfUniforms(null).faceSdfSoft.value, 0.02)
})

test('알파 테스트는 재질 값과 uniform이 같고, 외곽선은 뒷면·두께·색·조명 영향을 갖는다', () => {
  const map = new THREE.Texture()
  const outline = createOutlineMaterial({ width: 0.002, outlineColor: '#000000', lightingMix: 0.3, map, alphaTest: 0.5 })
  assert.equal(outline.side, THREE.BackSide)
  assert.equal(outline.alphaTest, 0.5)
  assert.equal(outline.uniforms.alphaTest.value, 0.5)
  assert.equal(outline.uniforms.outlineWidthFactor.value, 0.002)
  assert.equal(outline.uniforms.outlineLightingMix.value, 0.3)
  assert.equal(mapOf(outline), map)
  assert.equal(createOutlineMaterial({ width: 1 }).uniforms.outlineLightingMix.value, 1)
  // three.js 기본 재질(모델 원래 재질)의 map도 읽는다
  assert.equal(mapOf(new THREE.MeshPhongMaterial({ map })), map)
  assert.equal(mapOf(new THREE.MeshPhongMaterial()), null)
})

test('avatar.json 재질 설정은 이전 MToon 렌더와 같은 값으로 옮겨진다', () => {
  const loaded = []
  const texture = (file, linear = false) => { if (!file) return undefined; loaded.push([file, linear]); const t = new THREE.Texture(); t.name = file; return t }
  const options = toonOptionsOf('Hair_M', { map: 'c.png', shade: 's.png', ao: 'ao.png', aoScale: 1.8, shadingShift: -1.85, doubleSided: true,
    highColor: { color: '#d4e9ff', power: 1, mask: 'm.png' } }, texture, { color: '#3a3550', power: 5, mix: 0.6 })
  assert.deepEqual(loaded, [['c.png', false], ['s.png', false], ['ao.png', true], ['m.png', true]])
  assert.equal(options.name, 'Hair_M')
  assert.equal(options.shadeColor, 0xffffff)
  assert.equal(options.shadingShiftMapScale, 1.8)
  assert.equal(options.shadingShift, -1.85)
  assert.equal(options.shadingToony, 0.95)
  assert.equal(options.side, THREE.DoubleSide)
  assert.deepEqual(options.rim, { color: '#3a3550', fresnelPower: 5, lightingMix: 0.6 })
  assert.equal(options.highColor.mask.name, 'm.png')
  const material = createToonMaterial(options)
  assert.deepEqual(Object.keys(material.defines).sort(), ['TOON_HIGHCOLOR', 'TOON_HIGHCOLOR_MASK', 'TOON_MAP', 'TOON_SHADE_MAP', 'TOON_SHADING_SHIFT_MAP'])
  // 빈 설정: 기본 경계·림 없음·한쪽 면
  const plain = toonOptionsOf('X', {}, texture)
  assert.equal(plain.shadingShift, -0.05)
  assert.equal(plain.rim, undefined)
  assert.equal(plain.side, THREE.FrontSide)
  assert.equal(plain.alphaTest, 0)
  assert.equal(plain.transparent, false)
  assert.deepEqual(toonOptionsOf('X', {}, texture, { color: '#fff' }).rim, { color: '#fff', fresnelPower: 4, lightingMix: 0.5 })
})

test('림 마스크 맵(MToon rimMultiplyTexture)은 줄 때만 define·uniform이 생기고, 텍스처 변환 행렬도 함께 생긴다', () => {
  const map = new THREE.Texture()
  assert.ok(!('TOON_RIM_MAP' in toonDefines({ rim: { color: '#fff' } })), '마스크 없으면 예전과 같은 프로그램')
  assert.ok('TOON_RIM_MAP' in toonDefines({ rim: { color: '#fff', map } }))
  const material = createToonMaterial({ rim: { color: '#fff', map }, uvTransforms: true })
  assert.equal(material.uniforms.rimMap.value, map)
  assert.ok(material.uniforms.rimMapUvTransform, '표정 UV 바인드·KHR_texture_transform 행렬')
  assert.ok(!('rimMap' in createToonMaterial({ rim: { color: '#fff' } }).uniforms))
})
