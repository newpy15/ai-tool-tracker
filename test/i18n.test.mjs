// 화면 문구 표(한국어·영어·일본어·중국어)를 소스에서 읽어 서로 맞는지 점검한다.
// 네 언어 모두 직접 적은 표이므로, 키가 빠지거나 숫자 자리가 사라지거나 엉뚱한 글자가 섞이는 실수를 여기서 막는다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const lines = readFileSync(join(here, '..', 'hooks', 'register.tsx'), 'utf8').split('\n')
const start = L => lines.findIndex(l => new RegExp(`^  ${L}:\\s*\\{`).test(l))
const idx = { ko: start('ko'), en: start('en'), ja: start('ja'), zh: start('zh') }
const uiEnd = lines.findIndex((l, i) => i > idx.zh && /^\}/.test(l))
for (const [k, v] of Object.entries(idx)) assert.ok(v > 0, `${k} 표의 위치를 찾지 못했습니다`)
assert.ok(idx.ko < idx.en && idx.en < idx.ja && idx.ja < idx.zh && idx.zh < uiEnd)

const load = async (from, to) => {
  const body = lines.slice(from + 1, to).join('\n').replace(/^\s*\},?\s*$/m, '')
  const code = stripTypeScriptTypes('const t = {' + body + '}\nexport default t')
  return (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).default
}
const T = {
  ko: await load(idx.ko, idx.en),
  en: await load(idx.en, idx.ja),
  ja: await load(idx.ja, idx.zh),
  zh: await load(idx.zh, uiEnd),
}
const LANGS = ['ko', 'en', 'ja', 'zh']
// 서로 다른 큰 수를 인자로 넣어 어느 문구에 어느 자리가 쓰이는지 본다 (문구 속 다른 숫자와 겹치지 않게)
const ARGS = [70101, 70202, 70303, 70404]
const run = (t, k) => (typeof t[k] === 'function' ? t[k](...ARGS) : String(t[k]))
const used = s => ARGS.map(a => s.includes(String(a)))

const HANGUL = /[가-힣]/
const KANA = /[぀-ヿ]/
const HAN = /[一-鿿]/

test('네 언어의 표가 같은 키를 가지고, 함수 여부와 인자 수도 같다', () => {
  const keys = Object.keys(T.en).sort()
  for (const L of LANGS) {
    assert.deepEqual(Object.keys(T[L]).sort(), keys, `${L}의 키가 다릅니다`)
    for (const k of keys) {
      assert.equal(typeof T[L][k], typeof T.en[k], `${L}.${k}: 함수 여부`)
      if (typeof T.en[k] === 'function') assert.equal(T[L][k].length, T.en[k].length, `${L}.${k}: 인자 수`)
    }
  }
})

test('한 문구에서 영어가 쓰는 인자(자리)는 다른 언어도 모두 쓴다', () => {
  const bad = []
  for (const k of Object.keys(T.en)) {
    const e = used(run(T.en, k))
    for (const L of ['ko', 'ja', 'zh']) {
      const u = used(run(T[L], k))
      e.forEach((used_, i) => {
        if (used_ && !u[i]) bad.push(`${L}.${k} (인자 ${i + 1} 빠짐)`)
      })
    }
  }
  assert.deepEqual(bad, [])
})

test('NaN, undefined가 문구에 나오지 않는다', () => {
  const bad = []
  for (const L of LANGS) for (const k of Object.keys(T[L])) if (/NaN|undefined|\[object/.test(run(T[L], k))) bad.push(`${L}.${k}`)
  assert.deepEqual(bad, [])
})

test('각 언어의 문구가 그 언어의 글자로 되어 있다', () => {
  const bad = []
  const sameAsEn = (L, k) => run(T[L], k).replace(/\d+/g, '#') === run(T.en, k).replace(/\d+/g, '#')
  for (const k of Object.keys(T.en)) {
    const en = run(T.en, k)
    if (HANGUL.test(en) || KANA.test(en) || HAN.test(en)) bad.push(`en.${k}: 영어 표에 다른 나라 글자`)
    const ko = run(T.ko, k)
    if (!HANGUL.test(ko) && !sameAsEn('ko', k)) bad.push(`ko.${k}: 한글이 없음`)
    const ja = run(T.ja, k)
    if (HANGUL.test(ja)) bad.push(`ja.${k}: 한글이 섞임`)
    if (!(KANA.test(ja) || HAN.test(ja)) && !sameAsEn('ja', k)) bad.push(`ja.${k}: 일본어 글자가 없음`)
    const zh = run(T.zh, k)
    if (HANGUL.test(zh) || KANA.test(zh)) bad.push(`zh.${k}: 한글·가나가 섞임`)
    if (!HAN.test(zh) && !sameAsEn('zh', k)) bad.push(`zh.${k}: 중국어 글자가 없음`)
  }
  assert.deepEqual(bad, [])
})

test('영어와 똑같은 문구는 짧은 고유 표기(OK 등)뿐이다 (번역이 빠진 것을 찾는다)', () => {
  const bad = []
  for (const L of ['ko', 'ja', 'zh']) {
    for (const k of Object.keys(T.en)) {
      const a = run(T[L], k)
      const e = run(T.en, k)
      if (a === e && /[A-Za-z]{4,}/.test(a.replace(/\/ai-[a-z]+|ai-tool-tracker|Claude Code|GitHub|MCP|localhost/g, ''))) bad.push(`${L}.${k}: ${a.slice(0, 40)}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('명령어와 자리표시가 번역 중에 바뀌지 않았다 (/ai-find, /ai-log, /ai-tools, ~/.claude/local-mods)', () => {
  const bad = []
  for (const k of Object.keys(T.en)) {
    const e = run(T.en, k)
    for (const L of ['ko', 'ja', 'zh']) {
      const a = run(T[L], k)
      for (const tok of ['/ai-find', '/ai-log', '/ai-tools', '~/.claude/local-mods', 'CLAUDE_CONFIG_DIR', 'ai-tool-tracker']) {
        if (e.includes(tok) && !a.includes(tok)) bad.push(`${L}.${k}: ${tok}`)
      }
    }
  }
  assert.deepEqual(bad, [])
})
