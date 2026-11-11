#!/usr/bin/env node
// part*.txt → assets/dsc-lines-ex.json 변환기
//
// 사용법:
//   node tools/convert-part-lines.mjs --dry            # 개수·경고만 확인 (파일 안 씀)
//   node tools/convert-part-lines.mjs                  # assets/dsc-lines-ex.json 로 저장
//   node tools/convert-part-lines.mjs part1.txt part2.txt --out assets/dsc-lines-ex.json
//
// 규칙:
//   ## 그룹 제목        → 무시
//   ### 상황키          → 이후 줄을 그 키에 모음
//   그 밖의 비어 있지 않은 줄 → 대사 한 줄 (앞의 "- "는 제거)
//   같은 키가 여러 파일에 있으면 파일 순서대로 이어 붙임
//
// 안전장치:
//   - assets/dsc-lines.json에 없는 키는 기본적으로 버리고 개수만 보고
//   - 대사 문장은 화면에 출력하지 않음(개수·경고만)

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const takeOpt = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value ?? fallback;
};

const outPath = takeOpt('--out', 'assets/dsc-lines-ex.json');
const dry = argv.includes('--dry');
if (dry) argv.splice(argv.indexOf('--dry'), 1);
const keepUnknown = argv.includes('--keep-unknown');
if (keepUnknown) argv.splice(argv.indexOf('--keep-unknown'), 1);

const num = (name) => {
  const m = String(name).match(/(\d+)/);
  return m ? Number(m[1]) : 0;
};
const inputs = argv.length
  ? argv
  : readdirSync('.')
      .filter((name) => /^part\d+\.txt$/i.test(name))
      .sort((a, b) => num(a) - num(b));

if (!inputs.length) {
  console.error('입력 파일이 없습니다. 예: node tools/convert-part-lines.mjs part1.txt');
  process.exit(1);
}

const base = JSON.parse(readFileSync('assets/dsc-lines.json', 'utf8')).lines;
const known = new Set(Object.keys(base));
const TAGS = new Set(['홍조', '><', '하트', '얄미운', '식은땀', '어두운', '눈물', '어지럼']);
const bodyOf = (raw) => {
  const m = raw.match(/^\[([^\]]+)\]\s*/);
  return m ? raw.slice(m[0].length) : raw;
};

const lines = {};
const unknownKeys = new Set();
let total = 0;
let over26 = 0;
let badTags = 0;
let dupInKey = 0;
let badTagNames = 0;

for (const file of inputs) {
  if (!existsSync(file)) {
    console.error('없는 파일:', file);
    process.exit(1);
  }
  let key = null;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('###')) {
      key = line.slice(3).trim();
      if (!key) key = null;
      else if (!known.has(key)) unknownKeys.add(key);
      if (key && !lines[key]) lines[key] = [];
      continue;
    }
    if (line.startsWith('##') || line.startsWith('#')) {
      key = null;
      continue;
    }
    if (!key) continue;

    const text = line.replace(/^[-*]\s+/, '');
    if (!text) continue;
    lines[key].push(text);
    total++;

    const body = bodyOf(text);
    if (Array.from(body).length > 26) over26++;
    const tagMatch = text.match(/^\[([^\]]+)\]\s*/);
    if (tagMatch) {
      for (const tag of tagMatch[1].split(',')) {
        const name = tag.trim();
        if (!TAGS.has(name)) {
          badTags++;
          badTagNames++;
          if (badTagNames <= 5) console.log('  경고: 모르는 태그 —', name, `(${key})`);
        }
      }
    }
  }
}

for (const key of Object.keys(lines)) {
  const seen = new Set();
  const kept = [];
  for (const text of lines[key]) {
    const body = bodyOf(text);
    if (seen.has(body)) {
      dupInKey++;
      continue;
    }
    seen.add(body);
    kept.push(text);
  }
  lines[key] = kept;
}

let droppedKeys = 0;
for (const key of Object.keys(lines)) {
  if (!known.has(key) && !keepUnknown) {
    droppedKeys++;
    delete lines[key];
  }
}

const result = { text: {}, tools: {}, lines };
const json = JSON.stringify(result, null, 2) + '\n';

console.log(`files ${inputs.length} | keys ${Object.keys(lines).length} | lines ${Object.keys(lines).reduce((a, k) => a + lines[k].length, 0)}`);
console.log(`dropped keys ${droppedKeys} | unknown keys ${unknownKeys.size} | over26 ${over26} | badTags ${badTags} | dupInKey ${dupInKey}`);
if (unknownKeys.size) console.log('  알 수 없는 키:', [...unknownKeys].slice(0, 20).join(', '), unknownKeys.size > 20 ? '…' : '');

if (dry) {
  console.log('(--dry) 파일을 쓰지 않았습니다.');
} else {
  writeFileSync(outPath, json, 'utf8');
  console.log('저장:', outPath, `(${Buffer.byteLength(json)} bytes)`);
  console.log('적용: DSH 설정 → 플러그인 → "대사 ex" 켜기 → 새로고침');
}
