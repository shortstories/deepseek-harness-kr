// @ts-check
// 3D 모델 앰비언트 오클루전(AO) 굽기 결과 캐시 파일 형식. 클라이언트(character/ao-bake.ts)가 만들고 읽고,
// 호스트(plugin/avatar-cache.js)가 저장 전에 같은 함수로 형식을 확인한다.
// 형식: "DSAO" 4바이트 + 머리말 길이(uint32 LE) + 머리말 JSON(UTF-8) + 정점마다 AO 1바이트(0~255, 255 = 막힘 없음)
// 머리말: { version, params, meshes: [{ name, count }] } (메시 순서대로 data에 정점 수만큼 이어 붙임)

/** 캐시 파일 형식 버전 (형식이 바뀌면 올림, 호스트 캐시 키에도 들어감) */
export const AO_CACHE_VERSION = 1
const MAGIC = [0x44, 0x53, 0x41, 0x4f]   // "DSAO"
/** 머리말 JSON 최대 길이 (바이트) */
const HEADER_LIMIT = 1 << 20

/**
 * @typedef {{ name: string, count: number }} AoMeshEntry 메시 이름과 정점 수
 * @typedef {{ version: number, params: string, meshes: AoMeshEntry[], data: Uint8Array }} AoCache 캐시 파일 내용
 */

/**
 * 캐시 파일 만들기
 * @param {{ params: string, meshes: AoMeshEntry[], data: Uint8Array }} cache 굽기 설정 해시·메시 목록·정점 AO
 * @returns {Uint8Array}
 */
export function encodeAoCache({ params, meshes, data }) {
  const header = new TextEncoder().encode(JSON.stringify({ version: AO_CACHE_VERSION, params, meshes }))
  const out = new Uint8Array(8 + header.length + data.length)
  out.set(MAGIC, 0)
  new DataView(out.buffer).setUint32(4, header.length, true)
  out.set(header, 8)
  out.set(data, 8 + header.length)
  return out
}

/**
 * 메시 목록 항목이 맞는 모양인지 (이름 문자열, 정점 수 0 이상 정수)
 * @param {unknown} entry
 * @returns {entry is AoMeshEntry}
 */
const isMeshEntry = (entry) => !!entry && typeof entry === 'object'
  && typeof (/** @type {any} */ (entry).name) === 'string' && Number.isSafeInteger((/** @type {any} */ (entry).count)) && (/** @type {any} */ (entry).count) >= 0

/**
 * 머리말 JSON 읽기 (모양이 틀리면 null)
 * @param {Uint8Array} bytes 머리말 바이트
 * @returns {{ version: number, params: string, meshes: AoMeshEntry[] } | null}
 */
function parseHeader(bytes) {
  let header
  try { header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { return null }
  if (!header || header.version !== AO_CACHE_VERSION || typeof header.params !== 'string') return null
  if (!Array.isArray(header.meshes) || !header.meshes.every(isMeshEntry)) return null
  return header
}

/**
 * 캐시 파일 읽기: 표지·머리말 길이·버전·메시 목록·정점 수 합이 모두 맞아야 함
 * @param {Uint8Array} bytes 파일 전체
 * @returns {AoCache | null} 형식이 틀리면 null
 */
export function decodeAoCache(bytes) {
  if (bytes.length < 8 || MAGIC.some((byte, i) => bytes[i] !== byte)) return null
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
  if (length > HEADER_LIMIT || 8 + length > bytes.length) return null
  const header = parseHeader(bytes.subarray(8, 8 + length))
  if (!header) return null
  const data = bytes.subarray(8 + length)
  const total = header.meshes.reduce((sum, mesh) => sum + mesh.count, 0)
  return total === data.length ? { ...header, data } : null
}

/**
 * 읽은 캐시가 지금 모델·굽기 설정과 맞는지 (설정 해시, 메시 이름·정점 수가 순서대로 같음)
 * @param {AoCache | null} cache decodeAoCache 결과
 * @param {string} params 지금 굽기 설정 해시
 * @param {AoMeshEntry[]} meshes 지금 받는 메시 목록
 */
export function aoCacheMatches(cache, params, meshes) {
  if (!cache || cache.params !== params || cache.meshes.length !== meshes.length) return false
  return meshes.every((mesh, i) => cache.meshes[i].name === mesh.name && cache.meshes[i].count === mesh.count)
}
