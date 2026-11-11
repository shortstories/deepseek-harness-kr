import test from 'node:test'
import assert from 'node:assert/strict'

test('지수 평활: 시간 상수만큼 지나면 약 63% 다가가고, 시간 상수 0이면 바로, 간격 0이면 그대로다', async () => {
  const { smoothToward } = await import('../../character/rig-three.ts')
  assert.ok(Math.abs(smoothToward(0, 1, 0.08, 0.08) - (1 - Math.exp(-1))) < 1e-12)
  assert.equal(smoothToward(0.2, 1, 0.016, 0), 1)
  assert.equal(smoothToward(0.2, 1, 0, 0.08), 0.2)
  // 프레임을 잘게 나눠도 같은 시간이면 같은 결과 (프레임 간격과 무관)
  let a = 0; for (let i = 0; i < 10; i++) a = smoothToward(a, 1, 0.01, 0.08)
  assert.ok(Math.abs(a - smoothToward(0, 1, 0.1, 0.08)) < 1e-12)
})

test('눈썹 채널만 설정 배율·부드러움이 걸리고, 다른 채널은 avatar.json channelSmooth를 따른다', async () => {
  const { tunedChannels } = await import('../../character/rig-three.ts')
  const channels = ['browRaiseLeft', 'browInnerRaise', 'mouthOpen', 'eyeOpenLeft']
  const smoothed = new Map()
  // 첫 프레임: 지난 값이 없으면 지금 값에서 시작(불러온 직후 끌려오지 않음)
  let out = tunedChannels(channels, new Map([['browRaiseLeft', 0.5], ['mouthOpen', 0.4]]), smoothed, 1 / 60, { browScale: 0.4, browSmooth: 0.08 }, { mouthOpen: 0.05 })
  assert.equal(out.get('browRaiseLeft'), 0.2, '눈썹 0.5 × 배율 0.4')
  assert.equal(out.get('mouthOpen'), 0.4, '눈썹이 아니면 배율 없음')
  assert.equal(out.get('eyeOpenLeft'), 0)
  // 다음 프레임에 눈썹이 0.9로 튐: 부드럽게 일부만 따라감
  out = tunedChannels(channels, new Map([['browRaiseLeft', 0.9], ['mouthOpen', 0.4]]), smoothed, 1 / 60, { browScale: 0.4, browSmooth: 0.08 }, { mouthOpen: 0.05 })
  const target = 0.9 * 0.4, expected = 0.2 + (target - 0.2) * (1 - Math.exp(-(1 / 60) / 0.08))
  assert.ok(Math.abs(out.get('browRaiseLeft') - expected) < 1e-12)
  // 눈썹 부드러움은 설정값이 avatar.json보다 우선, 설정이 없으면 avatar.json 값, 둘 다 없으면 바로
  const s2 = new Map([['browInnerRaise', 0]])
  assert.equal(tunedChannels(['browInnerRaise'], new Map([['browInnerRaise', 1]]), s2, 0.1, { browSmooth: 0 }, { browInnerRaise: 1 }).get('browInnerRaise'), 1)
  const s3 = new Map([['browInnerRaise', 0]])
  assert.ok(tunedChannels(['browInnerRaise'], new Map([['browInnerRaise', 1]]), s3, 0.1, {}, { browInnerRaise: 1 }).get('browInnerRaise') < 0.1)
  const s4 = new Map([['browInnerRaise', 0]])
  assert.equal(tunedChannels(['browInnerRaise'], new Map([['browInnerRaise', 1]]), s4, 0.1).get('browInnerRaise'), 1, '조정 없으면 예전과 같음')
})
