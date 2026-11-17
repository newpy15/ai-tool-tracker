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

test('cleanLabel: 눈속임 글자와 줄바꿈을 없애고 30자까지', () => {
  assert.equal(p.cleanLabel('  영상\n\u202e작업  '), '영상 작업')
  assert.equal(p.cleanLabel('a'.repeat(50)).length, 30)
  assert.equal(p.cleanLabel(null), '')
})

test('parseCustom: 모양이 이상한 것·중복 id·이름 없음은 버리고 개수를 제한한다', () => {
  const raw = [
    { id: 'u1', name: '영상', names: ['a', 'a', 'bad name'] },
    { id: 'u1', name: '중복', names: [] },
    { id: 'U2', name: '대문자 id', names: [] },
    { id: 'u3', name: '   ', names: [] },
    null,
    ...Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, name: `n${i}`, names: [] })),
  ]
  const r = p.parseCustom(raw)
  assert.equal(r.length, p.MAX_CUSTOM)
  assert.deepEqual(r[0], { id: 'u1', name: '영상', names: ['a'] })
  assert.deepEqual(p.parseCustom('x'), [])
})

test('migrateMine: 예전 이름 목록을 하나의 프리셋으로', () => {
  assert.deepEqual(p.migrateMine(['a', 'b'], '내 프리셋'), [{ id: 'u0', name: '내 프리셋', names: ['a', 'b'] }])
  assert.deepEqual(p.migrateMine([], '내 프리셋'), [])
  assert.deepEqual(p.migrateMine(undefined, '내 프리셋'), [])
})

test('add/rename/delete/toggle/replace: 불변으로 고치고, 잘못된 입력은 무시', () => {
  let l = []
  l = p.addCustom(l, 'u1', ' 영상 ', ['a'])
  assert.deepEqual(l, [{ id: 'u1', name: '영상', names: ['a'] }])
  assert.equal(p.addCustom(l, 'u1', 'dup', []), l)
  assert.equal(p.addCustom(l, 'U!', 'x', []), l)
  assert.equal(p.addCustom(l, 'u2', '  ', []), l)
  l = p.renameCustom(l, 'u1', '새 이름')
  assert.equal(l[0].name, '새 이름')
  assert.equal(p.renameCustom(l, 'u1', '  '), l)
  l = p.toggleMember(l, 'u1', 'b')
  assert.deepEqual(l[0].names, ['a', 'b'])
  l = p.toggleMember(l, 'u1', 'a')
  assert.deepEqual(l[0].names, ['b'])
  assert.equal(p.toggleMember(l, 'u1', 'bad name')[0].names.length, 1)
  l = p.replaceMembers(l, 'u1', ['x', 'y'])
  assert.deepEqual(l[0].names, ['x', 'y'])
  assert.deepEqual(p.deleteCustom(l, 'u1'), [])
  assert.deepEqual(p.deleteCustom(l, 'zz'), l)
})

test('addCustom: 가득 차면 더 만들지 않는다', () => {
  let l = []
  for (let i = 0; i < p.MAX_CUSTOM + 2; i++) l = p.addCustom(l, `u${i}`, `n${i}`, [])
  assert.equal(l.length, p.MAX_CUSTOM)
})

test('newId: 겹치지 않는 id', () => {
  const l = [{ id: `u${(5).toString(36)}`, name: 'a', names: [] }]
  assert.notEqual(p.newId(l, 5), l[0].id)
  assert.match(p.newId([], 123456789), /^u[a-z0-9]{1,15}$/)
})
