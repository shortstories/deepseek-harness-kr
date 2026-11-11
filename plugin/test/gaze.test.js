import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GAZE, resolveGaze } from '../../character/gaze.ts'

test('덮어쓰기가 없으면 지금 Live2D 값 그대로다', () => {
  assert.deepEqual(resolveGaze(), DEFAULT_GAZE)
  assert.deepEqual(resolveGaze(null), DEFAULT_GAZE)
  assert.deepEqual(DEFAULT_GAZE.rangePx, [600, 500])
  assert.deepEqual(DEFAULT_GAZE.bone, { gain: [0.6, 0.5, 0.5], follow: 7, neckShare: 0.4, eyeDeg: [18, 14] })
})

test('avatar.json은 바꿀 값만 덮어쓰고, bone도 일부만 바꿀 수 있다', () => {
  const gaze = resolveGaze({ headDeg: [30, 18], bone: { gain: [0.9, 0.7, 0.5] } })
  assert.deepEqual(gaze.headDeg, [30, 18])
  assert.deepEqual(gaze.bone.gain, [0.9, 0.7, 0.5])
  assert.equal(gaze.bone.follow, 7)
  assert.deepEqual(gaze.eyeLimit, DEFAULT_GAZE.eyeLimit)
})

test('반응성 r: 커서 범위는 1/r, 스프링은 강성 r²·감쇠 r배(빠르기만 r배), 3D 따라가기는 r배', () => {
  const gaze = resolveGaze({ responsiveness: 2 })
  assert.deepEqual(gaze.rangePx, [300, 250])
  assert.deepEqual(gaze.headSpring, [38 * 4, 9.5 * 2])
  assert.deepEqual(gaze.eyeSpring, [900 * 4, 55 * 2])
  assert.equal(gaze.bone.follow, 14)
  assert.deepEqual(gaze.headDeg, DEFAULT_GAZE.headDeg, '각도는 반응성과 따로')
})

test('잘못된 값은 그 칸만 기본값으로 둔다', () => {
  const gaze = resolveGaze({ responsiveness: -1, rangePx: [100], headDeg: [40, 'x'], bone: { follow: -3, neckShare: 2 } })
  assert.equal(gaze.responsiveness, 1)
  assert.deepEqual(gaze.rangePx, DEFAULT_GAZE.rangePx)
  assert.deepEqual(gaze.headDeg, [40, 13])
  assert.equal(gaze.bone.follow, 7)
  assert.equal(gaze.bone.neckShare, 1, '목 비율은 1이 상한')
  assert.equal(resolveGaze({ bone: { follow: 0 } }).bone.follow, 0, '0이면 따라가지 않고 바로')
})
