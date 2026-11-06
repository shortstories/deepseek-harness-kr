import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { normalizeChat } from '../chat-config.js'
import { CHAT_ROUTE, CHAT_STATE_ROUTE, createChatHandler, createChatStateHandler, registerChatRoutes, statePayload } from '../chat-host.js'

/** Resolve once the server listens; returns its port. */
function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

/** Close a server and any lingering keep-alive sockets. */
function closeServer(server) {
  server.closeAllConnections?.()
  return new Promise((resolve) => server.close(resolve))
}

/** A fake OpenAI-compatible endpoint that records what it was asked. */
async function startUpstream(reply = '[홍조] 네, 주인님.') {
  const stats = { calls: 0, bodies: [], authorizations: [] }
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      stats.calls++
      stats.bodies.push(JSON.parse(raw))
      stats.authorizations.push(req.headers.authorization ?? null)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
    })
  })
  const port = await listen(server)
  return { port, stats, close: () => closeServer(server) }
}

/** Mount the chat routes over a live config and serve them like the web server does. */
async function startHost(config, deps = {}) {
  const routes = new Map()
  const disposers = []
  const ctx = {
    connection: { requestRejection: () => undefined },
    webServer: {
      register({ path, handler }) {
        routes.set(path, handler)
        return () => routes.delete(path)
      },
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    get: (name) => deps.services?.[name],
  }
  registerChatRoutes(ctx, () => normalizeChat(config), deps)
  const server = http.createServer((req, res) => {
    const handler = routes.get(req.url)
    if (handler === undefined) { res.writeHead(404).end(); return }
    handler(req, res)
  })
  const port = await listen(server)
  return {
    url: 'http://127.0.0.1:' + port,
    routes,
    close: async () => { await closeServer(server); for (const dispose of disposers) dispose() },
  }
}

/** POST one chat request. */
function post(url, body) {
  return fetch(url + CHAT_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

test('state payload reports the roles the browser half may attach', () => {
  assert.deepEqual(statePayload(normalizeChat(undefined)), {
    enabled: false, source: 'api', roles: { mutter: false, summary: false, chat: false },
  })
  // 세션 모델을 빌리면 주소가 없어도 켜진다.
  assert.deepEqual(statePayload(normalizeChat({ enabled: true, source: 'session' })), {
    enabled: true, source: 'session', roles: { mutter: true, summary: true, chat: true },
  })
  // api 소스는 주소가 있어야 켜진다.
  assert.equal(statePayload(normalizeChat({ enabled: true, source: 'api' })).enabled, false)
  assert.equal(statePayload(normalizeChat({ enabled: true, source: 'api', openai: { baseUrl: 'http://x/v1' } })).enabled, true)
  // 역할을 끄면 그 역할만 빠진다.
  const partial = statePayload(normalizeChat({ enabled: true, source: 'session', roles: { chat: false } }))
  assert.deepEqual(partial.roles, { mutter: true, summary: true, chat: false })
})

test('disabled chat answers 404 on both routes, like an absent route', async () => {
  const host = await startHost({ enabled: false })
  try {
    assert.equal((await fetch(host.url + CHAT_STATE_ROUTE)).status, 200)
    assert.equal((await post(host.url, { mode: 'chat', text: '안녕' })).status, 404)
  } finally { await host.close() }
})

test('api source posts the role prompt and returns the reply text', async () => {
  const upstream = await startUpstream('[><] 어라, 방금 끝났네요.')
  const host = await startHost({
    enabled: true,
    source: 'api',
    openai: { baseUrl: 'http://127.0.0.1:' + upstream.port + '/v1', model: 'lfm3', apiKeyEnv: '' },
  })
  try {
    const response = await post(host.url, { mode: 'mutter', text: 'The user asked for a summary.' })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { text: '[><] 어라, 방금 끝났네요.', mode: 'mutter', source: 'api' })
    const body = upstream.stats.bodies[0]
    assert.equal(body.model, 'lfm3')
    assert.equal(body.messages[0].role, 'system')
    assert.match(body.messages[0].content, /60자를 넘기지 않게/)
    assert.deepEqual(body.messages.slice(1), [{ role: 'user', content: 'The user asked for a summary.' }])
    assert.deepEqual(body.stop, ['<|im_end|>', '<|endoftext|>'])
    assert.equal(body.max_tokens, 80)
    // apiKeyEnv가 비면 인증 헤더를 보내지 않는다.
    assert.equal(upstream.stats.authorizations[0], null)
  } finally { await host.close(); await upstream.close() }
})

test('chat mode carries history and the chat prompt', async () => {
  const upstream = await startUpstream()
  const host = await startHost({
    enabled: true,
    source: 'api',
    openai: { baseUrl: 'http://127.0.0.1:' + upstream.port + '/v1', model: 'm', apiKeyEnv: '' },
  })
  try {
    const response = await post(host.url, {
      mode: 'chat',
      text: '오늘 뭐 했어?',
      history: [{ role: 'user', content: '안녕' }, { role: 'assistant', content: '네, 주인님.' }, { role: 'system', content: '무시' }],
    })
    assert.equal(response.status, 200)
    const body = upstream.stats.bodies[0]
    assert.match(body.messages[0].content, /주인님/)
    // system 역할은 history에서 걸러진다.
    assert.deepEqual(body.messages.slice(1).map((m) => m.role), ['user', 'assistant', 'user'])
    assert.equal(body.max_tokens, 300)
  } finally { await host.close(); await upstream.close() }
})

test('a missing key is reported without calling upstream', async () => {
  const upstream = await startUpstream()
  const host = await startHost({
    enabled: true,
    source: 'api',
    openai: { baseUrl: 'http://127.0.0.1:' + upstream.port + '/v1', model: 'm', apiKeyEnv: 'DSH_CHAT_TEST_MISSING' },
  })
  try {
    delete process.env.DSH_CHAT_TEST_MISSING
    const response = await post(host.url, { mode: 'chat', text: '안녕' })
    assert.equal(response.status, 503)
    assert.match((await response.json()).error.message, /DSH_CHAT_TEST_MISSING/)
    assert.equal(upstream.stats.calls, 0)
  } finally { await host.close(); await upstream.close() }
})

test('session source borrows the route of a live session and writes nothing to it', async () => {
  const seen = []
  const llm = {
    async prepareCall(config, signal, configure) {
      seen.push({ config })
      const model = { reasoning: { efforts: [{ id: 'off' }, { id: 'high' }] } }
      const resolved = { provider: config.provider, model: config.model, ...configure({ maxTokens: config.maxTokens }, model) }
      return {
        config: resolved,
        async *stream(options) {
          seen.push({ options })
          yield { type: 'text-delta', index: 0, text: '어라, ' }
          yield { type: 'text-delta', index: 0, text: '방금 끝났네요.' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  }
  const session = { requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' } }) }
  const host = await startHost(
    { enabled: true, source: 'session', session: { reasoningEffort: 'off' } },
    { services: { llm, sessions: { get: (id) => (id === 's1' ? session : undefined) } } },
  )
  try {
    const response = await post(host.url, { mode: 'mutter', text: 'The user wants a summary.', sessionId: 's1' })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { text: '어라, 방금 끝났네요.', mode: 'mutter', source: 'session' })
    // 세션 헤더의 provider·model을 그대로 쓰고, 추론 강도는 설정값(off)으로 덮는다.
    assert.deepEqual(seen[0].config, { provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: 80 })
    assert.equal(seen[1].options.reasoningEffort, 'off')
    assert.equal(seen[1].options.sessionId, 's1')
    assert.match(seen[1].options.system, /60자를 넘기지 않게/)
  } finally { await host.close() }
})

test('without a session id the most recent routed session is borrowed', async () => {
  const seen = []
  const llm = {
    async prepareCall(config) {
      return {
        config: { provider: config.provider, model: config.model, maxTokens: config.maxTokens },
        async *stream(options) { seen.push(options); yield { type: 'text-delta', index: 0, text: '네.' }; yield { type: 'finish', reason: { kind: 'stop' } } },
      }
    },
  }
  const routed = (id, model) => ({ id, requestHeader: () => ({ config: { provider: 'p', model } }) })
  const sessions = { get: () => undefined, list: () => [routed('old', 'm-old'), { id: 'blank', requestHeader: () => undefined }, routed('new', 'm-new')] }
  const host = await startHost({ enabled: true, source: 'session' }, { services: { llm, sessions } })
  try {
    assert.equal((await post(host.url, { mode: 'mutter', text: 'x' })).status, 200)
    assert.equal(seen[0].model, 'm-new')
    assert.equal(seen[0].sessionId, 'new')
  } finally { await host.close() }
})

test('session source explains what is missing instead of guessing a model', async () => {
  const host = await startHost(
    { enabled: true, source: 'session' },
    { services: { llm: {}, sessions: { get: () => undefined } } },
  )
  try {
    const noSession = await post(host.url, { mode: 'chat', text: '안녕' })
    assert.equal(noSession.status, 409)
    assert.match((await noSession.json()).error.message, /no live session/)
  } finally { await host.close() }

  const noRoute = await startHost(
    { enabled: true, source: 'session' },
    { services: { llm: {}, sessions: { get: (id) => (id === 's1' ? { requestHeader: () => undefined } : undefined) } } },
  )
  try {
    const response = await post(noRoute.url, { mode: 'chat', text: '안녕', sessionId: 's1' })
    assert.equal(response.status, 409)
    assert.match((await response.json()).error.message, /no model route/)
  } finally { await noRoute.close() }

  const noLlm = await startHost({ enabled: true, source: 'session' }, { services: {} })
  try {
    const response = await post(noLlm.url, { mode: 'chat', text: '안녕' })
    assert.equal(response.status, 503)
    assert.match((await response.json()).error.message, /LLM service/)
  } finally { await noLlm.close() }
})

test('a model that declares no efforts keeps its own default', async () => {
  const seen = []
  const llm = {
    async prepareCall(config, signal, configure) {
      const resolved = { provider: config.provider, model: config.model, ...configure({ maxTokens: config.maxTokens }, {}) }
      return {
        config: resolved,
        async *stream(options) { seen.push(options); yield { type: 'text-delta', index: 0, text: '네.' }; yield { type: 'finish', reason: { kind: 'stop' } } },
      }
    },
  }
  const session = { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) }
  const host = await startHost(
    { enabled: true, source: 'session', session: { reasoningEffort: 'max' } },
    { services: { llm, sessions: { get: () => session } } },
  )
  try {
    assert.equal((await post(host.url, { mode: 'mutter', text: 'x', sessionId: 's1' })).status, 200)
    assert.equal('reasoningEffort' in seen[0], false)
  } finally { await host.close() }
})

test('a failed model request becomes a status the browser half can read', async () => {
  const llm = {
    async prepareCall(config) {
      return {
        config: { provider: config.provider, model: config.model, maxTokens: config.maxTokens },
        async *stream() { yield { type: 'finish', reason: { kind: 'error', failure: { message: 'upstream exploded' } } } },
      }
    },
  }
  const session = { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) }
  const host = await startHost(
    { enabled: true, source: 'session' },
    { services: { llm, sessions: { get: () => session } } },
  )
  try {
    const response = await post(host.url, { mode: 'mutter', text: 'x', sessionId: 's1' })
    assert.equal(response.status, 502)
    assert.match((await response.json()).error.message, /upstream exploded/)
  } finally { await host.close() }
})

test('bad requests are refused before any model call', async () => {
  const upstream = await startUpstream()
  const host = await startHost({
    enabled: true,
    source: 'api',
    openai: { baseUrl: 'http://127.0.0.1:' + upstream.port + '/v1', model: 'm', apiKeyEnv: '' },
  })
  try {
    assert.equal((await fetch(host.url + CHAT_ROUTE)).status, 405)
    assert.equal((await post(host.url, '{not json')).status, 400)
    assert.equal((await post(host.url, { mode: 'nope', text: 'x' })).status, 400)
    assert.equal((await post(host.url, { mode: 'mutter', text: '   ' })).status, 400)
    assert.equal((await post(host.url, { mode: 'chat' })).status, 400)
    assert.equal(upstream.stats.calls, 0)
  } finally { await host.close(); await upstream.close() }
})

test('a disabled role answers like an absent route', async () => {
  const upstream = await startUpstream()
  const host = await startHost({
    enabled: true,
    source: 'api',
    openai: { baseUrl: 'http://127.0.0.1:' + upstream.port + '/v1', model: 'm', apiKeyEnv: '' },
    roles: { chat: false },
  })
  try {
    assert.equal((await post(host.url, { mode: 'chat', text: '안녕' })).status, 404)
    // 나머지 역할은 그대로 산다.
    assert.equal((await post(host.url, { mode: 'mutter', text: 'x' })).status, 200)
    assert.equal(upstream.stats.calls, 1)
  } finally { await host.close(); await upstream.close() }
})

test('a reply longer than one bubble is trimmed', async () => {
  const upstream = await startUpstream('가'.repeat(900))
  const host = await startHost({
    enabled: true,
    source: 'api',
    openai: { baseUrl: 'http://127.0.0.1:' + upstream.port + '/v1', model: 'm', apiKeyEnv: '' },
  })
  try {
    const text = (await (await post(host.url, { mode: 'chat', text: '안녕' })).json()).text
    assert.equal(text.length, 600)
    assert.ok(text.endsWith('…'))
  } finally { await host.close(); await upstream.close() }
})

test('an oversized body is refused with 413', async () => {
  const host = await startHost({ enabled: true, source: 'session' }, { services: {} })
  try {
    const response = await post(host.url, { mode: 'chat', text: 'x'.repeat(70 * 1024) })
    assert.equal(response.status, 413)
  } finally { await host.close() }
})

test('an invalid config disables the routes instead of breaking the plugin', () => {
  const routes = new Map()
  const ctx = {
    connection: { requestRejection: () => undefined },
    webServer: { register({ path, handler }) { routes.set(path, handler); return () => routes.delete(path) } },
    effect(fn) { fn() },
    get: () => undefined,
  }
  assert.doesNotThrow(() => registerChatRoutes(ctx, () => normalizeChat({ source: 'nope' })))
  assert.equal(routes.size, 0)
})

test('the state handler reports a broken config as disabled', () => {
  const handler = createChatStateHandler(() => { throw new Error('bad config') }, { rejection: () => undefined })
  const res = { writeHead(code) { this.status = code }, end(body) { this.body = body }, on() {}, off() {} }
  handler({ method: 'GET' }, res)
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(res.body).enabled, false)
})

test('the chat handler refuses a non-POST method', async () => {
  const handler = createChatHandler(() => normalizeChat({ enabled: true, source: 'session' }), { rejection: () => undefined })
  const res = { writeHead(code) { this.status = code }, end(body) { this.body = body }, on() {}, off() {} }
  await handler({ method: 'GET' }, res)
  assert.equal(res.status, 405)
})
