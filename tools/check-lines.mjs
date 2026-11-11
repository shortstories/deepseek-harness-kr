// 대사 파일 검사기: node tools/check-lines.mjs
// assets/dsc-lines.json 만 검사한다. 코드는 건드리지 않는다.
import { readFileSync } from 'node:fs';

const PATH = new URL('../assets/dsc-lines.json', import.meta.url);
const TAGS = new Set(['홍조', '><', '하트', '얄미운', '식은땀', '어두운', '눈물', '어지럼']);
const MAX = 26;
const KEYS = new Set([
  'head', 'head_sulk', 'head_after', 'body', 'arm', 'leg',
  'chest1', 'chest2', 'chest3', 'chest_calm',
  'chest_pull', 'chest_pull_long', 'chest_pull_dizzy', 'chest_drop',
  'lower1', 'lower2', 'lower3', 'lower_after',
  'spam', 'makeup', 'working',
  'pot_guard', 'pot_hit', 'basin_on',
  'walk_out', 'walk_back', 'sleep_out', 'sleep_back',
  'outfit_glasses', 'outfit_shoes', 'outfit_tail',
  'outfit_skirt_long', 'outfit_skirt_short', 'outfit_chest_cover', 'outfit_chest_open',
  'body_default', 'body_type1', 'body_type2',
]);

const problems = [];
const add = (m) => problems.push(m);
let data;
try {
  data = JSON.parse(readFileSync(PATH, 'utf8'));
} catch (e) {
  console.error('JSON 파싱 실패:', e.message);
  process.exit(1);
}

for (const k of ['text', 'tools', 'lines']) {
  if (!data[k] || typeof data[k] !== 'object') add(`최상위 "${k}" 가 없거나 객체가 아님`);
}

let textCount = 0, toolCount = 0, lineCount = 0, keyCount = 0;
for (const [k, v] of Object.entries(data.text || {})) {
  textCount++;
  if (typeof v !== 'string' || !v) add(`text.${k}: 문자열이 아님`);
}
for (const [k, v] of Object.entries(data.tools || {})) {
  toolCount++;
  if (typeof v !== 'string' || !v) add(`tools.${k}: 문자열이 아님`);
}

const seenAll = new Map();
for (const [key, arr] of Object.entries(data.lines || {})) {
  keyCount++;
  if (!KEYS.has(key)) add(`lines.${key}: 알 수 없는 상황 키(오타?)`);
  if (!Array.isArray(arr)) { add(`lines.${key}: 배열이 아님`); continue; }
  const seen = new Set();
  for (const raw of arr) {
    lineCount++;
    if (typeof raw !== 'string' || !raw) { add(`lines.${key}: 빈 값/문자열 아님`); continue; }
    const m = raw.match(/^\[([^\]]+)\]\s*/);
    const text = m ? raw.slice(m[0].length) : raw;
    const len = Array.from(text).length;
    if (len > MAX) add(`lines.${key}: ${len}자 (최대 ${MAX}) — ${text}`);
    if (text.includes('...')) add(`lines.${key}: "..." 대신 "…" 사용 — ${text}`);
    if (!text) add(`lines.${key}: 대사가 비어 있음`);
    if (m) for (const t of m[1].split(',')) if (!TAGS.has(t.trim())) add(`lines.${key}: 모르는 표정 태그 [${t.trim()}]`);
    if (seen.has(text)) add(`lines.${key}: 같은 상황 중복 — ${text}`);
    seen.add(text);
    if (seenAll.has(text)) add(`lines.${key}: 다른 상황(${seenAll.get(text)})과 중복 — ${text}`);
    else seenAll.set(text, key);
  }
  if (arr.length < 3) add(`lines.${key}: ${arr.length}개 (3개 이상 권장)`);
}

console.log(`text ${textCount} · tools ${toolCount} · lines ${lineCount} (${keyCount}상황)`);
if (problems.length) {
  console.log(`문제 ${problems.length}건:`);
  for (const p of problems) console.log('  -', p);
  process.exit(1);
}
console.log('문제 없음');
