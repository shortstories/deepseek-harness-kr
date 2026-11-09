// 빌드 산출물입니다. 직접 고치지 말고 소스(character/, plugin/client.ts, shared/)를 고친 뒤 npm run build 하세요.
"use strict";
(() => {
  // shared/settings.js
  var OUTFIT_ITEMS = [
    { key: "glasses", ko: "뿔테 안경", en: "Glasses", param: "key11", on: 1, line: "outfit_glasses" },
    { key: "monocle", ko: "외눈 안경", en: "Monocle", param: "key12", on: 1, line: "outfit_glasses" },
    { key: "skirt", ko: "치마 길이 바꾸기", en: "Change skirt length", param: "Clothes1", on: -1, line: "outfit_clothes" },
    { key: "chestClothes", ko: "가슴 옷 바꾸기", en: "Change top", param: "Clothes3", on: 1, line: "outfit_clothes" },
    { key: "shoesOff", ko: "신발 벗기", en: "Take off shoes", param: "Clothes4", on: 1, line: "outfit_shoes" },
    { key: "tailHide", ko: "꼬리 숨기기", en: "Hide tail", param: "Clothes5", on: -1, line: "outfit_tail" },
    // 동물귀는 파라미터가 아니라 모델 파트(Part159)의 불투명도로 부드럽게 감춘다 (character/index.js의 earHide)
    { key: "earHide", ko: "동물귀 숨기기", en: "Hide animal ears" }
  ];
  var BODY_TYPES = [
    { key: "default", ko: "기본 체형", en: "Default", value: 0 },
    { key: "type1", ko: "체형 1", en: "Body type 1", value: 0.4 },
    { key: "type2", ko: "체형 2 (꼬마)", en: "Body type 2 (chibi)", value: 1 }
  ];

  // character/layout.ts
  var HOME_GAP = 8;
  var BUBBLE_ROOM = 78;
  var SHOW_K = 0.42;
  var MIN_SHOW_K = 0.18;
  var MOBILE_ABOVE_SCALE = 0.3;
  var homeLayout = ({ vp, r, maxK, W, visW, H, visH, minK, allowAbove = true }) => {
    const rightX = (k2) => vp.left + vp.w - 4 - (W + visW) / 2 * k2;
    const bottomY = (k2) => vp.top + vp.h - H * k2;
    const fit2 = (k2, above) => {
      const cap = above ? Math.min(maxK, (r.top - vp.top - HOME_GAP) / H) : Math.min(maxK, (vp.w - HOME_GAP) / visW);
      const want = k2 * (above ? MOBILE_ABOVE_SCALE : 1);
      const scale = Math.max(MIN_SHOW_K, Math.min(cap, want));
      return above ? { k: scale, x: rightX(scale), y: r.top - HOME_GAP - H * scale, above: true } : { k: scale, x: rightX(scale), y: bottomY(scale), above: false };
    };
    if (!r) {
      const k2 = maxK;
      return { k: k2, x: rightX(k2), y: bottomY(k2), above: false };
    }
    const sideK = Math.min(maxK, Math.max((vp.w - (r.right - vp.left) - HOME_GAP) / visW, (vp.h - (r.bottom - vp.top) - (allowAbove ? 4 : 10)) / visH));
    if (!allowAbove) return { k: sideK, x: rightX(sideK), y: bottomY(sideK), above: false };
    const aboveRoom = r.top - vp.top - HOME_GAP - BUBBLE_ROOM;
    const aboveK = Math.min(maxK, aboveRoom / H, (vp.w - HOME_GAP) / visW);
    if (sideK >= Math.min(minK, maxK)) return fit2(sideK, false);
    if (aboveK >= MIN_SHOW_K) return fit2(aboveK, true);
    const k = Math.min(maxK, MIN_SHOW_K);
    return { k, x: rightX(k), y: bottomY(k), above: false, noSafe: true };
  };
  var bubbleLayout = ({ vp, headX, headTop, bw, bh, r, above, tail = BUBBLE_TAIL }) => {
    const clampX = (left) => Math.min(Math.max(vp.left + HOME_GAP, left), Math.max(vp.left + HOME_GAP, vp.left + vp.w - bw - HOME_GAP));
    const clampY = (top) => Math.min(Math.max(vp.top + HOME_GAP, top), Math.max(vp.top + HOME_GAP, vp.top + vp.h - bh - HOME_GAP));
    const hit = (left, top) => !!r && left < r.right && left + bw > r.left && top < r.bottom && top + bh > r.top;
    const aboveTop = clampY(headTop - bh - 10);
    const aboveLeft = clampX(headX + tail - bw);
    if (!hit(aboveLeft, aboveTop) || above) return { left: aboveLeft, top: aboveTop, side: false };
    const below = r.bottom + HOME_GAP, sideLeft = clampX(vp.left + vp.w - bw - HOME_GAP);
    if (below + bh <= vp.top + vp.h - HOME_GAP) return { left: sideLeft, top: clampY(below), side: true };
    return { left: aboveLeft, top: aboveTop, side: false };
  };
  var BUBBLE_TAIL = 55;
  var bubbleTail = (bubbleWidth) => Math.min(BUBBLE_TAIL, Math.round((bubbleWidth || 2 * BUBBLE_TAIL) / 2) + 2);
  var tailRight = ({ noseX, width, margin = HOME_GAP, tail = BUBBLE_TAIL }) => Math.max(margin, width - (noseX + tail));
  var tailLeft = ({ noseX, bw, width, margin = HOME_GAP, tail = BUBBLE_TAIL }) => Math.min(
    Math.max(margin, noseX - (bw - tail)),
    Math.max(margin, width - bw - margin)
  );
  var INTRO_BUBBLE = { font: 22, padY: 14, padX: 24, maxWidth: 560 };
  var REST_BUBBLE = { font: 13, padY: 9, padX: 14 };
  var introBubbleSize = (progress, restMaxWidth) => {
    const p = Math.min(1, Math.max(0, progress));
    const mix = (from, to) => from + (to - from) * p;
    return {
      font: mix(INTRO_BUBBLE.font, REST_BUBBLE.font),
      padY: mix(INTRO_BUBBLE.padY, REST_BUBBLE.padY),
      padX: mix(INTRO_BUBBLE.padX, REST_BUBBLE.padX),
      maxWidth: mix(INTRO_BUBBLE.maxWidth, restMaxWidth)
    };
  };

  // character/chord.ts
  var CHORD_GRACE_MS = 150;
  var chordDown = (chord, button, buttons, now) => {
    if (button !== 0 && button !== 2) return chord;
    const other = button === 0 ? 2 : 1;
    if (buttons & other) return chord;
    return { at: now, button, valid: false };
  };
  var chordWithinGrace = (chord, button, buttons, now, graceMs = CHORD_GRACE_MS) => {
    if (!chord || chord.valid !== true || !Number.isFinite(chord.at)) return false;
    if (button === chord.button) return false;
    const firstBit = chord.button === 0 ? 1 : chord.button === 2 ? 2 : 0;
    const secondBit = button === 0 ? 1 : button === 2 ? 2 : 0;
    if (!firstBit || !secondBit) return false;
    if (!(buttons & firstBit) || !(buttons & secondBit)) return false;
    const firstAt = chord.at;
    return now >= firstAt && now - firstAt <= graceMs;
  };
  var chordUp = (chord, buttons) => (buttons & 3) === 0 ? { at: null, button: null, valid: false } : chord;

  // character/motion.ts
  var clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  var hash = (n) => {
    const scaled = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return scaled - Math.floor(scaled);
  };
  var valueNoise = (t) => {
    const i = Math.floor(t), fraction = t - i, weight = fraction * fraction * (3 - 2 * fraction);
    return (hash(i) * (1 - weight) + hash(i + 1) * weight) * 2 - 1;
  };
  var noise = (t, seed) => valueNoise(t + seed * 17.31) * 0.72 + valueNoise(t * 2.3 + seed * 5.17) * 0.28;
  var S = () => ({ x: 0, v: 0 });
  var spring = (state, target, dt, stiffness, damping) => {
    const n = Math.max(1, Math.ceil(dt / 8e-3)), step = dt / n;
    for (let i = 0; i < n; i++) {
      state.v += ((target - state.x) * stiffness - state.v * damping) * step;
      state.x += state.v * step;
    }
    return state.x;
  };
  var sstep = (x) => {
    x = Math.max(0, Math.min(1, x));
    return x * x * x * (x * (x * 6 - 15) + 10);
  };
  var holdCurve = (progress, riseEnd = 0.35, fallStart = 0.7) => progress < riseEnd ? sstep(progress / riseEnd) : progress > fallStart ? sstep((1 - progress) / (1 - fallStart)) : 1;
  function addGesture(gestureOut, name, progress, direction) {
    const envelope = Math.sin(Math.PI * progress);
    switch (name) {
      case "nod":
        gestureOut.pitch -= Math.abs(Math.sin(progress * Math.PI * 4)) * 11 * envelope;
        gestureOut.bodyY -= Math.abs(Math.sin(progress * Math.PI * 4)) * 3 * envelope;
        break;
      // 끄덕끄덕 (몸도 살짝 따라 숙임)
      case "tilt":
        gestureOut.roll += 15 * envelope * direction;
        gestureOut.bodyZ += 6 * envelope * direction;
        gestureOut.smile += envelope;
        break;
      // 고개 갸웃
      case "lean": {
        const hold = holdCurve(progress, 0.3, 0.72);
        gestureOut.lean -= 12 * hold;
        gestureOut.pitch += 4 * hold;
        gestureOut.roll += 8 * hold * direction;
        gestureOut.bodyX += 4 * hold * direction;
        gestureOut.smile += 0.7 * hold;
        break;
      }
      // 다가와 들여다보기: 몸은 앞으로, 턱은 살짝 들어 화면을 봄
      case "sway":
        gestureOut.bodyZ += Math.sin(progress * Math.PI * 6) * 9 * envelope;
        gestureOut.roll += Math.sin(progress * Math.PI * 6) * 6 * envelope;
        gestureOut.bodyX += Math.sin(progress * Math.PI * 6) * 5 * envelope;
        gestureOut.smile += envelope;
        break;
      // 흔들흔들 (몸도 좌우로 → 가슴·머리카락 좌우 출렁임)
      case "bounce":
        gestureOut.bodyY += Math.abs(Math.sin(progress * Math.PI * 4)) * 8 * envelope;
        gestureOut.bodyZ += Math.sin(progress * Math.PI * 4) * 6 * envelope;
        gestureOut.smile += envelope;
        break;
      // 신나서 통통
      case "droop":
        gestureOut.pitch -= 14 * envelope;
        gestureOut.bodyY -= 6 * envelope;
        break;
      case "flinch": {
        const impact = progress < 0.15 ? progress / 0.15 : 1 - (progress - 0.15) / 0.85;
        gestureOut.pitch -= 7 * impact;
        gestureOut.bodyY -= 3 * impact;
        break;
      }
      // 움찔
      case "bonk": {
        const impact = progress < 0.08 ? progress / 0.08 : Math.pow(1 - (progress - 0.08) / 0.92, 2);
        gestureOut.pitch -= 22 * impact;
        gestureOut.bodyY -= 9 * impact;
        gestureOut.roll += 7 * impact * direction;
        gestureOut.eyeClose += 0.6 * impact;
        break;
      }
      // 냄비에 맞음: 순간 푹 숙였다가 천천히 고개를 듦
      case "laugh":
        gestureOut.eyeSmile += envelope;
        gestureOut.eyeClose += envelope * 0.85;
        gestureOut.smile += envelope;
        {
          const bodyHold = holdCurve(progress, 0.25, 0.65), headHold = holdCurve(Math.max(0, progress - 0.08) / 0.92, 0.3, 0.6);
          gestureOut.lean -= 10 * bodyHold;
          gestureOut.pitch -= 9 * headHold - (progress > 0.7 ? 3 * Math.sin(Math.PI * (progress - 0.7) / 0.3) : 0);
          gestureOut.roll += 7 * bodyHold * direction;
        }
        gestureOut.bodyY += Math.abs(Math.sin(progress * Math.PI * 7)) * 7 * envelope;
        gestureOut.mouth += 0.45 * envelope;
        break;
    }
  }
  var blinkClose = (elapsed) => elapsed < 0.07 ? elapsed / 0.07 : elapsed < 0.1 ? 1 : elapsed < 0.22 ? 1 - (elapsed - 0.1) / 0.12 : 0;
  var seg = (start, end, x) => clamp((x - start) / (end - start), 0, 1);
  var coverForearm = (raise) => raise < 0.25 ? 0.15 * sstep(raise / 0.25) : raise < 0.45 ? 0.15 + 0.55 * seg(0.25, 0.45, raise) : raise < 0.8 ? 0.7 + 0.19 * sstep(seg(0.45, 0.8, raise)) : 0.89 - 0.03 * sstep(seg(0.8, 1, raise));

  // character/harness-signals.ts
  var TOOLS = {
    "명령 실행": "명령 실행 중…",
    "코드": "코드 돌리는 중…",
    "읽기": "파일 읽는 중…",
    "이미지 읽기": "그림 보는 중…",
    "편집": "코드 고치는 중…",
    "쓰기": "파일 쓰는 중…",
    "검색": "찾아보는 중…",
    "파일 내용 검색": "찾아보는 중…",
    "파일 찾기": "파일 찾는 중…",
    "웹 검색": "검색하는 중…",
    "웹페이지 가져오기": "웹페이지 보는 중…",
    "하위 에이전트 만들기": "도우미 부르는 중…",
    "팀원 만들기": "도우미 부르는 중…",
    "워크플로 실행": "워크플로 돌리는 중…",
    // 영어 화면
    "Bash": "명령 실행 중…",
    "Pwsh": "명령 실행 중…",
    "Code": "코드 돌리는 중…",
    "Read": "파일 읽는 중…",
    "Read image": "그림 보는 중…",
    "Edit": "코드 고치는 중…",
    "Write": "파일 쓰는 중…",
    "Search": "찾아보는 중…",
    "Grep": "찾아보는 중…",
    "Glob": "파일 찾는 중…",
    "Fetch": "웹페이지 보는 중…",
    "Create subagent": "도우미 부르는 중…",
    "Create teammate": "도우미 부르는 중…",
    "Run workflow": "워크플로 돌리는 중…"
  };
  var UI = {
    stop: 'button[aria-label="생성 중지"], button[aria-label="Stop generating"]',
    approval: '[aria-label="승인 상세"], [aria-label="Approval details"]',
    turnError: ["이번 턴 실행 실패", "This turn failed"]
  };
  function readStatus(doc) {
    const running = !!doc.querySelector(UI.stop);
    const waiting = doc.querySelector(UI.approval + ', [class*="Zf6DNq_card"]') ? "approval" : doc.querySelector('[data-question-reply], [data-question-key], [class*="Nksazq_card"], [class*="wnLwla_card"]') ? "question" : null;
    return { running, waiting };
  }
  function scanAddedNode(node, { running }) {
    const found = { error: false, tool: null };
    if (node.nodeType !== 1) return found;
    const element = node;
    const t = element.textContent || "";
    if (t.length < 400 && UI.turnError.some((phrase) => t.includes(phrase))) found.error = true;
    if (running && t.length < 200) {
      const leaves = element.children.length === 0 ? [element] : element.querySelectorAll("span, div");
      for (const el of leaves) {
        if (el.children.length) continue;
        const label = (el.textContent || "").trim();
        if (TOOLS[label]) {
          found.tool = TOOLS[label];
          break;
        }
      }
    }
    return found;
  }
  function readThought(doc) {
    const live = [...doc.querySelectorAll('[class*="VJlF5q_summary"][data-streaming]')].map((e) => (e.textContent || "").trim()).filter(Boolean).pop();
    if (live) return live;
    const groupTitle = [...doc.querySelectorAll('button[data-process-activity="thinking"][aria-expanded="false"] [data-shimmer] > span:first-child')].pop();
    if (groupTitle) {
      const t = groupTitle.textContent || "", i = t.indexOf(" · ");
      if (i >= 0 && t.slice(i + 3).trim()) return t.slice(i + 3).trim();
    }
    const body = [...doc.querySelectorAll('[class*="VJlF5q_thinkBody"]')].pop();
    if (!body) return "";
    const paragraphs = (body.innerText || "").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
    return paragraphs.length > 1 ? paragraphs[paragraphs.length - 2].split("\n")[0] : "";
  }
  var VERB = {
    is: "are",
    was: "were",
    has: "have",
    wants: "want",
    needs: "need",
    asks: "ask",
    asked: "asked",
    said: "said",
    says: "say",
    likes: "like",
    prefers: "prefer",
    seems: "seem",
    mentioned: "mentioned",
    requested: "requested"
  };
  var vtuberize = (text) => text.replace(/\b(the|this) user's\b/gi, (match) => match[0] === "T" ? "Your" : "your").replace(/\b(the|this) user (\w+)/gi, (_match, article, word) => {
    const you = article[0] === article[0].toUpperCase() ? "You" : "you";
    return you + " " + (VERB[word.toLowerCase()] || word);
  }).replace(/\b(the|this) user\b/gi, (match) => match[0] === match[0].toUpperCase() ? "You" : "you");
  function thoughtLine(summary, random = Math.random) {
    const t = summary.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim().replace(/^(?:[-•]|\d+[.)])\s+/, "").replace(/^\([^)]{1,30}\):?\s*/, "");
    const hangul = (t.match(/[가-힣]/g) || []).length;
    const latin = (t.match(/[A-Za-z]/g) || []).length;
    const first = (t.match(/^.{4,}?[.!?。…](\s|$)/) || [t])[0].trim();
    if (hangul >= 4 && latin <= hangul * 0.35)
      return first.length > 42 ? first.slice(0, 40).trim() + "…" : first;
    const words = first.split(" ").filter((word) => /[A-Za-z]{2,}/.test(word)).length;
    const symbols = (first.match(/[{}()\[\];=<>\/\\|$@]/g) || []).length;
    if (latin < 12 || words < 3 || hangul > latin * 0.1 || symbols > first.length * 0.04 || first.includes("://")) return null;
    let line = vtuberize(first);
    const hmm = random() < 0.3 ? "Hmm… " : "";
    const max = 64 - hmm.length;
    if (line.length > max) {
      const cut = line.slice(0, max - 2), lastSpace = cut.lastIndexOf(" ");
      line = (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:]+$/, "") + "…";
    }
    if ((line.match(/"/g) || []).length % 2) line = line.slice(0, line.lastIndexOf('"')).replace(/[\s,;:]+$/, "") + "…";
    return hmm + line;
  }

  // character/log.ts
  var PREFIX = "[deepseek-chan-plugin-for-dsh]";
  var DEBUG_KEY = "deepseek-chan-plugin-for-dsh:debug";
  var switchOn = (storage) => {
    try {
      return storage()?.getItem(DEBUG_KEY) === "1";
    } catch {
      return false;
    }
  };
  function createLogger(output = console, storage = () => globalThis.localStorage) {
    const seen = /* @__PURE__ */ new Set();
    const debugOn = switchOn(storage);
    return {
      warnOnce(key, ...args) {
        if (seen.has(key)) return;
        seen.add(key);
        output.warn(PREFIX, ...args);
      },
      // console.debug는 DevTools 기본 수준(Verbose 꺼짐)에서 안 보여 log로 남김
      debug(...args) {
        if (debugOn) output.log(PREFIX, ...args);
      }
    };
  }
  var log = createLogger();

  // character/pet-link.ts
  function createPetLink(deps) {
    const { url, fetch: fetch2, setTimeout, setInterval, requestAnimationFrame, now = () => performance.now(), log: log2 = log } = deps;
    const link = { open: false, opening: 0, supported: false, queue: [], last: "", polling: false, voiceSent: null, follow: null, boot: true, petState: "none", peek: 0, seq: 0 };
    link.relay = (name, args) => {
      if (link.open || link.follow?.shown) link.queue.push([name, args]);
    };
    link.post = (path, body = {}) => {
      deps.onUse();
      return fetch2(url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.ok ? response.json() : postRefused(path, response)).then((reply) => {
        if (reply?.state) link.petState = reply.state;
        return reply;
      }).catch((error) => {
        const reason = String(error?.message ?? error);
        log2.warnOnce(`post:${path}:${reason}`, `펫 요청 오류 (${path}):`, reason);
        return null;
      });
    };
    const postRefused = async (path, response) => {
      const reply = await response.json().catch(() => null);
      const reason = typeof reply?.error === "string" ? reply.error : "";
      log2.warnOnce(`post:${path}:${response.status}:${reason}`, `펫 요청 실패 (${path}): HTTP ${response.status}`, reason);
      return null;
    };
    const report = (event) => {
      const stderr = event.stderr ? ["\n" + String(event.stderr)] : [];
      if (event.type === "error") log2.warnOnce(`error:${event.message}`, "펫 창 오류:", event.message, ...stderr);
      else if (event.type === "closed" && ((event.code ?? 0) !== 0 || event.signal)) {
        const exit = [event.code !== void 0 && `code ${event.code}`, event.signal && `signal ${event.signal}`].filter(Boolean).join(", ");
        log2.warnOnce(`closed:${exit}`, `펫 프로세스 비정상 종료 (${exit}):`, ...stderr);
      } else if (event.type === "log") log2.warnOnce(`log:${event.text}`, `펫 창 ${event.level}:`, event.text);
    };
    link.enter = () => {
      const already = !!link.follow?.shown;
      link.open = true;
      link.opening = 0;
      link.last = "";
      deps.onUse();
      deps.onEnter();
      if (!already) link.queue.push(...deps.snapshot());
      link.queue.push(...deps.dragMessages());
    };
    link.leave = () => {
      if (!link.open) {
        link.opening = 0;
        return;
      }
      link.open = false;
      link.opening = 0;
      link.queue = [];
      deps.onLeave();
      requestAnimationFrame(() => {
        if (!link.open && !link.follow) link.post("hide");
      });
    };
    const onShown = () => {
      if (!link.follow) {
        if (link.opening) link.enter();
        return;
      }
      if (!link.follow.shown) {
        link.follow.shown = true;
        link.queue.push(...deps.snapshot());
      }
    };
    const onHidden = () => {
      if (link.open) link.leave();
      else if (link.follow?.shown) link.follow.shown = false;
    };
    const onConfig = (list) => {
      if (!Array.isArray(list)) return;
      for (const pair of list) if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string") {
        try {
          deps.onConfig(pair[0], pair[1]);
        } catch {
        }
      }
    };
    const handle = (event) => {
      report(event);
      if (event.seq !== void 0 && event.seq !== link.seq) return;
      if (event.type === "shown") onShown();
      else if (event.type === "attach" || event.type === "closed" || event.type === "error") {
        link.follow = null;
        link.leave();
      } else if (event.type === "hidden") onHidden();
      else if (event.type === "config") onConfig(event.list);
      else if (event.type === "chat") {
        link.follow = null;
        link.leave();
        deps.onChat?.();
      }
    };
    link.poll = () => {
      if (link.polling) return;
      link.polling = true;
      fetch2(url + "poll", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((status) => {
        link.polling = false;
        if (!status) return;
        link.supported = !!status.supported;
        link.petState = status.state || "none";
        if (link.boot && Number.isInteger(status.seq)) link.seq = Math.max(link.seq, status.seq);
        for (const event of status.events || []) handle(event);
        if (link.boot && status.state === "shown" && !link.open) {
          if (Number.isInteger(status.seq)) link.seq = status.seq;
          link.enter();
        }
        link.boot = false;
      }).catch((error) => {
        link.polling = false;
        log2.debug("펫 상태 조회 실패:", error);
      });
    };
    link.tick = () => {
      if (link.opening && now() - link.opening > 15e3) link.opening = 0;
      if (!link.open && !link.opening && !link.follow) return;
      if (link.open || link.follow) {
        const { dock, outfit } = deps.dockState();
        const sig = JSON.stringify([dock, outfit]);
        if (sig !== link.last) {
          link.last = sig;
          link.queue.push(["dock", [dock]], ["outfit", [outfit]]);
        }
        const dragNow = deps.dragKey();
        if (dragNow !== link.dragMod) {
          link.dragMod = dragNow;
          link.queue.push(["drag", [dragNow]]);
        }
        if (link.queue.length) {
          const list = link.queue;
          link.queue = [];
          link.post("send", { list });
        }
      }
      link.poll();
    };
    link.start = () => {
      if (!url) return;
      link.poll();
      const warmUp = (tries = 0) => {
        if (link.open || link.follow || link.supported && link.petState !== "none") return;
        if (!link.supported) {
          link.poll();
          if (tries < 8) setTimeout(() => warmUp(tries + 1), 3e3);
          return;
        }
        if (!deps.idle()) {
          setTimeout(() => warmUp(tries), 3e3);
          return;
        }
        (globalThis.requestIdleCallback || ((callback) => setTimeout(callback, 0)))(() => {
          if (link.petState === "none") link.post("warm");
        }, { timeout: 5e3 });
      };
      setTimeout(warmUp, 5e3);
      setInterval(link.tick, 150);
      setInterval(() => {
        const voice = deps.voice();
        if (!link.open || voice === link.voiceSent) return;
        link.voiceSent = voice;
        link.post("send", { list: [["voice", [voice]]] });
      }, 60);
    };
    link.toggle = () => {
      if (deps.hidden()) return;
      if (link.open || link.follow?.shown) {
        link.opening = 0;
        link.post("hide");
        return;
      }
      if (!url) return;
      if (link.petState === "shown") {
        link.enter();
        return;
      }
      const pose = deps.openPose();
      link.opening = now();
      link.post("open", { from: pose, to: pose, seq: ++link.seq });
    };
    return link;
  }

  // character/chat.ts
  var CHAT_STATE_URL = "/deepseek-harness-kr/chat/state";
  var CHAT_URL = "/deepseek-harness-kr/chat";
  var CHAT_TAG = /^\[([^\]]{1,24})\]\s*/;
  var MUTTER_MAX = 60;
  var SUMMARY_MAX = 90;
  var HISTORY_MAX = 20;
  var STATE_REFRESH_MS = 3e4;
  var fit = (line, max) => line.length > max ? line.slice(0, max - 2).trimEnd() + "…" : line;
  function createChat(deps) {
    const { say, flashExp, play, expName, lifetime } = deps;
    const state = { value: null, known: false, loading: false, history: [], busy: false, panel: null, input: null, log: null, open: false };
    const ready = (role) => !deps.petWindow && state.value?.enabled === true && state.value.roles?.[role] === true;
    const available = () => !deps.petWindow && (state.known ? state.value?.enabled === true && state.value.roles?.chat === true : true);
    let warned = false;
    const loadState = () => {
      if (deps.petWindow || state.loading) return;
      state.loading = true;
      fetch(CHAT_STATE_URL, { headers: { accept: "application/json" } }).then((r) => {
        if (r.status === 404 && !warned) {
          warned = true;
          console.warn("[deepseek-harness-kr] 캐릭터 대화 라우트가 없습니다. 플러그인을 업데이트했다면 dsh-web을 재시작하세요.");
        }
        if (!r.ok) return null;
        return r.json();
      }).then((s) => {
        state.value = s && typeof s === "object" ? s : null;
        state.known = true;
      }).catch(() => {
      }).finally(() => {
        state.loading = false;
      });
    };
    loadState();
    lifetime.interval(loadState, STATE_REFRESH_MS);
    const request = async (mode, text, history) => {
      if (!ready(mode)) return null;
      const body = { mode, text };
      if (mode === "chat" && history?.length) body.history = history;
      if (typeof window.__dscSessionId === "string" && window.__dscSessionId) body.sessionId = window.__dscSessionId;
      try {
        const r = await fetch(CHAT_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) {
          if (r.status === 404 || r.status === 503) state.value = null;
          return null;
        }
        const data = await r.json();
        return typeof data?.text === "string" && data.text.trim() ? data.text.trim() : null;
      } catch {
        return null;
      }
    };
    const speakModel = (text, ms, mutter2, kind) => {
      let body = text, tag = null;
      const m = body.match(CHAT_TAG);
      if (m) {
        tag = m[1];
        body = body.slice(m[0].length);
      }
      if (tag) for (const n of tag.split(",")) {
        const e = expName[n.trim()];
        if (e) flashExp(e, Math.max(1200, ms || 3e3));
      }
      if (body.trim()) say(body.trim(), ms, mutter2, kind);
    };
    const mutter = async (raw) => {
      const got = await request("mutter", raw);
      if (!got) return false;
      const line = fit(got, MUTTER_MAX);
      if (!deps.mutterOpen()) return true;
      deps.mutterMark();
      speakModel(line, Math.min(5200, Math.max(3800, 1500 + line.length * 55)), true, "mutter");
      if (Math.random() < 0.35) play("tilt", 1600);
      return true;
    };
    const lastAnswer = () => {
      const rows = [...document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')];
      const row = rows.pop();
      return row ? (row.innerText || "").trim().slice(0, 4e3) : "";
    };
    const summary = async () => {
      const answer = lastAnswer();
      if (!answer) return false;
      const got = await request("summary", answer);
      if (!got) return false;
      speakModel(fit(got, SUMMARY_MAX), 5e3, false, "reaction");
      return true;
    };
    const append = (who, text) => {
      if (!state.log) return;
      state.log.insertAdjacentHTML("beforeend", '<div class="dsc-chat-line ' + who + '"></div>');
      const line = state.log.lastElementChild;
      if (line) line.textContent = text;
      state.log.scrollTop = state.log.scrollHeight;
    };
    const send = async () => {
      if (!state.input || state.busy) return;
      const text = state.input.value.trim();
      if (!text) return;
      state.input.value = "";
      append("me", text);
      state.busy = true;
      const reply = await request("chat", text, state.history);
      state.busy = false;
      if (!reply) {
        append("her", "지금은 대답을 못 했어요. 잠시 뒤에 다시 말 걸어 주세요.");
        return;
      }
      state.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
      if (state.history.length > HISTORY_MAX) state.history = state.history.slice(-HISTORY_MAX);
      append("her", reply);
      speakModel(reply, Math.min(7e3, Math.max(3e3, 1200 + reply.length * 45)), false, "reaction");
    };
    const build = () => {
      const root = document.createElement("div");
      root.id = "dsc-chat";
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", "딥시크쨩에게 말 걸기");
      root.innerHTML = [
        '<div class="dsc-chat-head"><strong>딥시크쨩</strong><button type="button" data-close aria-label="닫기">×</button></div>',
        '<div class="dsc-chat-log" data-log aria-live="polite"></div>',
        '<form class="dsc-chat-form" data-form>',
        '<input type="text" data-input maxlength="500" autocomplete="off" placeholder="말을 걸어 보세요">',
        '<button type="submit" data-send>보내기</button>',
        "</form>"
      ].join("");
      document.body.append(root);
      lifetime.add(() => root.remove());
      state.input = root.querySelector("[data-input]");
      state.log = root.querySelector("[data-log]");
      root.querySelector("[data-form]").addEventListener("submit", (e) => {
        e.preventDefault();
        void send();
      });
      root.querySelector("[data-close]").addEventListener("click", () => close());
      return root;
    };
    function open() {
      if (deps.petWindow) return;
      if (!state.panel) state.panel = build();
      state.panel.classList.add("show");
      state.open = true;
      if (!state.known) loadState();
      if (state.log && !state.log.childElementCount) append("her", "네, 주인님. 뭐든 말씀해 주세요.");
      try {
        state.input?.focus({ preventScroll: true });
      } catch {
      }
    }
    function close() {
      if (!state.panel) return;
      state.panel.classList.remove("show");
      state.open = false;
    }
    lifetime.listen(document, "pointerdown", (e) => {
      if (!state.open || !state.panel || state.panel.contains(e.target)) return;
      close();
    }, true);
    lifetime.listen(document, "keydown", (e) => {
      if (e.key === "Escape" && state.open) close();
    }, true);
    return {
      ready,
      available,
      mutter,
      summary,
      open,
      close,
      /** 펫 창 메뉴 "대화하기…": 창 안으로 돌아온 뒤 잠깐 기다렸다 연다 (돌아오는 그리기와 겹치지 않게) */
      openSoon() {
        lifetime.timeout(() => {
          if (!state.open) open();
        }, 260);
      }
    };
  }

  // character/speech.ts
  var JUNG = "AEAEOEOEOAEEOUOEIUUII";
  var latinVowel = (letter) => {
    const lower = letter.toLowerCase();
    return lower === "a" ? "A" : lower === "e" ? "E" : lower === "o" ? "O" : lower === "u" ? "U" : "I";
  };
  function addWord(word, syl, random) {
    let first = true, prevVowel = false;
    for (const letter of word) {
      const code = letter.charCodeAt(0);
      if (code >= 44032 && code <= 55203) {
        syl.push({ v: JUNG[Math.floor((code - 44032) % 588 / 28)], d: 0.15 + random() * 0.05, amp: 0.65 + random() * 0.35, stress: first });
        first = false;
      } else if (/[aeiouy]/i.test(letter)) {
        if (!prevVowel) {
          syl.push({ v: latinVowel(letter), d: 0.13 + random() * 0.05, amp: 0.55 + random() * 0.35, stress: first });
          first = false;
        }
        prevVowel = true;
        continue;
      } else if (/[.,!?…~。，！？]/.test(letter)) syl.push({ v: null, d: letter === "," || letter === "，" ? 0.12 : 0.24 });
      else if (/[0-9]/.test(letter)) {
        syl.push({ v: "A", d: 0.12, amp: 0.7, stress: first });
        first = false;
      }
      prevVowel = false;
    }
  }
  function parseSyllables(text, ms, random = Math.random) {
    const syl = [];
    for (const part of String(text).split(/(\s+)/)) {
      if (/^\s+$/.test(part)) {
        syl.push({ v: null, d: 0.07 });
        continue;
      }
      addWord(part, syl, random);
    }
    let total = syl.reduce((sum, item) => sum + item.d, 0);
    const limit = (ms || 3e3) / 1e3 * 0.92;
    if (total > limit && total > 0) {
      const k = limit / total;
      for (const item of syl) item.d *= k;
      total = limit;
    }
    return { syl, total };
  }

  // character/hit.ts
  function meshBounds(vertices) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < vertices.length; i += 2) {
      if (vertices[i] < x0) x0 = vertices[i];
      if (vertices[i] > x1) x1 = vertices[i];
      if (vertices[i + 1] < y0) y0 = vertices[i + 1];
      if (vertices[i + 1] > y1) y1 = vertices[i + 1];
    }
    return [x0, y0, x1, y1];
  }
  function meshHit(vertices, indices, uvs, px, py, alphaAt) {
    for (let i = 0; i < indices.length; i += 3) {
      const cornerA = indices[i] * 2, cornerB = indices[i + 1] * 2, cornerC = indices[i + 2] * 2;
      const det = (vertices[cornerB + 1] - vertices[cornerC + 1]) * (vertices[cornerA] - vertices[cornerC]) + (vertices[cornerC] - vertices[cornerB]) * (vertices[cornerA + 1] - vertices[cornerC + 1]);
      if (Math.abs(det) < 1e-9) continue;
      const weightA = ((vertices[cornerB + 1] - vertices[cornerC + 1]) * (px - vertices[cornerC]) + (vertices[cornerC] - vertices[cornerB]) * (py - vertices[cornerC + 1])) / det;
      const weightB = ((vertices[cornerC + 1] - vertices[cornerA + 1]) * (px - vertices[cornerC]) + (vertices[cornerA] - vertices[cornerC]) * (py - vertices[cornerC + 1])) / det;
      const weightC = 1 - weightA - weightB;
      if (weightA < 0 || weightB < 0 || weightC < 0) continue;
      if (alphaAt(weightA * uvs[cornerA] + weightB * uvs[cornerB] + weightC * uvs[cornerC], weightA * uvs[cornerA + 1] + weightB * uvs[cornerB + 1] + weightC * uvs[cornerC + 1]) > 40) return true;
    }
    return false;
  }

  // character/pet-walk.ts
  var walkAreaValid = (area) => !!area && [area.l, area.t, area.r, area.b].every((value) => Number.isFinite(value)) && area.r > area.l && area.b > area.t;
  var sameWalkArea = (first, second) => !!first && !!second && first.l === second.l && first.t === second.t && first.r === second.r && first.b === second.b;
  var walkDisplayArea = (display) => {
    const workArea = display && display.workArea;
    if (!workArea || ![workArea.x, workArea.y, workArea.width, workArea.height].every((value) => Number.isFinite(value))) return null;
    const area = { l: workArea.x, t: workArea.y, r: workArea.x + workArea.width, b: workArea.y + workArea.height };
    return walkAreaValid(area) ? area : null;
  };
  var walkBodySpan = ({ x, k, canvasW, bodyW }) => {
    const width = Math.max(1, Math.min(bodyW, canvasW * k)), side = (canvasW * k - width) / 2;
    return { l: x + side, r: x + side + width, width, side };
  };
  var planWalkOut = ({ area, x, k, canvasW, bodyW, speed = 320 }) => {
    const span = walkBodySpan({ x, k, canvasW, bodyW });
    const left = Math.max(0, span.l - area.l), right = Math.max(0, area.r - span.r);
    const near = left <= right ? -1 : 1;
    const minRun = Math.max(speed * 1.5, span.width * 1.2, 240);
    const dir = left >= minRun || right <= left ? -1 : 1;
    const run = dir < 0 ? left : right;
    const fadeWanted = Math.max(56, Math.min(180, span.width * 0.8));
    const fade = Math.max(1, Math.min(fadeWanted, run * 0.75));
    const overshoot = Math.max(6, Math.min(24, span.width * 0.08));
    return { dir, near, left, right, minRun, run, fade, overshoot, travel: run + overshoot, body: span.width, bodyL: span.l, bodyR: span.r };
  };
  var walkSafePose = ({ area, x, y, k, canvasW, canvasH, bodyW }) => {
    const span = walkBodySpan({ x, k, canvasW, bodyW });
    const minX = area.l - span.side, maxX = area.r - span.side - span.width;
    const minY = area.t - canvasH * k * 0.05, maxY = area.b - canvasH * k;
    return { k, x: Math.min(Math.max(x, minX), Math.max(minX, maxX)), y: Math.min(Math.max(y, minY), Math.max(minY, maxY)) };
  };
  var planWalkReturn = ({ area, dir, x, k, canvasW, bodyW }) => {
    const span = walkBodySpan({ x, k, canvasW, bodyW });
    const entry = Math.max(8, Math.min(64, span.width * 0.3));
    const startX = dir > 0 ? area.l - entry - span.side : area.r + entry - canvasW * k + span.side;
    const from = startX - x;
    const fadeWanted = Math.max(56, Math.min(180, span.width * 0.8));
    return { from, startX, entry, fade: Math.max(1, Math.min(fadeWanted, Math.abs(from) * 0.6)) };
  };
  var walkOutAlpha = (traveled, run, fade) => {
    const progress = Math.max(0, Math.min(1, (run - traveled) / Math.max(1, fade)));
    return progress * progress * (3 - 2 * progress);
  };
  var walkInAlpha = (traveled, fade) => {
    const progress = Math.max(0, Math.min(1, traveled / Math.max(1, fade)));
    return progress * progress * (3 - 2 * progress);
  };
  var walkClipInset = ({ area, screenX: screenX2, screenY: screenY2, width, height, pad = 12 }, out = { left: 0, top: 0, right: 0, bottom: 0, any: false }) => {
    out.left = area.l > screenX2 - pad ? Math.max(0, Math.ceil(area.l - screenX2) + pad) : 0;
    out.top = area.t > screenY2 - pad ? Math.max(0, Math.ceil(area.t - screenY2) + pad) : 0;
    out.right = area.r < screenX2 + width + pad ? Math.max(0, Math.ceil(screenX2 + width - area.r) + pad) : 0;
    out.bottom = area.b < screenY2 + height + pad ? Math.max(0, Math.ceil(screenY2 + height - area.b) + pad) : 0;
    out.any = out.left > 0 || out.top > 0 || out.right > 0 || out.bottom > 0;
    return out;
  };
  var walkEasePetOut = (progress) => {
    const ramp = 0.1;
    return progress < ramp ? progress * progress / (ramp * (2 - ramp)) : (2 * progress - ramp) / (2 - ramp);
  };

  // character/model-profile.ts
  var MODEL_FILES = {
    model: "model/model.model3.json",
    // 모델 정의 (텍스처·물리·모션 참조)
    moc: "model/model.moc3",
    // Core Worker가 같은 모델을 따로 불러올 moc3
    idleMotionGroup: "Idle"
    // model3.json의 대기 모션 그룹 이름
  };
  var PARAMS = {
    // 머리·몸 (VBridger식 리깅: 아래 입력 값을 모델 물리가 늦게 따라가며 몸·머리카락을 움직임)
    headTurn: "AngleX",
    // 고개 좌우 돌림 (물리 입력)
    headTilt: "AngleY",
    // 고개 위아래 끄덕임 (물리 입력)
    headRoll: "AngleZ",
    // 고개 옆으로 갸웃 (물리 입력)
    headTurnDirect: "ParamAngleX",
    // 고개 좌우 돌림 직접 값 (물리 출력 자리, 머리카락 물리 입력)
    headTiltDirect: "ParamAngleY",
    // 고개 위아래 직접 값
    headRollDirect: "ParamAngleZ",
    // 고개 갸웃 직접 값
    bodyShiftX: "PositionX",
    // 몸 좌우 이동
    bodyShiftY: "PositionY",
    // 몸 위아래 이동
    bodyShiftZ: "PositionZ",
    // 몸 앞뒤 이동
    bodyLean: "LeanInput",
    // 몸 앞으로 숙임
    breath: "ParamBreath",
    // 숨쉬기
    // 눈·눈썹 (귀가 눈썹을 따라 움직임)
    eyeLookX: "ParamEyeBallX",
    // 눈동자 좌우
    eyeLookY: "ParamEyeBallY",
    // 눈동자 위아래
    eyeOpenLeft: "ParamEyeLOpen",
    // 왼눈 뜸
    eyeOpenRight: "ParamEyeROpen",
    // 오른눈 뜸
    eyeSmile: "EyeSmile",
    // 눈웃음
    browRaiseLeft: "ParamBrowLY",
    // 왼눈썹 높이
    browRaiseRight: "ParamBrowRY",
    // 오른눈썹 높이
    browInnerRaise: "BrowInnerUp",
    // 곤란한 눈썹 (안쪽 끝 올림)
    frown: "Angry",
    // 찡그린 얼굴 (삐짐)
    frownSecondary: "Angry2",
    // 찡그린 얼굴 둘째 겹 (삐짐)
    // 입
    mouthOpen: "ParamMouthOpenY",
    // 입 벌림
    jawOpen: "JawOpen",
    // 턱 벌림
    mouthClosed: "ParamSilence",
    // 다문 입 (말하지 않는 정도)
    mouthForm: "ParamMouthForm",
    // 입 모양 (웃음 쪽이 +)
    mouthSmileLeft: "MouthSmile_L",
    // 왼쪽 입꼬리 올림
    mouthSmileRight: "MouthSmile_R",
    // 오른쪽 입꼬리 올림
    cheekPuff: "CheeckPuff",
    // 볼 부풀리기 (삐짐)
    mouthPucker: "Mouthpucker",
    // 입 삐죽 (삐짐)
    mouthVowel: { A: "ParamA", I: "ParamI", U: "ParamU", E: "ParamE", O: "ParamO" },
    // 모음 입 모양 (말풍선 음성의 모음 키와 같은 이름)
    // 왼팔 가슴 가리기
    armFrontPose: "Movement2",
    // 몸 앞용 팔 그림으로 바꿈
    upperArmLeft: "Param62",
    // 왼 위팔 들기
    upperArmDepthLeft: "Param59",
    // 왼 위팔 원근 (아래팔보다 먼저)
    forearmLeft: "Param60",
    // 왼 아래팔 들기
    wristLeft: "Param61",
    // 왼 손목 꺾임
    // 가슴 물리 (끌어올리기·끌어당기기, 물리 계산 뒤에 더함)
    chestSwayVertical: ["ChestY1", "ChestY2", "ChestY3", "ChestY4"],
    // 가슴 위아래 흔들림
    chestSwayHorizontal: ["ChestX1", "ChestX2", "ChestX3"],
    // 가슴 좌우 흔들림
    // 소품·체형 (나머지 소품 파라미터는 shared/settings.js의 OUTFIT_ITEMS)
    basinProp: "key10",
    // 세숫대야 소품 (머리를 천천히 쓸어내리면)
    bodyType: "Clothes2"
    // 체형 (0 기본, 0.4 체형 1, 1 꼬마. 값은 shared/settings.js의 BODY_TYPES)
  };
  var CHEST_DRAG_SIGN = 1;
  var VOWEL_EYE_SAFE = { I: 0.45, E: 0.45 };
  var PARTS = {
    animalEars: "Part159",
    // 동물귀 (파라미터가 아니라 파트 불투명도로 감춤)
    chestCenter: ["Part88", "Part86"]
    // 가슴 메시 (보이는 가슴의 가운데를 터치 판정 기준으로 씀)
  };
  var PART_REGIONS = {
    Part99: "head",
    Part47: "head",
    Part155: "head",
    Part156: "head",
    Part161: "head",
    Part64: "head",
    Part66: "head",
    Part10: "head",
    Part8: "head",
    Part127: "arm",
    Part94: "arm",
    Part68: "arm",
    Part93: "arm",
    Part117: "arm",
    Part54: "arm",
    Part42: "arm",
    Part114: "leg",
    Part97: "lower",
    Part107: "lower",
    Part125: "lower",
    Part126: "lower",
    Part89: "waist",
    Part85: "chestpart",
    Part88: "chestpart",
    Part136: "tail"
  };
  var EXPRESSION_FILES = {
    loading: "model/exp/loading.exp3.json",
    // 작업 중 표시
    heart: "model/exp/heart.exp3.json",
    // 하트 눈
    blush: "model/exp/blush.exp3.json",
    // 홍조
    sweat: "model/exp/sweat.exp3.json",
    // 식은땀
    dizzy: "model/exp/dizzy.exp3.json",
    // 빙글빙글 눈
    tears: "model/exp/tears.exp3.json",
    // 눈물
    squint: "model/exp/squint.exp3.json",
    // >< 눈
    smug: "model/exp/smug.exp3.json",
    // 얄미운 눈
    dark: "model/exp/dark.exp3.json"
    // 어두운 얼굴 (정색)
  };
  var EYE_SWAP_EXPRESSIONS = ["heart", "squint", "smug", "dizzy"];
  var GEOMETRY = {
    bustCut: 0.47,
    // 상반신 잘림선(허리): 전신 높이 중 위에서부터의 비율 (창 안은 이 위만 보임)
    noseOffset: 0.055,
    // 코(얼굴) 가운데: 상반신 가로 중심에서 오른쪽으로 상반신 폭 대비 거리 (말풍선 꼬리 기준)
    headBottom: 0.3,
    // 터치: 머리로 치는 아래 끝 (전신 높이 비율)
    chestBottom: 0.4,
    // 터치: 가슴과 아랫배·허리 아래의 경계 (전신 높이 비율)
    coverArmBottom: 0.45,
    // 터치: 가슴을 가린 팔을 가슴으로 치는 아래 끝 (전신 높이 비율)
    chestCenterX: 0.45,
    // 터치: 가슴 타원 가운데 x (전신 폭 비율)
    chestCenterY: 0.295,
    // 터치: 가슴 타원 가운데 y (전신 높이 비율)
    chestRadiusX: 0.13,
    // 터치: 가슴 타원 가로 반지름 (전신 폭 비율)
    chestRadiusY: 0.045,
    // 터치: 가슴 타원 세로 반지름 (전신 높이 비율)
    chibiHeadBottom: 0.45
    // 꼬마 모습 터치: 보이는 그림 위에서부터 머리로 치는 비율
  };

  // character/index.ts
  function createCharacter({ base, life, pet = null, prefs: initialPrefs = {}, onSetting = null }) {
    const BASE = base;
    const prefs = { ...initialPrefs };
    const hooks = {};
    let petUsed = false;
    const previousDsc = window.__dsc;
    life.add(() => {
      if (window.__dsc !== previousDsc) {
        if (previousDsc === void 0) delete window.__dsc;
        else window.__dsc = previousDsc;
      }
      document.documentElement.classList.remove("dsc-hover", "dsc-grabbing");
      if (petUsed) {
        try {
          fetch(new URL("../pet/hide", new URL(BASE, location.href)).href, { method: "POST", keepalive: true }).catch(() => {
          });
        } catch {
        }
      }
    });
    const setTimeout = life.timeout, setInterval = life.interval, requestAnimationFrame = life.frame;
    const addEventListener = (type, fn, options) => life.listen(window, type, fn, options);
    const MutationObserver = function(fn) {
      return life.observe(fn);
    };
    const TEXT = {
      hello: "안녕하세요, 주인님! 오늘은… 저랑 뭐 해 볼까요?",
      start: "알겠어요! …잘 부탁드려요, 주인님",
      approval: "확인이 필요해요! …이거, 저 대신 눌러 주실 거죠?",
      question: "여쭤볼 게 있어요! …잠깐만 저만 봐 주세요",
      done: "다 했어요! …칭찬해 주실 거죠?",
      error: "앗, 문제가 생겼어요… …한 번만 더 봐 주세요"
    };
    const ready = (fn) => document.body ? fn() : addEventListener("DOMContentLoaded", fn, { once: true });
    ready(() => {
      let running = false, lastError = -1e9, lastToolSay = 0, waitingKind = null;
      const listeners = { tool: null };
      const scanAdded = (node) => {
        const found = scanAddedNode(node, { running: running && !!listeners.tool });
        if (found.error) lastError = performance.now();
        if (found.tool) listeners.tool(found.tool);
      };
      if (!pet) new MutationObserver((records) => {
        for (const record of records) for (const n of record.addedNodes) scanAdded(n);
      }).observe(document.body, { childList: true, subtree: true });
      const load = (src) => new Promise((ok, fail) => {
        const script = life.own(document.createElement("script"), (node) => node.remove());
        script.src = BASE + src;
        script.onload = ok;
        script.onerror = () => fail(new Error(src));
        document.head.appendChild(script);
      });
      (async () => {
        if (!window.Live2DCubismCore) await load("vendor/live2dcubismcore.min.js");
        if (!window.PIXI) await load("vendor/pixi.min.js");
        if (!window.PIXI.live2d) await load("vendor/cubism4.patched.js");
        if (life.stopped) return;
        const W = 300, H = 300;
        const canvas = life.own(document.createElement("canvas"), (node) => node.remove());
        canvas.id = "dsc-stage";
        const bubble = life.own(document.createElement("div"), (node) => node.remove());
        bubble.id = "dsc-bubble";
        const bubbleStatus = life.own(document.createElement("div"), (node) => node.remove());
        bubbleStatus.id = "dsc-bubble-status";
        document.body.append(canvas, bubble, bubbleStatus);
        const setBubbleDisplay = (value) => {
          bubble.style.display = bubbleStatus.style.display = value;
        };
        const app = new PIXI.Application({ view: canvas, width: W, height: H, sharedTicker: false, autoStart: false, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: (devicePixelRatio || 1) * 1.5 });
        const systemTicker = (on) => {
          try {
            app.renderer.plugins.interaction.useSystemTicker = on;
          } catch {
          }
        };
        life.add(() => app.destroy(true, { children: true }));
        const model = await PIXI.live2d.Live2DModel.from(BASE + MODEL_FILES.model, { autoUpdate: false, autoInteract: false, idleMotionGroup: MODEL_FILES.idleMotionGroup });
        if (life.stopped) {
          model.destroy();
          return;
        }
        app.stage.addChild(model);
        app.ticker.add(() => model.update(Math.min(app.ticker.deltaMS, 100)), void 0, PIXI.UPDATE_PRIORITY.HIGH);
        const internalModel = model.internalModel, core = internalModel.coreModel;
        internalModel.eyeBlink = void 0;
        internalModel.breath = void 0;
        const setParam = (id, value, weight2 = 1) => core.setParameterValueById(id, value, weight2);
        const addParam = (id, value, weight2 = 1) => core.addParameterValueById(id, value, weight2);
        const multiplyParam = (id, value, weight2 = 1) => core.multiplyParameterValueById(id, value, weight2);
        const paramRange = (id) => {
          const i = core.getParameterIndex(id);
          if (i < 0) return null;
          const min = core.getParameterMinimumValue(i), max = core.getParameterMaximumValue(i);
          return Number.isFinite(min) && Number.isFinite(max) ? { id, min, max } : null;
        };
        const dragLift = { x: 0, v: 0 };
        const dragShift = { x: 0, v: 0 };
        let chestFrom = null, chestDragging = false, chestTarget = 0, chestShiftTarget = 0;
        let chestLongTimer = 0;
        const chestShake = { x: 0, y: 0, acc: 0, last: 0, next: 0 };
        if (internalModel.physics) {
          const evaluate = internalModel.physics.evaluate;
          const chestParams = PARAMS.chestSwayVertical.map(paramRange).filter((found) => !!found);
          const chestXParams = PARAMS.chestSwayHorizontal.map(paramRange).filter((found) => !!found);
          internalModel.physics.evaluate = function(...args) {
            const result = evaluate.apply(this, args);
            const lift = dragLift.x * CHEST_DRAG_SIGN, shift = dragShift.x * CHEST_DRAG_SIGN;
            if (lift) for (const chestParam of chestParams) addParam(chestParam.id, lift * (lift > 0 ? chestParam.max : -chestParam.min));
            if (shift) for (const chestParam of chestXParams) addParam(chestParam.id, shift * (shift > 0 ? chestParam.max : -chestParam.min) * 0.9);
            return result;
          };
        }
        const WHOLE_BODY = !!pet;
        core.update();
        const cubismModel = core.getModel();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const each = (fn) => {
          for (let i = 0; i < cubismModel.drawables.count; i++) {
            if (cubismModel.drawables.opacities[i] < 0.01) continue;
            const vertices = internalModel.getDrawableVertices(i);
            for (let j = 0; j < vertices.length; j += 2) fn(vertices[j], vertices[j + 1]);
          }
        };
        each((x, y) => {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        });
        const cutY = minY + (maxY - minY) * GEOMETRY.bustCut;
        let bustMinX = Infinity, bustMaxX = -Infinity;
        each((x, y) => {
          if (y < cutY) {
            bustMinX = Math.min(bustMinX, x);
            bustMaxX = Math.max(bustMaxX, x);
          }
        });
        const bustScale = Math.min(W * 0.98 / (bustMaxX - bustMinX), H * 0.95 / (cutY - minY));
        const fullScale = Math.min(W * 0.98 / (maxX - minX), H * 0.95 / (maxY - minY));
        const PET_HEAD_RATIO = bustScale / fullScale;
        const PET_K_MIN = 0.45, PET_BUBBLE = 150;
        const PET_K_MAX = Math.max(1.2, ((typeof screen !== "undefined" && screen.availHeight ? screen.availHeight : 1080) - PET_BUBBLE) / H);
        const BUST_CX = (bustMinX + bustMaxX) / 2, FULL_CX = (minX + maxX) / 2;
        const WAIST_PET = H * 0.05 + (cutY - minY) * fullScale;
        const WAIST_WIN = H * 0.05 + (cutY - minY) * bustScale;
        const WAIST_PCT = WAIST_PET / H * 100;
        const bodyWidth = WHOLE_BODY ? maxX - minX : bustMaxX - bustMinX;
        const modelScale = WHOLE_BODY ? fullScale : bustScale;
        const HEAD_GAIN = bustScale / modelScale;
        model.scale.set(modelScale);
        model.x = W / 2 - ((WHOLE_BODY ? minX : bustMinX) + bodyWidth / 2) * modelScale;
        model.y = H * 0.05 - minY * modelScale;
        setParam(PARAMS.bodyType, 1);
        core.update();
        let chibiMinY = Infinity, chibiMaxY = -Infinity, chibiMinX = Infinity, chibiMaxX = -Infinity;
        each((x, y) => {
          chibiMinY = Math.min(chibiMinY, y);
          chibiMaxY = Math.max(chibiMaxY, y);
          chibiMinX = Math.min(chibiMinX, x);
          chibiMaxX = Math.max(chibiMaxX, x);
        });
        setParam(PARAMS.bodyType, 0);
        core.update();
        const baseY = model.y;
        const CHIBI_WIDTH = Number.isFinite(chibiMinX) && chibiMaxX > chibiMinX ? (chibiMaxX - chibiMinX) * modelScale : bodyWidth * modelScale;
        const WALK_BODY_WIDTH = Math.max(1, Math.min(bodyWidth * modelScale, CHIBI_WIDTH));
        const chibiDrop = Math.max(0, H * 0.99 - chibiMaxY * modelScale - baseY);
        const chibiHeadDrop = (chibiMinY - minY) * modelScale + chibiDrop;
        const noseModelX = BUST_CX + (bustMaxX - bustMinX) * GEOMETRY.noseOffset;
        (() => {
          const drawables2 = cubismModel.drawables, drawableCount = drawables2.count;
          const localUpdate = () => Object.getPrototypeOf(cubismModel).update.call(cubismModel);
          let w;
          try {
            w = new Worker(BASE + "dsc-core-worker.js");
          } catch {
            return;
          }
          life.add(() => {
            try {
              w.terminate();
            } catch {
            }
          });
          let lo = Infinity, hi = 0;
          for (let i = 0; i < drawableCount; i++) {
            const positions = drawables2.vertexPositions[i];
            lo = Math.min(lo, positions.byteOffset);
            hi = Math.max(hi, positions.byteOffset + positions.byteLength);
          }
          const offsets = Array.from(drawables2.vertexPositions, (positions) => positions.byteOffset - lo).join();
          const vertexBytes = new Uint8Array(drawables2.vertexPositions[0].buffer, lo, hi - lo);
          let ready2 = false, busy = false, result = null, spare = null;
          const stop = () => {
            ready2 = false;
            delete cubismModel.update;
            try {
              w.terminate();
            } catch {
            }
          };
          const apply = (buf) => {
            const bytes = new Uint8Array(buf);
            let offset = 0;
            vertexBytes.set(bytes.subarray(0, vertexBytes.length));
            offset += vertexBytes.length;
            drawables2.opacities.set(new Float32Array(buf, offset, drawableCount));
            offset += drawableCount * 4;
            drawables2.drawOrders.set(new Int32Array(buf, offset, drawableCount));
            offset += drawableCount * 4;
            drawables2.renderOrders.set(new Int32Array(buf, offset, drawableCount));
            offset += drawableCount * 4;
            drawables2.multiplyColors.set(new Float32Array(buf, offset, drawableCount * 4));
            offset += drawableCount * 16;
            drawables2.screenColors.set(new Float32Array(buf, offset, drawableCount * 4));
            offset += drawableCount * 16;
            drawables2.dynamicFlags.set(bytes.subarray(offset, offset + drawableCount));
          };
          w.onerror = (event) => {
            log.debug("Core Worker 오류, 메인 계산으로 전환:", event.message);
            stop();
          };
          w.onmessage = (e) => {
            const message = e.data;
            if (message.type === "ready") {
              if (message.count === drawableCount && message.params === cubismModel.parameters.count && message.parts === cubismModel.parts.count && message.offs.join() === offsets) ready2 = true;
              else {
                log.debug("Core Worker 모델 불일치, 메인 계산으로 전환");
                stop();
              }
            } else if (message.type === "frame") {
              result = message.buf;
              busy = false;
            } else if (message.type === "fail") {
              log.debug("Core Worker 실패, 메인 계산으로 전환:", message.message ?? "(사유 없음)");
              stop();
            }
          };
          cubismModel.update = () => {
            if (!ready2) return localUpdate();
            if (result) {
              apply(result);
              spare = result;
              result = null;
            }
            if (!busy) {
              const paramCount = cubismModel.parameters.count, inputs = new Float32Array(paramCount + cubismModel.parts.count);
              inputs.set(cubismModel.parameters.values);
              inputs.set(cubismModel.parts.opacities, paramCount);
              const transfer = [inputs.buffer];
              if (spare) transfer.push(spare);
              w.postMessage({ type: "frame", inp: inputs.buffer, out: spare }, transfer);
              spare = null;
              busy = true;
            }
          };
          w.postMessage({ type: "init", url: BASE + MODEL_FILES.moc });
        })();
        const expressionParams = {};
        await Promise.all(Object.entries(EXPRESSION_FILES).map(async ([expName, file]) => {
          try {
            expressionParams[expName] = (await (await fetch(BASE + file)).json()).Parameters || [];
          } catch (error) {
            log.debug("표정 파일 로드 실패:", expName, error);
            expressionParams[expName] = [];
          }
        }));
        if (life.stopped) return;
        const weight = {}, hold = {}, until = {};
        const OUTFIT_PARAMS = OUTFIT_ITEMS.filter((item) => item.param).map((item) => [item.key, item.param, item.on]);
        const OUTFIT_LINE = Object.fromEntries(OUTFIT_ITEMS.filter((item) => item.line).map((item) => [item.key, item.line]));
        const BODY_VALUE = Object.fromEntries(BODY_TYPES.map((body) => [body.key, body.value]));
        const outfitWeight = {};
        for (const [key] of OUTFIT_PARAMS) outfitWeight[key] = (prefs.outfit || {})[key] ? 1 : 0;
        const EAR_PART_ID = PARTS.animalEars;
        const earPartIndexFor = (ids, id) => {
          if (!ids) return -1;
          const found = Array.from(ids).indexOf(id);
          return found >= 0 ? found : -1;
        };
        const earPartIndex = earPartIndexFor(cubismModel.parts && cubismModel.parts.ids, EAR_PART_ID);
        const earDrawables = [];
        if (earPartIndex >= 0) {
          for (let i = 0; i < cubismModel.drawables.count; i++) if (cubismModel.drawables.parentPartIndices[i] === earPartIndex) earDrawables.push(i);
        }
        const earSet = new Set(earDrawables);
        const earVisible = (opacity, flags) => opacity >= 0.05 && (flags & 1) !== 0;
        const earBaseVisible = new Map(earDrawables.map((i) => [i, earVisible(cubismModel.drawables.opacities[i], cubismModel.drawables.dynamicFlags[i])]));
        const earOpacityValue = (w) => Math.max(0, Math.min(1, 1 - w));
        const earOpacityStep = (w, on, dt) => Math.min(1, Math.max(0, w + ((on ? 1 : 0) - w) * Math.min(1, dt * 6)));
        const applyEarOpacity = (parts2, index, w) => {
          if (!parts2 || !parts2.opacities || index < 0) return false;
          parts2.opacities[index] = earOpacityValue(w);
          return true;
        };
        let earWeight = (prefs.outfit || {}).earHide ? 1 : 0;
        const earHitVisible = (i) => earWeight > 5e-3 ? earBaseVisible.get(i) === true : earVisible(cubismModel.drawables.opacities[i], cubismModel.drawables.dynamicFlags[i]);
        let basinUntil = 0, basinWeight = 0;
        let bodyWeight = BODY_VALUE[(prefs.outfit || {}).bodyType] || 0, outfitPrev = null, outfitTalk = null;
        const PET = pet;
        const PET_URL = PET ? null : (() => {
          try {
            return new URL("../pet/", new URL(BASE, location.href)).href;
          } catch {
            return null;
          }
        })();
        const link = createPetLink({
          url: PET_URL,
          /** 전역 fetch 호출 (window에 묶인 채로 부르도록 감쌈) */
          fetch: (...args) => fetch(...args),
          setTimeout,
          setInterval,
          requestAnimationFrame,
          /** 펫 창 사용 기록 (플러그인이 내려갈 때 펫 창을 숨길지 판단) */
          onUse: () => {
            petUsed = true;
          },
          /** 펫 창 메뉴에서 바꾼 설정을 플러그인 설정에 저장하도록 전달 */
          onConfig: (key, value) => onSetting?.(key, value),
          /** 펫 창 메뉴 "대화하기…": 창 안으로 돌아온 뒤 대화 입력을 연다 */
          onChat: () => chat.openSoon(),
          /** 펫 창이 열려 창 안 캐릭터가 물러날 때 */
          onEnter: () => petLinkEnter(),
          /** 펫 창이 닫혀 창 안 캐릭터가 돌아올 때 */
          onLeave: () => petLinkLeave(),
          /** 펫 창에 넘길 지금 상태 */
          snapshot: () => petLinkSnapshot(),
          /** 끌어서 넘기는 동안 펫 창에 보낼 메시지 */
          dragMessages: () => petLinkDragMessages(),
          /** 펫 창이 붙을 자리 */
          dockState: () => petLinkDock(),
          /** 지금 끌기 상태의 비교용 키 */
          dragKey: () => dragKeyRaw(),
          /** 외부 음성 상태 */
          voice: () => voiceState,
          /** 시작 연출이 끝났고 작업 중이 아니며 화면이 보이는 상태 여부 */
          idle: () => intro.phase === "done" && !running && !document.hidden,
          /** 캔버스만 숨김 상태 여부 */
          hidden: () => hidden,
          /** 펫 창을 열 때 쓸 화면 좌표 자리 */
          openPose: () => petOpenScreenPose()
        });
        const relay = link.relay;
        const EYE_EXP = EYE_SWAP_EXPRESSIONS;
        const clearOtherEyes = (name) => {
          if (EYE_EXP.includes(name)) {
            for (const e of EYE_EXP) if (e !== name) {
              until[e] = 0;
              hold[e] = false;
            }
          }
        };
        const setExp = (name, on) => {
          relay("setExp", [name, on]);
          if (on) clearOtherEyes(name);
          hold[name] = on;
        };
        const flashExp = (name, ms) => {
          relay("flashExp", [name, ms]);
          clearOtherEyes(name);
          until[name] = performance.now() + ms;
        };
        const gestureState = { name: null, start: 0, dur: 0, dir: 1 };
        const cover = { until: 0, start: -1e9, q: 0 };
        const coverChest = (ms) => {
          const now = performance.now();
          if (now >= cover.until) cover.start = now;
          cover.until = Math.max(cover.until, now + ms);
        };
        const play = (name, dur) => {
          relay("play", [name, dur]);
          gestureState.name = name;
          gestureState.start = performance.now();
          gestureState.dur = dur;
          gestureState.dir = Math.random() < 0.5 ? -1 : 1;
          if (BOB_KICK[name]) bobKick(BOB_KICK[name]);
        };
        const BOB_KICK = { bounce: 60, laugh: 50, nod: -45 };
        let mood = "idle", moodUntil = 0, nextIdleGesture = performance.now() + 6e3;
        const setMood = (moodName, ms = 0) => {
          relay("setMood", [moodName, ms]);
          mood = moodName;
          moodUntil = ms ? performance.now() + ms : 0;
        };
        const pose = { lean: 0, headZ: 0, headY: 0, bodyY: 0, swayAmp: 0 };
        let shiverStarted = -1e9, touchLeanUntil = 0, touchLean = 0;
        let shiverBobAt = 0, shiverBobSign = 1;
        let happyMouthUntil = 0, happyMouth = 0;
        let stareUntil = 0, stareWeight = 0;
        let sulkStart = -1e9, sulkUntil = 0, sulkDir = 1, sulkPeeks = [], sulkYaw = 0, sulkRoll = 0;
        const SULK_CHIN = 10;
        const PEEK_RISE = 550, PEEK_HOLD = 450, PEEK_SNAP = 150;
        const visW = bodyWidth * modelScale, visH = H * 0.95;
        let coarseMql = null;
        const coarsePointer = () => {
          if (typeof matchMedia !== "function") return false;
          if (!coarseMql) coarseMql = matchMedia("(hover: none) and (pointer: coarse)");
          return coarseMql.matches;
        };
        const mobileHidden = () => !!prefs.mobile && prefs.mobile.enabled === false && coarsePointer();
        const keyboardOpen = () => {
          const visualVp = typeof visualViewport !== "undefined" && visualViewport ? visualViewport : null;
          if (!visualVp || visualVp.scale !== 1) return false;
          return innerHeight - visualVp.height > 120 || visualVp.offsetTop > 4;
        };
        const typingActive = () => coarsePointer() && keyboardOpen();
        const viewport = () => {
          const visualVp = typeof visualViewport !== "undefined" && visualViewport ? visualViewport : null;
          return visualVp ? { w: visualVp.width, h: visualVp.height, top: visualVp.offsetTop, left: visualVp.offsetLeft } : { w: innerWidth, h: innerHeight, top: 0, left: 0 };
        };
        const layoutViewport = () => coarsePointer() ? viewport() : { w: innerWidth, h: innerHeight, top: 0, left: 0 };
        let curK = 1, fleeX = 0;
        const free = { on: false, x: 0, y: 0, k: 1, anim: null, mode: null, applied: true };
        const drag = { pending: null, on: false, x: 0, y: 0, samples: [] };
        let chord = { at: null, button: null, valid: false };
        let rightPress = null;
        let mouseButtons = 0;
        const carry = { vx: 0, vy: 0 };
        const shown = { k: 1, x: 0, y: 0 };
        const petDisplay = { id: "", area: null, scaleFactor: 0, request: 0, answered: 0, at: 0, displays: null };
        let petBounds = null;
        const requestPetDisplay = (at) => {
          if (!PET) return;
          const id = ++petDisplay.request;
          const point = displayPoint(at);
          try {
            PET.send({ type: "display", request: id, point });
          } catch (error) {
            log.debug("펫 표시장치 요청 실패:", error);
          }
          return id;
        };
        const displayPoint = (at) => {
          if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) return at;
          if (!Number.isFinite(shown.x) || !Number.isFinite(shown.y)) return void 0;
          const k = Number.isFinite(curK) && curK > 0 ? curK : 1;
          return { x: shown.x + W * k / 2, y: shown.y + H * k * 0.5 };
        };
        let touchHold = 0;
        let petDock = null, petDocked = false, snapProgress = 0;
        const PET_SIZE_KEY = "dsc-pet-size";
        let petPanel = null, petPanelOpen = false, petPanelWin = { w: 0, h: 0 };
        let petBaseK = 1, petPendingRatio = null, petSizeTimer = 0, petMenuSig = "";
        const FREE_KEY = "dsc-free-pos";
        const FREE_KEY_MOBILE = "dsc-free-pos-mobile";
        const freeMode = () => coarsePointer() ? "mobile" : "desktop";
        const freeStorageKey = (mode) => mode === "mobile" ? FREE_KEY_MOBILE : FREE_KEY;
        const freeToRatio = () => {
          free.fx = (free.x + W * free.k / 2) / innerWidth;
          free.fy = (free.y + H * free.k) / innerHeight;
        };
        if (!PET) try {
          const mode = freeMode();
          const saved = JSON.parse(localStorage.getItem(freeStorageKey(mode)) || "null");
          if (saved && isFinite(saved.fx) && isFinite(saved.fy) && saved.k > 0 && (!saved.mode || saved.mode === mode)) {
            Object.assign(free, { on: true, fx: saved.fx, fy: saved.fy, k: saved.k, mode, applied: true });
          }
        } catch {
        }
        const saveFree = (fromPose = true) => {
          if (PET || free.applied === false) return;
          if (free.on && fromPose) freeToRatio();
          try {
            const mode = free.mode || freeMode();
            const key = freeStorageKey(mode);
            if (free.on) localStorage.setItem(key, JSON.stringify({ mode, fx: +free.fx.toFixed(4), fy: +free.fy.toFixed(4), k: +free.k.toFixed(3) }));
            else localStorage.removeItem(key);
          } catch {
          }
        };
        const walk = {
          phase: "",
          face: 0,
          dir: -1,
          out: 0,
          timers: [],
          slideId: 0,
          lastTouch: 0,
          next: performance.now() + (180 + Math.random() * 180) * 1e3,
          plan: null,
          area: null,
          base: null,
          displayId: "",
          displayRequest: 0,
          alpha: 1,
          opacityApplied: false,
          returnFade: 0,
          recoverTimer: 0,
          safeHold: false,
          faceDir: null,
          recover: null
        };
        let walkCheck = null;
        const DPR = (devicePixelRatio || 1) * 1.5;
        const intro = { phase: "center", start: performance.now(), moveStart: 0, from: null, kc: 1 };
        const veil = life.own(document.createElement("div"), (node) => node.remove());
        veil.style.cssText = "position:fixed;inset:0;z-index:29;background:radial-gradient(circle at 50% 55%,var(--dsc-veil1,#ffffffd9),var(--dsc-veil2,#eef0ffcc) 70%);backdrop-filter:blur(8px);opacity:0;transition:none;cursor:pointer";
        document.body.append(veil);
        veil.addEventListener("pointerdown", () => {
          if (intro.phase === "center") intro.skip = true;
        });
        const setRes = (k) => {
          const res = DPR * Math.max(1, k);
          if (app.renderer.resolution === res) return;
          app.renderer.resolution = res;
          app.renderer.resize(W, H);
        };
        const ease = (progress) => progress < 0 ? 0 : progress > 1 ? 1 : progress * progress * (3 - 2 * progress);
        const findCard = () => document.querySelector(".dsc-composer") || [...document.querySelectorAll('[class*="_card"]')].find((e) => e.closest('[class*="_root"]') && e.querySelector('[class*="_input"]'));
        const cardRect = (card) => {
          const rect = card.getBoundingClientRect();
          if (rect.width) return rect;
          const seat = card.closest('[class*="composerSeat"]');
          for (const alt of seat ? seat.querySelectorAll('[class*="_card"]') : []) {
            if (alt === card) continue;
            const altRect = alt.getBoundingClientRect();
            if (altRect.width) return altRect;
          }
          return null;
        };
        const homePose = () => {
          const card = findCard();
          const viewArea = layoutViewport();
          const maxK = Math.min(PET_K_MAX / PET_HEAD_RATIO, viewArea.h * 0.92 / visH);
          const cardBox = card ? cardRect(card) : null;
          const pose2 = homeLayout({ vp: viewArea, r: cardBox, maxK, W, visW, H, visH, minK: SHOW_K, allowAbove: coarsePointer() });
          return { k: pose2.k, x: pose2.x + fleeX, y: pose2.y, card, r: cardBox, above: pose2.above, noSafe: !!pose2.noSafe, vp: viewArea };
        };
        const centerPose = () => {
          const viewArea = layoutViewport();
          const k = Math.min(viewArea.h * 0.74 / visH, viewArea.w * 0.55 / visW, 3.2);
          return { k, x: viewArea.left + viewArea.w / 2 - W * k / 2, y: viewArea.top + viewArea.h - H * k };
        };
        const introOff = !!prefs.intro && prefs.intro.enabled === false;
        if (!introOff) {
          intro.kc = centerPose().k;
          setRes(intro.kc);
        }
        const skipIntro = () => {
          if (intro.phase === "done") return;
          intro.phase = "done";
          setRes(1);
          veil.remove();
          canvas.style.opacity = "";
          bubble.style.left = "";
          bubble.style.fontSize = "";
          bubble.style.padding = "";
        };
        if (PET || introOff) skipIntro();
        const bodyRect = (x, y, k) => {
          const side = (W - visW) / 2 * k;
          return { l: x + side, t: y + H * 0.05 * k, r: x + W * k - side, b: y + H * k };
        };
        const easeOut = (progress) => 1 - Math.pow(1 - progress, 3);
        const easeBack = (progress) => {
          const overshoot = 1.25, fromEnd = progress - 1;
          return 1 + (overshoot + 1) * fromEnd * fromEnd * fromEnd + overshoot * fromEnd * fromEnd;
        };
        const area = () => PET ? { l: screen.availLeft, t: screen.availTop, r: screen.availLeft + screen.availWidth, b: screen.availTop + screen.availHeight } : { l: 0, t: 0, r: innerWidth, b: innerHeight };
        const keepIn = (candidate, limit) => {
          const bounds = limit || area(), side = (W - visW) / 2 * candidate.k;
          return { k: candidate.k, x: Math.min(Math.max(candidate.x, bounds.l - side), bounds.r - W * candidate.k + side), y: Math.min(Math.max(candidate.y, bounds.t - H * candidate.k * 0.05), bounds.b - H * candidate.k * 0.3) };
        };
        const screenOf = (x, y) => {
          const border = (outerWidth - innerWidth) / 2;
          return { x: screenX + border + x, y: screenY + Math.max(0, outerHeight - innerHeight - border) + y };
        };
        const dockTarget = (home) => home.k >= SHOW_K || home.above || home.noSafe ? home : { k: SHOW_K, x: innerWidth - 4 - (W + visW) / 2 * SHOW_K + fleeX, y: innerHeight - H * SHOW_K };
        const bodyOut = (candidate, entering = true) => {
          const side = (W - visW) / 2 * candidate.k, edge = visW * candidate.k * (entering ? 0.15 : -0.02), low2 = entering ? 0.5 : 0.8;
          return candidate.x + side < -edge || candidate.x + W * candidate.k - side > innerWidth + edge || candidate.y < -edge || candidate.y + H * candidate.k * low2 > innerHeight;
        };
        const inWindow = (candidate, w) => {
          const side = (W - visW) / 2 * candidate.k, edge = visW * candidate.k * 0.02;
          return candidate.x + side >= w.l + edge && candidate.x + W * candidate.k - side <= w.r - edge && candidate.y >= w.t + edge && candidate.y + H * candidate.k * 0.8 <= w.b;
        };
        const finishFreeAnim = (anim, to) => {
          free.anim = null;
          if (anim.snap && !PET) {
            free.on = false;
            saveFree();
          } else {
            Object.assign(free, { on: true, x: to.x, y: to.y, k: to.k });
            saveFree();
          }
          if (anim.snap && PET) {
            petDocked = true;
            PET.send({ type: "attach" });
          }
          if (PET) {
            petSyncMenu();
            renderPetPanel();
          }
        };
        const freeAnimPose = (anim, home, now) => {
          const progress = Math.min(1, (now - anim.t0) / anim.ms), to = anim.snap ? (PET ? petDock : dockTarget(home)) || anim.from : anim.to;
          const e = anim.snap ? easeBack(progress) : easeOut(progress), scaleEase = easeOut(progress);
          const target = to;
          const pose2 = { k: anim.from.k + (target.k - anim.from.k) * scaleEase, x: anim.from.x + (target.x - anim.from.x) * e, y: anim.from.y + (target.y - anim.from.y) * e };
          if (anim.snap) snapProgress = scaleEase;
          if (progress >= 1) finishFreeAnim(anim, target);
          return pose2;
        };
        const freeWindowPose = (home) => {
          if (!isFinite(free.fx) || !isFinite(free.fy)) freeToRatio();
          const floor = coarsePointer() ? MIN_SHOW_K : SHOW_K;
          const baseK = coarsePointer() && home.r ? home.k : free.k;
          const k = Math.max(floor, Math.min(baseK, Math.min(1.25, innerHeight * 0.45 / visH)));
          return { k, x: free.fx * innerWidth - W * k / 2, y: free.fy * innerHeight - H * k };
        };
        const walkDockPose = { k: 1, x: 0, y: 0 };
        const petWalkClipOn = () => walking() || walk.phase === "recover" || walk.safeHold && walkAreaValid(walk.area);
        const petWalkPose = () => {
          if (!PET) return null;
          let pose2;
          if (walk.base && walking()) pose2 = walk.base;
          else if (walk.phase === "recover") pose2 = free;
          else if (walk.safeHold && !free.anim) {
            const limit = walkAreaValid(walk.area) ? walk.area : petDisplay.area;
            if (!walkAreaValid(limit)) return null;
            pose2 = keepIn(free, limit);
          } else return null;
          walkDockPose.k = pose2.k;
          walkDockPose.x = pose2.x + fleeX;
          walkDockPose.y = pose2.y;
          return walkDockPose;
        };
        const dockPose = (home, now) => {
          snapProgress = 0;
          if (drag.on) return { k: free.k, x: drag.x, y: drag.y };
          const walkPose = petWalkPose();
          if (walkPose) return walkPose;
          if (free.anim) return freeAnimPose(free.anim, home, now);
          const currentMode = freeMode();
          if (!PET && free.on && free.mode && free.mode !== currentMode) {
            free.applied = false;
            return dockTarget(home);
          }
          free.applied = true;
          if (!free.on) return dockTarget(home);
          const kept = keepIn(PET ? free : freeWindowPose(home));
          return { k: kept.k, x: kept.x + fleeX, y: kept.y };
        };
        const GLIDE = 0.066;
        const release = (vx, vy, touch = false) => {
          const k = free.k, from = { k, x: drag.x, y: drag.y }, glided = { k, x: from.x + vx * GLIDE, y: from.y + vy * GLIDE };
          const home = PET ? petDock : dockTarget(homePose());
          const mid = (at, scale) => [at.x + W * scale / 2, at.y + H * scale * 0.5];
          const [px, py] = mid(glided, k);
          const outside = !PET && bodyOut(glided);
          const backIn = !PET || !home?.win || inWindow(glided, home.win);
          const snapRange = touch ? Math.max(80, visW * k * 0.35) : Math.max(140, visW * k * 0.7);
          const snap = !outside && backIn && !!home && Math.hypot(px - mid(home, home.k)[0], py - mid(home, home.k)[1]) < snapRange;
          if (Math.hypot(vx, vy) > 2600) flashExp("dizzy", 1500);
          if (outside && link.supported) {
            const fromScreen = screenOf(from.x, from.y), toScreen = screenOf(glided.x, glided.y);
            link.opening = performance.now();
            link.post("open", { from: { k, x: fromScreen.x, y: fromScreen.y }, to: { k, x: toScreen.x, y: toScreen.y }, seq: ++link.seq });
          }
          free.on = true;
          if (snap) {
            free.anim = { t0: performance.now(), ms: 650, from, to: null, snap: true };
            return;
          }
          const to = keepIn(glided);
          let target = to;
          if (PET && petPendingRatio != null) {
            target = keepIn(petSizedPose(glided, k, petPendingRatio));
            petPendingRatio = null;
          }
          if (target.x !== from.x || target.y !== from.y || target.k !== from.k) free.anim = { t0: performance.now(), ms: 300, from, to: target, snap: false };
          else {
            free.anim = null;
            Object.assign(free, { x: from.x, y: from.y, k });
            saveFree();
          }
        };
        let lastPlaceKey = "";
        let hidden = false;
        let pageHiddenApplied = false;
        const pageHiddenNow = () => !PET && prefs.pageHidden === true;
        let petPower = !PET;
        let lastClip = "";
        let lastMask = "", lastMaskComposite = "";
        const petWin = { x: NaN, y: NaN };
        let petWinSize = { w: 0, h: 0 };
        let petTracking = false, petGrab = null;
        let petBox = "";
        const movePet = (pose2) => {
          const cx = (innerWidth - W * pose2.k) / 2, cy = innerHeight - H * pose2.k;
          const winX = Math.round(pose2.x - cx), winY = Math.round(pose2.y - cy);
          if (petTracking) petWin.x = petWin.y = NaN;
          else if (winX !== petWin.x || winY !== petWin.y || walk.phase === "recover") {
            petWin.x = winX;
            petWin.y = winY;
            PET.move(winX, winY, walking() || walk.phase === "recover");
          }
          return { x: cx, y: cy };
        };
        let renderOn = true;
        const setRender = (on) => {
          if (renderOn === on) return;
          renderOn = on;
          if (!on) return;
          app.ticker.lastTime = performance.now();
          wakeRaf();
        };
        const hideCharacter = () => {
          canvas.style.display = "none";
          setBubbleDisplay("none");
        };
        const placeBlocked = () => {
          if (hidden) {
            hideCharacter();
            return true;
          }
          if (pageHiddenNow()) {
            hideForPage();
            return true;
          }
          if (pageHiddenApplied) {
            pageHiddenApplied = false;
            veil.style.opacity = "";
            veil.style.pointerEvents = "";
            lastPlaceKey = "";
            wakeRaf();
          }
          if (mobileHidden() || typingActive()) {
            skipIntro();
            setRender(false);
            hideCharacter();
            veil.style.opacity = "0";
            veil.style.pointerEvents = "none";
            lastPlaceKey = "";
            return true;
          }
          if (link.open || link.follow?.shown) {
            setRender(false);
            hideCharacter();
            lastPlaceKey = "";
            return true;
          }
          return false;
        };
        const introPose = (home, dock, now) => {
          let { k, x, y } = dock;
          let introOn = intro.phase !== "done", veilOpacity = 0, introProgress = 0;
          if (introOn && !intro.begun) {
            if (home.card && !intro.cardAt) intro.cardAt = now;
            if (!(intro.cardAt && now - intro.cardAt > 300) && now - intro.start < 8e3) {
              veil.style.opacity = "1";
              veil.style.pointerEvents = "none";
              return null;
            }
            intro.begun = true;
            intro.start = now;
          }
          if (introOn) {
            const center = centerPose();
            if (intro.phase === "center") {
              veilOpacity = 1;
              k = center.k;
              x = center.x;
              y = center.y;
              if (intro.skip) {
                intro.phase = "move";
                intro.moveStart = now;
                intro.from = center;
              }
            } else {
              const progress = ease((now - intro.moveStart) / 900);
              veilOpacity = 1 - progress;
              introProgress = progress;
              k = intro.from.k + (dock.k - intro.from.k) * progress;
              x = intro.from.x + (dock.x - intro.from.x) * progress;
              y = intro.from.y + (dock.y - intro.from.y) * progress;
              if (progress >= 1) {
                intro.phase = "done";
                introOn = false;
                setRes(1);
                veil.remove();
                bubble.style.left = "";
                bubble.style.fontSize = "";
                bubble.style.padding = "";
              }
            }
            veil.style.opacity = String(veilOpacity);
            veil.style.pointerEvents = intro.phase === "center" ? "auto" : "none";
            canvas.style.opacity = intro.phase === "center" ? String(ease((now - intro.start) / 300)) : "";
          }
          return { k, x, y, introOn, introProgress };
        };
        const applyWalkOpacity = (walkNow) => {
          if (walkNow) {
            canvas.style.opacity = String(Math.max(0, Math.min(1, Number.isFinite(walk.alpha) ? walk.alpha : 1)));
            walk.opacityApplied = true;
          } else if (walk.opacityApplied) {
            canvas.style.opacity = "";
            walk.opacityApplied = false;
          }
        };
        const petBodyAway = () => walking() || walk.phase === "recover" || fleeX !== 0;
        const placePetWindow = (dock, k, walkNow) => {
          const { x, y } = movePet(dock);
          applyWalkOpacity(walkNow);
          const needW = Math.ceil(W * k) + 24, needH = Math.ceil(H * k) + PET_BUBBLE;
          const panelW = petPanelOpen && petPanel ? Math.ceil(petPanel.offsetWidth) + 24 : 0;
          const panelH = petPanelOpen && petPanel ? Math.ceil(petPanel.offsetHeight) + 24 : 0;
          const fitW = Math.max(needW, panelW), fitH = Math.max(needH, panelH);
          if (fitW !== petWinSize.w || fitH !== petWinSize.h) {
            petWinSize.w = fitW;
            petWinSize.h = fitH;
            PET.send({ type: "fit", w: fitW, h: fitH });
          }
          if (petPanelOpen && (innerWidth !== petPanelWin.w || innerHeight !== petPanelWin.h)) {
            petPanelWin = { w: innerWidth, h: innerHeight };
            fitPetPanel();
          }
          const bodyBox = bodyRect(x, y, k), body = petBodyAway() ? null : { l: Math.round(bodyBox.l), t: Math.round(bodyBox.t), r: Math.round(bodyBox.r), b: Math.round(bodyBox.b) };
          const hitBox = petPanelBox(body);
          const sig = JSON.stringify(hitBox);
          if (sig !== petBox) {
            petBox = sig;
            PET.send({ type: "hitbox", box: hitBox });
          }
          return { x, y };
        };
        const walkClipSpec = { area: { l: 0, t: 0, r: 0, b: 0 }, screenX: 0, screenY: 0, width: 0, height: 0 };
        const walkClip = { left: 0, top: 0, right: 0, bottom: 0, any: false };
        const petWalkClip = (k, x, y) => {
          const area2 = walk.area;
          if (!walkAreaValid(area2)) return "";
          const border = (outerWidth - innerWidth) / 2;
          const domX = screenX + border + x, domY = screenY + Math.max(0, outerHeight - innerHeight - border) + y;
          const fresh = !!petBounds && performance.now() - petBounds.at < 2e3;
          const nativeX = fresh ? petBounds.x + x : domX, nativeY = fresh ? petBounds.y + y : domY;
          const left = Math.min(domX, nativeX), top = Math.min(domY, nativeY);
          const right = Math.max(domX + W * k, nativeX + W * k), bottom = Math.max(domY + H * k, nativeY + H * k);
          walkClipSpec.area = area2;
          walkClipSpec.screenX = left;
          walkClipSpec.screenY = top;
          walkClipSpec.width = right - left;
          walkClipSpec.height = bottom - top;
          const inset = walkClipInset(walkClipSpec, walkClip);
          return inset.any ? `inset(${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px)` : "";
        };
        const updateCardClip = (home, introOn, k, x, y, walkNow) => {
          const seat = !introOn && home.card && home.card.closest('[class*="composerSeat"]');
          const popup = seat && seat.querySelector('[class*="_card"]:not(.dsc-composer)');
          let clip = "";
          if (popup) {
            const popupRect = popup.getBoundingClientRect(), popupStyle = getComputedStyle(popup), canvasWidth = W * k, canvasHeight = H * k;
            const left = popupRect.left - x, top = popupRect.top - y, right = popupRect.right - x, bottom = popupRect.bottom - y;
            if (right > 0 && bottom > 0 && left < canvasWidth && top < canvasHeight) {
              const radius = (value) => Math.min(parseFloat(value) || 0, popupRect.width / 2, popupRect.height / 2);
              const fixed = (n) => +n.toFixed(2);
              const topLeftRadius = radius(popupStyle.borderTopLeftRadius), topRightRadius = radius(popupStyle.borderTopRightRadius), bottomRightRadius = radius(popupStyle.borderBottomRightRadius), bottomLeftRadius = radius(popupStyle.borderBottomLeftRadius);
              clip = `path(evenodd, "M0 0H${fixed(canvasWidth)}V${fixed(canvasHeight)}H0Z M${fixed(left + topLeftRadius)} ${fixed(top)}H${fixed(right - topRightRadius)}A${fixed(topRightRadius)} ${fixed(topRightRadius)} 0 0 1 ${fixed(right)} ${fixed(top + topRightRadius)}V${fixed(bottom - bottomRightRadius)}A${fixed(bottomRightRadius)} ${fixed(bottomRightRadius)} 0 0 1 ${fixed(right - bottomRightRadius)} ${fixed(bottom)}H${fixed(left + bottomLeftRadius)}A${fixed(bottomLeftRadius)} ${fixed(bottomLeftRadius)} 0 0 1 ${fixed(left)} ${fixed(bottom - bottomLeftRadius)}V${fixed(top + topLeftRadius)}A${fixed(topLeftRadius)} ${fixed(topLeftRadius)} 0 0 1 ${fixed(left + topLeftRadius)} ${fixed(top)}Z")`;
            }
          } else if (walkNow) clip = petWalkClip(k, x, y);
          if (clip !== lastClip) {
            canvas.style.clipPath = clip;
            lastClip = clip;
          }
        };
        const canvasMask = ({ winBox, petFade, fade, x, y }) => {
          if (winBox && petFade > 1e-3) {
            const origin = screenOf(0, 0), outsideAlpha = (1 - petFade).toFixed(3);
            const left = (winBox.l - origin.x - x).toFixed(1), right = (winBox.r - origin.x - x).toFixed(1);
            const top = (winBox.t - origin.y - y).toFixed(1), bottom = (winBox.b - origin.y - y).toFixed(1);
            return {
              mask: `linear-gradient(to right, rgba(0,0,0,${outsideAlpha}) 0 ${left}px, #000 ${left}px ${right}px, rgba(0,0,0,${outsideAlpha}) ${right}px 100%), linear-gradient(to bottom, rgba(0,0,0,${outsideAlpha}) 0 ${top}px, #000 ${top}px ${bottom}px, rgba(0,0,0,${outsideAlpha}) ${bottom}px 100%)`,
              maskComposite: "intersect"
            };
          }
          if (petFade > 1e-3) {
            const alpha = (1 - petFade).toFixed(3), fadeFrom = Math.max(0, WAIST_PCT - 2.5).toFixed(2), fadeTo = Math.min(100, WAIST_PCT + 2.5).toFixed(2);
            return { mask: `linear-gradient(to bottom, #000 0 ${fadeFrom}%, rgba(0,0,0,${alpha}) ${fadeTo}% 100%)`, maskComposite: "" };
          }
          return { mask: fade > 0 ? `linear-gradient(to bottom, #000 calc(100% - ${fade}px), transparent)` : "", maskComposite: "" };
        };
        const applyCanvasMask = (spec) => {
          const { mask, maskComposite } = canvasMask(spec);
          if (mask !== lastMask || maskComposite !== lastMaskComposite) {
            canvas.style.maskImage = canvas.style.webkitMaskImage = mask;
            canvas.style.maskComposite = maskComposite || "add";
            canvas.style.webkitMaskComposite = maskComposite === "intersect" ? "source-in" : "source-over";
            lastMask = mask;
            lastMaskComposite = maskComposite;
          }
        };
        const fitTail = () => {
          const t = bubbleTail(bubble.offsetWidth);
          bubble.style.setProperty("--dsc-tail-c", t - 2 + "px");
          return t;
        };
        const placeIntroBubble = ({ k, noseX, headTop, vp, introProgress }) => {
          const restMaxWidth = coarsePointer() ? Math.min(Math.max(150, visW * k * 1.1), vp.w - 16) : Math.max(150, visW * k * 1.1);
          const size = introBubbleSize(introProgress, restMaxWidth);
          bubble.style.right = "auto";
          bubble.style.fontSize = size.font + "px";
          bubble.style.padding = `${size.padY}px ${size.padX}px`;
          bubble.style.maxWidth = size.maxWidth + "px";
          const bubbleWidth = bubble.offsetWidth, bubbleHeight = bubble.offsetHeight, tail = fitTail();
          if (!coarsePointer()) {
            bubble.style.left = tailLeft({ noseX, bw: bubbleWidth, width: innerWidth, tail }) + "px";
            bubble.style.top = Math.max(8, headTop - bubbleHeight - 6) + "px";
            return;
          }
          const clampY = (top) => Math.min(Math.max(vp.top + HOME_GAP, top), Math.max(vp.top + HOME_GAP, vp.top + vp.h - bubbleHeight - HOME_GAP));
          bubble.style.left = vp.left + tailLeft({ noseX: noseX - vp.left, bw: bubbleWidth, width: vp.w, tail }) + "px";
          bubble.style.top = clampY(Math.max(vp.top + HOME_GAP, headTop - bubbleHeight - 6)) + "px";
        };
        const placeDesktopBubble = ({ k, noseX, headTop, home }) => {
          const card = home.card;
          bubble.style.left = "auto";
          bubble.style.maxWidth = Math.max(150, visW * k * 1.1) + "px";
          const tail = fitTail();
          bubble.style.right = tailRight({ noseX, width: innerWidth, tail }) + "px";
          bubble.style.top = Math.max(8, headTop - bubble.offsetHeight - 10) + "px";
          if (!(card && home.r)) return;
          const cardBox = home.r, bubbleLeft = bubble.offsetLeft, bubbleTop = bubble.offsetTop, bubbleBox = { left: bubbleLeft, top: bubbleTop, right: bubbleLeft + bubble.offsetWidth, bottom: bubbleTop + bubble.offsetHeight };
          if (!(bubbleBox.left < cardBox.right && bubbleBox.right > cardBox.left && bubbleBox.top < cardBox.bottom && bubbleBox.bottom > cardBox.top)) return;
          const belowCard = cardBox.bottom + 8;
          if (belowCard + bubble.offsetHeight <= innerHeight - HOME_GAP) bubble.style.top = belowCard + "px";
          else {
            bubble.style.maxWidth = Math.min(Math.max(150, visW * k * 1.1), innerWidth - 16) + "px";
            bubble.style.top = Math.max(8, Math.min(innerHeight - bubble.offsetHeight - HOME_GAP, headTop - bubble.offsetHeight - 10)) + "px";
          }
        };
        const placeMobileBubble = ({ k, noseX, headTop, vp, home }) => {
          const card = home.card;
          bubble.style.right = "auto";
          bubble.style.maxWidth = Math.min(Math.max(150, visW * k * 1.1), vp.w - 16) + "px";
          const placement = bubbleLayout({ vp, headX: noseX, headTop, bw: bubble.offsetWidth, bh: bubble.offsetHeight, r: card && home.r ? home.r : null, above: home.above, tail: fitTail() });
          bubble.style.left = placement.left + "px";
          bubble.style.top = placement.top + "px";
          if (placement.side && !home.above) bubble.classList.add("side");
        };
        const placeKeyOf = ({ k, x, y, vp, home, noseX, fade, petFade, winBox, walkNow }) => {
          const cardBox = home.r;
          return [
            k,
            x,
            y,
            vp.left,
            vp.top,
            vp.w,
            vp.h,
            fleeX,
            Math.round(bodyWeight * 40),
            cardBox && cardBox.left,
            cardBox && cardBox.right,
            cardBox && cardBox.top,
            cardBox && cardBox.bottom,
            Math.round(noseX / 3),
            home.above ? 1 : 0,
            bubble.textContent,
            bubble.className.replace(/\bside\b/g, "").trim(),
            bubbleStatus.textContent,
            bubbleStatus.classList.contains("show") ? 1 : 0,
            fade,
            Math.round(petFade * 60),
            walkPlaceKey(walkNow),
            winBox ? [winBox.l, winBox.t, winBox.r, winBox.b].join(",") : ""
          ].join("|");
        };
        const walkPlaceKey = (walkNow) => {
          if (!walkNow) return "";
          const area2 = walk.area, bounds = petBounds;
          return `${walk.phase},${Math.round(walk.alpha * 100)},${area2 ? `${area2.l},${area2.t},${area2.r},${area2.b}` : ""},${bounds ? `${Math.round(bounds.x)},${Math.round(bounds.y)}` : ""}`;
        };
        const fadeAmounts = (k, y) => {
          const lift = PET ? 0 : Math.max(0, innerHeight - (y + H * k));
          const fade = PET ? 0 : Math.round(Math.max(0, Math.min(lift, H * k * 0.18)) * (1 - Math.min(1, Math.max(0, bodyWeight))));
          const petFade = PET ? Math.min(1, Math.max(0, petDocked ? 1 : snapProgress)) : 0;
          return { fade, petFade };
        };
        const showAt = (introOn, k, home) => {
          const show = introOn || k >= SHOW_K || home.above && k >= MIN_SHOW_K;
          canvas.style.display = show ? "block" : "none";
          setBubbleDisplay(show ? "block" : "none");
          setRender(show && (!PET || petPower));
          return show;
        };
        const petWinBox = () => PET && petDock && petDock.win ? petDock.win : null;
        const placeBubble = (introOn, spot) => {
          if (introOn) placeIntroBubble(spot);
          else if (!coarsePointer() && !spot.home.above) placeDesktopBubble(spot);
          else placeMobileBubble(spot);
        };
        const placeStatusBubble = ({ noseX, headTop }) => {
          const mainOn = bubble.classList.contains("show");
          bubbleStatus.style.maxWidth = (mainOn ? Math.min(260, Math.max(120, bubble.offsetWidth)) : 240) + "px";
          const w = bubbleStatus.offsetWidth, h = bubbleStatus.offsetHeight;
          if (!w || !h) return;
          const mainTop = parseFloat(bubble.style.top);
          const top = mainOn && Number.isFinite(mainTop) ? mainTop - h - 6 : headTop - h - 10;
          bubbleStatus.style.top = Math.max(8, Math.min(top, innerHeight - h - 8)) + "px";
          let left = noseX - w / 2;
          const mainLeft = parseFloat(bubble.style.left);
          if (mainOn && Number.isFinite(mainLeft)) {
            const mainRight = mainLeft + bubble.offsetWidth;
            if (mainRight - w >= mainLeft) left = Math.min(Math.max(left, mainLeft), mainRight - w);
          }
          bubbleStatus.style.left = Math.max(8, Math.min(left, innerWidth - w - 8)) + "px";
          bubbleStatus.style.right = "auto";
        };
        const place = () => {
          if (placeBlocked()) return;
          const now = performance.now();
          const home = homePose();
          const dock = dockPose(home, now);
          const pose2 = introPose(home, dock, now);
          if (!pose2) return;
          let { k, x, y } = pose2;
          const { introOn, introProgress } = pose2;
          if (!showAt(introOn, k, home)) return;
          if (curK !== k) {
            curK = k;
            setRes(k);
          }
          shown.k = k;
          shown.x = x;
          shown.y = y;
          const walkNow = PET ? petWalkClipOn() : false;
          if (PET) ({ x, y } = placePetWindow(dock, k, walkNow));
          updateCardClip(home, introOn, k, x, y, walkNow);
          const { fade, petFade } = fadeAmounts(k, y);
          const winBox = petWinBox();
          const noseX = x + (model.x + noseModelX * model.scale.x) * k;
          const viewArea = home.vp || viewport();
          const placeKey = introOn ? "" : placeKeyOf({ k, x, y, vp: viewArea, home, noseX, fade, petFade, winBox, walkNow });
          if (placeKey && placeKey === lastPlaceKey) return;
          lastPlaceKey = placeKey;
          applyCanvasMask({ winBox, petFade, fade, x, y });
          canvas.style.width = W * k + "px";
          canvas.style.height = H * k + "px";
          if (fleeX !== 0) setBubbleDisplay("none");
          canvas.style.left = x + "px";
          canvas.style.top = y + "px";
          const headTop = y + (H * 0.05 + chibiHeadDrop * Math.min(1, Math.max(0, bodyWeight))) * k;
          bubble.classList.remove("side");
          const spot = { k, noseX, headTop, vp: viewArea, home, introProgress };
          placeBubble(introOn, spot);
          placeStatusBubble(spot);
        };
        const hideChipVisible = ({ pet: pet2 = PET, isHidden = hidden, mobileHiddenNow = mobileHidden() } = {}) => !pet2 && isHidden && !mobileHiddenNow && !pageHiddenNow();
        let placeErrorWarned = false;
        let rafIdle = false;
        const wakeRaf = () => {
          if (rafIdle) {
            rafIdle = false;
            systemTicker(true);
            requestAnimationFrame(raf);
          }
        };
        const raf = (time) => {
          if (rafIdle) {
            systemTicker(false);
            return;
          }
          if (hidden) {
            syncHideChip();
          } else if (SLEEP.state !== "asleep") {
            try {
              place();
              placeErrorWarned = false;
            } catch (error) {
              if (!placeErrorWarned) {
                placeErrorWarned = true;
                console.warn("캐릭터 배치 실패:", error);
              }
            }
          }
          if (renderOn) app.ticker.update(time);
          if (!PET && pageHiddenNow()) {
            rafIdle = true;
            systemTicker(false);
            return;
          }
          if (rafIdle) {
            systemTicker(false);
            return;
          }
          if (PET ? !petPower : link.open) {
            rafIdle = true;
            systemTicker(false);
            return;
          }
          requestAnimationFrame(raf);
        };
        requestAnimationFrame(raf);
        let bubbleTimer = 0;
        let statusTimer = 0;
        let lastSayAt = 0;
        let lastSayText = "";
        const hideBubble = (delay) => {
          bubbleTimer = setTimeout(() => {
            if (voiceState?.speaking === true) {
              hideBubble(250);
              return;
            }
            bubble.classList.remove("show");
          }, delay);
        };
        const hideStatus = (delay = 0) => {
          clearTimeout(statusTimer);
          if (!delay) {
            bubbleStatus.classList.remove("show");
            return;
          }
          statusTimer = setTimeout(() => bubbleStatus.classList.remove("show"), delay);
        };
        const sayStatus = (text, ms) => {
          bubbleStatus.textContent = text;
          bubbleStatus.classList.add("show");
          clearTimeout(statusTimer);
          if (ms) hideStatus(ms);
        };
        const say = (text, ms = 3500, mutter = false, kind) => {
          relay("say", [text, ms, mutter, kind]);
          kind = kind || (mutter ? "mutter" : "other");
          if (kind === "status") {
            sayStatus(text, ms);
            try {
              window.dispatchEvent(new CustomEvent("dsc:say", { detail: { text, ms, kind } }));
            } catch {
            }
            return;
          }
          bubble.textContent = text;
          bubble.classList.add("show");
          lastSayText = text;
          bubble.classList.toggle("mutter", mutter);
          lastSayAt = performance.now();
          startTalk(text, ms || 3e3, mutter);
          clearTimeout(bubbleTimer);
          if (ms) hideBubble(ms);
          try {
            window.dispatchEvent(new CustomEvent("dsc:say", { detail: { text, ms, kind } }));
          } catch {
          }
        };
        const hush = () => {
          relay("hush", []);
          clearTimeout(bubbleTimer);
          bubble.classList.remove("show");
          hideStatus();
        };
        let hideChip = null;
        const showHideChip = () => {
          if (hideChip || !hideChipVisible()) return;
          hideChip = life.own(document.createElement("button"), (node) => node.remove());
          hideChip.type = "button";
          hideChip.id = "dsc-hide-chip";
          hideChip.textContent = "캐릭터 숨김 · 다시 표시";
          hideChip.addEventListener("click", () => setHidden(false));
          document.body.append(hideChip);
        };
        const clearHideChip = () => {
          if (hideChip) {
            hideChip.remove();
            hideChip = null;
          }
        };
        const syncHideChip = () => {
          if (hideChipVisible()) showHideChip();
          else clearHideChip();
        };
        const hideForPage = () => {
          pageHiddenApplied = true;
          canvas.style.display = "none";
          setBubbleDisplay("none");
          veil.style.opacity = "0";
          veil.style.pointerEvents = "none";
          setRender(false);
          clearHideChip();
          lastPlaceKey = "";
          systemTicker(false);
        };
        const restoreFromPage = () => {
          if (PET) return;
          const applied = pageHiddenApplied;
          pageHiddenApplied = false;
          if (!applied) {
            syncHideChip();
            return;
          }
          veil.style.opacity = "";
          veil.style.pointerEvents = "";
          systemTicker(true);
          if (!hidden && SLEEP.state !== "asleep") {
            canvas.style.display = "";
            setBubbleDisplay("");
            lastPlaceKey = "";
            wakeRaf();
            try {
              place();
            } catch (error) {
              console.warn("캐릭터 배치 실패:", error);
            }
          } else {
            canvas.style.display = "none";
            setBubbleDisplay("none");
            setRender(false);
            wakeRaf();
          }
          syncHideChip();
        };
        const syncPageHidden = () => {
          if (PET) return;
          if (pageHiddenNow()) hideForPage();
          else restoreFromPage();
        };
        if (!PET) hooks.syncPageHidden = syncPageHidden;
        if (pageHiddenNow()) hideForPage();
        const setHidden = (next) => {
          if (PET || hidden === next) return hidden;
          hidden = next;
          if (hidden) {
            drag.pending = null;
            drag.on = false;
            strokeFrom = null;
            chestFrom = null;
            hush();
            canvas.style.display = "none";
            setBubbleDisplay("none");
            veil.style.display = "none";
            document.documentElement.classList.remove("dsc-hover", "dsc-grabbing");
            setRender(false);
            if (link.open || link.follow) {
              link.opening = 0;
              try {
                link.post("hide");
              } catch {
              }
            }
            showHideChip();
          } else {
            clearHideChip();
            veil.style.display = "";
            setBubbleDisplay("");
            canvas.style.display = "";
            lastPlaceKey = "";
            if (SLEEP.state === "asleep" || SLEEP.state === "leaving") {
              clearTimeout(sleepTimer);
              sleepTimer = 0;
              cancelSleepSlide?.();
              cancelSleepSlide = null;
              SLEEP.state = "active";
              fleeX = 0;
              SLEEP.lastActive = performance.now();
            }
            setRender(true);
            if (link.open || link.follow) {
              link.open = false;
              link.follow = null;
              link.opening = 0;
              try {
                link.post("hide");
              } catch {
              }
            }
            wakeRaf();
            place();
            requestAnimationFrame(() => {
              if (!hidden && !link.open && !link.follow && canvas.style.display === "none") lastPlaceKey = "";
            });
            setTimeout(() => {
              if (!hidden && !link.open && !link.follow) {
                lastPlaceKey = "";
                place();
              }
            }, 350);
          }
          return hidden;
        };
        if (!PET) {
          hooks.toggleCanvas = () => setHidden(!hidden);
          hooks.canvasHidden = () => hidden;
        }
        let mouseX = innerWidth / 2, mouseY = innerHeight / 2, lastMove = 0;
        addEventListener("mousemove", (e) => {
          mouseX = e.clientX;
          mouseY = e.clientY;
          lastMove = performance.now();
        }, { passive: true });
        const headLookX = S(), headLookY = S(), eyeLookX = S(), eyeLookY = S();
        const bob = S();
        const bobKick = (velocity) => {
          bob.v += velocity;
        };
        let energy = 0.6;
        const attention = { x: 0, y: 0.05, next: 0 };
        const pickAttention = (now, talking) => {
          let spot;
          const chance = Math.random();
          if (talking) spot = chance < 0.85 ? [0, 0.05] : [-0.5, 0.1];
          else if (mood === "work") spot = chance < 0.55 ? [-0.75, 0.12] : chance < 0.75 ? [-0.55, -0.3] : chance < 0.9 ? [0, 0.05] : [0.35, 0.3];
          else if (mood === "wait") spot = chance < 0.7 ? [0, 0.05] : [-0.7, 0.05];
          else if (mood === "sad") spot = chance < 0.6 ? [0.1, -0.45] : [-0.3, -0.3];
          else spot = chance < 0.4 ? [0, 0.05] : chance < 0.6 ? [-0.7, 0.1] : [(Math.random() - 0.5) * 1.2, (Math.random() - 0.4) * 0.7];
          attention.x = spot[0] + (Math.random() - 0.5) * 0.12;
          attention.y = spot[1] + (Math.random() - 0.5) * 0.1;
          attention.next = now + (talking ? 2500 : mood === "work" ? 1200 : 1500) + Math.random() * 3e3;
          if (Math.random() < 0.35) blink.next = Math.min(blink.next, now + 60);
          if (Math.random() < 0.3) browKick = Math.max(browKick, 0.25);
        };
        let talk = null;
        const startTalk = (text, ms, quiet) => {
          const { syl, total } = parseSyllables(text, ms);
          talk = { syl, t0: performance.now(), total, quiet };
        };
        const VOWELS = ["A", "I", "U", "E", "O"];
        const VOWEL_PARAMS = PARAMS.mouthVowel;
        const vowel = { A: 0, I: 0, U: 0, E: 0, O: 0 };
        let mouthOpen = 0, talkSway = 0, browKick = 0, browValue = 0, nodKick = 0, lastStressIndex = -1;
        let voiceState = null;
        const look = { x: 0, y: 0 };
        const pose1 = { lean: 0, headZ: 0, headY: 0, bodyY: 0 };
        const gestureSprings = {};
        const GESTURE_SPRING = {
          yaw: [90, 19],
          pitch: [90, 19],
          roll: [90, 19],
          // 고개: 약 0.42초에 안정
          bodyX: [55, 14.8],
          bodyY: [55, 14.8],
          bodyZ: [55, 14.8],
          lean: [48, 13.8],
          // 몸통: 약 0.5~0.6초
          smile: [40, 12.6],
          eyeSmile: [40, 12.6],
          eyeClose: [40, 12.6],
          mouth: [40, 12.6]
          // 팔·표정: 약 0.65초
        };
        for (const channel in GESTURE_SPRING) gestureSprings[channel] = { x: 0, v: 0 };
        let blink = { next: performance.now() + 2e3, start: -1e9, double: false }, lastFrameAt = performance.now();
        const updateChestDrag = (now, dt) => {
          spring(dragLift, chestDragging ? chestTarget : 0, dt, chestDragging ? 820 : 200, chestDragging ? 40 : 6);
          spring(dragShift, chestDragging ? chestShiftTarget : 0, dt, chestDragging ? 700 : 220, chestDragging ? 42 : 7);
          if (!chestDragging && Math.abs(dragShift.x) < 1e-4 && Math.abs(dragShift.v) < 1e-3) dragShift.x = dragShift.v = 0;
          if (!chestDragging && Math.abs(dragLift.x) < 1e-4 && Math.abs(dragLift.v) < 1e-3) dragLift.x = dragLift.v = 0;
          if (chestDragging) {
            flashExp("squint", 400);
            flashExp("blush", 400);
            walk.lastTouch = now;
          }
        };
        const frameContext = (now, dt) => {
          const introCalm = intro.phase !== "done";
          const seconds = now / 1e3;
          if (voiceState && voiceState.until && now > voiceState.until) voiceState = null;
          const talking = voiceState?.speaking === true || bubble.classList.contains("show") && fleeX === 0;
          const muttering = talking && bubble.classList.contains("mutter");
          if (moodUntil && now > moodUntil) {
            mood = "idle";
            moodUntil = 0;
          }
          const laughing = gestureState.name === "laugh";
          return { now, dt, seconds, introCalm, talking, muttering, laughing };
        };
        const updateEnergy = ({ dt, talking, muttering, laughing }) => {
          const energyTarget = (mood === "sad" ? 0.35 : mood === "wait" ? 0.55 : mood === "work" ? 0.75 : 0.6) + (talking && !muttering ? 0.35 : 0) + (laughing ? 0.5 : 0);
          energy += (energyTarget - energy) * Math.min(1, dt * 1.5);
        };
        const updateGaze = ({ now, dt, introCalm, talking, muttering }) => {
          let targetX, targetY;
          if (now < stareUntil) {
            targetX = 0;
            targetY = 0.05;
          } else if (muttering) {
            targetX = 0.4;
            targetY = 0.38;
          } else if (talking && introCalm) {
            targetX = attention.x * 0.25;
            targetY = 0.05 + attention.y * 0.2;
          } else if (now - lastMove < 2500 && !talking) {
            const rect = canvas.getBoundingClientRect();
            targetX = clamp((mouseX - (rect.left + rect.width / 2)) / 600, -1, 1);
            targetY = clamp((rect.top + rect.height * 0.25 - mouseY) / 500, -1, 1);
          } else {
            if (now > attention.next || !introCalm && talking && Math.abs(attention.x) > 0.3 && Math.random() < dt * 2) pickAttention(now, talking);
            targetX = attention.x;
            targetY = attention.y;
          }
          const eyeStiffness = introCalm ? 420 : 900, eyeDamping = introCalm ? 42 : 55;
          spring(eyeLookX, targetX, dt, eyeStiffness, eyeDamping);
          spring(eyeLookY, targetY, dt, eyeStiffness, eyeDamping);
          spring(headLookX, targetX * 0.85, dt, 38, 9.5);
          spring(headLookY, targetY * 0.8, dt, 38, 9.5);
          look.x = headLookX.x;
          look.y = headLookY.x;
        };
        const stressKick = (introCalm) => {
          if (!introCalm) browKick = Math.max(browKick, 0.35 + Math.random() * 0.35);
          else if (Math.random() < 0.35) browKick = Math.max(browKick, 0.2 + Math.random() * 0.15);
          if (Math.random() < 0.45) nodKick = Math.max(nodKick, 0.6 + Math.random() * 0.5);
        };
        const talkOpen = (now, introCalm) => {
          const current = talk;
          let t = (now - current.t0) / 1e3;
          if (t >= current.total) {
            talk = null;
            return 0;
          }
          let i = 0;
          while (i < current.syl.length && t > current.syl[i].d) {
            t -= current.syl[i].d;
            i++;
          }
          const syllable = current.syl[i];
          if (!(syllable && syllable.v)) return 0;
          const progress = t / syllable.d, envelope = Math.pow(Math.sin(Math.PI * Math.min(1, progress)), 0.7);
          const open = envelope * syllable.amp * (current.quiet ? 0.3 : 1);
          vowel[syllable.v] = Math.max(vowel[syllable.v], open);
          if (syllable.stress && i !== lastStressIndex) {
            lastStressIndex = i;
            if (!current.quiet) stressKick(introCalm);
          }
          return open;
        };
        const updateSpeech = ({ now, dt, introCalm }) => {
          let open = 0;
          for (const key of VOWELS) vowel[key] *= Math.max(0, 1 - dt * 14);
          if (talk) open = talkOpen(now, introCalm);
          if (voiceState?.speaking) {
            open = clamp(voiceState.level, 0, 1) * 0.9;
            if (voiceState.vowels) for (const key of VOWELS) vowel[key] = Math.max(vowel[key] * 0.4, clamp(voiceState.vowels[key] || 0, 0, 1));
          }
          mouthOpen += (open - mouthOpen) * Math.min(1, dt * 16);
          browKick *= Math.max(0, 1 - dt * (introCalm ? 2 : 3.5));
          browValue = introCalm ? browValue + (browKick - browValue) * Math.min(1, dt * 5) : browKick;
          nodKick *= Math.max(0, 1 - dt * 5);
        };
        const updateMoodPose = (dt) => {
          const goal = { lean: 0, headZ: 0, headY: 0, bodyY: 0 };
          if (mood === "work") {
            goal.lean = -7;
            goal.headY = -5;
          }
          if (mood === "wait") {
            goal.lean = -9;
            goal.headZ = 8;
            goal.headY = 3;
          }
          if (mood === "sad") {
            goal.headY = -10;
            goal.bodyY = -5;
          }
          const followRate = Math.min(1, dt * 2.2);
          for (const key of Object.keys(goal)) {
            pose1[key] += (goal[key] - pose1[key]) * followRate;
            pose[key] += (pose1[key] - pose[key]) * followRate;
          }
        };
        const baseMotion = ({ now, dt, seconds, talking, muttering }) => {
          const motion = { yaw: headLookX.x * 22 + noise(seconds * 0.33, 1) * 6 * energy };
          motion.pitch = headLookY.x * 13 + noise(seconds * 0.41, 2) * 4.5 * energy + pose.headY - nodKick * 4 - mouthOpen * 1.5;
          motion.roll = noise(seconds * 0.27, 3) * 7.5 * energy - headLookX.x * headLookY.x * 7 + pose.headZ;
          stareWeight += ((now < stareUntil ? 1 : 0) - stareWeight) * Math.min(1, dt * 6);
          talkSway += ((talking && !muttering && now >= stareUntil ? 1 : 0) - talkSway) * Math.min(1, dt * 2.5);
          motion.swayYaw = Math.sin(seconds * Math.PI * 2 * 0.31 + 1.3) * 4.5 * talkSway;
          motion.swayPitch = Math.sin(seconds * Math.PI * 2 * 0.47 + 0.6) * 1.5 * talkSway;
          if (talkSway > 0.01) {
            motion.roll += Math.sin(seconds * Math.PI * 2 * 0.55) * 4 * talkSway;
            motion.yaw += motion.swayYaw;
            motion.pitch += motion.swayPitch;
          }
          motion.bodyX = headLookX.x * 8 + noise(seconds * 0.17, 4) * 5 * energy;
          motion.bodyZ = motion.roll * 0.5 + noise(seconds * 0.21, 5) * 3 * energy;
          spring(bob, 0, dt, 70, 6);
          motion.bodyY = pose.bodyY + Math.sin(seconds * 2 * Math.PI / 3.6) * 1.8 + clamp(bob.x, -14, 14);
          motion.lean = pose.lean;
          motion.smile = 0;
          motion.eyeSmileAdd = 0;
          motion.eyeClose = 0;
          motion.mouthAdd = 0;
          if (mood === "work") motion.bodyZ += Math.sin(seconds * 2.1) * 1.2;
          return motion;
        };
        const applyGesture = (motion, { now, dt }) => {
          const gestureOut = { yaw: 0, pitch: 0, roll: 0, bodyX: 0, bodyY: 0, bodyZ: 0, lean: 0, smile: 0, eyeSmile: 0, eyeClose: 0, mouth: 0 };
          if (gestureState.name) {
            const progress = (now - gestureState.start) / gestureState.dur;
            if (progress >= 1) {
              gestureState.name = null;
              nextIdleGesture = Math.max(nextIdleGesture, now + 2500 + Math.random() * 3500);
            } else addGesture(gestureOut, gestureState.name, progress, gestureState.dir);
          }
          for (const channel of Object.keys(gestureOut)) {
            const springParams = GESTURE_SPRING[channel];
            spring(gestureSprings[channel], gestureOut[channel], dt, springParams[0], springParams[1]);
          }
          motion.yaw += gestureSprings.yaw.x;
          motion.pitch += gestureSprings.pitch.x;
          motion.roll += gestureSprings.roll.x;
          motion.bodyX += gestureSprings.bodyX.x;
          motion.bodyY += gestureSprings.bodyY.x;
          motion.bodyZ += gestureSprings.bodyZ.x;
          motion.lean += gestureSprings.lean.x;
          motion.smile += gestureSprings.smile.x;
          motion.eyeSmileAdd += gestureSprings.eyeSmile.x;
          motion.eyeClose += gestureSprings.eyeClose.x;
          motion.mouthAdd += gestureSprings.mouth.x;
          if (!gestureState.name && mood === "idle" && now > nextIdleGesture && now >= sulkUntil) {
            const chance = Math.random();
            const pick = chance < 0.3 ? "tilt" : chance < 0.5 ? "sway" : chance < 0.72 ? "lean" : chance < 0.88 ? "nod" : "laugh";
            play(pick, pick === "lean" ? 2600 : pick === "sway" ? 2300 : pick === "laugh" ? 1500 : 1800);
            nextIdleGesture = now + 7e3 + Math.random() * 9e3;
          }
        };
        const applyTouchAndShiver = (motion, { now, dt }) => {
          touchLean += ((now < touchLeanUntil ? -30 : 0) - touchLean) * Math.min(1, dt * 4);
          motion.lean += touchLean;
          const shiverSec = (now - shiverStarted) / 1e3;
          if (shiverSec >= 0 && shiverSec < 5) {
            const tremor = Math.sin(shiverSec * Math.PI * 2 * 8) * Math.min(1, shiverSec / 0.2) * Math.pow(1 - shiverSec / 5, 1.5);
            motion.bodyZ -= tremor * 3;
            motion.roll += tremor * 2;
            if (now > shiverBobAt) {
              bobKick((shiverBobSign = -shiverBobSign) * 40 * Math.pow(1 - shiverSec / 5, 1.5));
              shiverBobAt = now + 170 + Math.random() * 90;
            }
          }
        };
        const applyWalk = (motion, { now, dt, seconds }) => {
          if (fleeX !== 0 && !walk.phase) motion.bodyZ += Math.sin(seconds * 16) * 8;
          const faceTo = walk.phase === "out" ? walk.dir : walk.phase === "in" ? walk.faceDir == null ? -walk.dir : walk.faceDir : 0;
          walk.face += (faceTo - walk.face) * Math.min(1, dt * 5);
          const facing = Math.abs(walk.face);
          if (facing > 0.01) {
            const stepPhase = seconds * Math.PI * 2 * 1.8, faceDirection = walk.face;
            motion.yaw = motion.yaw * (1 - facing) + 22 * faceDirection;
            motion.pitch -= 2 * facing;
            motion.roll += Math.sin(stepPhase) * 2.5 * facing;
            motion.bodyX += 6 * faceDirection;
            motion.bodyY += Math.abs(Math.sin(stepPhase)) * 6 * facing;
            motion.bodyZ += Math.sin(stepPhase) * 4 * facing;
          }
          if (walkCheck) walkCheck(now);
        };
        const applyCarry = (motion, { now, dt }) => {
          const lastSample = drag.samples.length ? drag.samples[drag.samples.length - 1][0] : 0;
          if (!drag.on || now - lastSample > 60) {
            const decay = Math.max(0, 1 - dt * 5);
            carry.vx *= decay;
            carry.vy *= decay;
          }
          const carryVx = clamp(carry.vx / 1600, -1, 1), carryVy = clamp(carry.vy / 1600, -1, 1);
          if (Math.abs(carryVx) + Math.abs(carryVy) > 2e-3) {
            motion.bodyX -= carryVx * 16;
            motion.bodyZ -= carryVx * 14;
            motion.roll -= carryVx * 12;
            motion.yaw += carryVx * 8;
            motion.bodyY -= carryVy * 12;
            motion.pitch += carryVy * 10;
          }
        };
        const applySulk = (motion, { now, dt }) => {
          const sulkWeight = now < sulkUntil ? Math.min(sstep((now - sulkStart) / 350), sstep((sulkUntil - now) / 1200)) : 0;
          let peek = 0;
          if (sulkWeight > 0) {
            const sulkElapsed = now - sulkStart;
            for (const peekEvent of sulkPeeks) {
              const sincePeek = sulkElapsed - peekEvent.at;
              if (sincePeek < 0 || sincePeek > PEEK_RISE + PEEK_HOLD + PEEK_SNAP) continue;
              if (sincePeek >= PEEK_RISE + PEEK_HOLD && !peekEvent.done) {
                peekEvent.done = true;
                if (peekEvent.flip) sulkDir = -sulkDir;
              }
              peek = sincePeek < PEEK_RISE ? sstep(sincePeek / PEEK_RISE) : sincePeek < PEEK_RISE + PEEK_HOLD ? 1 : 1 - sstep((sincePeek - PEEK_RISE - PEEK_HOLD) / PEEK_SNAP);
            }
            const away = 1 - 0.75 * peek, turnRate = Math.min(1, dt * 14);
            sulkYaw += (-24 * sulkDir * away - sulkYaw) * turnRate;
            sulkRoll += (-8 * sulkDir * away - sulkRoll) * turnRate;
            motion.yaw = motion.yaw * (1 - sulkWeight) + sulkYaw * sulkWeight;
            motion.roll = motion.roll * (1 - sulkWeight) + sulkRoll * sulkWeight;
            motion.pitch = motion.pitch * (1 - sulkWeight) + SULK_CHIN * (1 - 0.6 * peek) * sulkWeight;
            motion.bodyX = motion.bodyX * (1 - sulkWeight) + sulkYaw / 6 * sulkWeight;
            motion.smile *= 1 - sulkWeight;
            motion.eyeSmileAdd *= 1 - sulkWeight;
          }
          const sulkEye = sulkDir * (-0.45 + 0.85 * Math.min(1, peek * 1.8));
          return { sulkWeight, peek, sulkEye };
        };
        const writeHeadBody = (motion) => {
          if (stareWeight > 0.01) {
            const k = 1 - stareWeight * 0.92;
            motion.yaw = headLookX.x * 22 * (1 - stareWeight) + (motion.yaw - headLookX.x * 22) * k;
            motion.pitch *= k;
            motion.roll *= k;
            motion.bodyX *= k;
            motion.bodyZ *= k;
          }
          motion.yaw = clamp(motion.yaw, -30, 30);
          motion.pitch = clamp(motion.pitch, -30, 30);
          motion.roll = clamp(motion.roll, -30, 30);
          for (const [id, value] of [
            [PARAMS.headTurn, motion.yaw],
            [PARAMS.headTilt, motion.pitch],
            [PARAMS.headRoll, motion.roll],
            [PARAMS.headTurnDirect, motion.yaw],
            [PARAMS.headTiltDirect, motion.pitch],
            [PARAMS.headRollDirect, motion.roll],
            [PARAMS.bodyShiftX, clamp(motion.bodyX, -30, 30)],
            [PARAMS.bodyShiftY, clamp(motion.bodyY, -30, 30)],
            [PARAMS.bodyShiftZ, clamp(motion.bodyZ, -30, 30)],
            [PARAMS.bodyLean, clamp(motion.lean, -30, 30)]
          ]) addParam(id, value);
        };
        const writeEyes = (motion, { seconds }, { sulkWeight, sulkEye }) => {
          addParam(PARAMS.eyeLookX, clamp(((eyeLookX.x - headLookX.x) * 0.9 + headLookX.x * 0.2) * 0.6, -0.45, 0.45) * (1 - sulkWeight) + sulkEye * sulkWeight - motion.swayYaw / 30 * (1 - sulkWeight));
          addParam(PARAMS.eyeLookY, clamp(((eyeLookY.x - headLookY.x) * 0.9 + headLookY.x * 0.2) * 0.6 - motion.swayPitch / 30, -0.3, 0.3));
          setParam(PARAMS.breath, 0.5 + 0.5 * Math.sin(seconds * 2 * Math.PI / 3.6));
        };
        const writeBrows = ({ seconds }) => {
          const brow = browValue + noise(seconds * 0.5, 7) * 0.12 + (mood === "wait" ? 0.25 : mood === "sad" ? -0.3 : 0) - 0.15 * happyMouth;
          if (happyMouth > 0.01) addParam(PARAMS.browInnerRaise, 0.55 * happyMouth);
          addParam(PARAMS.browRaiseLeft, clamp(brow, -1, 1));
          addParam(PARAMS.browRaiseRight, clamp(brow + noise(seconds * 0.6, 8) * 0.06, -1, 1));
          if (browValue > 0.15) addParam(PARAMS.browInnerRaise, Math.min(1, browValue * 0.6));
        };
        const writeMouth = (motion, { now, dt, seconds }, { sulkWeight, peek }) => {
          const openNow = clamp(mouthOpen + motion.mouthAdd + 0.14 * happyMouth, 0, 1);
          if (openNow > 0.01) {
            setParam(PARAMS.mouthOpen, openNow * 0.9);
            addParam(PARAMS.jawOpen, openNow * 0.45);
            setParam(PARAMS.mouthClosed, 1 - openNow);
            for (const key of VOWELS) if (vowel[key] > 0.01) addParam(VOWEL_PARAMS[key], Math.min(1, vowel[key]) * (VOWEL_EYE_SAFE[key] || 1));
            if (motion.mouthAdd > 0.01) addParam(PARAMS.mouthVowel.A, motion.mouthAdd * 0.8);
          }
          happyMouth += ((now < happyMouthUntil ? 1 : 0) - happyMouth) * Math.min(1, dt * 5);
          const baseSmile = (mood === "sad" ? 0 : mood === "wait" ? 0.15 : 0.35) * (1 - sulkWeight) + 0.2 * happyMouth;
          if (sulkWeight > 0.01) for (const [id, eased] of [[PARAMS.cheekPuff, 0.5], [PARAMS.mouthPucker, 0.3], [PARAMS.frown, 0.5], [PARAMS.frownSecondary, 0.5]]) addParam(id, sulkWeight * (1 - eased * peek));
          addParam(PARAMS.mouthForm, clamp(baseSmile + motion.smile * 0.4, -1, 1));
          addParam(PARAMS.mouthSmileLeft, clamp(baseSmile + motion.smile * 0.5 + 0.3 * happyMouth, 0, 1));
          addParam(PARAMS.mouthSmileRight, clamp(baseSmile + motion.smile * 0.5 + noise(seconds * 0.3, 9) * 0.05, 0, 1));
          const eyeSmile = clamp((mood === "sad" ? 0 : 0.12) + motion.smile * 0.35 + motion.eyeSmileAdd, 0, 1);
          if (eyeSmile > 0.01) addParam(PARAMS.eyeSmile, eyeSmile);
        };
        const writeBlink = (motion, { now, laughing }) => {
          if (now >= blink.next && !laughing) {
            blink.start = now;
            blink.next = blink.double ? now + 2e3 + Math.random() * 4e3 : Math.random() < 0.18 ? now + 260 : now + 2e3 + Math.random() * 4e3;
            blink.double = !blink.double && blink.next - now < 400;
          }
          const sinceBlink = (now - blink.start) / 1e3;
          const eyeOpen = clamp((mood === "work" ? 0.92 : 0.97) * (1 - blinkClose(sinceBlink)) * (1 - motion.eyeClose), 0, 1.2);
          setParam(PARAMS.eyeOpenLeft, eyeOpen);
          setParam(PARAMS.eyeOpenRight, eyeOpen);
        };
        const writeExpressions = ({ now, dt }) => {
          for (const [name, params] of Object.entries(expressionParams)) {
            const target = hold[name] || (until[name] || 0) > now ? 1 : 0;
            const EYE_SWAP = EYE_EXP.includes(name);
            if (EYE_SWAP && weight[name] > 0.5 !== target > 0.5) {
              blink.start = now - 0.07 * 1e3;
              blink.next = Math.max(blink.next, now + 1500);
            }
            const w = weight[name] = EYE_SWAP ? target : (weight[name] || 0) + (target - (weight[name] || 0)) * Math.min(1, dt * 6);
            if (w < 0.01) continue;
            for (const entry of params) {
              if (entry.Blend === "Multiply") multiplyParam(entry.Id, entry.Value, w);
              else if (entry.Blend === "Add") addParam(entry.Id, entry.Value, w);
              else setParam(entry.Id, entry.Value, w);
            }
          }
        };
        const writeCoverChest = ({ now, dt, seconds }) => {
          const leaning = now < touchLeanUntil || touchLean < -2;
          const want = now >= cover.start && now < cover.until && bodyWeight < 0.5 && fleeX === 0 && !leaning;
          const coverBefore = cover.q;
          cover.q = clamp(cover.q + (want ? 1 : -1) * dt / 0.38, 0, 1);
          if (cover.q > 0) {
            const coverAmount = cover.q;
            const forearm = coverForearm(coverAmount);
            const breath = Math.sin(seconds * Math.PI * 2 * 0.4) * 0.02 * sstep(seg(0.8, 1, coverAmount));
            const velocity = (cover.q - coverBefore) / Math.max(dt, 1e-3);
            setParam(PARAMS.armFrontPose, 1);
            addParam(PARAMS.upperArmLeft, 0.034 * sstep(coverAmount));
            addParam(PARAMS.upperArmDepthLeft, 0.48 * sstep(seg(0, 0.6, coverAmount)));
            addParam(PARAMS.forearmLeft, forearm + breath);
            addParam(PARAMS.wristLeft, clamp(velocity * 0.06, -0.2, 0.2) * Math.sin(Math.PI * coverAmount));
          }
        };
        const writeOutfitParams = (outfit, dt) => {
          for (const [key, id, value] of OUTFIT_PARAMS) {
            const w = outfitWeight[key] = (outfitWeight[key] || 0) + ((outfit[key] ? 1 : 0) - (outfitWeight[key] || 0)) * Math.min(1, dt * 6);
            if (w > 5e-3) addParam(id, value * w);
          }
        };
        const writeEarHide = (outfit, dt) => {
          const earWas = earWeight;
          earWeight = earOpacityStep(earWeight, outfit.earHide === true, dt);
          if (earPartIndex >= 0) {
            if (earWeight > 5e-3) applyEarOpacity(cubismModel.parts, earPartIndex, earWeight);
            else if (earWas > 5e-3) cubismModel.parts.opacities[earPartIndex] = 1;
          }
        };
        const writeBodyShape = (outfit, now, dt) => {
          const walkingBody = walk.phase === "out" || walk.phase === "away" || walk.phase === "in" || SLEEP.state === "leaving" || SLEEP.state === "waking";
          basinWeight += ((now < basinUntil ? 1 : 0) - basinWeight) * Math.min(1, dt * 4);
          if (basinWeight > 5e-3) addParam(PARAMS.basinProp, basinWeight);
          bodyWeight += ((walkingBody ? 1 : BODY_VALUE[outfit.bodyType] || 0) - bodyWeight) * Math.min(1, dt * 4);
          if (bodyWeight > 2e-3) addParam(PARAMS.bodyType, bodyWeight);
          model.y = baseY + chibiDrop * clamp(bodyWeight, 0, 1);
        };
        const talkOutfitChange = (outfit) => {
          if (outfitPrev && outfitTalk) {
            for (const [key] of OUTFIT_PARAMS) if (outfit[key] && !outfitPrev[key]) outfitTalk(OUTFIT_LINE[key]);
            if ((outfit.bodyType || "default") !== (outfitPrev.bodyType || "default")) outfitTalk("body_" + (outfit.bodyType || "default"));
          }
          outfitPrev = { ...outfit };
        };
        const writeOutfit = ({ now, dt }) => {
          const outfit = prefs.outfit || {};
          writeOutfitParams(outfit, dt);
          writeEarHide(outfit, dt);
          writeBodyShape(outfit, now, dt);
          talkOutfitChange(outfit);
        };
        internalModel.motionManager.expressionManager = {
          /** 정리할 것 없음 (Live2D 표정 매니저 자리 채우기용) */
          destroy() {
          },
          /** 한 프레임의 절차 애니메이션: 위 단계들을 정해진 순서대로 실행 (dt는 0.05초 상한) */
          update() {
            const now = performance.now(), dt = Math.min(0.05, (now - lastFrameAt) / 1e3);
            lastFrameAt = now;
            updateChestDrag(now, dt);
            const frame = frameContext(now, dt);
            updateEnergy(frame);
            updateGaze(frame);
            updateSpeech(frame);
            updateMoodPose(dt);
            const motion = baseMotion(frame);
            applyGesture(motion, frame);
            applyTouchAndShiver(motion, frame);
            applyWalk(motion, frame);
            applyCarry(motion, frame);
            const sulk2 = applySulk(motion, frame);
            writeHeadBody(motion);
            writeEyes(motion, frame, sulk2);
            writeBrows(frame);
            writeMouth(motion, frame, sulk2);
            writeBlink(motion, frame);
            writeExpressions(frame);
            writeCoverChest(frame);
            writeOutfit(frame);
          }
        };
        const LINES = {
          head: [
            "[어두운, 얄미운] …거긴, 그렇게 쓰다듬지 마세요. 버릇 들면 어쩌려고요.",
            "[어두운, 얄미운] …주인님, 그 손… 계속 두실 생각이세요?",
            "[어두운, 얄미운] …한 번만 봐드리는 거예요.",
            "[어두운, 얄미운] …머리카락 엉키면, 내일 아침에 빗겨 주셔야 해요.",
            "[어두운, 얄미운] …손 놓으세요. 그렇게 보시면… 저도 참아야 하잖아요.",
            "[어두운, 얄미운] …이번엔 그냥 넘어갈게요. 착한 척은 여기까지예요."
          ],
          head_sulk: [
            "[홍조] 흥! 그럼 오늘은 안아 드리지 않을 거예요!",
            "[홍조] 흥, 나중에 후회하실 거예요…!",
            "[홍조] …만질 거면, 아예 달래 주시던가요.",
            "[홍조] 흥! 등 돌리고 있을 거예요. …곁에 있으면 안 되지만.",
            "[홍조] …한 번만 더 그러시면, 진짜 삐질 거예요."
          ],
          head_after: [
            "[홍조] …이번만 봐주는 거예요. 다음엔… 각오하세요.",
            "[홍조] …다음엔 진짜, 책임지셔야 해요.",
            "[홍조] 후… 이제 됐어요. …손은 아직 놓지 마시고요.",
            "[홍조] …이번 일은 비밀로 해 드릴게요. 대신, 나중에.",
            "[홍조] …주인님 나쁜 손. 오늘은 그렇게 기억해 둘게요."
          ],
          // 소품·옷·체형을 바꿨을 때 (데스크톱 펫 대사.md와 같은 대사)
          outfit_glasses: [
            "안경 쓴 비서… 오늘 밤은 엄격하게 굴어 드릴까요, 주인님?",
            "이런 지적인 얼굴… 마음에 드세요? 렌즈 너머로 다 보여요♪",
            "주인님 취향이… 이런 쪽이었나요? 메모해 둘게요♪",
            "안경 쓴 채로 보는 얼굴… 꽤 위험한데요. 감당하시겠어요?",
            "선생님, 숙제 다 했어요. …칭찬은 어떻게 해 주실 거예요?"
          ],
          outfit_shoes: [
            "주인님 앞에서 신발까지 벗다니… 이제 도망칠 데도 없네요",
            "[홍조] 앗… 맨발을 그렇게 보시면… 발끝이 저려요…",
            "바닥이 차가워요… 안아 올려 주실 거죠?",
            "[얄미운] 발끝만 보시는 거예요? …조금 서운한데요."
          ],
          outfit_tail: [
            "꼬리 숨기니… 기분을 들키지 않겠네요♪ …입꼬리는 못 숨기지만요",
            "쉿, 이건 주인님만 아는 거예요~",
            "[얄미운] 꼬리로 감으면… 붙잡히지 않을 자신 있는데요?",
            "꼬리 끝까지 다 보이니까… 이제 숨기는 건 없네요."
          ],
          outfit_clothes: [
            "[홍조] 앗… 이 옷, 생각보다 몸에 붙어서… 시선이 어디 가는지 아시죠?",
            "에헤헤, 좋다면… 조금 더 가까이 가도 돼요…",
            "[><, 홍조] 주, 주인님… 눈이 너무 노골적이세요…!",
            "[하트] 이 정도면… 만족하실 수 있어요? 아니면… 더?",
            "[홍조] 움직일 때마다… 느껴져서, 조금 곤란해요…",
            "[얄미운] 굳이 안 벗어도 괜찮죠. …필요하시면 말씀하시고요♪"
          ],
          body_default: [
            "익숙한 몸으로 돌아왔네요… 이게 제일 좋으시죠? 다 보이는데요",
            "원래 모습으로 복귀 완료! …다시 유혹해 볼까요♪",
            "역시 익숙한 게 좋으세요? …손이 먼저 움직이시네요.",
            "이 모습이 가장 편하다고… 그렇게 말씀하셨죠? 잘 기억해요."
          ],
          body_type1: [
            "어라… 몸매가 달라 보이지 않나요, 주인님? …어디가요?",
            "평소보다 색다른 느낌인데… 직접 확인하실 거예요?",
            "이 몸엔… 주인님 시선이 더 붙는 것 같네요. 기분 탓인가요?",
            "[얄미운] 어느 쪽이 마음에 드세요? …정직하게 말해 주세요."
          ],
          body_type2: [
            "앗, 작아졌어요! …안아 주시면 커질지도 몰라요♪",
            "[하트] 꼬마 모습이 됐어요… 무릎에 앉혀 주세요~",
            "작아도… 할 일은 다 할 수 있어요. 믿어 주세요♪",
            "[하트] 이 모습, 귀여우세요? …아니면 다른 게 좋으세요?",
            "작은 손으로도… 주인님 옷자락은 잘 잡아요."
          ],
          basin_on: [
            "[하트] 밥 먹을 시간이에요? …입 벌려 주세요♪",
            "[얄미운] 세숫대야 쓴 채로 먹는 거… 생각보다 불편해요.",
            "잘 먹을게요. …다 먹으면 칭찬해 주세요."
          ],
          pot_guard: [
            "[얄미운] 후훗, 이 정도는… 주인님 손길보다 약해요~",
            "[얄미운] 후훗, 제가 막을 줄 몰랐죠? 칭찬해 주세요♪",
            "[하트] 방어 성공이에요! 이번 판은 제 승리네요.",
            "[얄미운] 냄비보다 가벼운 손길이었어요. 아쉽네요♪",
            "[하트] 막았으니까… 이제 쓰다듬어 주실 차례죠?"
          ],
          pot_hit: [
            "[눈물] 아야야…! 머리 아파요…",
            "[눈물] 으앗! 별이 보여요…",
            "[눈물] …방금 그거 냄비였죠?!",
            "[눈물] 이마가… 좀 부풀었죠? 나중에 불어 주세요…",
            "[눈물] 아파서 그래요… 잠깐만 안아 주세요. 진짜로."
          ],
          walk_out: [
            "산책 좀 다녀올게요~ …따라오시면 안 돼요♪",
            "잠깐 바람 쐬고 올게요! 몸 좀 풀고요",
            "다리 좀 풀고 올게요~ 금방 올게요",
            "혼자 걷는 게 좋아요. …돌아올 땐 옆에 있어 주세요.",
            "바람이 좋아서요. 이 기분, 같이 나누고 싶네요."
          ],
          walk_back: [
            "다녀왔어요! …기다리셨죠? 얼굴에 쓰여 있어요♪",
            "산책 끝! 그새 보고 싶으셨어요?",
            "[하트] 다녀왔어요~ 안아 주세요.",
            "금방 다녀왔는데… 왜 벌써 반가운 거예요.",
            "[홍조] 발이 차가워졌어요… 손 좀 잡아 주시겠어요?"
          ],
          body: [
            "[하트] 불렀어요? …손, 잡아 주세요.",
            "[홍조] 왜요… 그렇게 빤히 보시면 더 부끄러운데.",
            "[얄미운] 흐응~? 만지고 싶으신 거죠?",
            "[식은땀] 앗, 깜짝이야! …놀라면 심장에 안 좋아요.",
            "[하트, 홍조] 오늘도 화이팅이에요! …조금 가까이 있어도 돼요?",
            "[얄미운] 그렇게 부르시면… 거절할 수 없잖아요.",
            "[홍조] 옆에 있으면 마음이 놓여요. …그러니까 계속 있어 주세요.",
            "[하트] 한 번 불러 주시면… 하루 종일 기분이 좋아요."
          ],
          arm: [
            "[홍조] 손 잡고 싶으신 거예요? …놓치면 안 돼요.",
            "[홍조] 팔은 왜요~? …팔찌라도 채워 주실 거예요?",
            "[얄미운] 그렇게 붙잡으면… 도망칠 맘도 없어지잖아요.",
            "손끝이 따뜻해요… 조금만 더 있어 주세요.",
            "[홍조] 팔에 힘이 들어오시는데… 저, 이러면 못 움직여요."
          ],
          leg: [
            "[식은땀, 홍조] 다, 다리는… 아직 안 돼요…!",
            "[식은땀, 홍조] 거기 만지면… 힘이 확 풀려요…!",
            "[홍조, ><] 으… 무릎은… 그렇게 안아 주시면 안 돼요…!",
            "[식은땀, 홍조] 서 있는 것도 벅차요… 놓아 주세요…",
            "[홍조, 하트] 거기, 감각이 예민하다니까요…"
          ],
          chest1: [
            "[홍조, 얄미운] 앗… 거긴… 그렇게 세게 하면 안 돼요.",
            "[홍조, 얄미운] 제 반응이 그렇게 궁금하세요…? 나쁜 주인님.",
            "[홍조, ><] 잠깐… 거기, 옷 위로도 다 느껴져요…",
            "[홍조, 얄미운] 손끝이… 너무 정확하신데요…?",
            "[홍조, 얄미운] 한 번은 봐드릴게요… 딱 한 번만이에요.",
            "[홍조, ><] 아… 그렇게 갑자기 만지시면… 숨이 멈춰요…",
            "[홍조, 얄미운] 앗…! 아직 마음의 준비도 안 했는데요…",
            "[홍조, ><] 손… 손이 너무 빨라요…!",
            "[홍조, 얄미운] 그렇게 놀라게 하시면… 반응이 다 보이잖아요.",
            "[홍조, ><] 잠깐… 여기, 사람 있는 데서는…",
            "[홍조, 하트] 지금… 일부러 그러신 거죠?",
            "[홍조, 얄미운] 옷 위로도 이렇게 느껴지는데… 어쩌죠?",
            "[홍조, ><] 앗… 그 손가락, 거기 두지 마세요…",
            "[홍조, 식은땀] 하… 갑자기 숨이 막혀서…",
            "[홍조, 얄미운] 주인님은… 이런 거 잘 아시네요.",
            "[홍조, 하트] 한 번만… 정말 한 번만이라고 했는데.",
            "[홍조, ><] 으… 이거, 웃으면서 넘길 일이 아니에요…",
            "[홍조, 얄미운] 거기, 손끝이 아직도 남아 있는데요…",
            "[홍조, 식은땀] 숨… 조금만 정리하게 해 주세요.",
            "[홍조, ><] 아… 아직 마음 준비가…",
            "[홍조, 하트] 그렇게 만지시면… 저, 나중에 못 참아요.",
            "[홍조, 얄미운] 한 번 더 하시면… 저도 방법을 생각해 볼게요.",
            "[홍조, ><] 앗, 거긴… 옷이 얇아서…",
            "[홍조, 식은땀] 잠깐만… 손 좀 내려 주세요… 아니, 그대로…",
            "[홍조, 하트] 지금 그 표정… 마음에 들어요.",
            "[홍조, 얄미운] …이번 건, 나중에 청구할 거예요."
          ],
          chest2: [
            "[하트, 홍조] 자꾸 그러면… 숨소리가 이상해지잖아요!",
            "[하트, 홍조] 으으… 장난치지 말아 주세요… 손에 힘이 없어져요…",
            "[하트, 홍조] 하아… 그렇게 만지작거리면… 저도 모르게 몸이…",
            "[홍조, 식은땀] 잠깐… 이거, 그만두실 생각 없으시죠…?",
            "[하트, 홍조] 주인님 손… 너무 따뜻해서 자꾸 기대게 돼요…",
            "[하트, ><] 으… 소리 내면 안 되는데… 참는 게 더 힘들어요…",
            "[하트, 홍조] 제가… 이상한 표정 짓고 있죠? 보지 마세요…",
            "[홍조, 식은땀] 손 떼 주세요… 이대로면 제가 먼저 무너져요…",
            "[하트, 홍조] 하아… 이제… 자꾸 손이 가잖아요…",
            "[하트, ><] 으… 숨소리, 주인님한테 다 들려요…",
            "[하트, 홍조] 잠깐만… 저, 지금 표정 관리가 안 돼요…",
            "[홍조, 식은땀] 하… 거기, 계속 만지면… 무릎 힘이…",
            "[하트, 홍조] 주인님 손, 왜 이렇게 따뜻해요…",
            "[하트, ><] 으으… 이러면 저, 아무 말도 못 해요…",
            "[하트, 홍조] 자꾸 그러시면… 제가 먼저 손을 잡을지도 몰라요.",
            "[홍조, 식은땀] 하아… 이거, 장난이 아니잖아요…",
            "[하트, 홍조] 소리… 소리 내면 안 되는데…",
            "[하트, ><] 잠깐… 살짝만… 천천히…",
            "[홍조, 하트] 저… 지금 얼굴, 보지 마세요…",
            "[하트, 홍조] 심장이 너무 뛰어서… 주인님 손에 다 느껴질 거예요.",
            "[하트, ><] 으… 옷자락 좀… 정리하게 해 주세요…",
            "[홍조, 식은땀] 하아… 이대로 있으면… 저, 이상해져요…",
            "[하트, 홍조] 주인님… 이거, 언제 멈추실 거예요…?",
            "[하트, ><] 아… 아직… 마음 준비 안 됐다니까요…",
            "[홍조, 하트] 손끝이 움직일 때마다… 저도 따라 움직여요…",
            "[하트, 식은땀] 잠깐… 숨 좀… 쉬게 해 주세요…",
            "[하트, 홍조] 이런 거… 익숙해지면 안 되는데…",
            "[홍조, ><] 주인님… 웃지 마세요… 지금 제가 우습죠…?"
          ],
          chest3: [
            "[하트, 홍조] 이제… 진짜 부끄러우니까 잠깐만요!",
            "[홍조, 식은땀] 더 하시면… 저, 가만히 못 있어요…!",
            "[하트, 눈물] 그만… 그만해 주세요… 심장이 터질 것 같아요…",
            "[하트, 홍조] 주인님… 이러다 정말… 되돌릴 수 없게 돼요…",
            "[홍조, ><] 으으… 이제 팔에 힘이 안 들어가요…",
            "[홍조, 식은땀] 이제… 정말 그만해 주세요…!",
            "[하트, 눈물] 으으… 저, 이제 한계예요…",
            "[홍조, ><] 더 하시면… 쓰러질지도 몰라요…",
            "[하트, 식은땀] 잠깐… 잠깐만… 숨이…",
            "[홍조, 눈물] 주인님… 이러다 진짜…!",
            "[하트, ><] 으아… 이제 팔에 힘이…",
            "[홍조, 식은땀] 그만… 부탁이에요… 이러다간…",
            "[하트, 눈물] 저… 눈물 날 것 같아요…",
            "[홍조, ><] 잠깐… 이건… 너무해요…",
            "[하트, 식은땀] 하아… 아직… 끝난 것도 아닌데…",
            "[홍조, 눈물] 주인님… 손… 놓아 주세요… 아니, 그대로…",
            "[하트, ><] 으으… 이제… 아무 생각도 안 나요…",
            "[홍조, 식은땀] 잠깐만… 머리가… 어지러워요…",
            "[하트, 눈물] 이러다… 저, 울어 버릴 것 같아요…",
            "[홍조, ><] 제발… 조금만 쉬게 해 주세요…",
            "[하트, 식은땀] 하아… 지금 제 얼굴… 부끄러워요…",
            "[홍조, 눈물] 주인님은… 진짜… 못 말리겠어요…",
            "[하트, ><] 으으… 이제… 제가 뭘 하는지도…",
            "[홍조, 식은땀] 이제… 정말 안아 주세요… 그만하고…",
            "[하트, 눈물] …이번엔, 제가 먼저 항복할게요…"
          ],
          chest_calm: [
            "[하트, 홍조] 후우… 심장이 아직도 두근거려요.",
            "[홍조, 얄미운] …이제 진정됐어요. 다음엔 각오하세요.",
            "[하트, 홍조] 이런 얼굴… 처음 보여 드리는 거예요.",
            "[홍조] …잠깐만 이대로 있게 해 주세요. 아직 다리가 후들거려요.",
            "[하트, 홍조] 후… 아직… 다리 힘이 안 들어오네요.",
            "[홍조] …조금만 더 이렇게 있어 주세요.",
            "[하트, 홍조] 이제… 말할 수 있을 것 같아요. …아니, 아직.",
            "[홍조, 얄미운] …다음엔, 제가 먼저 할지도 몰라요.",
            "[하트] 자꾸 생각나요… 아까 그 느낌.",
            "[홍조] …지금 얼굴 보이면 안 되는데, 늦었죠.",
            "[하트, 홍조] 숨은 돌아왔는데… 마음이 안 진정돼요.",
            "[홍조, 얄미운] …주인님 손, 인제 다 알겠네요.",
            "[하트] 이런 거… 자주 하면 저 먼저 지치는 거 아닐까요.",
            "[홍조] …앉아 있을게요. 잠깐만.",
            "[하트, 홍조] 손, 아직 떼지 마세요… 아니, 떼 주세요…",
            "[홍조, 얄미운] …오늘 일은, 저만 아는 걸로 해 둘게요.",
            "[하트] 심장… 아직도 응원 소리 같아요.",
            "[홍조] …다음에 또 그러실 거죠? 대답 안 하셔도 알아요.",
            "[하트, 홍조] 이제 제 눈 똑바로 못 보세요, 주인님.",
            "[홍조, 얄미운] …손끝, 기억났어요. 이 정도면 됐죠?",
            "[하트] 잠깐… 웃음이 안 멈춰요. 이상하죠.",
            "[홍조] …저 더워요. 창문 좀…",
            "[하트, 홍조] 이제 조금… 진정되었어요. 조금만요.",
            "[홍조, 얄미운] …다음엔 안 봐드릴 거예요. 진짜로."
          ],
          chest_pull: [
            "[홍조, ><] 아흣…?! 그, 그쪽은…!",
            "[홍조, ><] 히잇…! 거기 잡으면… 몸이 이상해져요…!",
            "[홍조, 하트] 으으… 거긴… 예민한 데라고요…",
            "[홍조, ><] 자, 잠깐… 그렇게 당기면… 모양이…!",
            "[홍조, 식은땀] 하앗…! 손… 힘 좀 빼 주세요… 숨이…",
            "[홍조, 하트] 으… 그렇게 만지면… 몸에 힘이 하나도 안 들어가요…",
            "[홍조, ><] 주, 주인님…! 이런 건… 밤에 하세요…!",
            "[홍조, 하트] 하아… 일부러 그러시죠… 재미있으세요…?",
            "[홍조, ><] 엇…! 거기, 위로… 그렇게 끌어올리면…!",
            "[홍조, 식은땀] 으으으… 손대지 마세요… 아니, 놓지도 마시고요…",
            "[홍조, ><] 주인님 손가락… 너무 정확해요… 그런 데까지…",
            "[홍조, 하트] 숨이… 잘 안 쉬어져요… 조금만 천천히…",
            "[홍조, ><] 으앗…! 그렇게 한 번에…!",
            "[홍조, 식은땀] 하앗… 거기, 힘 빼면 안 돼요…",
            "[홍조, ><] 앗… 손이… 손이 떨려서…",
            "[홍조, 하트] 그만… 위로 올리지 마세요…",
            "[홍조, ><] 으으… 이거, 생각보다…!",
            "[홍조, 식은땀] 잠깐… 숨이… 안 쉬어져요…",
            "[홍조, ><] 아… 옷이… 옷이 걸려서…",
            "[홍조, 하트] 주인님… 조금만… 살살요…",
            "[홍조, ><] 으… 거긴 잡는 게 아니에요…",
            "[홍조, 식은땀] 하아… 이러다 진짜…",
            "[홍조, ><] 손가락… 하나씩 다 느껴져요…",
            "[홍조, 하트] 잠깐만… 마음 준비…",
            "[홍조, ><] 아앗… 조금만 천천히…!",
            "[홍조, 식은땀] 으으… 저, 소리 낼 것 같아요…",
            "[홍조, ><] 주인님… 이거, 놀이가 아니죠…?",
            "[홍조, 하트] 그렇게 당기시면… 몸이 따라올라와요…",
            "[홍조, ><] 잠깐… 손이 미끄러져요…!",
            "[홍조, 식은땀] 하… 하아… 조금만 쉬게…",
            "[홍조, ><] 거기… 정말 예민하다니까요…",
            "[홍조, 하트] …계속 이러시면, 저도… 각오할게요."
          ],
          chest_pull_long: [
            "[홍조, 하트] 하아… 아직도… 놓지 않으실 거예요…?",
            "[홍조, ><] 으으… 이러다간… 제가 먼저… 이상해져요…",
            "[홍조, 하트] 잠깐… 그만… 몸에 힘이 풀려서… 녹아내릴 것 같아요…",
            "[홍조, 식은땀] 하앗… 손 떼 주세요… 이러다… 소리 낼지도 몰라요…",
            "[홍조, 하트] 주인님… 너무해요… 이런 건… 반칙이라고요…",
            "[홍조, ><] 히으… 계속 그러시면… 저… 참을 수 없어요…",
            "[홍조, 하트] 으… 머리가… 하얘져서… 아무것도 안 보여요…",
            "[홍조, 얄미운] 하아… 이렇게까지 하실 거면서… 놀리기만 하시고…",
            "[홍조, 하트] 하아… 이거… 언제까지 하실 거예요…?",
            "[홍조, ><] 저… 이미… 참는 게 한계예요…",
            "[홍조, 하트] 제발… 조금만… 아니, 조금만 더…",
            "[홍조, ><] 주인님… 이러다 제가 먼저 손을… 아니에요, 아무것도 아니에요…",
            "[홍조, 하트] 하아… 아직… 계속하시는 거예요…?",
            "[홍조, ><] 으응… 이제… 어지러워요… 기분 좋게…",
            "[홍조, 하트] 잠깐… 저… 지금 제 목소리 이상하죠…",
            "[홍조, 식은땀] 하앗… 손가락 힘… 조금만 빼 주세요…",
            "[홍조, ><] 으으… 이러다간… 진짜 소리 질러요…",
            "[홍조, 하트] 주인님… 저… 이상해요… 몸이…",
            "[홍조, ><] 히으… 머리가… 자꾸 새하얘져요…",
            "[홍조, 식은땀] 잠깐만… 이대로면… 제가 먼저 손을 뻗어요…",
            "[홍조, 하트] 흔들지 마세요… 그럼… 더…",
            "[홍조, ><] 으… 그만… 아니, 아직…",
            "[홍조, 하트] 하아… 이제 정말… 한계에 가까워요…",
            "[홍조, ><] 주인님… 이러다 저… 참지 못해요…",
            "[홍조, 식은땀] 손… 손을… 놓을 수가 없잖아요…",
            "[홍조, 하트] 하앗… 이거… 오래 하시면 저… 녹아요…",
            "[홍조, ><] 으으… 숨… 숨이 안 나와요…",
            "[홍조, 하트] 이제… 조금만 더하면… 저…",
            "[홍조, ><] 잠깐… 눈물 날 것 같아요… 이상하게…",
            "[홍조, 식은땀] 하아… 주인님… 이거… 정말 반칙이에요…",
            "[홍조, 하트] …계속 이러시면, 오늘 밤 못 자요…",
            "[홍조, ><] 으… 이제… 그만… 정말로 그만…"
          ],
          chest_pull_dizzy: [
            "[어지럼, 홍조] 으으… 자꾸 흔들면… 어지러워요…",
            "[어지럼, 홍조] 잠깐… 세상이… 빙글빙글 돌아요…",
            "[어지럼, 하트] 아이… 머리가 핑 돌아서… 못 서겠어요…",
            "[어지럼, 식은땀] 하아… 그만… 눈앞이 흔들려요…",
            "[어지럼, 홍조] 으… 어지러워서… 잠깐만 기대도 돼요…?"
          ],
          chest_drop: [
            "[홍조, ><] 꺅!",
            "[홍조, 눈물] 꺅…! 이, 이건 반칙이에요…!",
            "[홍조, 하트] 하아… 갑자기 놓으면… 몸이 아직… 어지러워요…",
            "[홍조, 식은땀] 아… 아직… 감각이 안 돌아와요…",
            "[홍조, ><] 으으… 다리 힘이… 풀려 버렸잖아요…",
            "[홍조, 하트] 잠깐만… 심장이 너무 뛰어서… 숨 좀 돌릴게요…",
            "[홍조, 눈물] 부, 부끄러워서… 얼굴을 못 들겠어요…",
            "[홍조, 얄미운] …이번엔 봐드린 거예요… 다음엔… 각오하세요…",
            "[홍조, 하트] 아… 아직 거기… 감각이 남아 있어요…",
            "[홍조, 식은땀] 이 상태로 일어나면… 다리에 힘이 안 들어가요…",
            "[홍조, ><] 주인님… 이거… 책임지실 거죠…?",
            "[홍조, 눈물] 하아… 창피해서 어디 숨고 싶어요…",
            "[홍조, ><] 하앗…!",
            "[홍조, 눈물] 아… 아직… 아직 거기…",
            "[홍조, 하트] 으으… 갑자기 놓으면… 몸이 휘청…",
            "[홍조, 식은땀] 하아… 다리에 힘 안 들어가요…",
            "[홍조, ><] 잠깐… 숨… 돌릴 시간…",
            "[홍조, 하트] 주인님… 손 좀… 놓지 마세요…",
            "[홍조, 눈물] 이제… 이제 된 거예요…?",
            "[홍조, ><] 으으… 아직… 여운이…",
            "[홍조, 식은땀] 하아… 이러면… 일할 수가 없어요…",
            "[홍조, 하트] 잠깐만… 마음이… 안 정리돼요…",
            "[홍조, ><] 아… 아직 감각이… 남아 있어요…",
            "[홍조, 눈물] 부끄러워… 부끄러워요…",
            "[홍조, 식은땀] 이제… 제 얼굴… 다 보였죠…?",
            "[홍조, 하트] 놓고 나니까… 더… 이상해요…",
            "[홍조, ><] 으으… 다리… 풀렸어요…",
            "[홍조, 눈물] 주인님… 이거… 저만 아는 거예요…",
            "[홍조, 식은땀] 하아… 물 좀… 마실 수 있게…",
            "[홍조, ><] 잠깐… 그 자리에… 서 있을게요…",
            "[홍조, 하트] …이번엔, 제가 진 거네요…",
            "[홍조, 눈물] …다음엔, 조용한 데서 해요… 제발요…"
          ],
          lower1: [
            "[홍조, 식은땀] 거, 거기는… 치마는 안 돼요…!",
            "[홍조, 식은땀] 거기 만지면… 정말 화낼 거예요…!",
            "[홍조, ><] 으… 치마 자락… 놓아 주세요…!",
            "[홍조, 식은땀] 거긴… 스스로도 함부로 안 만지는 데예요…",
            "[홍조, ><] 주인님… 그 손, 지금 위험한 거 아세요…?"
          ],
          lower2: [
            "[홍조, ><] 진짜… 이러시면 오늘 밤은 안 자요…!",
            "[홍조, ><] 그만해 주세요… 제발…!",
            "[홍조, 식은땀] 으으… 이러다 진짜 소리 질러요…!",
            "[홍조, ><] 한 번만 더 하시면… 정말로 삐질 거예요…",
            "[홍조, 눈물] 주인님… 지금 표정… 무서워요… 아니, 좋아요…"
          ],
          lower3: [
            "[><, 식은땀] 히익…!",
            "[><, 눈물] 으아…! 이제 진짜…!",
            "[><, 식은땀] 잠깐…! 거기… 진짜 안 돼요…!"
          ],
          lower_after: [
            "[홍조, 눈물] …다시는 그러지 마세요. 진짜예요.",
            "[홍조, 눈물] 흥… 이번만 봐준 거예요.",
            "[홍조] …나중에, 조용한 데서 다시 얘기해요.",
            "[홍조, 얄미운] 이번 일은… 둘만 아는 걸로 해요.",
            "[홍조, 눈물] 흥… 이제 저 멀리 가 있을 거예요."
          ],
          spam: [
            "[어두운, 얄미운] …그만 좀 눌러요. 반응 다 보이잖아요.",
            "[어두운, 얄미운] …주인님, 손가락이 너무 성실하시네요.",
            "[어두운, 얄미운] …부탁인데, 잠깐만 쉬어 주세요."
          ],
          makeup: [
            "[홍조] …이제 안 누르실 거죠? 약속하세요.",
            "[홍조] …이번엔 넘어갈게요. 대신 기억해 둘게요.",
            "[홍조] …이제 진정하셨어요? 저는 아직인데."
          ],
          working: [
            "[식은땀] 지금 일하는 중이에요~ …나중에 하세요, 나중에♪",
            "[식은땀] 잠깐만요… 지금 집중해야 하는데… 손이 자꾸…",
            "[식은땀] 일 끝나면… 그때 만져 주세요. 약속하시고요.",
            "[식은땀] 으… 지금 그러시면 작업이 안 끝나요…"
          ],
          sleep_out: [
            "잠깐 쉬고 올게요~ …그리워하시면 금방 와요♪",
            "절전 모드 들어갑니다~ 불러 주시면 바로요!",
            "좀 쉬었다 올게요, 주인님♪ …꿈에서 봬요.",
            "눈 좀 붙이고 올게요. …몰래 보고 계시면 안 돼요.",
            "충전하러 갑니다~ 다녀오면 안아 주세요."
          ],
          sleep_back: [
            "다녀왔어요! …보고 싶으셨죠?",
            "돌아왔어요! 기다리게 해서 죄송해요♪",
            "[하트] 부르셨죠? …이리 와요.",
            "푹 잤더니… 얼굴이 좋아 보이세요, 주인님.",
            "[홍조] 자는 동안… 계속 곁에 있으셨어요?"
          ]
        };
        const EXP_NAME = { "홍조": "blush", "><": "squint", "하트": "heart", "얄미운": "smug", "식은땀": "sweat", "어두운": "dark", "눈물": "tears", "어지럼": "dizzy" };
        const lastLine = {};
        const speak = (key, ms = 3500) => {
          const list = LINES[key];
          if (!list) return;
          const candidates = [];
          for (let i = 0; i < list.length; i++) {
            if (list.length > 1 && i === lastLine[key]) continue;
            const raw = list[i], tagMatch = raw.match(/^\[([^\]]+)\]\s*/);
            const text2 = tagMatch ? raw.slice(tagMatch[0].length) : raw;
            if (text2 === lastSayText) continue;
            candidates.push({ i, text: text2, exp: tagMatch ? tagMatch[1] : "" });
          }
          if (!candidates.length) return;
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          lastLine[key] = pick.i;
          for (const n of pick.exp.split(",")) {
            const e = EXP_NAME[n.trim()];
            if (e) flashExp(e, ms);
          }
          const text = pick.text;
          say(text, ms);
        };
        outfitTalk = (key) => {
          if (fleeX === 0 && performance.now() >= sulkUntil) speak(key, 4e3);
        };
        const drawables = cubismModel.drawables, parts = cubismModel.parts;
        const drawRegion = Array.from({ length: drawables.count }, (_, i) => {
          for (let part = drawables.parentPartIndices[i]; part >= 0; part = parts.parentIndices[part]) if (PART_REGIONS[parts.ids[part]]) return PART_REGIONS[parts.ids[part]];
          return null;
        });
        const chestDraw = [];
        for (let i = 0; i < drawables.count; i++) for (let part = drawables.parentPartIndices[i]; part >= 0; part = parts.parentIndices[part]) if (PARTS.chestCenter.includes(parts.ids[part])) {
          chestDraw.push(i);
          break;
        }
        const chestCenter = () => {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const i of chestDraw) {
            if (drawables.opacities[i] < 0.05) continue;
            const vertices = internalModel.getDrawableVertices(i);
            for (let j = 0; j < vertices.length; j += 2) {
              x0 = Math.min(x0, vertices[j]);
              x1 = Math.max(x1, vertices[j]);
              y0 = Math.min(y0, vertices[j + 1]);
              y1 = Math.max(y1, vertices[j + 1]);
            }
          }
          return x0 === Infinity ? null : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
        };
        const chestBase = chestCenter();
        const bodyBounds = { minX, minY, w: maxX - minX, h: maxY - minY };
        const ALPHA_SIZE = 512;
        let alphaMaps = null;
        const buildAlpha = () => {
          alphaMaps = model.textures.map((t) => {
            try {
              const alphaCanvas = life.own(document.createElement("canvas"), (node) => node.remove());
              alphaCanvas.width = alphaCanvas.height = ALPHA_SIZE;
              const ctx = alphaCanvas.getContext("2d", { willReadFrequently: true });
              ctx.drawImage(t.baseTexture.resource.source, 0, 0, ALPHA_SIZE, ALPHA_SIZE);
              const pixels = ctx.getImageData(0, 0, ALPHA_SIZE, ALPHA_SIZE).data, alpha = new Uint8Array(ALPHA_SIZE * ALPHA_SIZE);
              for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
              return alpha;
            } catch {
              return null;
            }
          });
        };
        const alphaAt = (textureIndex, u, v) => {
          const alphaMap = alphaMaps[textureIndex];
          if (!alphaMap) return 255;
          return alphaMap[Math.min(ALPHA_SIZE - 1, Math.max(0, Math.floor((1 - v) * ALPHA_SIZE))) * ALPHA_SIZE + Math.min(ALPHA_SIZE - 1, Math.max(0, Math.floor(u * ALPHA_SIZE)))];
        };
        const touchable = (i) => earSet.has(i) ? earHitVisible(i) : !(drawables.opacities[i] < 0.05 || !(drawables.dynamicFlags[i] & 1));
        const pickDrawable = (x, y) => {
          if (!alphaMaps) buildAlpha();
          const px = (x - model.x) / model.scale.x, py = (y - model.y) / model.scale.y;
          let best = -1, bestOrder = -Infinity;
          for (let i = 0; i < drawables.count; i++) {
            if (!touchable(i)) continue;
            const order = drawables.renderOrders[i];
            if (order <= bestOrder) continue;
            const vertices = internalModel.getDrawableVertices(i);
            const [x0, y0, x1, y1] = meshBounds(vertices);
            if (px < x0 || px > x1 || py < y0 || py > y1) continue;
            if (meshHit(vertices, drawables.indices[i], drawables.vertexUvs[i], px, py, (u, v) => alphaAt(drawables.textureIndices[i], u, v))) {
              best = i;
              bestOrder = order;
            }
          }
          return best;
        };
        const chibiRegion = (y) => {
          let y0 = Infinity, y1 = -Infinity;
          for (let i = 0; i < drawables.count; i++) {
            if (drawables.opacities[i] < 0.05) continue;
            const vertices = internalModel.getDrawableVertices(i);
            for (let j = 1; j < vertices.length; j += 2) {
              if (vertices[j] < y0) y0 = vertices[j];
              if (vertices[j] > y1) y1 = vertices[j];
            }
          }
          return ((y - model.y) / model.scale.y - y0) / (y1 - y0) < GEOMETRY.chibiHeadBottom ? "head" : "body";
        };
        const regionByShape = (region, ratioY, inChest) => {
          if (region === "head" && ratioY > GEOMETRY.headBottom) region = null;
          if (region === "arm" && cover.q > 0.3 && ratioY < GEOMETRY.coverArmBottom) return "chest";
          if (region === "arm" || region === "leg" || region === "head") return region;
          if (inChest) return "chest";
          if (region === "lower") return "lower";
          if (region === "waist") return ratioY > GEOMETRY.chestBottom ? "lower" : "chest";
          if (region === null && ratioY < GEOMETRY.headBottom) return "head";
          return ratioY < GEOMETRY.chestBottom ? "chest" : "body";
        };
        const touchRegion = (x, y, drawable) => {
          if (bodyWeight > 0.5) return chibiRegion(y);
          const scale = model.scale.x, currentChest = chestCenter();
          const shiftX = currentChest && chestBase ? currentChest.x - chestBase.x : 0, shiftY = currentChest && chestBase ? currentChest.y - chestBase.y : 0;
          const ratioX = (x - model.x - (bodyBounds.minX + shiftX) * scale) / (bodyBounds.w * scale);
          const ratioY = (y - model.y - (bodyBounds.minY + shiftY) * scale) / (bodyBounds.h * scale);
          const inChest = Math.pow((ratioX - GEOMETRY.chestCenterX) / GEOMETRY.chestRadiusX, 2) + Math.pow((ratioY - GEOMETRY.chestCenterY) / GEOMETRY.chestRadiusY, 2) <= 1;
          return regionByShape(drawRegion[drawable], ratioY, inChest);
        };
        const UI_HIT = 'button, a[href], input, textarea, select, summary, [contenteditable="true"], [class*="composerSeat"] [class*="_card"]';
        const hitAt = (cx, cy) => {
          if (canvas.style.display === "none" || fleeX !== 0) return null;
          const rect = canvas.getBoundingClientRect();
          if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) return null;
          if (document.elementFromPoint(cx, cy)?.closest(UI_HIT)) return null;
          const x = (cx - rect.left) / curK, y = (cy - rect.top) / curK;
          const drawable = pickDrawable(x, y);
          return drawable >= 0 ? [x, y, drawable] : null;
        };
        let clicks = [], headClicks = [], spamAt = -1e9, inputLockedUntil = 0;
        const shy = { count: 0, last: -1e9, cooldownUntil: 0 }, low = { count: 0, last: -1e9, cooldownUntil: 0 };
        const onChest = (now) => {
          if (now < shy.cooldownUntil || now - shy.last < 180) return;
          if (now - shy.last > 8e3) shy.count = 0;
          shy.last = now;
          shy.count++;
          if (shy.count <= 4) {
            if (now < touchLeanUntil || Math.random() < 0.16) touchLeanUntil = now + 3e3;
            speak(shy.count <= 1 ? "chest1" : "chest2", 4e3);
            if (shy.count >= 2) happyMouthUntil = now + 4e3;
            if (shy.count >= 3) coverChest(2600);
          } else {
            touchLeanUntil = 0;
            shy.count = 0;
            shy.cooldownUntil = inputLockedUntil = now + 6e3;
            shiverStarted = now;
            speak("chest3", 3e3);
            happyMouthUntil = now + 6e3;
            coverChest(6e3);
            setTimeout(() => speak("chest_calm", 2800), 3e3);
          }
        };
        const nearSide = () => {
          const areaRect = area(), centerX = shown.x - fleeX + W * curK / 2;
          return centerX - areaRect.l < areaRect.r - centerX ? -1 : 1;
        };
        const outDistance = (dir) => {
          const areaRect = area(), x = shown.x - fleeX;
          return dir < 0 ? -(x + W * curK - areaRect.l + 20) : areaRect.r - x + 20;
        };
        const FLEE_DIST = 300, FLEE_OUT_MS = 700, FLEE_IN_MS = 900, FLEE_HIDE_MS = 1e4;
        let fleeFade = 1;
        const fleeSlide = (from, to, ms, done) => {
          const startedAt = performance.now();
          const step = () => {
            const progress = Math.min(1, (performance.now() - startedAt) / ms), e = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            fleeX = from + (to - from) * e;
            if (progress < 1) requestAnimationFrame(step);
            else done && done();
          };
          requestAnimationFrame(step);
        };
        const flee = () => {
          if (drag.pending || drag.on || link.open || link.follow) return;
          hush();
          if (!PET) {
            const off = outDistance(nearSide());
            fleeSlide(Math.sign(off) * 0.01, off, 700, () => setTimeout(() => fleeSlide(off, 0, 1100, () => {
              fleeX = 0;
              setTimeout(() => speak("lower_after", 4e3), 400);
            }), 1e4));
            return;
          }
          const dist = nearSide() * Math.max(FLEE_DIST, W * curK * 0.5);
          const finish = () => {
            fleeX = 0;
            fleeFade = 1;
            canvas.style.opacity = "";
            setTimeout(() => speak("lower_after", 4e3), 400);
          };
          const runIn = () => {
            const inStartedAt = performance.now();
            const step = () => {
              if (drag.pending || drag.on) return finish();
              const progress = Math.min(1, (performance.now() - inStartedAt) / FLEE_IN_MS);
              fleeX = dist * (1 - progress * progress * (3 - 2 * progress));
              fleeFade = progress * progress * (3 - 2 * progress);
              canvas.style.opacity = String(Math.min(1, fleeFade));
              if (progress < 1) requestAnimationFrame(step);
              else finish();
            };
            requestAnimationFrame(step);
          };
          const outStartedAt = performance.now();
          const runOut = () => {
            const progress = Math.min(1, (performance.now() - outStartedAt) / FLEE_OUT_MS);
            fleeX = dist * (1 - Math.pow(1 - progress, 3));
            fleeFade = Math.max(0, 1 - Math.pow(progress, 1.5));
            canvas.style.opacity = String(fleeFade);
            if (progress < 1) requestAnimationFrame(runOut);
            else setTimeout(runIn, FLEE_HIDE_MS);
          };
          requestAnimationFrame(runOut);
        };
        const WALK_SPEED = 320;
        const walkEase = (progress) => {
          const ramp = 0.12, rampNorm = 2 * ramp * (1 - ramp);
          return progress < ramp ? progress * progress / rampNorm : progress > 1 - ramp ? 1 - (1 - progress) * (1 - progress) / rampNorm : (progress - ramp / 2) / (1 - ramp);
        };
        const walkLater = (fn, ms) => {
          const id = setTimeout(() => {
            walk.timers = walk.timers.filter((t) => t !== id);
            fn();
          }, ms);
          walk.timers.push(id);
          return id;
        };
        const updateWalkAlpha = (from) => {
          if (!PET) return;
          if (walk.plan && walk.phase === "out") walk.alpha = walkOutAlpha(Math.abs(fleeX - from), walk.plan.run, walk.plan.fade);
          else if (walk.phase === "in" && walk.returnFade > 0) walk.alpha = walkInAlpha(Math.abs(fleeX - from), walk.returnFade);
        };
        const slide = (from, to, done) => {
          let startedAt = performance.now(), started = !(PET && walk.phase === "in");
          const ms = Math.abs(to - from) / WALK_SPEED * 1e3, id = ++walk.slideId;
          let cancelled = false;
          const step = () => {
            if (cancelled || id !== walk.slideId) return;
            if (!started) {
              startedAt = performance.now();
              started = true;
            }
            const progress = ms ? Math.min(1, (performance.now() - startedAt) / ms) : 1;
            const eased = PET && walk.phase === "out" ? walkEasePetOut(progress) : walkEase(progress);
            fleeX = from + (to - from) * eased;
            updateWalkAlpha(from);
            if (progress < 1) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
          return () => {
            cancelled = true;
          };
        };
        const clearWalkVisual = () => {
          clearTimeout(walk.recoverTimer);
          walk.recoverTimer = 0;
          walk.plan = null;
          walk.area = null;
          walk.base = null;
          walk.displayId = "";
          walk.displayRequest = 0;
          walk.alpha = 1;
          walk.returnFade = 0;
          walk.safeHold = false;
          walk.faceDir = null;
          walk.recover = null;
          if (walk.opacityApplied) {
            canvas.style.opacity = "";
            walk.opacityApplied = false;
          }
          lastPlaceKey = "";
        };
        const cancelWalk = () => {
          if (walk.phase !== "ready") return;
          for (const t of walk.timers) clearTimeout(t);
          walk.timers = [];
          walk.slideId++;
          walk.phase = "";
          walk.dir = -1;
          clearWalkVisual();
        };
        const startRecoverFade = () => {
          if (walk.phase !== "recover" || !walk.recover) return;
          walk.recover = null;
          clearTimeout(walk.recoverTimer);
          walk.recoverTimer = 0;
          const startedAt = performance.now(), ms = 520;
          const step = () => {
            if (walk.phase !== "recover") return;
            const progress = Math.min(1, (performance.now() - startedAt) / ms);
            walk.alpha = progress * progress * (3 - 2 * progress);
            if (progress < 1) requestAnimationFrame(step);
            else {
              walk.phase = "";
              walk.alpha = 1;
              walk.opacityApplied = false;
              canvas.style.opacity = "";
              walk.faceDir = null;
              walk.safeHold = true;
              lastPlaceKey = "";
            }
          };
          requestAnimationFrame(step);
        };
        const confirmRecoverBounds = () => {
          if (walk.phase !== "recover" || !walk.recover || !petBounds) return;
          const target = walk.recover;
          if (Math.abs(petBounds.x - target.x) <= 2 && Math.abs(petBounds.y - target.y) <= 2 && Math.abs(petBounds.width - target.width) <= 2 && Math.abs(petBounds.height - target.height) <= 2) startRecoverFade();
        };
        const recoverWalk = (area2) => {
          if (!PET) return;
          for (const t of walk.timers) clearTimeout(t);
          clearTimeout(walk.recoverTimer);
          walk.timers = [];
          walk.slideId++;
          walk.plan = null;
          walk.base = null;
          walk.returnFade = 0;
          walk.recover = null;
          walk.safeHold = false;
          const baseX = shown.x - fleeX, baseY2 = shown.y, k = Number.isFinite(shown.k) && shown.k > 0 ? shown.k : free.k || 1;
          fleeX = 0;
          walk.phase = "recover";
          walk.alpha = 0;
          walk.opacityApplied = true;
          canvas.style.opacity = "0";
          lastPlaceKey = "";
          walk.area = walkAreaValid(area2) ? area2 : null;
          if (!walk.area) return;
          const safe = walkSafePose({ area: walk.area, x: baseX, y: baseY2, k, canvasW: W, canvasH: H, bodyW: visW * k });
          free.anim = null;
          free.on = true;
          free.x = safe.x;
          free.y = safe.y;
          free.k = safe.k;
          free.applied = true;
          const cx = (innerWidth - W * safe.k) / 2, cy = innerHeight - H * safe.k;
          walk.recover = { x: Math.round(safe.x - cx), y: Math.round(safe.y - cy), width: innerWidth, height: innerHeight };
          try {
            place();
          } catch (error) {
            log.debug("산책 복구 배치 실패:", error);
          }
          walk.recoverTimer = setTimeout(() => {
            if (walk.phase === "recover") startRecoverFade();
          }, 1200);
        };
        const recordPetDisplay = (display, area2, request) => {
          petDisplay.id = display.id != null ? String(display.id) : "";
          petDisplay.area = area2;
          petDisplay.scaleFactor = Number(display.scaleFactor) || 0;
          petDisplay.at = performance.now();
          const answer = Number.isFinite(request) ? request : display.request;
          if (Number.isFinite(answer)) petDisplay.answered = Math.max(petDisplay.answered, answer);
        };
        const departureDisplay = (list) => list && walk.displayId ? list.find((item) => String(item.id) === walk.displayId) : null;
        const holdSafeArea = (area2, changed, fixedArea) => {
          if (!changed) {
            walk.area = fixedArea || area2;
            return;
          }
          if (fixedArea) {
            if (!sameWalkArea(fixedArea, walk.area)) recoverWalk(fixedArea);
            return;
          }
          walk.displayId = petDisplay.id;
          recoverWalk(area2);
        };
        const followWalkDisplay = (area2, list, fixedArea) => {
          if (fixedArea) {
            if (!sameWalkArea(fixedArea, walk.area)) recoverWalk(fixedArea);
            return;
          }
          const removed = !!list && !!walk.displayId;
          const legacyMoved = !!walk.displayId && petDisplay.id !== walk.displayId;
          if (removed || legacyMoved) {
            walk.displayId = petDisplay.id;
            recoverWalk(area2);
            return;
          }
          if (!sameWalkArea(area2, walk.area)) recoverWalk(area2);
        };
        const walkDisplayChange = (area2, changed, list, fixedArea) => {
          if (walk.phase === "recover") recoverWalk(fixedArea || area2);
          else if (walk.safeHold) holdSafeArea(area2, changed, fixedArea);
          else if (changed && walk.phase && walk.phase !== "ready") followWalkDisplay(area2, list, fixedArea);
        };
        const applyPetDisplay = (display, changed, request, displays) => {
          const area2 = walkDisplayArea(display);
          if (!area2) return;
          recordPetDisplay(display, area2, request);
          if (!PET) return;
          const list = Array.isArray(displays) ? displays : null;
          if (list) petDisplay.displays = list;
          const fixed = departureDisplay(list);
          walkDisplayChange(area2, changed, list, fixed ? walkDisplayArea(fixed) : null);
        };
        const walkBack = () => {
          if (walk.phase !== "away") return;
          for (const t of walk.timers) clearTimeout(t);
          walk.timers = [];
          if (PET) {
            petWalkBack();
            return;
          }
          walk.phase = "in";
          walk.dir = 1;
          slide(outDistance(1), 0, () => {
            fleeX = 0;
            walk.phase = "";
            walkLater(() => {
              if (!walk.phase) speak("walk_back", 3500);
            }, 450);
          });
        };
        const departureDisplayGone = () => {
          const removed = !!(petDisplay.displays && walk.displayId && !departureDisplay(petDisplay.displays));
          const legacyMoved = !petDisplay.displays && !!(walk.displayId && petDisplay.id && petDisplay.id !== walk.displayId);
          return removed || legacyMoved;
        };
        const finishPetWalkBack = () => {
          fleeX = 0;
          walk.phase = "";
          walk.alpha = 1;
          walk.opacityApplied = false;
          canvas.style.opacity = "";
          walk.plan = null;
          walk.area = null;
          walk.base = null;
          walk.displayId = "";
          walk.returnFade = 0;
          walk.faceDir = null;
          lastPlaceKey = "";
          walkLater(() => {
            if (!walk.phase) speak("walk_back", 3500);
          }, 450);
        };
        const petWalkBack = () => {
          const area2 = walkAreaValid(walk.area) ? walk.area : walkAreaValid(petDisplay.area) ? petDisplay.area : null;
          if (!area2 || departureDisplayGone()) {
            recoverWalk(area2);
            return;
          }
          walk.area = area2;
          walk.phase = "in";
          const dir = walk.plan ? walk.plan.dir : walk.dir;
          walk.dir = dir;
          walk.faceDir = dir;
          const k = Number.isFinite(shown.k) && shown.k > 0 ? shown.k : curK;
          const plan = planWalkReturn({ area: area2, dir, x: shown.x - fleeX, k, canvasW: W, bodyW: WALK_BODY_WIDTH * k });
          walk.returnFade = plan.fade;
          walk.alpha = 0;
          walk.opacityApplied = true;
          canvas.style.opacity = "0";
          lastPlaceKey = "";
          fleeX = plan.from;
          try {
            place();
          } catch (error) {
            log.debug("산책 복귀 배치 실패:", error);
          }
          slide(plan.from, 0, finishPetWalkBack);
        };
        const startWalk = () => {
          if (SLEEP.state !== "active") return;
          if (PET && petPanelOpen) return;
          walk.phase = "ready";
          walk.dir = -1;
          walk.faceDir = null;
          walk.plan = null;
          walk.area = null;
          walk.base = null;
          walk.displayId = "";
          walk.alpha = 1;
          walk.returnFade = 0;
          walk.safeHold = false;
          walk.recover = null;
          if (PET) walk.displayRequest = requestPetDisplay() ?? 0;
          speak("walk_out", 2200);
          walkLater(() => {
            walk.phase = "out";
            hush();
            walkLater(() => {
              if (PET) {
                petWalkDepart();
                return;
              }
              walk.out = outDistance(walk.dir);
              slide(0, walk.out, () => {
                walk.phase = "away";
                walkLater(walkBack, 8e3 + Math.random() * 6e3);
              });
            }, 700);
          }, 2300);
        };
        const homeInsideArea = (area2, x, y, k) => {
          const home = walkBodySpan({ x, k, canvasW: W, bodyW: visW * k });
          return home.l >= area2.l - 12 && home.r <= area2.r + 12 && y + H * k * 0.05 >= area2.t - 12 && y + H * k <= area2.b + 12;
        };
        const departureWorkArea = () => {
          const fresh = walk.displayRequest > 0 && petDisplay.answered >= walk.displayRequest && petDisplay.at > 0 && performance.now() - petDisplay.at < 5e3;
          return fresh && walkAreaValid(petDisplay.area) ? petDisplay.area : null;
        };
        const petWalkDepart = () => {
          if (petPanelOpen) {
            walk.phase = "";
            walk.dir = -1;
            clearWalkVisual();
            return;
          }
          const area2 = departureWorkArea();
          if (!area2) {
            walk.phase = "";
            walk.dir = -1;
            clearWalkVisual();
            return;
          }
          const x = shown.x, y = shown.y, k = Number.isFinite(shown.k) && shown.k > 0 ? shown.k : curK;
          if (!homeInsideArea(area2, x, y, k)) {
            recoverWalk(area2);
            return;
          }
          const plan = planWalkOut({ area: area2, x, k, canvasW: W, bodyW: WALK_BODY_WIDTH * k, speed: WALK_SPEED });
          walk.plan = plan;
          walk.area = area2;
          walk.base = { k, x, y };
          walk.displayId = petDisplay.id || "";
          walk.dir = plan.dir;
          walk.out = plan.travel * plan.dir;
          walk.alpha = 1;
          walk.opacityApplied = false;
          lastPlaceKey = "";
          slide(0, walk.out, () => {
            walk.phase = "away";
            walk.alpha = 0;
            walk.opacityApplied = true;
            canvas.style.opacity = "0";
            walkLater(walkBack, 8e3 + Math.random() * 6e3);
          });
        };
        const walkMoodBusy = (now) => intro.phase !== "done" || mood !== "idle" || running || !!waitingKind || now < sulkUntil || now < inputLockedUntil || fleeX !== 0;
        const walkInputBusy = () => !!(drag.pending || drag.on || free.anim || link.open || link.opening || link.follow);
        const walkRecentlyActive = (now) => bubble.classList.contains("show") || now - walk.lastTouch < 6e4 || now - lastSayAt < 15e3 || document.hidden;
        walkCheck = (now) => {
          if (SLEEP.state !== "active") return;
          if (walk.phase === "away" && running) return walkBack();
          if (walk.phase || now < walk.next) return;
          walk.next = now + 3e4;
          if (walkMoodBusy(now) || walkInputBusy() || walkRecentlyActive(now)) return;
          walk.next = now + (240 + Math.random() * 240) * 1e3;
          startWalk();
        };
        const SLEEP = { enabled: true, minutes: 1, lastActive: performance.now(), state: "active" };
        let sleepTimer = 0, cancelSleepSlide = null;
        const SLEEP_OFF = () => innerWidth - (canvas.getBoundingClientRect().left - fleeX) + 40;
        const startWake = () => {
          if (SLEEP.state !== "asleep" && SLEEP.state !== "leaving") return;
          clearTimeout(sleepTimer);
          sleepTimer = 0;
          cancelSleepSlide?.();
          cancelSleepSlide = null;
          if (link.open || link.follow?.shown) {
            SLEEP.state = "active";
            fleeX = 0;
            return;
          }
          hush();
          SLEEP.state = "waking";
          setRender(true);
          place();
          slide(fleeX, 0, () => {
            fleeX = 0;
            SLEEP.state = "active";
            SLEEP.lastActive = performance.now();
            if (!running && !waitingKind) speak("sleep_back", 3500);
          });
        };
        const sleepActivity = () => {
          if (hidden) return;
          SLEEP.lastActive = performance.now();
          startWake();
        };
        for (const t of PET ? [] : ["pointerdown", "pointermove", "mousedown", "keydown", "wheel", "touchstart"]) addEventListener(t, sleepActivity, { passive: true, capture: true });
        const sleepGo = () => {
          if (hidden || PET || drag.on || drag.pending || free.anim || SLEEP.state !== "active" || intro.phase !== "done" || fleeX !== 0 || walk.phase) return;
          if (link.open || link.follow?.shown) {
            SLEEP.lastActive = performance.now();
            return;
          }
          SLEEP.state = "leaving";
          speak("sleep_out", 2600);
          sleepTimer = setTimeout(() => {
            sleepTimer = 0;
            if (SLEEP.state !== "leaving") return;
            hush();
            cancelSleepSlide = slide(fleeX, SLEEP_OFF(), () => {
              cancelSleepSlide = null;
              SLEEP.state = "asleep";
              canvas.style.display = "none";
              setBubbleDisplay("none");
              setRender(false);
            });
          }, 2500);
        };
        const onLower = (now) => {
          if (fleeX !== 0 || now < low.cooldownUntil || now - low.last < 180) return;
          if (now - low.last > 8e3) low.count = 0;
          low.last = now;
          low.count++;
          if (low.count <= 2) speak("lower1", 4e3);
          else if (low.count <= 4) speak("lower2", 4e3);
          else {
            low.count = 0;
            low.cooldownUntil = now + 14e3;
            shiverStarted = now;
            speak("lower3", 900);
            setTimeout(flee, 900);
          }
        };
        const POT_SVG = '<svg viewBox="0 0 140 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="dscPotBody" x1="0" x2="1"><stop offset="0" stop-color="#7d8794"/><stop offset=".35" stop-color="#e3e8ee"/><stop offset=".6" stop-color="#b8c0ca"/><stop offset="1" stop-color="#6c7580"/></linearGradient></defs><rect x="2" y="34" width="26" height="10" rx="5" fill="#3d434b"/><rect x="112" y="34" width="26" height="10" rx="5" fill="#3d434b"/><path d="M22 30 H118 V78 Q118 96 100 96 H40 Q22 96 22 78 Z" fill="url(#dscPotBody)" stroke="#4b525b" stroke-width="3"/><ellipse cx="70" cy="30" rx="50" ry="10" fill="#d7dde4" stroke="#4b525b" stroke-width="3"/><ellipse cx="70" cy="30" rx="40" ry="6" fill="#59616b"/><path d="M38 48 Q44 70 40 86" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55" fill="none"/></svg>';
        const impactSvg = (guarded) => {
          const points = [];
          for (let i = 0; i < 20; i++) {
            const radius = i % 2 ? 22 : 46, angle = i / 20 * Math.PI * 2 - Math.PI / 2;
            points.push((50 + Math.cos(angle) * radius).toFixed(1) + "," + (50 + Math.sin(angle) * radius).toFixed(1));
          }
          const fill = guarded ? "#f1f5f9" : "#ffe14d", stroke = guarded ? "#64748b" : "#ea580c", core2 = guarded ? "#ffffff" : "#fff7c2";
          let rays = "";
          for (let i = 0; i < 8; i++) {
            const angle = i / 8 * Math.PI * 2 + 0.2, cos = Math.cos(angle), sin = Math.sin(angle);
            rays += `<line x1="${(50 + cos * 50).toFixed(1)}" y1="${(50 + sin * 50).toFixed(1)}" x2="${(50 + cos * 62).toFixed(1)}" y2="${(50 + sin * 62).toFixed(1)}" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>`;
          }
          return `<svg viewBox="-14 -14 128 128" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${rays}<polygon points="${points.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/><circle cx="50" cy="50" r="12" fill="${core2}"/></svg>`;
        };
        let audioCtx = null;
        const impactSound = (guarded) => {
          try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            const audio = audioCtx, t = audio.currentTime, out = audio.createGain();
            out.gain.value = 0.22;
            out.connect(audio.destination);
            const tone = (freq, dur, vol, type = "sine", drop = 1) => {
              const oscillator = audio.createOscillator(), gainNode = audio.createGain();
              oscillator.type = type;
              oscillator.frequency.setValueAtTime(freq, t);
              if (drop !== 1) oscillator.frequency.exponentialRampToValueAtTime(freq * drop, t + dur);
              gainNode.gain.setValueAtTime(vol, t);
              gainNode.gain.exponentialRampToValueAtTime(1e-4, t + dur);
              oscillator.connect(gainNode);
              gainNode.connect(out);
              oscillator.start(t);
              oscillator.stop(t + dur + 0.02);
            };
            const noise2 = (dur, vol, highpassHz) => {
              const noiseBuffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * dur), audio.sampleRate), samples = noiseBuffer.getChannelData(0);
              for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples.length, 3);
              const src = audio.createBufferSource(), filter = audio.createBiquadFilter(), gainNode = audio.createGain();
              src.buffer = noiseBuffer;
              filter.type = "highpass";
              filter.frequency.value = highpassHz;
              gainNode.gain.value = vol;
              src.connect(filter);
              filter.connect(gainNode);
              gainNode.connect(out);
              src.start(t);
            };
            if (guarded) {
              noise2(0.05, 0.7, 2500);
              for (const [freq, dur, vol] of [[640, 1.1, 0.5], [1370, 0.9, 0.35], [2230, 0.7, 0.25], [3150, 0.5, 0.15]]) tone(freq, dur, vol, "sine", 0.995);
            } else {
              noise2(0.07, 0.8, 900);
              tone(190, 0.28, 0.9, "triangle", 0.45);
              tone(470, 0.35, 0.35, "sine", 0.9);
              tone(1130, 0.22, 0.18, "sine", 0.95);
            }
          } catch {
          }
        };
        const potHit = (x, y) => {
          const now = performance.now();
          walk.lastTouch = now;
          clicks = [];
          headClicks = [];
          const guarded = now < basinUntil;
          inputLockedUntil = now + (guarded ? 1200 : 3200);
          const w = Math.max(64, 150 * curK), h = w * 100 / 140;
          const pot = life.own(document.createElement("div"), (node) => node.remove());
          pot.style.cssText = `position:fixed;left:${x - w / 2}px;top:${y - h * 0.9}px;width:${w}px;height:${h}px;z-index:40;pointer-events:none;will-change:transform,opacity`;
          pot.innerHTML = POT_SVG;
          document.body.append(pot);
          const fall = y + h + 20, animMs = 1250;
          const anim = pot.animate([
            { transform: `translateY(${-fall}px) rotate(-14deg)`, offset: 0, easing: "cubic-bezier(.5,0,1,.6)" },
            { transform: "translateY(0) rotate(0deg) scale(1.12,.86)", offset: 0.4, easing: "ease-out" },
            // 쾅
            guarded ? { transform: `translate(${w * 0.45}px,${-h * 1.6}px) rotate(60deg)`, offset: 0.66, easing: "ease-in" } : { transform: `translate(${w * 0.25}px,${-h * 0.6}px) rotate(32deg)`, offset: 0.62, easing: "ease-in" },
            { transform: `translate(${w * 0.7}px,${h * 0.9}px) rotate(85deg)`, opacity: 0, offset: 1 }
          ], { duration: animMs, fill: "forwards" });
          anim.onfinish = () => pot.remove();
          setTimeout(() => {
            const burstSize = Math.max(60, 130 * curK), burst = life.own(document.createElement("div"), (node) => node.remove());
            burst.style.cssText = `position:fixed;left:${x - burstSize / 2}px;top:${y - h * 0.9 - burstSize / 2}px;width:${burstSize}px;height:${burstSize}px;z-index:41;pointer-events:none`;
            burst.innerHTML = impactSvg(guarded);
            document.body.append(burst);
            burst.animate([{ transform: "scale(.2) rotate(-20deg)", opacity: 0 }, { transform: "scale(1.15) rotate(5deg)", opacity: 1, offset: 0.25 }, { transform: "scale(1.3) rotate(10deg)", opacity: 0 }], { duration: 620, fill: "forwards" }).onfinish = () => burst.remove();
            impactSound(guarded);
            if (guarded) {
              play("flinch", 600);
              speak("pot_guard", 3e3);
              return;
            }
            play("bonk", 1100);
            shiverStarted = performance.now();
            speak("pot_hit", 3e3);
            flashExp("dizzy", 2800);
          }, animMs * 0.4);
        };
        const putBasin = () => {
          const now = performance.now();
          walk.lastTouch = now;
          clicks = [];
          headClicks = [];
          basinUntil = now + 1e4;
          speak("basin_on", 3800);
        };
        const HEAD_SULK_AT = 3, SULK_MS = 15e3;
        const sulk = (now) => {
          clicks = [];
          headClicks = [];
          until.dark = until.smug = 0;
          gestureState.name = null;
          sulkStart = now;
          sulkUntil = inputLockedUntil = now + SULK_MS;
          sulkDir = Math.random() < 0.5 ? 1 : -1;
          sulkYaw = sulkRoll = 0;
          sulkPeeks = [0, 1, 2].map((i) => ({ at: 2800 + i * 4e3 + (Math.random() - 0.5) * 1e3, flip: Math.random() < 0.6, done: false }));
          speak("head_sulk", 4e3);
          flashExp("blush", SULK_MS);
          setTimeout(() => {
            stareUntil = performance.now() + 4300;
            speak("head_after", 4e3);
          }, SULK_MS);
        };
        const onTouch = (x, y, drawable) => {
          const now = performance.now();
          if (now < inputLockedUntil) return;
          walk.lastTouch = now;
          const region = touchRegion(x, y, drawable);
          if (region === "chest") {
            clicks = [];
            headClicks = [];
            low.count = 0;
            return onChest(now);
          }
          if (region === "lower") {
            clicks = [];
            headClicks = [];
            shy.count = 0;
            return onLower(now);
          }
          shy.count = 0;
          low.count = 0;
          clicks = clicks.filter((t) => now - t < 3e3);
          clicks.push(now);
          if (clicks.length >= 6) {
            clicks = [];
            headClicks = [];
            spamAt = now;
            return speak("spam", 3e3);
          }
          if (running && Math.random() < 0.5) return speak("working");
          if (region === "head") {
            if (now - spamAt < 1e4) {
              spamAt = -1e9;
              return speak("makeup");
            }
            headClicks = headClicks.filter((t) => now - t < 8e3);
            headClicks.push(now);
            if (headClicks.length >= HEAD_SULK_AT) return sulk(now);
            return speak("head");
          }
          if (region === "arm") return speak("arm");
          if (region === "leg") return speak("leg");
          play("sway", 1600);
          speak("body");
        };
        const POT_MS = 130;
        let swallowClick = false, strokeFrom = null;
        const pointerPoint = (e) => PET ? [e.screenX, e.screenY] : [e.clientX, e.clientY];
        const overBody = (cx, cy) => {
          if (canvas.style.display === "none" || fleeX !== 0) return false;
          const canvasRect = canvas.getBoundingClientRect(), body = bodyRect(canvasRect.left, canvasRect.top, curK);
          return cx >= body.l && cx <= body.r && cy >= body.t && cy <= body.b;
        };
        const overChat = (cx, cy) => {
          if (canvas.style.display === "none") return false;
          const rect = canvas.getBoundingClientRect(), padX = Math.max(6, rect.width * 0.04), padY = Math.max(6, rect.height * 0.04);
          if (cx < rect.left - padX || cx > rect.right + padX || cy < rect.top - padY || cy > rect.bottom + padY) return false;
          return !document.elementFromPoint(cx, cy)?.closest(UI_HIT);
        };
        const walking = () => walk.phase === "out" || walk.phase === "away" || walk.phase === "in";
        const canPullChest = (now) => bodyWeight <= 0.5 && fleeX === 0 && !walk.phase && intro.phase === "done" && !drag.on && !link.opening && now >= sulkUntil;
        const armChestLong = () => {
          clearInterval(chestLongTimer);
          const startedAt = performance.now();
          chestShake.acc = 0;
          chestShake.last = 0;
          chestShake.next = startedAt + 3e3;
          chestLongTimer = setInterval(() => {
            if (!chestDragging) {
              clearInterval(chestLongTimer);
              chestLongTimer = 0;
              return;
            }
            const now = performance.now();
            if (now < chestShake.next) return;
            if (now - chestShake.last > 500 || chestShake.acc < 30) return;
            speak(now - startedAt >= 4e3 ? "chest_pull_dizzy" : "chest_pull_long", 4e3);
            chestShake.acc = 0;
            chestShake.next = now + 3e3;
          }, 300);
        };
        const releaseChest = () => {
          chestFrom = null;
          if (!chestDragging) return;
          chestDragging = false;
          chestTarget = 0;
          chestShiftTarget = 0;
          clearInterval(chestLongTimer);
          const now = performance.now();
          const dropped = Math.max(0, dragLift.x);
          dragLift.v = Math.min(0, dragLift.v) - dropped * 2.5;
          speak("chest_drop", 3500);
          shiverStarted = now;
          coverChest(3e3);
          inputLockedUntil = now + 2500;
          walk.lastTouch = now;
        };
        const armChordGrab = (e, pointerId = e.pointerId) => {
          if (chestDragging) {
            clearInterval(chestLongTimer);
            chestDragging = false;
            chestTarget = 0;
            chestShiftTarget = 0;
          }
          strokeFrom = null;
          chestFrom = null;
          if (!drag.pending) {
            const [px, py] = pointerPoint(e);
            drag.pending = { id: pointerId, sx: px, sy: py, h: null, ox: px - shown.x, oy: py - shown.y };
          }
          chord.valid = true;
          if (PET) PET.press(true);
          try {
            e.preventDefault();
            e.stopPropagation();
          } catch {
          }
          swallowClick = true;
        };
        const rightStart = (e, id = e.pointerId ?? rightPress?.id) => {
          if (PET && petPanelOpen && petPanel && petPanel.contains(e.target)) return null;
          if (walking()) return null;
          if (intro.phase !== "done" || fleeX !== 0 || link.opening) return null;
          const h = hitAt(e.clientX, e.clientY);
          if (!h && !(PET && overBody(e.clientX, e.clientY))) return null;
          return { at: performance.now(), hit: true, id };
        };
        const chordButtonsMoved = (e, now) => {
          const mask = e.buttons & 3, prev = mouseButtons;
          mouseButtons = mask;
          if (mask !== 3 || prev === 3) return false;
          if (prev === 2) {
            if (!rightPress?.hit) return false;
            armChordGrab(e, rightPress.id ?? e.pointerId);
            return true;
          }
          if (prev === 1) {
            if (!chordWithinGrace(chord, 2, mask, now)) return false;
            armChordGrab(e, drag.pending?.id ?? e.pointerId);
            return true;
          }
          return false;
        };
        const rightButtonDown = (e, nowDown) => {
          if (e.button === 2) {
            rightPress = rightStart(e);
            if ((e.buttons & 3) === 3 && rightPress) armChordGrab(e, e.pointerId);
          }
          if (e.buttons & 1 && chordWithinGrace(chord, e.button, e.buttons, nowDown)) armChordGrab(e);
        };
        const armHeadOrChest = (e, h) => {
          const head = !!h && performance.now() >= inputLockedUntil && touchRegion(h[0], h[1], h[2]) === "head";
          if (head) strokeFrom = { x: e.clientX, y: e.clientY, t: performance.now(), h };
          else if (h && canPullChest(performance.now()) && touchRegion(h[0], h[1], h[2]) === "chest") chestFrom = { x: e.clientX, y: e.clientY, id: e.pointerId, h };
          return head;
        };
        const armTouchHold = (e) => {
          clearTimeout(touchHold);
          touchHold = setTimeout(() => {
            if (!drag.pending || drag.pending.id !== e.pointerId || drag.pending.touchStroke) return;
            drag.pending.touchGrab = true;
            strokeFrom = null;
            chestFrom = null;
            if (PET) PET.press(true);
          }, TOUCH.grabMs);
        };
        const preparePetOnPress = () => {
          if (link.supported && link.petState === "none") link.post("warm");
          else if (!PET && link.petState === "shown" && !link.open && !link.follow) link.post("hide");
        };
        life.listen(document, "pointerdown", (e) => {
          if (hidden) return;
          const nowDown = performance.now();
          mouseButtons = e.buttons & 3;
          chord = chordDown(chord, e.button, e.buttons, nowDown);
          if (e.button !== 0) {
            rightButtonDown(e, nowDown);
            return;
          }
          if (chestFrom) {
            e.preventDefault();
            e.stopPropagation();
            swallowClick = true;
            return;
          }
          swallowClick = false;
          strokeFrom = null;
          if (PET && petPanelOpen && petPanel && petPanel.contains(e.target)) return;
          if (walking()) return;
          const h = hitAt(e.clientX, e.clientY);
          if (!h && !(PET && overBody(e.clientX, e.clientY))) return;
          e.preventDefault();
          e.stopPropagation();
          swallowClick = true;
          const head = armHeadOrChest(e, h);
          if (intro.phase !== "done" || fleeX !== 0 || link.opening) {
            if (h && !head) onTouch(h[0], h[1], h[2]);
            return;
          }
          const [px, py] = pointerPoint(e);
          drag.pending = { id: e.pointerId, sx: px, sy: py, h, ox: px - shown.x, oy: py - shown.y };
          chord.valid = true;
          if (e.pointerType === "touch") armTouchHold(e);
          if (PET) PET.press(true);
          preparePetOnPress();
        }, true);
        life.listen(document, "mousedown", (e) => {
          if (hidden) return;
          const now = performance.now();
          if (e.button === 2) {
            if (!(e.buttons & 1)) rightPress = rightStart(e);
            if (e.buttons & 1 && chordWithinGrace(chord, 2, e.buttons, now)) armChordGrab(e, rightPress?.id ?? e.pointerId);
            return;
          }
          if (e.button !== 0) return;
          if (e.buttons & 2 && rightPress?.hit && Number.isFinite(rightPress.id) && !drag.pending && !drag.on) {
            chord = chordDown(chord, 0, e.buttons, now);
            const [px, py] = pointerPoint(e);
            drag.pending = { id: rightPress.id, sx: px, sy: py, h: null, ox: px - shown.x, oy: py - shown.y };
            chord.valid = true;
            if (PET) PET.press(true);
            try {
              e.preventDefault();
              e.stopPropagation();
            } catch {
            }
            swallowClick = true;
          }
        }, true);
        life.listen(document, "mouseup", (e) => {
          if (e.button === 2) rightPress = null;
        }, true);
        const strokeKind = (stroke, e) => {
          const dy = e.clientY - stroke.y, dx = Math.abs(e.clientX - stroke.x);
          if (performance.now() - stroke.t < POT_MS) return dy > 55 && dy > dx * 1.2 ? "pot" : null;
          return dy > 40 && dy > dx * 0.8 ? "basin" : null;
        };
        const dragKeyRaw = () => String(prefs.drag?.key ?? "Alt").trim();
        const dragKeyToken = () => {
          const text = dragKeyRaw().toLowerCase();
          if (!text || text === "none") return "";
          if (text === "alt" || text === "option") return "alt";
          if (text === "ctrl" || text === "control") return "ctrl";
          if (text === "shift") return "shift";
          if (text === "meta" || text === "cmd" || text === "command" || text === "win" || text === "windows") return "meta";
          return text === "space" ? " " : text === "plus" ? "+" : text;
        };
        const pressedKeys = /* @__PURE__ */ new Set();
        const DRAG_MODIFIER_TOKENS = /* @__PURE__ */ new Set(["alt", "ctrl", "shift", "meta"]);
        const relayDragKey = (token, on) => {
          if (PET || !link.open || !token || DRAG_MODIFIER_TOKENS.has(token)) return;
          if (dragKeyToken() !== token) return;
          try {
            link.post("send", { list: [["dragheld", [token, on]]] });
          } catch {
          }
        };
        const rememberKey = (e, on) => {
          const token = String(e && e.key || "").toLowerCase();
          if (!token) return;
          if (on) pressedKeys.add(token);
          else pressedKeys.delete(token);
          relayDragKey(token, on);
        };
        addEventListener("keydown", (e) => rememberKey(e, true));
        addEventListener("keyup", (e) => rememberKey(e, false));
        addEventListener("blur", () => pressedKeys.clear());
        const dragKeyHeld = (e) => {
          if ((e.buttons & 1) !== 1) return false;
          const token = dragKeyToken();
          if (!token) return false;
          if (token === "alt") return !!e.altKey;
          if (token === "ctrl") return !!e.ctrlKey;
          if (token === "shift") return !!e.shiftKey;
          if (token === "meta") return !!e.metaKey;
          return pressedKeys.has(token);
        };
        const TOUCH = { grabMs: 320, movePx: 14, verticalPx: 8 };
        const touchGesture = ({ dx = 0, dy = 0, heldMs = 0, grabMs = TOUCH.grabMs, movePx = TOUCH.movePx, verticalPx = TOUCH.verticalPx }) => {
          if (Math.hypot(dx, dy) > movePx && Math.abs(dx) > Math.abs(dy) * 1.2) return "grab";
          if (Math.abs(dy) > verticalPx || Math.hypot(dx, dy) > movePx) return "stroke";
          return heldMs >= grabMs ? "grab" : "wait";
        };
        const classifyTouchMove = (e) => {
          if (!(e.pointerType === "touch" && drag.pending && !drag.pending.touchGrab && !drag.pending.touchStroke && e.pointerId === drag.pending.id)) return;
          const dx = e.clientX - drag.pending.sx, dy = e.clientY - drag.pending.sy;
          const gesture = touchGesture({ dx, dy });
          if (gesture === "wait") return;
          clearTimeout(touchHold);
          if (gesture === "grab") drag.pending.touchGrab = true;
          else drag.pending.touchStroke = true;
        };
        const chestMove = (e) => {
          const dy = e.clientY - chestFrom.y, dx = e.clientX - chestFrom.x, now = performance.now();
          if (!chestDragging) {
            if (dy < -12 && Math.abs(dy) > Math.abs(dx) && canPullChest(now)) {
              chestDragging = true;
              shy.count = 0;
              headClicks = [];
              clicks = [];
              cover.until = 0;
              drag.pending = null;
              walk.lastTouch = now;
              speak("chest_pull", 3e3);
              armChestLong();
              flashExp("squint", 400);
              flashExp("blush", 400);
            } else if (Math.hypot(dx, dy) >= 6 && !(dy < 0 && Math.abs(dy) > Math.abs(dx))) chestFrom = null;
            else {
              e.preventDefault();
              return true;
            }
          }
          if (!chestDragging) return false;
          const up = Math.max(0, -dy / curK);
          chestTarget = 1 - Math.exp(-up / 85);
          chestShiftTarget = clamp(dx / (curK * 110), -1, 1) * (0.45 + 0.55 * Math.min(1, chestTarget * 1.4));
          const moved = Math.hypot(dx - chestShake.x, dy - chestShake.y);
          chestShake.x = dx;
          chestShake.y = dy;
          if (moved > 1) {
            chestShake.acc += moved;
            chestShake.last = now;
          }
          e.preventDefault();
          e.stopPropagation();
          swallowClick = true;
          return true;
        };
        const strokeMove = (e) => {
          const stroke = strokeFrom, kind = strokeKind(stroke, e);
          if (kind) {
            strokeFrom = null;
            if (drag.pending) {
              drag.pending = null;
              if (PET) PET.press(false);
            }
            if (kind === "pot") potHit(stroke.x, stroke.y);
            else putBasin();
            return true;
          }
          const dy = e.clientY - stroke.y, dx = Math.abs(e.clientX - stroke.x);
          if (!drag.pending || Math.hypot(dx, dy) < 6 || dy > 0 && dy > dx * 0.8) return true;
          strokeFrom = null;
          return false;
        };
        const beginCarry = (e, pending, px, py, now) => {
          cancelWalk();
          drag.on = true;
          drag.touch = e.pointerType === "touch" || !!(pending && pending.touchGrab);
          drag.samples = [];
          free.anim = null;
          free.k = shown.k;
          free.mode = freeMode();
          free.applied = true;
          petDocked = false;
          walk.safeHold = false;
          walk.area = null;
          walk.displayId = "";
          try {
            document.documentElement.setPointerCapture(e.pointerId);
          } catch {
          }
          document.documentElement.classList.add("dsc-grabbing");
          until.sweat = Infinity;
          walk.lastTouch = now;
          if (PET) {
            petGrab = { x: pending.ox, y: pending.oy };
            petTracking = true;
            drag.x = px - pending.ox;
            drag.y = py - pending.oy;
            drag.samples = [[now, px, py]];
            PET.send({ type: "track", on: true, grab: petGrab, off: { x: (innerWidth - W * free.k) / 2, y: innerHeight - H * free.k } });
          }
        };
        const carryMove = (e, pending) => {
          strokeFrom = null;
          chestFrom = null;
          const [px, py] = pointerPoint(e), now = performance.now();
          if (!drag.on) beginCarry(e, pending, px, py, now);
          if (PET && petTracking) {
            e.preventDefault();
            return;
          }
          drag.x = px - pending.ox;
          drag.y = py - pending.oy;
          drag.samples.push([now, px, py]);
          while (drag.samples.length > 2 && now - drag.samples[0][0] > 100) drag.samples.shift();
          const [t0, x0, y0] = drag.samples[0], dt = Math.max(16, now - t0) / 1e3;
          carry.vx += ((px - x0) / dt - carry.vx) * 0.5;
          carry.vy += ((py - y0) / dt - carry.vy) * 0.5;
          if (!PET) followPet(now);
          e.preventDefault();
        };
        const carryHeld = (e) => {
          const touchGrab = !!(drag.pending && drag.pending.touchGrab && e.pointerId === drag.pending.id);
          const both = (e.buttons & 3) === 3 || touchGrab || dragKeyHeld(e);
          return both;
        };
        life.listen(document, "pointermove", (e) => {
          if (hidden) return;
          if (PET && petPanelOpen && petPanel && petPanel.contains(e.target)) return;
          if (e.pointerType !== "touch") chordButtonsMoved(e, performance.now());
          classifyTouchMove(e);
          const both = carryHeld(e);
          if (chestFrom && !both && e.pointerId === chestFrom.id && chestMove(e)) return;
          if (strokeFrom && !both && strokeMove(e)) return;
          const pending = drag.pending;
          if (!pending || e.pointerId !== pending.id) return;
          if (e.buttons === 0) return endDrag(e, false);
          if (!both) {
            if (drag.on) endDrag(e, false);
            return;
          }
          carryMove(e, pending);
        }, true);
        const followPet = (now) => {
          if (!link.supported || link.open) return;
          const k = free.k;
          const out = bodyOut({ k, x: drag.x, y: drag.y });
          const screenPos = screenOf(drag.x, drag.y), pose2 = { k, x: screenPos.x, y: screenPos.y };
          if (!link.follow) {
            if (!out) return;
            if (link.petState !== "hidden") {
              if (now - link.peek > 250) {
                link.peek = now;
                if (link.petState === "none") link.post("warm");
                else link.poll();
              }
              return;
            }
            link.follow = { shown: false };
            link.last = "";
            link.post("open", { from: pose2, to: pose2, follow: true, grab: { x: drag.pending?.ox ?? 0, y: drag.pending?.oy ?? 0 }, seq: ++link.seq });
          }
        };
        const finishFollow = (vx, vy) => {
          const follow = link.follow;
          link.follow = null;
          link.queue = [];
          lastPlaceKey = "";
          const outside = bodyOut({ k: free.k, x: drag.x + vx * GLIDE, y: drag.y + vy * GLIDE }, !follow.shown);
          if (outside && follow.shown) {
            link.post("send", { list: [["release", [vx, vy]]] });
            link.enter();
            return true;
          }
          if (!outside) link.post("hide");
          return false;
        };
        const endDrag = (e, cancel) => {
          const pending = drag.pending;
          if (!pending || e.pointerId !== pending.id) return;
          clearTimeout(touchHold);
          drag.pending = null;
          strokeFrom = null;
          if (PET) PET.press(false);
          if (!drag.on) {
            if (!cancel && pending.h) onTouch(pending.h[0], pending.h[1], pending.h[2]);
            return;
          }
          drag.on = false;
          if (PET && petTracking) {
            petTracking = false;
            petGrab = null;
            PET.send({ type: "track", on: false });
          }
          try {
            document.documentElement.releasePointerCapture(e.pointerId);
          } catch {
          }
          document.documentElement.classList.remove("dsc-grabbing");
          until.sweat = performance.now() + 400;
          const moving = performance.now() - drag.samples[drag.samples.length - 1][0] < 80;
          const vx = moving ? carry.vx : 0, vy = moving ? carry.vy : 0;
          if (link.follow && finishFollow(vx, vy)) return;
          release(vx, vy, drag.touch);
        };
        life.listen(document, "pointerup", (e) => {
          if (hidden) return;
          mouseButtons = e.buttons & 3;
          chord = chordUp(chord, e.buttons);
          if (chestFrom && e.pointerId === chestFrom.id) {
            const dragged = chestDragging;
            releaseChest();
            if (dragged) {
              if (PET) PET.press(false);
              return;
            }
          }
          const stroke = strokeFrom;
          strokeFrom = null;
          if (drag.pending) return endDrag(e, false);
          if (stroke) onTouch(stroke.h[0], stroke.h[1], stroke.h[2]);
        }, true);
        addEventListener("blur", () => {
          mouseButtons = 0;
          chord = chordUp(chord, 0);
          rightPress = null;
          releaseChest();
          if (drag.pending) endDrag({ pointerId: drag.pending.id }, !drag.on);
        });
        life.listen(document, "pointercancel", (e) => {
          mouseButtons = 0;
          chord = chordUp(chord, e.buttons);
          rightPress = null;
          if (chestFrom && e.pointerId === chestFrom.id) {
            const wasDragging = chestDragging;
            releaseChest();
            if (wasDragging && PET) PET.press(false);
          }
          endDrag(e, true);
        }, true);
        for (const type of ["pointerup", "mousedown", "mouseup", "click", "dblclick"]) {
          life.listen(document, type, (e) => {
            if (!swallowClick) return;
            e.preventDefault();
            e.stopPropagation();
            if (type === "click" || type === "dblclick") setTimeout(() => {
              if (!chestFrom) swallowClick = false;
            }, 0);
          }, true);
        }
        let hoverCheck = 0;
        life.listen(document, "mousemove", (e) => {
          if (hidden) return;
          const now = performance.now();
          if (now - hoverCheck < 80) return;
          hoverCheck = now;
          if (PET && petPanelOpen && petPanel && petPanel.contains(e.target)) {
            document.documentElement.classList.remove("dsc-hover");
            return;
          }
          const over = !walking() && !!hitAt(e.clientX, e.clientY);
          document.documentElement.classList.toggle("dsc-hover", over);
        }, { passive: true });
        life.listen(document, "contextmenu", (e) => {
          if (hidden) return;
          if (drag.pending || drag.on) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (!PET) {
            if (chat.available() && overChat(e.clientX, e.clientY)) {
              e.preventDefault();
              e.stopPropagation();
              chat.open();
              return;
            }
            if (coarsePointer() && overBody(e.clientX, e.clientY)) {
              e.preventDefault();
              e.stopPropagation();
            }
            return;
          }
          e.preventDefault();
          if (!petPanelOpen && !walking() && overBody(e.clientX, e.clientY)) PET.menu();
        }, true);
        const touchOnBody = (e) => {
          const t = e.touches && e.touches[0];
          return !!t && !PET && hitAt(t.clientX, t.clientY) !== null;
        };
        life.listen(document, "touchstart", (e) => {
          if (touchOnBody(e)) e.preventDefault();
        }, { passive: false, capture: true });
        life.listen(document, "touchmove", (e) => {
          if (drag.on || drag.pending) e.preventDefault();
        }, { passive: false, capture: true });
        const wheelResizes = (e) => (PET || !coarsePointer()) && free.applied && intro.phase === "done" && free.on && overBody(e.clientX, e.clientY);
        life.listen(document, "wheel", (e) => {
          if (hidden) return;
          if (PET && petPanelOpen && petPanel && petPanel.contains(e.target)) return;
          if (!wheelResizes(e)) return;
          e.preventDefault();
          e.stopPropagation();
          if (drag.on || free.anim || walk.phase || fleeX !== 0) return;
          const kMin = PET ? PET_K_MIN : SHOW_K, kMax = PET ? PET_K_MAX : Math.min(1.25, innerHeight * 0.45 / visH);
          const fromK = Math.min(free.k, kMax), k = Math.min(kMax, Math.max(kMin, fromK * Math.exp(-e.deltaY * 12e-4)));
          if (k === fromK) return;
          if (PET) {
            free.x += W * (fromK - k) / 2;
            free.y += H * (fromK - k);
          }
          free.k = k;
          if (!PET) saveFree(false);
          else {
            petRememberRatio(petRatio());
            petSyncMenu();
            renderPetPanel();
          }
        }, { capture: true, passive: false });
        const PET_OUTFIT_ROWS = OUTFIT_ITEMS.map((item) => [item.key, item.ko]);
        const PET_BODY_ROWS = BODY_TYPES.map((body) => [body.key, body.ko]);
        function petKFit() {
          return Math.min(PET_K_MAX, (screen.availHeight - PET_BUBBLE) / H, (screen.availWidth - 40) / W);
        }
        function petClampK(k) {
          const n = Number(k);
          return Number.isFinite(n) ? Math.min(petKFit(), Math.max(PET_K_MIN, n)) : null;
        }
        function petRatio() {
          return petBaseK > 0 ? free.k / petBaseK : 1;
        }
        function petRatioBounds() {
          const minR = Math.max(0.05, PET_K_MIN / petBaseK);
          return { minR, maxR: Math.max(minR + 0.01, petKFit() / petBaseK) };
        }
        function petLoadRatio() {
          if (!PET) return 1;
          try {
            const n = parseFloat(localStorage.getItem(PET_SIZE_KEY) || "");
            return Number.isFinite(n) && n >= 0.1 && n <= 8 ? n : 1;
          } catch {
            return 1;
          }
        }
        function petRememberRatio(ratio) {
          if (!PET || !Number.isFinite(ratio) || ratio <= 0) return;
          clearTimeout(petSizeTimer);
          petSizeTimer = setTimeout(() => {
            try {
              localStorage.setItem(PET_SIZE_KEY, String(+ratio.toFixed(3)));
            } catch {
            }
          }, 250);
        }
        function petSizedPose(pose2, fromK, ratio) {
          if (ratio == null) return pose2;
          const k = petClampK(petBaseK * ratio);
          if (k == null || Math.abs(k - fromK) < 1e-3) return pose2;
          return { k, x: pose2.x + W * (fromK - k) / 2, y: pose2.y + H * (fromK - k) };
        }
        function petSyncMenu() {
          if (!PET) return;
          const outfit = prefs.outfit || {};
          const sig = JSON.stringify([+petRatio().toFixed(3), outfit]);
          if (sig === petMenuSig) return;
          petMenuSig = sig;
          PET.send({ type: "state", value: { size: +petRatio().toFixed(3), outfit } });
        }
        function petPanelBox(body) {
          if (!PET || !petPanelOpen || !petPanel) return body;
          const rect = petPanel.getBoundingClientRect();
          const box = { l: Math.round(rect.left), t: Math.round(rect.top), r: Math.round(rect.right), b: Math.round(rect.bottom) };
          return body ? { l: Math.min(body.l, box.l), t: Math.min(body.t, box.t), r: Math.max(body.r, box.r), b: Math.max(body.b, box.b) } : box;
        }
        function petSetRatio(ratio, ms) {
          const k = petClampK(petBaseK * ratio);
          if (k == null || drag.on) return;
          const from = free.on && shown.k ? { k: shown.k, x: shown.x, y: shown.y } : { k: free.k, x: free.x, y: free.y };
          if (Math.abs(k - from.k) >= 1e-3) {
            const x = from.x + W * (from.k - k) / 2, y = from.y + H * (from.k - k);
            if (free.on) {
              if (ms > 0) free.anim = { t0: performance.now(), ms, from, to: { k, x, y }, snap: false };
              else {
                free.anim = null;
                free.x = x;
                free.y = y;
                free.k = k;
              }
            } else free.k = k;
          }
          petRememberRatio(k / petBaseK);
          petSyncMenu();
          renderPetPanel();
        }
        function renderPetPanel() {
          if (!petPanel) return;
          const { minR, maxR } = petRatioBounds();
          const minPercent = Math.max(5, Math.ceil(minR * 100)), maxPercent = Math.max(minPercent + 1, Math.floor(maxR * 100));
          const percent = Math.min(maxPercent, Math.max(minPercent, Math.round(petRatio() * 100)));
          const slider = petPanel.querySelector("[data-size-slider]");
          if (slider) {
            if (slider.min !== String(minPercent)) slider.min = String(minPercent);
            if (slider.max !== String(maxPercent)) slider.max = String(maxPercent);
            if (slider.value !== String(percent)) slider.value = String(percent);
          }
          const out = petPanel.querySelector("[data-size-value]");
          if (out) out.textContent = percent + "%";
          const outfit = prefs.outfit || {};
          for (const input of petPanel.querySelectorAll("[data-outfit]")) input.checked = outfit[input.dataset.outfit] === true;
          const body = outfit.bodyType || "default";
          for (const input of petPanel.querySelectorAll("[data-body]")) input.checked = input.value === body;
        }
        function createPetPanel() {
          const root = life.own(document.createElement("div"), (node) => node.remove());
          root.id = "dsc-pet-panel";
          root.setAttribute("role", "dialog");
          root.setAttribute("aria-label", "캐릭터 설정");
          root.innerHTML = [
            '<div class="dsc-panel-head"><strong>설정</strong><button type="button" class="dsc-panel-close" data-close aria-label="닫기">×</button></div>',
            '<section class="dsc-panel-section"><div class="dsc-panel-row"><span>크기 <small>기본 대비</small></span><output data-size-value>100%</output></div>',
            '<input type="range" min="50" max="200" step="1" data-size-slider aria-label="캐릭터 크기"></section>',
            '<section class="dsc-panel-section"><div class="dsc-panel-sub">소품·옷</div>',
            ...PET_OUTFIT_ROWS.map(([key, label]) => `<label class="dsc-panel-check"><input type="checkbox" data-outfit="${key}"> ${label}</label>`),
            "</section>",
            '<section class="dsc-panel-section"><div class="dsc-panel-sub">체형</div>',
            ...PET_BODY_ROWS.map(([value, label]) => `<label class="dsc-panel-check"><input type="radio" name="dsc-pet-body" value="${value}" data-body> ${label}</label>`),
            "</section>",
            '<section class="dsc-panel-section dsc-panel-actions"><button type="button" data-hide>캐릭터 잠시 숨기기</button></section>'
          ].join("");
          document.body.append(root);
          root.addEventListener("click", (e) => {
            if (e.target.closest("[data-close]")) closePetPanel();
          });
          const slider = root.querySelector("[data-size-slider]");
          slider.addEventListener("input", () => petSetRatio(Number(slider.value) / 100, 0));
          for (const input of root.querySelectorAll("[data-outfit]")) input.addEventListener("change", () => PET.send({ type: "config", list: [[input.dataset.outfit, input.checked]] }));
          for (const input of root.querySelectorAll("[data-body]")) input.addEventListener("change", () => {
            if (input.checked) PET.send({ type: "config", list: [["bodyType", input.value]] });
          });
          root.querySelector("[data-hide]").addEventListener("click", () => {
            closePetPanel();
            PET.send({ type: "config", list: [["character", false]] });
          });
          return root;
        }
        function fitPetPanel() {
          if (!petPanel) return;
          const rect = petPanel.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const left = Math.max(0, screen.availLeft - screenX), top = Math.max(0, screen.availTop - screenY);
          const right = Math.min(innerWidth, screen.availLeft + screen.availWidth - screenX);
          const bottom = Math.min(innerHeight, screen.availTop + screen.availHeight - screenY);
          const x = Math.max(left + 4, Math.min(right - rect.width - 4, (left + right - rect.width) / 2));
          const y = Math.max(top + 4, Math.min(bottom - rect.height - 4, (top + bottom - rect.height) / 2));
          petPanel.style.left = Math.round(x) + "px";
          petPanel.style.top = Math.round(y) + "px";
          petPanel.style.transform = "none";
        }
        function openPetPanel(focus) {
          if (!PET) return;
          if (!petPanel) petPanel = createPetPanel();
          renderPetPanel();
          petPanel.classList.add("show");
          petPanelOpen = true;
          const room = Number(screen?.availHeight) > 0 ? Math.round(screen.availHeight - 48) : 560;
          petPanel.style.maxHeight = Math.max(260, Math.min(560, room)) + "px";
          petPanelWin = { w: innerWidth, h: innerHeight };
          fitPetPanel();
          const slider = focus === "size" && petPanel.querySelector("[data-size-slider]");
          if (slider) slider.focus({ preventScroll: true });
          petSyncMenu();
        }
        function closePetPanel() {
          if (!petPanel) return;
          petPanelOpen = false;
          petPanelWin = { w: 0, h: 0 };
          petPanel.classList.remove("show");
        }
        listeners.tool = (text) => {
          const now = performance.now();
          if (waitingKind || now - lastToolSay < 1500) return;
          lastToolSay = now;
          say(text, 0, false, "status");
        };
        let lastThought = "", lastMutterAt = 0;
        const chat = createChat({
          say,
          flashExp,
          play,
          expName: EXP_NAME,
          lifetime: life,
          petWindow: !!PET,
          /** 혼잣말 간격(6초)·다른 말 뒤(2.5초)를 지켰는지 */
          mutterOpen: () => performance.now() - lastMutterAt >= 6e3 && performance.now() - lastSayAt >= 2500,
          /** 혼잣말을 한 것으로 표시 */
          mutterMark: () => {
            lastMutterAt = performance.now();
          }
        });
        const mutterCheck = () => {
          const raw = readThought(document);
          if (!raw || raw === lastThought) return;
          lastThought = raw;
          const now = performance.now();
          if (now - lastMutterAt < 6e3 || now - lastSayAt < 2500) return;
          if (chat.ready("mutter")) {
            void chat.mutter(raw);
            return;
          }
          const line = thoughtLine(raw);
          if (!line) return;
          lastMutterAt = now;
          say(line, Math.min(5200, Math.max(3800, 1500 + line.length * 55)), true);
          if (Math.random() < 0.35) play("tilt", 1600);
        };
        if (!PET) setTimeout(() => {
          if (!link.open) {
            say(TEXT.hello, 5800, false, "reaction");
            play("sway", 2300);
          }
        }, 700);
        if (life.stopped) return;
        window.__dsc = {
          // 확인용
          say,
          play,
          setMood,
          flashExp,
          /** 삐침 중 여부 */
          sulking: () => performance.now() < sulkUntil,
          /** 삐친 동안 몰래 보기 예정(삐친 뒤 시각 ms 반올림·flip 여부) */
          sulkPeeks: () => sulkPeeks.map((peek) => ({ at: Math.round(peek.at), flip: peek.flip })),
          /** 산책 시작(산책·도망 중이 아니면) 후 산책 단계 */
          walk: () => {
            if (!walk.phase && fleeX === 0) startWalk();
            return walk.phase;
          },
          /** 지금 산책 단계 */
          walking: () => walk.phase,
          /** 절전 상태 */
          sleep: () => SLEEP.state,
          /** 창 좌표 자리의 몸 부위 이름, 그림 밖이면 null */
          regionAt: (cx, cy) => {
            const h = hitAt(cx, cy);
            return h && touchRegion(h[0], h[1], h[2]);
          },
          /** 도망·산책으로 옆으로 비켜난 거리(px, + 오른쪽 · - 왼쪽) */
          fleeX: () => fleeX,
          /** 보이는 말풍선 문구, 없으면 빈 문자열 */
          bubble: () => bubble.classList.contains("show") ? bubble.textContent : "",
          /** 보이는 상태 말풍선(명령 실행 중 등) 문구, 없으면 빈 문자열 */
          status: () => bubbleStatus.classList.contains("show") ? bubbleStatus.textContent : "",
          lines: TEXT,
          /** 외부 음성 상태 설정. speaking이 false거나 null이면 해제 */
          voice: (state) => {
            voiceState = state && state.speaking !== false ? state : null;
          }
        };
        const petLinkEnter = () => {
          skipIntro();
          hideStatus();
          free.anim = null;
          drag.pending = null;
          drag.on = false;
          setRender(false);
        };
        const petLinkLeave = () => {
          wakeRaf();
          SLEEP.state = "active";
          SLEEP.lastActive = performance.now();
          free.on = false;
          free.anim = null;
          saveFree();
          lastPlaceKey = "";
          if (!hidden) setRender(true);
        };
        const petLinkSnapshot = () => {
          const left = moodUntil ? Math.max(1, moodUntil - performance.now()) : 0;
          const list = [...Object.keys(hold).map((name) => ["setExp", [name, !!hold[name]]]), ["setMood", [mood, left]]];
          if (!bubble.classList.contains("show")) list.push(["hush", []]);
          return list;
        };
        const petLinkDragMessages = () => {
          const list = [["drag", [dragKeyRaw()]]];
          const dragToken = dragKeyToken();
          if (dragToken && !DRAG_MODIFIER_TOKENS.has(dragToken)) list.push(["dragheld", [dragToken, pressedKeys.has(dragToken)]]);
          return list;
        };
        const petLinkDock = () => {
          const dockSpot = dockTarget(homePose()), dockSpotScreen = screenOf(dockSpot.x - fleeX, dockSpot.y);
          const petK = dockSpot.k * PET_HEAD_RATIO;
          const bustCenterX = dockSpotScreen.x + W * dockSpot.k / 2;
          const waistY = dockSpotScreen.y + dockSpot.k * WAIST_WIN;
          const topLeft = screenOf(0, 0), bottomRight = screenOf(innerWidth, innerHeight);
          const dock = {
            k: +petK.toFixed(3),
            x: Math.round(bustCenterX - petK * (W / 2 + (BUST_CX - FULL_CX) * fullScale)),
            y: Math.round(waistY - petK * WAIST_PET),
            win: { l: Math.round(topLeft.x), t: Math.round(topLeft.y), r: Math.round(bottomRight.x), b: Math.round(bottomRight.y) }
          };
          return { dock, outfit: prefs.outfit || {} };
        };
        const petOpenScreenPose = () => {
          const pose2 = SLEEP.state === "active" && shown.k > 0 ? { k: shown.k, x: shown.x, y: shown.y } : dockTarget(homePose());
          const screenPos = screenOf(pose2.x, pose2.y);
          return { k: pose2.k, x: screenPos.x, y: screenPos.y };
        };
        link.start();
        if (!PET) hooks.togglePet = link.toggle;
        if (PET) {
          const local = { say, play, setMood, flashExp, setExp, hush };
          const onPetCursor = (message) => {
            if (!drag.on || !petGrab) return;
            const now = performance.now();
            drag.x = message.x - petGrab.x;
            drag.y = message.y - petGrab.y;
            drag.samples.push([now, message.x, message.y]);
            while (drag.samples.length > 2 && now - drag.samples[0][0] > 100) drag.samples.shift();
            const [t0, x0, y0] = drag.samples[0], dt = Math.max(16, now - t0) / 1e3;
            carry.vx += ((message.x - x0) / dt - carry.vx) * 0.5;
            carry.vy += ((message.y - y0) / dt - carry.vy) * 0.5;
          };
          const onPetPower = (message) => {
            if (!message.on) {
              petTracking = false;
              petGrab = null;
              closePetPanel();
              for (const t of walk.timers) clearTimeout(t);
              walk.timers = [];
              walk.slideId++;
              walk.phase = "";
              walk.dir = -1;
              fleeX = 0;
              clearWalkVisual();
            }
            petPower = !!message.on;
            setRender(petPower);
            if (petPower) wakeRaf();
            if (petPower) requestPetDisplay();
          };
          const onPetBounds = (message) => {
            const bounds = message.bounds;
            if (bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every((value) => Number.isFinite(value))) petBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, at: performance.now() };
            confirmRecoverBounds();
          };
          const onPetOpen = (message) => {
            petPower = true;
            setRender(true);
            wakeRaf();
            for (const t of walk.timers) clearTimeout(t);
            walk.timers = [];
            walk.slideId++;
            walk.phase = "";
            fleeX = 0;
            clearWalkVisual();
            petBounds = null;
            drag.pending = null;
            PET.press(false);
            closePetPanel();
            petDocked = false;
            free.on = true;
            Object.assign(free, message.from);
            petGrab = message.follow ? message.grab || { x: 0, y: 0 } : null;
            petTracking = !!message.follow;
            const kFrom = Number(message.from.k) || 1;
            const kBase = Math.min(petKFit(), Math.max(PET_K_MIN, kFrom * HEAD_GAIN));
            petBaseK = kBase;
            const ratio = petLoadRatio();
            petPendingRatio = message.follow ? ratio : null;
            const kApply = message.follow ? kBase : petClampK(kBase * ratio);
            if (kApply !== kFrom) {
              const kDelta = kFrom - kApply;
              free.x += W * kDelta / 2;
              free.y += H * kDelta;
              free.k = kApply;
              if (petGrab) petGrab = { x: petGrab.x * kApply / kFrom, y: petGrab.y * kApply / kFrom };
            }
            const pose2 = { k: free.k, x: free.x, y: free.y }, to = { k: kApply, x: message.to.x + W * (kFrom - kApply) / 2, y: message.to.y + H * (kFrom - kApply) };
            PET.send({ type: "track", on: !!message.follow, grab: petGrab, off: { x: (innerWidth - W * pose2.k) / 2, y: innerHeight - H * pose2.k } });
            drag.on = !!message.follow;
            drag.x = pose2.x;
            drag.y = pose2.y;
            drag.samples = [[performance.now(), pose2.x + (petGrab?.x ?? 0), pose2.y + (petGrab?.y ?? 0)]];
            free.anim = message.follow ? null : { t0: performance.now(), ms: 300, from: pose2, to: keepIn(to), snap: false };
            until.sweat = message.follow ? Infinity : 0;
            movePet(pose2);
            PET.send({ type: "placed" });
            requestPetDisplay({ x: pose2.x + W * pose2.k / 2, y: pose2.y + H * pose2.k * 0.5 });
            petSyncMenu();
          };
          const onPetHome = () => {
            closePetPanel();
            if (petDock) free.anim = { t0: performance.now(), ms: 650, from: { ...shown }, to: null, snap: true };
            else PET.send({ type: "attach" });
          };
          const releaseFromHost = (vx, vy) => {
            petGrab = null;
            petTracking = false;
            PET.send({ type: "track", on: false });
            drag.on = false;
            until.sweat = performance.now() + 400;
            release(vx, vy);
          };
          const PET_COMMANDS = {
            /** 소품·옷 설정 반영 */
            outfit: (args) => {
              prefs.outfit = args[0];
              renderPetPanel();
              petSyncMenu();
            },
            /** 붙을 자리 갱신 */
            dock: (args) => {
              petDock = args[0];
            },
            /** 외부 음성 상태 반영 */
            voice: (args) => {
              voiceState = args[0];
            },
            /** 창 안 캐릭터와 같은 이동 키 설정 */
            drag: (args) => {
              prefs.drag = { key: args[0] };
            },
            /** 포커스 없는 펫 창에 일반 이동 키의 눌림 상태 전달 */
            dragheld: (args) => {
              if (args[1]) pressedKeys.add(args[0]);
              else pressedKeys.delete(args[0]);
            },
            /** 창 안 캐릭터가 창 밖에서 놓음(던질 속도 vx·vy) */
            release: (args) => {
              if (drag.on) releaseFromHost(args[0], args[1]);
            }
          };
          const onPetCommands = (message) => {
            for (const [fn, args] of message.list || []) {
              if (Object.hasOwn(PET_COMMANDS, fn)) PET_COMMANDS[fn](args);
              else if (Object.hasOwn(local, fn) && Array.isArray(args)) local[fn](...args);
            }
          };
          const PET_MESSAGES = {
            cursor: onPetCursor,
            power: onPetPower,
            /** pet/main.cjs: 현재 표시장치 DIP workArea (산책 출발 시 고정). request·displays는 top-level로 옴 */
            display: (message) => applyPetDisplay(message.display, !!message.changed, message.request, message.displays),
            bounds: onPetBounds,
            /** 우클릭 메뉴: 설정(또는 크기) 패널 열기 */
            panel: (message) => openPetPanel(message.focus),
            /** 우클릭 메뉴: 정해진 배율로 (기본 대비) */
            size: (message) => petSetRatio(Number(message.ratio), 220),
            open: onPetOpen,
            home: onPetHome,
            cmd: onPetCommands
          };
          PET.on((message) => {
            if (Object.hasOwn(PET_MESSAGES, message.type)) PET_MESSAGES[message.type](message);
          });
          petPower = false;
          setRender(false);
          PET.send({ type: "ready" });
          requestPetDisplay();
        }
        const readSleepPrefs = () => {
          const sleepPrefs = prefs.sleep || {};
          SLEEP.enabled = !PET && sleepPrefs.enabled !== false;
          const minutes = Number(sleepPrefs.minutes);
          SLEEP.minutes = Number.isFinite(minutes) ? Math.min(60, Math.max(0.5, minutes)) : 1;
        };
        const reactToWaiting = (kind) => {
          if (kind === waitingKind) return;
          waitingKind = kind;
          setExp("sweat", kind === "approval");
          setExp("squint", kind === "question");
          if (kind) {
            say(TEXT[kind], 0, false, "reaction");
            setMood("wait");
            play("tilt", 1800);
          } else {
            setMood(running ? "work" : "idle");
            if (running) hush();
          }
        };
        const reactToFinish = () => {
          if (running) return;
          hideStatus();
          if (performance.now() - lastError < 8e3) {
            flashExp("tears", 5e3);
            flashExp("dizzy", 2500);
            say(TEXT.error, 5e3, false, "reaction");
            setMood("sad", 5e3);
            play("droop", 2e3);
          } else if (chat.ready("summary")) {
            setMood("idle");
            play("laugh", 1700);
            void chat.summary().then((ok) => {
              if (!ok) {
                flashExp("heart", 4e3);
                flashExp("blush", 4e3);
                say(TEXT.done, 4e3, false, "reaction");
              }
            });
          } else {
            flashExp("heart", 4e3);
            flashExp("blush", 4e3);
            say(TEXT.done, 4e3, false, "reaction");
            setMood("idle");
            play("laugh", 1700);
          }
        };
        const reactToRunning = (nowRunning) => {
          if (nowRunning && !running) {
            running = true;
            lastError = -1e9;
            setExp("loading", true);
            if (!waitingKind) {
              say(TEXT.start, 2500, false, "reaction");
              setMood("work");
              play("nod", 1300);
            }
          } else if (!nowRunning && running) {
            running = false;
            setExp("loading", false);
            setTimeout(reactToFinish, 600);
          }
        };
        const sleepDue = () => SLEEP.enabled && SLEEP.state === "active" && !running && !waitingKind && !document.hidden && performance.now() - SLEEP.lastActive > SLEEP.minutes * 6e4 && performance.now() - lastSayAt > 5e3 && !bubble.classList.contains("show");
        if (!PET) setInterval(() => {
          const { running: nowRunning, waiting: kind } = readStatus(document);
          readSleepPrefs();
          if (nowRunning || kind || !SLEEP.enabled) sleepActivity();
          if (SLEEP.state === "asleep") return;
          if (nowRunning && !waitingKind && !kind) mutterCheck();
          reactToWaiting(kind);
          reactToRunning(nowRunning);
          if (sleepDue()) sleepGo();
        }, 400);
      })().catch((e) => console.warn("DeepSeek짱 캐릭터 로드 실패:", e));
    });
    return {
      /** 플러그인 설정 변경 반영. 패널 숨김(pageHidden)이 바뀌면 바로 숨김/복구 */
      setPrefs(next) {
        const pageChanged = "pageHidden" in next && next.pageHidden !== prefs.pageHidden;
        Object.assign(prefs, next);
        if (pageChanged) hooks.syncPageHidden?.();
      },
      /** 펫 창 토글 함수. 모델이 준비되기 전에는 null (단축키는 이때 키 입력을 가로채지 않음) */
      get togglePet() {
        return hooks.togglePet || null;
      },
      /** 창 안 캐릭터 숨기기·보이기 토글 함수. 모델이 준비되기 전과 펫 창에서는 null */
      get toggleCanvas() {
        return hooks.toggleCanvas || null;
      },
      /** 창 안 캐릭터 숨김 여부 */
      canvasHidden: () => hooks.canvasHidden?.() === true
    };
  }

  // character/lifetime.ts
  function createLifetime() {
    let stopped = false;
    const cleanups = [];
    const timers = /* @__PURE__ */ new Set(), intervals = /* @__PURE__ */ new Set(), frames = /* @__PURE__ */ new Set();
    const add = (cleanup) => {
      if (stopped) cleanup();
      else cleanups.push(cleanup);
    };
    const timeout = (fn, ms, ...args) => {
      if (stopped) return 0;
      const id = window.setTimeout(() => {
        timers.delete(id);
        if (!stopped) fn(...args);
      }, ms);
      timers.add(id);
      return id;
    };
    const interval = (fn, ms, ...args) => {
      if (stopped) return 0;
      const id = window.setInterval(() => {
        if (!stopped) fn(...args);
      }, ms);
      intervals.add(id);
      return id;
    };
    const frame = (fn) => {
      if (stopped) return 0;
      const id = window.requestAnimationFrame((time) => {
        frames.delete(id);
        if (!stopped) fn(time);
      });
      frames.add(id);
      return id;
    };
    const listen = (target, type, fn, options) => {
      if (stopped) return;
      target.addEventListener(type, fn, options);
      add(() => target.removeEventListener(type, fn, options));
    };
    const observe = (fn) => {
      const observer = new window.MutationObserver((...args) => {
        if (!stopped) fn(...args);
      });
      add(() => observer.disconnect());
      return observer;
    };
    const own = (value, cleanup) => {
      add(() => cleanup(value));
      return value;
    };
    return {
      add,
      timeout,
      interval,
      frame,
      listen,
      observe,
      own,
      /** 정리 여부 */
      get stopped() {
        return stopped;
      },
      /** 타이머·프레임 취소 뒤 정리 함수를 등록 역순으로 실행 (한 번만, 실패는 경고만) */
      dispose() {
        if (stopped) return;
        stopped = true;
        for (const id of timers) window.clearTimeout(id);
        for (const id of intervals) window.clearInterval(id);
        for (const id of frames) window.cancelAnimationFrame(id);
        for (const cleanup of cleanups.reverse()) {
          try {
            cleanup();
          } catch (error) {
            console.warn("DeepSeek짱 cleanup:", error);
          }
        }
      }
    };
  }

  // character/standalone.ts
  createCharacter({
    base: new URL("./", document.currentScript.src).href,
    life: createLifetime(),
    pet: window.__dscPetMode ? window.dscPet : null
  });
})();
