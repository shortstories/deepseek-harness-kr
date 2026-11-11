// @ts-check
// 바깥 펫 창: DSH 데스크톱의 Electron 실행 파일을 다시 써서 투명한 펫 창 프로세스를 띄우고, 창 안 캐릭터와 메시지를 이어 준다.
// - 런타임(Windows): DSH 설치 폴더 파일을 하드링크(같은 드라이브면 디스크 0)로 묶고 resources/app 에 펫 앱(../pet/)만 넣는다.
//   (DSH Electron은 OnlyLoadAppFromAsar·asar 무결성 검사 fuse가 꺼져 있어 resources/app 폴더 앱을 불러온다)
// - 런타임(macOS): DSH.app 의 MacOS·Frameworks 를 APFS clone(cp -c, 디스크 0)으로 복제한 작은 .app 을 만들고, Info.plist 를 고쳐(번들 ID·LSUIElement)
//   복사본만 ad-hoc 재서명한다. resources/app 은 고정 스텁(package.json 의 main 이 펫 앱을 가리킴)이라 펫 앱을 바꿔도 서명이 깨지지 않는다.
// - 연결: 창 안 캐릭터 ↔ 호스트 = DSH 웹 서버의 /deepseek-harness-kr/pet/*,
//   호스트 ↔ 펫 프로세스 = Windows 이름 있는 파이프 · macOS unix 소켓 (JSON 한 줄씩)
import { execFile, spawn } from 'node:child_process'
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'
import { copyFile, link, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

export const PET_PATH = '/deepseek-harness-kr/pet'
const PET_APP = fileURLToPath(new URL('../pet/', import.meta.url))
const PET_EXE = 'dsc-pet.exe'

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */
/** 외부 명령 실행 (기본 promisify(execFile)) @typedef {(file: string, args: string[]) => Promise<{ stdout: string | Buffer }>} Runner */
/**
 * 띄운 펫 프로세스 중 이 모듈이 쓰는 범위 (기본 child_process.spawn 의 ChildProcess)
 * @typedef {object} PetChild
 * @property {number} [pid]
 * @property {{ (event: 'exit', listener: (code?: number | null, signal?: string | null) => void): unknown, (event: 'error', listener: (error: Error) => void): unknown }} once
 * @property {() => unknown} kill
 * @property {{ resume(): unknown } | null} [stdout]
 * @property {{ setEncoding(encoding: 'utf8'): unknown, on(event: 'data', listener: (chunk: string) => void): unknown, once(event: 'close', listener: () => void): unknown, readableEnded?: boolean } | null} [stderr]
 */
/** 펫 프로세스와 주고받는 JSON 한 줄 (type 외 필드는 종류마다 다름) @typedef {{ type: string, [key: string]: unknown }} PetMessage */
/**
 * 창 안 캐릭터가 보내는 open 요청 본문 (파싱한 JSON. seq 는 정수일 때만 씀)
 * @typedef {object} OpenBody
 * @property {number} [seq]
 * @property {unknown} [from]
 * @property {unknown} [to]
 * @property {unknown} [follow]
 * @property {unknown} [grab]
 * @property {unknown} [avatar] 창 안 캐릭터의 3D 모델 사용 여부·외곽선 ({ enabled, outline })
 */

/**
 * 펫 창에 쓸 Electron 실행 파일 경로 (없으면 null)
 * DSH 데스크톱이 호스트를 자기 실행 파일의 Node 모드로 띄우며 넘겨 주는 경로 우선, 없으면 Electron 안에서 도는 지금 실행 파일
 */
export function electronExecutable(env = process.env, versions = process.versions, execPath = process.execPath) {
  return env.DSH_DESKTOP_NODE_EXECUTABLE || (versions.electron ? execPath : null)
}

/** 파일 하드링크, 안 되면(다른 드라이브 등) 복사 @param {string} from @param {string} to */
const linkOrCopy = async (from, to) => { try { await link(from, to) } catch { await copyFile(from, to) } }

/**
 * 폴더를 하드링크(안 되면 복사)로 통째 재귀 복제
 * @param {string} from @param {string} to @param {(name: string) => boolean} skip 맨 위 폴더에서 건너뛸 항목 판정 (하위 폴더는 모두 복제)
 */
async function mirror(from, to, skip) {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (skip(entry.name)) continue
    if (entry.isDirectory()) await mirror(join(from, entry.name), join(to, entry.name), () => false)
    else if (entry.isFile()) await linkOrCopy(join(from, entry.name), join(to, entry.name))
  }
}

/**
 * Windows: DSH Electron 파일을 묶은 펫 런타임 생성(실행 파일이 바뀌었을 때만)과 펫 앱 새로 넣기
 * @param {string} exe DSH Electron 실행 파일 @param {string} base 펫 런타임을 만들 폴더 @param {string} app 펫 앱 폴더 (pet/)
 * @returns {Promise<string>} 펫 실행 파일 경로
 */
async function prepareWindowsRuntime(exe, base, app) {
  const info = await stat(exe)
  const want = `${info.size}:${Math.round(info.mtimeMs)}`
  const dir = join(base, 'electron'), stamp = join(dir, 'dsc-pet.stamp')
  if (await readFile(stamp, 'utf8').catch(() => '') !== want) {
    await rm(dir, { recursive: true, force: true })
    await mirror(dirname(exe), dir, (name) => name === 'resources' || name === basename(exe) || /^uninstall/i.test(name))
    await linkOrCopy(exe, join(dir, PET_EXE))
    await writeFile(stamp, want)
  }
  const target = join(dir, 'resources', 'app')
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const name of await readdir(app)) await copyFile(join(app, name), join(target, name))
  return join(dir, PET_EXE)
}

const run = promisify(execFile)
const MAC_RECIPE = '1'   // 번들 구성 방법이 바뀌면 올려서 만들어 둔 런타임을 다시 만들게 함
const MAC_APP = 'DeepSeekChanPet.app'
const MAC_APP_ID = 'com.deepseek.dsh.dsc-pet'
const MAC_COPY = ['MacOS', 'Frameworks', 'Info.plist', 'PkgInfo', join('Resources', 'icon.icns')]   // DSH.app/Contents 에서 복제할 것 (app.asar·runtime 등 큰 리소스는 제외)
const MAC_EXE = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/

/** `…/X.app/Contents/MacOS/X` 형태면 그 .app 폴더 경로, 아니면 null (Windows 실행 파일 경로는 null) @param {string | null | undefined} exe @returns {string | null} */
export const macBundle = (exe) => MAC_EXE.exec(String(exe ?? ''))?.[1] ?? null

/** 파일이 바뀌었는지 비교하는 값 (크기:수정 시각 ms 반올림) @param {string} file */
const statKey = async (file) => { const info = await stat(file); return `${info.size}:${Math.round(info.mtimeMs)}` }

/**
 * macOS 펫 .app 을 다시 만들지 가리는 값 (번들 구성 방법 번호 + 실행 파일·Info.plist·Electron Framework 의 statKey)
 * @param {string} bundle DSH.app 폴더 @param {string} exe
 */
async function macStamp(bundle, exe) {
  const parts = await Promise.all([exe, join(bundle, 'Contents', 'Info.plist'), join(bundle, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework')].map(statKey))
  return `${MAC_RECIPE}:${parts.join(':')}`
}

/** APFS clone(디스크 0)으로 복제, 클론이 안 되는 볼륨이면 일반 복사 @param {string} from @param {string} to @param {Runner} runner */
async function cloneTo(from, to, runner) {
  await mkdir(dirname(to), { recursive: true })
  try { await runner('/bin/cp', ['-cR', from, to]) } catch { await runner('/bin/cp', ['-R', from, to]) }
}

/** 펫 .app Info.plist 고치기: 번들 ID 바꾸기, LSUIElement 켜기, app.asar 무결성·URL 스킴 항목 제거 @param {string} plist @param {Runner} runner */
async function patchMacPlist(plist, runner) {
  await runner('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', MAC_APP_ID, plist])   // DSH 와 다른 앱으로 보이게
  await runner('/usr/bin/plutil', ['-replace', 'LSUIElement', '-bool', 'true', plist])             // Dock·앱 전환기·메뉴 막대에 안 나타남
  for (const key of ['ElectronAsarIntegrity', 'CFBundleURLTypes']) await runner('/usr/bin/plutil', ['-remove', key, plist]).catch(() => {})   // 없는 app.asar 해시·dsh:// 스킴 가로채기 제거
}

/**
 * DSH.app 일부를 복제한 펫 전용 .app 생성. 수정한 사본만 ad-hoc 재서명하고 원본 앱은 읽기만 함
 * @param {string} bundle DSH.app 폴더 @param {string} out 만들 펫 .app 폴더 @param {Runner} runner
 */
async function buildMacBundle(bundle, out, runner) {
  const contents = join(out, 'Contents')
  for (const name of MAC_COPY) await cloneTo(join(bundle, 'Contents', name), join(contents, name), runner).catch((error) => { if (!name.startsWith('Resources')) throw error })
  const stub = join(contents, 'Resources', 'app')
  await mkdir(stub, { recursive: true })
  await writeFile(join(stub, 'package.json'), JSON.stringify({ name: 'dsc-pet', main: '../../../../pet-app/main.cjs' }))   // out/../pet-app (Contents/Resources/app 에서 네 칸 위)
  await patchMacPlist(join(contents, 'Info.plist'), runner)
  await runner('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', out]).catch(() => {})
  await runner('/usr/bin/codesign', ['--force', '-s', '-', out])   // 하드닝 런타임 플래그를 붙이면 DSH 서명 Frameworks 와 섞여 실행이 멈춤(실측)
}

/**
 * macOS: 펫 .app 생성(실행 파일이 바뀌었을 때만)과 .app 밖(pet-app)에 펫 앱 새로 넣기
 * @param {string} exe DSH.app 안 실행 파일 @param {string} base 펫 런타임을 만들 폴더 @param {string} app 펫 앱 폴더 (pet/) @param {Runner} runner
 * @returns {Promise<string>} 펫 실행 파일 경로
 */
async function prepareMacRuntime(exe, base, app, runner) {
  // prepareRuntime 이 macBundle(exe) 가 있을 때만 부름
  const bundle = /** @type {string} */ (macBundle(exe)), dir = join(base, 'electron'), stamp = join(dir, 'dsc-pet.stamp')
  const want = await macStamp(bundle, exe)
  if (await readFile(stamp, 'utf8').catch(() => '') !== want) {
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    await buildMacBundle(bundle, join(dir, MAC_APP), runner)
    await writeFile(stamp, want)
  }
  const target = join(dir, 'pet-app')
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const name of await readdir(app)) await copyFile(join(app, name), join(target, name))
  return join(dir, MAC_APP, 'Contents', 'MacOS', basename(exe))
}

/**
 * 펫 런타임 준비. 실행 파일 모양으로 플랫폼 구분 (…/X.app/Contents/MacOS/X = macOS)
 * @param {string} exe DSH Electron 실행 파일 @param {string} base 펫 런타임을 만들 폴더 @param {string} [app] 펫 앱 폴더 (pet/) @param {Runner} [runner]
 * @returns {Promise<string>} 펫 실행 파일 경로
 */
export function prepareRuntime(exe, base, app = PET_APP, runner = run) {
  return macBundle(exe) ? prepareMacRuntime(exe, base, app, runner) : prepareWindowsRuntime(exe, base, app)
}

/**
 * 호스트 ↔ 펫 프로세스 연결 지점. Windows = 이름 있는 파이프, macOS = 짧은 경로의 unix 소켓(sun_path 104바이트 한계, 0700 폴더 안). cleanup 은 폴더를 지움
 * @param tempDir 소켓 폴더를 만들 임시 폴더 (경로가 70바이트를 넘으면 /tmp)
 */
export async function createEndpoint(platform = process.platform, tempDir = tmpdir()) {
  if (platform === 'win32') return { path: `\\\\.\\pipe\\dsc-pet-${process.pid}-${randomUUID()}`,
    /** 정리할 것 없음 (이름 있는 파이프는 지울 폴더가 없음) */
    cleanup: async () => {} }
  const root = Buffer.byteLength(tempDir) > 70 ? '/tmp' : tempDir   // 소켓 경로 = root/dsc-pet-XXXXXX/s (약 18바이트 추가)
  const dir = await mkdtemp(join(root, 'dsc-pet-'))
  return { path: join(dir, 's'),
    /** 소켓 폴더째 지우기 */
    cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/** 펫 창 지원 여부 (실행 파일이 있고 Windows, 또는 .app 번들 안 실행 파일인 macOS) @param {NodeJS.Platform} platform @param {string | null | undefined} exe */
const supportedOn = (platform, exe) => !!exe && (platform === 'win32' || (platform === 'darwin' && !!macBundle(exe)))

/** 펫 프로세스 실행 옵션과 환경 (ELECTRON_RUN_AS_NODE 가 남아 있으면 Node 로만 돌고 창이 안 뜸). 표준 출력·오류는 진단용으로 받음 @param {NodeJS.Platform} platform @param {NodeJS.ProcessEnv} [base] */
function petSpawn(platform, base = process.env) {
  const env = { ...base }
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
  const stdio = /** @type {['ignore', 'pipe', 'pipe']} */ (['ignore', 'pipe', 'pipe'])
  if (platform === 'darwin') { delete env.__CFBundleIdentifier; return { env, stdio } }
  return { env, stdio, windowsHide: false }
}

const STDERR_TAIL = 8192   // 종료 알림에 실을 펫 표준 오류의 마지막 부분 (문자 수)

/**
 * 펫 표준 출력 비우기와 표준 오류 꼬리(STDERR_TAIL 문자) 보관. 파이프가 차서 펫이 멈추지 않게 둘 다 계속 읽음
 * @param {PetChild} spawned
 * @returns {() => string} 지금까지 보관한 표준 오류 꼬리
 */
function captureOutput(spawned) {
  let tail = ''
  spawned.stdout?.resume()
  spawned.stderr?.setEncoding('utf8')
  spawned.stderr?.on('data', (chunk) => { tail = (tail + chunk).slice(-STDERR_TAIL) })
  return () => tail
}

/** 표준 오류를 끝까지 읽은 뒤(최대 0.5초) 실행. 표준 오류가 없거나 이미 끝났으면 바로 @param {PetChild} spawned @param {() => void} done */
function afterStderr(spawned, done) {
  const stream = spawned.stderr
  if (!stream || stream.readableEnded) { done(); return }
  let pending = true
  /** 한 번만 실행 */
  const finish = () => { if (pending) { pending = false; clearTimeout(timer); done() } }
  const timer = setTimeout(finish, 500)
  stream.once('close', finish)
}

/**
 * 종료 알림에 덧붙일 진단 필드 (값이 있는 것만: 종료 코드·신호·표준 오류 꼬리)
 * @param {number | null | undefined} code @param {string | null | undefined} signal @param {string} stderr
 */
const exitDetail = (code, signal, stderr) => ({ ...(typeof code === 'number' ? { code } : {}), ...(signal ? { signal } : {}), ...(stderr ? { stderr } : {}) })

const READY_TIMEOUT = 15000   // 보통 2~3초. 이 안에 ready가 없으면 시작 도중 멈춘 것으로 봄 (macOS 서명·보안 정책 변화 등)
const TASKPOLICY = '/usr/sbin/taskpolicy'

/**
 * macOS: 시작하는 동안(모델 불러오기, CPU 약 2.5초) 백그라운드 우선순위로 낮춰 작업 방해 방지 (실패는 무시)
 * 띄운 뒤 -p로 거는 이유: `taskpolicy -b <명령>`으로 시작부터 건 백그라운드는 나중에 -B -p로 풀리지 않음(종료 코드 0이지만 그대로, 실측)
 * 낮춘 뒤 펫이 띄우는 GPU·renderer 프로세스는 같은 우선순위를 물려받고, -B -p로 풀림(실측)
 * @param {number} pid
 * @param {Runner} [runner]
 */
export const lowerPriority = (pid, runner = run) => runner(TASKPOLICY, ['-b', '-p', String(pid)]).then(() => {}, () => {})

/** macOS: 펫 프로세스와 그 자식 프로세스의 백그라운드 우선순위 해제 (실패는 무시) @param {number} pid @param {Runner} [runner] */
export async function restorePriority(pid, runner = run) {
  const kids = await runner('/usr/bin/pgrep', ['-P', String(pid)]).then((result) => String(result.stdout).split('\n').filter(Boolean), () => [])
  await Promise.all([String(pid), ...kids].map((processId) => runner(TASKPOLICY, ['-B', '-p', processId]).catch(() => {})))
}

/** 펫 런타임을 만들 기본 폴더 (macOS: Application Support 아래, 그 밖: LOCALAPPDATA 또는 ~/.cache 아래) */
const defaultBase = (platform = process.platform) => platform === 'darwin'
  ? join(homedir(), 'Library', 'Application Support', 'deepseek-harness-kr', 'pet-runtime')
  : join(process.env.LOCALAPPDATA || join(homedir(), '.cache'), 'deepseek-harness-kr', 'pet-runtime')

/**
 * 펫 프로세스 하나 관리. 처음 끌 때 숨긴 채로 띄워 두고(warm), 창 밖으로 던지면 보여 줌(open)
 * 붙으면 창 안 캐릭터가 숨김을 요청하고 프로세스는 남아 다음에 바로 뜸. 호스트가 내려가면 파이프가 끊겨 펫도 종료
 * @param {object} [options]
 * @param {string} [options.assets] 캐릭터 자산 폴더 (펫 창이 dsc.js·모델을 읽는 곳)
 * @param {string | null} [options.exe] DSH Electron 실행 파일
 * @param {NodeJS.Platform} [options.platform]
 * @param {string} [options.base] 펫 런타임을 만들 폴더
 * @param {string} [options.app] 펫 앱 폴더 (pet/)
 * @param {(command: string, args: string[], options: object) => PetChild} [options.spawnImpl] 프로세스 실행 (시험용)
 * @param {typeof prepareRuntime} [options.prepare] 펫 런타임 준비 (시험용)
 * @param {number} [options.readyTimeout] 펫 창이 준비됐다고 알릴 때까지 기다리는 시간(ms)
 * @param {number} [options.authTimeout] 펫 프로세스가 비밀값으로 인증할 때까지 기다리는 시간(ms)
 * @param {() => unknown} [options.avatarDir] 모델 폴더 설정(avatarModelDir)을 지금 값으로 읽기 (펫 창도 창 안과 같은 3D 모델을 그리게 함)
 */
export function createPetManager({ assets, exe = electronExecutable(), platform = process.platform, base = defaultBase(platform), app = PET_APP, spawnImpl = spawn, prepare = prepareRuntime, readyTimeout = READY_TIMEOUT, authTimeout = 5000, avatarDir = () => '' } = {}) {
  const supported = supportedOn(platform, exe)
  // seq: 마지막으로 연 회차 (새로 불러온 화면이 이어받음), disposed: 플러그인이 내려감 (시작 도중이면 펫을 띄우지 않음)
  let child = /** @type {PetChild | null} */ (null), server = /** @type {import('node:net').Server | null} */ (null), socket = /** @type {import('node:net').Socket | null} */ (null), starting = /** @type {Promise<void> | null} */ (null), state = 'none', seq = /** @type {number | undefined} */ (undefined), disposed = false, endpoint = /** @type {Awaited<ReturnType<typeof createEndpoint>> | null} */ (null)
  let readyTimer = /** @type {NodeJS.Timeout | null} */ (null)   // 띄운 펫이 ready를 보내지 않으면(시작 도중 멈춤) 끝내고 다음 시도에 맡김
  const events = /** @type {PetMessage[]} */ ([]), outbox = /** @type {PetMessage[]} */ ([])
  // 3D 모델: 창 안 캐릭터가 쓰는 렌더러(warm·open 본문 avatar = { enabled, outline })와 지금 폴더 설정을 합쳐 펫 프로세스에 보냄 (바뀔 때만)
  let avatarWanted = /** @type {{ enabled?: unknown, outline?: unknown }} */ ({ enabled: false }), avatarSent = /** @type {string | null} */ (null)
  /** @type {Set<import('node:net').Socket>} */
  const connections = new Set()
  /** 펫 프로세스로 메시지 보내기. 인증 전 시작 중이면 outbox 에 모아 두고, 시작도 안 했으면 버림 @param {PetMessage} message */
  const write = (message) => {
    if (socket) socket.write(JSON.stringify(message) + '\n')
    else if (starting) outbox.push(message)
  }
  /** 펫 프로세스 메시지 처리: 상태 갱신, 우선순위 되돌리기, 알림 쌓기(최근 100개까지) @param {PetMessage | null | undefined} message 펫이 보낸 JSON (모양은 여기서 확인) */
  const onMessage = (message) => {
    if (!message || typeof message.type !== 'string') return
    // 시작이 끝났으니 보통 우선순위로. 보일 때도 한 번 더 (나중에 생긴 자식 프로세스까지)
    if ((message.type === 'ready' || message.type === 'shown') && platform === 'darwin' && child?.pid) restorePriority(child.pid).catch(() => {})
    // clearTimeout 은 null 도 받지만 @types/node 시그니처에는 없어 캐스트
    if (message.type === 'ready') { clearTimeout(/** @type {NodeJS.Timeout | undefined} */ (readyTimer)); readyTimer = null }
    if (message.type === 'ready' || message.type === 'hidden') state = 'hidden'
    else if (message.type === 'shown') state = 'shown'
    if (message.type !== 'ready') events.push(message)
    if (events.length > 100) events.splice(0, events.length - 100)
  }
  /** 호스트가 본 연결 문제를 펫 창 기록(log)과 같은 알림으로 쌓기 (창 안 캐릭터가 DSH 창 콘솔에 경고) @param {string} text */
  const note = (text) => onMessage({ type: 'log', level: 'warn', text })
  /** 타이머·연결·서버·연결 지점 정리와 상태 초기화 (프로세스는 끝내지 않음) */
  const reset = () => {
    clearTimeout(/** @type {NodeJS.Timeout | undefined} */ (readyTimer)); readyTimer = null
    for (const connection of connections) connection.destroy()
    connections.clear()
    socket?.destroy()
    child = null; socket = null; starting = null; state = 'none'; outbox.length = 0; avatarSent = null
    server?.close(); server = null
    endpoint?.cleanup().catch(() => {}); endpoint = null
  }
  /** 펫 프로세스 시작 (이미 시작 중·시작함이면 같은 Promise). 연결 지점 열기 → 런타임 준비 → 실행 → ready 시간 제한 예약 */
  const start = () => starting ??= (async () => {
    const pipeEndpoint = endpoint = await createEndpoint(platform)
    const pipe = pipeEndpoint.path
    const secret = randomBytes(32).toString('hex')
    server = createServer((connection) => {
      if (socket || disposed) { connection.destroy(); return }
      connections.add(connection)
      const timer = setTimeout(() => { note('pet authentication timed out'); connection.destroy() }, authTimeout)
      connection.setEncoding('utf8')
      let buffer = '', authenticated = false
      connection.on('data', (chunk) => {
        buffer += chunk
        for (let i; (i = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
          if (Buffer.byteLength(line) > 1024 * 1024) { connection.destroy(); return }
          let message
          try { message = JSON.parse(line) } catch { note('pet sent invalid JSON'); connection.destroy(); return }
          if (!authenticated) {
            const token = Buffer.from(typeof message?.secret === 'string' ? message.secret : '')
            const expected = Buffer.from(secret)
            if (socket || message?.type !== 'auth' || token.length !== expected.length || !timingSafeEqual(token, expected)) { note('pet authentication failed'); connection.destroy(); return }
            authenticated = true; clearTimeout(timer); socket = connection
            server?.close()
            for (const other of connections) if (other !== connection) other.destroy()
            for (const pending of outbox.splice(0)) write(pending)
          } else onMessage(message)
        }
        if (Buffer.byteLength(buffer) > 1024 * 1024) connection.destroy()
      })
      connection.on('close', () => { clearTimeout(timer); connections.delete(connection); if (socket === connection) socket = null })
      connection.on('error', (error) => note(`pet connection error: ${error.message}`))
    })

    // 리슨 전에 닫히면(시작 도중 dispose) 리슨 콜백이 오지 않으므로 close로도 끝냄
    const pipeServer = server
    await new Promise((resolve, reject) => { pipeServer.once('error', reject); pipeServer.once('close', () => reject(new Error('disposed'))); pipeServer.listen(pipe, /** @type {() => void} */ (resolve)) })
    if (disposed) throw new Error('disposed')
    // supported(=exe 있음)일 때만 start 가 불림
    const petExecutable = await prepare(/** @type {string} */ (exe), base, app)
    if (disposed) throw new Error('disposed')
    const options = petSpawn(platform)
    options.env.DSC_PET_SECRET = secret
    const spawned = child = spawnImpl(petExecutable, [`--dsc-pipe=${pipe}`, `--dsc-assets=${assets}`], options)
    if (platform === 'darwin' && spawned?.pid) lowerPriority(spawned.pid)
    state = 'starting'
    // 지금 회차 번호를 붙여, 창 안 쪽이 이전 회차에 쌓인 종료 알림으로 진행 중인 따라오기를 끊지 않게 함. 이미 다른 프로세스로 바뀌었으면 무시
    const stderrTail = captureOutput(spawned)
    spawned.once('exit', (code, signal) => {
      if (child !== spawned) return
      const closedSeq = seq
      reset(); afterStderr(spawned, () => events.push({ type: 'closed', seq: closedSeq, ...exitDetail(code, signal, stderrTail()) }))
    })
    spawned.once('error', (error) => { if (child !== spawned) return; reset(); events.push({ type: 'error', message: error.message, seq }) })
    readyTimer = setTimeout(() => {
      if (child !== spawned || state !== 'starting') return
      reset(); try { spawned.kill() } catch {}
      events.push({ type: 'error', message: 'pet did not become ready', seq, ...exitDetail(null, null, stderrTail()) })
    }, readyTimeout)
  })().catch((error) => { const started = child; reset(); started?.kill(); events.push({ type: 'error', message: error.message }); throw error })
  /**
   * 펫 프로세스에 3D 모델 설정 보내기 (바뀌었을 때만, 창 안 캐릭터가 3D가 아니면 폴더 없이 = Live2D)
   * open보다 먼저 보내서, 바뀌었으면 펫 창이 숨은 채 새로 불러온 뒤 나타나게 함
   * @param {{ avatar?: unknown } | null | undefined} body warm·open 본문
   */
  const syncAvatar = (body) => {
    if (body?.avatar && typeof body.avatar === 'object') avatarWanted = /** @type {{ enabled?: unknown, outline?: unknown }} */ (body.avatar)
    const dir = avatarWanted.enabled === true ? String(avatarDir() ?? '').trim() : ''
    const message = { type: 'avatar', dir, outline: avatarWanted.outline === 'model' ? 'model' : 'smooth' }
    const key = JSON.stringify(message)
    if (key === avatarSent) return
    avatarSent = key; write(message)
  }
  return {
    /** 지금 상태·회차·쌓인 알림 @param drain true면 쌓인 알림을 비우며 돌려줌, false면 알림 대신 빈 목록 */
    status(drain = true) { return { supported, state, seq, events: drain ? events.splice(0) : [] } },
    /** 숨긴 채로 펫 프로세스 미리 띄우기 (지원할 때만) @param {{ avatar?: unknown } | null} [body] */
    async warm(body) { if (!supported) return; await start(); syncAvatar(body) },
    /** 펫 창 열기 (필요하면 먼저 시작). 정수 seq 만 이 회차 번호로 기억 @param {OpenBody | null | undefined} body */
    async open(body) {
      if (!supported) return
      await start()
      syncAvatar(body)
      seq = Number.isInteger(body?.seq) ? /** @type {OpenBody} */ (body).seq : undefined   // 정수 seq 가 있으면 body 도 있음
      write({ type: 'open', from: body?.from, to: body?.to, follow: body?.follow === true, grab: body?.grab, seq })   // grab: 따라오기에서 커서가 몸을 잡은 자리
    },
    /** 창 안 캐릭터의 명령 목록 전달 (배열이고 펫 프로세스가 있을 때만) @param {unknown} list */
    send(list) { if (Array.isArray(list) && state !== 'none') write({ type: 'cmd', list }) },
    /** 펫 창 숨기기 (펫 프로세스가 있을 때만) */
    hide() { if (state !== 'none') write({ type: 'hide' }) },
    /** 플러그인 내려감: 시작 도중이면 띄우지 않게 표시, 정리 뒤 펫 프로세스 종료 */
    dispose() { disposed = true; const running = child; reset(); try { running?.kill() } catch {} },
  }
}

/**
 * 요청 본문을 JSON 으로 읽기 (결과는 JSON.parse 처럼 any: 쓰는 쪽이 필드마다 확인, 빈 본문은 {})
 * @param {IncomingMessage} req @param {number} [limit] 본문 길이 상한 (문자 수, 넘으면 거절)
 * @returns {Promise<any>}
 */
const readJson = (req, limit = 256 * 1024) => new Promise((resolve, reject) => {
  let size = 0, text = ''
  req.setEncoding('utf8')
  req.on('data', (chunk) => { size += chunk.length; if (size > limit) { reject(new Error('too large')); req.destroy() } else text += chunk })
  req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}) } catch (error) { reject(error) } })
  req.on('error', reject)
})

/**
 * 창 안 캐릭터가 부르는 경로의 처리기: GET poll(상태 + 쌓인 알림을 비움), POST warm·open·send·hide
 * 프로세스를 띄우는 경로라 DSH 연결 서비스의 인증 검사(requestRejection)를 통과한 요청만 받음. 검사기가 없으면 모두 거절
 * @param {ReturnType<typeof createPetManager>} pet
 * @param {(req: import('node:http').IncomingMessage) => number | undefined} [rejection] 거절할 HTTP 상태 코드 (통과면 undefined)
 * @returns {(req: IncomingMessage, res: ServerResponse) => Promise<void>}
 */
export function createPetHandler(pet, rejection = () => 503) {
  return async (req, res) => {
    /** JSON 응답 보내기 (캐시 금지) @param {number} code HTTP 상태 코드 @param {unknown} value */
    const json = (code, value) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
    const denied = rejection(req)
    if (denied !== undefined) { res.writeHead(denied); res.end(); return }
    const path = (req.url || '').split('?')[0].slice(PET_PATH.length)
    try {
      if (req.method === 'GET' && path === '/poll') return json(200, pet.status())
      if (req.method !== 'POST') return json(405, { error: 'method' })
      const body = await readJson(req)
      if (path === '/warm') await pet.warm(body)
      else if (path === '/open') await pet.open(body)
      else if (path === '/send') pet.send(body.list)
      else if (path === '/hide') pet.hide()
      else return json(404, { error: 'unknown' })
      json(200, pet.status(false))
    } catch (error) {
      if (!res.headersSent) json(500, { error: /** @type {Error} */ (error).message })
    }
  }
}
