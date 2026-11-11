import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../host.js'
import { AO_CACHE_LIMIT, AVATAR_CACHE_PATH, cacheKeyOf, createAoCacheHandler, defaultCacheDir, resolveModelFile } from '../avatar-cache.js'
import { AO_CACHE_VERSION, aoCacheMatches, decodeAoCache, encodeAoCache } from '../../shared/ao-cache.js'

// 3D 모델 AO 굽기 캐시: 호스트가 모델 파일·굽기 설정으로 키를 정하고, 인증된 요청만 형식이 맞는 파일을 저장·전달한다

const sample = (params = 'abc123') => encodeAoCache({ params, meshes: [{ name: 'Body', count: 3 }, { name: 'Hair', count: 2 }], data: Uint8Array.of(255, 128, 0, 10, 20) })

test('캐시 키는 모델 경로·크기·수정 시각·굽기 설정·형식 버전 중 하나만 바뀌어도 달라진다', () => {
  const base = { path: 'm/a.vrm', size: 100, mtimeMs: 1700000000000.5, params: 'abc' }
  const key = cacheKeyOf(base)
  assert.match(key, /^[0-9a-f]{64}$/)
  assert.equal(cacheKeyOf({ ...base }), key, '같은 입력이면 같은 키')
  for (const change of [{ path: 'm/b.vrm' }, { size: 101 }, { mtimeMs: 1700000000001 }, { params: 'abd' }, { version: AO_CACHE_VERSION + 1 }]) {
    assert.notEqual(cacheKeyOf({ ...base, ...change }), key, JSON.stringify(change))
  }
})

test('캐시 폴더 기본 위치는 pet-runtime과 같은 규칙(macOS Application Support, 그 밖은 LOCALAPPDATA·~/.cache)이다', () => {
  assert.match(defaultCacheDir('darwin'), /Library[\\/]Application Support[\\/]deepseek-harness-kr[\\/]avatar-cache$/)
  assert.match(defaultCacheDir('win32'), /deepseek-harness-kr[\\/]avatar-cache$/)
  assert.doesNotMatch(defaultCacheDir('linux'), /Library/)
})

test('캐시 파일 형식: 되읽기, 표지·버전·길이·정점 수 합이 틀리면 거절, 메시 이름·정점 수·설정이 다르면 안 맞음', () => {
  const bytes = sample()
  const cache = decodeAoCache(bytes)
  assert.equal(cache.params, 'abc123')
  assert.deepEqual([...cache.data], [255, 128, 0, 10, 20])
  const meshes = [{ name: 'Body', count: 3 }, { name: 'Hair', count: 2 }]
  assert.ok(aoCacheMatches(cache, 'abc123', meshes))
  assert.ok(!aoCacheMatches(cache, 'other', meshes), '설정 해시가 다름')
  assert.ok(!aoCacheMatches(cache, 'abc123', [{ name: 'Body', count: 3 }, { name: 'Hat', count: 2 }]), '메시 이름이 다름')
  assert.ok(!aoCacheMatches(cache, 'abc123', [{ name: 'Body', count: 4 }, { name: 'Hair', count: 2 }]), '정점 수가 다름')
  assert.ok(!aoCacheMatches(cache, 'abc123', meshes.slice(0, 1)), '메시 수가 다름')
  assert.ok(!aoCacheMatches(null, 'abc123', meshes))
  const broken = (fn) => { const copy = bytes.slice(); fn(copy); return decodeAoCache(copy) }
  assert.equal(broken((b) => { b[0] = 0 }), null, '표지')
  assert.equal(decodeAoCache(bytes.subarray(0, bytes.length - 1)), null, '데이터가 모자람')
  assert.equal(decodeAoCache(Uint8Array.of(...bytes, 1)), null, '데이터가 남음')
  assert.equal(broken((b) => { new DataView(b.buffer).setUint32(4, 1 << 30, true) }), null, '머리말 길이')
  assert.equal(decodeAoCache(new Uint8Array(4)), null, '너무 짧음')
  const header = (value) => { const text = new TextEncoder().encode(JSON.stringify(value)); const out = new Uint8Array(8 + text.length); out.set([0x44, 0x53, 0x41, 0x4f]); new DataView(out.buffer).setUint32(4, text.length, true); out.set(text, 8); return decodeAoCache(out) }
  assert.equal(header({ version: AO_CACHE_VERSION + 1, params: 'a', meshes: [] }), null, '다른 형식 버전')
  assert.equal(header({ version: AO_CACHE_VERSION, params: 'a', meshes: [{ name: 'x', count: -1 }] }), null, '음수 정점 수')
  assert.deepEqual(header({ version: AO_CACHE_VERSION, params: 'a', meshes: [] }).meshes, [], '빈 모델')
})

/** 임시 모델·캐시 폴더와 시험 서버 (요청 처리기는 host.js apply가 등록한 것) */
async function fixture({ limit } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kr-aocache-'))
  const models = join(root, 'models'), cacheDir = join(root, 'cache')
  await mkdir(join(models, 'sub'), { recursive: true })
  await writeFile(join(models, 'sub', 'a.vrm'), 'model')
  await writeFile(join(root, 'secret.vrm'), 'outside')
  const state = { denied: /** @type {number | undefined} */ (undefined), dir: models }
  const routes = new Map()
  apply({ connection: { requestRejection: () => state.denied }, effect(fn) { fn() }, webServer: { register(route) { routes.set(route.path, route); return () => {} } } },
    { avatarModelDir: { get: () => state.dir } }, { applyIcon: async () => ({}), avatarCacheDir: cacheDir })
  const route = routes.get(AVATAR_CACHE_PATH)
  const handler = limit ? createAoCacheHandler({ modelDir: () => state.dir, rejection: () => state.denied, cacheDir, limit }) : route.handler
  const server = createServer(handler)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = (file = 'sub/a.vrm', params = 'abc123') => `http://127.0.0.1:${server.address().port}${AVATAR_CACHE_PATH}?file=${encodeURIComponent(file)}&params=${params}`
  const close = async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await rm(root, { recursive: true, force: true }) }
  return { root, models, cacheDir, state, route, url, close }
}

test('AO 캐시 경로: 인증 전에는 읽지도 쓰지도 않고, 저장한 파일을 그대로 돌려주며, 모델 파일이 바뀌면 없는 것으로 본다', async () => {
  const f = await fixture()
  try {
    assert.equal(f.route.kind, 'exact')
    f.state.denied = 401
    assert.equal((await fetch(f.url(), { method: 'PUT', body: sample() })).status, 401)
    assert.equal((await fetch(f.url())).status, 401)
    assert.deepEqual(await readdir(f.root), ['models', 'secret.vrm'], '인증 전에는 캐시 폴더도 만들지 않음')
    f.state.denied = undefined
    assert.equal((await fetch(f.url())).status, 404, '아직 없음')
    assert.equal((await fetch(f.url(), { method: 'PUT', body: sample() })).status, 204)
    const hit = await fetch(f.url())
    assert.equal(hit.status, 200)
    assert.deepEqual(new Uint8Array(await hit.arrayBuffer()), sample())
    assert.equal((await readdir(f.cacheDir)).filter((name) => name.endsWith('.tmp')).length, 0, '임시 파일 정리')
    assert.equal((await fetch(f.url('sub/a.vrm', 'other1'))).status, 404, '다른 굽기 설정')
    await utimes(join(f.models, 'sub', 'a.vrm'), new Date(), new Date(Date.now() + 5000))
    assert.equal((await fetch(f.url())).status, 404, '모델 수정 시각이 바뀌면 다시 굽게 함')
    assert.equal((await fetch(f.url(), { method: 'POST' })).status, 405)
    f.state.dir = ''
    assert.equal((await fetch(f.url())).status, 404, '모델 폴더 설정이 비면 없음')
  } finally { await f.close() }
})

test('AO 캐시 경로: 모델 폴더 밖·잘못된 설정 해시·형식이 틀린 본문·크기 초과를 거절한다', async () => {
  const f = await fixture({ limit: 200 })
  try {
    for (const file of ['../secret.vrm', '%2e%2e/secret.vrm', join(f.root, 'secret.vrm'), 'sub\\a.vrm', 'missing.vrm']) {
      assert.equal((await fetch(f.url(decodeURIComponent(file)))).status, 404, file)
      assert.equal((await fetch(f.url(decodeURIComponent(file)), { method: 'PUT', body: sample() })).status, 404, file)
    }
    assert.equal(await resolveModelFile(f.models, '../secret.vrm'), null)
    assert.equal((await fetch(f.url('sub/a.vrm', '../x'))).status, 400)
    assert.equal((await fetch(f.url('', 'abc123'))).status, 400)
    assert.equal((await fetch(f.url(), { method: 'PUT', body: 'not a cache' })).status, 400, '형식이 틀림')
    assert.equal((await fetch(f.url('sub/a.vrm', 'zzz999'), { method: 'PUT', body: sample('abc123') })).status, 400, '머리말 설정 해시가 주소와 다름')
    assert.equal((await fetch(f.url(), { method: 'PUT', body: new Uint8Array(201) })).status, 413, '크기 초과')
    assert.equal((await fetch(f.url())).status, 404, '거절한 본문은 저장하지 않음')
    assert.equal(AO_CACHE_LIMIT, 32 * 1024 * 1024)
  } finally { await f.close() }
})

test('AO 캐시 경로: 길이를 알리지 않은 본문도 크기를 넘으면 읽기를 멈추고 413', async () => {
  const f = await fixture({ limit: 64 })
  try {
    const body = new ReadableStream({ start(controller) { for (let i = 0; i < 4; i++) controller.enqueue(new Uint8Array(32)); controller.close() } })
    const response = await fetch(f.url(), { method: 'PUT', body, duplex: 'half' })
    assert.equal(response.status, 413)
  } finally { await f.close() }
})
