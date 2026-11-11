import test from 'node:test'
import { readSource } from './source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as layout from '../../character/layout.ts'
import * as chordFns from '../../character/chord.ts'
import { PARTS } from '../../character/model-profile.ts'

// dsc.js의 순수 계산/상태 조각을 그대로 실행해 확인한다. DOM·캔버스 없이 돌 수 있게
// 필요한 값만 vm 컨텍스트에 넣고, 실제 소스 구간(문자열 경계)을 잘라 쓴다.
const source = readSource(new URL('../../character/index.ts', import.meta.url))
// Live2D 렌더러(모델 불러오기·귀·해상도)는 character/rig-live2d.ts로 옮겨 감
const rigSource = readSource(new URL('../../character/rig-live2d.ts', import.meta.url))

const sliceBetween = (startText, endText, from = source) => {
  const start = from.indexOf(startText)
  const end = from.indexOf(endText, start)
  assert.ok(start >= 0, `소스에서 시작 지점을 찾지 못했습니다: ${startText}`)
  assert.ok(end > start, `소스에서 끝 지점을 찾지 못했습니다: ${endText}`)
  return from.slice(start, end)
}
const runScript = (script, context, expose) => vm.runInContext(`${script}\n${expose}`, vm.createContext(context))

test('말풍선 꼬리는 코에 맞추고, 화면 경계는 최소 여백만 남긴다', () => {
  const { tailRight, tailLeft, BUBBLE_TAIL } = layout
  assert.equal(BUBBLE_TAIL, 55)

  // 꼬리(오른쪽 55px)의 중심이 정확히 코(noseX)에 온다: width - right - 55 === noseX
  const right = tailRight({ noseX: 300, width: 1000 })
  assert.equal(right, 645)
  assert.equal(1000 - right - 55, 300)

  // 코가 오른쪽 끝에 붙어도 오른쪽 여백(HOME_GAP=8px)보다 좁아지지 않는다
  assert.equal(tailRight({ noseX: 980, width: 1000 }), 8)
  assert.equal(tailRight({ noseX: 1200, width: 1000 }), 8)

  // 등장 연출(왼쪽 기준): 꼬리가 코에 오게 두고 화면 안으로 자른다
  assert.equal(tailLeft({ noseX: 300, bw: 200, width: 1000 }), 155)
  assert.equal(155 + 200 - 55, 300)
  // 오른쪽으로 넘치면 오른쪽 여백만 남기고 당긴다
  assert.equal(tailLeft({ noseX: 990, bw: 200, width: 1000 }), 1000 - 200 - 8)
  // 왼쪽으로 넘치면 왼쪽 여백으로 자른다
  assert.equal(tailLeft({ noseX: 20, bw: 300, width: 330 }), 8)
  // 말풍선 폭이 화면보다 넓으면 왼쪽 여백을 지킨다
  assert.equal(tailLeft({ noseX: 50, bw: 400, width: 330 }), 8)
})

test('짧은 말풍선은 꼬리를 말풍선 폭 절반 안쪽으로 좁힌다', () => {
  const { bubbleTail, tailRight, tailLeft } = layout
  // 넓은 말풍선(폭 106px 이상)은 기존 55px 그대로
  assert.equal(bubbleTail(300), 55)
  assert.equal(bubbleTail(106), 55)
  // 한두 글자 말풍선: 꼬리 끝 = 폭 절반 + 2px (CSS 꼬리 가운데가 말풍선 가운데)
  assert.equal(bubbleTail(40), 22)
  // 폭을 아직 모르면 기존 값
  assert.equal(bubbleTail(0), 55)
  // 좁힌 만큼 오른쪽 기준을 보정해 꼬리 끝은 계속 코에 온다
  assert.equal(1000 - tailRight({ noseX: 300, width: 1000, tail: 22 }) - 22, 300)
  assert.equal(tailLeft({ noseX: 300, bw: 40, width: 1000, tail: 22 }) + 40 - 22, 300)
})

test('시작 연출 말풍선은 제자리로 옮겨 가는 동안 평소 크기로 줄어든다', async () => {
  const { introBubbleSize, REST_BUBBLE } = layout
  // 가운데(진행도 0)는 큰 말풍선, 도착(1)은 평소 크기와 지금 배율의 최대폭
  assert.deepEqual(introBubbleSize(0, 200), { font: 22, padY: 14, padX: 24, maxWidth: 560 })
  assert.deepEqual(introBubbleSize(1, 200), { font: 13, padY: 9, padX: 14, maxWidth: 200 })
  // 중간은 캐릭터 배율과 같은 진행도만큼
  assert.deepEqual(introBubbleSize(0.5, 200), { font: 17.5, padY: 11.5, padX: 19, maxWidth: 380 })
  // 진행도 범위 밖은 양 끝으로 자름
  assert.deepEqual(introBubbleSize(-1, 200), introBubbleSize(0, 200))
  assert.deepEqual(introBubbleSize(2, 200), introBubbleSize(1, 200))
  // 도착 순간 인라인 스타일을 지우고 CSS 기본값으로 돌아가므로 평소 값은 CSS와 같아야 함
  const css = await readFile(new URL('../../assets/character.css', import.meta.url), 'utf8')
  const rule = css.match(/#dsc-bubble \{\r?\n[^}]*\}/)[0]
  assert.match(rule, new RegExp(`padding: ${REST_BUBBLE.padY}px ${REST_BUBBLE.padX}px;`))
  assert.match(rule, new RegExp(`font: 600 ${REST_BUBBLE.font}px/`))
})

test('터치 제스처: 가로 끌기는 집기, 세로 움직임은 쓰다듬기, 가만히 길게 누르면 집기', () => {
  const slice = sliceBetween('const TOUCH = {', 'life.listen(document, "pointermove"')
  const { touchGesture, TOUCH } = runScript(slice, {}, '({ touchGesture, TOUCH })')
  assert.equal(TOUCH.grabMs, 320)
  assert.equal(TOUCH.verticalPx, 8)

  assert.equal(touchGesture({ dx: 20, dy: 2 }), 'grab')       // 가로 끌기
  assert.equal(touchGesture({ dx: 20, dy: 10 }), 'grab')      // 가로 우세(1.2배 이상)
  assert.equal(touchGesture({ dx: 6, dy: 12 }), 'stroke')     // 세로 8px 초과 → 쓰다듬기 (길게 누르기 아님)
  assert.equal(touchGesture({ dx: 0, dy: 10, heldMs: 5000 }), 'stroke')   // 느린 세로 스트로크도 집기로 바뀌지 않는다
  assert.equal(touchGesture({ dx: 0, dy: 0, heldMs: 100 }), 'wait')
  assert.equal(touchGesture({ dx: 0, dy: 0, heldMs: 330 }), 'grab')       // 가만히 길게 누르면 집기
  assert.equal(touchGesture({ dx: 3, dy: 3, heldMs: 330 }), 'grab')
})

test('이동 키가 빈 문자열이면 드래그 보조 키가 꺼진다', () => {
  const slice = sliceBetween('const dragKeyRaw =', 'const TOUCH = {')
  const context = { prefs: {}, PET: false, link: { open: false }, linkPost() {}, addEventListener() {} }
  const { dragKeyToken, dragKeyHeld, rememberKey } = runScript(
    slice, context, '({ dragKeyRaw, dragKeyToken, dragKeyHeld, rememberKey })')
  const setKey = (key) => { context.prefs.drag = { key } }

  setKey('')
  assert.equal(dragKeyToken(), '')
  assert.equal(dragKeyHeld({ buttons: 1, altKey: true }), false)   // 빈 값이면 Alt 로 되돌아가지 않는다
  assert.equal(dragKeyHeld({ buttons: 1 }), false)
  setKey('None')
  assert.equal(dragKeyHeld({ buttons: 1 }), false)

  setKey('Alt')
  assert.equal(dragKeyToken(), 'alt')
  assert.equal(dragKeyHeld({ buttons: 1, altKey: true }), true)
  assert.equal(dragKeyHeld({ buttons: 1 }), false)                 // Alt 를 안 누르면 끌기 아님
  assert.equal(dragKeyHeld({ buttons: 0, altKey: true }), false)   // 왼쪽 버튼 없이는 끌기 아님

  setKey('F')                                                      // 일반 키 하나
  assert.equal(dragKeyHeld({ buttons: 1 }), false)
  rememberKey({ key: 'f' }, true)
  assert.equal(dragKeyHeld({ buttons: 1 }), true)
  rememberKey({ key: 'f' }, false)
  assert.equal(dragKeyHeld({ buttons: 1 }), false)
})

test('캔버스 숨김: 숨기면 그리기만 멈추고 칩을 남기며, 복구하면 제자리로 돌아온다', () => {
  const { setHidden, syncHideChip, hideChipVisible, hidden, chip, wakeCalls } = runChipContext()
  assert.equal(hidden(), false)

  setHidden(true)
  assert.equal(hidden(), true)
  assert.equal(setHidden(true), true)          // 같은 값이면 아무 것도 하지 않는다
  assert.ok(chip(), '숨김 상태에서는 복구 칩이 있어야 한다')
  assert.equal(setHidden(false), false)
  assert.equal(chip(), null, '복구하면 칩을 지운다')
  // 그리기를 다시 켜는 setRender(true)도 깨우므로 호출은 여러 번일 수 있다 (실제 wakeRaf는 쉬는 중일 때만 동작)
  assert.ok(wakeCalls() >= 1, '복구하면 펫 창 때문에 쉬던 배치 루프를 깨운다')
})

test('복구 칩은 모바일 숨김 설정이면 남지 않고, 설정을 되돌리면 다시 보인다', () => {
  const h = runChipContext()
  h.setHidden(true)
  assert.ok(h.chip())

  h.setMobileHidden(true)       // 설정에서 모바일 표시를 껐다 → 칩도 모바일에 남기지 않는다
  h.syncHideChip()
  assert.equal(h.chip(), null)
  assert.equal(h.hideChipVisible(), false)

  h.setMobileHidden(false)      // 설정을 되돌리면 다음 동기화에 칩이 다시 보인다 (복구 경로 유지)
  h.syncHideChip()
  assert.ok(h.chip())
  assert.equal(h.hideChipVisible(), true)

  h.setMobileHidden(true)
  h.setHidden(false)            // 칩 없이도 설정/단축키로 복구된다
  assert.equal(h.hidden(), false)
  assert.equal(h.chip(), null)
})

test('모바일 숨김 설정에서는 새 숨김에도 칩을 만들지 않는다', () => {
  const h = runChipContext()
  h.setMobileHidden(true)
  h.setHidden(true)
  assert.equal(h.hidden(), true)
  assert.equal(h.chip(), null)
  h.setHidden(false)
})

test('그리기 여부는 바뀔 때만 반영하고, 다시 켜면 멈춘 시간을 건너뛰고 쉬던 배치 루프를 깨운다', () => {
  const slice = sliceBetween('let renderOn = true;', 'const place = () =>')
  const ticker = { lastTime: 5, update() {} }
  const context = { rig: { resetClock: () => { ticker.lastTime = 1000 } }, wakes: 0, performance: { now: () => 1000 } }
  const { setRender, rendering } = runScript(`let wakes = 0; const wakeRaf = () => { wakes++ };\n${slice}`, context,
    '({ setRender, rendering: () => renderOn, wakes: () => wakes })')
  assert.equal(rendering(), true, '창이 보이기 전에 첫 그리기를 끝내 두도록 처음엔 켜져 있다')
  setRender(true)
  assert.equal(ticker.lastTime, 5, '이미 켜져 있으면 아무것도 바꾸지 않는다')
  setRender(false)
  setRender(false)
  assert.equal(rendering(), false)
  setRender(true)
  assert.equal(rendering(), true)
  assert.equal(ticker.lastTime, 1000, '멈춰 있던 시간만큼 모델이 한꺼번에 움직이지 않게 기준 시각을 지금으로')
})

test('한 프레임 안에서 배치가 먼저 돌고 그 다음에 모델 갱신·그리기가 돈다', () => {
  // 배치(크기·해상도 변경)가 그리기보다 늦으면 resize로 지워진 버퍼가 화면에 나간다(인트로 이동 중 사라짐)
  const calls = []
  const context = {
    PET: false, petPower: false, hidden: false, SLEEP: { state: 'active' }, link: { open: false },
    rig: { resetClock() {}, tick: (time) => calls.push(`update@${time}`) },
    console,
    performance: { now: () => 0 },
    place: () => calls.push('place'),
    syncHideChip: () => calls.push('chip'),
    pageHiddenNow: () => false,
    systemTicker: () => {},
    requestAnimationFrame: () => calls.push('next'),
  }
  const script = [
    'let placeErrorWarned = false;',
    sliceBetween('let renderOn = true;', 'const place = () =>'),
    sliceBetween('let rafIdle = false;', '\n      requestAnimationFrame(raf);'),
  ].join('\n')
  const { raf, setRender } = runScript(script, context, '({ raf, setRender })')

  raf(16)
  assert.deepEqual(calls, ['place', 'update@16', 'next'])

  // 그리기를 끄면 배치만 돌고 티커는 건드리지 않는다
  calls.length = 0
  setRender(false)
  raf(32)
  assert.deepEqual(calls, ['place', 'next'])

  // 배치가 실패해도 그 프레임 그리기는 그대로 한다
  calls.length = 0
  setRender(true)
  context.place = () => { calls.push('place'); throw new Error('boom') }
  const warn = console.warn
  console.warn = () => {}
  try { raf(48) } finally { console.warn = warn }
  assert.deepEqual(calls, ['place', 'update@48', 'next'])
})

test('렌더 해상도는 실제로 바뀔 때만 버퍼를 다시 만든다', () => {
  const body = sliceBetween('setResolution(k) { ', ' },\n', rigSource).slice('setResolution(k) { '.length)
  const slice = `const setRes = (k) => { ${body} }`
  const calls = []
  const app = { renderer: { resolution: 3, resize: (w, h) => calls.push(`resize ${w}x${h}@${app.renderer.resolution}`) } }
  const setRes = runScript(slice, { app, DPR: 3, W: 300, H: 300 }, 'setRes')
  setRes(1.5)
  assert.deepEqual(calls, ['resize 300x300@4.5'])
  calls.length = 0
  setRes(1.5); setRes(1)
  assert.deepEqual(calls, ['resize 300x300@3'])
  // 배율 1 이하는 해상도가 그대로(DPR)라 버퍼를 건드리지 않는다
  calls.length = 0
  setRes(0.6); setRes(0.42)
  assert.deepEqual(calls, [])
})

// 캔버스를 숨긴 동안의 펫 창 단축키는 plugin/test/pet-link.test.js에서 연결 모듈을 직접 실행해 확인한다

test('동물귀 파트 lookup: Part159 인덱스를 찾고, 없으면 -1로 안전하게 넘긴다', () => {
  const slice = sliceBetween('const EAR_PART_ID = PARTS.animalEars;', '\n  // ---------- 터치용 메시 판정', rigSource)
  const cm = {
    parts: { ids: ['Part81', 'Part156', 'Part159'] },
    drawables: { count: 1, parentPartIndices: [2], opacities: [1], dynamicFlags: [1] },
  }
  const api = runScript(slice, { cubismModel: cm, prefs: {}, PARTS }, `({
    earPartIndexFor, earPartIndex, earDrawables,
    earPartIndexMissing: earPartIndexFor(['Part81'], 'Part159'),
    earPartIndexNull: earPartIndexFor(null, 'Part159'),
  })`)
  assert.equal(PARTS.animalEars, 'Part159')   // 이 모델의 동물귀 파트 ID (model-profile.ts)
  assert.equal(api.earPartIndex, 2)
  assert.equal(api.earPartIndexMissing, -1)
  assert.equal(api.earPartIndexNull, -1)
  assert.deepEqual(Array.from(api.earDrawables), [0])
})

test('귀 파트 opacity만 바꾸고 다른 파트·기하(model.x/scale)는 건드리지 않는다', () => {
  const slice = sliceBetween('const EAR_PART_ID = PARTS.animalEars;', '\n  // ---------- 터치용 메시 판정', rigSource)
  const cm = { parts: { ids: ['Part159'], opacities: new Float32Array([1]) }, drawables: { count: 0, parentPartIndices: [], opacities: [], dynamicFlags: [] } }
  const model = { x: 12.5, y: -3, scale: { x: 0.42, y: 0.42 } }
  const { applyEarOpacity, earOpacityValue } = runScript(slice, { cubismModel: cm, prefs: {}, PARTS }, '({ applyEarOpacity, earOpacityValue })')
  const parts = { opacities: new Float32Array([1, 1, 1, 1]) }
  const before = { x: model.x, y: model.y, sx: model.scale.x, sy: model.scale.y }
  assert.equal(applyEarOpacity(parts, 2, 1), true)
  assert.equal(parts.opacities[2], 0)
  assert.deepEqual([...parts.opacities], [1, 1, 0, 1])
  assert.equal(applyEarOpacity(parts, 2, 0.5), true)
  assert.equal(parts.opacities[2], earOpacityValue(0.5))
  assert.deepEqual(before, { x: model.x, y: model.y, sx: model.scale.x, sy: model.scale.y })
  // 없는 파트/빈 parts는 조용히 no-op (예외 없음)
  const untouched = new Float32Array([1, 1])
  assert.equal(applyEarOpacity({ opacities: untouched }, -1, 1), false)
  assert.equal(applyEarOpacity(null, 0, 1), false)
  assert.deepEqual([...untouched], [1, 1])
})

test('귀 숨김은 부드럽게 0..1 사이로 보간되고, 끄면 원래대로 돌아온다', () => {
  const slice = sliceBetween('const EAR_PART_ID = PARTS.animalEars;', '\n  // ---------- 터치용 메시 판정', rigSource)
  const cm = { parts: { ids: ['Part159'] }, drawables: { count: 0, parentPartIndices: [], opacities: [], dynamicFlags: [] } }
  const { earOpacityStep, earOpacityValue, setEarW, getEarW } = runScript(slice, { cubismModel: cm, prefs: {}, PARTS }, '({ earOpacityStep, earOpacityValue, setEarW: (v) => { earWeight = v }, getEarW: () => earWeight })')
  let w = 0
  w = earOpacityStep(w, true, 0.1)
  assert.ok(w > 0 && w < 1, '한 프레임에 1로 점프하지 않는다')
  for (let i = 0; i < 40; i++) w = earOpacityStep(w, true, 0.1)
  assert.equal(w, 1)
  assert.equal(earOpacityValue(w), 0)
  for (let i = 0; i < 40; i++) w = earOpacityStep(w, false, 0.1)
  assert.ok(Math.abs(w) < 1e-9, '끄면 0으로 돌아온다')
  assert.equal(earOpacityValue(0), 1)
  // dt가 커도 0..1 범위를 벗어나지 않는다
  assert.equal(earOpacityStep(0, true, 10), 1)
  assert.equal(earOpacityStep(1, false, 10), 0)
  setEarW(0.25)
  assert.equal(getEarW(), 0.25)
})

test('귀 터치 판정: earHide 감쇠 전 가시성을 유지하되, 다른 원인으로 숨은 귀는 되살리지 않는다', () => {
  const slice = sliceBetween('const EAR_PART_ID = PARTS.animalEars;', '\n  // ---------- 터치용 메시 판정', rigSource)
  const make = (opacities, flags) => {
    const cm = {
      parts: { ids: ['Part159'] },
      drawables: { count: 2, parentPartIndices: [0, 0], opacities: new Float32Array(opacities), dynamicFlags: new Uint8Array(flags) },
    }
    return { cm, api: runScript(slice, { cubismModel: cm, prefs: {}, PARTS }, '({ earHitVisible, earBaseVisible, setEarW: (v) => { earWeight = v } })') }
  }
  const normal = make([1, 1], [1, 1])
  assert.equal(normal.api.earBaseVisible.get(0), true)
  normal.api.setEarW(0)
  assert.equal(normal.api.earHitVisible(0), true)
  // earHide가 꺼져 있으면 현재 상태 그대로: 다른 원인이 opacity/flag를 0으로 만들면 클릭 불가
  normal.cm.drawables.opacities[0] = 0
  normal.cm.drawables.dynamicFlags[0] = 0
  assert.equal(normal.api.earHitVisible(0), false, '다른 원인으로 숨은 귀를 클릭 가능하게 만들면 안 된다')
  // earHide로 감쇠 중(코어가 flag까지 끔)에는 감쇠 전 가시성으로 기존 터치 판정 유지
  normal.cm.drawables.opacities[0] = 0.4
  normal.cm.drawables.dynamicFlags[0] = 0
  normal.api.setEarW(0.6)
  assert.equal(normal.api.earHitVisible(0), true)
  // 감쇠 전에도 보이지 않던 drawable은 계속 제외
  const hiddenAtBase = make([1, 0], [1, 0])
  hiddenAtBase.api.setEarW(1)
  assert.equal(hiddenAtBase.api.earHitVisible(1), false)
})

test('worker는 전달받은 parts opacities(귀 포함)를 Core 모델에 그대로 적용한다', async () => {
  const source = await readFile(new URL('../../assets/dsc-core-worker.js', import.meta.url), 'utf8')
  const P = 2, N = 2, partsCount = 3, earPart = 1
  const model = {
    parameters: { count: P, values: new Float32Array(P) },
    parts: { count: partsCount, opacities: new Float32Array(partsCount).fill(1) },
    updates: 0,
    update() { this.updates++ },
    drawables: {
      count: N,
      vertexPositions: [new Float32Array(6), new Float32Array(6)],
      opacities: new Float32Array(N).fill(1),
      drawOrders: new Int32Array(N),
      renderOrders: new Int32Array(N),
      multiplyColors: new Float32Array(N * 4).fill(1),
      screenColors: new Float32Array(N * 4),
      dynamicFlags: new Uint8Array(N).fill(1),
      resetDynamicFlags() {},
    },
  }
  const messages = []
  const context = {
    importScripts() {}, postMessage(message) { messages.push(message) }, onmessage: null, console,
    fetch: async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }),
    Live2DCubismCore: { Moc: { fromArrayBuffer: () => ({}) }, Model: { fromMoc: () => model } },
    ArrayBuffer, Uint8Array, Uint16Array, Int32Array, Float32Array, Math, Promise, setTimeout, clearTimeout, String,
  }
  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'dsc-core-worker.js' })
  context.onmessage({ data: { type: 'init', url: 'memory://model.moc3' } })
  for (let i = 0; i < 50 && !messages.some((m) => m.type === 'ready'); i++) await new Promise((r) => setTimeout(r, 10))
  assert.ok(messages.some((m) => m.type === 'ready'), 'worker가 준비되어야 한다')
  const input = new Float32Array(P + partsCount)
  input[P] = 1
  input[P + earPart] = 0
  context.onmessage({ data: { type: 'frame', inp: input.buffer, out: null } })
  assert.ok(model.updates > 0)
  assert.equal(model.parts.opacities[earPart], 0, 'worker가 전달받은 귀 파트 opacity를 적용해야 한다')
  assert.equal(model.parts.opacities[0], 1, '다른 파트 opacity는 그대로')
})

test('좌우 버튼 코드: 첫 버튼 누른 채 150ms 이내 두 번째 버튼이면 grab, 떨어진 클릭/단일 버튼은 제외', () => {
  const { chordDown, chordWithinGrace, chordUp, CHORD_GRACE_MS } = chordFns
  assert.equal(CHORD_GRACE_MS, 150)
  const empty = { at: null, button: null, valid: false }

  // 좌 → 우: 첫 버튼을 누른 뒤 100ms/150ms(경계 포함)는 코드, 151ms는 코드 아님
  let c = chordDown(empty, 0, 1, 1000); c.valid = true
  assert.equal(chordWithinGrace(c, 2, 3, 1100), true)
  assert.equal(chordWithinGrace(c, 2, 3, 1150), true)
  assert.equal(chordWithinGrace(c, 2, 3, 1151), false)
  assert.equal(chordWithinGrace(c, 2, 3, 999), false, '첫 버튼보다 이른 시각은 코드가 아님')

  // 우 → 좌
  c = chordDown(empty, 2, 2, 5000); c.valid = true
  assert.equal(chordWithinGrace(c, 0, 3, 5100), true)
  assert.equal(chordWithinGrace(c, 0, 3, 5151), false)

  // 같은 버튼 반복(단일 버튼)은 코드가 아님
  assert.equal(chordWithinGrace(c, 2, 3, 5050), false)

  // 떨어진 두 클릭: 첫 버튼이 이미 떼어져 있으면(buttons 비트 없음) 코드 아님
  c = chordDown(empty, 0, 1, 0); c.valid = true
  assert.equal(chordWithinGrace(c, 2, 2, 100), false)

  // 캐릭터 밖에서 시작(valid=false)은 그레이스 대상 아님
  assert.equal(chordWithinGrace(chordDown(empty, 0, 1, 0), 2, 3, 50), false)

  // release/cancel: 모두 떼면 초기화, 한쪽이 남아 있으면 유지
  c = chordDown(empty, 0, 1, 0); c.valid = true
  assert.equal(chordUp(c, 0).valid, false)
  assert.equal(chordUp(c, 1).valid, true)
  // 두 번째 버튼을 눌러도 첫 버튼의 시각은 유지된다
  c = chordDown(empty, 0, 1, 100)
  assert.deepEqual(chordDown(c, 2, 3, 120), c)
})

test('코드 그레이스는 기존 양쪽 hold(임의 간격) 판정을 150ms로 제한하지 않는다', async () => {
  const source = readSource(new URL('../../character/index.ts', import.meta.url))
  assert.match(source, /if \(\(e\.buttons & 1\) && chordWithinGrace\(chord, e\.button, e\.buttons, nowDown\)\)/)
  assert.match(source, /const both = \(e\.buttons & 3\) === 3 \|\| touchGrab \|\| dragKeyHeld\(e\)/)
  assert.match(source, /chord = chordUp\(chord, e\.buttons\)/)
  assert.match(source, /chord = chordUp\(chord, 0\)/)   // blur/cancel 정리
  assert.match(source, /chord\.valid = true;   \/\/ 캐릭터 위에서 시작한 누름만/)
})

function runChipContext() {
  const context = {
    PET: false,
    mobileHiddenNow: false,
    placeCalls: 0,
    removed: 0,
    hiddenNow: false,
    prefs: { pageHidden: false },
    hooks: {},
    addEventListener() {},
    systemTickerCalls: [],
    // 캐릭터 소스가 쓰는 수명 객체(character/lifetime.js) 대역: 리스너는 대상에 그대로 붙이고 DOM 노드는 그대로 돌려준다
    life: { listen: (target, type, fn, options) => target.addEventListener(type, fn, options), own: (value) => value, add() {}, stopped: false },
    document: {
      createElement() {
        return {
          id: '', textContent: '', type: '', listeners: [],
          addEventListener(type, fn) { this.listeners.push(fn) },
          remove() { context.removed++; this.removed = true },
        }
      },
      body: { append() {} },
      documentElement: { classList: { remove() {} } },
    },
    rig: { resetClock() {}, tick() {} },
    SLEEP: { state: 'active', lastActive: 0 },
    drag: { pending: null, on: false },
    link: { open: false, follow: null, opening: 0 },
    hush() {},
    linkPost() {},
    requestAnimationFrame() {},
    setTimeout() { return 0 },
    clearTimeout() {},
    performance: { now: () => 0 },
    canvas: { style: {} },
    bubble: { style: {} },
    bubbleStatus: { style: {} },
    veil: { style: {} },
    out: {},
  }
  const preamble = [
    'let hidden = false;',
    'let pageHiddenApplied = false;',
    'let sleepTimer = 0, cancelSleepSlide = null, fleeX = 0, strokeFrom = null, chestFrom = null, lastPlaceKey = "";',
    'const pageHiddenNow = () => !PET && prefs.pageHidden === true;',
    'const setBubbleDisplay = (value) => { bubble.style.display = bubbleStatus.style.display = value; };',
    'const mobileHidden = () => mobileHiddenNow;',
    'const place = () => { placeCalls++ };',
    'let rafIdle = false;',
    'const systemTicker = (on) => { systemTickerCalls.push(on) };',
    'let wakeCalls = 0; const wakeRaf = () => { rafIdle = false; wakeCalls++ };',
  ].join('\n')
  const script = [
    preamble,
    sliceBetween('const hideChipVisible =', 'let placeErrorWarned'),
    sliceBetween('let renderOn = true;', 'const place = () =>'),
    sliceBetween('let hideChip = null;', '      if (!PET) {'),
  ].join('\n')
  const api = runScript(script, context, `({
    setHidden, showHideChip, clearHideChip, syncHideChip, hideChipVisible, setRender,
    hidden: () => hidden,
    chip: () => hideChip,
    placeCalls: () => placeCalls,
    wakeCalls: () => wakeCalls,
    rendering: () => renderOn,
    removed: () => removed,
    canvas: canvas.style, bubble: bubble.style, veil: veil.style,
  })`)
  // fragment 안에서 쓴 전역 헬퍼 접근용 (setMobileHidden 은 숨김 설정 토글)
  api.setMobileHidden = (on) => { context.mobileHiddenNow = on }
  return api
}
