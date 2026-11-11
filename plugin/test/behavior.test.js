import test from 'node:test'
import assert from 'node:assert/strict'
import { createBehaviors, createTimeline, EVENTS } from '../../character/behavior.ts'
import { BUILTIN_BEHAVIORS } from '../../character/behaviors/index.ts'
import { BEHAVIORS } from '../../character/model-profile.ts'

/** 이벤트 하나를 맡고 호출을 기록하는 행동 정의 */
const def = (id, keys, extra = {}) => ({ id, ...extra, create: () => ({ on: Object.fromEntries(keys.map((key) => [key, (event) => extra.calls?.push([id, key, event])])), ...extra.instance }) })

test('프로필 목록의 행동만 켜고, 맡은 이벤트는 그 행동 하나로 보낸다', () => {
  const calls = []
  const behaviors = createBehaviors([def('a', [EVENTS.headStrokeFast], { calls }), def('b', [EVENTS.headStrokeSlow], { calls })], ['a'], {})
  assert.deepEqual(behaviors.ids, ['a'])
  assert.equal(behaviors.has(EVENTS.headStrokeFast), true)
  assert.equal(behaviors.has(EVENTS.headStrokeSlow), false, '목록에 없는 행동의 이벤트는 기본 반응')
  assert.equal(behaviors.dispatch(EVENTS.headStrokeFast, { now: 1, x: 2, y: 3 }), true)
  assert.equal(behaviors.dispatch(EVENTS.headStrokeSlow, { now: 1, x: 2, y: 3 }), false)
  assert.deepEqual(calls, [['a', EVENTS.headStrokeFast, { now: 1, x: 2, y: 3 }]])
})

test('빈 목록이면 모든 이벤트가 기본 반응이다', () => {
  const behaviors = createBehaviors(BUILTIN_BEHAVIORS, [], {})
  for (const key of Object.values(EVENTS)) assert.equal(behaviors.has(key), false)
})

test('같은 이벤트를 둘이 맡으면 목록 순서와 상관없이 경고 후 기본 반응으로 둔다', () => {
  for (const ids of [['a', 'b'], ['b', 'a']]) {
    const warnings = []
    const behaviors = createBehaviors([def('a', [EVENTS.headStrokeFast]), def('b', [EVENTS.headStrokeFast])], ids, {}, { warn: (m) => warnings.push(m) })
    assert.equal(behaviors.has(EVENTS.headStrokeFast), false)
    assert.equal(warnings.length, 1)
  }
})

test('모르는 ID는 경고 후 무시하고, 같은 ID가 두 번 있으면 한 번만 만든다', () => {
  const warnings = []
  let created = 0
  const behaviors = createBehaviors([{ id: 'a', create: () => { created++; return { on: {} } } }], ['a', 'x', 'a'], {}, { warn: (m) => warnings.push(m) })
  assert.deepEqual(behaviors.ids, ['a'])
  assert.equal(created, 1)
  assert.deepEqual(warnings, ['알 수 없는 행동: x'])
})

test('상태 표시는 켜진 행동이 지금 달고 있을 때만 참이다', () => {
  const behaviors = createBehaviors([def('a', [], { instance: { tags: (now) => (now < 10 ? ['head.covered'] : []) } })], ['a'], {})
  assert.equal(behaviors.tagged('head.covered', 5), true)
  assert.equal(behaviors.tagged('head.covered', 10), false)
  assert.equal(behaviors.tagged('other', 5), false)
})

test('프레임 기여는 켜진 행동의 그 자리만 부른다', () => {
  const seen = []
  const behaviors = createBehaviors([def('a', [], { instance: { frame: { params: (f) => seen.push(f.now) } } }), def('b', [], { instance: { frame: { params: () => seen.push('b') } } })], ['a'], {})
  behaviors.frame('params', { now: 7, dt: 0.016, seconds: 0.007 })
  assert.deepEqual(seen, [7])
})

test('타임라인은 시점을 차례로 예약하고, 취소하면 남은 시점을 모두 지운다', () => {
  const scheduled = [], cleared = []
  const timeline = createTimeline((fn, ms) => { scheduled.push(ms); return scheduled.length }, (id) => cleared.push(id))
  const run = timeline([{ at: 500, do() {} }, { at: 15000, do() {} }])
  assert.deepEqual(scheduled, [500, 15000])
  run.cancel()
  assert.deepEqual(cleared, [1, 2])
})

test('Live2D 기본 프로필의 행동은 모두 내장 레지스트리에 있고, 이벤트가 겹치지 않는다', () => {
  const warnings = []
  const ctx = { chestDrag: { lift: { x: 0, v: 0 }, shift: { x: 0, v: 0 } } }
  const behaviors = createBehaviors(BUILTIN_BEHAVIORS, BEHAVIORS, ctx, { warn: (m) => warnings.push(m) })
  assert.deepEqual(warnings, [])
  assert.deepEqual([...behaviors.ids].sort(), [...BEHAVIORS].sort())
  assert.equal(behaviors.has(EVENTS.headStrokeFast), true)
  assert.equal(behaviors.has(EVENTS.headStrokeSlow), true)
})

test('자세 덮어쓰기는 덮어쓴 행동이 없으면 NO_BLEND, 여럿이면 목록 순서와 상관없이 가장 센 쪽', async () => {
  const { NO_BLEND } = await import('../../character/behavior.ts')
  const blender = (id, weight) => ({ id, create: () => ({ on: {}, blend: () => (weight ? { weight, eye: weight, peek: 0 } : null) }) })
  const motion = {}, frame = { now: 0, dt: 0.016, seconds: 0 }
  assert.equal(createBehaviors([blender('a', 0)], ['a'], {}).blend(motion, frame), NO_BLEND)
  for (const ids of [['a', 'b'], ['b', 'a']]) assert.equal(createBehaviors([blender('a', 0.3), blender('b', 0.8)], ids, {}).blend(motion, frame).weight, 0.8)
})

test('삐짐은 15초 동안 busy·sulking, 풀린 뒤 4.3초 동안 정면 응시 표시를 단다', async () => {
  const { sulk, SULKING } = await import('../../character/behaviors/deepseek-chan/sulk.ts')
  const { TAGS } = await import('../../character/behavior.ts')
  const timers = []
  const ctx = { now: () => 15000, resetTapCounters() {}, clearExp() {}, cancelGesture() {}, lockInput() {}, speak() {}, flashExp() {}, timeline: (steps) => { timers.push(...steps); return { cancel() {} } } }
  const instance = sulk.create(ctx)
  instance.on[EVENTS.headRepeat]({ now: 0, x: 0, y: 0 })
  assert.deepEqual(instance.tags(100), [TAGS.busy, SULKING])
  assert.equal(timers.length, 1)
  timers[0].do()   // 15초 뒤 풀림
  assert.deepEqual(instance.tags(15000 + 100), [TAGS.stare])
  assert.deepEqual(instance.tags(15000 + 4300), [])
})

test('성적 표현을 허용하지 않는 모델이면 adult 행동은 목록에 있어도 경고 후 끈다', () => {
  const warnings = []
  const behaviors = createBehaviors([def('a', [EVENTS.chestTap], { adult: true }), def('b', [EVENTS.headStrokeFast])], ['a', 'b'], {}, { allowAdult: false, warn: (m) => warnings.push(m) })
  assert.deepEqual(behaviors.ids, ['b'])
  assert.equal(behaviors.has(EVENTS.chestTap), false)
  assert.equal(warnings.length, 1)
})

test('터치 알림은 켜진 행동 모두에게 간다 (가슴 연타 횟수는 다른 부위를 만지면 풀림)', () => {
  const seen = []
  const watcher = (id) => ({ id, create: () => ({ on: {}, touched: (region) => seen.push([id, region]) }) })
  createBehaviors([watcher('a'), watcher('b')], ['a', 'b'], {}).touched('head', 1)
  assert.deepEqual(seen, [['a', 'head'], ['b', 'head']])
})
