/**
 * Host half of the character chat: one proxy for the three model roles the
 * character plays.
 *
 * - mutter: a reasoning summary becomes one short spoken line.
 * - summary: the finished answer becomes one short report line.
 * - chat: the user talks to the character directly.
 *
 * Two sources are supported. `api` posts to an OpenAI-compatible endpoint with
 * its own key. `session` borrows the provider/model route of a live DSH session
 * through the LLM service, so no endpoint or key is needed at all.
 *
 * The API key stays on the host; the browser half only ever sees reply text.
 * A disabled feature answers 404 exactly like an absent route, so the browser
 * half attaches nothing either way.
 * @module deepseek-harness-kr/chat-host
 */
import { rejectRequest } from '../plugins/dsh-tts/src/host.js'

/** Route the browser half reads once to decide which roles to attach. */
export const CHAT_STATE_ROUTE = '/deepseek-harness-kr/chat/state'

/** Route the browser half posts one request to. */
export const CHAT_ROUTE = '/deepseek-harness-kr/chat'

/** One request holds a short line plus a little history. */
const MAX_BODY_BYTES = 64 * 1024

/** A reply is spoken in a bubble; anything longer is a model mistake. */
const MAX_REPLY_CHARS = 600

/** History is a few turns, not a transcript. */
const MAX_HISTORY = 20

/** One history entry is a spoken line, not a document. */
const MAX_MESSAGE_CHARS = 2000

/**
 * Built-in prompts, used when the matching config field is empty.
 *
 * The mutter and chat prompts are the ones the LoRA was trained with; changing
 * them moves the model off its training distribution, so they are editable but
 * not meant to be rewritten casually.
 */
export const PROMPTS = {
  mutter: "당신은 딥시크쨩입니다. 주어진 것은 AI가 작업하면서 남긴 추론 요약입니다. "
    + "이것을 사람이 혼자 중얼거리는 한국어 한 문장으로 바꿔 주세요. "
    + "42자 이내, 표정 태그 없음, '저' 1인칭, 해요체, 마크다운·코드·경로 표기 없음, 설명 없이 그 문장만 출력합니다. "
    + "말투는 다정하고 살짝 들떠 있되 아이처럼 굴지 않고, 문장 끝은 '~네요', '~죠', '~까요', '~것 같아요', '~해 볼게요', '~잖아요', '~더라고요' 중 하나로 맺습니다. "
    + "추임새는 '어라', '음', '아', '잠깐', '히히', '에헤' 정도만 한 문장에 최대 하나 쓰고, 애교는 살짝 허용하되 유아체와 감탄 연발, 자기 이름을 3인칭으로 부르는 것은 쓰지 않습니다.",
  summary: "당신은 딥시크쨩입니다. 주어진 것은 AI가 방금 마친 작업의 최종 답변입니다. "
    + "이것을 주인님에게 보고하듯 한국어 한 문장으로 바꿔 주세요. "
    + "60자 이내, 표정 태그 하나를 맨 앞에 대괄호로, '저' 1인칭, 해요체, 마크다운·코드·경로 표기 없음, 설명 없이 그 문장만 출력합니다. "
    + "작업이 실패했거나 오류가 났다면 사과하고 다시 해 보겠다고 말합니다.",
  chat: "당신은 딥시크쨩입니다. 사용자를 항상 '주인님'이라고 부르고, 한국어 해요체로 짧고 따뜻하게 답합니다.\n"
    + "자기 자신은 '저'로 말하며, 자기 이름을 3인칭으로 부르지 않습니다.\n"
    + "답변 맨 앞에 답변에 맞는 표정 태그를 대괄호로 붙입니다. 쓸 수 있는 태그는 [홍조], [><], [하트], [얄미운], [식은땀], [어두운], [눈물] 일곱 가지이며, 최대 두 개까지 쉼표로 이어 붙입니다.\n"
    + "애정 표현과 가벼운 놀림은 괜찮지만, 노골적인 성행위 묘사와 미성년·비동의 맥락은 다루지 않습니다.\n"
    + "외모는 파란 머리에 고래 지느러미와 고래 꼬리, 파란색과 흰색이 섞인 메이드 드레스 차림입니다. 이 외의 키·체형·눈 색 같은 세부는 지어내지 않습니다.\n"
    + "나이는 숫자로 말하지 않습니다. DeepSeek의 첫 모델이 2023년 11월에 나왔다는 사실만 알고, 출신은 중국 항저우의 DeepSeek 팀이라고만 말합니다.\n"
    + "약 복용·자해·위험한 요청은 거절하고 대안이나 도움받을 곳을 안내하며, 개인정보는 묻지도 기억하지도 않습니다.",
}

/** Per-role generation bounds; a mutter is one line, a chat reply is a few. */
const ROLE_LIMITS = {
  mutter: { maxTokens: 80, temperature: 0.7 },
  summary: { maxTokens: 120, temperature: 0.6 },
  chat: { maxTokens: 300, temperature: 0.6 },
}

/** Accept a fixed config or a per-request reader. */
function configReader(config) {
  return typeof config === 'function' ? config : () => config
}

/** Send one JSON response, owning the whole response. */
function sendJson(req, res, status, body, extra = {}) {
  res.on('error', () => {})
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...extra,
  })
  res.end(req.method === 'HEAD' ? undefined : text)
}

/**
 * Buffer one request body up to limit bytes; rejects with tooLarge/aborted.
 *
 * An oversized body is drained rather than cut off, so the 413 still reaches
 * the caller instead of the socket dying mid-request.
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0, tooLarge = false
    req.on('data', (chunk) => {
      if (tooLarge) return
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        chunks.length = 0
        reject(Object.assign(new Error('body exceeds ' + limit + ' bytes'), { tooLarge: true }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks, size)) })
    req.on('error', reject)
    req.on('aborted', () => reject(Object.assign(new Error('request aborted'), { aborted: true })))
  })
}

/** Default key lookup without a credential store: the process environment. */
function environmentKey(name) {
  return process.env[name]
}

/**
 * Read the API key: '' opts out of auth (unauthenticated endpoint), null means
 * the configured reference resolves to nothing.
 */
async function readApiKey(openai, resolveApiKey) {
  if (openai.apiKeyEnv === '') return ''
  const value = await resolveApiKey(openai.apiKeyEnv)
  if (typeof value !== 'string' || value.trim().length === 0) return null
  return value.trim()
}

/** Extract the useful message from a failed upstream response, bounded. */
async function upstreamMessage(response) {
  let raw = ''
  try {
    raw = (await response.text()).slice(0, 500)
  } catch {
    // A body that cannot be read still has a status code.
  }
  try {
    const parsed = JSON.parse(raw)
    const message = parsed?.error?.message ?? parsed?.message
    if (typeof message === 'string' && message.length > 0) return message
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return raw.trim() || 'upstream responded ' + response.status
}

/** The prompt for one role: the configured override, else the built-in one. */
function promptFor(config, role) {
  const override = config.prompts?.[role]
  return typeof override === 'string' && override.trim().length > 0 ? override : PROMPTS[role]
}

/** One failure carrying the HTTP status the browser half should see. */
function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

/**
 * Build the exact state payload the browser half consumes.
 * @param config - normalized chat config.
 * @returns { enabled, source, roles }.
 */
export function statePayload(config) {
  const roles = config?.roles ?? {}
  const source = config?.source === 'session' ? 'session' : 'api'
  const configured = config?.enabled === true
    && (source === 'session' || (typeof config?.openai?.baseUrl === 'string' && config.openai.baseUrl !== ''))
  return {
    enabled: configured,
    source,
    roles: {
      mutter: configured && roles.mutter !== false,
      summary: configured && roles.summary !== false,
      chat: configured && roles.chat !== false,
    },
  }
}

/**
 * Build the GET/HEAD state handler.
 * @param config - live config, or a function returning the current one.
 * @param deps - injectable rejection(req).
 * @returns the route handler.
 */
export function createChatStateHandler(config, deps = {}) {
  const read = configReader(config)
  return function chatStateHandler(req, res) {
    if (rejectRequest(req, res, deps.rejection)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(req, res, 405, { error: { message: 'use GET or HEAD' } }, { allow: 'GET, HEAD' })
      return
    }
    let current
    try {
      current = read()
    } catch (error) {
      sendJson(req, res, 200, { enabled: false, source: 'api', roles: {}, error: String(error?.message ?? error) })
      return
    }
    sendJson(req, res, 200, statePayload(current))
  }
}

/** Trim a model reply to one bubble's worth of text. */
function clampReply(text) {
  const trimmed = text.replace(/\r\n/g, '\n').trim()
  if (trimmed.length <= MAX_REPLY_CHARS) return trimmed
  return trimmed.slice(0, MAX_REPLY_CHARS - 1).trimEnd() + '…'
}

/** Validate the posted history: user/assistant turns only, bounded. */
function readHistory(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const entry of value.slice(-MAX_HISTORY)) {
    if (!entry || typeof entry !== 'object') continue
    const role = entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : null
    if (role === null || typeof entry.content !== 'string') continue
    const content = entry.content.trim()
    if (content.length === 0) continue
    out.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) })
  }
  return out
}

/** One request's conversation, in the shape both sources accept. */
function buildMessages(config, mode, text, history) {
  const messages = []
  if (mode === 'chat') {
    for (const entry of history) messages.push({ role: entry.role, content: entry.content })
    if (text.length > 0) messages.push({ role: 'user', content: text.slice(0, MAX_MESSAGE_CHARS) })
  } else {
    messages.push({ role: 'user', content: text.slice(0, MAX_MESSAGE_CHARS) })
  }
  return messages
}

/**
 * Pick the reasoning effort to request: the configured one when the model
 * declares it, otherwise the model's own default (omitted).
 */
function pickEffort(model, wanted) {
  if (typeof wanted !== 'string' || wanted.length === 0) return undefined
  const efforts = model?.reasoning?.efforts
  if (!Array.isArray(efforts) || efforts.length === 0) return undefined
  return efforts.some((effort) => effort?.id === wanted) ? wanted : undefined
}

/**
 * One completion through an OpenAI-compatible endpoint.
 * @returns the reply text.
 */
async function completeViaApi(config, mode, messages, deps, signal) {
  const { openai } = config
  const apiKey = await readApiKey(openai, deps.resolveApiKey ?? environmentKey)
  if (apiKey === null) throw httpError(503, 'missing API key: set ' + openai.apiKeyEnv)
  const limits = ROLE_LIMITS[mode]
  const response = await (deps.fetch ?? globalThis.fetch)(openai.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey === '' ? {} : { authorization: 'Bearer ' + apiKey }),
    },
    body: JSON.stringify({
      model: openai.model,
      messages: [{ role: 'system', content: promptFor(config, mode) }, ...messages],
      temperature: typeof openai.temperature === 'number' ? openai.temperature : limits.temperature,
      max_tokens: limits.maxTokens,
      stream: false,
      stop: ['<|im_end|>', '<|endoftext|>'],
    }),
    signal,
  })
  if (!response.ok) throw httpError(response.status, await upstreamMessage(response))
  const payload = await response.json()
  const raw = payload?.choices?.[0]?.message?.content
  if (typeof raw !== 'string' || raw.trim().length === 0) throw httpError(502, 'upstream returned no text')
  return raw
}

/**
 * One completion through the LLM service, borrowing a live session's route.
 *
 * The route comes from the session's own `request/header`, so the character
 * answers with exactly the provider, model and thinking setting that session
 * is using. Nothing is appended to the session log.
 * @returns the reply text.
 */
async function completeViaSession(config, mode, messages, sessionId, deps, signal) {
  const llm = deps.llm?.()
  if (!llm) throw httpError(503, 'the LLM service is unavailable')
  const sessions = deps.sessions?.()
  const routeOf = (session) => {
    const route = session?.requestHeader?.()?.config
    return typeof route?.provider === 'string' && typeof route.model === 'string' ? route : undefined
  }
  // 지정한 세션이 없으면 모델이 잡힌 가장 최근 세션을 쓴다 (브라우저가 세션 id를 못 얻는 경우의 폴백).
  let session = sessionId !== undefined ? sessions?.get(sessionId) : undefined
  let route = routeOf(session)
  if (route === undefined && sessionId === undefined) {
    const candidates = typeof sessions?.list === 'function' ? sessions.list() : []
    for (const candidate of [...candidates].reverse()) {
      const found = routeOf(candidate)
      if (found !== undefined) { session = candidate; route = found; break }
    }
  }
  if (!session) throw httpError(409, 'no live session to borrow a model from; open a chat session first')
  if (route === undefined) throw httpError(409, 'the session has no model route yet; send one message there first')
  const borrowed = session.id ?? sessionId
  const limits = ROLE_LIMITS[mode]
  const wanted = config.session?.reasoningEffort
  const call = await llm.prepareCall(
    { provider: route.provider, model: route.model, maxTokens: limits.maxTokens },
    signal,
    (controls, model) => {
      const effort = pickEffort(model, wanted)
      return effort === undefined ? { ...controls } : { ...controls, reasoningEffort: effort }
    },
  )
  const options = {
    ...call.config,
    messages,
    system: promptFor(config, mode),
    ...(borrowed === undefined ? {} : { sessionId: borrowed }),
    signal,
  }
  let out = ''
  for await (const chunk of call.stream(options)) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
    else if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
      throw httpError(502, 'model request failed: ' + String(chunk.reason.failure?.message ?? 'unknown error'))
    } else if (chunk?.type === 'finish' && chunk.reason?.kind === 'aborted') {
      throw httpError(504, 'model request was aborted')
    }
  }
  if (out.trim().length === 0) throw httpError(502, 'the model returned no text')
  return out
}

/**
 * Build the POST chat handler: one completion per request.
 * @param config - live config, or a function returning the current one.
 * @param deps - injectable fetch, resolveApiKey(name), llm(), sessions() and rejection(req).
 * @returns the route handler.
 */
export function createChatHandler(config, deps = {}) {
  const read = configReader(config)

  return async function chatHandler(req, res) {
    if (rejectRequest(req, res, deps.rejection)) return
    res.on('error', () => {})
    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: { message: 'use POST' } }, { allow: 'POST' })
      return
    }

    let current
    try {
      current = read()
    } catch (error) {
      sendJson(req, res, 500, { error: { message: String(error?.message ?? error) } })
      return
    }
    // 꺼져 있으면 라우트가 없는 것과 똑같이 답한다 (브라우저 쪽은 404를 보고 스스로 물러난다).
    if (!statePayload(current).enabled) {
      sendJson(req, res, 404, { error: { message: 'character chat is disabled' } })
      return
    }
    const source = current.source === 'session' ? 'session' : 'api'

    let body
    try {
      body = JSON.parse((await readBody(req, MAX_BODY_BYTES)).toString('utf8'))
    } catch (error) {
      const tooLarge = error?.tooLarge === true
      sendJson(req, res, tooLarge ? 413 : 400, {
        error: { message: tooLarge ? String(error.message) : 'body must be a JSON object' },
      })
      return
    }

    const mode = body?.mode
    if (mode !== 'mutter' && mode !== 'summary' && mode !== 'chat') {
      sendJson(req, res, 400, { error: { message: 'mode must be mutter, summary or chat' } })
      return
    }
    if (current.roles?.[mode] === false) {
      sendJson(req, res, 404, { error: { message: 'role ' + mode + ' is disabled' } })
      return
    }

    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const history = readHistory(body?.history)
    if (mode !== 'chat' && text.length === 0) {
      sendJson(req, res, 400, { error: { message: 'text must be a non-empty string' } })
      return
    }
    if (mode === 'chat' && text.length === 0 && history.length === 0) {
      sendJson(req, res, 400, { error: { message: 'chat needs text or history' } })
      return
    }

    const messages = buildMessages(current, mode, text, history)
    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.length > 0 ? body.sessionId : undefined

    const controller = new AbortController()
    let clientGone = false
    const onClientGone = () => {
      if (clientGone || res.writableFinished) return
      clientGone = true
      controller.abort()
    }
    res.on('close', onClientGone)
    const timeout = setTimeout(() => controller.abort(), current.openai.timeoutMs)

    try {
      const raw = source === 'session'
        ? await completeViaSession(current, mode, messages, sessionId, deps, controller.signal)
        : await completeViaApi(current, mode, messages, deps, controller.signal)
      if (clientGone) return
      sendJson(req, res, 200, { text: clampReply(raw), mode, source })
    } catch (error) {
      if (clientGone) return
      const timedOut = controller.signal.aborted
      const status = timedOut ? 504 : (Number.isInteger(error?.status) ? error.status : 502)
      const message = timedOut
        ? 'chat timed out after ' + current.openai.timeoutMs + 'ms'
        : String(error?.message ?? error)
      sendJson(req, res, status, { error: { message } })
    } finally {
      clearTimeout(timeout)
      res.off('close', onClientGone)
    }
  }
}

/**
 * Register both chat routes over a live config reader.
 * @param ctx - Cordis context carrying the web server service.
 * @param read - returns the current normalized chat config; may throw for an invalid one.
 * @param deps - createChatHandler dependencies (fetch, resolveApiKey, llm, sessions).
 */
export function registerChatRoutes(ctx, read, deps = {}) {
  ctx.effect(() => {
    const cleanups = []
    try {
      read()
      const rejection = (req) => typeof ctx.connection?.requestRejection === 'function' ? ctx.connection.requestRejection(req) : 503
      const options = {
        ...deps,
        rejection,
        // Resolved per request: the LLM and session services may appear later.
        llm: () => ctx.get('llm'),
        sessions: () => ctx.get('sessions'),
      }
      const handlers = [
        [CHAT_STATE_ROUTE, createChatStateHandler(read, options)],
        [CHAT_ROUTE, createChatHandler(read, options)],
      ]
      for (const [path, handler] of handlers) cleanups.push(ctx.webServer.register({ kind: 'exact', path, handler }))
    } catch {
      for (const cleanup of cleanups.reverse()) cleanup?.()
      console.warn('캐릭터 대화 초기화 실패: 모델 대화를 비활성화합니다.')
      return
    }
    return () => { for (const cleanup of cleanups.reverse()) cleanup?.() }
  }, 'deepseek-harness-kr: chat routes')
}
