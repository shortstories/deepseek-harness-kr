// @ts-check
// 3D 모델 AO 굽기 결과 캐시 (인증된 요청만): GET·PUT /deepseek-harness-kr/avatar-cache/ao?file=<모델 파일>&params=<굽기 설정 해시>
// 캐시 키는 호스트가 정함: 모델 폴더(avatarModelDir) 안 실제 파일 경로·크기·수정 시각, 굽기 설정 해시, 캐시 형식 버전
// 모델 파일이 바뀌거나 굽기 설정이 바뀌면 키가 달라져 다시 굽고, 예전 파일은 남음(같은 모델을 되돌리면 다시 씀)
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AO_CACHE_VERSION, decodeAoCache } from '../shared/ao-cache.js'

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */

/** AO 캐시 경로 */
export const AVATAR_CACHE_PATH = '/deepseek-harness-kr/avatar-cache/ao'
/** PUT 본문 최대 크기 (바이트) */
export const AO_CACHE_LIMIT = 32 * 1024 * 1024
/** 굽기 설정 해시 형식 (클라이언트가 만든 16진수 등) */
const PARAMS = /^[0-9a-z]{1,64}$/i

/**
 * 캐시 폴더 기본 위치 (pet-host.js defaultBase와 같은 규칙): macOS ~/Library/Application Support, 그 밖은 %LOCALAPPDATA% 또는 ~/.cache
 * @param {NodeJS.Platform} [platform]
 */
export const defaultCacheDir = (platform = process.platform) => platform === 'darwin'
  ? join(homedir(), 'Library', 'Application Support', 'deepseek-harness-kr', 'avatar-cache')
  : join(process.env.LOCALAPPDATA || join(homedir(), '.cache'), 'deepseek-harness-kr', 'avatar-cache')

/**
 * 캐시 키 (SHA-256 16진수): 모델 파일 경로(폴더 기준)·크기·수정 시각·굽기 설정 해시·형식 버전 중 하나라도 바뀌면 달라짐
 * @param {{ path: string, size: number, mtimeMs: number, params: string, version?: number }} source
 */
export const cacheKeyOf = ({ path, size, mtimeMs, params, version = AO_CACHE_VERSION }) =>
  createHash('sha256').update(JSON.stringify([path, size, mtimeMs, params, version])).digest('hex')

/**
 * 모델 폴더 안의 실제 모델 파일 찾기 (경로 문자열·심볼릭 링크로 폴더를 벗어나면 거절)
 * @param {string} dir 모델 폴더 @param {string} file 폴더 기준 상대 경로
 * @returns {Promise<{ path: string, size: number, mtimeMs: number } | null>} 폴더 기준 경로·크기·수정 시각, 없거나 밖이면 null
 */
export async function resolveModelFile(dir, file) {
  if (!file || file.includes('\\') || file.includes('\0')) return null
  try {
    const base = await realpath(dir)
    const target = await realpath(resolve(base, file))
    const rel = relative(base, target)
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return null
    const info = await stat(target)
    return info.isFile() ? { path: rel.split(sep).join('/'), size: info.size, mtimeMs: info.mtimeMs } : null
  } catch { return null }
}

/**
 * 응답 하나 보내고 끝냄
 * @param {ServerResponse} res @param {number} status @param {Record<string, string>} [headers]
 */
const reply = (res, status, headers = {}) => { res.writeHead(status, headers); res.end() }

/**
 * 요청 주소 → 캐시 파일 경로
 * @param {string | undefined} url 요청 주소 @param {unknown} dir 모델 폴더 설정값 @param {string} cacheDir 캐시 폴더
 * @returns {Promise<{ status: number } | { file: string, params: string }>} 잘못된 요청이면 상태 코드
 */
async function cacheTarget(url, dir, cacheDir) {
  const query = new URL(url || '', 'http://host').searchParams
  const file = query.get('file') || '', params = query.get('params') || ''
  if (!PARAMS.test(params) || !file) return { status: 400 }
  if (typeof dir !== 'string' || !dir.trim()) return { status: 404 }
  const model = await resolveModelFile(dir.trim(), file)
  return model ? { file: join(cacheDir, `ao-${cacheKeyOf({ ...model, params })}.bin`), params } : { status: 404 }
}

/**
 * 요청 본문 읽기 (limit을 넘으면 읽기를 멈추고 null)
 * @param {IncomingMessage} req @param {number} limit 최대 바이트
 * @returns {Promise<Buffer | null>}
 */
function readBody(req, limit) {
  if (Number(req.headers['content-length']) > limit) return Promise.resolve(null)
  return new Promise((ok, fail) => {
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    req.on('data', (/** @type {Buffer} */ chunk) => {
      size += chunk.length
      if (size > limit) { req.pause(); ok(null) } else chunks.push(chunk)
    })
    req.on('end', () => ok(Buffer.concat(chunks)))
    req.on('error', fail)
  })
}

/**
 * 캐시 파일 보내기 (없으면 404)
 * @param {ServerResponse} res @param {string} file
 */
async function sendCache(res, file) {
  const body = await readFile(file).catch(() => null)
  if (!body) { reply(res, 404); return }
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(body.length), 'cache-control': 'no-store' })
  res.end(body)
}

/**
 * 캐시 파일 저장: 크기·형식(shared/ao-cache.js)·굽기 설정 해시를 확인하고 임시 파일에 쓴 뒤 이름 바꾸기
 * @param {IncomingMessage} req @param {ServerResponse} res @param {{ file: string, params: string }} target @param {number} limit
 */
async function storeCache(req, res, target, limit) {
  const body = await readBody(req, limit)
  if (!body) { reply(res, 413, { connection: 'close' }); return }
  const cache = decodeAoCache(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
  if (!cache || cache.params !== target.params) { reply(res, 400); return }
  await mkdir(resolve(target.file, '..'), { recursive: true })
  const temp = `${target.file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, body)
  await rename(temp, target.file)
  reply(res, 204)
}

/**
 * AO 캐시 요청 처리기 생성 (인증 → 방법 → 주소 확인 순서, 인증 전에는 설정·파일을 읽지 않음)
 * @param {object} options
 * @param {() => unknown} options.modelDir 모델 폴더 설정값 읽기 (요청마다)
 * @param {(req: IncomingMessage) => number | undefined} options.rejection 거절할 상태 코드 (통과면 undefined)
 * @param {string} [options.cacheDir] 캐시 폴더 (시험용, 기본 defaultCacheDir())
 * @param {number} [options.limit] PUT 본문 최대 바이트
 * @returns {(req: IncomingMessage, res: ServerResponse) => Promise<void>}
 */
export function createAoCacheHandler({ modelDir, rejection, cacheDir = defaultCacheDir(), limit = AO_CACHE_LIMIT }) {
  return async (req, res) => {
    const denied = rejection(req)
    if (denied !== undefined) { reply(res, denied); return }
    if (req.method !== 'GET' && req.method !== 'PUT') { reply(res, 405, { Allow: 'GET, PUT' }); return }
    try {
      const target = await cacheTarget(req.url, modelDir(), cacheDir)
      if ('status' in target) reply(res, target.status)
      else if (req.method === 'GET') await sendCache(res, target.file)
      else await storeCache(req, res, target, limit)
    } catch {
      if (!res.headersSent) reply(res, 500)
    }
  }
}
