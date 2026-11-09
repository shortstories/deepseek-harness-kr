import test from 'node:test'
import { readSource } from './source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// dsc.js의 패널 숨김 구간을 그대로 잘라 실행한다. 실제 모델/PIXI 없이도
// DOM 표시·렌더 정지·복구 칩·외부 펫 명령 여부를 확인할 수 있게 필요한 값만 둔다.
const source = readSource(new URL('../../character/index.ts', import.meta.url))

const sliceBetween = (startText, endText) => {
  const start = source.indexOf(startText)
  const end = source.indexOf(endText, start)
  assert.ok(start >= 0, `dsc.js에서 시작 지점을 찾지 못했습니다: ${startText}`)
  assert.ok(end > start, `dsc.js에서 끝 지점을 찾지 못했습니다: ${endText}`)
  return source.slice(start, end)
}
const BUBBLE_DISPLAY_LINE = 'const setBubbleDisplay = (value) => { bubble.style.display = bubbleStatus.style.display = value; };'
const pageHiddenLine = source.match(/const pageHiddenNow = [^\n]+/)?.[0]
assert.ok(pageHiddenLine, 'pageHiddenNow 정의가 필요합니다')

function contextBase(pageHidden = false) {
  const context = {
    PET: false,
    petPower: false,
    mobileHiddenNow: false,
    // 플러그인 설정에서 온 값(createCharacter의 prefs)과 모델 준비 뒤 채워지는 동작(hooks)
    prefs: { pageHidden },
    hooks: {},
    SLEEP: { state: 'active', lastActive: 0 },
    drag: { pending: null, on: false },
    strokeFrom: null,
    chestFrom: null,
    link: { open: false, follow: null, opening: 0 },
    sleepTimer: 0,
    cancelSleepSlide: null,
    fleeX: 0,
    hushCalls: 0,
    linkPosts: [],
    chipAppended: 0,
    chipRemoved: 0,
    rafCalls: 0,
    // 캐릭터 소스가 쓰는 수명 객체(character/lifetime.js) 대역: 리스너는 대상에 그대로 붙이고 DOM 노드는 그대로 돌려준다
    life: { listen: (target, type, fn, options) => target.addEventListener(type, fn, options), own: (value) => value, add() {}, stopped: false },
    app: {
      // 배치 루프가 배치 뒤에 직접 돌리는 티커 (스스로 rAF를 돌지 않는다)
      ticker: {
        lastTime: -1,
        updates: 0,
        update() { this.updates++ },
      },
      // PR24: InteractionManager의 Ticker.system 구독을 끄고 켜는 대상
      renderer: { plugins: { interaction: { useSystemTicker: true } } },
    },
    canvas: { style: {} },
    bubble: { style: {} },
    bubbleStatus: { style: {} },
    veil: { style: {} },
    document: {
      createElement() {
        return {
          id: '', textContent: '', type: '', style: {},
          addEventListener() {},
          remove() { context.chipRemoved++ },
        }
      },
      body: { append() { context.chipAppended++ } },
      documentElement: { classList: { remove() {} } },
    },
    performance: { now: () => 0 },
    typingActive: () => false,
    homePose() { throw new Error('외부 펫이 표시 중이면 homePose를 호출하지 않아야 한다') },
    // wakeRaf가 다시 예약하는지만 센다 (실제 프레임은 돌리지 않는다)
    requestAnimationFrame() { context.rafCalls++ },
    setTimeout() { return 0 },
    clearTimeout() {},
  }
  context.hush = () => { context.hushCalls++ }
  context.linkPost = (...args) => context.linkPosts.push(args)
  context.addEventListener = (type, fn) => {
    context.listeners ??= new Map()
    context.listeners.set(type, fn)
  }
  return context
}

// PR24의 systemTicker/rafIdle/wakeRaf/raf 정의를 실제 소스에서 잘라 쓴다.
const rafHelpers = [
  sliceBetween('const systemTicker =', 'const model = await'),
  // 초기 requestAnimationFrame(raf) 호출은 포함하지 않고 테스트가 프레임을 직접 돌린다.
  sliceBetween('let rafIdle = false;', '\n      requestAnimationFrame(raf);'),
].join('\n')

function runPageContext() {
  const context = contextBase(false)
  const preamble = [
    'let hidden = false, pageHiddenApplied = false, lastPlaceKey = "", placeCalls = 0;',
    pageHiddenLine,
    BUBBLE_DISPLAY_LINE,
    'const mobileHidden = () => mobileHiddenNow;',
    'const place = () => { placeCalls++; return true; };',
    rafHelpers,
  ].join('\n')
  const script = [
    preamble,
    sliceBetween('let renderOn = true;', 'const place = () =>'),
    sliceBetween('const hideChipVisible =', 'let placeErrorWarned'),
    sliceBetween('let hideChip = null;', '      if (!PET) {'),
  ].join('\n')
  const expose = `({
    hideForPage, restoreFromPage, syncPageHidden, setHidden, syncHideChip, hideChipVisible,
    setPageHidden(value) { prefs.pageHidden = value },
    setSleep(value) { SLEEP.state = value },
    setMobile(value) { mobileHiddenNow = value },
    setExternal(value) { link.open = value; link.follow = value ? { shown: true } : null },
    hidden: () => hidden,
    pageHiddenApplied: () => pageHiddenApplied,
    raf,
    rafIdle: () => rafIdle,
    rafCalls: () => rafCalls,
    tickerSystem: () => app.renderer.plugins.interaction.useSystemTicker,
    chip: () => hideChip,
    placeCalls: () => placeCalls,
    chipAppended: () => chipAppended,
    chipRemoved: () => chipRemoved,
    hushCalls: () => hushCalls,
    linkPosts: () => linkPosts,
    hookNames: () => Object.keys(hooks),
    canvas: canvas.style,
    bubble: bubble.style,
    veil: veil.style,
    rendering: () => renderOn,
  })`
  return vm.runInContext(`${script}\n${expose}`, vm.createContext(context))
}

function runPlaceContext() {
  const context = contextBase(true)
  const preamble = [
    'let hidden = false, pageHiddenApplied = false, lastPlaceKey = "", placeCalls = 0;',
    pageHiddenLine,
    BUBBLE_DISPLAY_LINE,
    'const mobileHidden = () => mobileHiddenNow;',
    rafHelpers,
  ].join('\n')
  const script = [
    preamble,
    sliceBetween('let renderOn = true;', 'const place = () =>'),
    sliceBetween('const hideChipVisible =', 'let placeErrorWarned'),
    sliceBetween('let hideChip = null;', '      if (!PET) {'),
    sliceBetween('const place = () =>', 'const hideChipVisible ='),
  ].join('\n')
  const expose = `({
    place, syncPageHidden, raf,
    setPageHidden(value) { prefs.pageHidden = value },
    setExternal(value) { link.open = value },
    external: () => link.open,
    linkPosts: () => linkPosts,
    pageHiddenApplied: () => pageHiddenApplied,
    rafIdle: () => rafIdle,
    tickerSystem: () => app.renderer.plugins.interaction.useSystemTicker,
    canvas: canvas.style,
    bubble: bubble.style,
    veil: veil.style,
    rendering: () => renderOn,
  })`
  return vm.runInContext(`${script}\n${expose}`, vm.createContext(context))
}

function runClientApply() {
  const eventListeners = new Map()
  const panelListeners = new Set()
  let activePanelId = null
  const window = {
    CustomEvent: class CustomEvent {
      constructor(type) { this.type = type }
    },
    addEventListener(type, fn) {
      if (!eventListeners.has(type)) eventListeners.set(type, new Set())
      eventListeners.get(type).add(fn)
    },
    removeEventListener(type, fn) { eventListeners.get(type)?.delete(fn) },
    dispatchEvent(event) {
      for (const fn of [...(eventListeners.get(event.type) || [])]) fn(event)
      return true
    },
    setTimeout() { return 0 },
    clearTimeout() {},
    setInterval() { return 0 },
    clearInterval() {},
    requestAnimationFrame() { return 0 },
    cancelAnimationFrame() {},
    MutationObserver: class { observe() {} disconnect() {} },
  }
  const form = {
    getSnapshot: () => ({
      status: 'ready',
      writable: true,
      value: { character: false, theme: false, translation: false, canvasToggle: false },
    }),
    subscribe() { return () => {} },
    async set() { return true },
  }
  const layout = {
    panelInfo: {
      getSnapshot: () => ({ activePanelId }),
      subscribe(fn) { panelListeners.add(fn); return () => panelListeners.delete(fn) },
    },
  }
  const cleanups = []
  const ctx = {
    effect(fn) { const cleanup = fn(); cleanups.push(cleanup); return cleanup },
    configForms: { get: () => form },
    slots: {
      inject(name, fn) { return fn() },
      register() { return () => {} },
    },
    locale: { subscribe() { return () => {} } },
    theme: { getTheme: () => ({ active: { colorScheme: 'dark' } }) },
    inject(services, fn) {
      if (!services.includes('layout')) return
      const scopeCleanups = []
      fn({
        layout,
        effect(callback) {
          const cleanup = callback()
          scopeCleanups.push(cleanup)
          return cleanup
        },
      })
      cleanups.push(() => { for (const cleanup of scopeCleanups.reverse()) cleanup() })
    },
    dispose() { for (const cleanup of cleanups.reverse()) cleanup() },
  }
  return {
    window,
    ctx,
    select(panelId) {
      activePanelId = panelId
      for (const fn of [...panelListeners]) fn()
    },
    panelListenerCount: () => panelListeners.size,
  }
}

// plugin/client.js는 ES 모듈 소스라, 실행 확인은 빌드된 lib/client.js를 DSH 모듈 로더처럼 불러서 한다
async function loadClient(window) {
  const bundle = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
  let client
  window.__ModuleLoader__ = { load({ factory }) { client = factory(() => ({})) } }
  vm.runInNewContext(bundle, { window, console })
  return client
}

test('플러그인 클라이언트는 URL이 아니라 패널 id로만 창 안 숨김을 켠다', async () => {
  const { panelHidesInWindowCharacter } = (await loadClient({})).internals
  assert.equal(panelHidesInWindowCharacter('plugins'), true)
  assert.equal(panelHidesInWindowCharacter('schedules'), true)
  for (const id of [null, undefined, 'conversation', 'settings', 'plugins-settings']) {
    assert.equal(panelHidesInWindowCharacter(id), false, `${String(id)} 패널은 창 안 캐릭터를 숨기지 않는다`)
  }
})

test('layout의 activePanelId 구독으로 plugins/schedules에서만 숨기고 정리한다', async () => {
  const h = runClientApply()
  const client = await loadClient(h.window)
  client.apply(h.ctx)
  const link = client.internals.linkOf(h.ctx)
  // 붙어 있는 캐릭터에는 바뀔 때만 setPrefs({ pageHidden })로 전달한다
  const sent = []
  link.attach({ setPrefs: (next) => { if ('pageHidden' in next) sent.push(next.pageHidden) } })
  assert.equal(link.pageHidden, false)
  assert.equal(h.panelListenerCount(), 1)

  h.select('plugins')
  assert.equal(link.pageHidden, true)
  h.select(null)
  assert.equal(link.pageHidden, false)
  h.select('schedules')
  assert.equal(link.pageHidden, true)
  h.select('conversation')
  assert.equal(link.pageHidden, false)
  h.select('plugins')
  h.select('plugins')   // 같은 값이면 다시 보내지 않는다
  assert.deepEqual(sent, [true, false, true, false, true])

  h.ctx.dispose()
  assert.equal(link.pageHidden, false)
  assert.equal(h.panelListenerCount(), 0)
  assert.deepEqual(Object.keys(h.window).filter((key) => key.startsWith('__dsc')), [], '캐릭터 통신용 window 전역을 남기지 않는다')
})

test('패널 숨김은 캐릭터 API로만 전달하고, 캐릭터는 setPrefs에서 바로 반영한다', async () => {
  // 캐릭터 쪽 수신부와 수명 래퍼는 소스에서 확인하고(번들은 esbuild가 다시 찍는다), 전달 경로는 번들을 실제로 실행해 확인한다
  assert.match(source, /if \(!PET\) hooks\.syncPageHidden = syncPageHidden;/)
  assert.match(source, /if \(pageChanged\) hooks\.syncPageHidden\?\.\(\);/)
  assert.match(source, /const addEventListener = \(type\s*, fn\s*, options\s*\) => life\.listen\(window, type, fn, options\)/)
  assert.match(source, /if \(pageHiddenNow\(\)\) \{ hideForPage\(\); return true; \}/)
  assert.doesNotMatch(source, /window\.__dsc(?!\b)[A-Za-z]/, '캐릭터는 window.__dsc(디버그·TTS용) 말고는 전역을 쓰지 않는다')
  const h = runClientApply()
  const client = await loadClient(h.window)
  client.apply(h.ctx)
  const link = client.internals.linkOf(h.ctx)
  const sent = []
  link.attach({ setPrefs: (next) => sent.push(next) })
  h.select('plugins')
  h.select(null)
  h.ctx.dispose()
  assert.deepEqual(sent.map((next) => next.pageHidden), [true, false])
})
test('플러그인·자동화 패널을 열면 창 안 캐릭터를 숨기고, 나가면 원래대로 돌아온다', () => {
  const h = runPageContext()
  assert.ok(h.hookNames().includes('syncPageHidden'), '패널 숨김은 createCharacter API(setPrefs)가 이 동작으로 바로 반영한다')

  h.setPageHidden(true)
  h.syncPageHidden()
  assert.equal(h.canvas.display, 'none')
  assert.equal(h.bubble.display, 'none')
  assert.equal(h.veil.opacity, '0')   // 브라우저 style과 같이 문자열로 저장
  assert.equal(h.rendering(), false)
  assert.equal(h.pageHiddenApplied(), true)
  assert.equal(h.hushCalls(), 0, '페이지 숨김은 hush/relay를 보내지 않는다')
  assert.equal(h.linkPosts().length, 0, '페이지 숨김은 외부 펫에 명령을 보내지 않는다')

  h.setPageHidden(false)
  h.syncPageHidden()
  assert.equal(h.canvas.display, '')
  assert.equal(h.bubble.display, '')
  assert.equal(h.veil.opacity, '')
  assert.equal(h.placeCalls(), 1, '페이지를 나가면 정상 배치로 복구한다')
  assert.equal(h.hushCalls(), 0)
  assert.equal(h.linkPosts().length, 0)
})

test('place() 자체도 패널 숨김을 지켜 창 밖 펫 분기보다 먼저 멈춘다', () => {
  const h = runPlaceContext()
  h.place()
  assert.equal(h.canvas.display, 'none')
  assert.equal(h.bubble.display, 'none')
  assert.equal(h.rendering(), false)
  assert.equal(h.pageHiddenApplied(), true)

  const pageBranch = source.indexOf('if (pageHiddenNow()) { hideForPage(); return true; }')
  const petBranch = source.indexOf('if (link.open || link.follow?.shown)', pageBranch)
  assert.ok(pageBranch >= 0 && petBranch > pageBranch, '패널 숨김 검사가 외부 펫 분기보다 앞서야 한다')
})

test('PR24 배치 루프: 패널 숨김은 rAF/시스템 티커를 쉬게 하고 복귀 시 다시 깨운다', () => {
  const h = runPageContext()
  h.setPageHidden(true)
  h.syncPageHidden()
  assert.equal(h.rendering(), false)
  assert.equal(h.tickerSystem(), false, '숨은 동안 InteractionManager의 시스템 티커도 끈다')
  assert.equal(h.rafIdle(), false, '이벤트만으로 예약된 프레임을 중복 취소하지 않는다')

  // 다음 배치 프레임: place가 hideForPage를 부르고, raf 하단이 pageHiddenNow를 보고 스스로 쉰다
  h.raf()
  assert.equal(h.rafIdle(), true)
  assert.equal(h.rendering(), false)
  assert.equal(h.tickerSystem(), false)

  h.setPageHidden(false)
  h.syncPageHidden()
  assert.equal(h.rafIdle(), false)
  assert.equal(h.tickerSystem(), true, '복귀하면 시스템 티커를 되돌린다')
  assert.equal(h.rafCalls(), 1, 'wakeRaf가 다음 프레임을 예약한다')

  // 실제 루프도 rafIdle/패널 상태를 보고 다음 프레임을 예약하지 않아야 한다
  const idleGuards = [...source.matchAll(/if \(rafIdle\) \{ systemTicker\(false\); return; \}/g)]
  assert.equal(idleGuards.length, 2)
  const pageGuard = source.indexOf('if (!PET && pageHiddenNow()) { rafIdle = true; systemTicker(false); return; }')
  const linkGuard = source.indexOf('if (PET ? !petPower : link.open)', pageGuard)
  assert.ok(pageGuard >= 0 && linkGuard > pageGuard, '하단의 패널 유휴 검사가 펫/link 검사보다 앞서야 한다')
})

test('같은 프레임 안에 패널을 열고 닫아도 시스템 티커를 복구하고 루프를 중복 예약하지 않는다', () => {
  const h = runPageContext()
  h.setPageHidden(true)
  h.syncPageHidden()
  assert.equal(h.rafIdle(), false, '이미 예약된 프레임이 아직 실행되지 않았다')
  assert.equal(h.tickerSystem(), false)
  h.setPageHidden(false)
  h.syncPageHidden()
  assert.equal(h.tickerSystem(), true, 'rafIdle이 켜지기 전에도 껐던 시스템 티커를 복구한다')
  assert.equal(h.rafCalls(), 0, '기존 프레임이 있으므로 추가 예약하지 않는다')
})

test('이미 밖으로 나간 독립 펫은 패널 진입·이탈에도 닫히거나 돌아오지 않는다', () => {
  const h = runPageContext()
  h.setExternal(true)
  h.syncPageHidden()

  h.setPageHidden(true)
  h.syncPageHidden()
  assert.equal(h.pageHiddenApplied(), true)
  assert.equal(h.hushCalls(), 0)
  assert.equal(h.linkPosts().length, 0, 'hide/linkPost 같은 외부 펫 명령이 없어야 한다')

  h.setPageHidden(false)
  h.syncPageHidden()
  assert.equal(h.placeCalls(), 1, '창 안 복구 시도는 하되')
  assert.equal(h.hushCalls(), 0)
  assert.equal(h.linkPosts().length, 0, '외부 펫을 닫거나 돌려보내지 않는다')
})

test('실제 place도 외부 펫이 떠 있으면 패널 복귀 후 창 안 그림을 다시 표시하지 않는다', () => {
  const h = runPlaceContext()
  h.setExternal(true)
  h.syncPageHidden()
  h.raf()
  assert.equal(h.rafIdle(), true)
  h.setPageHidden(false)
  h.syncPageHidden()
  assert.equal(h.canvas.display, 'none')
  assert.equal(h.bubble.display, 'none')
  assert.equal(h.rendering(), false)
  assert.equal(h.external(), true)
  assert.equal(h.linkPosts().length, 0)
  h.raf()
  assert.equal(h.rafIdle(), true, 'PR24의 외부 펫 대기 최적화도 유지한다')
  assert.equal(h.tickerSystem(), false)
})

test('사용자 hidden 상태는 패널 진입/이탈과 별개로 보존되고 복구 칩만 잠시 사라진다', () => {
  const h = runPageContext()
  h.setHidden(true)
  assert.equal(h.hidden(), true)
  assert.ok(h.chip(), '사용자가 숨긴 동안에는 복구 칩이 있다')
  const appended = h.chipAppended()

  h.setPageHidden(true)
  h.syncPageHidden()
  assert.equal(h.hidden(), true, '패널 숨김이 사용자 hidden을 바꾸지 않는다')
  assert.equal(h.chip(), null, '패널 화면에는 복구 칩을 남기지 않는다')
  assert.equal(h.rendering(), false)

  h.setPageHidden(false)
  h.syncPageHidden()
  assert.equal(h.hidden(), true)
  assert.ok(h.chip(), '패널을 나가면 사용자 숨김 칩이 다시 보인다')
  assert.equal(h.chipAppended(), appended + 1)
})

test('모바일 숨김 설정은 패널을 나가도 유지된다', () => {
  const h = runPageContext()
  h.setMobile(true)
  h.setPageHidden(true)
  h.syncPageHidden()

  h.setPageHidden(false)
  h.syncPageHidden()
  assert.equal(h.hidden(), false, '패널 숨김이 모바일 hidden 값을 바꾸지 않는다')
  assert.equal(h.placeCalls(), 1, '표시 여부는 기존 place()가 다시 판단한다')
  assert.equal(h.chip(), null)
})

test('잠든 상태에서는 패널 진입/이탈이 잠을 깨우거나 다시 그리지 않는다', () => {
  const h = runPageContext()
  h.setSleep('asleep')
  h.setPageHidden(true)
  h.syncPageHidden()
  assert.equal(h.canvas.display, 'none')
  assert.equal(h.rendering(), false)

  h.setPageHidden(false)
  h.syncPageHidden()
  assert.equal(h.placeCalls(), 0, '잠든 캐릭터를 place()로 깨우지 않는다')
  assert.equal(h.canvas.display, 'none')
  assert.equal(h.rendering(), false)
})
