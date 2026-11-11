import test from 'node:test'
import assert from 'node:assert/strict'
import { createPetLink } from '../../character/pet-link.ts'
import { createLogger } from '../../character/log.ts'

// 바깥 펫 창 연결(character/pet-link.js)을 가짜 fetch·타이머로 실제 실행해 확인한다.
// 예전에는 이 흐름을 dsc.js 소스 문자열로만 확인했다.
const flush = () => new Promise((resolve) => setImmediate(resolve))

function harness(overrides = {}) {
  const posts = [], polls = [], replies = [], timers = [], intervals = [], frames = [], calls = []
  let clock = 1000
  const state = { hidden: false, idle: true, voice: null, dragKey: 'Alt', dock: { k: 1, x: 0, y: 0 }, outfit: { glasses: false }, configs: [] }
  const fetch = async (url, init) => {
    if (url.endsWith('poll')) { polls.push(url); const body = replies.shift() ?? { supported: true, state: 'none', events: [] }; return { ok: true, json: async () => body } }
    const path = url.slice('/pet/'.length)
    posts.push([path, init.body ? JSON.parse(init.body) : {}])
    return { ok: true, json: async () => ({ state: path === 'open' ? 'starting' : undefined }) }
  }
  const link = createPetLink({
    url: '/pet/', fetch,
    setTimeout: (fn, ms) => { timers.push([fn, ms]); return timers.length },
    setInterval: (fn, ms) => { intervals.push([fn, ms]); return intervals.length },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length },
    now: () => clock,
    onUse: () => calls.push('use'),
    onEnter: () => calls.push('enter'),
    onLeave: () => calls.push('leave'),
    onConfig: (key, value) => state.configs.push([key, value]),
    snapshot: () => [['setMood', ['idle', 0]]],
    dragMessages: () => [['drag', [state.dragKey]]],
    dockState: () => ({ dock: state.dock, outfit: state.outfit }),
    dragKey: () => state.dragKey,
    voice: () => state.voice,
    idle: () => state.idle,
    hidden: () => state.hidden,
    openPose: () => ({ k: 0.8, x: 110, y: 220 }),
    ...overrides,
  })
  return { link, posts, polls, replies, timers, intervals, frames, calls, state, tick: (ms) => { clock += ms } }
}

test('반응은 펫 창이 보이는 동안(따라오는 중 포함)만 모은다', () => {
  const h = harness()
  h.link.relay('say', ['hi'])
  assert.deepEqual(h.link.queue, [])
  h.link.follow = { shown: false }
  h.link.relay('say', ['hi'])
  assert.deepEqual(h.link.queue, [])
  h.link.follow.shown = true
  h.link.relay('say', ['hi'])
  h.link.follow = null; h.link.open = true
  h.link.relay('play', ['nod', 100])
  assert.deepEqual(h.link.queue, [['say', ['hi']], ['play', ['nod', 100]]])
})

test('새로 불러온 화면은 떠 있는 펫 창을 한 번만 이어받고 회차 번호도 따른다', async () => {
  const h = harness()
  h.replies.push({ supported: true, state: 'shown', seq: 7, events: [] })
  h.link.poll()
  await flush()
  assert.equal(h.link.open, true)
  assert.equal(h.link.seq, 7)
  assert.deepEqual(h.calls, ['use', 'enter'])
  assert.deepEqual(h.link.queue, [['setMood', ['idle', 0]], ['drag', ['Alt']]], '보일 때 지금 표정과 이동 키를 맞춘다')
  // 붙은 직후 잠깐 남은 펫 창 때문에 다시 이어받지 않는다 (boot는 처음 한 번만)
  h.link.open = false
  h.replies.push({ supported: true, state: 'shown', seq: 7, events: [] })
  h.link.poll()
  await flush()
  assert.equal(h.link.open, false)
})

test('알림: 이전 회차는 버리고, 연 뒤의 shown은 이어받고, 붙음·숨음은 창 안으로 돌아온다', async () => {
  const h = harness()
  h.link.boot = false; h.link.seq = 3; h.link.opening = 500
  h.replies.push({ supported: true, state: 'shown', events: [{ type: 'shown', seq: 2 }] })
  h.link.poll(); await flush()
  assert.equal(h.link.open, false, '이전 회차 알림은 무시')
  h.replies.push({ supported: true, state: 'shown', events: [{ type: 'shown', seq: 3 }] })
  h.link.poll(); await flush()
  assert.equal(h.link.open, true)
  assert.equal(h.link.opening, 0)

  h.replies.push({ supported: true, state: 'hidden', events: [{ type: 'hidden', seq: 3 }] })
  h.link.poll(); await flush()
  assert.equal(h.link.open, false)
  assert.equal(h.calls.at(-1), 'leave')
  // 창 안이 다시 그려지는 프레임에 남은 펫 창을 숨긴다
  h.frames.shift()(); await flush()
  assert.deepEqual(h.posts.at(-1), ['hide', {}])

  // 따라오는 중 shown → 표정만 맞추고, attach → 따라오기를 끝내고 돌아옴
  h.link.follow = { shown: false }; h.link.queue = []
  h.replies.push({ supported: true, state: 'shown', events: [{ type: 'shown', seq: 3 }] })
  h.link.poll(); await flush()
  assert.equal(h.link.follow.shown, true)
  assert.deepEqual(h.link.queue, [['setMood', ['idle', 0]]])
  h.link.open = true
  h.replies.push({ supported: true, state: 'none', events: [{ type: 'attach', seq: 3 }] })
  h.link.poll(); await flush()
  assert.equal(h.link.follow, null)
  assert.equal(h.link.open, false)
})

test('펫 창 메뉴 값은 이름이 문자열인 짝만 설정으로 넘긴다', async () => {
  const h = harness()
  h.replies.push({ supported: true, state: 'shown', events: [{ type: 'config', list: [['glasses', true], ['bad'], [1, 2], ['bodyType', 'type1']] }] })
  h.link.poll(); await flush()
  assert.deepEqual(h.state.configs, [['glasses', true], ['bodyType', 'type1']])
})

test('150ms 틱: 붙을 자리·소품·이동 키가 바뀔 때만 보내고, 모인 반응을 한 번에 보낸다', async () => {
  const h = harness()
  h.link.start()
  const tick = h.intervals.find(([, ms]) => ms === 150)[0]
  h.link.open = true
  h.link.relay('say', ['a'])
  tick(); await flush()
  const sent = h.posts.filter(([path]) => path === 'send')
  assert.deepEqual(sent.at(-1)[1].list, [['say', ['a']], ['dock', [h.state.dock]], ['outfit', [h.state.outfit]], ['drag', ['Alt']]])
  assert.deepEqual(h.link.queue, [])
  const count = h.posts.length
  tick(); await flush()
  assert.equal(h.posts.filter(([path]) => path === 'send').length, sent.length, '바뀐 것이 없으면 보내지 않는다')
  h.state.outfit = { glasses: true }
  tick(); await flush()
  assert.deepEqual(h.posts.at(-1)[1].list, [['dock', [h.state.dock]], ['outfit', [{ glasses: true }]]])
  assert.ok(h.posts.length > count)
})

test('열기를 요청하고 15초 안에 뜨지 않으면 포기한다', () => {
  const h = harness()
  h.link.start()
  const tick = h.intervals.find(([, ms]) => ms === 150)[0]
  h.link.opening = 1000
  h.tick(15001)
  tick()
  assert.equal(h.link.opening, 0)
})

test('입 모양은 펫 창이 떠 있고 값이 바뀔 때만 60ms마다 보낸다', async () => {
  const h = harness()
  h.link.start()
  const voice = h.intervals.find(([, ms]) => ms === 60)[0]
  h.state.voice = { level: 0.5 }
  voice(); assert.equal(h.posts.filter(([p]) => p === 'send').length, 0)
  h.link.open = true
  voice(); voice(); await flush()
  assert.deepEqual(h.posts.filter(([p]) => p === 'send').map(([, b]) => b.list), [[['voice', [{ level: 0.5 }]]]])
})

test('미리 띄우기: 호스트가 늦으면 다시 묻고, 바쁠 때는 미루고, 한가하면 숨긴 채 띄운다', async () => {
  const h = harness()
  h.replies.push({ supported: false, state: 'none', events: [] })
  h.link.start(); await flush()
  const warmUp = h.timers.find(([, ms]) => ms === 5000)[0]
  warmUp()   // 아직 지원 여부를 모름 → 다시 묻고 3초 뒤 재시도
  assert.equal(h.timers.at(-1)[1], 3000)
  await flush()
  assert.equal(h.link.supported, true)
  h.state.idle = false
  h.timers.at(-1)[0]()   // 바쁨 → 미룸
  assert.equal(h.timers.at(-1)[1], 3000)
  assert.equal(h.posts.length, 0)
  h.state.idle = true
  h.timers.at(-1)[0]()   // 한가함 → 유휴 콜백(여기서는 setTimeout 0)에서 warm
  h.timers.at(-1)[0](); await flush()
  assert.deepEqual(h.posts.at(-1), ['warm', {}])
})

test('단축키: 캔버스를 숨긴 동안은 아무것도 하지 않고, 떠 있으면 숨기고, 아니면 지금 자리에서 연다', async () => {
  const h = harness()
  h.state.hidden = true
  h.link.toggle()
  assert.deepEqual(h.posts, [])
  assert.equal(h.link.opening, 0)

  h.state.hidden = false
  h.link.toggle(); await flush()
  assert.deepEqual(h.posts.at(-1), ['open', { from: { k: 0.8, x: 110, y: 220 }, to: { k: 0.8, x: 110, y: 220 }, seq: 1 }])
  assert.equal(h.link.opening, 1000)
  assert.equal(h.link.petState, 'starting')

  // 떠 있으면 창 안 캐릭터가 먼저 나타나고(leave), 그 다음 프레임에 펫 창을 숨긴다 (먼저 숨기면 사이에 아무것도 안 보여 깜빡임)
  h.link.open = true
  const before = h.posts.length
  h.link.toggle(); await flush()
  assert.equal(h.link.open, false)
  assert.deepEqual(h.calls.slice(-1), ['leave'])
  assert.equal(h.posts.length, before, '창 안이 그리기 전에는 숨기지 않음')
  h.frames.at(-1)(); await flush()
  assert.deepEqual(h.posts.at(-1), ['hide', {}])
  assert.equal(h.link.opening, 0)
  // 끄는 도중 따라오던 펫 창은 바로 숨김 (창 안에서 이어 끔)
  h.link.follow = { shown: true }
  h.link.toggle(); await flush()
  assert.deepEqual(h.posts.at(-1), ['hide', {}])
  h.link.follow = null

  h.link.open = false; h.link.petState = 'shown'
  h.link.toggle()
  assert.equal(h.link.open, true, '다른 화면에서 열어 둔 펫 창을 이어받는다')
})

test('펫 경로가 없으면(펫 창 자신) 연결을 시작하지 않는다', () => {
  const h = harness({ url: null })
  h.link.start()
  assert.deepEqual(h.polls, [])
  assert.deepEqual(h.intervals, [])
})

test('진단: 오류·비정상 종료·펫 창 기록과 POST 실패를 회차와 상관없이 같은 내용은 한 번만 경고한다', async () => {
  const output = { lines: [], warn: (...args) => output.lines.push(args.join(' ')), log: () => {} }
  let reply = { ok: false, status: 500, json: async () => ({ error: 'boom' }) }
  const h = harness({ log: createLogger(output, () => null), fetch: async (url) => {
    if (url.endsWith('poll')) { const body = h.replies.shift(); return { ok: true, json: async () => body } }
    if (reply instanceof Error) throw reply
    return reply
  } })
  const events = [{ type: 'error', message: 'pet did not become ready', seq: 9, stderr: 'boom trace' }, { type: 'closed', code: 0 },
    { type: 'closed', code: 1, stderr: 'fatal' }, { type: 'closed', signal: 'SIGKILL' }, { type: 'log', level: 'warn', text: 'pet authentication failed' }]
  for (let round = 0; round < 2; round++) { h.replies.push({ supported: true, state: 'none', events }); h.link.poll(); await flush() }
  await h.link.post('open'); await h.link.post('open')
  reply = new Error('Failed to fetch')
  assert.equal(await h.link.post('send'), null); await h.link.post('send')
  assert.deepEqual(output.lines, [
    '[deepseek-chan-plugin-for-dsh] 펫 창 오류: pet did not become ready \nboom trace',
    '[deepseek-chan-plugin-for-dsh] 펫 프로세스 비정상 종료 (code 1): \nfatal',
    '[deepseek-chan-plugin-for-dsh] 펫 프로세스 비정상 종료 (signal SIGKILL):',
    '[deepseek-chan-plugin-for-dsh] 펫 창 warn: pet authentication failed',
    '[deepseek-chan-plugin-for-dsh] 펫 요청 실패 (open): HTTP 500 boom',
    '[deepseek-chan-plugin-for-dsh] 펫 요청 오류 (send): Failed to fetch',
  ])
})
test('3D 모델: warm·open에 창 안 렌더러(사용 여부·외곽선)를 싣고, 조절값은 바뀔 때 펫 창에 보낸다', async () => {
  const tuning = { browScale: 1, browSmooth: 0.08 }
  const h = harness({ avatar: () => ({ enabled: true, outline: 'model' }), dockState: () => ({ dock: { k: 1, x: 0, y: 0 }, outfit: {}, avatar: tuning }) })
  await h.link.post('warm'); await h.link.post('open', { seq: 1 })
  assert.deepEqual(h.posts.map(([path, body]) => [path, body.avatar]), [['warm', { enabled: true, outline: 'model' }], ['open', { enabled: true, outline: 'model' }]])
  assert.equal(h.posts[1][1].seq, 1, '원래 본문은 그대로')
  await h.link.post('hide')
  assert.equal(h.posts.at(-1)[1].avatar, undefined, 'warm·open 말고는 싣지 않음')
  h.link.start()
  const tick = h.intervals.find(([, ms]) => ms === 150)[0]
  h.link.open = true
  tick(); await flush()
  assert.deepEqual(h.posts.at(-1)[1].list.find(([name]) => name === 'avatar'), ['avatar', [tuning]])
  tuning.browScale = 1.5
  tick(); await flush()
  assert.deepEqual(h.posts.at(-1)[1].list.find(([name]) => name === 'avatar'), ['avatar', [{ browScale: 1.5, browSmooth: 0.08 }]])
})

test('창 안으로 돌아온 뒤 숨기기 응답이 아직 shown이어도 숨은 것으로 보고, 다음 단축키는 펫 창을 새로 연다', async () => {
  const h = harness({ fetch: undefined })
  const link = createPetLink({
    url: '/pet/',
    fetch: async (url, init) => { const path = url.slice('/pet/'.length); h.posts.push([path, init?.body ? JSON.parse(init.body) : {}]); return { ok: true, json: async () => ({ state: path === 'hide' ? 'shown' : path === 'open' ? 'starting' : 'hidden', supported: true, events: [] }) } },
    setTimeout: () => 0, setInterval: () => 0, requestAnimationFrame: (fn) => { h.frames.push(fn); return 1 }, now: () => 1000,
    onUse() {}, onEnter() {}, onLeave() {}, onConfig() {}, snapshot: () => [], dragMessages: () => [], dockState: () => ({ dock: null, outfit: {} }),
    dragKey: () => 'Alt', voice: () => null, idle: () => true, hidden: () => false, openPose: () => ({ k: 1, x: 0, y: 0 }),
  })
  link.open = true
  link.toggle()                     // 돌아오기: 창 안이 먼저 그리고
  h.frames.at(-1)(); await flush()   // 그 프레임에 숨기기
  assert.equal(link.petState, 'hidden')
  link.toggle(); await flush()       // 다시 내보내기: 이어받기(enter)가 아니라 새로 열기
  assert.equal(link.open, false)
  assert.equal(h.posts.at(-1)[0], 'open')
})
