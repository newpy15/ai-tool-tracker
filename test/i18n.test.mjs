// 화면 문구 표(한국어·영어)를 소스에서 읽어 점검한다. 번역 흐름이 영어 문구의 틀을 자리표시({0}, {1} ...)로 불러 와서 번역하므로,
// 틀이 조건에 따라 모양이 바뀌거나 NaN이 생기면 다른 언어 화면에서 틀린 문장이 나온다. 그런 문구를 미리 막는다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const lines = readFileSync(join(here, '..', 'hooks', 'register.tsx'), 'utf8').split('\n')
const koStart = lines.findIndex(l => /^\s*ko:\s*\{/.test(l))
const enStart = lines.findIndex(l => /^\s*en:\s*\{/.test(l))
const uiEnd = lines.findIndex((l, i) => i > enStart && /^\}/.test(l))
assert.ok(koStart > 0 && enStart > koStart && uiEnd > enStart, 'UI 표의 위치를 찾지 못했습니다')

const load = async (from, to) => {
  const body = lines.slice(from + 1, to).join('\n').replace(/^\s*\},?\s*$/m, '')
  const code = stripTypeScriptTypes('const t = {' + body + '}\nexport default t')
  return (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).default
}
const ko = await load(koStart, enStart)
const en = await load(enStart, uiEnd)
const SENT = ['{0}', '{1}', '{2}', '{3}']
const skel = s => String(s).replace(/\{\d\}/g, '#').replace(/\d+/g, '#').replace(/\s+/g, ' ')
// 숫자가 0일 때 문구를 바꾸는 것은 번역 흐름이 따로 처리한다 (tabLog, tabReco)
const HANDLED = new Set(['tabLog', 'tabReco'])

test('한국어와 영어 표의 키가 같고 함수 여부와 인자 수도 같다', () => {
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort())
  for (const k of Object.keys(en)) {
    assert.equal(typeof ko[k], typeof en[k], k)
    if (typeof en[k] === 'function') assert.equal(ko[k].length, en[k].length, `${k}: 인자 수`)
  }
})

for (const [name, T] of [['영어', en], ['한국어', ko]]) {
  test(`${name}: 조건에 따라 모양이 바뀌는 함수 문구가 없다 (자리표시로 부를 때와 실제 값일 때가 같은 틀이어야 한다)`, () => {
    const bad = []
    for (const [k, v] of Object.entries(T)) {
      if (typeof v !== 'function' || HANDLED.has(k)) continue
      const a = skel(v(...SENT))
      if (a !== skel(v(1, 2, 3, 4)) || a !== skel(v(0, 0, 0, 0))) bad.push(k)
    }
    assert.deepEqual(bad, [], '조건에 따라 문구가 달라지는 키는 둘로 나누세요: ' + bad.join(', '))
  })

  test(`${name}: 자리표시로 불러도 NaN, undefined가 생기지 않는다`, () => {
    const bad = []
    for (const [k, v] of Object.entries(T)) {
      if (typeof v === 'function' && /NaN|undefined|null|\[object/.test(v(...SENT))) bad.push(k)
    }
    assert.deepEqual(bad, [], '인자를 가공하지 말고 호출하는 쪽에서 가공해 넘기세요: ' + bad.join(', '))
  })

  test(`${name}: 번역할 글자가 하나도 없는 문구가 없다 (매번 번역을 다시 요청하게 된다)`, () => {
    const bad = []
    for (const [k, v] of Object.entries(T)) {
      const s = typeof v === 'function' ? skel(v(...SENT)).replace(/#/g, '') : String(v)
      if (!/[A-Za-z가-힣]/.test(s)) bad.push(k)
    }
    assert.deepEqual(bad, [])
  })
}

test('자리표시로 부른 영어 문구에 한글이 섞여 있지 않다', () => {
  const bad = []
  for (const [k, v] of Object.entries(en)) {
    const s = typeof v === 'function' ? v(...SENT) : String(v)
    if (/[가-힣]/.test(s)) bad.push(k)
  }
  assert.deepEqual(bad, [])
})

test('한국어 문구에 영어 문장이 통째로 남아 있지 않다 (고유 이름·명령어는 제외)', () => {
  const bad = []
  for (const [k, v] of Object.entries(ko)) {
    const s = (typeof v === 'function' ? v(...SENT) : String(v)).replace(/\{\d\}/g, '')
    // 한글이 하나도 없고 영어 단어가 4개 이상이면 번역이 빠진 것으로 본다
    if (!/[가-힣]/.test(s) && (s.match(/[A-Za-z]{3,}/g) ?? []).length >= 4) bad.push(k)
  }
  assert.deepEqual(bad, [])
})
