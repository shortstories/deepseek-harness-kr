import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  addBindingWeight, addTargetWeight, defaultVrmChannels, defaultVrmExpressions, isVrmModel, outlineOptionsFromMToon,
  profileFromVrm, sexualUsageAllowed, toonOptionsFromMToon, VRM_ARM_DOWN,
} from '../../character/rig-vrm.ts'
import { createOutlineMaterial, createToonMaterial, toonDefines, updateUvTransforms } from '../../character/toon-material.ts'
import { bindingWeight } from '../../character/rig-three.ts'

// VRM은 three-vrm이 읽은 값(사람형 뼈·표정·메타·MToon)을 평범한 값으로 받아 프로필·툰 재질 설정을 만든다

const PRESETS = ['aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'blinkLeft', 'blinkRight', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral']
const info = (extra = {}) => ({ bones: { hips: 'J_Bip_C_Hips', head: 'J_Bip_C_Head' }, expressions: PRESETS, sexualAllowed: true, ...extra })

test('VRM 파일은 확장자로 알아본다', () => {
  assert.equal(isVrmModel('a/Seed-san.vrm'), true)
  assert.equal(isVrmModel('Model.VRM'), true)
  assert.equal(isVrmModel('model.fbx'), false)
})

test('model만 있는 avatar.json이면 VRM 뼈·채널·표정·팔 내림 기본값으로 프로필을 만든다', () => {
  const profile = profileFromVrm(info(), { model: 'x.vrm' })
  assert.equal(profile.model, 'x.vrm')
  assert.deepEqual(profile.bones, { hips: 'J_Bip_C_Hips', head: 'J_Bip_C_Head' })
  assert.equal(profile.armDown, VRM_ARM_DOWN)
  assert.deepEqual(profile.channels.eyeOpenLeft, [{ expression: 'blinkLeft', map: 'invert' }])
  assert.deepEqual(profile.channels.eyeOpenRight, [{ expression: 'blinkRight', map: 'invert' }])
  assert.deepEqual(['A', 'I', 'U', 'E', 'O'].map((v) => profile.channels[`mouthVowel.${v}`][0].expression), ['aa', 'ih', 'ou', 'ee', 'oh'])
  assert.deepEqual(profile.channels.mouthOpen, [{ expression: 'aa', scale: 0.6 }])
  assert.equal(profile.channels.headTurn, undefined)   // 다른 채널은 대응 없음
  assert.deepEqual(profile.expressions, { heart: { happy: 1 }, tears: { sad: 1 }, dark: { angry: 1 }, smug: { relaxed: 1 }, dizzy: { surprised: 1 } })
  assert.equal(profile.springs, undefined)   // VRM 흔들림 뼈를 씀
  assert.equal(profile.outline, undefined)   // VRM MToon 외곽선을 씀
  assert.equal(profile.features, undefined)
})

test('avatar.json 값이 VRM 기본값을 키마다 이긴다', () => {
  const profile = profileFromVrm(info(), {
    model: 'x.vrm', bones: { head: 'MyHead' }, armDown: 0,
    channels: { mouthOpen: [{ morph: 'Fcl_MTH_A' }] }, expressions: { heart: { happy: 0.5, Fcl_EYE_Joy: 1 } },
    springs: [{ roots: ['Hair'] }], features: ['earHide'],
  })
  assert.deepEqual(profile.bones, { hips: 'J_Bip_C_Hips', head: 'MyHead' })
  assert.equal(profile.armDown, 0)
  assert.deepEqual(profile.channels.mouthOpen, [{ morph: 'Fcl_MTH_A' }])
  assert.deepEqual(profile.channels.eyeOpenLeft, [{ expression: 'blinkLeft', map: 'invert' }])
  assert.deepEqual(profile.expressions.heart, { happy: 0.5, Fcl_EYE_Joy: 1 })
  assert.deepEqual(profile.expressions.tears, { sad: 1 })
  assert.deepEqual(profile.springs, [{ roots: ['Hair'] }])
  assert.deepEqual(profile.features, ['earHide'])
})

test('기본 대응은 VRM에 있는 표정만 쓰고, 같은 이름의 사용자 표정이 프리셋보다 먼저다', () => {
  assert.deepEqual(defaultVrmChannels(['blinkLeft']), { eyeOpenLeft: [{ expression: 'blinkLeft', map: 'invert' }] })
  assert.deepEqual(defaultVrmChannels([]), {})
  assert.deepEqual(defaultVrmExpressions(['happy', 'heart', 'blush', 'Surprised']), { heart: { heart: 1 }, blush: { blush: 1 } })
  assert.deepEqual(defaultVrmExpressions([]), {})
})

test('성적 표현을 금지한 VRM은 adult 행동(가슴·아랫배)을 avatar.json에 있어도 끈다', () => {
  assert.equal(sexualUsageAllowed({ metaVersion: '1', allowExcessivelySexualUsage: false }), false)
  assert.equal(sexualUsageAllowed({ metaVersion: '1', allowExcessivelySexualUsage: true }), true)
  assert.equal(sexualUsageAllowed({ metaVersion: '1' }), true)
  assert.equal(sexualUsageAllowed({ metaVersion: '0', sexualUssageName: 'Disallow' }), false)
  assert.equal(sexualUsageAllowed({ metaVersion: '0', sexualUssageName: 'Allow' }), true)
  assert.equal(sexualUsageAllowed(null), true)
  const profile = profileFromVrm(info({ sexualAllowed: false }), { model: 'x.vrm', features: ['earHide'] })
  assert.deepEqual(profile.features, ['earHide'], '모델 능력 기능은 그대로')
  assert.equal(profile.adultAllowed, false, '성적 표현 금지 모델은 adult 행동도 끔')
  assert.equal(profileFromVrm(info(), { model: 'x.vrm' }).adultAllowed, true)
  assert.equal(profileFromVrm(info(), { model: 'x.vrm', adultAllowed: false }).adultAllowed, false, 'avatar.json으로 끌 수 있음')
})

test('채널 대응은 expression이면 VRM 표정, morph면 모프에 더하고, 표정 표 대상은 VRM 표정 이름이 먼저다', () => {
  const sink = { morphs: new Map(), expressions: new Map(), vrmNames: new Set(['happy', 'aa']) }
  addBindingWeight(sink, { expression: 'blinkLeft', map: 'invert' }, bindingWeight({ expression: 'blinkLeft', map: 'invert' }, 0.25))
  addBindingWeight(sink, { morph: 'Mouth_A' }, 0.5)
  addBindingWeight(sink, { expression: 'aa', scale: 0.6 }, bindingWeight({ expression: 'aa', scale: 0.6 }, 1))
  addTargetWeight(sink, 'aa', 0.1)          // 같은 VRM 표정에 쌓임
  addTargetWeight(sink, 'happy', 0.5)       // VRM 표정
  addTargetWeight(sink, 'Eye_Heart', 1)     // VRM 표정이 아니면 모프
  assert.deepEqual([...sink.expressions], [['blinkLeft', 0.75], ['aa', 0.7], ['happy', 0.5]])
  assert.deepEqual([...sink.morphs], [['Mouth_A', 0.5], ['Eye_Heart', 1]])
  // FBX는 VRM 표정이 없어 모두 모프
  const fbx = { morphs: new Map(), expressions: new Map(), vrmNames: new Set() }
  addTargetWeight(fbx, 'happy', 1)
  assert.deepEqual([...fbx.morphs], [['happy', 1]])
  assert.equal(fbx.expressions.size, 0)
})

/** three-vrm MToonMaterial 대신 쓰는 가짜 값 */
const fakeMToon = (extra = {}) => ({
  name: 'Body', color: new THREE.Color(1, 0.9, 0.8), opacity: 0.75, map: new THREE.Texture(), normalMap: null, normalScale: new THREE.Vector2(1, -1),
  emissive: new THREE.Color(0, 0, 0), emissiveIntensity: 1, emissiveMap: null,
  shadeColorFactor: new THREE.Color(0.5, 0.4, 0.3), shadeMultiplyTexture: new THREE.Texture(), shadingShiftFactor: -0.2, shadingShiftTexture: null,
  shadingShiftTextureScale: 1, shadingToonyFactor: 0.8, giEqualizationFactor: 0.9, matcapFactor: new THREE.Color(1, 1, 1), matcapTexture: null,
  parametricRimColorFactor: new THREE.Color(0.1, 0.1, 0.1), parametricRimFresnelPowerFactor: 4.3, parametricRimLiftFactor: 0.18, rimLightingMixFactor: 1,
  outlineWidthMode: 'worldCoordinates', outlineWidthFactor: 0.0015, outlineWidthMultiplyTexture: null, outlineColorFactor: new THREE.Color(0.2, 0.1, 0.1),
  outlineLightingMixFactor: 1, uvAnimationScrollXOffset: 0.1, uvAnimationScrollYOffset: 0.2, uvAnimationRotationPhase: 0.3,
  alphaTest: 0.5, transparent: false, side: THREE.DoubleSide, ...extra,
})

test('MToon 값은 툰 재질 설정으로 1:1 옮겨진다', () => {
  const source = fakeMToon()
  const options = toonOptionsFromMToon(source)
  assert.equal(options.name, 'Body')
  assert.equal(options.color, source.color)
  assert.equal(options.map, source.map)
  assert.equal(options.opacity, 0.75)
  assert.equal(options.shadeColor, source.shadeColorFactor)
  assert.equal(options.shadeMap, source.shadeMultiplyTexture)
  assert.equal(options.shadingShift, -0.2)
  assert.equal(options.shadingToony, 0.8)
  assert.equal(options.shadingShiftMap, null)
  assert.equal(options.giEqualization, 0.9)
  assert.deepEqual(options.rim, { color: source.parametricRimColorFactor, fresnelPower: 4.3, lift: 0.18, lightingMix: 1, map: undefined })
  assert.equal(options.matcap, undefined)   // 매트캡 텍스처가 없으면 끔
  assert.deepEqual(options.uvOffset, [0.1, 0.2])
  assert.equal(options.uvRotation, 0.3)
  assert.equal(options.alphaTest, 0.5)
  assert.equal(options.side, THREE.DoubleSide)
  assert.equal(options.uvTransforms, true)
  const material = createToonMaterial(options)
  assert.deepEqual(Object.keys(material.defines).sort(), ['TOON_EMISSIVE', 'TOON_MAP', 'TOON_SHADE_MAP', 'TOON_UV_TRANSFORM'])
  assert.equal(material.uniforms.opacity.value, 0.75)
  assert.ok(Math.abs(material.uniforms.rimLift.value - 0.18) < 1e-9)
})

test('노멀 맵·발광 맵·매트캡·셰이딩 경계 맵이 있으면 그 기능을 켠다', () => {
  const tex = () => new THREE.Texture()
  const source = fakeMToon({ normalMap: tex(), emissiveMap: tex(), emissive: new THREE.Color(0, 1, 0.3), emissiveIntensity: 1.7, matcapTexture: tex(), shadingShiftTexture: tex(), shadingShiftTextureScale: 0.5 })
  const options = toonOptionsFromMToon(source)
  assert.deepEqual(options.matcap, { color: source.matcapFactor, map: source.matcapTexture })
  assert.equal(options.shadingShiftMapScale, 0.5)
  const material = createToonMaterial(options)
  for (const key of ['TOON_NORMAL_MAP', 'TOON_EMISSIVE', 'TOON_EMISSIVE_MAP', 'TOON_MATCAP', 'TOON_SHADING_SHIFT_MAP']) assert.ok(key in material.defines, key)
  assert.equal(material.uniforms.normalMap.value, source.normalMap)
  assert.deepEqual(material.uniforms.normalScale.value.toArray(), [1, -1])
  assert.equal(material.uniforms.emissiveIntensity.value, 1.7)
  assert.equal(material.uniforms.emissiveMap.value, source.emissiveMap)
  assert.equal(material.uniforms.matcapMap.value, source.matcapTexture)
})

test('MToon 외곽선은 월드 두께·색·조명 영향·두께 맵을 옮긴다', () => {
  const widthMap = new THREE.Texture()
  const options = outlineOptionsFromMToon(fakeMToon({ outlineWidthMultiplyTexture: widthMap }))
  assert.equal(options.width, 0.0015)
  assert.equal(options.lightingMix, 1)
  assert.equal(options.widthMap, widthMap)
  const material = createOutlineMaterial(options)
  assert.ok('OUTLINE' in material.defines && 'OUTLINE_WIDTH_MAP' in material.defines)
  assert.equal(material.uniforms.outlineWidthMap.value, widthMap)
  assert.equal(material.side, THREE.BackSide)
  assert.ok(!('OUTLINE_WIDTH_MAP' in toonDefines({}, { widthMap: null })))
})

test('텍스처 변환(KHR_texture_transform·표정 UV 바인드)은 맵마다 텍스처의 offset·repeat로 갱신된다', () => {
  const map = new THREE.Texture(), shadeMap = new THREE.Texture()
  const material = createToonMaterial({ map, shadeMap, uvTransforms: true })
  map.offset.set(0.25, 0); map.repeat.set(1, 1)
  shadeMap.offset.set(0.5, 0.25)
  updateUvTransforms(material.uniforms)
  const apply = (m, u, v) => new THREE.Vector3(u, v, 1).applyMatrix3(m)
  assert.deepEqual(apply(material.uniforms.mapUvTransform.value, 0, 0).toArray().slice(0, 2), [0.25, 0])
  assert.deepEqual(apply(material.uniforms.shadeMapUvTransform.value, 0, 0).toArray().slice(0, 2), [0.5, 0.25])
  // 기능을 끈 재질(FBX)은 변환 uniform이 없고 갱신도 아무것도 안 함
  const plain = createToonMaterial({ map })
  assert.equal(plain.uniforms.mapUvTransform, undefined)
  updateUvTransforms(plain.uniforms)
  assert.deepEqual(Object.keys(plain.defines), ['TOON_MAP'])
})

test('VRM MToon의 림 마스크 맵(rimMultiplyTexture)을 툰 재질 림 맵으로 옮긴다', () => {
  const rimMask = new THREE.Texture()
  const base = { name: 'Hair', color: new THREE.Color(1, 1, 1), opacity: 1, parametricRimColorFactor: new THREE.Color(1, 1, 1), parametricRimFresnelPowerFactor: 13.4, parametricRimLiftFactor: 0, rimLightingMixFactor: 0, uvAnimationScrollXOffset: 0, uvAnimationScrollYOffset: 0, uvAnimationRotationPhase: 0 }
  assert.equal(toonOptionsFromMToon({ ...base, rimMultiplyTexture: rimMask }).rim.map, rimMask)
  assert.ok(!toonOptionsFromMToon({ ...base, rimMultiplyTexture: null }).rim.map)
})
