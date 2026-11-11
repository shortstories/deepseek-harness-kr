// 펫 창 페이지에 window.dscPet 을 넣는다. 페이지가 듣기 전에 온 메시지는 모아 두었다가 넘긴다.
const { contextBridge, ipcRenderer } = require('electron')
let listener = null
const queue = []
ipcRenderer.on('dsc', (_event, message) => { if (listener) listener(message); else queue.push(message) })
/** 메인 프로세스로 메시지 보내기 ('dsc' 채널) */
const send = (message) => ipcRenderer.send('dsc', message)
contextBridge.exposeInMainWorld('dscPet', {
  /** 메인 프로세스 메시지 듣기 등록 (그동안 모아 둔 메시지부터 넘김) */
  on(fn) { listener = fn; for (const message of queue.splice(0)) fn(message) },
  send,
  /** 펫 창 왼쪽 위를 화면 좌표 (x, y)로 옮기기. walk = 산책 중 여부 (true면 메인 프로세스가 실제 창 bounds를 회신) */
  move: (x, y, walk) => send({ type: 'move', x, y, walk: !!walk }),
  /** 누르는 중 여부 알리기 (true인 동안은 커서가 몸 밖이어도 클릭 받음) */
  press: (on) => send({ type: 'press', on: !!on }),
  /** 우클릭 메뉴 띄우기 */
  menu: () => send({ type: 'menu' }),
  /** 페이지 시작 설정 (3D 모델 여부·외곽선, 호스트 설정을 메인 프로세스가 전달) */
  config: () => ipcRenderer.invoke('dsc-config'),
})
