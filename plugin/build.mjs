// 소스 → 배포 산출물 빌드. 산출물은 커밋한다(GitHub 주소 설치에는 빌드 단계가 없다).
//   character/standalone.ts → assets/dsc.js   (<script>로 바로 실행: 바깥 펫 창)
//   plugin/client.ts        → lib/client.js   (DSH 모듈 로더 형식: window.__ModuleLoader__.load)
//   shared/settings.js      → pet/settings.cjs (펫 Electron 메인 프로세스용, 펫 앱 폴더째 런타임으로 복사된다)
// esbuild는 devDependency로 설치하거나, ESBUILD에 esbuild/lib/main.js 경로를 넣어 지정한다.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const packageName = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).name
const GENERATED = '// 빌드 산출물입니다. 직접 고치지 말고 소스(character/, plugin/client.ts, shared/)를 고친 뒤 npm run build 하세요.'

/** esbuild 불러오기 (ESBUILD 환경 변수 경로 우선, 없으면 esbuild 패키지). 못 불러오면 설치 안내 오류 */
async function loadEsbuild() {
  const override = process.env.ESBUILD
  const loaded = await import(override ? pathToFileURL(override).href : 'esbuild').catch((error) => {
    throw new Error('esbuild를 불러오지 못했습니다' + (override ? ` (ESBUILD=${override})` : ' (npm install 필요)') + ': ' + error.message)
  })
  return loaded.build ? loaded : loaded.default
}

const esbuild = await loadEsbuild()
// 결과를 파일에 바로 쓰지 않고 받아서 쓴다: 같은 소스면 같은 바이트가 나오는지(재현성) 테스트가 확인한다
const common = { bundle: true, platform: 'browser', target: 'es2022', charset: 'utf8', legalComments: 'none', write: false, logLevel: 'warning' }

const character = await esbuild.build({
  ...common,
  entryPoints: [join(root, 'character/standalone.ts')],
  format: 'iife',
  banner: { js: GENERATED },
})
const client = await esbuild.build({
  ...common,
  entryPoints: [join(here, 'client.ts')],
  format: 'cjs',
  external: ['react'],
  banner: { js: `${GENERATED}\nwindow.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports;\n} });' },
})

// 3D 렌더러(three.js·FBXLoader·툰 재질): 3D 모델을 켰을 때만 script 태그로 불러오는 따로 묶음
const rigThree = await esbuild.build({
  ...common,
  entryPoints: [join(root, 'character/rig-three-entry.ts')],
  format: 'iife',
  minify: true,
  banner: { js: GENERATED },
})

const petSettings = await esbuild.build({
  ...common,
  entryPoints: [join(root, 'shared/settings.js')],
  platform: 'node',
  format: 'cjs',
  banner: { js: GENERATED },
})

await writeFile(join(root, 'assets/dsc.js'), character.outputFiles[0].text)
await writeFile(join(root, 'pet/settings.cjs'), petSettings.outputFiles[0].text)
await writeFile(join(root, 'assets/vendor/rig-three.js'), rigThree.outputFiles[0].text)
await mkdir(join(root, 'lib'), { recursive: true })
await writeFile(join(root, 'lib/client.js'), client.outputFiles[0].text)
await writeFile(join(root, 'cordis.patch.yml'), `- insert:\n    - id: deepseek-harness-kr\n      name: ${JSON.stringify(packageName)}\n`)
const dictionaries = JSON.parse(await readFile(join(here, 'locales.ko.json'), 'utf8'))
console.error(`Built assets/dsc.js and lib/client.js: ${Object.keys(dictionaries).length} Korean namespaces.`)
