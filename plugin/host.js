// @ts-check
import z from '@deepseek-ai/schemastery'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { normalize as normalizeTts } from '../plugins/dsh-tts/src/config.js'
import { credentialResolver, registerSpeechRoutes } from '../plugins/dsh-tts/src/index.js'
import { createPetHandler, createPetManager, PET_PATH } from './pet-host.js'
import { registerChatRoutes } from './chat-host.js'
import { normalizeChat } from './chat-config.js'
import { applyShortcutIcon } from './app-icon.js'
import { OUTFIT_ITEMS, BODY_TYPES } from '../shared/settings.js'

export const name = 'deepseek-harness-kr'
export const inject = ['webServer', 'connection']

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */
/** @typedef {(req: IncomingMessage, res: ServerResponse) => Promise<void>} RequestHandler */
/**
 * DSH 컨텍스트 중 이 플러그인이 쓰는 범위 (registerSpeechRoutes 에도 그대로 넘김)
 * @typedef {object} HostContext
 * @property {(fn: () => (() => void) | void | undefined, label: string) => void} effect
 * @property {{ register(route: { kind: 'prefix' | 'exact', path: string, handler: RequestHandler }): (() => void) | undefined }} webServer
 * @property {{ requestRejection?: (req: IncomingMessage) => number | undefined } | undefined} connection
 */
/**
 * 설정 중 이 파일이 읽는 값 (volatile 참조일 수 있어 readLive로 읽음)
 * @typedef {{ tts?: unknown, chat?: unknown, appIcon?: unknown }} HostConfig
 */

// 말풍선 음성(TTS). 설정 화면이 쓰는 값은 모두 volatile이어야 한다(Settings는 volatile 필드만 쓴다).
// 값의 범위·형식 검사는 요청마다 dsh-tts normalize가 맡고, 잘못된 값은 /dsh-tts/state가 이유를 알려 준다.
/**
 * 스키마의 volatile 변환 (설정 화면에서 바꾼 값을 요청마다 다시 읽기 위함)
 * @template R @param {{ volatile(): R }} schema @returns {R}
 */
const live = (schema) => schema.volatile()
export const TtsConfig = z.object({
  enabled: live(z.boolean().default(false)),
  openai: z.object({
    baseUrl: live(z.string().default('')),
    model: live(z.string().default('')),
    voice: live(z.string().default('')),
    // API 키 자체가 아니라 credentials 참조 이름. 저장된 키가 먼저, 없으면 같은 이름의 환경변수.
    apiKeyEnv: live(z.string().role('credential-ref').default('DSH_TTS_API_KEY')),
    extraBody: live(z.dict(z.any()).default({})),
    headers: live(z.dict(z.string()).default({})),
    textPrefix: live(z.string().default('')),
    timeoutMs: live(z.number().min(1000).max(600000).step(1).default(30000)),
  }),
  stream: z.object({
    pcmSampleRate: live(z.number().min(8000).max(48000).step(1).default(24000)),
  }),
  voiceLines: z.object({
    reactions: live(z.boolean().default(true)),
    status: live(z.boolean().default(false)),
    mutters: live(z.boolean().default(false)),
    others: live(z.boolean().default(true)),
  }),
  cache: z.object({
    enabled: live(z.boolean().default(true)),
  }),
})

/**
 * volatile 참조(.get())가 섞인 설정의 그 시점 평범한 값 변환
 * @param {any} value 설정 값 아무거나 (volatile 참조·객체·원시값이 섞임)
 * @returns {unknown}
 */
export function readLive(value) {
  if (value && typeof value.get === 'function') return structuredClone(value.get())
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, readLive(child)]))
}

export const Config = z.object({
  character: z.boolean().default(true).volatile(),
  theme: z.boolean().default(true).volatile(),
  translation: z.boolean().default(true).volatile(),
  // 소품·옷·체형: 항목 정의는 shared/settings.js 하나 (펫 창 메뉴·설정 화면·캐릭터와 같은 목록)
  ...Object.fromEntries(OUTFIT_ITEMS.map(({ key }) => [key, z.boolean().default(false).volatile()])),
  bodyType: z.union(BODY_TYPES.map(({ key }) => z.const(key))).default('default').volatile(),
  tts: TtsConfig,
  // 캐릭터 대화(모델 연결): 켜면 혼잣말·결과 요약·직접 대화를 모델이 맡는다 (기본은 규칙 기반)
  // 준비하지 않은 필드는 비워 두면 되고, 실제 값 검사는 요청마다 normalizeChat이 맡는다.
  chat: z.object({
    enabled: live(z.boolean().default(false)),
    source: live(z.string().default('api')),
    openai: z.object({
      baseUrl: live(z.string().default('')),
      model: live(z.string().default('')),
      apiKeyEnv: live(z.string().default('DSH_CHAT_API_KEY')),
      timeoutMs: live(z.number().min(1000).max(600000).default(20000)),
      // 비워 두면 역할별 기본값을 쓴다 (0도 유효한 값이라 null과 구분해야 한다)
      temperature: live(z.union([z.number().min(0).max(2), z.const(null)]).default(null)),
    }),
    session: z.object({ reasoningEffort: live(z.string().default('off')) }),
    roles: z.object({
      mutter: live(z.boolean().default(true)),
      summary: live(z.boolean().default(true)),
      chat: live(z.boolean().default(true)),
    }),
    prompts: z.object({
      mutter: live(z.string().default('')),
      summary: live(z.string().default('')),
      chat: live(z.string().default('')),
    }),
  }),
  // 시작할 때 가운데에서 크게 인사하는 등장 연출 (끄면 처음부터 제자리에 뜬다)
  intro: z.boolean().default(true).volatile(),
  // 모바일(터치 전용) 화면에서도 캐릭터를 보여 줄지 (기본 표시)
  mobileCharacter: z.boolean().default(true).volatile(),
  // 앱 아이콘을 DeepSeek짱 아이콘으로 (Windows는 바로가기, macOS는 앱의 Finder 아이콘. 실행 중 창·작업 표시줄 아이콘은 해당 없음)
  appIcon: z.boolean().default(true).volatile(),
  // 절전: 입력이 없으면 캐릭터가 화면 밖으로 나가 렌더링을 멈춤
  idleSleep: z.boolean().default(true).volatile(),
  idleSleepMinutes: z.number().min(0.5).max(60).default(1).volatile(),
  // 캐릭터 토글 단축키 (비워 두면 단축키 없음). 예: "Ctrl+Shift+D", "Alt+C"
  characterToggleKey: z.string().default('Ctrl+Shift+D').volatile(),
  // 캐릭터를 집어 옮길 때 누르고 있어야 하는 키 하나 (수식 키 또는 일반 키). 비우면 예전처럼 왼쪽·오른쪽 버튼을 함께 눌러야 한다.
  dragKey: z.string().default('Alt').volatile(),
  // 바깥 펫 창으로 내보내기·돌아오기 단축키 (비워 두면 단축키 없음). 예: "Ctrl+Shift+P"
  petToggleKey: z.string().default('Ctrl+Shift+P').volatile(),
  // 캔버스만 숨김/표시: 캐릭터를 내리지 않고 그리기만 멈춰 즉시 전환한다. 성능 부담이 있어 기본 꺼짐(원하는 사람만 켬).
  canvasToggle: z.boolean().default(false).volatile(),
  // 캔버스 숨김/표시 단축키 (canvasToggle이 켜져 있을 때만 동작, 비우면 없음). 예: "Ctrl+Shift+H"
  canvasToggleKey: z.string().default('Ctrl+Shift+H').volatile(),
})
export const ASSET_PATH = '/deepseek-harness-kr/assets'
/** 호스트 쪽 진단 상태 조회 경로 (설정 화면이 시작 후 한 번 읽어 콘솔에 남김) */
export const STATUS_PATH = '/deepseek-harness-kr/status'
const assets = fileURLToPath(new URL('../assets/', import.meta.url))
/** @type {Record<string, string | undefined>} */
const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.moc3': 'application/octet-stream' }

/**
 * 자산 파일 요청 처리기 생성. GET·HEAD만 받고 ETag가 같으면 304
 * @param {string} [root] 자산 폴더 (기본 assets/)
 * @returns {RequestHandler}
 */
export function createAssetHandler(root = assets) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return
    }
    try {
      // 경로 해석 전에 디코딩. 경로 문자열로 벗어나기·심볼릭 링크로 벗어나기 모두 거절로 처리
      const path = decodeURIComponent((req.url || '').split('?')[0])
      if (!path.startsWith(ASSET_PATH + '/')) { res.writeHead(404); res.end(); return }
      const suffix = path.slice(ASSET_PATH.length + 1)
      if (!suffix || suffix.includes('\\') || suffix.includes('\0')) { res.writeHead(404); res.end(); return }
      const base = await realpath(root)
      const target = await realpath(resolve(base, suffix))
      const rel = relative(base, target)
      if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) { res.writeHead(404); res.end(); return }
      const type = types[extname(target)]
      const info = await stat(target)
      if (!type || !info.isFile()) { res.writeHead(404); res.end(); return }
      // 자산 파일명은 고정이라, 캐시를 막아 두면 새로고침마다 무거운 자산을 통째로 다시 받는다.
      // 크기·수정시각으로 ETag를 만들고 If-None-Match와 같으면 304로 본문 없이 끝낸다.
      // 파일이 바뀌면 값도 바뀌므로 갱신은 그대로 반영된다.
      const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
      const validators = { 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', etag }
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, validators); res.end(); return }
      res.writeHead(200, { 'content-type': type, 'content-length': info.size, ...validators })
      if (req.method === 'HEAD') res.end()
      else await pipeline(createReadStream(target), res)
    } catch (error) {
      if (!res.headersSent) { res.writeHead(error instanceof URIError ? 400 : 404); res.end() }
      else if (!res.destroyed) res.destroy(/** @type {Error} */ (error))
    }
  }
}

/**
 * 앱 바로가기 아이콘 적용 결과 중 알릴 만한 실패만 추림 (Windows가 아니거나 실행 경로가 없는 경우는 정상으로 봄)
 * @param {{ skipped?: string, message?: string } | undefined} result applyShortcutIcon 결과
 * @returns {{ reason: string, message?: string } | null} 실패면 사유, 아니면 null
 */
export function iconProblem(result) {
  if (!result?.skipped || result.skipped === 'platform' || result.skipped === 'no-exec-path') return null
  return { reason: result.skipped, ...(result.message ? { message: result.message } : {}) }
}

/**
 * 진단 상태 요청 처리기 생성. 인증을 통과한 GET만 받아 지금 상태를 JSON으로 응답
 * @param {() => object} read 지금 상태 읽기
 * @param {(req: IncomingMessage) => number | undefined} rejection 거절할 HTTP 상태 코드 (통과면 undefined)
 * @returns {RequestHandler}
 */
export function createStatusHandler(read, rejection) {
  return async (req, res) => {
    const denied = rejection(req)
    if (denied !== undefined) { res.writeHead(denied); res.end(); return }
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(read()))
  }
}

/**
 * 플러그인 시작: 자산·음성·펫 경로 등록, 앱 바로가기 아이콘 동기화
 * @param {HostContext} ctx @param {HostConfig | undefined} config 플러그인 설정 (volatile 참조가 섞임)
 * @param {{ applyIcon?: typeof applyShortcutIcon }} [options] 앱 아이콘 적용 함수 대체 (시험용, DSH는 넘기지 않음)
 */
export function apply(ctx, config, { applyIcon = applyShortcutIcon } = {}) {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ASSET_PATH, handler: createAssetHandler() }), 'deepseek-harness-kr: assets')
  // 말풍선 음성: 설정 화면에서 바꾼 값(volatile)을 요청마다 다시 읽는다. 꺼져 있으면 404.
  registerSpeechRoutes(ctx, () => normalizeTts(readLive(config?.tts)))
  // 캐릭터 대화: 설정 화면에서 바꾼 값(volatile)을 요청마다 다시 읽는다. 꺼져 있으면 404(없는 라우트와 같음).
  registerChatRoutes(ctx, () => normalizeChat(readLive(config?.chat)), { resolveApiKey: credentialResolver(ctx) })
  /** 펫·상태 경로 요청의 거절 상태 코드. DSH 연결 서비스 검사기 결과(통과면 undefined), 검사기가 없으면 503 @param {IncomingMessage} req */
  const rejection = (req) => { const connection = ctx.connection; return typeof connection?.requestRejection === 'function' ? connection.requestRejection(req) : 503 }
  /** 앱 바로가기 아이콘의 마지막 실패 사유 (성공하거나 해당 없으면 null) */
  let appIconProblem = /** @type {{ reason: string, message?: string } | null} */ (null)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: STATUS_PATH, handler: createStatusHandler(() => ({ appIcon: appIconProblem }), rejection) }), 'deepseek-harness-kr: status')
  ctx.effect(() => {
    const pet = createPetManager({ assets })
    const unregister = ctx.webServer.register({ kind: 'prefix', path: PET_PATH, handler: createPetHandler(pet, rejection) })
    return () => { unregister?.(); pet.dispose() }
  }, 'deepseek-harness-kr: pet')
  // 앱 아이콘(Windows 바로가기·macOS 앱 Finder 아이콘): 켜면 시작할 때·플러그인 업데이트 후에 적용하고, 끄면 원래 아이콘으로 되돌린다.
  // 설정은 volatile이라 몇 초마다 확인해 바뀐 경우에만 실행한다(같은 값이면 아무 것도 하지 않음).
  ctx.effect(() => {
    let last = /** @type {boolean | null} */ (null), stopped = false
    /** 앱 아이콘 설정이 바뀐 경우에만 바로가기 아이콘 적용 (멈춘 뒤에는 무시) */
    const sync = () => {
      if (stopped) return
      const enabled = readLive(config?.appIcon) !== false
      if (enabled === last) return
      last = enabled
      applyIcon({ assetsDir: assets, enabled })
        .then((result) => { appIconProblem = iconProblem(result) })
        .catch((error) => { appIconProblem = { reason: 'failed', message: String(error?.message ?? error) } })
    }
    sync()
    const timer = setInterval(sync, 4000)
    timer.unref?.()
    return () => { stopped = true; clearInterval(timer) }
  }, 'deepseek-harness-kr: app icon')
}
