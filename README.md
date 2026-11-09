# DeepSeek쟝 Plugin for DSH with KR

> 기존 `deepseek-harness-kr`에서 저장소명과 프로젝트명을 변경했습니다. 기존 설치와 설정은 그대로 유지됩니다.

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)를 한국어로 쓰고, 화면 안에 살아 움직이는 Live2D 버튜버 **DeepSeek짱**을 더하는 DSH 플러그인입니다.

![DeepSeek짱 소개 영상](docs/preview.gif)

<details>
<summary><b>소개 영상</b></summary>

https://github.com/user-attachments/assets/7e7a96cc-efc8-416d-89a0-f574fdcda690

</details>

## 주요 기능

- 얼굴 추적처럼 자연스러운 고개·몸 움직임 (눈이 먼저, 고개가 뒤따라 · 물리 엔진으로 가슴·머리카락이 출렁임)
- 작업 상태 반응: 시작 → 생각 중(혼잣말) → 도구 사용 → 승인 대기(식은땀) → 완료(하트 눈) / 실패(눈물)
- 말풍선 글자의 모음(한글 ㅏㅔㅣㅗㅜ, 영어 a·e·i·o·u)에 맞춘 입 모양
- 클릭 부위에 따라 반응하고, 마우스를 따라 눈과 고개가 움직입니다
- 반응이 끝나면 0.4~0.6초에 걸쳐 부드럽게 대기 자세로 돌아옵니다
- 가끔 꼬마 모습으로 산책을 다녀오고, 입력이 없으면 절전합니다
- 소품(안경)·옷(치마 길이·가슴 옷·신발·꼬리·동물귀)·체형(기본·체형 1·꼬마) 바꾸기
- 모바일(터치 전용) 화면에서도 캐릭터를 보여 주고, 좁은 화면에서는 입력창 위로 비켜 섭니다
- 플러그인·자동화 화면에서는 창 안 캐릭터와 말풍선을 잠시 숨깁니다. 대화 화면으로 돌아오면 기존 표시 상태로 복구하며, 이미 창 밖으로 꺼낸 독립 펫은 그대로 유지합니다.
- 캐릭터를 Harness 창 밖으로 꺼내 다른 앱 위에 띄우는 바깥 펫 창 — [바깥 펫 창](#바깥-펫-창)
- 파스텔 테마 (Harness의 밝은 모드·다크 모드 설정을 그대로 따름). 좁은 화면에서 겹쳐 뜨는 왼쪽 드로어·오른쪽 전체화면 패널은 내용이 비치지 않도록 불투명 배경으로 표시합니다
- UI 번역 73개 네임스페이스를 제공하는 한국어 언어팩 (한국어·영어 화면 지원)
- (선택) 말풍선 음성(TTS) — [말풍선 음성](#말풍선-음성-tts-옵트인)
- (선택) 모델로 대화: 추론 중 혼잣말·작업 결과 요약·직접 대화를 캐릭터 모델이 맡음 — [캐릭터 대화](#캐릭터-대화-모델-연결-옵트인)
- 설정 창에서 기능별 켜기·끄기, 단축키 지정, 새 버전 확인과 업데이트 — [플러그인 설정](#플러그인-설정)

## 플러그인으로 설치

프로젝트 표시명은 **DeepSeek쟝 Plugin for DSH with KR**입니다. 기존 설치·설정과의 호환성을 위해 패키지명과 플러그인 ID는 `deepseek-harness-kr`를 유지합니다.

DSH Desktop 앱과 브라우저 Web UI에서 사용할 수 있습니다. 텍스트 CLI/TUI와 headless 환경은 지원하지 않습니다.

### Harness에서 설치

1. Harness의 **Plugins**에서 **+ Add plugin** 버튼을 클릭합니다.
2. **Add Plugin** 창에 아래 GitHub 주소를 입력해 설치·활성화합니다.

   ```text
   git+https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR.git
   ```

3. 한국어가 자동 선택되지 않으면 **Settings → General → Language**에서 **한국어**를 선택합니다.

앱에서 설치하면 현재 앱이 사용하는 프로필에 적용됩니다. 별도의 Node/npm 설치는 필요하지 않습니다.
플러그인은 DSH 사용자 프로필에 설치되므로 앱 업데이트가 설치 파일을 교체해도 유지됩니다. 비활성화하면 캐릭터·테마·번역 등록이 해제됩니다.

### 업데이트

플러그인 설정 화면에서 바로 업데이트할 수 있습니다.

1. **플러그인**(Plugins)에서 이 플러그인의 상세 페이지를 열고, **포함된 구성 요소**(Components) 아래의 **deepseek-harness-kr**를 클릭해 설정 창을 엽니다.
2. 아래쪽 **업데이트** 칸이 설치한 GitHub 주소의 최신 버전을 확인합니다. 새 버전이 있으면 **업데이트**를 누르고 안내를 확인한 뒤 **계속**을 누릅니다.
3. 플러그인이 잠시 꺼졌다가 새 버전으로 다시 켜집니다. 캐릭터·테마·한국어 설정은 그대로 남습니다. 혹시 업데이트에 실패해 플러그인이 목록에서 사라졌다면 **플러그인 추가**(+ Add plugin)에서 같은 GitHub 주소로 다시 추가하세요.

업데이트 칸은 GitHub 주소로 설치한 경우에만 동작합니다. 포크에서 설치했다면 그 포크의 최신 버전을 확인합니다.

## 사용법

### 캐릭터 조작

- **옮기기**: 왼쪽·오른쪽 버튼을 **함께** 누른 채 끌기. 첫 버튼을 누른 뒤 약 **150ms 안에** 다른 버튼을 눌러도 자연스럽게 집힙니다(좌→우·우→좌 모두). 더 늦게 눌러도 두 버튼을 함께 누른 채 움직이면 기존처럼 동작합니다. 설정한 **이동 키**(기본 `Alt`/`Option`)를 누른 채 왼쪽 드래그로도 옮길 수 있습니다. 바깥 펫 창에서도 같습니다 — [바깥 펫 창](#바깥-펫-창)
- **머리**를 누른 채 **위로/아래로** 쓸기 (빠르게/천천히 다름)
- **가슴**을 누른 채 **위로** 끌기, 그 상태로 **좌우로** 흔들기
- **치마**를 여러 번 만지기
- 몸 위에서 **휠**로 크기 조절
- 펫 창 **우클릭**: 설정 패널 · 크기 · 창으로 돌아가기
- 창 안 캐릭터 **우클릭**: 메뉴 (`대화하기…` · `소품·옷` · `체형` · `캐릭터 잠시 숨기기`, 바깥 펫 창을 쓸 수 있는 데스크톱 앱에서는 `창 밖으로 내보내기`도) — 대화는 메뉴에서 고릅니다 ([캐릭터 대화](#캐릭터-대화-모델-연결-옵트인))
- 단축키(설정에서 비우면 사용 안 함): 캐릭터와 말풍선 켜기·끄기 `Ctrl+Shift+D`, 펫 창 내보내기·돌아오기 `Ctrl+Shift+P`, 캔버스만 숨김/표시 `Ctrl+Shift+H`(기본 꺼짐)

### 바깥 펫 창

캐릭터를 **왼쪽·오른쪽 버튼을 함께 누르거나 이동 키를 누른 채** 끌어서 몸이 Harness 창 밖으로 15% 넘게 나가면, 다른 앱 위에 항상 떠 있는 투명한 펫 창이 캐릭터를 이어받습니다. 말풍선·몸짓·표정·음성 입 모양이 그대로 이어지고, 창 안에서는 상반신만 보이던 캐릭터가 펫 창에서는 **다리·신발까지 전신**으로 그려집니다.

- 캐릭터 몸 위에서만 클릭을 받고 나머지는 뒤 화면으로 통과합니다. 끌어서 옮기고, 제자리 근처에 놓으면 다시 Harness 창에 붙습니다. Harness를 끄면 펫 창도 함께 종료됩니다.
- **단축키로 내보내기·돌아오기**: 기본 `Ctrl+Shift+P`. 한 번 누르면 캐릭터가 바깥 펫 창으로 나가고, 다시 누르면 창 안 기본 자리로 돌아옵니다. 캔버스를 숨긴 상태에서는 단축키가 동작하지 않습니다(먼저 복구).
- **우클릭 메뉴**: `대화하기…` · `설정…`(크기 슬라이더·소품·옷·체형) · `크기`(75·100·125·150%) · `창으로 돌아가기` · `캐릭터 잠시 숨기기` · `소품·옷` · `체형`
- 바꾼 크기는 기억해 다음에 꺼내거나 Harness를 다시 켜도 유지되고, 창에 붙을 때는 원래 자리 크기로 돌아갑니다.
- **외부 펫 산책**은 출발한 모니터 안에서만 진행합니다. 왼쪽 거리가 부족하면 더 넓은 오른쪽으로 방향을 바꾸고, 선택한 경계까지 걸어간 뒤 마지막 구간에서 자연스럽게 사라집니다. 잠시 후 같은 모니터의 반대 경계에서 나타나 원래 자리로 돌아옵니다. 산책 도중 모니터가 제거되거나 작업 영역이 바뀌면 안전한 영역으로 복구합니다.
- **Desktop 앱의 Windows·macOS(Apple silicon)에서만 동작합니다.** 브라우저 Web UI와 그 외 환경에서는 창 안에서 끌어 옮기는 것까지만 됩니다.
- 별도 설치는 필요 없습니다. 한가할 때 펫 전용 런타임을 미리 만들어 두고(첫 끌기에서 기다리지 않게), Harness가 업데이트되면 자동으로 다시 만듭니다. 폴더를 지워도 안전합니다.
  - Windows: `%LOCALAPPDATA%\deepseek-harness-kr\pet-runtime`
  - macOS: `~/Library/Application Support/deepseek-harness-kr/pet-runtime`

## 플러그인 설정

**플러그인**(Plugins)에서 이 플러그인의 상세 페이지를 연 뒤, **포함된 구성 요소**(Components) 아래의 **deepseek-harness-kr**를 클릭하면 설정 창이 열립니다. 여기서 다음 기능을 각각 켜고 끌 수 있습니다.

<!-- 첫 칸 글자 사이에 보이지 않는 단어 결합 문자(U+2060)가 있어 단어 단위로만 줄바꿈됩니다. 항목을 고칠 때도 유지해 주세요. -->
| 설정 | 기능 |
|---|---|
| 캐⁠릭⁠터⁠와 말⁠풍⁠선 | Live2D 캐릭터, 표정·터치 반응과 말풍선 |
| 모⁠바⁠일⁠에⁠서⁠도 캐⁠릭⁠터 표⁠시 | 터치 전용 화면에서도 캐릭터를 보여 줌 (기본값 켜짐). 끄면 모바일에서 캐릭터와 복구 칩을 표시하지 않습니다 |
| 시⁠작⁠할 때 등⁠장 연⁠출 | 켜면 화면 가운데에서 크게 인사하고 제자리로 이동, 끄면 처음부터 오른쪽 아래에 뜸 (기본값 켜짐) |
| 앱 아⁠이⁠콘 | DeepSeek짱 아이콘으로 바꿈. 끄면 원래 아이콘으로 되돌림 (기본값 켜짐, 시작할 때와 업데이트 후 적용). **Windows**는 데스크톱·시작 메뉴 바로가기 아이콘(창·작업 표시줄 아이콘은 그대로), **macOS**는 Finder에서 보이는 앱 아이콘(앱에 사용자 지정 아이콘을 붙임, 실행 파일·서명은 그대로) |
| 파⁠스⁠텔 테⁠마 | 배경·색상·입력창 스타일. 밝은 모드와 다크 모드 모두 지원 (모드는 Harness 설정 → 모양에서 선택) |
| 한⁠국⁠어 언⁠어⁠팩 | 한국어 UI 번역 등록 |
| 소⁠품⁠·⁠옷 | 뿔테 안경, 외눈 안경, 치마 길이 바꾸기, 가슴 옷 바꾸기, 신발 벗기, 꼬리 숨기기, 동물귀 숨기기 (기본값 꺼짐) |
| 체⁠형 | 기본 체형, 체형 1, 체형 2(꼬마) 중 선택 (기본값 기본 체형) |
| 절⁠전 | 입력이 없을 때 캐릭터를 화면 밖으로 내보내고 렌더링 멈춤 (기본값 켜짐, 대기 시간 0.5~60분, 기본 1분) |
| 이⁠동 키 | 캐릭터를 집어 옮길 때 누르고 있어야 하는 키 (기본값 `Alt`/`Option`). 수식 키 하나 또는 일반 키 하나를 등록하고, 비우면 왼쪽·오른쪽 버튼을 함께 눌러야 합니다 |
| 단⁠축⁠키 | 캐릭터와 말풍선 설정을 켜고 끄는 단축키 (기본값 `Ctrl+Shift+D`). 칸을 누른 뒤 원하는 키 조합을 그대로 누르면 등록됩니다 (Esc 취소 · Backspace로 지우기 · Space/+ 키 지원) |
| 펫 창 단⁠축⁠키 | 캐릭터를 바깥 펫 창으로 내보내고 다시 불러오는 단축키 (기본값 `Ctrl+Shift+P`, 비우면 사용 안 함) |
| 캔⁠버⁠스⁠만 숨⁠김⁠/⁠표⁠시 | 왼쪽 스위치를 켠 사람만 쓰는 단축키 (기본값 꺼짐, `Ctrl+Shift+H`). 캐릭터 설정을 끄는 것이 아니라 캔버스만 잠시 숨기고 표시합니다(그리기만 멈춤). 숨긴 동안 화면 오른쪽 아래의 **‘캐릭터 숨김 · 다시 표시’** 칩으로 되돌릴 수 있습니다 |
| 말⁠풍⁠선 음⁠성 | 말풍선 대사를 TTS로 읽기 (기본값 꺼짐) — [말풍선 음성](#말풍선-음성-tts-옵트인) 참고 |
| 캐릭터 대화 | 혼잣말·결과 요약·직접 대화를 모델이 맡기 (기본값 꺼짐) — [캐릭터 대화](#캐릭터-대화-모델-연결-옵트인) 참고 |

캐릭터·테마·한국어는 기본값이 활성화이며, 변경 사항은 즉시 적용되고 현재 프로필에 저장됩니다. 한국어 표시 언어는 **설정 → 일반 설정 → 언어**(Settings → General → Language)에서 선택합니다.

## 말풍선 음성 (TTS, 옵트인)

0.1.6부터 말풍선 음성(`plugins/dsh-tts`)이 이 플러그인에 포함됩니다. 따로 설치할 것 없이 설정 창의 **말풍선 음성** 칸에서 켜고 설정합니다. YAML을 고칠 필요가 없습니다.

- OpenAI 호환 `/audio/speech` API로 음성을 스트리밍 재생하고, 소리 크기(RMS)에 맞춰 캐릭터 입을 움직입니다. 음소 단위 정밀 립싱크는 아직 지원하지 않습니다.
- 기본값은 **꺼짐**이고, 주소·모델·보이스도 미리 정해 두지 않습니다. 꺼져 있거나 URL이 비어 있으면 외부로 아무 요청도 보내지 않습니다.
- 설정 창에서 바꾼 값은 저장 즉시 다음 대사부터 적용됩니다. TTS가 꺼져 있거나 실패해도 말풍선은 평소대로 표시됩니다.

<!-- 앞 두 칸 글자 사이에 보이지 않는 단어 결합 문자(U+2060)가 있어 단어 단위로만 줄바꿈됩니다. 항목을 고칠 때도 유지해 주세요. -->
| 묶음 | 칸 | 설명 |
|---|---|---|
| (⁠제⁠목 줄⁠) | 말⁠풍⁠선 음⁠성 스⁠위⁠치 | 켜고 끄기 |
| 연⁠결 | A⁠P⁠I 주⁠소 | OpenAI 호환 주소(`/v1`까지). 예: `https://api.openai.com/v1`, Fish Audio `https://api.fish.audio/compat/v1`, 로컬 서버 `http://127.0.0.1:8000/v1` |
| 연⁠결 | A⁠P⁠I 키 | Harness 자격 증명 저장소에 저장되며 화면에는 저장 여부만 보입니다. 키가 필요 없는 로컬 서버라면 비워 둡니다 |
| 목⁠소⁠리 | 모⁠델 · 목⁠소⁠리 I⁠D | 비우면 요청에서 빼고 서버 기본값을 씁니다. OpenAI처럼 모델이 필수인 서버는 채워야 합니다 |
| 목⁠소⁠리 | 샘⁠플⁠레⁠이⁠트 (⁠H⁠z⁠) | 서버가 보내는 오디오와 같아야 합니다. OpenAI 24000, Fish 44100(또는 추가 요청 값에 `"sample_rate": 24000`) |
| 읽⁠을 대⁠사 | 4⁠종 | 반응·도구 상태·혼잣말·그 밖의 대사를 각각 켜고 끄기. 혼잣말은 모델 추론 요약이 섞일 수 있어 기본 꺼짐 |
| 고⁠급 | 추⁠가 요⁠청 값 (⁠J⁠S⁠O⁠N⁠) | 요청 본문에 합쳐지는 값. 예: `{ "speed": 1.1 }`, `{ "instructions": "밝게" }`. `input`·`response_format`·`stream_format`은 플러그인이 정합니다 |
| 고⁠급 | 그 밖⁠의 항⁠목 | 추가 헤더(JSON), 대사 앞 문구(예: Drama 3 연기 지시), 응답 대기 시간(초), 캐시, API 키 저장 이름 |

- API 키는 키 참조 이름(기본 `DSH_TTS_API_KEY`)으로 찾습니다. 저장된 키가 먼저이고, 없으면 같은 이름의 환경변수를 씁니다. 키는 브라우저로 넘어가지 않습니다.
- 켜면 말풍선 대사가 설정한 URL로 전송되고, 사용하는 서비스에 따라 요금이 나올 수 있습니다. AI가 만든 음성이라는 점을 듣는 사람에게 알려 주세요(OpenAI 이용 정책).
- OpenAI의 `gpt-4o-mini-tts`·`tts-1`·`tts-1-hd`는 2027-01-06에 종료될 예정입니다.

라우트 설명은 [`plugins/dsh-tts/README.md`](plugins/dsh-tts/README.md)를 참고하세요. 예전처럼 `dsh-tts`를 단독 row로 따로 넣었다면, kr 플러그인과 같은 라우트를 쓰므로 그 row를 지우고 설정 창으로 옮겨 주세요.

## 캐릭터 대화 (모델 연결, 옵트인)

0.7.4부터 캐릭터가 규칙 기반 대사 대신 **모델과 대화**할 수 있습니다. 설정 창의 **캐릭터 대화** 칸에서 켭니다. 기본값은 **꺼짐**이고, 꺼져 있으면 지금까지처럼 규칙 기반 대사만 나갑니다.

켜면 세 가지를 모델이 맡습니다.

| 맡는 일 | 내용 |
|---|---|
| 추론 중 혼잣말 | 화면의 추론 요약을 모델에 넘겨 짧은 한국어 한 문장으로 받아 점선 말풍선에 띄웁니다 (60자를 넘으면 …로 줄임) |
| 결과 요약 | 작업이 끝나면 방금 답변을 한 문장으로 요약해 보고합니다 (90자를 넘으면 …로 줄임, 실패하면 사과) |
| 직접 대화 | 창 안 캐릭터를 **우클릭**해 `대화하기…`를 고르면 **명령 한 줄 입력**이 열립니다. 보내면 답은 캐릭터가 말풍선으로 하고(같은 세션 안에서 앞선 명령을 기억), 입력창에는 기록이 쌓이지 않습니다 |

- **터치 반응과 도구 상태 대사는 그대로 규칙 기반입니다.** 모델을 부르면 반응이 느려지기 때문입니다.
- 모델 답변의 `[홍조]` 같은 표정 태그는 표정으로 바꾸고 본문만 말합니다.
- 대화 기억은 창을 닫으면 사라집니다. 캐릭터는 대화를 저장하지 않습니다.

### 모델 연결

| 방식 | 설명 |
|---|---|
| OpenAI 호환 API | 주소(`/v1`까지)·모델 이름·API 키를 넣습니다. 로컬 llama.cpp 서버(`http://127.0.0.1:11300/v1`)나 원격 API 모두 됩니다 |
| 지금 세션의 모델 빌리기 | 지금 열려 있는 대화 세션의 provider·모델을 그대로 빌려 씁니다. 주소도 키도 필요 없고, 세션 기록에는 아무것도 남기지 않습니다 |

- 세션 모델을 빌릴 때 **추론 강도**를 고를 수 있습니다(기본값 `끄기`). 혼잣말·요약은 짧은 문장이라 thinking이 필요 없고, 켜면 반응이 느려집니다.
- API 키는 Harness 자격 증명 저장소에 저장되며 화면에는 저장 여부만 보입니다. 키 참조 이름 기본값은 `DSH_CHAT_API_KEY`이고, 저장된 키가 없으면 같은 이름의 환경변수를 씁니다. 비우면 인증 없이 요청합니다.
- **고급**에서 응답 대기 시간과 역할별 지시문을 바꿀 수 있습니다. 지시문은 비워 두면 내장 문구를 쓰며, LoRA로 학습시킨 모델이라면 학습에 쓴 문구와 같게 두는 편이 결과가 안정적입니다.
- 켜면 대화 내용이 설정한 주소(또는 세션 모델)로 전송됩니다. 사용하는 서비스에 따라 요금이 나올 수 있습니다.

라우트는 `GET /deepseek-harness-kr/chat/state`(켜짐 여부와 역할)와 `POST /deepseek-harness-kr/chat`(`{ mode, text, history, sessionId }` → `{ text, mode, source }`) 두 개입니다. 꺼져 있으면 둘 다 라우트가 없는 것처럼 답합니다.

## 호환성

- 지원하는 DSH 버전은 0.2.1-rc.5 이상 0.3 미만입니다. 0.8.0 구조 개편은 Windows DSH 0.2.2와 macOS DSH 0.2.2-rc.1의 격리 프로필에서 실제 동작을 확인했습니다([#26](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/26)).
- 작업 상태와 추론 문구는 화면의 DOM 구조로 감지합니다. DSH 업데이트가 DOM 구조나 플러그인 API를 바꾸면 호환성 수정이 필요할 수 있습니다.
- Electron 네이티브 메뉴·업데이트/복구 창, 패키지 메타데이터 설명과 일부 하드코딩 문구는 언어팩의 번역 대상이 아닙니다.
- 펫 창의 크기 자동 조절과 복귀 연출은 Windows에서 검증했습니다. macOS에서는 화면 배치에 따라 창 위치가 어긋날 수 있습니다.

## 개발

### 폴더 구성

| 폴더 | 내용 |
|---|---|
| `plugin/` · `package.json` | DSH 플러그인: 호스트·설정 화면(`plugin/client.ts`)·한국어 번역(`plugin/locales.ko.json`)·빌드와 테스트 |
| `character/` | 인앱 캐릭터 TypeScript 소스. 빌드하면 `assets/dsc.js`와 `lib/client.js`가 만들어집니다 |
| `assets/` | 빌드된 캐릭터 코드(`dsc.js`)와 Live2D 모델·테마·배경 |
| `lib/` | 빌드된 플러그인 클라이언트(`client.js`) |
| `pet/` | 바깥 펫 창(Electron) 코드 |
| `shared/` | 캐릭터·설정 화면·펫 메뉴가 함께 쓰는 소품·체형 정의 |
| `plugins/dsh-tts/` | 말풍선 음성(TTS) 원본 코드. 0.1.6부터 kr 플러그인에 포함되어 설정 창에서 켭니다 |
| `infographic/` | 소개 영상 최종본과 제작 파일 |

### 빌드와 테스트

```powershell
npm ci
npm run locales     # 설치된 DSH 영어 사전과 비교해 빠진 번역 보고 (todo·merge는 plugin/locales.mjs 참고)
npm run build
npm run typecheck   # TypeScript 타입 검사 (출력 없음)
npm test
```

캐릭터·설정 화면 소스는 TypeScript(`character/*.ts`, `plugin/client.ts`)이고, 호스트·펫 메인은 Node가 직접 읽는 JavaScript(`// @ts-check`)입니다. 빌드는 `character/`의 캐릭터 코드와 `plugin/locales.ko.json`으로 플러그인 클라이언트(`lib/client.js`)와 펫 창용 `assets/dsc.js`를 생성합니다. 한국어 번역의 원본은 `plugin/locales.ko.json`입니다. 설정 스키마는 DSH의 `@deepseek-ai/schemastery`를 사용합니다.
빌드된 `lib/client.js`와 `assets/`를 저장소에 포함하므로 Git 주소로 설치할 때 빌드 스크립트를 실행하지 않습니다.
캐릭터 코드·번역·자산을 수정한 뒤에는 `npm run build`를 실행하고 생성물도 함께 커밋하세요.
사용자에게 나가는 변경이면 `package.json`의 `version`도 올려 주세요. 플러그인(Plugins) 화면의 버전 표시로 새 버전인지 구분할 수 있습니다.
동작을 바꾸지 않는 리팩터링이면 `npm run trace:diff -- <기준 커밋 체크아웃> [--pet]`으로 캐릭터 동작이 프레임마다 같은지 비교할 수 있습니다(기본 테스트에는 들어 있지 않음).

### Live2D 모델과 렌더러

이 Live2D 모델 전용 값(파일 경로·파라미터·파츠·표정·치수)은 `character/model-profile.ts`에 모여 있습니다(소품·체형 파라미터는 `shared/settings.js`). 애니메이션이 모델에 값을 쓰는 지점은 `character/index.ts`의 `setParam`·`addParam`·`multiplyParam`입니다.
VRM 같은 다른 렌더러를 붙이려면 이 값 외에 모델 불러오기(PIXI Live2D), 매 프레임 파라미터 쓰기(위 함수), 메시 정점·알파로 하는 터치 판정과 상반신·전신 기준 좌표 계산, 정점 변형을 맡는 Core Worker(`assets/dsc-core-worker.js`), 표정 파일 섞기, 동물귀 파트 불투명도 조절을 새 렌더러에 맞게 바꿔야 합니다. 렌더러 추상화 계층은 아직 없습니다.

### ASAR 패치·포터블 (지원 종료)

예전 방식에 쓰던 ASAR 패치 파일과 포터블 빌드 스크립트(`harness/`)는 저장소에서 삭제했습니다. 필요하면 git 기록에서 찾을 수 있습니다.

## 라이선스

- 이 저장소의 코드: MIT (`LICENSE`)
- 포함된 제3자 구성 요소와 그림: `NOTICE.md`

## 만든 사람

- [@noire113-dev](https://github.com/noire113-dev) — 기획, 테스트, 배경 그림
- [Claude](https://claude.ai) (Anthropic, Claude Code) — 한국어화·인앱 캐릭터 코드, 패치·빌드 도구, 소개 영상 제작, PR 검증·릴리즈
- [Codex](https://openai.com/codex) (OpenAI) — 이슈·PR 작업 계획, 코드 검수, 문서 정리
- [DeepSeek](https://www.deepseek.com) (DeepSeek V4.1 Flash 1017) — 버그 수정, PR 통합·기능 구현, 자동 테스트
- Live2D 모델 원작: Kamiya_Ryoko (VGen @KAMIYA) — `NOTICE.md` 참고

### 기여해 주신 분

- [@conankun](https://github.com/conankun) — 말풍선 TTS와 오디오 기반 입 모양 플러그인 `plugins/dsh-tts` ([#2](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/2)), 말풍선 꼬리를 얼굴 가운데로 정렬 ([#20](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/20))
- [@shortstories](https://github.com/shortstories) — Harness 플러그인 메뉴에서 바로 설치하는 방식, 캐릭터·테마·한국어 개별 설정 ([#3](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/3))
- [@TraceofLight](https://github.com/TraceofLight) — macOS(Apple silicon) 적용 스크립트 ([#4](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/4)), 승인·질문 카드가 캐릭터에 가려지던 문제 수정 ([#6](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/6)), Live2D 렌더링 최적화와 시작 시 끊김 완화 ([#7](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/7)), 말풍선 음성 내장·말풍선 꼬리·캐릭터 자유 위치와 바깥 펫 창 ([#12](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/12)), 펫 창 대기 오버헤드 감소·짧은 말풍선 꼬리·혼합 배율 모니터 위치 수정 ([#24](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/24)), 캐릭터 코드 TypeScript 모듈 개편·인트로와 창 크기 변경 중 사라짐 수정·한국어 번역 보강·macOS 앱 아이콘 ([#26](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/26))
- [@iwannagit](https://github.com/iwannagit) — 파스텔 테마 다크 모드 지원 ([#5](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/5)), 절전모드와 캐릭터 켜기·끄기 단축키 ([#11](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/11))
- [@0x2b-or-0xd4](https://github.com/0x2b-or-0xd4) — 단축키를 문자 입력 대신 키 녹음으로 지정 ([#14](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/14)), 바깥 펫 창 우클릭 메뉴·설정 패널과 크기 조절 ([#16](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/16)), 캐릭터 이동 키·펫 창·캔버스 단축키 ([#21](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/21))
- [@ByungHyun21](https://github.com/ByungHyun21) — 자산 응답 캐시(ETag·304)로 새로고침 속도 개선, 질문 카드 감지를 안정적인 data 속성으로 수정 ([#17](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/17)), 모바일 입력창·키보드 회피 ([#19](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/19)), 모바일 패널 배경 수정 ([#23](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/pull/23)), 동물귀 숨기기 제안 ([#22](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/issues/22))
- [@mayoxz](https://github.com/mayoxz) — 설치본 아이콘 모듈 누락 제보와 원인 분석 ([#18](https://github.com/noire113-dev/deepseek-chan-plugin-for-dsh-with-KR/issues/18))

좋은 기능을 보내 주신 분들께 감사드립니다!
