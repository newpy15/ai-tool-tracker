import test from 'node:test'
import assert from 'node:assert/strict'
import * as p from '../hooks/presets.ts'
import { CATEGORY_ORDER } from '../hooks/categories.ts'

const I = (name, cat, enabled = true, toggleable = true) => ({ name, cat, enabled, toggleable })

test('planByCats: 고른 묶음은 켜고 다른 묶음은 끈다', () => {
  const items = [I('remotion', 'video', false), I('captions', 'captions', true), I('box', 'files', true), I('db', 'data', false), I('sec', 'security', true)]
  const r = p.planByCats(items, ['video', 'captions', 'image'])
  assert.deepEqual(r.on, ['remotion'])
  assert.deepEqual(r.off, ['box', 'sec'])
  assert.equal(r.same, 2) // captions(이미 켜짐), db(이미 꺼짐)
})

test('planByCats: 기타 묶음과 켜고 끌 수 없는 것은 건드리지 않는다', () => {
  const items = [I('mystery', 'other', true), I('ai-tool-tracker', 'dev', true, false), I('x', 'dev', true)]
  const r = p.planByCats(items, ['video'])
  assert.deepEqual(r, { on: [], off: ['x'], same: 0 })
})

test('planByCats: 이미 같으면 빈 계획', () => {
  const r = p.planByCats([I('a', 'video', true), I('b', 'files', false)], ['video'])
  assert.equal(p.isEmptyPlan(r), true)
})

test('planByNames: 저장한 이름은 켜고 나머지는 끈다, 저장 뒤에 새로 깐 것도 끈다', () => {
  const items = [I('a', 'video', false), I('b', 'dev', true), I('fresh', 'other', true), I('self', 'dev', true, false)]
  const r = p.planByNames(items, ['a'])
  assert.deepEqual(r.on, ['a'])
  assert.deepEqual(r.off.sort(), ['b', 'fresh'])
})

test('enabledNames/parseMine: 안전한 이름만, 중복 없이, 개수 제한', () => {
  assert.deepEqual(p.enabledNames([I('a', 'dev'), I('b', 'dev', false), I('a;b', 'dev'), I('c', 'dev', true, false)]), ['a'])
  assert.deepEqual(p.parseMine(['a', 'a', 'bad name', 5, null, 'b']), ['a', 'b'])
  assert.deepEqual(p.parseMine('x'), [])
  assert.equal(p.parseMine(Array.from({ length: 300 }, (_, i) => `p${i}`)).length, p.MAX_MINE)
})

test('PRESETS: 묶음 이름이 실제 묶음이고 프리셋 키가 겹치지 않는다', () => {
  for (const pr of p.PRESETS) for (const c of pr.cats) assert.ok(CATEGORY_ORDER.includes(c), c)
  assert.equal(new Set(p.PRESETS.map(x => x.key)).size, p.PRESETS.length)
})
