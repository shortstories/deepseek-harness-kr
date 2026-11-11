import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { normalizeAvatar, avatarKey, avatarBoot, resolveInside, AVATAR_PREFIX } = require('../../pet/avatar.cjs')

test('호스트 avatar 메시지는 절대 경로 폴더만 받고, 폴더가 없으면 Live2D로 시작한다', () => {
  assert.deepEqual(normalizeAvatar({ dir: ' /models/a ', outline: 'model' }), { dir: '/models/a', outline: 'model' })
  assert.deepEqual(normalizeAvatar({ dir: 'relative/x', outline: 'weird' }), { dir: '', outline: 'smooth' })
  assert.deepEqual(normalizeAvatar(null), { dir: '', outline: 'smooth' })
  assert.deepEqual(avatarBoot({ dir: '/models/a', outline: 'model' }), { enabled: true, outline: 'model' })
  assert.deepEqual(avatarBoot({ dir: '', outline: 'model' }), { enabled: false })
  assert.equal(AVATAR_PREFIX, '/__avatar/')
})

test('다시 불러올지 비교 키: 폴더·외곽선이 바뀌면 다르고, 폴더가 없으면 외곽선은 상관없다', () => {
  assert.notEqual(avatarKey({ dir: '/a', outline: 'smooth' }), avatarKey({ dir: '/b', outline: 'smooth' }))
  assert.notEqual(avatarKey({ dir: '/a', outline: 'smooth' }), avatarKey({ dir: '/a', outline: 'model' }))
  assert.equal(avatarKey({ dir: '', outline: 'smooth' }), avatarKey({ dir: '', outline: 'model' }))
})

test('모델 폴더 파일은 실제 경로 안쪽만 내주고, .. ·심볼릭 링크 탈출·없는 파일은 거절한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsc-pet-avatar-'))
  try {
    const dir = join(root, 'model'), outside = join(root, 'secret.txt'), outsideDir = join(root, 'secret')
    await mkdir(join(dir, 'tex'), { recursive: true }); await mkdir(outsideDir)
    await writeFile(join(dir, 'avatar.json'), '{}'); await writeFile(join(dir, 'tex', 'a.png'), 'x'); await writeFile(outside, 'no'); await writeFile(join(outsideDir, 'b.txt'), 'no')
    // 폴더 링크로 탈출 시도 (Windows는 권한 없이 만들 수 있는 junction, 다른 OS는 type을 무시하고 심볼릭 링크)
    await symlink(outsideDir, join(dir, 'link'), 'junction')
    assert.ok((await resolveInside(dir, 'avatar.json')).endsWith('avatar.json'))
    assert.ok((await resolveInside(dir, 'tex/a.png')).endsWith('a.png'))
    for (const bad of ['../secret.txt', 'link/b.txt', 'missing.json', '', 'a\0b', outside]) assert.equal(await resolveInside(dir, bad), null, bad)
    assert.equal(await resolveInside('', 'avatar.json'), null, '폴더가 없으면 아무것도 안 내줌')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('펫 메인·preload·페이지 배선: 3D 설정은 open보다 먼저 처리하고, 바뀌면 숨어 있을 때 새로 불러오며, 페이지는 시작 설정으로 같은 모델을 읽는다', async () => {
  const { readFile } = await import('node:fs/promises')
  const main = await readFile(new URL('../../pet/main.cjs', import.meta.url), 'utf8')
  const preload = await readFile(new URL('../../pet/preload.cjs', import.meta.url), 'utf8')
  const index = await readFile(new URL('../../character/index.ts', import.meta.url), 'utf8')
  const standalone = await readFile(new URL('../../character/standalone.ts', import.meta.url), 'utf8')
  assert.match(main, /if \(message\.type === 'avatar'\) return setAvatar\(message\)/)
  assert.match(main, /avatarKey\(avatar\) !== bootedKey\) \{ stale = true; reloadIfStale\(\) \}/)
  assert.match(main, /pathname\.startsWith\(AVATAR_PREFIX\)[\s\S]*resolveInside\(avatar\.dir/)
  assert.match(main, /ipcMain\.handle\('dsc-config', \(event\) => \(event\.sender === win\.webContents \? pageConfig\(\) : null\)\)/)
  assert.match(preload, /config: \(\) => ipcRenderer\.invoke\('dsc-config'\)/)
  assert.match(standalone, /pet\?\.config\?\.\(\)/)
  assert.match(index, /const AVATAR = prefs\.avatar\?\.enabled === true;/)
  assert.match(index, /new URL\(pet \? "__avatar\/" : "\.\.\/avatar\/"/)
})
