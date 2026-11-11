// 리팩터링 검증 도구: 두 소스의 캐릭터 동작을 프레임마다 비교 (기본 테스트에는 들어 있지 않음).
// character/ 소스를 esbuild로 묶어 JSDOM에서 돌리고, PIXI·Live2D 모델·시간·난수·rAF·타이머를 가짜로 바꿔
// 같은 입력이면 늘 같은 결과가 나오게 한다. 프레임마다 모델 파라미터 값(표정 갱신·물리 뒤),
// 캔버스·말풍선·베일 스타일, 렌더 해상도, 펫 창 메시지를 기록한다.
//   npm run trace:diff -- <기준 소스 체크아웃> [--pet]
//   (= node plugin/test/trace/harness.mjs --diff <기준 소스 체크아웃> [--pet], --pet: 펫 창 시나리오)
// 기준 체크아웃은 git worktree add <경로> <커밋> 으로 만들고 node_modules를 연결해 쓴다.
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = 'http://127.0.0.1/deepseek-harness-kr/assets/'
// 대사 파일(assets/dsc-lines.json)은 이 저장소 것을 그대로 내준다 (대사 파일이 없던 기준 소스는 요청하지 않음)
const LINES_JSON = readFile(join(here, '../../../assets/dsc-lines.json'), 'utf8').then(JSON.parse)

// 저장소 root의 character/ 소스를 브라우저용 IIFE로 묶는다 (index.js·index.ts 모두)
// behaviors를 주면 Live2D 프로필의 행동 목록(model-profile.ts BEHAVIORS)을 그 목록으로 바꿔 묶는다 (행동이 없는 모델 흉내)
export async function bundleCharacter(root, { behaviors } = {}) {
  const esbuild = await import('esbuild')
  const entry = `import { createCharacter } from ${JSON.stringify(join(root, 'character/index').replaceAll('\\', '/'))}
import { createLifetime } from ${JSON.stringify(join(root, 'character/lifetime').replaceAll('\\', '/'))}
globalThis.__traceCharacter = createCharacter({ base: ${JSON.stringify(BASE)}, life: createLifetime(), prefs: globalThis.__tracePrefs || {}, pet: globalThis.__tracePet || null })`
  const plugins = behaviors ? [{
    name: 'trace-behaviors',
    setup(build) {
      build.onLoad({ filter: /model-profile\.ts$/ }, async (args) => {
        const text = await readFile(args.path, 'utf8')
        const replaced = text.replace(/export const BEHAVIORS: readonly string\[\] = \[[^\]]*\];/, `export const BEHAVIORS: readonly string[] = ${JSON.stringify(behaviors)};`)
        if (replaced === text) throw new Error('model-profile.ts BEHAVIORS를 찾지 못함')
        return { contents: replaced, loader: 'ts' }
      })
    },
  }] : []
  const out = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', charset: 'utf8', write: false, logLevel: 'silent', plugins })
  return out.outputFiles[0].text
}

// 결정적 난수 (mulberry32)
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const r6 = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)
// 기록에 남기는 소수는 플랫폼 수학 함수의 마지막 비트 차이(Windows x64 ↔ macOS arm64)가 드러나지 않게 4자리로 반올림
const r4 = (v) => Math.round(v * 1e4) / 1e4
/** 문자열 안 긴 소수(예: "645.8496595938394px") 4자리 반올림 */
const roundText = (text) => String(text).replace(/-?\d+\.\d{5,}/g, (m) => String(r4(Number(m))))
/** 펫 메시지 등 객체 안 숫자·문자열 소수 4자리 반올림 */
const roundDeep = (value) => typeof value === 'number' ? r4(value) : typeof value === 'string' ? roundText(value)
  : Array.isArray(value) ? value.map(roundDeep) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundDeep(v)])) : value

function installFakeModel(win, clock, sink) {
  // 파라미터: 처음 쓰는 이름은 자동으로 등록 (범위 -30..30)
  class CoreModel {
    constructor() {
      this.values = new Map(); this.saved = null
      // 모델 그림 영역 1000×2000 안에 몸 부위 drawable 8개. 부위 파트(머리·허리·아래·다리·귀·가슴·팔)를 달아 터치 판정이 동작하게 한다
      // (텍스처가 없으므로 알파 판정은 늘 '그림 있음', 겹치면 그리기 순서가 큰 쪽)
      const rects = [[300, 0, 700, 500], [250, 400, 750, 900], [200, 800, 800, 1300], [250, 1200, 750, 2000], [150, 0, 300, 300], [700, 0, 850, 300], [350, 700, 650, 950], [380, 150, 620, 450]]
      const quad = ([x0, y0, x1, y1]) => Float32Array.from([x0, y0, x1, y0, x1, y1, x0, y1])
      this.verts = rects.map(quad)
      this.model = {
        drawables: {
          count: rects.length, opacities: new Float32Array(rects.length).fill(1), dynamicFlags: new Uint8Array(rects.length).fill(1),
          parentPartIndices: Int32Array.from([0, 1, 2, 3, 4, 4, 5, 6]), vertexPositions: this.verts,
          renderOrders: Int32Array.from(rects.keys()), textureIndices: new Int32Array(rects.length),
          indices: rects.map(() => Uint16Array.from([0, 1, 2, 0, 2, 3])), vertexUvs: rects.map(() => new Float32Array(8)),
        },
        // 머리(Part99)·허리(Part89)·아래(Part97)·다리(Part114)·귀(Part159)·가슴(Part88)·팔(Part127)
        parts: { count: 7, ids: ['Part99', 'Part89', 'Part97', 'Part114', 'Part159', 'Part88', 'Part127'], opacities: new Float32Array(7).fill(1), parentIndices: Int32Array.from([-1, -1, -1, -1, -1, -1, -1]) },
        parameters: { count: 0, values: new Float32Array(0) },
        update() {},
      }
    }
    getModel() { return this.model }
    getParameterIndex(id) { if (!this.values.has(id)) this.values.set(id, 0); return [...this.values.keys()].indexOf(id) }
    getParameterMinimumValue() { return -30 }
    getParameterMaximumValue() { return 30 }
    getParameterValueById(id) { return this.values.get(id) ?? 0 }
    setParameterValueById(id, v, w = 1) { const cur = this.values.get(id) ?? 0; this.values.set(id, w === 1 ? v : cur + (v - cur) * w) }
    addParameterValueById(id, v, w = 1) { this.values.set(id, (this.values.get(id) ?? 0) + v * w) }
    multiplyParameterValueById(id, v, w = 1) { this.values.set(id, (this.values.get(id) ?? 0) * (1 + (v - 1) * w)) }
    saveParameters() { this.saved = new Map(this.values) }
    loadParameters() { if (this.saved) this.values = new Map(this.saved) }
    update() {}
  }
  class InternalModel {
    constructor() { this.coreModel = new CoreModel(); this.motionManager = { expressionManager: null }; this.physics = { evaluate() {} }; this.eyeBlink = {}; this.breath = {} }
    getDrawableVertices(i) { return this.coreModel.verts[i] }
    // pixi-live2d-display cubism4 InternalModel.update 순서를 따른다 (모션 없음)
    update(dt, now) {
      const core = this.coreModel
      core.saveParameters()
      this.motionManager.expressionManager?.update(core, now / 1000)
      this.physics?.evaluate(core, dt / 1000)
      sink.params = Object.fromEntries([...core.values].filter(([, v]) => v !== 0).map(([k, v]) => [k, r6(v)]).sort(([a], [b]) => (a < b ? -1 : 1)))
      core.update()
      core.loadParameters()
    }
  }
  class Live2DModel {
    constructor() { this.internalModel = new InternalModel(); this.scale = { x: 1, y: 1, set: (v) => { this.scale.x = this.scale.y = v } }; this.x = 0; this.y = 0; this.textures = []; this.deltaTime = 0; this.elapsedTime = 0 }
    static async from() { return new Live2DModel() }
    update(dt) { this.deltaTime += dt; this.elapsedTime += dt }
    renderNow() { if (this.deltaTime) { this.internalModel.update(this.deltaTime, this.elapsedTime); this.deltaTime = 0 } }
    destroy() {}
  }
  // PIXI v6 Ticker의 동작(우선순위 순서, 최대 100ms, lastTime, start/stop과 rAF 예약)을 따른다
  class Ticker {
    constructor() { this.listeners = []; this.started = false; this.lastTime = -1; this.deltaMS = 1000 / 60; this.elapsedMS = 0; this.requestId = null }
    add(fn, ctx, priority = 0) { this.listeners.push({ fn, ctx, priority, order: this.listeners.length }); this.listeners.sort((a, b) => b.priority - a.priority || a.order - b.order); return this }
    update(t = clock.now) {
      if (t > this.lastTime) {
        let e = this.elapsedMS = t - this.lastTime
        if (e > 100) e = 100
        this.deltaMS = e
        for (const l of [...this.listeners]) l.fn.call(l.ctx, e / (1000 / 60))
      } else this.deltaMS = this.elapsedMS = 0
      this.lastTime = t
    }
    tick = (t) => { this.requestId = null; if (this.started) { this.update(t); if (this.started && this.requestId === null) this.requestId = win.requestAnimationFrame(this.tick) } }
    start() { if (this.started) return; this.started = true; if (this.requestId === null) { this.lastTime = clock.now; this.requestId = win.requestAnimationFrame(this.tick) } }
    stop() { this.started = false; if (this.requestId !== null) { win.cancelAnimationFrame(this.requestId); this.requestId = null } }
  }
  class Application {
    constructor(opts) {
      this.view = opts.view
      this.renderer = { resolution: opts.resolution, resize: () => { sink.resizes++ }, plugins: { interaction: { useSystemTicker: true } } }
      this.stage = { children: [], addChild: (c) => this.stage.children.push(c) }
      this.ticker = new Ticker()
      this.ticker.add(this.render, this, -25)
      if (opts.autoStart !== false) this.ticker.start()
    }
    render() { sink.renders++; for (const c of this.stage.children) c.renderNow?.() }
    destroy() {}
  }
  win.Live2DCubismCore = {}
  win.PIXI = { Application, UPDATE_PRIORITY: { HIGH: 25, NORMAL: 0, LOW: -25 }, live2d: { Live2DModel } }
}

// 가짜 시간: setTimeout·setInterval·requestAnimationFrame·performance.now가 같은 시계를 쓴다
function installFakeTime(win, clock) {
  let nextId = 1
  const timers = new Map(), frames = new Map()
  win.setTimeout = (fn, ms = 0, ...args) => { const id = nextId++; timers.set(id, { at: clock.now + Math.max(0, ms), fn: () => fn(...args), seq: id }); return id }
  win.clearTimeout = (id) => { timers.delete(id) }
  win.setInterval = (fn, ms = 0, ...args) => { const id = nextId++; const every = Math.max(1, ms); timers.set(id, { at: clock.now + every, every, fn: () => fn(...args), seq: id }); return id }
  win.clearInterval = (id) => { timers.delete(id) }
  win.requestAnimationFrame = (fn) => { const id = nextId++; frames.set(id, fn); return id }
  win.cancelAnimationFrame = (id) => { frames.delete(id) }
  win.requestIdleCallback = (fn) => win.setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 10 }), 1)
  Object.defineProperty(win.performance, 'now', { configurable: true, value: () => clock.now })
  return {
    // 지금 시각까지 만기된 타이머를 시각·등록 순서대로 실행
    runTimers() {
      for (;;) {
        let next = null
        for (const [id, t] of timers) if (t.at <= clock.now && (!next || t.at < next[1].at || (t.at === next[1].at && t.seq < next[1].seq))) next = [id, t]
        if (!next) return
        const [id, t] = next
        if (t.every) { t.at += t.every; t.seq = nextId++ } else timers.delete(id)
        t.fn()
      }
    },
    runFrame() { const list = [...frames.values()]; frames.clear(); for (const fn of list) fn(clock.now) },
  }
}

// 레이아웃이 없는 JSDOM에서 배치 코드가 읽는 크기를 스타일에서 결정적으로 계산한다
function installLayout(win, size) {
  const px = (v) => parseFloat(v) || 0
  const bubbleW = (el) => { const max = px(el.style.maxWidth) || 220; return Math.min(max, 24 + 13 * (el.textContent || '').length) }
  const bubbleH = (el) => { const max = px(el.style.maxWidth) || 220; return 18 + 22 * Math.max(1, Math.ceil((24 + 13 * (el.textContent || '').length) / max)) }
  const proto = win.HTMLElement.prototype
  const box = (el) => {
    if (el.classList.contains('dsc-composer')) return { left: 300, top: size.h - 220, width: 1000, height: 120 }
    if (el.id === 'dsc-bubble-status') {
      const w = Math.min(px(el.style.maxWidth) || 240, 30 + 11.5 * (el.textContent || '').length)
      const h = 14 + 16 * Math.max(1, Math.ceil(w / (px(el.style.maxWidth) || 240)))
      const left = el.style.left && el.style.left !== 'auto' ? px(el.style.left) : size.w - px(el.style.right) - w
      return { left, top: px(el.style.top), width: w, height: h }
    }
    if (el.id === 'dsc-bubble') {
      const w = bubbleW(el), h = bubbleH(el)
      const left = el.style.left && el.style.left !== 'auto' ? px(el.style.left) : size.w - px(el.style.right) - w
      return { left, top: px(el.style.top), width: w, height: h }
    }
    if (el.id === 'dsc-stage') return { left: px(el.style.left), top: px(el.style.top), width: px(el.style.width), height: px(el.style.height) }
    return { left: 0, top: 0, width: 0, height: 0 }
  }
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get() { return box(this).width } })
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get() { return box(this).height } })
  Object.defineProperty(proto, 'offsetLeft', { configurable: true, get() { return box(this).left } })
  Object.defineProperty(proto, 'offsetTop', { configurable: true, get() { return box(this).top } })
  proto.getBoundingClientRect = function () { const b = box(this); return { ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height } }
  Object.defineProperty(win, 'innerWidth', { configurable: true, get: () => size.w })
  Object.defineProperty(win, 'innerHeight', { configurable: true, get: () => size.h })
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  // JSDOM에는 Web Animations가 없다: 연출 요소(냄비 등)의 animate()는 길이만큼 지난 뒤 onfinish를 부르는 가짜로
  proto.animate = function (_keyframes, options) {
    const anim = { onfinish: null, cancel() { win.clearTimeout(timer) } }
    const timer = win.setTimeout(() => anim.onfinish?.(), typeof options === 'number' ? options : options?.duration ?? 0)
    return anim
  }
  win.document.elementFromPoint = () => null   // 캐릭터 위에 버튼·입력창이 없음
  win.devicePixelRatio = 1
}

// 정해 둔 입력(인트로 클릭·마우스·말하기·작업 상태·소품 설정·창 크기·절전)을 프레임 순서대로 넣고 기록을 돌려준다
// fallbackRegion: 시나리오가 찾는 부위가 없으면(예: 가슴 행동이 없어 가슴이 몸으로 판정) 대신 누를 부위
export async function runTrace(code, { pet = false, fallbackRegion = null } = {}) {
  const virtualConsole = new VirtualConsole()   // JSDOM의 "구현 안 됨" 경고(캔버스 등)는 버린다
  if (process.env.TRACE_CONSOLE) virtualConsole.on('warn', (...a) => console.error('[trace warn]', ...a))   // 캐릭터 코드의 오류 경고(배치 실패 등)를 보려면 TRACE_CONSOLE=1
  const dom = new JSDOM('<!doctype html><html><head></head><body><div class="x_root"><div class="x_card dsc-composer"><div class="x_input"></div></div></div></body></html>', { url: 'http://127.0.0.1/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })   // 보이는 화면(document.hidden=false). rAF는 아래에서 가짜로 바꾼다
  const win = dom.window, doc = win.document
  const clock = { now: 1000 }, size = { w: 1600, h: 960 }
  const sink = { params: null, resizes: 0, renders: 0 }
  const time = installFakeTime(win, clock)
  installFakeModel(win, clock, sink)
  installLayout(win, size)
  win.Math.random = seeded(20261108)
  win.fetch = async (url) => String(url).includes('/model/exp/') ? { ok: true, json: async () => ({ Parameters: [{ Id: 'ParamCheek', Value: 1, Blend: 'Add' }] }) }
    : String(url).endsWith('/dsc-lines.json') ? { ok: true, json: () => LINES_JSON } : { ok: false, json: async () => null }
  Object.defineProperty(doc, 'currentScript', { configurable: true, get: () => ({ src: BASE + 'dsc.js' }) })
  // 펫 모드: 펫 창 preload가 넣어 주는 통로를 가짜로 두고, 화면(모니터)·창 위치를 정해 둔다
  const petBus = { handler: null, sent: [] }
  if (pet) {
    win.__tracePet = {
      on: (fn) => { petBus.handler = fn },
      send: (m) => petBus.sent.push(m),
      move: (x, y) => petBus.sent.push({ move: [x, y] }),
      press: (on) => petBus.sent.push({ press: on }),
      menu: () => petBus.sent.push({ menu: true }),
    }
    for (const [key, value] of Object.entries({ screenX: 100, screenY: 50, outerWidth: size.w, outerHeight: size.h + 30 })) Object.defineProperty(win, key, { configurable: true, value })
    Object.defineProperty(win, 'screen', { configurable: true, value: { availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1400, width: 2560, height: 1440 } })
  }
  win.eval(code)
  const character = win.__traceCharacter
  const flush = () => new Promise((r) => setImmediate(r))
  const frames = []
  let frame = 0
  const step = async (ms) => {
    clock.now += ms
    time.runTimers()
    await flush()
    time.runFrame()
    await flush()
    const stage = doc.getElementById('dsc-stage'), bubble = doc.getElementById('dsc-bubble')
    const veil = [...doc.body.children].find((el) => el.style?.cssText?.includes('z-index: 29') || el.style?.zIndex === '29')
    const css = (el, keys) => el ? Object.fromEntries(keys.map((k) => [k, roundText(el.style[k] || '')])) : null
    frames.push({
      f: frame++, t: clock.now,
      canvas: css(stage, ['display', 'left', 'top', 'width', 'height', 'opacity', 'transform', 'clipPath']),
      bubble: bubble ? { text: bubble.textContent, cls: bubble.className, ...css(bubble, ['display', 'left', 'right', 'top', 'maxWidth', 'fontSize']) } : null,
      veil: veil ? veil.style.opacity : null,
      res: r6(win.__traceRes?.() ?? null),
      renders: sink.renders, resizes: sink.resizes,
      params: sink.params,
      overlays: doc.body.children.length,   // 냄비·충격 그림처럼 잠깐 붙는 연출 요소 수
      pet: pet ? roundDeep(petBus.sent.splice(0)) : undefined,
    })
    sink.params = null
  }
  const run = async (n, ms = 1000 / 60) => { for (let i = 0; i < n; i++) await step(ms) }
  const pointer = (type, x, y, target = doc) => target.dispatchEvent(new win.PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1, buttons: 0 }))
  // 시선은 window의 mousemove를, 터치·끌기는 pointer 이벤트를 듣는다
  // 캐릭터 위 지점을 터치 부위 이름으로 찾는다 (캔버스 안을 4px 간격으로 훑음)
  const spot = (name) => {
    const s = doc.getElementById('dsc-stage').getBoundingClientRect()
    for (let y = s.top + 2; y < s.bottom; y += 4) for (let x = s.left + 2; x < s.right; x += 4) if (win.__dsc.regionAt(x, y) === name) return [x, y]
    if (fallbackRegion && name !== fallbackRegion) return spot(fallbackRegion)
    throw new Error('부위를 찾지 못함: ' + name)
  }
  const press = (type, x, y, o = {}) => doc.getElementById('dsc-stage').dispatchEvent(new win.PointerEvent(type, {
    clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, ...o,
  }))
  // 같은 지점에서 누르고 dx·dy만큼 steps번에 나눠 움직인 뒤 뗀다 (한 걸음마다 frames프레임)
  const gesture = async ([x, y], dx, dy, { steps = 6, frames = 2, ...o } = {}) => {
    press('pointerdown', x, y, o); await run(frames)
    for (let i = 1; i <= steps; i++) { press('pointermove', x + dx * i / steps, y + dy * i / steps, o); await run(frames) }
    press('pointerup', x + dx, y + dy, o)
  }
  const touchScenarios = async () => {
    character.setPrefs({ outfit: {} })             // 꼬마 체형은 가슴 반응이 없어 기본 체형으로
    await run(120)
    await gesture(spot('head'), 0, 0, { steps: 0 }); await run(150)                  // 머리 터치
    await gesture(spot('head'), 0, 70, { steps: 10, frames: 4 }); await run(240)     // 천천히 쓸어내리기 (세숫대야)
    await gesture(spot('chest'), 0, 0, { steps: 0 }); await run(200)                 // 가슴 터치
    const chest = spot('chest')
    press('pointerdown', ...chest); await run(2)                                     // 가슴 끌어올리기 + 좌우로 흔들기
    for (let i = 1; i <= 8; i++) { press('pointermove', chest[0], chest[1] - 8 * i); await run(2) }
    for (let i = 0; i < 12; i++) { press('pointermove', chest[0] + (i % 2 ? 20 : -20), chest[1] - 64); await run(3) }
    press('pointerup', chest[0], chest[1] - 64); await run(260)
    await gesture(spot('lower'), -220, -60, { steps: 12, frames: 1, altKey: true }); await run(180)   // Alt 누른 채 집어 옮기기 → 자유 위치
    const body = spot('lower')
    for (let i = 0; i < 6; i++) { doc.getElementById('dsc-stage').dispatchEvent(new win.WheelEvent('wheel', { clientX: body[0], clientY: body[1], deltaY: -120, bubbles: true, cancelable: true })); await run(3) }
    await run(150)                                                                   // 휠로 키우기
  }
  // 캐릭터 고유 행동(냄비·세숫대야로 막기·삐짐·가슴 연타·아랫배 연타와 도망)을 끝까지 진행
  const tap = async (name, after) => { await gesture(spot(name), 0, 0, { steps: 0 }); await run(after) }
  const behaviorScenarios = async () => {
    await gesture(spot('head'), 0, 80, { steps: 2, frames: 1 }); await run(300)     // 빠르게 쓸어내리기 (냄비)
    await gesture(spot('head'), 0, 70, { steps: 10, frames: 4 }); await run(60)      // 세숫대야를 쓴 채로
    await gesture(spot('head'), 0, 80, { steps: 2, frames: 1 }); await run(120)     // 냄비를 막아 냄
    for (let i = 0; i < 3; i++) await tap('head', 30)                                 // 머리 3연타 → 삐짐
    await run(1200)                                                                   // 삐짐 15초 + 풀리며 한마디
    for (let i = 0; i < 5; i++) await tap('chest', 20)                                // 가슴 연타 → 가리기·떨림·진정
    await run(420)
    for (let i = 0; i < 5; i++) await tap('lower', 15)                                // 아랫배 연타 → 도망 후 복귀
    await run(800)
  }
  // 펫 창 쪽: 펫 프로세스(pet/main.cjs)와 창 안 캐릭터가 보내는 메시지를 순서대로 넣는다
  const emit = (m) => petBus.handler(m)
  const petScenario = async () => {
    await run(30)                                                                    // 숨은 채 대기 (ready)
    emit({ type: 'open', from: { k: 1, x: 200, y: 300 }, to: { x: 420, y: 320 }, follow: false }); await run(90)   // 던진 자리에서 나타나 미끄러짐
    emit({ type: 'cmd', list: [
      ['outfit', [{ glasses: true }]], ['dock', [{ k: 0.5, x: 900, y: 500, win: { l: 100, t: 80, r: 1700, b: 1040 } }]],
      ['say', ['펫 창에서 안녕하세요', 2000]], ['play', ['nod', 1300]], ['setMood', ['work', 0]], ['drag', ['Alt']], ['dragheld', ['f', true]], ['voice', [{ speaking: true, level: 0.6 }]],
    ] }); await run(120)                                                             // 창 안 캐릭터가 보낸 반응 재생
    emit({ type: 'size', ratio: 1.25 }); await run(60)                              // 우클릭 메뉴: 크기
    emit({ type: 'panel', focus: 'size' }); await run(30)                           // 우클릭 메뉴: 설정 패널
    emit({ type: 'power', on: false }); await run(20)                               // 창이 숨음 → 그리기 멈춤
    emit({ type: 'power', on: true }); await run(30)
    emit({ type: 'open', from: { k: 0.8, x: 300, y: 300 }, to: { x: 300, y: 300 }, follow: true, grab: { x: 50, y: 80 } }); await run(10)   // 끌어서 창 밖으로: 커서를 따라옴
    for (let i = 1; i <= 10; i++) { emit({ type: 'cursor', x: 400 + 30 * i, y: 400 + 5 * i }); await run(2) }
    emit({ type: 'cmd', list: [['release', [600, 0]]] }); await run(90)              // 창 밖에서 놓음 → 미끄러짐
    emit({ type: 'home' }); await run(120)                                           // 우클릭 메뉴: 창으로 돌아가기 (붙는 애니메이션)
  }
  const mouse = (x, y) => { win.dispatchEvent(new win.MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true })); pointer('pointermove', x, y) }

  if (pet) { await petScenario(); win.close(); return frames }
  await run(150)                                   // 인트로 대기 → 가운데 등장
  const veil = [...doc.body.children].find((el) => (el.getAttribute('style') || '').includes('z-index'))
  veil?.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }))
  await run(150)                                   // 제자리로 이동
  for (const [x, y] of [[200, 200], [1500, 300], [900, 800]]) { mouse(x, y); await run(60) }   // 시선 (눈이 먼저, 고개가 뒤따름)
  win.__dsc?.say('안녕하세요, 오늘 작업을 같이 해 봐요', 3000)
  await run(180)                                   // 입 모양·말풍선
  const stop = doc.createElement('button'); stop.setAttribute('aria-label', 'Stop generating'); doc.body.append(stop)
  await run(150)                                   // 작업 시작 반응
  const approval = doc.createElement('div'); approval.setAttribute('aria-label', 'Approval details'); doc.body.append(approval)
  await run(120)                                   // 승인 대기
  approval.remove(); await run(60)
  stop.remove(); await run(150)                    // 완료 반응
  character.setPrefs({ outfit: { glasses: true, chestClothes: true, earHide: true, bodyType: 'type2' } })
  await run(150)                                   // 소품·옷·체형
  size.w = 1200; size.h = 700; win.dispatchEvent(new win.Event('resize'))
  await run(120)                                   // 창 크기 변경
  await touchScenarios()
  await behaviorScenarios()
  await run(780, 100)                              // 입력 없이 78초 → 절전으로 나감
  mouse(600, 300); pointer('pointerdown', 600, 300)
  await run(240)                                   // 깨어나 돌아옴
  win.close()
  return frames
}

async function main() {
  const root = resolve(here, '../../..')
  if (process.argv.includes('--diff')) {
    const other = resolve(process.argv[process.argv.indexOf('--diff') + 1])
    const opts = { pet: process.argv.includes('--pet') }   // --pet: 펫 창 시나리오를 비교
    const [a, b] = [await runTrace(await bundleCharacter(other), opts), await runTrace(await bundleCharacter(root), opts)]
    const i = a.findIndex((f, k) => JSON.stringify(f) !== JSON.stringify(b[k]))
    if (i < 0 && a.length === b.length) { console.log(`같음: ${a.length} frames`); return }
    console.log(`처음 다른 프레임 ${i} (frames ${a.length} vs ${b.length})`)
    for (const key of Object.keys(a[i] ?? {})) if (JSON.stringify(a[i][key]) !== JSON.stringify(b[i]?.[key])) console.log(key, '\n  기준:', JSON.stringify(a[i][key]), '\n  지금:', JSON.stringify(b[i]?.[key]))
    process.exitCode = 1
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
