import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chooseProfile, profileInUse } from '../../pet/profile.cjs'

/** 시험용 잠금: busy 에 든 폴더는 다른 펫이 쓰는 중으로 보고, 시도한 폴더를 차례로 기록 */
const fakeClaim = (busy = []) => {
  const tried = []
  /** 폴더 잡기 시도 기록과 결과 (busy 에 없으면 잡음) @param {string} directory */
  const claim = (directory) => { tried.push(directory); return !busy.includes(directory) }
  return { claim, tried }
}

test('chooseProfile: 다른 펫이 없으면 기존 설정이 있는 기본 폴더를 그대로 쓴다', () => {
  const { claim, tried } = fakeClaim()
  assert.equal(chooseProfile('C:/AppData/DeepSeekChan Pet', claim), 'C:/AppData/DeepSeekChan Pet')
  assert.deepEqual(tried, ['C:/AppData/DeepSeekChan Pet'])
})

test('chooseProfile: 기본 폴더를 다른 펫이 쓰는 중이면 번호 붙은 폴더 중 처음 잡은 곳을 쓴다', () => {
  const { claim, tried } = fakeClaim(['P', 'P 2'])
  assert.equal(chooseProfile('P', claim), 'P 3')
  assert.deepEqual(tried, ['P', 'P 2', 'P 3'])
})

test('chooseProfile: 모두 쓰는 중이면 상한까지만 시도하고 기본 폴더로 돌아간다', () => {
  const { claim, tried } = fakeClaim(['P', 'P 2', 'P 3'])
  assert.equal(chooseProfile('P', claim, 3), 'P')
  assert.deepEqual(tried, ['P', 'P 2', 'P 3'])
})

test('profileInUse: 다른 프로세스가 LevelDB 잠금 파일을 잠가 두었을 때(EBUSY)만 쓰는 중으로 본다', () => {
  const localLock = join('P', 'Local Storage', 'leveldb', 'LOCK'), sessionLock = join('P', 'Session Storage', 'LOCK')
  /** 시험용 읽어 보기: 읽은 파일 기록과 파일별 code 오류 던지기 (codes 에 없으면 성공) @param {Record<string, string>} codes @param {string[]} [read] */
  const probe = (codes, read = []) => (file) => { read.push(file); if (codes[file]) throw Object.assign(new Error(codes[file]), { code: codes[file] }) }
  const read = []
  assert.equal(profileInUse('P', probe({ [localLock]: 'EBUSY' }, read)), true)
  assert.deepEqual(read, [localLock])                                                          // 하나라도 잠겨 있으면 바로 쓰는 중
  assert.equal(profileInUse('P', probe({ [sessionLock]: 'EBUSY' })), true)                     // localStorage 를 아직 안 연 펫
  assert.equal(profileInUse('P', probe({ [localLock]: 'ENOENT', [sessionLock]: 'ENOENT' })), false)   // 새 폴더 (아직 펫이 쓴 적 없음)
  assert.equal(profileInUse('P', probe({ [localLock]: 'EPERM' })), false)                      // 권한 문제는 판별 대상 아님 (잠금 쪽에 맡김)
  assert.equal(profileInUse('P', probe({})), false)                                            // 파일은 있으나 아무도 잠그지 않음
})

test('펫 앱: --user-data-dir 가 없을 때만 쓰는 중 확인과 단일 인스턴스 잠금으로 프로필 폴더를 고른다 (모든 플랫폼)', async () => {
  const main = await readFile(new URL('../../pet/main.cjs', import.meta.url), 'utf8')
  const block = main.slice(main.indexOf("if (!app.commandLine.hasSwitch('user-data-dir'))"))
  assert.ok(block.startsWith("if (!app.commandLine.hasSwitch('user-data-dir')) {"), '프로필 고르기가 macOS 블록 밖에 있어야 함')
  assert.match(block, /if \(profileInUse\(directory\)\) return false\s+app\.setPath\('userData', directory\)\s+if \(app\.requestSingleInstanceLock\(\)\) return true/)
  assert.match(block, /if \(MAC\) \{ process\.stderr\.write\(`dsc-pet: profile lock failed: \$\{directory\}\\n`\); app\.exit\(1\) \}/, 'macOS 는 잠금 실패 뒤 멈추지 않고 끝냄')
  assert.match(block, /app\.setPath\('userData', chooseProfile\(base, claimProfile\)\)/)
  assert.ok(main.indexOf('chooseProfile(') < main.indexOf('app.whenReady()'), 'userData 는 ready 전에 정해야 함')
})

test('singletonHeld: SingletonLock 링크가 살아 있는 다른 프로세스를 가리킬 때만 잡혀 있다고 본다 (macOS·Linux)', async () => {
  const { singletonHeld } = await import('../../pet/profile.cjs')
  const link = (target) => (file) => { assert.ok(file.endsWith('SingletonLock')); if (target === null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return target }
  const alive = (pids) => (pid) => pids.includes(pid)
  assert.equal(singletonHeld('P', { readlink: link('mac.local-34581'), alive: alive([34581]), self: 1 }), true)
  assert.equal(singletonHeld('P', { readlink: link('mac.local-34581'), alive: alive([]), self: 1 }), false, '죽은 프로세스가 남긴 링크')
  assert.equal(singletonHeld('P', { readlink: link('mac.local-7'), alive: alive([7]), self: 7 }), false, '자기 자신')
  assert.equal(singletonHeld('P', { readlink: link(null), alive: alive([1]), self: 2 }), false, '링크 없음 (새 폴더·Windows)')
  assert.equal(singletonHeld('P', { readlink: link('weird'), alive: () => true, self: 2 }), false, 'pid를 못 읽음')
})

test('profileInUse: 단일 인스턴스 잠금이 잡혀 있으면 LevelDB 잠금을 보지 않고 쓰는 중으로 본다', () => {
  const read = []
  assert.equal(profileInUse('P', (file) => read.push(file), () => true), true)
  assert.deepEqual(read, [])
  assert.equal(profileInUse('P', () => {}, () => false), false)
})
