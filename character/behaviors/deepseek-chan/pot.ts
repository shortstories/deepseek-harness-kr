// DeepSeek짱 행동: 냄비. 머리를 빠르게 쓸어내리면 위에서 떨어져 머리를 "쾅" 치고 튕겨 나감.
// 세숫대야를 쓰고 있으면(head.covered) 막아 낸다. 냄비·충격 그림은 창 안 DOM에 잠깐 붙는 연출이다.
import { EVENTS } from "../../behavior.ts";
import type { CharacterBehavior } from "../context.ts";
import { HEAD_COVERED } from "./basin.ts";

const POT_SVG = '<svg viewBox="0 0 140 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">' +
  '<defs><linearGradient id="dscPotBody" x1="0" x2="1"><stop offset="0" stop-color="#7d8794"/><stop offset=".35" stop-color="#e3e8ee"/><stop offset=".6" stop-color="#b8c0ca"/><stop offset="1" stop-color="#6c7580"/></linearGradient></defs>' +
  '<rect x="2" y="34" width="26" height="10" rx="5" fill="#3d434b"/><rect x="112" y="34" width="26" height="10" rx="5" fill="#3d434b"/>' +
  '<path d="M22 30 H118 V78 Q118 96 100 96 H40 Q22 96 22 78 Z" fill="url(#dscPotBody)" stroke="#4b525b" stroke-width="3"/>' +
  '<ellipse cx="70" cy="30" rx="50" ry="10" fill="#d7dde4" stroke="#4b525b" stroke-width="3"/>' +
  '<ellipse cx="70" cy="30" rx="40" ry="6" fill="#59616b"/><path d="M38 48 Q44 70 40 86" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55" fill="none"/></svg>';
/**
 * 충격 그림: 별 모양 터짐 + 바깥 충격선 (막았을 땐 은색 반짝임)
 * @param guarded true면 세숫대야로 막았을 때 그림
 * @returns SVG 문자열
 */
const impactSvg = (guarded: boolean) => {
  const points = [];
  for (let i = 0; i < 20; i++) { const radius = i % 2 ? 22 : 46, angle = (i / 20) * Math.PI * 2 - Math.PI / 2; points.push((50 + Math.cos(angle) * radius).toFixed(1) + "," + (50 + Math.sin(angle) * radius).toFixed(1)); }
  const fill = guarded ? "#f1f5f9" : "#ffe14d", stroke = guarded ? "#64748b" : "#ea580c", core = guarded ? "#ffffff" : "#fff7c2";
  let rays = "";
  for (let i = 0; i < 8; i++) { const angle = (i / 8) * Math.PI * 2 + 0.2, cos = Math.cos(angle), sin = Math.sin(angle); rays += `<line x1="${(50 + cos * 50).toFixed(1)}" y1="${(50 + sin * 50).toFixed(1)}" x2="${(50 + cos * 62).toFixed(1)}" y2="${(50 + sin * 62).toFixed(1)}" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>`; }
  return `<svg viewBox="-14 -14 128 128" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${rays}<polygon points="${points.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/><circle cx="50" cy="50" r="12" fill="${core}"/></svg>`;
};
let audioCtx: AudioContext | null = null;
/**
 * 효과음 (파일 없이 합성): 맞으면 둔탁한 "통", 세숫대야로 막으면 금속이 울리는 "깡~"
 * @param guarded true면 세숫대야로 막았을 때 소리
 */
const impactSound = (guarded: boolean) => {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const audio = audioCtx, t = audio.currentTime, out = audio.createGain();
    out.gain.value = 0.22; out.connect(audio.destination);
    /**
     * 점점 잦아드는 단음 하나
     * @param freq 시작 주파수(Hz)
     * @param dur 길이(초)
     * @param vol 시작 음량
     * @param drop 끝 주파수 배율(1이면 고정)
     */
    const tone = (freq: number, dur: number, vol: number, type: OscillatorType = "sine", drop = 1) => {
      const oscillator = audio.createOscillator(), gainNode = audio.createGain();
      oscillator.type = type; oscillator.frequency.setValueAtTime(freq, t); if (drop !== 1) oscillator.frequency.exponentialRampToValueAtTime(freq * drop, t + dur);
      gainNode.gain.setValueAtTime(vol, t); gainNode.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      oscillator.connect(gainNode); gainNode.connect(out); oscillator.start(t); oscillator.stop(t + dur + 0.02);
    };
    /**
     * 부딪히는 순간의 "탁" (점점 잦아드는 잡음)
     * @param dur 길이(초)
     * @param vol 음량
     * @param highpassHz 고역 통과 필터 기준 주파수(Hz)
     */
    const noise = (dur: number, vol: number, highpassHz: number) => {
      const noiseBuffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * dur), audio.sampleRate), samples = noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples.length, 3);
      const src = audio.createBufferSource(), filter = audio.createBiquadFilter(), gainNode = audio.createGain();
      src.buffer = noiseBuffer; filter.type = "highpass"; filter.frequency.value = highpassHz; gainNode.gain.value = vol;
      src.connect(filter); filter.connect(gainNode); gainNode.connect(out); src.start(t);
    };
    if (guarded) { noise(0.05, 0.7, 2500); for (const [freq, dur, vol] of [[640, 1.1, 0.5], [1370, 0.9, 0.35], [2230, 0.7, 0.25], [3150, 0.5, 0.15]]) tone(freq, dur, vol, "sine", 0.995); }
    else { noise(0.07, 0.8, 900); tone(190, 0.28, 0.9, "triangle", 0.45); tone(470, 0.35, 0.35, "sine", 0.9); tone(1130, 0.22, 0.18, "sine", 0.95); }
  } catch {}
};

export const pot: CharacterBehavior = {
  id: "deepseek-chan.pot",
  create(ctx) {
    /**
     * 냄비 떨어뜨리기: 위에서 떨어져 머리를 치고 튕겨 나감. 세숫대야를 쓰고 있으면 막아 냄
     * @param x 냄비가 떨어질 창 x 좌표(clientX)
     * @param y 냄비가 떨어질 창 y 좌표(clientY)
     */
    const potHit = (x: number, y: number) => {
      ctx.markTouched(); ctx.resetTapCounters();
      const guarded = ctx.tagged(HEAD_COVERED);   // 세숫대야를 쓰고 있으면 막아 냄
      ctx.lockInput(guarded ? 1200 : 3200);   // 맞고 정신 차릴 때까지 터치 안 받음
      const curK = ctx.scale(), w = Math.max(64, 150 * curK), h = w * 100 / 140;
      const pot = ctx.life.own(document.createElement("div"), (node) => node.remove());
      pot.style.cssText = `position:fixed;left:${x - w / 2}px;top:${y - h * 0.9}px;width:${w}px;height:${h}px;z-index:40;pointer-events:none;will-change:transform,opacity`;
      pot.innerHTML = POT_SVG;
      document.body.append(pot);
      const fall = y + h + 20, animMs = 1250;
      const anim = pot.animate([
        { transform: `translateY(${-fall}px) rotate(-14deg)`, offset: 0, easing: "cubic-bezier(.5,0,1,.6)" },
        { transform: "translateY(0) rotate(0deg) scale(1.12,.86)", offset: 0.4, easing: "ease-out" },   // 쾅
        guarded ? { transform: `translate(${w * 0.45}px,${-h * 1.6}px) rotate(60deg)`, offset: 0.66, easing: "ease-in" }   // 세숫대야에 튕겨 더 높이
                : { transform: `translate(${w * 0.25}px,${-h * 0.6}px) rotate(32deg)`, offset: 0.62, easing: "ease-in" },
        { transform: `translate(${w * 0.7}px,${h * 0.9}px) rotate(85deg)`, opacity: 0, offset: 1 },
      ], { duration: animMs, fill: "forwards" });
      /** 다 떨어진 냄비 정리 */
      anim.onfinish = () => pot.remove();
      ctx.timeline([{ at: animMs * 0.4, do: () => {   // 부딪히는 순간
        const hitK = ctx.scale(), burstSize = Math.max(60, 130 * hitK), burst = ctx.life.own(document.createElement("div"), (node) => node.remove());   // 글자 없이 만화식 충격 별 + 충격선
        burst.style.cssText = `position:fixed;left:${x - burstSize / 2}px;top:${y - h * 0.9 - burstSize / 2}px;width:${burstSize}px;height:${burstSize}px;z-index:41;pointer-events:none`;
        burst.innerHTML = impactSvg(guarded);
        document.body.append(burst);
        /** 다 터진 충격 그림 정리 */
        burst.animate([{ transform: "scale(.2) rotate(-20deg)", opacity: 0 }, { transform: "scale(1.15) rotate(5deg)", opacity: 1, offset: 0.25 }, { transform: "scale(1.3) rotate(10deg)", opacity: 0 }], { duration: 620, fill: "forwards" }).onfinish = () => burst.remove();
        impactSound(guarded);
        if (guarded) { ctx.play("flinch", 600); ctx.speak("pot_guard", 3000); return; }   // 막아 냄: 살짝 움찔하고 의기양양
        ctx.play("bonk", 1100); ctx.shiver();
        ctx.speak("pot_hit", 3000);
        ctx.flashExp("dizzy", 2800);   // 빙글빙글 눈 (말풍선 꼬리표의 눈물과 함께)
      } }]);
    };
    return { on: { [EVENTS.headStrokeFast]: ({ x, y }) => potHit(x, y) } };
  },
};
