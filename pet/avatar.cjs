// 바깥 펫 창의 3D 모델 폴더 연결 (pet/main.cjs가 씀, Electron 없이 시험할 수 있게 따로 둠)
// 호스트가 {type:'avatar', dir, outline}을 보내면 펫 페이지는 dscpet://assets/__avatar/ 아래로 그 폴더를 읽는다.
// 폴더는 호스트 설정(avatarModelDir)에서만 오고, 파일은 그 폴더 실제 경로 안쪽만 내준다(심볼릭 링크로 벗어나기 거절).
const path = require('node:path')
const fs = require('node:fs/promises')

/** 페이지에서 3D 모델 폴더를 가리키는 경로 (dscpet://assets 아래) */
const AVATAR_PREFIX = '/__avatar/'

/**
 * 호스트 avatar 메시지 정리: dir은 절대 경로일 때만, 외곽선은 model 아니면 smooth
 * @param {unknown} message
 * @returns {{ dir: string, outline: 'smooth' | 'model' }}
 */
function normalizeAvatar(message) {
  const raw = message && typeof message === 'object' ? /** @type {{ dir?: unknown, outline?: unknown }} */ (message) : {}
  const dir = typeof raw.dir === 'string' && path.isAbsolute(raw.dir.trim()) ? raw.dir.trim() : ''
  return { dir, outline: raw.outline === 'model' ? 'model' : 'smooth' }
}

/** 페이지를 다시 불러와야 하는 차이만 담은 비교 키 (폴더가 없으면 외곽선은 상관없음) @param {{ dir: string, outline: string }} avatar */
const avatarKey = (avatar) => JSON.stringify(avatar.dir ? [avatar.dir, avatar.outline] : [''])

/** 펫 페이지 시작 설정 (character/types.ts CharacterPrefs.avatar) @param {{ dir: string, outline: string }} avatar */
const avatarBoot = (avatar) => (avatar.dir ? { enabled: true, outline: avatar.outline } : { enabled: false })

/**
 * 모델 폴더 안 파일의 실제 경로. 폴더 밖(.. ·절대 경로·심볼릭 링크 탈출)이거나 없는 파일이면 null
 * @param {string} root 모델 폴더
 * @param {string} relative 폴더 기준 상대 경로 (디코딩된 URL 경로)
 */
async function resolveInside(root, relative) {
  if (!root || relative.includes('\0')) return null
  try {
    const base = await fs.realpath(root)
    const target = await fs.realpath(path.resolve(base, relative))
    const rel = path.relative(base, target)
    return rel && rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel) ? target : null
  } catch { return null }
}

module.exports = { AVATAR_PREFIX, normalizeAvatar, avatarKey, avatarBoot, resolveInside }
