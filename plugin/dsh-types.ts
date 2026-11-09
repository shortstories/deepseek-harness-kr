// plugin/client.ts가 DSH 페이지 ctx에서 실제로 쓰는 모양만 적은 타입 (타입 검사 전용, 빌드 결과에는 없음).
// DSH 쪽 전체 API가 아니라 이 플러그인이 부르는 범위만 선언한다.
import type React from 'react'

/** 붙인 것을 떼는 정리 함수 */
export type Dispose = () => void

/** remote 호출의 결과 봉투: 성공이면 value, 실패면 error */
export type RemoteResult<T> = { ok: true; value: T; error?: undefined } | { ok: false; error?: RemoteError }
export interface RemoteError { code?: string; diagnostic?: string; message?: string }

/** locale 서비스 */
export interface LocaleState { active: string; locales: Array<{ id: string }> }
export interface LocaleService {
  /** 지금 언어와 등록된 언어 목록 */
  getLocale(): LocaleState
  /** 언어 변경 구독 */
  subscribe(fn: () => void): Dispose
  /** 언어 선택지 추가 */
  addLanguage(language: { id: string; label: string; fallback: string }): Dispose
  /** 네임스페이스 하나의 번역 사전 등록 */
  register(namespace: string, locale: string, dictionary: unknown): Dispose
}

/** theme 서비스 */
export interface ThemeService {
  /** 지금 테마 (colorScheme: 'dark' 등) */
  getTheme(): { active: { colorScheme?: string } }
}

/** configForms.get(id)이 돌려주는 플러그인 설정 폼. V는 설정값 모양 */
export interface ConfigFormSnapshot<V> { status: string; writable?: boolean; value?: V }
export interface ConfigFormOp { op: 'set'; path: string[]; value: unknown }
export interface ConfigForm<V> {
  /** 폼 상태 변경 구독 */
  subscribe(fn: () => void): Dispose
  /** 지금 폼 상태 (불러오는 중이면 status가 'ready'가 아님) */
  getSnapshot(): ConfigFormSnapshot<V>
  /**
   * 최상위 설정 한 값 저장
   * @returns 저장했으면 true
   */
  set(field: string, value: unknown): Promise<boolean>
  /**
   * 경로로 지정한 안쪽 값 여러 개 저장. 없는 Harness 버전도 있어 확인 후 사용
   * @returns 저장했으면 true
   */
  mutate?(operations: ConfigFormOp[]): Promise<boolean>
}

/** 플러그인 목록 화면 등에 끼우는 슬롯 */
export interface SlotService {
  /** 이름 붙은 슬롯에 fn이 만든 것 끼우기 (fn이 돌려준 정리 함수로 떼기) */
  inject(name: string, fn: () => Dispose): Dispose
  /** 슬롯에 컴포넌트 등록 */
  register(entry: { name: string; key: string }, component: (props: { view?: string }) => React.ReactNode): Dispose
}

/** remote.pluginManager: 설치된 플러그인 목록과 설치·제거 */
export interface BundleRow { name: string; version?: string; source?: string }
export interface InstallOutcome { application?: string; error?: RemoteError }
export interface PluginManager {
  /** 설치된 플러그인 목록 */
  listBundles(): Promise<RemoteResult<BundleRow[]>>
  /**
   * 설치 주소로 플러그인 설치
   * @param spec 설치 주소 (github:owner/repo 등)
   */
  installBundle(spec: string, options: { enabled: boolean; requestId: string }): Promise<RemoteResult<InstallOutcome>>
  /** 이름으로 플러그인 제거 */
  removeBundle(name: string): Promise<RemoteResult<InstallOutcome>>
  /** requestId로 보낸 설치가 끝날 때까지 대기. 없는 Harness 버전도 있음 */
  waitForInstall?(requestId: string): Promise<RemoteResult<InstallOutcome>>
}

/** remote.credentials: 값은 돌려주지 않고 저장 여부만 전달 */
export interface CredentialView { configured?: boolean; source?: string }
export interface CredentialService {
  /** 참조 이름별 저장 여부 조회 (값은 돌려주지 않음) */
  describe(refs: string[]): Promise<RemoteResult<Record<string, CredentialView>>>
  /** 참조 이름에 값 저장 */
  set(ref: string, value: string): Promise<RemoteResult<unknown>>
}

export interface RemoteService {
  pluginManager: PluginManager
  credentials: CredentialService
  /** remote 이벤트 구독. 없는 Harness 버전도 있어 확인 후 사용 */
  $on?(event: string, fn: (ref: string) => void): Dispose
}

/** layout.panelInfo: 지금 열린 패널 */
export interface PanelInfo {
  /** 지금 열린 패널 정보 */
  getSnapshot(): { activePanelId?: string } | undefined
  /** 패널 변경 구독 (정리 함수를 돌려주지 않는 버전도 있음) */
  subscribe(fn: () => void): Dispose | undefined
}

/** ctx.inject 콜백이 받는 범위. 요청한 서비스만 들어 있다 (remote는 'remote'를 요청한 콜백에서만 쓴다) */
export interface InjectScope {
  /**
   * 이 주입 범위가 사라질 때까지 유지할 효과 등록
   * @param label 효과를 구분하는 이름
   */
  effect(fn: () => Dispose, label: string): void
  layout?: { panelInfo?: PanelInfo }
  remote: RemoteService
  /** 지금 열린 세션을 알려 주는 서비스 (있으면 캐릭터 대화가 세션 모델을 빌려 쓴다) */
  uiSession?: { adapter?: { current?: { getSnapshot?: () => unknown; subscribe?: (fn: () => void) => (() => void) | void } } }
}

/** apply(ctx)가 받는 ctx */
export interface DshContext {
  locale: LocaleService
  theme: ThemeService
  configForms: {
    /** 플러그인 설정 폼 (id는 설정 항목 id) */
    get<V>(id: string): ConfigForm<V>
  }
  slots: SlotService
  /**
   * 플러그인이 내려갈 때까지 유지할 효과 등록
   * @param label 효과를 구분하는 이름
   */
  effect(fn: () => Dispose, label: string): void
  /** 요청한 서비스가 준비되면 fn 실행. 없는 Harness 버전도 있어 확인 후 사용 */
  inject?(services: string[], fn: (scope: InjectScope) => void): void
}

declare global {
  interface Window {
    /** 이전 apply가 남긴 정리 함수 (같은 페이지에서 다시 붙을 때 먼저 부른다) */
    __deepseekHarnessKrDispose?: Dispose
  }
}
